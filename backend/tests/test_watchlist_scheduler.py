"""Tests for the watchlist auto-refresh scheduler."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

import pytest

from app.services.watchlist_scheduler import (
    NAMED_REFRESH_WINDOWS,
    _is_due,
    _last_refresh,
    resolve_cron,
)


# ── resolve_cron ─────────────────────────────────────────────────────────────

def test_resolve_cron_raw_cron_takes_precedence():
    """A raw cron string in refresh_cron overrides config refresh_window."""
    result = resolve_cron("0 9 * * *", {"refresh_window": "market_open"})
    assert result == "0 9 * * *"


def test_resolve_cron_uses_named_window_when_no_raw_cron():
    result = resolve_cron(None, {"refresh_window": "market_open"})
    assert result == NAMED_REFRESH_WINDOWS["market_open"]


def test_resolve_cron_returns_none_when_neither_set():
    result = resolve_cron(None, {})
    assert result is None


def test_resolve_cron_returns_none_for_unknown_window():
    result = resolve_cron(None, {"refresh_window": "not_a_real_window"})
    assert result is None


def test_resolve_cron_handles_none_config():
    result = resolve_cron(None, None)
    assert result is None


def test_all_named_windows_are_valid_5field_cron():
    """Every entry in NAMED_REFRESH_WINDOWS must be a 5-field cron expression."""
    for key, cron in NAMED_REFRESH_WINDOWS.items():
        parts = cron.split()
        assert len(parts) == 5, f"Window '{key}' has invalid cron '{cron}'"


def test_named_windows_cover_expected_keys():
    expected = {
        "pre_market", "market_open", "mid_session", "market_close",
        "eod", "after_hours", "daily_midnight",
        "every_5m", "every_15m", "every_30m", "hourly",
    }
    assert expected == set(NAMED_REFRESH_WINDOWS.keys())


# ── _is_due ───────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def test_is_due_true_when_never_refreshed(monkeypatch):
    """A watchlist that has never been refreshed is always due."""
    wl_id = "test-never-refreshed"
    _last_refresh.pop(wl_id, None)
    assert _is_due(wl_id, effective_cron=None, min_refresh_interval_minutes=60)


def test_is_due_false_when_recently_refreshed(monkeypatch):
    """A watchlist refreshed 1 minute ago with a 60-min interval is not due."""
    wl_id = "test-recent"
    _last_refresh[wl_id] = _utcnow() - timedelta(minutes=1)
    result = _is_due(wl_id, effective_cron=None, min_refresh_interval_minutes=60)
    assert result is False
    del _last_refresh[wl_id]


def test_is_due_true_when_interval_elapsed(monkeypatch):
    """A watchlist refreshed 65 minutes ago with a 60-min interval is due."""
    wl_id = "test-elapsed"
    _last_refresh[wl_id] = _utcnow() - timedelta(minutes=65)
    result = _is_due(wl_id, effective_cron=None, min_refresh_interval_minutes=60)
    assert result is True
    del _last_refresh[wl_id]


def test_is_due_falls_back_to_interval_without_croniter():
    """Without croniter, _is_due uses min_refresh_interval_minutes."""
    import unittest.mock as mock
    wl_id = "test-no-croniter"
    _last_refresh[wl_id] = _utcnow() - timedelta(minutes=10)

    with mock.patch("app.services.watchlist_scheduler._try_import_croniter", return_value=None):
        # 5 min interval, refreshed 10 min ago → due
        assert _is_due(wl_id, effective_cron="0 * * * *", min_refresh_interval_minutes=5)
        # 30 min interval, refreshed 10 min ago → not due
        assert not _is_due(wl_id, effective_cron="0 * * * *", min_refresh_interval_minutes=30)

    del _last_refresh[wl_id]


def test_is_due_invalid_cron_falls_back_to_interval():
    """An unparseable cron expression falls back to interval-based check."""
    import unittest.mock as mock

    # Provide a fake croniter that raises on construction
    class _BadCroniter:
        def __init__(self, *args, **kwargs):
            raise ValueError("bad cron")

    wl_id = "test-bad-cron"
    _last_refresh[wl_id] = _utcnow() - timedelta(minutes=10)

    with mock.patch("app.services.watchlist_scheduler._try_import_croniter", return_value=_BadCroniter):
        assert _is_due(wl_id, effective_cron="not valid cron", min_refresh_interval_minutes=5)
        assert not _is_due(wl_id, effective_cron="not valid cron", min_refresh_interval_minutes=30)

    del _last_refresh[wl_id]


# ── start/stop lifecycle ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_start_stop_scheduler_does_not_raise():
    """start_watchlist_scheduler and stop_watchlist_scheduler are safe to call."""
    import asyncio
    from app.services.watchlist_scheduler import (
        start_watchlist_scheduler,
        stop_watchlist_scheduler,
        _scheduler_task,
    )

    start_watchlist_scheduler()
    # Give the loop a tick so the task is scheduled
    await asyncio.sleep(0)
    stop_watchlist_scheduler()
    # No assertion needed — test passes if no exception raised
