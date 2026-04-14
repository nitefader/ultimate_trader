"""
Watchlist auto-refresh scheduler.

Polls all watchlists with a refresh_cron expression and fires
refresh_watchlist() when the next scheduled time has elapsed.

Design
------
- Runs as a single background asyncio task (start_watchlist_scheduler /
  stop_watchlist_scheduler called from app lifespan).
- Poll interval: TICK_SECONDS (60s). Actual refresh frequency is controlled
  per-watchlist by refresh_cron and min_refresh_interval_minutes.
- Cron parsing uses the 'croniter' library (optional). If croniter is not
  installed, falls back to a simple interval-based check using
  min_refresh_interval_minutes only.
- Only watchlist_types that support auto-refresh are processed:
  "scanner", "index", "sector_rotation", "earnings_calendar".
  "manual" watchlists are skipped — they require explicit user refresh.

Named refresh windows
---------------------
In addition to raw cron syntax, callers may store a named window in
watchlist.config["refresh_window"]. Named windows resolve to a canonical
cron expression (US Eastern time). If refresh_cron is set directly it takes
precedence over the named window.

Available named windows:
  pre_market        08:30 ET weekdays   — before regular session open
  market_open       09:30 ET weekdays   — at the opening bell
  mid_session       12:00 ET weekdays   — midday scan
  market_close      15:45 ET weekdays   — 15 min before regular close
  eod               16:30 ET weekdays   — post-close, after final prints
  after_hours       18:00 ET weekdays   — end of extended hours
  daily_midnight    00:00 UTC daily     — overnight rebuild (index, sector)
  every_5m          */5 * * * *         — intraday scanner tick
  every_15m         */15 * * * *        — slower intraday scan
  every_30m         */30 * * * *        — half-hour scan
  hourly            0 * * * *           — hourly

All ET times are expressed in UTC to avoid DST ambiguity in the cron string:
  09:30 ET = 13:30 UTC (summer) / 14:30 UTC (winter).
  We target the summer (EDT) offset as US markets trade on EDT for the majority
  of the year. Alpaca uses UTC internally.

Raw cron syntax (5-field) is also accepted and takes precedence.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

TICK_SECONDS = 60  # how often the scheduler wakes and checks
AUTO_REFRESH_TYPES = {"scanner", "index", "sector_rotation", "earnings_calendar"}

# Named window → cron (UTC, weekdays Mon–Fri unless noted)
NAMED_REFRESH_WINDOWS: dict[str, str] = {
    "pre_market":      "30 12 * * 1-5",   # 08:30 ET (12:30 UTC EDT)
    "market_open":     "30 13 * * 1-5",   # 09:30 ET (13:30 UTC EDT)
    "mid_session":     "0 16 * * 1-5",    # 12:00 ET (16:00 UTC EDT)
    "market_close":    "45 19 * * 1-5",   # 15:45 ET (19:45 UTC EDT)
    "eod":             "30 20 * * 1-5",   # 16:30 ET (20:30 UTC EDT)
    "after_hours":     "0 22 * * 1-5",    # 18:00 ET (22:00 UTC EDT)
    "daily_midnight":  "0 0 * * *",       # 00:00 UTC every day
    "every_5m":        "*/5 * * * *",
    "every_15m":       "*/15 * * * *",
    "every_30m":       "*/30 * * * *",
    "hourly":          "0 * * * *",
}

# Per-watchlist: tracks when it was last refreshed
_last_refresh: dict[str, datetime] = {}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _try_import_croniter() -> Any:
    try:
        from croniter import croniter  # type: ignore[import]
        return croniter
    except ImportError:
        return None


def resolve_cron(refresh_cron: str | None, config: dict | None) -> str | None:
    """
    Resolve the effective cron string for a watchlist.

    Priority:
    1. refresh_cron (raw cron) — if set, used as-is.
    2. config["refresh_window"] — resolved via NAMED_REFRESH_WINDOWS.
    3. None — scheduler falls back to min_refresh_interval_minutes.
    """
    if refresh_cron:
        return refresh_cron
    window = (config or {}).get("refresh_window")
    if window:
        resolved = NAMED_REFRESH_WINDOWS.get(str(window).lower())
        if resolved:
            return resolved
        logger.warning("watchlist_scheduler: unknown refresh_window '%s'", window)
    return None


def _is_due(
    watchlist_id: str,
    effective_cron: str | None,
    min_refresh_interval_minutes: int,
) -> bool:
    """Return True if this watchlist is due for a refresh."""
    now = _utcnow()
    last = _last_refresh.get(watchlist_id)

    if effective_cron is None:
        if last is None:
            return True
        elapsed = (now - last).total_seconds() / 60.0
        return elapsed >= max(min_refresh_interval_minutes, 1)

    croniter = _try_import_croniter()
    if croniter is None:
        if last is None:
            return True
        elapsed = (now - last).total_seconds() / 60.0
        return elapsed >= max(min_refresh_interval_minutes, 1)

    try:
        cron = croniter(effective_cron, last or now)
        prev_scheduled = cron.get_prev(datetime)
        if last is None:
            return True
        return prev_scheduled > last
    except Exception as exc:
        logger.warning("watchlist_scheduler: invalid cron '%s': %s", effective_cron, exc)
        if last is None:
            return True
        elapsed = (now - last).total_seconds() / 60.0
        return elapsed >= max(min_refresh_interval_minutes, 1)


async def _tick() -> None:
    """One scheduler tick: scan watchlists, refresh those that are due."""
    from app.database import AsyncSessionLocal
    from app.models.watchlist import Watchlist
    from app.services.watchlist_service import refresh_watchlist
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Watchlist))
        watchlists = result.scalars().all()

        for wl in watchlists:
            if wl.watchlist_type not in AUTO_REFRESH_TYPES:
                continue

            effective_cron = resolve_cron(wl.refresh_cron, wl.config)
            due = _is_due(
                wl.id,
                effective_cron=effective_cron,
                min_refresh_interval_minutes=int(wl.min_refresh_interval_minutes or 5),
            )
            if not due:
                continue

            logger.info(
                "watchlist_scheduler: refreshing '%s' (%s) id=%s",
                wl.name, wl.watchlist_type, wl.id,
            )
            try:
                # Pass through config-defined symbols for static/index types.
                # Scanner types typically define symbols in config.
                symbols = wl.config.get("symbols") if isinstance(wl.config, dict) else None
                await refresh_watchlist(db, wl.id, symbols=symbols)
                await db.commit()
                _last_refresh[wl.id] = _utcnow()
                logger.info("watchlist_scheduler: refreshed '%s' OK", wl.name)
            except Exception as exc:
                logger.warning(
                    "watchlist_scheduler: refresh failed for '%s' (%s): %s",
                    wl.name, wl.id, exc,
                )
                await db.rollback()


async def _scheduler_loop() -> None:
    """Background loop: wake every TICK_SECONDS and process due watchlists."""
    logger.info("watchlist_scheduler: started (tick=%ds)", TICK_SECONDS)
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            logger.info("watchlist_scheduler: shutting down")
            break
        except Exception as exc:
            logger.exception("watchlist_scheduler: unexpected error: %s", exc)
        await asyncio.sleep(TICK_SECONDS)


_scheduler_task: asyncio.Task | None = None


def start_watchlist_scheduler() -> None:
    """Start the watchlist auto-refresh background task. Call once from app lifespan."""
    global _scheduler_task
    if _scheduler_task is None or _scheduler_task.done():
        _scheduler_task = asyncio.ensure_future(_scheduler_loop())
        logger.info("watchlist_scheduler: scheduled")


def stop_watchlist_scheduler() -> None:
    """Cancel the watchlist scheduler on shutdown."""
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
