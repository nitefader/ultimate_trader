"""Scale-out execution service for managing partial exits and stop progression.

Stop progression convention (long positions):
  new_stop = entry + (ATR × multiplier)
  multiplier > 0 → stop above entry (locked profit territory)
  multiplier = 0 → stop at entry (breakeven)
  multiplier < 0 → stop below entry (accept small loss)

After each scale level fills the stop is repriced via ReplaceOrderRequest (no cancel+resubmit).
The caller (deployment loop) supplies current_atr from the Feature Engine frame.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.services.alpaca_service import (
    AlpacaClientConfig,
    replace_order,
    close_position,
    AlpacaClosePositionRequest,
    build_program_client_order_id,
)

logger = logging.getLogger(__name__)


@dataclass
class ScalePositionState:
    """Live state for a position being managed with scale-out rules."""
    symbol: str
    side: str                      # "long" or "short"
    entry_price: float
    original_qty: float
    remaining_qty: float
    stop_order_id: str             # Alpaca order ID of the live stop leg
    current_stop_price: float
    open_exit_order_count: int     # remaining open exit orders (triggers BE)
    levels_filled: int             # how many scale levels have already filled
    execution_style: dict          # full execution_style config dict
    deployment_id: str | None = None
    program_name: str | None = None
    errors: list[str] = field(default_factory=list)

    @property
    def is_long(self) -> bool:
        return self.side.lower() == "long"

    @property
    def scale_out_levels(self) -> list[dict]:
        return self.execution_style.get("scale_out") or []

    @property
    def stop_progression_targets(self) -> list[float]:
        return self.execution_style.get("stop_progression_targets") or []

    @property
    def breakeven_atr_offset(self) -> float:
        """ATR offset applied to entry for the breakeven stop.
        Positive = stop above entry (profit buffer).
        Zero = exact breakeven.
        Negative = stop below entry (accept small loss).
        """
        return float(self.execution_style.get("breakeven_atr_offset") or 0.0)

    @property
    def breakeven_trigger_level(self) -> int | None:
        """1-indexed scale level that triggers the breakeven move. None = disabled."""
        v = self.execution_style.get("breakeven_trigger_level")
        return int(v) if v is not None else None

    @property
    def final_runner_exit_mode(self) -> str:
        return self.execution_style.get("final_runner_exit_mode") or "internal"


def _should_update_stop(
    current_stop: float,
    new_stop: float,
    is_long: bool,
) -> bool:
    """Only move stop in favorable direction — never worse than current."""
    if is_long:
        return new_stop > current_stop
    return new_stop < current_stop


def update_target_array_stop(
    config: AlpacaClientConfig,
    state: ScalePositionState,
    current_atr: float,
) -> ScalePositionState:
    """Move stop to next target_array position after a scale level fills.

    stop_arr_pos = levels_filled (0 = initial, 1 = after T1, 2 = after T2, ...)
    new_stop = entry_price ± (ATR × target_array[stop_arr_pos])

    Only moves stop in favorable direction. Calls replace_order (no cancel+resubmit).
    """
    targets = state.stop_progression_targets
    if not targets or state.levels_filled >= len(targets):
        return state

    multiplier = targets[state.levels_filled]
    if multiplier == 0.0:
        return state

    # Positive multiplier = stop moves toward/past entry in favorable direction
    # Long: stop = entry + ATR*mult (positive mult → above entry → locked profit)
    # Short: stop = entry - ATR*mult (positive mult → below entry → locked profit)
    if state.is_long:
        new_stop = state.entry_price + (current_atr * multiplier)
    else:
        new_stop = state.entry_price - (current_atr * multiplier)

    if not _should_update_stop(state.current_stop_price, new_stop, state.is_long):
        logger.info(
            "scale_out: target_array stop not updated — new_stop=%.4f not favorable vs current=%.4f (symbol=%s)",
            new_stop, state.current_stop_price, state.symbol,
        )
        return state

    result = replace_order(
        config,
        state.stop_order_id,
        qty=state.remaining_qty,
        stop_price=round(new_stop, 4),
    )
    if result.get("error"):
        logger.error(
            "scale_out: replace_order failed for target_array stop symbol=%s: %s",
            state.symbol, result["error"],
        )
        state.errors.append(f"target_array stop replace failed: {result['error']}")
        return state

    logger.info(
        "scale_out: stop moved to target_array[%d]=%.2f → new_stop=%.4f (symbol=%s)",
        state.levels_filled, multiplier, new_stop, state.symbol,
    )
    return ScalePositionState(
        **{**state.__dict__, "current_stop_price": new_stop}
    )


def move_to_break_even(
    config: AlpacaClientConfig,
    state: ScalePositionState,
    current_atr: float,
) -> ScalePositionState:
    """Move stop to entry ± (ATR * breakeven_atr_offset).

    Fires when:
    - breakeven_trigger_level is set and levels_filled >= breakeven_trigger_level
    - stop has not already passed the target breakeven price (directional guard)

    offset > 0 → stop above entry (profit buffer)
    offset = 0 → exact breakeven
    offset < 0 → stop below entry (accept small loss)
    """
    trigger = state.breakeven_trigger_level
    if trigger is None:
        return state

    if state.levels_filled < trigger:
        return state

    offset = current_atr * state.breakeven_atr_offset
    if state.is_long:
        new_stop = state.entry_price + offset
        if state.current_stop_price >= new_stop:
            return state  # already at or past target
    else:
        new_stop = state.entry_price - offset
        if state.current_stop_price <= new_stop:
            return state

    result = replace_order(
        config,
        state.stop_order_id,
        qty=state.remaining_qty,
        stop_price=round(new_stop, 4),
    )
    if result.get("error"):
        logger.error(
            "scale_out: replace_order failed for breakeven stop symbol=%s: %s",
            state.symbol, result["error"],
        )
        state.errors.append(f"breakeven stop replace failed: {result['error']}")
        return state

    logger.info(
        "scale_out: stop moved to breakeven=%.4f (entry=%.4f offset=%.4f symbol=%s)",
        new_stop, state.entry_price, offset, state.symbol,
    )
    return ScalePositionState(
        **{**state.__dict__, "current_stop_price": new_stop}
    )


async def handle_scale_fill(
    config: AlpacaClientConfig,
    state: ScalePositionState,
    filled_level_idx: int,
    current_atr: float,
) -> ScalePositionState:
    """Called when a scale-out TP level fills.

    Steps:
    1. Compute remaining_qty after this fill
    2. Decrement open_exit_order_count
    3. Move stop to next target_array position (resize + reprice)
    4. If the breakeven trigger level is reached, move to breakeven

    The caller must update stop_order_id separately if the OCO leg IDs change.
    """
    levels = state.scale_out_levels
    if filled_level_idx >= len(levels):
        logger.warning(
            "scale_out: handle_scale_fill called with invalid level_idx=%d for symbol=%s",
            filled_level_idx, state.symbol,
        )
        return state

    level = levels[filled_level_idx]
    exit_pct = float(level.get("pct") or 0) / 100.0
    exited_qty = round(state.original_qty * exit_pct, 6)
    new_remaining = max(0.0, round(state.remaining_qty - exited_qty, 6))
    new_open_count = max(0, state.open_exit_order_count - 1)
    new_levels_filled = state.levels_filled + 1

    updated = ScalePositionState(
        **{
            **state.__dict__,
            "remaining_qty": new_remaining,
            "open_exit_order_count": new_open_count,
            "levels_filled": new_levels_filled,
        }
    )

    logger.info(
        "scale_out: level %d filled — exited=%.4f remaining=%.4f open_exits=%d (symbol=%s)",
        filled_level_idx, exited_qty, new_remaining, new_open_count, state.symbol,
    )

    if new_remaining <= 0:
        return updated

    # Move stop to next target_array position
    updated = update_target_array_stop(config, updated, current_atr)

    # Move to breakeven if triggered
    updated = move_to_break_even(config, updated, current_atr)

    return updated


def manual_scale_exit(
    config: AlpacaClientConfig,
    state: ScalePositionState,
    exit_pct: float,
) -> dict[str, Any]:
    """Manually exit a percentage of the remaining position.

    Calls Alpaca close_position for partial qty. Does NOT update the stop leg —
    caller must call replace_order after to resize the stop for new remaining_qty.
    """
    qty_to_exit = round(state.remaining_qty * (exit_pct / 100.0), 6)
    if qty_to_exit <= 0:
        return {"error": "Exit qty would be zero — check remaining_qty and exit_pct"}

    result = close_position(
        config,
        AlpacaClosePositionRequest(symbol=state.symbol, qty=qty_to_exit),
    )
    if result.get("error"):
        logger.error(
            "scale_out: manual_scale_exit failed for symbol=%s: %s",
            state.symbol, result["error"],
        )
    else:
        logger.info(
            "scale_out: manual exit %.1f%% of position — qty=%.4f (symbol=%s)",
            exit_pct, qty_to_exit, state.symbol,
        )
    return result


def manual_move_stop_to_breakeven(
    config: AlpacaClientConfig,
    state: ScalePositionState,
    current_atr: float,
) -> dict[str, Any]:
    """Manually move stop to breakeven regardless of scale-level trigger.

    Used by the UI "Move Stop to Breakeven" button.
    Returns replace_order result dict.
    """
    offset = current_atr * state.breakeven_atr_offset
    if state.is_long:
        new_stop = round(state.entry_price + offset, 4)
    else:
        new_stop = round(state.entry_price - offset, 4)

    result = replace_order(
        config,
        state.stop_order_id,
        qty=state.remaining_qty,
        stop_price=new_stop,
    )
    if not result.get("error"):
        logger.info(
            "scale_out: manual BE move → new_stop=%.4f (symbol=%s)",
            new_stop, state.symbol,
        )
    return result


def manual_replace_stop(
    config: AlpacaClientConfig,
    state: ScalePositionState,
    new_stop_price: float,
) -> dict[str, Any]:
    """Manually set a specific stop price. Used by the UI stop update input."""
    result = replace_order(
        config,
        state.stop_order_id,
        qty=state.remaining_qty,
        stop_price=round(new_stop_price, 4),
    )
    if not result.get("error"):
        logger.info(
            "scale_out: manual stop replace → new_stop=%.4f (symbol=%s)",
            new_stop_price, state.symbol,
        )
    return result
