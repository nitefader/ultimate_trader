"""
Paper broker execution engine.

Polls running paper deployments every POLL_INTERVAL_SECONDS, evaluates
strategy entry/exit conditions against the latest cached bar data, and
records simulated fills as DeploymentTrade rows.

Architecture:
  - One background asyncio task drives all paper deployments.
  - Per-deployment state is kept in memory (_dep_state) between polls:
      open positions, bar index, last processed bar timestamp.
  - On each cycle: load latest bars → evaluate conditions → open/close trades.
  - Fills are at the CLOSE price of the bar (end-of-bar signal, same-bar fill
    for paper since we can't guarantee next-bar open data in real-time).

Usage:
    start_paper_broker_loop()  — called once from app lifespan
    stop_paper_broker_loop()   — called on shutdown
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.deployment import Deployment
from app.models.deployment_trade import DeploymentTrade
from app.models.strategy import StrategyVersion

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 60  # poll every minute; data updates are intraday/EOD anyway


# ── In-memory per-deployment state ───────────────────────────────────────────

class _DepState:
    """Lightweight runtime state for one running deployment."""
    def __init__(self, dep_id: str, strategy_config: dict, symbols: list[str], timeframe: str):
        self.dep_id = dep_id
        self.strategy_config = strategy_config
        self.symbols = symbols
        self.timeframe = timeframe
        # symbol → open DeploymentTrade id (None if flat)
        self.open_trade_ids: dict[str, str] = {}
        # symbol → last bar timestamp processed (to avoid re-processing)
        self.last_bar_ts: dict[str, pd.Timestamp] = {}

_dep_states: dict[str, _DepState] = {}


# ── Helpers ───────────────────────────────────────────────────────────────────

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
        logger.warning("Paper broker: failed to read cache for %s/%s: %s", symbol, timeframe, exc)
        return None


def _extract_symbols_timeframe(strategy_config: dict, dep: Deployment) -> tuple[list[str], str]:
    """Pull symbols and timeframe from deployment config overrides or strategy config."""
    overrides = dep.config_overrides or {}
    symbols_raw = overrides.get("symbols") or strategy_config.get("symbols", [])
    timeframe = overrides.get("timeframe") or strategy_config.get("timeframe", "1d")
    if isinstance(symbols_raw, str):
        symbols_raw = [s.strip().upper() for s in symbols_raw.split(",") if s.strip()]
    symbols = [str(s).upper() for s in symbols_raw if s]
    return symbols, timeframe


def _build_indicators(df: pd.DataFrame, strategy_config: dict) -> pd.DataFrame:
    """Compute indicators needed by the strategy conditions."""
    from app.core.backtest import BacktestEngine
    # BacktestEngine.__init__ collects indicator refs — _compute_indicators is then usable.
    engine = BacktestEngine(strategy_config, {})
    return engine._compute_indicators(df)


# ── Core evaluation ───────────────────────────────────────────────────────────

async def _process_deployment(
    db: AsyncSession,
    dep: Deployment,
    sv: StrategyVersion,
) -> None:
    """Evaluate one running deployment against latest bar data."""
    from app.strategies.conditions import EvalContext, evaluate_conditions
    from app.strategies.stops import calculate_stop
    from app.strategies.sizing import calculate_position_size, _rolling_kelly
    from app.indicators.regime import classify_regime

    config = sv.config
    state = _dep_states.get(dep.id)

    symbols, timeframe = _extract_symbols_timeframe(config, dep)
    if not symbols:
        logger.debug("Paper broker: deployment %s has no symbols configured", dep.id)
        return

    if state is None or state.strategy_config != config:
        state = _DepState(dep.id, config, symbols, timeframe)
        _dep_states[dep.id] = state

    # Load existing open trades from DB for this deployment
    open_result = await db.execute(
        select(DeploymentTrade).where(
            DeploymentTrade.deployment_id == dep.id,
            DeploymentTrade.is_open == True,
        )
    )
    open_trades_db = {t.symbol: t for t in open_result.scalars().all()}

    # Load closed trades for rolling Kelly
    closed_result = await db.execute(
        select(DeploymentTrade).where(
            DeploymentTrade.deployment_id == dep.id,
            DeploymentTrade.is_open == False,
        )
    )
    closed_trades = [
        {"net_pnl": t.net_pnl, "r_multiple": t.r_multiple, "initial_risk": t.initial_risk}
        for t in closed_result.scalars().all()
    ]

    account_equity = float(dep.account.equity or dep.account.current_balance or 100_000.0) if dep.account else 100_000.0

    exit_config = config.get("exit", {})
    entry_config = config.get("entry", {})
    stop_config = config.get("stop_loss", {"method": "fixed_pct", "value": 2.0})
    sizing_config = config.get("position_sizing", {"method": "risk_pct", "risk_pct": 1.0})

    for symbol in symbols:
        df = _load_bars(symbol, timeframe)
        if df is None or len(df) < 30:
            logger.debug("Paper broker: no/insufficient cached data for %s/%s", symbol, timeframe)
            continue

        try:
            idf = _build_indicators(df, config)
        except Exception as exc:
            logger.warning("Paper broker: indicator build failed for %s: %s", symbol, exc)
            continue

        bar_index = len(idf) - 1
        bar = idf.iloc[bar_index]
        current_ts = pd.Timestamp(idf.index[bar_index])

        # Skip if already processed this bar
        if state.last_bar_ts.get(symbol) == current_ts:
            continue

        price = float(bar.get("close", 0))
        if price <= 0:
            continue

        regime_series = classify_regime(df)
        current_regime = str(regime_series.iloc[-1]) if not regime_series.empty else "unknown"

        open_trade = open_trades_db.get(symbol)
        has_position = open_trade is not None
        position_size = float(open_trade.quantity) if open_trade else 0.0

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
        )

        # ── EXIT processing ──────────────────────────────────────────────
        if open_trade:
            exit_triggered = False
            exit_reason = None

            # Stop hit
            if open_trade.current_stop:
                if open_trade.direction == "long" and float(bar.get("low", price)) <= open_trade.current_stop:
                    exit_triggered = True
                    exit_reason = "stop_loss"
                    price = open_trade.current_stop
                elif open_trade.direction == "short" and float(bar.get("high", price)) >= open_trade.current_stop:
                    exit_triggered = True
                    exit_reason = "stop_loss"
                    price = open_trade.current_stop

            # Strategy exit conditions
            if not exit_triggered:
                exit_conditions = exit_config.get("conditions", [])
                exit_logic = exit_config.get("logic", "any_of")
                if exit_conditions and evaluate_conditions(exit_conditions, ctx, exit_logic):
                    exit_triggered = True
                    exit_reason = "signal_exit"

            if exit_triggered:
                gross_pnl = (price - open_trade.entry_price) * open_trade.quantity
                if open_trade.direction == "short":
                    gross_pnl = -gross_pnl
                commission = open_trade.quantity * 0.005 * 2  # round trip
                net_pnl = gross_pnl - commission
                r_multiple = (net_pnl / open_trade.initial_risk) if (open_trade.initial_risk or 0) > 0 else None

                open_trade.exit_time = current_ts.to_pydatetime()
                open_trade.exit_price = price
                open_trade.exit_reason = exit_reason
                open_trade.gross_pnl = gross_pnl
                open_trade.commission = commission
                open_trade.net_pnl = net_pnl
                open_trade.r_multiple = r_multiple
                open_trade.is_open = False
                open_trade.current_price = price
                open_trade.unrealized_pnl = 0.0

                logger.info(
                    "Paper broker: closed %s %s %s @ %.2f (%s) net_pnl=%.2f",
                    dep.id[:8], symbol, open_trade.direction, price, exit_reason, net_pnl,
                )
                has_position = False
                state.open_trade_ids.pop(symbol, None)

        # ── ENTRY processing ─────────────────────────────────────────────
        if not has_position:
            entry_conditions = entry_config.get("conditions", [])
            entry_logic = entry_config.get("logic", "any_of")
            directions = entry_config.get("directions", ["long"])

            for direction in directions:
                if evaluate_conditions(entry_conditions, ctx, entry_logic):
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
                        logger.debug("Paper broker: zero quantity for %s %s, skipping", symbol, direction)
                        break

                    initial_risk = abs(entry_price - stop_price) * quantity if stop_price else None
                    commission = quantity * 0.005

                    trade = DeploymentTrade(
                        id=str(uuid.uuid4()),
                        deployment_id=dep.id,
                        strategy_version_id=dep.strategy_version_id,
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
                    )
                    db.add(trade)

                    logger.info(
                        "Paper broker: opened %s %s %s @ %.2f qty=%.2f stop=%.2f",
                        dep.id[:8], symbol, direction, entry_price, quantity, stop_price or 0,
                    )
                    break  # one direction per symbol per bar

        # Update unrealized P&L on open trade (re-fetch after possible new entry)
        if has_position and open_trade and open_trade.is_open:
            upnl = (price - open_trade.entry_price) * open_trade.quantity
            if open_trade.direction == "short":
                upnl = -upnl
            open_trade.current_price = price
            open_trade.unrealized_pnl = upnl

        state.last_bar_ts[symbol] = current_ts

    await db.flush()


# ── Main loop ─────────────────────────────────────────────────────────────────

async def _run_cycle() -> None:
    """One poll cycle: process all running paper deployments."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Deployment)
            .options(
                selectinload(Deployment.account),
            )
            .where(
                Deployment.mode == "paper",
                Deployment.status == "running",
            )
        )
        deployments = result.scalars().all()

        for dep in deployments:
            try:
                sv = await db.get(StrategyVersion, dep.strategy_version_id)
                if not sv:
                    logger.warning("Paper broker: missing strategy version for deployment %s", dep.id)
                    continue
                await _process_deployment(db, dep, sv)
            except Exception as exc:
                logger.exception("Paper broker: error processing deployment %s: %s", dep.id, exc)

        await db.commit()


async def paper_broker_loop() -> None:
    """Background loop that drives paper broker execution."""
    logger.info("Paper broker executor started (poll interval=%ds)", POLL_INTERVAL_SECONDS)
    while True:
        try:
            await _run_cycle()
        except asyncio.CancelledError:
            logger.info("Paper broker executor shutting down.")
            break
        except Exception as exc:
            logger.exception("Paper broker executor error: %s", exc)

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


_loop_task: asyncio.Task | None = None


def start_paper_broker_loop() -> None:
    """Start the paper broker background task. Call once from app lifespan."""
    global _loop_task
    if _loop_task is None or _loop_task.done():
        _loop_task = asyncio.ensure_future(paper_broker_loop())
        logger.info("Paper broker loop scheduled.")


def stop_paper_broker_loop() -> None:
    """Cancel the paper broker background task on shutdown."""
    global _loop_task
    if _loop_task and not _loop_task.done():
        _loop_task.cancel()
