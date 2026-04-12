"""
Cooldown management.
Tracks cooldown state per symbol and strategy after various events.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal

CooldownTrigger = Literal["loss", "win", "stop_out", "target_hit", "any_exit", "consecutive_loss", "large_gain"]


@dataclass
class CooldownRule:
    trigger: CooldownTrigger
    duration_minutes: int | None = None      # time-based cooldown
    duration_bars: int | None = None         # bar-based cooldown
    session_reset: bool = False              # wait until next session
    consecutive_count: int | None = None     # for consecutive_loss trigger
    symbol_level: bool = True               # per symbol or strategy-wide
    max_loss_pct: float | None = None        # for large_loss trigger threshold


@dataclass
class CooldownState:
    symbol: str
    strategy_id: str
    active: bool = False
    trigger: str | None = None
    triggered_at: datetime | None = None
    expires_at: datetime | None = None
    expires_at_bar: int | None = None
    consecutive_losses: int = 0


class CooldownManager:
    """
    Manages cooldown state for all symbol/strategy combinations.
    Thread-safe for single-process use.
    """

    def __init__(self, rules: list[dict]):
        self.rules: list[CooldownRule] = self._parse_rules(rules)
        # key: (symbol, strategy_id) -> CooldownState
        self._states: dict[tuple[str, str], CooldownState] = {}

    def _parse_rules(self, rules: list[dict]) -> list[CooldownRule]:
        parsed = []
        for r in rules:
            parsed.append(CooldownRule(
                trigger=r.get("trigger", "loss"),
                duration_minutes=r.get("duration_minutes"),
                duration_bars=r.get("duration_bars"),
                session_reset=r.get("session_reset", False),
                consecutive_count=r.get("consecutive_count"),
                symbol_level=r.get("symbol_level", True),
            ))
        return parsed

    def _key(self, symbol: str, strategy_id: str) -> tuple[str, str]:
        return (symbol, strategy_id)

    def _get_state(self, symbol: str, strategy_id: str) -> CooldownState:
        key = self._key(symbol, strategy_id)
        if key not in self._states:
            self._states[key] = CooldownState(symbol=symbol, strategy_id=strategy_id)
        return self._states[key]

    def is_in_cooldown(
        self,
        symbol: str,
        strategy_id: str,
        current_time: datetime,
        current_bar: int,
    ) -> bool:
        state = self._get_state(symbol, strategy_id)
        if not state.active:
            return False

        # Check time expiry
        if state.expires_at is not None and current_time >= state.expires_at:
            state.active = False
            return False

        # Check bar expiry
        if state.expires_at_bar is not None and current_bar >= state.expires_at_bar:
            state.active = False
            return False

        return True

    def on_trade_exit(
        self,
        symbol: str,
        strategy_id: str,
        exit_reason: str,
        pnl: float,
        exit_time: datetime,
        current_bar: int,
        session_end_time: datetime | None = None,
    ) -> None:
        """Call this after every trade exits to update cooldown state."""
        state = self._get_state(symbol, strategy_id)

        # Track consecutive losses
        if pnl < 0:
            state.consecutive_losses += 1
        else:
            state.consecutive_losses = 0

        for rule in self.rules:
            triggered = False

            if rule.trigger == "loss" and pnl < 0:
                triggered = True
            elif rule.trigger == "win" and pnl > 0:
                triggered = True
            elif rule.trigger == "stop_out" and "stop" in exit_reason.lower():
                triggered = True
            elif rule.trigger == "target_hit" and "target" in exit_reason.lower():
                triggered = True
            elif rule.trigger == "any_exit":
                triggered = True
            elif rule.trigger == "consecutive_loss":
                n = rule.consecutive_count or 2
                triggered = state.consecutive_losses >= n

            if triggered:
                state.active = True
                state.trigger = rule.trigger
                state.triggered_at = exit_time

                if rule.duration_minutes:
                    state.expires_at = exit_time + timedelta(minutes=rule.duration_minutes)
                if rule.duration_bars:
                    state.expires_at_bar = current_bar + rule.duration_bars
                if rule.session_reset and session_end_time:
                    # Cooldown until next session
                    state.expires_at = session_end_time
                break  # first matching rule wins

    def reset(self, symbol: str, strategy_id: str) -> None:
        key = self._key(symbol, strategy_id)
        if key in self._states:
            self._states[key].active = False
            self._states[key].consecutive_losses = 0

    def reset_all(self) -> None:
        for state in self._states.values():
            state.active = False
            state.consecutive_losses = 0

    def get_state_dict(self, symbol: str, strategy_id: str) -> dict:
        state = self._get_state(symbol, strategy_id)
        return {
            "active": state.active,
            "trigger": state.trigger,
            "triggered_at": state.triggered_at.isoformat() if state.triggered_at else None,
            "expires_at": state.expires_at.isoformat() if state.expires_at else None,
            "consecutive_losses": state.consecutive_losses,
        }
