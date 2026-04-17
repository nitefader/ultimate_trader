"""
BacktestStepper — step-through wrapper around BacktestEngine for the Simulation Lab.

Wraps the same indicator computation, condition evaluation, risk engine, portfolio
accounting, cooldown management, stop/target calculation, and position sizing that
the full BacktestEngine uses — but exposes a bar-by-bar stepping interface so an
external caller (the Simulation WebSocket) can control iteration speed.

Usage:
    stepper = BacktestStepper(strategy_config, run_config)
    stepper.prepare(data)           # precompute indicators, build timeline
    while stepper.has_next():
        snapshot = stepper.step()   # advance one bar, returns full state
    final = stepper.finalize()      # close remaining positions, compute metrics
"""
from __future__ import annotations

import logging
from datetime import date
from zoneinfo import ZoneInfo
from typing import Any

import numpy as np
import pandas as pd

from app.core.portfolio import Portfolio, Position
from app.core.risk import RiskEngine, RiskConfig
from app.core.backtest import BacktestEngine, BacktestResult
from app.indicators.fvg import detect_fvgs, update_fvg_state
from app.indicators.regime import classify_regime
from app.indicators.support_resistance import SupportResistanceEngine
from app.strategies.conditions import EvalContext, evaluate_conditions
from app.strategies.stops import calculate_stop, calculate_target, update_trailing_stop
from app.strategies.sizing import calculate_position_size, scale_quantity
from app.strategies.cooldown import CooldownManager
from app.models.session_window import SessionWindowConfig
from app.models.universe_snapshot import UniverseSchedule

logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")


class BarSnapshot:
    """Complete state emitted after each step — everything the frontend needs."""

    def __init__(self):
        self.bar_num: int = 0
        self.timestamp: str = ""
        self.total_bars: int = 0

        # Per-symbol bar data + indicators
        self.symbols: dict[str, dict[str, Any]] = {}

        # Trades opened/closed this bar
        self.entries: list[dict[str, Any]] = []
        self.exits: list[dict[str, Any]] = []
        self.scale_events: list[dict[str, Any]] = []

        # Risk events (rejected entries)
        self.rejections: list[dict[str, Any]] = []

        # Portfolio state
        self.equity: float = 0.0
        self.cash: float = 0.0
        self.drawdown: float = 0.0
        self.unrealized_pnl: float = 0.0
        self.total_return_pct: float = 0.0
        self.open_positions: list[dict[str, Any]] = []

        # Risk engine state
        self.daily_pnl: float = 0.0
        self.daily_trade_count: int = 0
        self.portfolio_heat: float = 0.0
        self.risk_killed: bool = False

        # Cooldown state
        self.cooldowns: dict[str, dict[str, Any]] = {}

        # Regime
        self.regime: str = "unknown"

        # Running metrics
        self.total_trades: int = 0
        self.winning_trades: int = 0
        self.losing_trades: int = 0
        self.win_rate: float = 0.0
        self.total_net_pnl: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "bar_num": self.bar_num,
            "timestamp": self.timestamp,
            "total_bars": self.total_bars,
            "progress_pct": round(self.bar_num / max(self.total_bars, 1) * 100, 1),
            "symbols": self.symbols,
            "entries": self.entries,
            "exits": self.exits,
            "scale_events": self.scale_events,
            "rejections": self.rejections,
            "equity": round(self.equity, 2),
            "cash": round(self.cash, 2),
            "drawdown": round(self.drawdown, 4),
            "unrealized_pnl": round(self.unrealized_pnl, 2),
            "total_return_pct": round(self.total_return_pct, 2),
            "open_positions": self.open_positions,
            "daily_pnl": round(self.daily_pnl, 2),
            "daily_trade_count": self.daily_trade_count,
            "portfolio_heat": round(self.portfolio_heat, 4),
            "risk_killed": self.risk_killed,
            "cooldowns": self.cooldowns,
            "regime": self.regime,
            "total_trades": self.total_trades,
            "winning_trades": self.winning_trades,
            "losing_trades": self.losing_trades,
            "win_rate": round(self.win_rate, 1),
            "total_net_pnl": round(self.total_net_pnl, 2),
        }


class BacktestStepper:
    """
    Step-through backtester using the real BacktestEngine internals.

    The engine is instantiated once during prepare() and all its methods
    (_process_entries, _process_exits, _compute_indicators, etc.) are
    called directly — ensuring 100% fidelity with a full backtest run.

    IMPORTANT: Monkey-patching is done ONCE in prepare(), not per-step.
    The patched methods capture events into per-step lists that are reset
    at the start of each step() call.
    """

    def __init__(self, strategy_config: dict, run_config: dict):
        self.strategy_config = strategy_config
        self.run_config = run_config
        self._engine: BacktestEngine | None = None
        self._data: dict[str, pd.DataFrame] = {}
        self._all_idx: list = []
        self._bar_num: int = 0
        self._prev_date: date | None = None
        self._regime_map: dict[str, dict] = {}
        self._prepared: bool = False

        # Track entries/exits per step for snapshot
        self._step_entries: list[dict] = []
        self._step_exits: list[dict] = []
        self._step_scale_events: list[dict] = []
        self._step_rejections: list[dict] = []

        # Indicator names to send to frontend (computed during prepare)
        self._indicator_names: list[str] = []

        # Track scale event count to avoid duplicates (properly initialized)
        self._prev_scale_event_count: int = 0

    def prepare(self, data: dict[str, pd.DataFrame]) -> dict[str, Any]:
        """
        Precompute everything — indicators, FVGs, regimes, timeline.
        Returns metadata for the frontend (symbols, indicator list, total bars, etc.)
        """
        self._data = data
        self._engine = BacktestEngine(self.strategy_config, self.run_config)

        # Align timestamps
        self._all_idx = sorted(set.union(*[set(df.index) for df in data.values()]))

        # Precompute indicators (same as BacktestEngine.run_backtest)
        for symbol, df in data.items():
            self._engine._indicator_cache[symbol] = self._engine._compute_indicators(df)
            self._engine._fvg_cache[symbol] = detect_fvgs(df, min_gap_pct=0.001)

        # Validate indicator refs (same check as run_backtest)
        if self._engine._indicator_cache:
            first_symbol = next(iter(self._engine._indicator_cache))
            first_columns = set(self._engine._indicator_cache[first_symbol].columns)
            unsupported_indicators = sorted(
                ref for ref in self._engine._required_indicator_refs if ref not in first_columns
            )
            unsupported_fields = sorted(
                ref for ref in self._engine._required_field_refs
                if ref not in {"open", "high", "low", "close", "volume"} and ref not in first_columns
            )
            issues = []
            if unsupported_indicators:
                issues.append(f"unsupported indicator(s): {', '.join(unsupported_indicators)}")
            if unsupported_fields:
                issues.append(f"unsupported field(s): {', '.join(unsupported_fields)}")
            if issues:
                raise ValueError("; ".join(issues))

            # Capture indicator names for the frontend
            base_cols = {"open", "high", "low", "close", "volume"}
            self._indicator_names = sorted(first_columns - base_cols)

        # Precompute regime maps per symbol
        for sym, sym_df in data.items():
            _regime_series = classify_regime(sym_df)
            self._regime_map[sym] = dict(zip(_regime_series.index, _regime_series.values))

        # Build bar_index_map (same as engine)
        self._engine._bar_index_map = {
            sym: {ts: i for i, ts in enumerate(df.index)}
            for sym, df in data.items()
        }

        # Patch ONCE — save originals, install interceptors
        self._install_patches()

        self._bar_num = 0
        self._prev_date = None
        self._prepared = True

        return {
            "simulation_id": None,  # filled by caller
            "total_bars": len(self._all_idx),
            "symbols": list(data.keys()),
            "timeframe": self.run_config.get("timeframe", "1d"),
            "start_date": str(self._all_idx[0]) if self._all_idx else None,
            "end_date": str(self._all_idx[-1]) if self._all_idx else None,
            "initial_capital": self._engine.initial_capital,
            "indicators": self._indicator_names,
            "strategy_name": self.strategy_config.get("name", "Unnamed"),
        }

    def has_next(self) -> bool:
        return self._prepared and self._bar_num < len(self._all_idx)

    def step(self) -> BarSnapshot:
        """
        Advance exactly one bar. Process all symbols at this timestamp.
        Returns a full BarSnapshot with everything the frontend needs.
        """
        if not self._prepared or not self._engine:
            raise RuntimeError("Call prepare() before stepping")
        if self._bar_num >= len(self._all_idx):
            raise StopIteration("No more bars")

        # Reset per-step tracking lists (patches read these via closure)
        self._step_entries = []
        self._step_exits = []
        self._step_scale_events = []
        self._step_rejections = []

        ts = self._all_idx[self._bar_num]

        # Daily reset (same logic as BacktestEngine)
        ts_et = (
            pd.Timestamp(ts).tz_localize("UTC").tz_convert(_ET)
            if pd.Timestamp(ts).tzinfo is None
            else pd.Timestamp(ts).tz_convert(_ET)
        )
        current_date = ts_et.date()
        if self._prev_date and current_date != self._prev_date:
            self._engine.risk.reset_daily()
        self._prev_date = current_date

        # Update portfolio prices
        prices = {}
        for symbol, df in self._data.items():
            if ts in df.index:
                prices[symbol] = float(df.loc[ts, "close"])
        self._engine.portfolio.update_prices(prices)

        # Process each symbol (same order as BacktestEngine)
        last_regime = "unknown"
        symbol_snapshots: dict[str, dict] = {}
        for symbol, df in self._data.items():
            if ts not in df.index:
                continue
            bar_index = self._engine._bar_index_map[symbol][ts]
            bar = self._engine._indicator_cache[symbol].loc[ts]
            current_regime = self._regime_map[symbol].get(ts, "unknown")
            last_regime = current_regime  # Use LAST symbol's regime (matches engine)

            # Update FVG state
            update_fvg_state(self._engine._fvg_cache[symbol], bar, bar_index)

            # S/R zones
            sr_engine = self._engine._get_sr_engine(symbol, df, bar_index)

            # Build eval context
            ctx = EvalContext(
                bar=bar,
                bar_index=bar_index,
                df=self._engine._indicator_cache[symbol],
                position_size=(
                    self._engine.portfolio.get_position(symbol, "long")
                    and self._engine.portfolio.get_position(symbol, "long").quantity
                    or 0.0
                ),
                account_equity=self._engine.portfolio.equity,
                regime=current_regime,
                fvgs=self._engine._fvg_cache[symbol],
                sr_zones=sr_engine.zones if sr_engine else [],
                swing_highs=[], swing_lows=[],
            )

            # Exits first (same as engine — always processed regardless of universe)
            self._engine._process_exits(symbol, bar, bar_index, ts, ctx, df)

            # Scale-in on existing positions (same as engine lines 441-445)
            for direction in ("long", "short"):
                existing_pos = self._engine.portfolio.get_position(symbol, direction)
                if existing_pos and self.strategy_config.get("scale_in"):
                    self._engine._process_scale_in(existing_pos, symbol, bar, bar_index, ctx, df)

            # Universe schedule check (blocks entries only, not exits)
            if self._engine.universe_schedule is not None:
                active = self._engine.universe_schedule.active_symbols_at(current_date)
                if active is not None and symbol.upper() not in active:
                    # Still build snapshot data, just skip entries
                    symbol_snapshots[symbol] = self._build_symbol_snapshot(bar, current_regime)
                    continue

            # Entries
            self._engine._process_entries(
                symbol, bar, bar_index, ts, ctx, df,
                current_regime, sr_engine, current_date,
            )

            # Build per-symbol snapshot with OHLCV + key indicators
            symbol_snapshots[symbol] = self._build_symbol_snapshot(bar, current_regime)

        # Capture scale events from the engine result (populated by _process_exits/_process_scale_in)
        pre_len = getattr(self, '_prev_scale_event_count', 0)
        if len(self._engine.result.scale_events) > pre_len:
            self._step_scale_events = self._engine.result.scale_events[pre_len:]
        self._prev_scale_event_count = len(self._engine.result.scale_events)

        # Record equity (use last symbol's regime to match engine behavior)
        self._engine.portfolio.record_equity(ts, last_regime)

        # Build snapshot
        snapshot = self._build_snapshot(ts, last_regime, symbol_snapshots)

        self._bar_num += 1
        return snapshot

    def skip_to(self, target_bar: int) -> BarSnapshot | None:
        """Fast-forward to a specific bar number, returning the snapshot at that bar."""
        if target_bar <= self._bar_num:
            return None
        if target_bar >= len(self._all_idx):
            target_bar = len(self._all_idx) - 1

        last_snapshot = None
        while self._bar_num < target_bar and self.has_next():
            last_snapshot = self.step()
        return last_snapshot

    def skip_to_next_trade(self) -> BarSnapshot | None:
        """Advance until the next entry or exit fires."""
        while self.has_next():
            snapshot = self.step()
            if snapshot.entries or snapshot.exits:
                return snapshot
        return None

    def finalize(self) -> dict[str, Any]:
        """Close remaining positions and compute final metrics."""
        if not self._engine:
            return {}

        # Close all remaining positions
        if self._all_idx:
            self._engine._close_all_positions(self._all_idx[-1], self._data)

        self._engine.result.trades = self._engine.portfolio.closed_trades
        self._engine.result.equity_curve = self._engine.portfolio.equity_curve
        self._engine.result.scale_events = self._engine.result.scale_events
        metrics = self._engine._compute_metrics()
        self._engine.result.metrics = metrics
        return {
            "metrics": metrics,
            "total_trades": len(self._engine.portfolio.closed_trades),
            "equity_curve": self._engine.portfolio.equity_curve,
        }

    def get_equity_curve(self) -> list[dict]:
        """Return the equity curve accumulated so far."""
        if not self._engine:
            return []
        return self._engine.portfolio.equity_curve

    def get_all_trades(self) -> list[dict]:
        """Return all closed trades so far."""
        if not self._engine:
            return []
        return self._engine.portfolio.closed_trades

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _build_symbol_snapshot(self, bar: pd.Series, regime: str) -> dict[str, Any]:
        """Build per-symbol OHLCV + indicator data for the frontend."""
        sym_data: dict[str, Any] = {
            "open": _safe_float(bar.get("open")),
            "high": _safe_float(bar.get("high")),
            "low": _safe_float(bar.get("low")),
            "close": _safe_float(bar.get("close")),
            "volume": _safe_float(bar.get("volume")),
            "regime": regime,
        }
        for ind_name in self._indicator_names:
            val = bar.get(ind_name)
            if val is not None and not (isinstance(val, float) and np.isnan(val)):
                sym_data[ind_name] = _safe_float(val) if isinstance(val, (int, float, np.floating)) else str(val)
        return sym_data

    def _build_snapshot(
        self,
        ts: Any,
        regime: str,
        symbol_snapshots: dict[str, dict],
    ) -> BarSnapshot:
        engine = self._engine
        portfolio = engine.portfolio

        snap = BarSnapshot()
        snap.bar_num = self._bar_num
        snap.timestamp = str(ts)
        snap.total_bars = len(self._all_idx)

        snap.symbols = symbol_snapshots
        snap.entries = self._step_entries
        snap.exits = self._step_exits
        snap.scale_events = self._step_scale_events
        snap.rejections = self._step_rejections

        snap.equity = portfolio.equity
        snap.cash = portfolio.cash
        snap.drawdown = portfolio.current_drawdown
        snap.unrealized_pnl = portfolio.unrealized_pnl
        snap.total_return_pct = (
            (portfolio.equity - engine.initial_capital) / engine.initial_capital * 100
        )

        # Open positions
        snap.open_positions = []
        for sym, positions in portfolio.positions.items():
            for pos in positions:
                snap.open_positions.append({
                    "symbol": pos.symbol,
                    "direction": pos.direction,
                    "quantity": pos.quantity,
                    "avg_entry": round(pos.avg_entry, 4),
                    "current_price": round(pos.current_price, 4),
                    "stop_price": round(pos.stop_price, 4) if pos.stop_price else None,
                    "target_prices": [round(t, 4) for t in pos.target_prices],
                    "unrealized_pnl": round(pos.unrealized_pnl, 2),
                    "unrealized_pnl_pct": round(pos.unrealized_pnl_pct * 100, 2),
                    "max_favorable": round(pos.max_favorable, 2),
                    "max_adverse": round(pos.max_adverse, 2),
                    "entry_time": str(pos.entry_time) if pos.entry_time else None,
                    "regime_at_entry": pos.regime_at_entry,
                    "trade_id": pos.trade_id,
                    "initial_risk": round(pos.initial_risk, 2) if pos.initial_risk else None,
                })

        # Risk state
        snap.daily_pnl = engine.risk._daily_pnl
        snap.daily_trade_count = engine.risk._daily_trade_count
        snap.portfolio_heat = portfolio.portfolio_heat
        snap.risk_killed = engine.risk.is_killed

        # Cooldown state
        snap.cooldowns = {}
        for (sym, strat_id), state in engine.cooldown._states.items():
            if state.active:
                snap.cooldowns[sym] = {
                    "trigger": state.trigger,
                    "expires_at_bar": state.expires_at_bar,
                    "consecutive_losses": state.consecutive_losses,
                }

        snap.regime = regime

        # Running trade stats
        closed = portfolio.closed_trades
        snap.total_trades = len(closed)
        snap.winning_trades = sum(1 for t in closed if t["net_pnl"] > 0)
        snap.losing_trades = sum(1 for t in closed if t["net_pnl"] <= 0)
        snap.win_rate = (snap.winning_trades / snap.total_trades * 100) if snap.total_trades > 0 else 0.0
        snap.total_net_pnl = sum(t["net_pnl"] for t in closed)

        return snap

    def _install_patches(self) -> None:
        """
        Install interceptors on Portfolio and RiskEngine methods ONCE.

        Called during prepare(). The patched methods capture trade events into
        self._step_entries / _step_exits / _step_rejections, which are reset
        at the start of each step() call. This avoids the recursive wrapping
        bug that occurs if you re-patch on every step.
        """
        engine = self._engine
        # Save the REAL originals (unbound from any previous patches)
        _original_open = engine.portfolio.__class__.open_position
        _original_close = engine.portfolio.__class__.close_position
        _original_risk_check = engine.risk.__class__.check_entry
        stepper = self

        def patched_open_position(
            self_portfolio, symbol, direction, quantity, price, commission=0.0,
            stop_price=None, target_prices=None, entry_time=None, **kwargs
        ):
            pos = _original_open(
                self_portfolio,
                symbol=symbol, direction=direction, quantity=quantity, price=price,
                commission=commission, stop_price=stop_price, target_prices=target_prices,
                entry_time=entry_time, **kwargs,
            )
            stepper._step_entries.append({
                "symbol": symbol,
                "direction": direction,
                "quantity": round(quantity, 4),
                "entry_price": round(price, 4),
                "stop_price": round(stop_price, 4) if stop_price else None,
                "target_prices": [round(t, 4) for t in (target_prices or [])],
                "commission": round(commission, 4),
                "entry_time": str(entry_time) if entry_time else None,
                "trade_id": pos.trade_id,
                "regime_at_entry": kwargs.get("regime_at_entry"),
                "initial_risk": round(kwargs.get("initial_risk", 0) or 0, 2),
            })
            return pos

        def patched_close_position(self_portfolio, pos, price, quantity=None, commission=0.0,
                                   exit_reason="manual", exit_time=None):
            trade_record = _original_close(
                self_portfolio,
                pos=pos, price=price, quantity=quantity, commission=commission,
                exit_reason=exit_reason, exit_time=exit_time,
            )
            stepper._step_exits.append({
                "symbol": trade_record["symbol"],
                "direction": trade_record["direction"],
                "entry_price": round(trade_record["entry_price"], 4),
                "exit_price": round(trade_record["exit_price"], 4),
                "quantity": round(trade_record["quantity"], 4),
                "gross_pnl": round(trade_record["gross_pnl"], 2),
                "net_pnl": round(trade_record["net_pnl"], 2),
                "commission": round(trade_record["commission"], 4),
                "exit_reason": trade_record["exit_reason"],
                "exit_time": str(trade_record["exit_time"]) if trade_record["exit_time"] else None,
                "entry_time": str(trade_record["entry_time"]) if trade_record["entry_time"] else None,
                "trade_id": trade_record.get("trade_id"),
                "initial_risk": round(trade_record.get("initial_risk") or 0, 2),
                "r_multiple": (
                    round(trade_record["net_pnl"] / trade_record["initial_risk"], 2)
                    if trade_record.get("initial_risk") and trade_record["initial_risk"] > 0
                    else None
                ),
            })
            return trade_record

        def patched_risk_check(self_risk, symbol, direction, quantity, price, stop_price, portfolio):
            approved, reason = _original_risk_check(
                self_risk, symbol, direction, quantity, price, stop_price, portfolio,
            )
            if not approved:
                stepper._step_rejections.append({
                    "symbol": symbol,
                    "direction": direction,
                    "quantity": round(quantity, 4),
                    "price": round(price, 4),
                    "reason": reason,
                })
            return approved, reason

        # Bind patched methods to the specific instances (not re-patchable)
        import types
        engine.portfolio.open_position = types.MethodType(patched_open_position, engine.portfolio)
        engine.portfolio.close_position = types.MethodType(patched_close_position, engine.portfolio)
        engine.risk.check_entry = types.MethodType(patched_risk_check, engine.risk)


def _safe_float(val):
    """Convert to float, returning None for NaN/None."""
    if val is None:
        return None
    try:
        import numpy as np
        f = float(val)
        return None if np.isnan(f) else round(f, 6)
    except (ValueError, TypeError):
        return None
