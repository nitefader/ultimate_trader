"""
Smart date clamping and data limits for backtesting and simulation.

Two tiers of limits:
  - BACKTEST: longer horizons for statistical validity (walk-forward, CPCV, OOS testing)
  - SIMULATION: shorter horizons for real-time replay performance (500-bar rolling window)

Both the backtest_service and simulation_service should use these functions.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# ── Backtest limits — generous for statistical testing ────────────────────────
# Walk-forward needs 2-3x the test window for training. CPCV needs even more.
# These limits are high but prevent truly absurd requests (e.g., 10 years of 1m data).

BACKTEST_MAX_LOOKBACK: dict[str, timedelta] = {
    "1m":  timedelta(days=365),      # 1 year of 1-min (~98k bars) — enough for WF
    "5m":  timedelta(days=730),      # 2 years of 5-min (~39k bars)
    "15m": timedelta(days=1095),     # 3 years (~28k bars)
    "30m": timedelta(days=1460),     # 4 years (~20k bars)
    "1h":  timedelta(days=2555),     # 7 years (~11.5k bars)
    "4h":  timedelta(days=3650),     # 10 years (~6.3k bars)
    "1d":  timedelta(days=10950),    # 30 years — practically uncapped
    "1wk": timedelta(days=18250),    # 50 years — practically uncapped
}

# ── Simulation limits — tighter for real-time replay performance ──────────────
# The simulation lab streams bar-by-bar over WebSocket with a 500-bar rolling
# chart window. Shorter data keeps initialization fast and memory low.

SIMULATION_MAX_LOOKBACK: dict[str, timedelta] = {
    "1m":  timedelta(days=120),      # ~5 months (~47k bars)
    "5m":  timedelta(days=365),      # ~1 year (~19k bars)
    "15m": timedelta(days=548),      # ~1.5 years (~14k bars)
    "30m": timedelta(days=730),      # ~2 years (~10k bars)
    "1h":  timedelta(days=1095),     # ~3 years (~5.8k bars)
    "4h":  timedelta(days=1825),     # ~5 years (~2.8k bars)
    "1d":  timedelta(days=7300),     # ~20 years — uncapped for daily
    "1wk": timedelta(days=14600),    # ~40 years — uncapped for weekly
}

# ── Download limits — same as simulation (used by Data Manager /fetch) ────────
DOWNLOAD_MAX_LOOKBACK = SIMULATION_MAX_LOOKBACK

# Warning thresholds — log a warning if bar count exceeds this
BACKTEST_BARS_WARN: dict[str, int] = {
    "1m": 100_000, "5m": 40_000, "15m": 30_000, "30m": 25_000,
    "1h": 15_000, "4h": 8_000, "1d": 8_000, "1wk": 3_000,
}
SIMULATION_BARS_WARN: dict[str, int] = {
    "1m": 50_000, "5m": 20_000, "15m": 15_000, "30m": 12_000,
    "1h": 8_000, "4h": 4_000, "1d": 5_000, "1wk": 2_000,
}

# Intraday timeframes (need Alpaca for reliable data)
INTRADAY_TIMEFRAMES = {"1m", "5m", "15m", "30m", "1h", "4h"}


def clamp_date_range(
    start_date: str,
    end_date: str,
    timeframe: str,
    mode: str = "simulation",
) -> tuple[str, str, bool]:
    """
    Clamp start_date based on timeframe limits.

    mode: "backtest" uses generous limits, "simulation" or "download" uses tighter limits.

    Returns (effective_start, effective_end, was_clamped).
    """
    if mode == "backtest":
        limits = BACKTEST_MAX_LOOKBACK
    else:
        limits = SIMULATION_MAX_LOOKBACK

    try:
        req_end = datetime.strptime(end_date, "%Y-%m-%d")
    except ValueError:
        req_end = datetime.now()

    try:
        req_start = datetime.strptime(start_date, "%Y-%m-%d")
    except ValueError:
        req_start = req_end - limits.get(timeframe, timedelta(days=365))

    max_lookback = limits.get(timeframe, timedelta(days=3650))
    earliest_allowed = req_end - max_lookback

    clamped = False
    if req_start < earliest_allowed:
        req_start = earliest_allowed
        clamped = True
        logger.info(
            "Date clamped [%s]: %s -> %s for %s timeframe (max %s)",
            mode, start_date, req_start.strftime("%Y-%m-%d"), timeframe, max_lookback,
        )

    return req_start.strftime("%Y-%m-%d"), req_end.strftime("%Y-%m-%d"), clamped


def select_provider(
    timeframe: str,
    data_provider: str,
    has_alpaca_creds: bool,
) -> str:
    if data_provider != "auto":
        return data_provider
    if timeframe in INTRADAY_TIMEFRAMES:
        if has_alpaca_creds:
            return "alpaca"
        else:
            logger.warning("Intraday %s without Alpaca creds, using yfinance", timeframe)
            return "yfinance"
    return "alpaca" if has_alpaca_creds else "yfinance"


def check_bar_count(symbol: str, bar_count: int, timeframe: str, mode: str = "simulation") -> None:
    thresholds = BACKTEST_BARS_WARN if mode == "backtest" else SIMULATION_BARS_WARN
    threshold = thresholds.get(timeframe, 10_000)
    if bar_count > threshold:
        logger.warning("%s has %d bars for %s [%s] - consider shorter range", symbol, bar_count, timeframe, mode)


async def resolve_alpaca_credentials(
    api_key: str | None = None,
    secret_key: str | None = None,
) -> tuple[str, str]:
    """
    Resolve real Alpaca API credentials.

    If the provided keys are empty or masked (contain ***), look them up
    from the configured Alpaca Data Service in the database.

    Returns (api_key, secret_key) — may be empty if no service is configured.
    """
    def _is_masked(key: str) -> bool:
        return "***" in key or "*" * 3 in key

    if api_key and secret_key and not _is_masked(api_key) and not _is_masked(secret_key):
        return api_key, secret_key

    # Look up from configured Data Service
    try:
        from sqlalchemy import select as sa_select
        from app.database import AsyncSessionLocal
        from app.models.data_service import DataService

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                sa_select(DataService).where(
                    DataService.provider == "alpaca",
                    DataService.is_active == True,
                ).order_by(DataService.is_default.desc())
            )
            svc = result.scalar_one_or_none()
            if svc and svc.has_credentials():
                logger.info("Resolved Alpaca credentials from service '%s'", svc.name)
                return svc.api_key, svc.secret_key
    except Exception as exc:
        logger.warning("Could not resolve Alpaca credentials from DB: %s", exc)

    return api_key or "", secret_key or ""
