"""
Backtesting engine.

Design principles:
- No lookahead bias: each bar only sees data up to and including the current bar.
- Order fills happen at the OPEN of the next bar (end-of-bar signal, next-bar fill).
  Intrabar fill option available for stop/target triggers within a bar.
- Slippage is applied to all fills.
- Commission is per-share.
- Scale-in/out is fully simulated.
- All assumptions are documented.

Execution assumptions:
1. Entry signals generated on bar close → filled at next bar open + slippage.
2. Stop and target checks use the bar's high and low to determine intrabar fill.
3. If both stop and target are hit in the same bar, stop takes priority (conservative).
4. Gaps: if open gaps through stop, stop fills at open price.
5. Partial fills are not simulated (full quantity assumed available).
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, date
from zoneinfo import ZoneInfo
from typing import Any

import numpy as np
import pandas as pd

from app.core.portfolio import Portfolio, Position
from app.core.risk import RiskEngine, RiskConfig
from app.indicators.fvg import detect_fvgs, update_fvg_state
from app.indicators.structure import detect_swing_points, classify_structure
from app.indicators.support_resistance import SupportResistanceEngine
from app.indicators.regime import classify_regime
from app.indicators.technical import (
    sma, ema, atr, rsi, macd, bollinger_bands, stochastic, adx,
    pivot_points, chandelier_exit, keltner_channel, swing_highs_lows, vwap_session,
    hull_ma, ibs, zscore, bt_snipe, thestrat, thestrat_num, parabolic_sar,
)
from app.strategies.conditions import EvalContext, evaluate_conditions, evaluate_condition_group
from app.strategies.stops import calculate_stop, calculate_target, update_trailing_stop
from app.strategies.sizing import calculate_position_size, scale_quantity
from app.strategies.cooldown import CooldownManager
from app.models.session_window import SessionWindowConfig
from app.models.universe_snapshot import UniverseSchedule
from app.services.earnings_calendar import get_earnings_calendar

logger = logging.getLogger(__name__)


class BacktestResult:
    def __init__(self):
        self.trades: list[dict] = []
        self.scale_events: list[dict] = []
        self.equity_curve: list[dict] = []
        self.metrics: dict[str, Any] = {}
        self.regime_series: list[str] = []
        self.run_id: str | None = None


class BacktestEngine:
    """
    Multi-symbol backtester.
    Processes each symbol's data in lock-step (same timestamps).
    """

    def __init__(self, strategy_config: dict, run_config: dict):
        self.strategy = strategy_config
        self.run = run_config

        self.initial_capital = float(run_config.get("initial_capital", 100_000.0))
        self.commission_per_share = float(run_config.get("commission_per_share", 0.005))
        self.commission_pct_per_trade = float(run_config.get("commission_pct_per_trade", 0.0))
        self.slippage_ticks = int(run_config.get("slippage_ticks", 1))
        self.slippage_pct = float(run_config.get("slippage_pct", 0.0))
        # New: support callable/model-based slippage
        self.slippage_model = run_config.get("slippage_model")  # Can be a callable or string for built-ins
        signal_start_raw = run_config.get("signal_start_date")
        self.signal_start_ts = pd.Timestamp(signal_start_raw) if signal_start_raw else None

        risk_cfg = strategy_config.get("risk", {})
        self.risk = RiskEngine(RiskConfig.from_config(risk_cfg))

        cooldown_rules = strategy_config.get("cooldown_rules", [])
        self.cooldown = CooldownManager(cooldown_rules)

        self.portfolio = Portfolio(self.initial_capital, self.commission_per_share)
        self.result = BacktestResult()

        # Session window: built from duration_mode (day/swing/position) or run_config override.
        # Controls entry cutoff, exit cutoff, and hard liquidation time for each bar.
        duration_mode = strategy_config.get("duration_mode") or run_config.get("duration_mode", "swing")
        self.session_window = SessionWindowConfig.from_duration_mode(duration_mode)

        # Universe schedule: point-in-time constituent snapshots.
        # When present, only symbols active at each bar's date are eligible for entry.
        # Open positions on symbols that leave the universe are still managed to exit.
        self.universe_schedule = UniverseSchedule.from_run_config(run_config)

        # Per-symbol indicator cache
        self._indicator_cache: dict[str, pd.DataFrame] = {}
        self._fvg_cache: dict[str, list] = {}
        self._sr_engine_cache: dict[str, SupportResistanceEngine] = {}
        self._required_indicator_refs = self._collect_refs("indicator")
        self._required_field_refs = self._collect_refs("field")

    # ── Public API ─────────────────────────────────────────────────────────────

    def run_backtest(self, data: dict[str, pd.DataFrame]) -> BacktestResult:
        """
        Run backtest on the provided data.

        data: {symbol: DataFrame with OHLCV index=DatetimeIndex}
        """
        if self.strategy.get("pairs"):
            raise ValueError("Pairs backtests are not supported by the current engine yet")

        # Align all symbols to the same timestamp index
        all_idx = sorted(set.union(*[set(df.index) for df in data.values()]))

        # Precompute indicators for all symbols
        for symbol, df in data.items():
            self._indicator_cache[symbol] = self._compute_indicators(df)
            self._fvg_cache[symbol] = detect_fvgs(df, min_gap_pct=0.001)

        if self._indicator_cache:
            first_symbol = next(iter(self._indicator_cache))
            first_columns = set(self._indicator_cache[first_symbol].columns)
            unsupported_indicators = sorted(ref for ref in self._required_indicator_refs if ref not in first_columns)
            unsupported_fields = sorted(
                ref for ref in self._required_field_refs
                if ref not in {"open", "high", "low", "close", "volume"} and ref not in first_columns
            )
            issues = []
            if unsupported_indicators:
                issues.append(f"unsupported indicator reference(s): {', '.join(unsupported_indicators)}")
            if unsupported_fields:
                issues.append(f"unsupported field reference(s): {', '.join(unsupported_fields)}")
            if issues:
                raise ValueError("; ".join(issues))

        # Precompute per-symbol regime maps {timestamp: label}.
        # Using the first symbol for all was a bug — each symbol needs its own regime.
        regime_map: dict[str, dict] = {}
        for sym, sym_df in data.items():
            _regime_series = classify_regime(sym_df)
            regime_map[sym] = dict(zip(_regime_series.index, _regime_series.values))

        # Bug fix 2: precompute per-symbol {timestamp: integer_position} maps
        # to avoid repeated O(n) list.index() calls inside the hot loop.
        # Stored as instance variable so _process_exits can access it without
        # needing to recompute or pass it through every call chain.
        self._bar_index_map: dict[str, dict] = {
            sym: {ts: i for i, ts in enumerate(df.index)}
            for sym, df in data.items()
        }

        _ET = ZoneInfo("America/New_York")
        prev_date: date | None = None

        for bar_num, ts in enumerate(all_idx):
            # Daily reset — use US/Eastern session date so intraday resets align
            # with market session boundaries rather than UTC midnight.
            ts_et = pd.Timestamp(ts).tz_localize("UTC").tz_convert(_ET) if pd.Timestamp(ts).tzinfo is None else pd.Timestamp(ts).tz_convert(_ET)
            current_date = ts_et.date()
            if prev_date and current_date != prev_date:
                self.risk.reset_daily()
            prev_date = current_date

            # Update portfolio prices from all symbols
            prices = {}
            for symbol, df in data.items():
                if ts in df.index:
                    prices[symbol] = float(df.loc[ts, "close"])
            self.portfolio.update_prices(prices)

            # Process each symbol
            for symbol, df in data.items():
                if ts not in df.index:
                    continue
                bar_index = self._bar_index_map[symbol][ts]
                bar = self._indicator_cache[symbol].loc[ts]

                # Per-symbol regime: use each symbol's own regime map
                current_regime: str = regime_map[symbol].get(ts, "unknown")

                # Update FVG state
                update_fvg_state(self._fvg_cache[symbol], bar, bar_index)

                # Get S/R zones (cached, recomputed every N bars)
                sr_engine = self._get_sr_engine(symbol, df, bar_index)

                # Build eval context
                ctx = EvalContext(
                    bar=bar,
                    bar_index=bar_index,
                    df=self._indicator_cache[symbol],
                    position_size=self.portfolio.get_position(symbol, "long") and
                                  self.portfolio.get_position(symbol, "long").quantity or 0.0,
                    account_equity=self.portfolio.equity,
                    regime=current_regime,
                    fvgs=self._fvg_cache[symbol],
                    sr_zones=sr_engine.zones if sr_engine else [],
                    swing_highs=[], swing_lows=[],
                )

                # ── Manage existing positions (exits first) ─────────────────
                # Exits are always processed regardless of universe membership —
                # we never force-close a position just because a symbol left the universe.
                self._process_exits(symbol, bar, bar_index, ts, ctx, df)

                # ── Check for new entries ────────────────────────────────────
                # Universe schedule: skip entry if symbol not active at this bar date.
                # This prevents survivorship bias from symbols added retroactively.
                if self.universe_schedule is not None:
                    active = self.universe_schedule.active_symbols_at(current_date)
                    if active is not None and symbol.upper() not in active:
                        continue

                self._process_entries(symbol, bar, bar_index, ts, ctx, df, current_regime, sr_engine, current_date)

            # Record equity
            self.portfolio.record_equity(ts, current_regime)

        # Close all remaining positions at last bar price
        self._close_all_positions(all_idx[-1] if all_idx else datetime.now(), data)

        # Compute metrics
        self.result.trades = self.portfolio.closed_trades
        self.result.equity_curve = self.portfolio.equity_curve
        self.result.metrics = self._compute_metrics()
        return self.result

    # ── Indicator computation ─────────────────────────────────────────────────

    def _compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Compute all indicators and attach them to the DataFrame."""
        out = df.copy()
        close = df["close"]
        high = df["high"]
        low = df["low"]
        volume = df["volume"] if "volume" in df.columns else pd.Series(1, index=df.index)

        ind_config = self.strategy.get("indicators", {})
        indicator_refs = set(self._required_indicator_refs)

        sma_periods = set(ind_config.get("sma_periods", [20, 50, 200]))
        ema_periods = set(ind_config.get("ema_periods", [9, 21, 55]))
        rsi_periods = set(ind_config.get("rsi_periods", [14]))
        atr_periods = {7, 14, 21}
        if ind_config.get("atr_period"):
            atr_periods.add(int(ind_config["atr_period"]))

        for ref in indicator_refs:
            if match := re.fullmatch(r"sma_(\d+)", ref):
                sma_periods.add(int(match.group(1)))
            elif match := re.fullmatch(r"ema_(\d+)", ref):
                ema_periods.add(int(match.group(1)))
            elif match := re.fullmatch(r"rsi_(\d+)", ref):
                rsi_periods.add(int(match.group(1)))
            elif match := re.fullmatch(r"atr_(\d+)", ref):
                atr_periods.add(int(match.group(1)))

        for period in sorted(atr_periods):
            out[f"atr_{period}"] = atr(high, low, close, period)
        out["atr"] = out["atr_14"] if "atr_14" in out.columns else None

        for period in sorted(sma_periods):
            out[f"sma_{period}"] = sma(close, period)

        for period in sorted(ema_periods):
            out[f"ema_{period}"] = ema(close, period)

        for period in sorted(rsi_periods):
            out[f"rsi_{period}"] = rsi(close, period)

        # MACD
        macd_df = macd(close)
        out = pd.concat([out, macd_df], axis=1)

        # Bollinger
        bb = bollinger_bands(close)
        out = pd.concat([out, bb], axis=1)

        # ADX
        adx_period = int(ind_config.get("adx_period", 14))
        adx_df = adx(high, low, close, adx_period)
        out = pd.concat([out, adx_df], axis=1)
        out["adx"] = adx_df["adx"]

        # Stochastic
        stoch = stochastic(high, low, close)
        out = pd.concat([out, stoch], axis=1)

        # Pivots
        pivots = pivot_points(high, low, close)
        out = pd.concat([out, pivots], axis=1)

        out["open_gap_pct"] = ((out["open"] / out["close"].shift(1)) - 1.0) * 100.0

        if "vwap" in indicator_refs:
            out["vwap"] = vwap_session(out)

        if indicator_refs.intersection({"opening_range_high", "opening_range_low"}):
            out = pd.concat([
                out,
                self._compute_opening_range(out, int(ind_config.get("opening_range_bars", 6))),
            ], axis=1)

        if indicator_refs.intersection({"swing_low", "swing_high"}):
            swing_lookback = int(ind_config.get("swing_lookback", 5))
            swings = swing_highs_lows(high, low, swing_lookback)
            if "swing_low" in indicator_refs:
                swing_low_price = pd.Series(np.nan, index=out.index, dtype=float)
                swing_low_price.loc[swings["swing_low"]] = low.loc[swings["swing_low"]]
                out["swing_low"] = swing_low_price.ffill()
            if "swing_high" in indicator_refs:
                swing_high_price = pd.Series(np.nan, index=out.index, dtype=float)
                swing_high_price.loc[swings["swing_high"]] = high.loc[swings["swing_high"]]
                out["swing_high"] = swing_high_price.ffill()

        for ref in indicator_refs:
            if ref in out.columns:
                continue

            if match := re.fullmatch(r"high_(\d+)", ref):
                period = int(match.group(1))
                out[ref] = high.rolling(period).max().shift(1)
                continue

            if match := re.fullmatch(r"low_(\d+)", ref):
                period = int(match.group(1))
                out[ref] = low.rolling(period).min().shift(1)
                continue

            if match := re.fullmatch(r"volume_avg_(\d+)", ref):
                period = int(match.group(1))
                out[ref] = volume.rolling(period).mean().shift(1)
                continue

            if match := re.fullmatch(r"volume_sma_(\d+)", ref):
                period = int(match.group(1))
                out[ref] = volume.rolling(period).mean().shift(1)
                continue

            if match := re.fullmatch(r"atr_avg_(\d+)", ref):
                period = int(match.group(1))
                out[ref] = out["atr"].rolling(period).mean().shift(1)
                continue

            if ref == "donchian_high":
                period = int(ind_config.get("donchian_period", 20))
                out[ref] = high.rolling(period).max().shift(1)
                continue

            if ref == "donchian_low":
                period = int(ind_config.get("donchian_period", 20))
                out[ref] = low.rolling(period).min().shift(1)

        # ── Parabolic SAR ─────────────────────────────────────────────────────
        af_start = float(ind_config.get("sar_af_start", 0.02))
        af_step  = float(ind_config.get("sar_af_step",  0.02))
        af_max   = float(ind_config.get("sar_af_max",   0.20))
        sar_df = parabolic_sar(high, low, af_start=af_start, af_step=af_step, af_max=af_max)
        out = pd.concat([out, sar_df], axis=1)

        # ── IBS (Internal Bar Strength) ───────────────────────────────────────
        # Always computed — cheap and useful for filtering/conditions.
        out["ibs"] = ibs(high, low, close)

        # ── Z-Score ───────────────────────────────────────────────────────────
        zscore_period = int(ind_config.get("zscore_period", 20))
        out["zscore"] = zscore(close, zscore_period)
        # Also honour explicit per-period refs, e.g. zscore_10
        for ref in indicator_refs:
            if ref in out.columns:
                continue
            if match := re.fullmatch(r"zscore_(\d+)", ref):
                out[ref] = zscore(close, int(match.group(1)))

        # ── BT_Snipe ─────────────────────────────────────────────────────────
        bt_ema_period = int(ind_config.get("bt_snipe_ema_period", 20))
        out["bt_snipe"] = bt_snipe(close, ema_period=bt_ema_period, zscore_period=zscore_period)

        # ── Hull MA ───────────────────────────────────────────────────────────
        # Computed on demand for any hull_ma_N ref, plus a default hull_ma_20.
        if "hull_ma" in indicator_refs or not any(r.startswith("hull_ma") for r in indicator_refs):
            out["hull_ma"] = hull_ma(close, 20)
        for ref in indicator_refs:
            if ref in out.columns:
                continue
            if match := re.fullmatch(r"hull_ma_(\d+)", ref):
                out[ref] = hull_ma(close, int(match.group(1)))

        # ── TheStrat ─────────────────────────────────────────────────────────
        # strat_dir:  categorical string ('1', '2u', '2d', '3')
        # strat_num:  numeric encoding (1, 2, -2, 3)
        out["strat_dir"] = thestrat(high, low)
        out["strat_num"] = thestrat_num(high, low)

        return out

    # ── Entry processing ──────────────────────────────────────────────────────

    def _process_entries(
        self,
        symbol: str,
        bar: pd.Series,
        bar_index: int,
        ts,
        ctx: EvalContext,
        df: pd.DataFrame,
        regime: str,
        sr_engine: SupportResistanceEngine | None,
        current_date: date | None = None,
    ) -> None:
        if self.signal_start_ts is not None and pd.Timestamp(ts) < self.signal_start_ts:
            return

        # Session window: block new entries outside the allowed entry window.
        # Uses bar timestamp converted to ET time-of-day.
        _ET = ZoneInfo("America/New_York")
        ts_et = pd.Timestamp(ts).tz_localize("UTC").tz_convert(_ET) if pd.Timestamp(ts).tzinfo is None else pd.Timestamp(ts).tz_convert(_ET)
        if not self.session_window.can_enter(ts_et.time()):
            return

        # Earnings exclusion: block new entries within the exclusion window.
        # Open positions are unaffected — exits are always processed.
        if current_date is not None:
            earnings_cal = get_earnings_calendar()
            if earnings_cal.is_excluded(symbol, current_date):
                logger.debug("Earnings exclusion: skipping entry for %s on %s", symbol, current_date)
                return

        # Skip if already have a position (unless scale-in is configured)
        existing_long = self.portfolio.get_position(symbol, "long")
        existing_short = self.portfolio.get_position(symbol, "short")

        entry_config = self.strategy.get("entry", {})
        allowed_directions = entry_config.get("directions", ["long", "short"])

        for direction in allowed_directions:
            existing_pos = existing_long if direction == "long" else existing_short
            if existing_pos:
                if self.strategy.get("scale_in"):
                    self._process_scale_in(existing_pos, symbol, bar, bar_index, ctx, df)
                continue

            # Cooldown check
            if self.cooldown.is_in_cooldown(symbol, "strategy", pd.Timestamp(ts).to_pydatetime(), bar_index):
                continue

            # Regime filter
            regime_filter = self.strategy.get("regime_filter")
            if regime_filter:
                allowed_regimes = regime_filter.get("allowed", [])
                if allowed_regimes and regime not in allowed_regimes:
                    continue

            # Evaluate entry conditions
            entry_conditions = entry_config.get(f"{direction}_conditions", entry_config.get("conditions", []))
            entry_logic = entry_config.get("logic", "all_of")
            if not entry_conditions:
                continue

            if not evaluate_conditions(entry_conditions, ctx, entry_logic):
                continue

            # --- Entry signal confirmed ---
            # Calculate entry price (next bar open + slippage, or current close if last bar)
            if bar_index + 1 >= len(df):
                # Last bar: use current close as fill price (conservative, avoids missing end-of-period reversals)
                entry_price = float(bar["close"])
                fill_ts = ts
            else:
                next_bar = df.iloc[bar_index + 1]
                fill_ts = pd.Timestamp(next_bar.name)
                entry_price = float(next_bar["open"])

            # Apply slippage
            tick_size = float(self.strategy.get("tick_size", 0.01))
            entry_price = self._apply_slippage(entry_price, direction, bar, bar_index, symbol, tick_size)

            # Calculate stop
            stop_config = self.strategy.get("stop_loss", {"method": "fixed_pct", "value": 2.0})
            stop_price = calculate_stop(
                stop_config, entry_price, direction, bar, self._indicator_cache[symbol], bar_index,
                fvgs=self._fvg_cache[symbol],
                sr_zones=sr_engine.zones if sr_engine else [],
                swing_lows=ctx.swing_lows,
                swing_highs=ctx.swing_highs,
            )

            # Calculate targets
            targets_config = self.strategy.get("targets", [{"method": "r_multiple", "r": 2.0}])
            target_prices = []
            for tc in (targets_config if isinstance(targets_config, list) else [targets_config]):
                tp = calculate_target(
                    tc, entry_price, stop_price, direction, bar, self._indicator_cache[symbol], bar_index,
                    sr_zones=sr_engine.zones if sr_engine else [],
                    swing_highs=ctx.swing_highs,
                    swing_lows=ctx.swing_lows,
                )
                if tp:
                    target_prices.append(tp)

            # Size the position
            sizing_config = self.strategy.get("position_sizing", {"method": "risk_pct", "risk_pct": 1.0})
            if sizing_config.get("method") == "rolling_kelly":
                from app.strategies.sizing import _rolling_kelly
                quantity = _rolling_kelly(
                    sizing_config,
                    entry_price,
                    self.portfolio.equity,
                    self.strategy.get("leverage", 1.0),
                    closed_trades=self.result.trades,
                )
            else:
                quantity = calculate_position_size(
                    sizing_config,
                    entry_price,
                    stop_price,
                    self.portfolio.equity,
                    direction,
                    self._indicator_cache[symbol],
                    bar_index,
                    leverage=self.strategy.get("leverage", 1.0),
                )

            if quantity < 1e-6:
                continue

            initial_risk = None
            if stop_price is not None:
                initial_risk = abs(entry_price - stop_price) * quantity

            # Scale-in: adjust quantity for first entry
            scale_in_config = self.strategy.get("scale_in")
            if scale_in_config:
                levels = scale_in_config.get("levels", [])
                if levels:
                    quantity = scale_quantity(quantity, levels, 0)  # first entry

            if quantity < 1e-6:
                continue

            # Risk check
            commission = self._calc_commission(quantity, entry_price)
            approved, reason = self.risk.check_entry(symbol, direction, quantity, entry_price, stop_price, self.portfolio)
            if not approved:
                logger.debug(f"Entry rejected for {symbol} {direction}: {reason}")
                continue

            # Open position
            trade_id = str(uuid.uuid4())
            self.portfolio.open_position(
                symbol=symbol,
                direction=direction,
                quantity=quantity,
                price=entry_price,
                commission=commission,
                stop_price=stop_price,
                target_prices=target_prices,
                entry_time=fill_ts,
                trailing_stop_config=self.strategy.get("trailing_stop"),
                scale_config=scale_in_config,
                regime_at_entry=regime,
                trade_id=trade_id,
                initial_risk=initial_risk,
            )
            logger.debug(f"Opened {direction} {symbol} @ {entry_price:.4f} qty={quantity:.2f} stop={stop_price}")

    def _apply_slippage(self, price: float, direction: str, bar: pd.Series, bar_index: int, symbol: str, tick_size: float) -> float:
        if callable(self.slippage_model):
            return self.slippage_model(price, direction, bar, bar_index, symbol, tick_size)
        if self.slippage_model == "random_normal":
            slip = np.random.normal(0, 1) * tick_size
            return price + slip if direction == "long" else price - slip
        if direction == "long":
            return price * (1.0 + self.slippage_pct / 100.0) + self.slippage_ticks * tick_size
        else:
            return price * (1.0 - self.slippage_pct / 100.0) - self.slippage_ticks * tick_size

    # ── Exit processing ───────────────────────────────────────────────────────

    def _process_exits(
        self,
        symbol: str,
        bar: pd.Series,
        bar_index: int,
        ts,
        ctx: EvalContext,
        df: pd.DataFrame,
    ) -> None:
        positions_to_check = list(self.portfolio.positions.get(symbol, []))
        exit_config = self.strategy.get("exit", {})
        scale_out_config = self.strategy.get("scale_out")

        # Session window: check for forced close / hard liquidation before individual position logic.
        _ET = ZoneInfo("America/New_York")
        ts_et = pd.Timestamp(ts).tz_localize("UTC").tz_convert(_ET) if pd.Timestamp(ts).tzinfo is None else pd.Timestamp(ts).tz_convert(_ET)
        force_liquidate = self.session_window.should_liquidate_all(ts_et.time())
        force_close = force_liquidate or self.session_window.should_close_positions(ts_et.time())

        for pos in positions_to_check:
            price = float(bar["close"])
            high = float(bar["high"])
            low = float(bar["low"])
            open_p = float(bar["open"])

            exit_price = None
            exit_reason = None
            exit_qty = None  # None = full close

            # 0. Session window forced exit — takes priority over all other checks.
            #    Hard liquidation (15:55 ET for day mode) uses aggressive close price.
            #    Soft close window (15:50 ET) also triggers immediate exit.
            if force_liquidate:
                exit_price = price
                exit_reason = "session_liquidation"
            elif force_close and not self.session_window.allow_overnight:
                exit_price = price
                exit_reason = "session_exit"

            # 1. Gap through stop (open gaps past stop)
            if pos.stop_price:
                if pos.direction == "long" and open_p <= pos.stop_price:
                    exit_price = open_p
                    exit_reason = "stop_loss_gap"
                elif pos.direction == "short" and open_p >= pos.stop_price:
                    exit_price = open_p
                    exit_reason = "stop_loss_gap"

            # 2. Intrabar stop hit
            if exit_price is None and pos.stop_price:
                if pos.direction == "long" and low <= pos.stop_price:
                    exit_price = pos.stop_price
                    exit_reason = "stop_loss"
                elif pos.direction == "short" and high >= pos.stop_price:
                    exit_price = pos.stop_price
                    exit_reason = "stop_loss"

            # 3. Target hits (check in order: target_1, target_2, ...)
            if exit_price is None and pos.target_prices:
                for i, tp in enumerate(pos.target_prices):
                    if pos.direction == "long" and high >= tp:
                        if scale_out_config and i < len(pos.target_prices) - 1:
                            # Partial exit at this target
                            levels = scale_out_config.get("levels", [])
                            if i < len(levels):
                                pct = float(levels[i].get("pct", 50)) / 100.0
                                exit_qty = pos.quantity * pct
                                exit_price = tp
                                exit_reason = f"target_{i + 1}"

                                # Move stop to breakeven after target 1 if configured
                                if i == 0 and scale_out_config.get("move_stop_to_be_after_t1", True):
                                    pos.stop_price = pos.avg_entry

                                # Update trailing stop if configured
                                if i == 0 and pos.trailing_stop_config:
                                    # Activate trailing stop after first target
                                    pass
                            break
                        else:
                            # Full exit at this target
                            exit_price = tp
                            exit_reason = f"target_{i + 1}"
                            break
                    elif pos.direction == "short" and low <= tp:
                        if scale_out_config and i < len(pos.target_prices) - 1:
                            # Partial exit at this target (mirror long scale-out logic)
                            levels = scale_out_config.get("levels", [])
                            if i < len(levels):
                                pct = float(levels[i].get("pct", 50)) / 100.0
                                exit_qty = pos.quantity * pct
                                exit_price = tp
                                exit_reason = f"target_{i + 1}"

                                # Move stop to breakeven after target 1 if configured
                                if i == 0 and scale_out_config.get("move_stop_to_be_after_t1", True):
                                    pos.stop_price = pos.avg_entry
                        else:
                            # Full exit at this target
                            exit_price = tp
                            exit_reason = f"target_{i + 1}"
                        break

            # 4. Trailing stop update (if no exit yet)
            if exit_price is None and pos.trailing_stop_config:
                new_stop = update_trailing_stop(
                    pos.trailing_stop_config,
                    pos.stop_price or (pos.avg_entry * 0.95 if pos.direction == "long" else pos.avg_entry * 1.05),
                    pos.direction,
                    bar,
                    self._indicator_cache[symbol],
                    bar_index,
                    pos.avg_entry,
                    pos.stop_price or 0,
                )
                pos.stop_price = new_stop

            # 5. Exit conditions (strategy-defined exit rules)
            # Supports generic `conditions` (all positions) OR per-direction
            # `long_conditions` / `short_conditions`.
            if exit_price is None:
                if pos.direction == "long":
                    exit_conditions = exit_config.get("long_conditions") or exit_config.get("conditions", [])
                else:
                    exit_conditions = exit_config.get("short_conditions") or exit_config.get("conditions", [])
                exit_logic = exit_config.get("logic", "any_of")
                if exit_conditions and evaluate_conditions(exit_conditions, ctx, exit_logic):
                    exit_price = float(bar["close"])
                    exit_reason = "signal_exit"

            # 6. Session / time-based exit
            if exit_price is None:
                time_exit = exit_config.get("time_exit")
                if time_exit:
                    max_bars = time_exit.get("max_bars")
                    if max_bars:
                        # Normalize to tz-naive pd.Timestamp to match _bar_index_map keys
                        entry_ts = pd.Timestamp(pos.entry_time)
                        if entry_ts.tzinfo is not None:
                            entry_ts = entry_ts.tz_localize(None)
                        entry_bar_index = self._bar_index_map.get(symbol, {}).get(entry_ts, None)
                        if entry_bar_index is None:
                            entry_bar_index = bar_index  # fallback: treat as 0 hold bars
                        hold_bars = bar_index - entry_bar_index
                        if hold_bars >= max_bars:
                            exit_price = price
                            exit_reason = "time_exit"

            if exit_price is None:
                continue

            # Apply slippage to exit
            tick_size = float(self.strategy.get("tick_size", 0.01))
            if pos.direction == "long":
                exit_price -= self.slippage_ticks * tick_size
            else:
                exit_price += self.slippage_ticks * tick_size

            close_qty = exit_qty or pos.quantity
            commission = self._calc_commission(close_qty, exit_price)

            trade_record = self.portfolio.close_position(
                pos=pos,
                price=exit_price,
                quantity=close_qty,
                commission=commission,
                exit_reason=exit_reason,
                exit_time=pd.Timestamp(ts).to_pydatetime(),
            )

            self.risk.on_trade_close(trade_record["net_pnl"])

            # Cooldown trigger
            self.cooldown.on_trade_exit(
                symbol=symbol,
                strategy_id="strategy",
                exit_reason=exit_reason,
                pnl=trade_record["net_pnl"],
                exit_time=pd.Timestamp(ts).to_pydatetime(),
                current_bar=bar_index,
            )

            # Record scale event if partial
            if exit_qty and exit_qty < pos.quantity + exit_qty:
                self.result.scale_events.append({
                    "trade_id": pos.trade_id,
                    "type": "scale_out",
                    "price": exit_price,
                    "quantity": close_qty,
                    "reason": exit_reason,
                    "time": str(ts),
                })

    # ── Scale-in on existing positions ─────────────────────────────────────────

    def _process_scale_in(
        self,
        pos: Position,
        symbol: str,
        bar: pd.Series,
        bar_index: int,
        ctx: EvalContext,
        df: pd.DataFrame,
    ) -> None:
        scale_config = self.strategy.get("scale_in")
        if not scale_config or pos.add_count >= scale_config.get("max_adds", 3):
            return

        add_conditions = scale_config.get("conditions", [])
        if not add_conditions:
            return

        if not evaluate_conditions(add_conditions, ctx, "all_of"):
            return

        if bar_index + 1 >= len(df):
            # Last bar: use current close for scale-in fill price
            add_price = float(bar["close"])
            fill_ts = pd.Timestamp(ts).to_pydatetime()
        else:
            next_bar = df.iloc[bar_index + 1]
            fill_ts = pd.Timestamp(next_bar.name).to_pydatetime()
            add_price = float(next_bar["open"])

        tick_size = float(self.strategy.get("tick_size", 0.01))
        if pos.direction == "long":
            add_price = add_price * (1.0 + self.slippage_pct / 100.0) + self.slippage_ticks * tick_size
        else:
            add_price = add_price * (1.0 - self.slippage_pct / 100.0) - self.slippage_ticks * tick_size

        levels = scale_config.get("levels", [])
        level_idx = pos.add_count + 1
        add_qty = scale_quantity(
            calculate_position_size(
                self.strategy.get("position_sizing", {"method": "risk_pct", "risk_pct": 1.0}),
                add_price, pos.stop_price, self.portfolio.equity, pos.direction,
                self._indicator_cache[symbol], bar_index,
            ),
            levels, level_idx,
        )

        if add_qty < 1e-6:
            return

        commission = self._calc_commission(add_qty, add_price)
        new_stop = calculate_stop(
            self.strategy.get("stop_loss", {"method": "fixed_pct", "value": 2.0}),
            add_price, pos.direction, bar, self._indicator_cache[symbol], bar_index,
        )

        approved, reason = self.risk.check_entry(symbol, pos.direction, add_qty, add_price, new_stop, self.portfolio)
        if not approved:
            logger.debug(f"Scale-in rejected for {symbol} {pos.direction}: {reason}")
            return

        self.portfolio.add_to_position(pos, add_qty, add_price, commission, new_stop)
        self.result.scale_events.append({
            "trade_id": pos.trade_id,
            "type": "scale_in",
            "price": add_price,
            "quantity": add_qty,
            "time": str(fill_ts),
        })

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _get_sr_engine(self, symbol: str, df: pd.DataFrame, bar_index: int) -> SupportResistanceEngine | None:
        if not self.strategy.get("use_support_resistance", True):
            return None
        # Recompute every 50 bars
        if symbol not in self._sr_engine_cache or bar_index % 50 == 0:
            engine = SupportResistanceEngine()
            lookback = min(bar_index + 1, 252)
            sub_df = df.iloc[max(0, bar_index - lookback):bar_index + 1]
            if len(sub_df) >= 20:
                engine.compute(sub_df)
                self._sr_engine_cache[symbol] = engine
        return self._sr_engine_cache.get(symbol)

    def _collect_refs(self, key: str) -> set[str]:
        refs: set[str] = set()

        def _walk(node: Any) -> None:
            if isinstance(node, dict):
                value = node.get(key)
                if isinstance(value, str):
                    refs.add(value)
                for child in node.values():
                    _walk(child)
            elif isinstance(node, list):
                for item in node:
                    _walk(item)

        _walk(self.strategy)
        return refs

    def _calc_commission(self, quantity: float, price: float) -> float:
        per_share = quantity * self.commission_per_share
        pct_component = quantity * price * (self.commission_pct_per_trade / 100.0)
        return per_share + pct_component

    def _compute_opening_range(self, df: pd.DataFrame, bars: int) -> pd.DataFrame:
        opening_range_high = pd.Series(np.nan, index=df.index, dtype=float)
        opening_range_low = pd.Series(np.nan, index=df.index, dtype=float)

        if not isinstance(df.index, pd.DatetimeIndex) or bars <= 0:
            return pd.DataFrame({
                "opening_range_high": opening_range_high,
                "opening_range_low": opening_range_low,
            })

        for _, session_df in df.groupby(df.index.normalize(), sort=False):
            if len(session_df) < bars:
                continue
            first_window = session_df.iloc[:bars]
            high_val = float(first_window["high"].max())
            low_val = float(first_window["low"].min())
            opening_range_high.loc[session_df.index[bars - 1:]] = high_val
            opening_range_low.loc[session_df.index[bars - 1:]] = low_val

        return pd.DataFrame({
            "opening_range_high": opening_range_high,
            "opening_range_low": opening_range_low,
        })

    def _close_all_positions(self, last_ts, data: dict[str, pd.DataFrame]) -> None:
        for symbol in list(self.portfolio.positions.keys()):
            df = data.get(symbol)
            if df is None or last_ts not in df.index:
                continue
            last_price = float(df.loc[last_ts, "close"])
            for pos in list(self.portfolio.positions.get(symbol, [])):
                commission = self._calc_commission(pos.quantity, last_price)
                self.portfolio.close_position(
                    pos, last_price, commission=commission,
                    exit_reason="backtest_end",
                    exit_time=pd.Timestamp(last_ts).to_pydatetime(),
                )

    # ── Metrics computation ────────────────────────────────────────────────────

    def _compute_metrics(self) -> dict[str, Any]:
        from app.services.reporting import compute_full_metrics
        return compute_full_metrics(
            self.result.trades,
            self.result.equity_curve,
            self.initial_capital,
            timeframe=self.run.get("timeframe", "1d"),
        )
