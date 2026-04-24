"""
Account Governor Loop — execution engine for governor-managed program allocations.

Architecture
------------
One background asyncio task drives all active AccountGovernors.
Each governor manages multiple AccountAllocations (TradingPrograms on an account).

Per governor tick (every base_interval_seconds):
  1. Check governor halt state
  2. Refresh correlation guard if stale
  3. Refresh live-feed universes for programs due per duration_mode
  4. Evaluate entry/exit signals per allocation
  5. Collision check (first_wins or aggregate)
  6. Correlation guard check
  7. RiskProfile check
  8. Submit approved orders (via paper broker fill simulation)
  9. Daily loss / drawdown → halt governor if breached

Only processes Deployment rows where governor_status IS NOT NULL.
Legacy Deployment rows (governor_status IS NULL) continue via paper_broker.py.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd
from sqlalchemy import select, func as sql_func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.account import Account
from app.models.deployment import Deployment
from app.models.deployment_trade import DeploymentTrade
from app.models.governor_event import GovernorEvent
from app.models.strategy import StrategyVersion
from app.models.trading_program import AccountAllocation, TradingProgram
from app.models.risk_profile import RiskProfile
from app.models.symbol_universe import SymbolUniverseSnapshot
from app.services.conflict_resolver import get_conflict_registry

logger = logging.getLogger(__name__)

GOVERNOR_POLL_INTERVAL_SECONDS = 60

# ET timezone offset — approximation (UTC-5 EST / UTC-4 EDT).
# We rely on market hours check rather than exact DST conversion.
_ET_UTC_OFFSET_HOURS = -4  # EDT; acceptable approximation for hour-of-day checks


# ── In-memory per-governor state ──────────────────────────────────────────────

@dataclass
class _AllocState:
    """Lightweight runtime state for one allocation within a governor."""
    alloc_id: str
    # symbol → open DeploymentTrade id
    open_trade_ids: dict[str, str] = field(default_factory=dict)
    # symbol → last bar timestamp processed
    last_bar_ts: dict[str, pd.Timestamp] = field(default_factory=dict)


@dataclass
class _GovState:
    """Per-governor runtime state kept in memory between polls."""
    governor_id: str
    # allocation_id → _AllocState
    alloc_states: dict[str, _AllocState] = field(default_factory=dict)
    # allocation_id → last resolved universe timestamp (for live_feed refresh tracking)
    last_universe_refresh: dict[str, datetime | None] = field(default_factory=dict)


_gov_states: dict[str, _GovState] = {}


# ── Time helpers ───────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _et_hour_minute(utc_now: datetime) -> tuple[int, int]:
    """Return approximate (hour, minute) in US Eastern time."""
    et = utc_now + timedelta(hours=_ET_UTC_OFFSET_HOURS)
    return et.hour, et.minute


def _is_market_hours(utc_now: datetime) -> bool:
    """Rough check: NYSE regular session 09:30–16:00 ET."""
    h, m = _et_hour_minute(utc_now)
    start = 9 * 60 + 30
    end = 16 * 60 + 0
    return start <= h * 60 + m < end


def _universe_refresh_due(
    program: TradingProgram,
    last_refresh: datetime | None,
    utc_now: datetime,
) -> bool:
    """Determine whether a live_feed universe refresh is due."""
    if program.universe_mode != "live_feed":
        return False

    # Programme-level override (seconds)
    if program.universe_poll_override_seconds is not None:
        interval = program.universe_poll_override_seconds
        if last_refresh is None:
            return True
        return (utc_now - last_refresh).total_seconds() >= interval

    mode = program.duration_mode
    h, m = _et_hour_minute(utc_now)
    hm = h * 60 + m  # minutes since midnight ET

    if mode == "intraday":
        # Every 5 min during market hours
        if not _is_market_hours(utc_now):
            return False
        if last_refresh is None:
            return True
        return (utc_now - last_refresh).total_seconds() >= 300

    elif mode == "day":
        # At 08:30 and 09:30 ET
        targets = [8 * 60 + 30, 9 * 60 + 30]
        if last_refresh is None:
            return True
        # Due if we've passed a target since last refresh
        last_et = last_refresh + timedelta(hours=_ET_UTC_OFFSET_HOURS)
        last_hm = last_et.hour * 60 + last_et.minute
        for t in targets:
            if last_hm < t <= hm:
                return True
        return False

    elif mode == "swing":
        # At 16:30 ET and 08:30 ET
        targets = [16 * 60 + 30, 8 * 60 + 30]
        if last_refresh is None:
            return True
        last_et = last_refresh + timedelta(hours=_ET_UTC_OFFSET_HOURS)
        last_hm = last_et.hour * 60 + last_et.minute
        for t in targets:
            if last_hm < t <= hm:
                return True
        return False

    # Default: refresh if never refreshed
    return last_refresh is None


# ── Universe resolution ────────────────────────────────────────────────────────

async def _refresh_live_universe(
    db: AsyncSession,
    governor: Deployment,
    program: TradingProgram,
) -> list[str]:
    """
    Resolve live_feed universe from subscribed watchlists.
    Updates program.live_universe_resolved_symbols and live_universe_resolved_at in-place.
    Emits a universe_updated GovernorEvent.
    Returns the resolved symbol list.
    """
    from app.services.watchlist_service import get_watchlist

    subscription_ids: list[str] = program.watchlist_subscriptions or []
    if not subscription_ids:
        logger.debug(
            "AccountGovernorLoop: governor=%s program=%s has no watchlist subscriptions",
            governor.id[:8], program.id[:8],
        )
        return program.live_universe_resolved_symbols or []

    rule = (program.watchlist_combination_rule or "union").lower()
    symbol_sets: list[set[str]] = []

    for wl_id in subscription_ids:
        try:
            wl = await get_watchlist(db, wl_id)
            if wl is None:
                logger.warning(
                    "AccountGovernorLoop: governor=%s watchlist %s not found",
                    governor.id[:8], wl_id,
                )
                continue
            active_syms = {
                m.symbol.upper()
                for m in wl.memberships
                if m.state == "active"
            }
            symbol_sets.append(active_syms)
        except Exception as exc:
            logger.warning(
                "AccountGovernorLoop: governor=%s watchlist %s load error: %s",
                governor.id[:8], wl_id, exc,
            )

    if not symbol_sets:
        return program.live_universe_resolved_symbols or []

    if rule == "union":
        resolved: set[str] = set().union(*symbol_sets)
    elif rule == "intersection":
        resolved = symbol_sets[0].copy()
        for s in symbol_sets[1:]:
            resolved &= s
    elif rule == "primary_only":
        resolved = symbol_sets[0]
    else:
        resolved = set().union(*symbol_sets)

    # Apply deny list
    deny = {s.upper() for s in (program.live_universe_deny_list or [])}
    resolved -= deny

    # Apply top_n limit (alphabetical for determinism)
    symbols_list = sorted(resolved)
    if program.live_universe_top_n and len(symbols_list) > program.live_universe_top_n:
        symbols_list = symbols_list[: program.live_universe_top_n]

    program.live_universe_resolved_symbols = symbols_list
    program.live_universe_resolved_at = _utcnow()

    # Emit event
    ev = GovernorEvent(
        id=str(uuid.uuid4()),
        governor_id=governor.id,
        event_type="universe_updated",
        detail={
            "program_id": program.id,
            "rule": rule,
            "symbol_count": len(symbols_list),
            "watchlist_count": len(symbol_sets),
        },
    )
    db.add(ev)

    logger.info(
        "AccountGovernorLoop: governor=%s program=%s universe refreshed — %d symbols",
        governor.id[:8], program.id[:8], len(symbols_list),
    )
    return symbols_list


# ── Bar data helpers (mirrors paper_broker.py) ─────────────────────────────────

def _load_bars(symbol: str, timeframe: str) -> pd.DataFrame | None:
    """Load cached bars from parquet. Returns None if not cached."""
    from app.config import get_settings
    settings = get_settings()
    cache_file = settings.CACHE_DIR / f"{symbol}_{timeframe}.parquet"
    if not cache_file.exists():
        return None
    try:
        df = pd.read_parquet(str(cache_file))
        if df.empty:
            return None
        df.index = pd.to_datetime(df.index)
        return df
    except Exception as exc:
        logger.warning(
            "AccountGovernorLoop: failed to read cache for %s/%s: %s", symbol, timeframe, exc
        )
        return None


def _build_indicators(df: pd.DataFrame, strategy_config: dict) -> pd.DataFrame:
    """Compute indicators via BacktestEngine (mirrors paper_broker.py pattern)."""
    from app.core.backtest import BacktestEngine
    engine = BacktestEngine(strategy_config, {})
    return engine._compute_indicators(df)


# ── RiskProfile check ──────────────────────────────────────────────────────────

def _check_risk_profile(
    risk_profile: RiskProfile | None,
    account_equity: float,
    direction: str,
    open_long_count: int,
    open_short_count: int,
    portfolio_heat: float,
    proposed_position_value: float,
) -> tuple[bool, str]:
    """
    Returns (allowed, reason).
    Falls back to conservative defaults when risk_profile is None.
    """
    if risk_profile is None:
        # Conservative inline defaults when no profile is attached
        max_positions = 5 if direction == "long" else 3
        max_heat = 0.06 if direction == "long" else 0.04
    else:
        max_positions = (
            risk_profile.max_open_positions_long
            if direction == "long"
            else risk_profile.max_open_positions_short
        )
        max_heat = (
            risk_profile.max_portfolio_heat_long
            if direction == "long"
            else risk_profile.max_portfolio_heat_short
        )

    current_count = open_long_count if direction == "long" else open_short_count
    if current_count >= max_positions:
        return False, f"risk_blocked: max_{direction}_positions={max_positions} reached ({current_count})"

    new_heat = portfolio_heat + (proposed_position_value / account_equity if account_equity > 0 else 0)
    if new_heat > max_heat:
        return False, f"risk_blocked: portfolio_heat={new_heat:.3f} would exceed max_{direction}_heat={max_heat}"

    return True, "ok"


# ── Daily loss check ───────────────────────────────────────────────────────────

async def _check_daily_loss(
    db: AsyncSession,
    governor: Deployment,
    account_equity: float,
    risk_profile: RiskProfile | None,
) -> bool:
    """
    Returns True if daily loss limit is breached (governor should be halted).
    Uses risk_profile.max_daily_loss_pct if available, else account inline limit.
    """
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)

    result = await db.execute(
        select(sql_func.sum(DeploymentTrade.net_pnl)).where(
            DeploymentTrade.deployment_id == governor.id,
            DeploymentTrade.is_open == False,
            DeploymentTrade.exit_time >= today_start,
        )
    )
    daily_loss = -(result.scalar() or 0.0)  # positive means loss

    if risk_profile is not None:
        max_loss_pct = risk_profile.max_daily_loss_pct
    else:
        # Fall back to account inline limit
        account = governor.account
        max_loss_pct = float(account.max_daily_loss_pct) if account else 0.03

    max_loss_usd = max_loss_pct * account_equity
    if daily_loss >= max_loss_usd > 0:
        logger.warning(
            "AccountGovernorLoop: governor=%s daily_loss=%.2f >= limit=%.2f — halting",
            governor.id[:8], daily_loss, max_loss_usd,
        )
        return True

    return False


# ── Governor halt helper ───────────────────────────────────────────────────────

async def _halt_governor(
    db: AsyncSession,
    governor: Deployment,
    trigger: str,
) -> None:
    """Mark a governor as halted and emit a halt_triggered event."""
    governor.governor_status = "halted"
    governor.halt_trigger = trigger
    governor.halt_at = _utcnow()
    governor.daily_loss_lockout_triggered = True

    ev = GovernorEvent(
        id=str(uuid.uuid4()),
        governor_id=governor.id,
        event_type="halt_triggered",
        detail={"trigger": trigger},
    )
    db.add(ev)
    logger.warning(
        "AccountGovernorLoop: governor=%s halted — trigger=%s", governor.id[:8], trigger
    )


# ── Core allocation processor ──────────────────────────────────────────────────

async def _process_allocation(
    db: AsyncSession,
    governor: Deployment,
    allocation: AccountAllocation,
    program: TradingProgram,
    symbols: list[str],
    risk_profile: RiskProfile | None,
    account_equity: float,
    alpaca_config: "AlpacaClientConfig | None" = None,
) -> None:
    """
    Evaluate entry/exit signals for one allocation and submit approved orders.
    Mirrors the per-symbol loop from paper_broker.py._process_deployment().
    """
    from app.strategies.conditions import EvalContext, evaluate_conditions
    from app.strategies.stops import calculate_stop, calculate_target
    from app.strategies.sizing import calculate_position_size, _rolling_kelly
    from app.indicators.regime import classify_regime

    if not allocation.trading_program or not allocation.trading_program.strategy_version_id:
        logger.debug(
            "AccountGovernorLoop: allocation=%s has no strategy_version_id, skipping",
            allocation.id[:8],
        )
        return

    sv = await db.get(StrategyVersion, program.strategy_version_id)
    if sv is None:
        logger.warning(
            "AccountGovernorLoop: allocation=%s missing StrategyVersion %s",
            allocation.id[:8], program.strategy_version_id,
        )
        return

    config = sv.config
    alloc_state = _gov_states[governor.id].alloc_states.setdefault(
        allocation.id, _AllocState(alloc_id=allocation.id)
    )

    overrides = {}
    timeframe = (overrides.get("timeframe") or config.get("timeframe", "1d"))

    # Extract execution style config
    es = program.execution_style if hasattr(program, "execution_style") else None
    es_config: dict = {}
    if es is not None:
        es_config = {
            "bracket_mode": es.bracket_mode,
            "scale_out": es.scale_out or [],
            "stop_progression_targets": es.stop_progression_targets or [],
            "final_runner_exit_mode": es.final_runner_exit_mode or "internal",
            "final_runner_trail_type": es.final_runner_trail_type,
            "final_runner_trail_value": es.final_runner_trail_value,
            "final_runner_time_in_force": es.final_runner_time_in_force or "gtc",
            "atr_source": es.atr_source or "strategy",
            "atr_length": es.atr_length,
            "atr_timeframe": es.atr_timeframe,
            "breakeven_trigger_level": es.breakeven_trigger_level,
            "breakeven_atr_offset": es.breakeven_atr_offset or 0.0,
        }

    # Load open trades for this deployment (governor is the Deployment row)
    open_result = await db.execute(
        select(DeploymentTrade).where(
            DeploymentTrade.deployment_id == governor.id,
            DeploymentTrade.is_open == True,
        )
    )
    open_trades_db: dict[str, DeploymentTrade] = {t.symbol: t for t in open_result.scalars().all()}

    # Load closed trades for rolling Kelly
    closed_result = await db.execute(
        select(DeploymentTrade).where(
            DeploymentTrade.deployment_id == governor.id,
            DeploymentTrade.is_open == False,
        )
    )
    closed_trades = [
        {"net_pnl": t.net_pnl, "r_multiple": t.r_multiple, "initial_risk": t.initial_risk}
        for t in closed_result.scalars().all()
    ]

    exit_config = config.get("exit", {})
    entry_config = config.get("entry", {})
    stop_config = config.get("stop_loss", {"method": "fixed_pct", "value": 2.0})
    sizing_config = config.get("position_sizing", {"method": "risk_pct", "risk_pct": 1.0})

    # Apply allocation scale to position sizing
    scale = allocation.position_size_scale_pct
    if scale and scale != 1.0:
        sizing_config = dict(sizing_config)
        for key in ("risk_pct", "fixed_pct"):
            if key in sizing_config:
                sizing_config[key] = sizing_config[key] * scale

    # Count open positions for risk profile checks
    open_long_count = sum(1 for t in open_trades_db.values() if t.direction == "long")
    open_short_count = sum(1 for t in open_trades_db.values() if t.direction == "short")
    portfolio_heat = sum(
        abs(t.initial_risk or 0.0) / account_equity
        for t in open_trades_db.values()
        if account_equity > 0
    )

    # Conflict registry for this account
    registry = get_conflict_registry()
    resolver = registry.get_or_create(governor.account_id)
    resolver.register_allocation(allocation.id, allocation.conflict_resolution)

    # Collect per-indicator alternate timeframe requirements from strategy conditions
    _alt_tf_refs: dict[str, set[str]] = {}

    def _walk_for_tf_gov(node: object) -> None:
        if isinstance(node, dict):
            if "indicator" in node and "timeframe" in node and node.get("timeframe"):
                _alt_tf_refs.setdefault(node["timeframe"], set()).add(node["indicator"])
            for v in node.values():
                _walk_for_tf_gov(v)
        elif isinstance(node, list):
            for item in node:
                _walk_for_tf_gov(item)

    _walk_for_tf_gov(config)

    # Load cached bars for each required alternate timeframe
    alt_tf_bars_gov: dict[str, dict[str, pd.DataFrame]] = {}
    for alt_tf in _alt_tf_refs:
        if alt_tf == timeframe:
            continue
        for sym in symbols:
            raw = _load_bars(sym, alt_tf)
            if raw is not None:
                try:
                    computed = _build_indicators(raw, config)
                    alt_tf_bars_gov.setdefault(sym, {})[alt_tf] = computed
                except Exception:
                    pass

    for symbol in symbols:
        df = _load_bars(symbol, timeframe)
        if df is None or len(df) < 30:
            logger.debug(
                "AccountGovernorLoop: no/insufficient cached data for %s/%s", symbol, timeframe
            )
            continue

        try:
            idf = _build_indicators(df, config)
        except Exception as exc:
            logger.warning(
                "AccountGovernorLoop: indicator build failed for %s: %s", symbol, exc
            )
            continue

        bar_index = len(idf) - 1
        bar = idf.iloc[bar_index]
        current_ts = pd.Timestamp(idf.index[bar_index])

        # Skip if already processed this bar
        if alloc_state.last_bar_ts.get(symbol) == current_ts:
            continue

        price = float(bar.get("close", 0))
        if price <= 0:
            continue

        regime_series = classify_regime(df)
        current_regime = str(regime_series.iloc[-1]) if not regime_series.empty else "unknown"

        open_trade = open_trades_db.get(symbol)
        has_position = open_trade is not None
        position_size = float(open_trade.quantity) if open_trade else 0.0

        # Build alternate-TF bar slices with completed-bar-only filter
        extra_bars_gov: dict[str, pd.DataFrame] = {}
        extra_bar_idx_gov: dict[str, int] = {}
        for alt_tf, alt_df in alt_tf_bars_gov.get(symbol, {}).items():
            completed = alt_df[alt_df.index <= current_ts]
            if len(completed) > 0:
                extra_bars_gov[alt_tf] = completed
                extra_bar_idx_gov[alt_tf] = len(completed) - 1

        ctx = EvalContext(
            bar=bar,
            bar_index=bar_index,
            df=idf,
            position_size=position_size,
            account_equity=account_equity,
            regime=current_regime,
            fvgs=[],
            sr_zones=[],
            swing_highs=[],
            swing_lows=[],
            extra_bars=extra_bars_gov,
            extra_bar_index=extra_bar_idx_gov,
        )

        # ── EXIT processing ──────────────────────────────────────────────────
        if open_trade:
            exit_triggered = False
            exit_reason = None
            exit_price = price

            # ── Scale-out level simulation ───────────────────────────────────
            scale_levels = es_config.get("scale_out") or []
            if scale_levels and open_trade.is_open:
                meta = dict(open_trade.metadata_ or {})
                levels_filled: int = meta.get("levels_filled", 0)
                if levels_filled < len(scale_levels):
                    next_level = scale_levels[levels_filled]
                    # Each scale level defines a target price (r_multiple or fixed)
                    tp_configs = config.get("targets", [])
                    target_cfg = (
                        tp_configs[levels_filled]
                        if isinstance(tp_configs, list) and levels_filled < len(tp_configs)
                        else {"method": "r_multiple", "r": next_level.get("r", 2.0)}
                        if isinstance(next_level, dict)
                        else {"method": "r_multiple", "r": float(next_level)}
                    )
                    try:
                        tp_price = calculate_target(
                            target_cfg, open_trade.entry_price,
                            open_trade.current_stop or open_trade.initial_stop,
                            open_trade.direction, bar, idf, bar_index,
                        )
                    except Exception:
                        tp_price = None

                    if tp_price is not None:
                        crossed = (
                            open_trade.direction == "long"
                            and float(bar.get("high", price)) >= tp_price
                        ) or (
                            open_trade.direction == "short"
                            and float(bar.get("low", price)) <= tp_price
                        )
                        if crossed:
                            scale_qty = (
                                open_trade.quantity
                                * (next_level.get("pct", 0.5) if isinstance(next_level, dict) else 0.5)
                            )
                            if scale_qty > 0:
                                partial_pnl = (tp_price - open_trade.entry_price) * scale_qty
                                if open_trade.direction == "short":
                                    partial_pnl = -partial_pnl
                                open_trade.quantity = max(0.0, open_trade.quantity - scale_qty)
                                levels_filled += 1
                                meta["levels_filled"] = levels_filled
                                open_trade.metadata_ = meta
                                logger.info(
                                    "AccountGovernorLoop: scale level %d filled governor=%s %s %s "
                                    "@ %.2f qty=%.2f partial_pnl=%.2f remaining=%.2f",
                                    levels_filled, governor.id[:8], symbol, open_trade.direction,
                                    tp_price, scale_qty, partial_pnl, open_trade.quantity,
                                )

                                # Move stop via target array (broker stop guard applies)
                                if (
                                    alpaca_config
                                    and open_trade.stop_control != "broker"
                                    and open_trade.alpaca_stop_order_id
                                    and es_config.get("stop_progression_targets")
                                ):
                                    from app.services.scale_out_service import (
                                        ScalePositionState,
                                        update_target_array_stop,
                                    )
                                    current_atr = float(bar.get("atr_14", bar.get("atr", 0.0)) or 0.0)
                                    if current_atr > 0:
                                        sps = ScalePositionState(
                                            symbol=symbol,
                                            side=open_trade.direction,
                                            entry_price=open_trade.entry_price,
                                            original_qty=float(open_trade.initial_risk or open_trade.quantity),
                                            remaining_qty=open_trade.quantity,
                                            current_stop_price=open_trade.current_stop or open_trade.initial_stop or 0.0,
                                            stop_order_id=open_trade.alpaca_stop_order_id or "",
                                            open_exit_order_count=len(scale_levels) - levels_filled,
                                            levels_filled=levels_filled,
                                            execution_style=es_config,
                                            deployment_id=governor.id,
                                            program_name=program.name,
                                        )
                                        try:
                                            sps = update_target_array_stop(alpaca_config, sps, current_atr)
                                            open_trade.current_stop = sps.current_stop_price
                                        except Exception as exc_sps:
                                            logger.warning(
                                                "AccountGovernorLoop: target_array stop update failed %s: %s",
                                                symbol, exc_sps,
                                            )

                                # Final runner: submit Alpaca trailing stop
                                if (
                                    levels_filled >= len(scale_levels)
                                    and es_config.get("final_runner_exit_mode") == "alpaca_trailing"
                                    and alpaca_config
                                    and open_trade.quantity > 0
                                ):
                                    from app.services.alpaca_service import (
                                        place_trailing_stop_order,
                                        build_program_client_order_id,
                                    )
                                    trail_type = es_config.get("final_runner_trail_type") or "percent"
                                    trail_value = es_config.get("final_runner_trail_value") or 2.0
                                    tif = es_config.get("final_runner_time_in_force") or "gtc"
                                    ts_side = "sell" if open_trade.direction == "long" else "buy"
                                    ts_coid = build_program_client_order_id(
                                        program_name=program.name,
                                        deployment_id=governor.id,
                                        intent="sl",
                                    )
                                    try:
                                        ts_result = await asyncio.get_event_loop().run_in_executor(
                                            None,
                                            lambda: place_trailing_stop_order(
                                                alpaca_config,
                                                symbol,
                                                open_trade.quantity,
                                                ts_side,
                                                trail_percent=trail_value if trail_type == "percent" else None,
                                                trail_price=trail_value if trail_type == "price" else None,
                                                time_in_force=tif,
                                                client_order_id=ts_coid,
                                                program_name=program.name,
                                                deployment_id=governor.id,
                                            ),
                                        )
                                        if not ts_result.get("error"):
                                            open_trade.alpaca_stop_order_id = ts_result.get("id")
                                            open_trade.stop_control = "broker"
                                            logger.info(
                                                "AccountGovernorLoop: final runner trailing stop submitted "
                                                "governor=%s %s trail_%s=%.2f order_id=%s",
                                                governor.id[:8], symbol, trail_type, trail_value,
                                                ts_result.get("id"),
                                            )
                                        else:
                                            logger.warning(
                                                "AccountGovernorLoop: trailing stop failed %s: %s",
                                                symbol, ts_result["error"],
                                            )
                                    except Exception as exc_ts:
                                        logger.warning(
                                            "AccountGovernorLoop: trailing stop exception %s: %s",
                                            symbol, exc_ts,
                                        )

            # ── Stop-based exit (only if broker does NOT own the stop) ────────
            if open_trade.current_stop and open_trade.stop_control != "broker":
                if (
                    open_trade.direction == "long"
                    and float(bar.get("low", price)) <= open_trade.current_stop
                ):
                    exit_triggered = True
                    exit_reason = "stop_loss"
                    exit_price = open_trade.current_stop
                elif (
                    open_trade.direction == "short"
                    and float(bar.get("high", price)) >= open_trade.current_stop
                ):
                    exit_triggered = True
                    exit_reason = "stop_loss"
                    exit_price = open_trade.current_stop

            if not exit_triggered:
                exit_conditions = exit_config.get("conditions", [])
                exit_logic = exit_config.get("logic", "any_of")
                if exit_conditions and evaluate_conditions(exit_conditions, ctx, exit_logic):
                    exit_triggered = True
                    exit_reason = "signal_exit"

            if exit_triggered:
                gross_pnl = (exit_price - open_trade.entry_price) * open_trade.quantity
                if open_trade.direction == "short":
                    gross_pnl = -gross_pnl
                commission = open_trade.quantity * 0.005 * 2
                net_pnl = gross_pnl - commission
                r_multiple = (
                    (net_pnl / open_trade.initial_risk)
                    if (open_trade.initial_risk or 0) > 0
                    else None
                )

                open_trade.exit_time = current_ts.to_pydatetime()
                open_trade.exit_price = exit_price
                open_trade.exit_reason = exit_reason
                open_trade.gross_pnl = gross_pnl
                open_trade.commission = commission
                open_trade.net_pnl = net_pnl
                open_trade.r_multiple = r_multiple
                open_trade.is_open = False
                open_trade.current_price = exit_price
                open_trade.unrealized_pnl = 0.0

                resolver.clear_position(allocation.id, symbol)

                logger.info(
                    "AccountGovernorLoop: closed governor=%s alloc=%s %s %s @ %.2f (%s) net_pnl=%.2f",
                    governor.id[:8], allocation.id[:8], symbol,
                    open_trade.direction, exit_price, exit_reason, net_pnl,
                )
                has_position = False
                alloc_state.open_trade_ids.pop(symbol, None)

        # ── ENTRY processing ─────────────────────────────────────────────────
        if not has_position:
            from app.core.kill_switch import get_kill_switch
            ks = get_kill_switch()
            can_open, block_reason = ks.can_open_new_position(
                account_id=governor.account_id,
                deployment_id=governor.id,
            )
            if not can_open:
                logger.debug(
                    "AccountGovernorLoop: entry blocked by kill switch governor=%s symbol=%s reason=%s",
                    governor.id[:8], symbol, block_reason,
                )
                continue

            default_logic = entry_config.get("logic", "any_of")
            directions = entry_config.get("directions", ["long"])

            for direction in directions:
                entry_conditions = entry_config.get(
                    f"{direction}_conditions", entry_config.get("conditions", [])
                )
                entry_logic = entry_config.get(f"{direction}_logic", default_logic)
                if not entry_conditions:
                    continue
                if not evaluate_conditions(entry_conditions, ctx, entry_logic):
                    continue

                # ── Collision check ──────────────────────────────────────────
                side = "buy" if direction == "long" else "sell"
                decision = resolver.check_signal(
                    requesting_allocation_id=allocation.id,
                    symbol=symbol,
                    side=side,
                )
                if decision.suppressed:
                    ev = GovernorEvent(
                        id=str(uuid.uuid4()),
                        governor_id=governor.id,
                        allocation_id=allocation.id,
                        event_type="collision_suppressed",
                        symbol=symbol,
                        detail={
                            "reason": decision.reason,
                            "conflicting_allocations": decision.conflicting_allocations,
                            "policy": decision.policy_applied,
                        },
                    )
                    db.add(ev)
                    logger.info(
                        "AccountGovernorLoop: collision_suppressed governor=%s alloc=%s %s %s",
                        governor.id[:8], allocation.id[:8], symbol, direction,
                    )
                    break

                # ── RiskProfile check ────────────────────────────────────────
                proposed_value = price * 100  # rough placeholder — real sizing below
                allowed, block_reason = _check_risk_profile(
                    risk_profile,
                    account_equity,
                    direction,
                    open_long_count,
                    open_short_count,
                    portfolio_heat,
                    proposed_value,
                )
                if not allowed:
                    ev = GovernorEvent(
                        id=str(uuid.uuid4()),
                        governor_id=governor.id,
                        allocation_id=allocation.id,
                        event_type="risk_blocked",
                        symbol=symbol,
                        detail={"reason": block_reason, "direction": direction},
                    )
                    db.add(ev)
                    logger.info(
                        "AccountGovernorLoop: risk_blocked governor=%s alloc=%s %s %s — %s",
                        governor.id[:8], allocation.id[:8], symbol, direction, block_reason,
                    )
                    break

                # ── Position sizing + stop ───────────────────────────────────
                entry_price = price
                stop_price = calculate_stop(
                    stop_config, entry_price, direction, bar, idf, bar_index,
                    fvgs=[], sr_zones=[], swing_lows=[], swing_highs=[],
                )

                if sizing_config.get("method") == "rolling_kelly":
                    quantity = _rolling_kelly(
                        sizing_config, entry_price, account_equity, 1.0,
                        closed_trades=closed_trades,
                    )
                else:
                    quantity = calculate_position_size(
                        sizing_config, entry_price, stop_price,
                        account_equity, direction, idf, bar_index,
                    )

                if quantity < 1e-6:
                    logger.debug(
                        "AccountGovernorLoop: zero quantity for %s %s, skipping",
                        symbol, direction,
                    )
                    break

                initial_risk = (
                    abs(entry_price - stop_price) * quantity if stop_price else None
                )
                commission = quantity * 0.005

                trade = DeploymentTrade(
                    id=str(uuid.uuid4()),
                    deployment_id=governor.id,
                    strategy_version_id=program.strategy_version_id,
                    symbol=symbol,
                    direction=direction,
                    entry_time=current_ts.to_pydatetime(),
                    entry_price=entry_price,
                    quantity=quantity,
                    initial_stop=stop_price,
                    initial_risk=initial_risk,
                    current_stop=stop_price,
                    current_price=entry_price,
                    unrealized_pnl=0.0,
                    commission=commission,
                    regime_at_entry=current_regime,
                    is_open=True,
                    metadata_={"allocation_id": allocation.id, "program_id": program.id},
                )
                db.add(trade)

                # OCO placement after entry fill (when execution style has scale-out)
                if alpaca_config and es_config.get("scale_out"):
                    tp_configs = config.get("targets", [])
                    first_tp_cfg = (
                        tp_configs[0] if isinstance(tp_configs, list) and tp_configs
                        else {"method": "r_multiple", "r": 2.0}
                    )
                    try:
                        tp_price = calculate_target(
                            first_tp_cfg, entry_price, stop_price,
                            direction, bar, idf, bar_index,
                        )
                    except Exception:
                        tp_price = None

                    if stop_price and tp_price:
                        from app.services.alpaca_service import (
                            place_oco_order,
                            build_program_client_order_id,
                        )
                        oco_side = "sell" if direction == "long" else "buy"
                        oco_coid = build_program_client_order_id(
                            program_name=program.name,
                            deployment_id=governor.id,
                            intent="sl",
                        )
                        try:
                            oco_result = await asyncio.get_event_loop().run_in_executor(
                                None,
                                lambda: place_oco_order(
                                    alpaca_config,
                                    symbol,
                                    quantity,
                                    oco_side,
                                    stop_price=round(stop_price, 2),
                                    take_profit_price=round(tp_price, 2),
                                    time_in_force="gtc",
                                    client_order_id=oco_coid,
                                    program_name=program.name,
                                    deployment_id=governor.id,
                                ),
                            )
                            if not oco_result.get("error"):
                                legs = oco_result.get("legs") or []
                                stop_leg = next(
                                    (lg for lg in legs if lg.get("type") in ("stop", "stop_limit")),
                                    None,
                                )
                                if stop_leg:
                                    trade.alpaca_stop_order_id = stop_leg.get("id")
                                    trade.stop_control = "internal"
                                logger.info(
                                    "AccountGovernorLoop: OCO submitted governor=%s %s %s "
                                    "stop=%.2f tp=%.2f",
                                    governor.id[:8], symbol, direction,
                                    round(stop_price, 2), round(tp_price, 2),
                                )
                            else:
                                logger.warning(
                                    "AccountGovernorLoop: OCO placement failed %s %s: %s",
                                    symbol, direction, oco_result["error"],
                                )
                        except Exception as exc_oco:
                            logger.warning(
                                "AccountGovernorLoop: OCO placement exception %s %s: %s",
                                symbol, direction, exc_oco,
                            )

                # Register position in conflict resolver
                resolver.register_position(allocation.id, symbol, quantity, side)
                alloc_state.open_trade_ids[symbol] = trade.id

                # Update heat counters for subsequent symbols in this tick
                if direction == "long":
                    open_long_count += 1
                else:
                    open_short_count += 1
                portfolio_heat += (initial_risk or 0.0) / account_equity if account_equity > 0 else 0

                logger.info(
                    "AccountGovernorLoop: opened governor=%s alloc=%s %s %s @ %.2f "
                    "qty=%.2f stop=%.2f",
                    governor.id[:8], allocation.id[:8], symbol, direction,
                    entry_price, quantity, stop_price or 0,
                )
                break  # one direction per symbol per bar

        # Update unrealized P&L on open trade
        if has_position and open_trade and open_trade.is_open:
            upnl = (price - open_trade.entry_price) * open_trade.quantity
            if open_trade.direction == "short":
                upnl = -upnl
            open_trade.current_price = price
            open_trade.unrealized_pnl = upnl

        alloc_state.last_bar_ts[symbol] = current_ts

    await db.flush()


# ── Per-governor tick ──────────────────────────────────────────────────────────

async def _process_governor(db: AsyncSession, governor: Deployment) -> None:
    """Drive one complete tick for a single AccountGovernor."""

    # Ensure in-memory state exists
    if governor.id not in _gov_states:
        _gov_states[governor.id] = _GovState(governor_id=governor.id)
    gov_state = _gov_states[governor.id]

    # ── Load account ─────────────────────────────────────────────────────────
    account = await db.get(Account, governor.account_id)
    account_equity = float(account.equity or account.current_balance or 100_000.0) if account else 100_000.0

    # ── Load risk profile ────────────────────────────────────────────────────
    risk_profile: RiskProfile | None = None
    if governor.risk_profile_id:
        risk_profile = await db.get(RiskProfile, governor.risk_profile_id)
    if risk_profile is None and account and getattr(account, "risk_profile_id", None):
        risk_profile = await db.get(RiskProfile, account.risk_profile_id)

    # ── Load allocations (with execution_style) ──────────────────────────────
    alloc_result = await db.execute(
        select(AccountAllocation)
        .options(
            selectinload(AccountAllocation.trading_program).selectinload(
                TradingProgram.execution_style
            )
        )
        .where(
            AccountAllocation.account_id == governor.account_id,
            AccountAllocation.status.in_(["paper", "promoted_to_live"]),
        )
    )
    allocations: list[AccountAllocation] = alloc_result.scalars().all()

    # ── Resolve Alpaca credentials from account broker config ────────────────
    alpaca_config: "AlpacaClientConfig | None" = None
    if account:
        broker_cfg = account.broker_config or {}
        gov_mode = governor.mode if hasattr(governor, "mode") else None
        # Prefer governor mode; fall back to first available mode key
        if gov_mode in broker_cfg:
            mode_cfg = broker_cfg[gov_mode]
        elif "paper" in broker_cfg:
            mode_cfg = broker_cfg["paper"]
            gov_mode = "paper"
        elif "live" in broker_cfg:
            mode_cfg = broker_cfg["live"]
            gov_mode = "live"
        else:
            mode_cfg = {}
        api_key = mode_cfg.get("api_key", "")
        secret_key = mode_cfg.get("secret_key", "")
        base_url = mode_cfg.get(
            "base_url",
            "https://paper-api.alpaca.markets" if gov_mode != "live" else "https://api.alpaca.markets",
        )
        if api_key and secret_key:
            from app.services.alpaca_service import AlpacaClientConfig
            alpaca_config = AlpacaClientConfig(
                api_key=api_key,
                secret_key=secret_key,
                mode=gov_mode or "paper",
                base_url=base_url,
            )

    if not allocations:
        logger.debug(
            "AccountGovernorLoop: governor=%s has no active allocations", governor.id[:8]
        )
        governor.last_governor_tick_at = _utcnow()
        return

    utc_now = _utcnow()

    for allocation in allocations:
        program = allocation.trading_program
        if program is None:
            logger.warning(
                "AccountGovernorLoop: allocation=%s has no TradingProgram, skipping",
                allocation.id[:8],
            )
            continue

        # ── Universe resolution ──────────────────────────────────────────────
        if program.universe_mode == "live_feed":
            last_refresh = gov_state.last_universe_refresh.get(allocation.id)
            if _universe_refresh_due(program, last_refresh, utc_now):
                try:
                    await _refresh_live_universe(db, governor, program)
                    gov_state.last_universe_refresh[allocation.id] = utc_now
                except Exception as exc:
                    logger.warning(
                        "AccountGovernorLoop: governor=%s universe refresh error for "
                        "program=%s: %s",
                        governor.id[:8], program.id[:8], exc,
                    )
            symbols = list(program.live_universe_resolved_symbols or [])

        else:  # snapshot mode
            if program.symbol_universe_snapshot_id:
                snap = await db.get(SymbolUniverseSnapshot, program.symbol_universe_snapshot_id)
                symbols = list(snap.resolved_symbols or []) if snap else []
            else:
                symbols = []

        if not symbols:
            logger.debug(
                "AccountGovernorLoop: governor=%s alloc=%s has empty universe",
                governor.id[:8], allocation.id[:8],
            )
            continue

        # ── Signal evaluation + order submission ─────────────────────────────
        try:
            await _process_allocation(
                db, governor, allocation, program, symbols, risk_profile, account_equity,
                alpaca_config=alpaca_config,
            )
        except Exception as exc:
            logger.exception(
                "AccountGovernorLoop: error processing allocation=%s: %s",
                allocation.id[:8], exc,
            )

    # ── Daily loss check ─────────────────────────────────────────────────────
    if not governor.daily_loss_lockout_triggered:
        try:
            breached = await _check_daily_loss(db, governor, account_equity, risk_profile)
            if breached:
                await _halt_governor(db, governor, "daily_loss_limit")
        except Exception as exc:
            logger.warning(
                "AccountGovernorLoop: governor=%s daily loss check error: %s",
                governor.id[:8], exc,
            )

    # ── Live price refresh (same pattern as paper_broker.py) ────────────────
    open_result2 = await db.execute(
        select(DeploymentTrade).where(
            DeploymentTrade.deployment_id == governor.id,
            DeploymentTrade.is_open == True,
        )
    )
    open_now = open_result2.scalars().all()
    if open_now and account:
        broker_config = account.broker_config or {}
        mode_cfg = broker_config.get("paper") or broker_config.get("live") or {}
        api_key = mode_cfg.get("api_key", "")
        secret_key = mode_cfg.get("secret_key", "")
        if api_key and secret_key:
            from app.services.alpaca_service import get_latest_prices
            syms = list({t.symbol for t in open_now})
            try:
                live_prices = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: get_latest_prices(syms, api_key, secret_key)
                )
                for trade in open_now:
                    lp = live_prices.get(trade.symbol)
                    if lp and lp > 0:
                        upnl = (lp - trade.entry_price) * trade.quantity
                        if trade.direction == "short":
                            upnl = -upnl
                        trade.current_price = lp
                        trade.unrealized_pnl = upnl
                        logger.debug(
                            "AccountGovernorLoop: live price %s=%.2f upnl=%.2f",
                            trade.symbol, lp, upnl,
                        )
            except Exception as exc:
                logger.warning(
                    "AccountGovernorLoop: governor=%s live price refresh error: %s",
                    governor.id[:8], exc,
                )

    await db.flush()
    governor.last_governor_tick_at = _utcnow()


# ── Main loop ──────────────────────────────────────────────────────────────────

async def _run_governor_cycle() -> None:
    """One poll cycle across all active governors."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Deployment)
            .where(
                Deployment.governor_status.is_not(None),
                Deployment.governor_status != "halted",
            )
        )
        governors = result.scalars().all()

        for governor in governors:
            try:
                await _process_governor(db, governor)
            except Exception as exc:
                logger.exception(
                    "AccountGovernorLoop: error processing governor=%s: %s",
                    governor.id[:8], exc,
                )

        await db.commit()


async def account_governor_loop() -> None:
    """Background loop driving all account governors."""
    logger.info(
        "AccountGovernorLoop: started (poll=%ds)", GOVERNOR_POLL_INTERVAL_SECONDS
    )
    while True:
        try:
            await _run_governor_cycle()
        except asyncio.CancelledError:
            logger.info("AccountGovernorLoop: shutting down.")
            break
        except Exception as exc:
            logger.exception("AccountGovernorLoop: error: %s", exc)
        await asyncio.sleep(GOVERNOR_POLL_INTERVAL_SECONDS)


_loop_task: asyncio.Task | None = None


def start_account_governor_loop() -> None:
    """Start the account governor background task. Call once from app lifespan."""
    global _loop_task
    if _loop_task is None or _loop_task.done():
        _loop_task = asyncio.ensure_future(account_governor_loop())
        logger.info("AccountGovernorLoop: scheduled")


def stop_account_governor_loop() -> None:
    """Cancel the account governor background task on shutdown."""
    global _loop_task
    if _loop_task and not _loop_task.done():
        _loop_task.cancel()
