"""
Simulation service — manages simulation sessions for the Simulation Lab.

Each simulation is an in-memory BacktestStepper instance keyed by a UUID.
The WebSocket endpoint streams bar snapshots to the frontend.
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

from app.core.stepper import BacktestStepper, BarSnapshot
from app.database import AsyncSessionLocal
from app.models.strategy import StrategyVersion

logger = logging.getLogger(__name__)

# ── In-memory simulation store ────────────────────────────────────────────────

class SimulationSession:
    """One active simulation."""

    def __init__(
        self,
        simulation_id: str,
        stepper: BacktestStepper,
        metadata: dict[str, Any],
    ):
        self.id = simulation_id
        self.stepper = stepper
        self.metadata = metadata
        self.status: str = "ready"  # ready | playing | paused | completed
        self.speed: float = 1.0     # bars per second (1x, 5x, 25x, 100x)
        self.created_at: datetime = datetime.now(timezone.utc)
        self._play_task: asyncio.Task | None = None
        self._ws_callback: Any = None   # async callable(BarSnapshot) for streaming

    def to_dict(self) -> dict[str, Any]:
        return {
            "simulation_id": self.id,
            "status": self.status,
            "speed": self.speed,
            "created_at": self.created_at.isoformat(),
            **self.metadata,
        }


_sessions: dict[str, SimulationSession] = {}

# Cap total active simulations to prevent memory blowup
MAX_ACTIVE_SIMULATIONS = 5


def get_session(simulation_id: str) -> SimulationSession | None:
    return _sessions.get(simulation_id)


def list_sessions() -> list[dict[str, Any]]:
    return [s.to_dict() for s in _sessions.values()]


def delete_session(simulation_id: str) -> bool:
    session = _sessions.pop(simulation_id, None)
    if session:
        if session._play_task and not session._play_task.done():
            session._play_task.cancel()
        return True
    return False


async def create_simulation(
    strategy_version_id: str,
    symbols: list[str],
    timeframe: str,
    start_date: str,
    end_date: str,
    initial_capital: float = 100_000.0,
    commission_per_share: float = 0.005,
    slippage_ticks: int = 1,
    data_provider: str = "auto",
    alpaca_api_key: str | None = None,
    alpaca_secret_key: str | None = None,
) -> dict[str, Any]:
    """
    Create a new simulation session — loads data, precomputes indicators,
    returns metadata so the frontend can set up the chart.

    Smart date clamping: adjusts the date range based on timeframe to avoid
    downloading too much data. For example, 1-minute bars only go back ~5 months.
    """
    if len(_sessions) >= MAX_ACTIVE_SIMULATIONS:
        oldest_id = min(_sessions, key=lambda k: _sessions[k].created_at)
        delete_session(oldest_id)
        logger.info("Evicted oldest simulation %s to make room", oldest_id)

    # ── Auto-resolve Alpaca credentials from configured Data Services ────────
    from app.services.data_limits import clamp_date_range, check_bar_count, INTRADAY_TIMEFRAMES, resolve_alpaca_credentials
    alpaca_api_key, alpaca_secret_key = await resolve_alpaca_credentials(alpaca_api_key, alpaca_secret_key)

    # ── Smart date clamping + provider selection ─────────────────────────────
    from app.services.backtest_service import recommend_data_provider

    effective_start, effective_end, clamped = clamp_date_range(start_date, end_date, timeframe, mode="simulation")
    has_alpaca = bool(alpaca_api_key and alpaca_secret_key)

    # Use backtester's provider recommendation engine
    if data_provider == "auto":
        recommendation = recommend_data_provider(
            timeframe=timeframe,
            start_date=effective_start,
            end_date=effective_end,
            symbol_count=len(symbols),
            has_alpaca_credentials=has_alpaca,
        )
        effective_provider = recommendation["provider"]
        if recommendation.get("warnings"):
            for w in recommendation["warnings"]:
                logger.warning("Simulation provider: %s", w)
        logger.info("Simulation: auto-selected %s (%s)", effective_provider, recommendation.get("reason", ""))
    else:
        effective_provider = data_provider

    # ── Load strategy version and parent strategy name ────────────────────────
    async with AsyncSessionLocal() as db:
        sv = await db.get(StrategyVersion, strategy_version_id)
        if not sv:
            raise ValueError(f"StrategyVersion {strategy_version_id} not found")
        strategy_config = sv.config
        if not strategy_config.get("name"):
            from app.models.strategy import Strategy
            strat = await db.get(Strategy, sv.strategy_id)
            if strat:
                strategy_config["name"] = strat.name

    # ── Fetch market data per symbol ──────────────────────────────────────────
    from app.services.market_data_service import fetch_market_data as sync_fetch
    import asyncio

    data: dict[str, pd.DataFrame] = {}
    skipped: list[str] = []
    loop = asyncio.get_running_loop()

    for symbol in symbols:
        sym_upper = symbol.strip().upper()
        if not sym_upper:
            continue

        fetched = False
        # Try primary provider, then fallback for intraday
        providers_to_try = [effective_provider]
        if effective_provider == "yfinance" and has_alpaca and timeframe in INTRADAY_TIMEFRAMES:
            providers_to_try.append("alpaca")  # fallback
        elif effective_provider == "alpaca":
            providers_to_try.append("yfinance")  # fallback

        for prov in providers_to_try:
            try:
                df = await loop.run_in_executor(
                    None,
                    lambda s=sym_upper, p=prov: sync_fetch(
                        symbol=s,
                        timeframe=timeframe,
                        start=effective_start,
                        end=effective_end,
                        provider=p,
                        api_key=alpaca_api_key or "",
                        secret_key=alpaca_secret_key or "",
                    ),
                )
                if df is not None and not df.empty:
                    check_bar_count(sym_upper, len(df), timeframe, mode="simulation")
                    data[sym_upper] = df
                    if prov != effective_provider:
                        logger.info("Simulation: %s loaded via fallback provider %s (%d bars)", sym_upper, prov, len(df))
                    else:
                        logger.info("Simulation: loaded %s — %d bars (%s to %s)", sym_upper, len(df), effective_start, effective_end)
                    fetched = True
                    break
            except Exception as exc:
                logger.warning("Simulation: %s failed on %s: %s", sym_upper, prov, exc)
                continue

        if not fetched:
            skipped.append(sym_upper)
            logger.warning("Simulation: no data for %s on any provider", sym_upper)

    if not data:
        raise ValueError(
            f"No data returned for any symbol. "
            f"Tried: {', '.join(symbols)}, provider: {effective_provider}, "
            f"range: {effective_start} to {effective_end}"
            + (f" (clamped from {start_date})" if clamped else "")
        )

    run_config = {
        "initial_capital": initial_capital,
        "commission_per_share": commission_per_share,
        "slippage_ticks": slippage_ticks,
        
        "slippage_pct": 0.0,
        "signal_start_date": effective_start,
        "timeframe": timeframe,
        "start_date": effective_start,
        "end_date": effective_end,
    }

    stepper = BacktestStepper(strategy_config, run_config)
    metadata = stepper.prepare(data)

    # Enrich metadata with data quality info
    total_bars = sum(len(df) for df in data.values())
    metadata["provider"] = effective_provider
    metadata["date_clamped"] = clamped
    metadata["original_start_date"] = start_date if clamped else None
    metadata["effective_start_date"] = effective_start
    metadata["effective_end_date"] = effective_end
    metadata["skipped_symbols"] = skipped
    metadata["total_bars_loaded"] = total_bars
    metadata["bars_per_symbol"] = {sym: len(df) for sym, df in data.items()}

    simulation_id = str(uuid.uuid4())
    metadata["simulation_id"] = simulation_id

    session = SimulationSession(
        simulation_id=simulation_id,
        stepper=stepper,
        metadata=metadata,
    )
    _sessions[simulation_id] = session

    logger.info(
        "Created simulation %s: %s symbols, %d bars, %s->%s via %s",
        simulation_id[:8], list(data.keys()), total_bars,
        effective_start, effective_end, effective_provider,
    )

    return metadata


async def step_simulation(simulation_id: str) -> dict[str, Any] | None:
    session = _sessions.get(simulation_id)
    if not session:
        return None
    if not session.stepper.has_next():
        session.status = "completed"
        return session.stepper.finalize()
    snapshot = session.stepper.step()
    return snapshot.to_dict()


async def skip_to_bar(simulation_id: str, target_bar: int) -> dict[str, Any] | None:
    session = _sessions.get(simulation_id)
    if not session:
        return None
    snapshot = session.stepper.skip_to(target_bar)
    if snapshot:
        return snapshot.to_dict()
    return None


async def skip_to_next_trade(simulation_id: str) -> dict[str, Any] | None:
    session = _sessions.get(simulation_id)
    if not session:
        return None
    snapshot = session.stepper.skip_to_next_trade()
    if snapshot:
        return snapshot.to_dict()
    elif not session.stepper.has_next():
        session.status = "completed"
        return session.stepper.finalize()
    return None


async def finalize_simulation(simulation_id: str) -> dict[str, Any] | None:
    session = _sessions.get(simulation_id)
    if not session:
        return None
    session.status = "completed"
    return session.stepper.finalize()


async def get_equity_curve(simulation_id: str) -> list[dict] | None:
    session = _sessions.get(simulation_id)
    if not session:
        return None
    return session.stepper.get_equity_curve()


async def get_all_trades(simulation_id: str) -> list[dict] | None:
    session = _sessions.get(simulation_id)
    if not session:
        return None
    return session.stepper.get_all_trades()
