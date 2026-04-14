from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.database import create_all_tables
from app.services.watchlist_service import (
    create_watchlist,
    refresh_watchlist,
    set_watchlist_membership_state,
)


def _naive(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None)


def _normalized(dt: datetime | None) -> datetime | None:
    return None if dt is None else dt.replace(tzinfo=None)


@pytest.mark.asyncio
async def test_watchlist_lifecycle_transitions(db, monkeypatch):
    await create_all_tables()
    base_time = datetime(2024, 1, 1, 14, 30, tzinfo=timezone.utc)

    watchlist = await create_watchlist(
        db,
        name="Lifecycle Scanner",
        watchlist_type="scanner",
        refresh_cron="*/5 * * * *",
        config={
            "min_dwell_seconds": 300,
            "reentry_cooldown_seconds": 900,
            "pending_removal_grace_seconds": 3600,
        },
    )
    await db.commit()

    monkeypatch.setattr("app.services.watchlist_service._utcnow", lambda: base_time)
    watchlist = await refresh_watchlist(db, watchlist.id, ["AAPL"])
    membership = next(item for item in watchlist.memberships if item.symbol == "AAPL")
    assert membership.state == "candidate"
    assert _normalized(membership.candidate_since) == _naive(base_time)

    monkeypatch.setattr("app.services.watchlist_service._utcnow", lambda: base_time + timedelta(seconds=301))
    watchlist = await refresh_watchlist(db, watchlist.id, ["AAPL"])
    membership = next(item for item in watchlist.memberships if item.symbol == "AAPL")
    assert membership.state == "active"
    assert _normalized(membership.active_since) == _naive(base_time + timedelta(seconds=301))

    monkeypatch.setattr("app.services.watchlist_service._utcnow", lambda: base_time + timedelta(seconds=302))
    watchlist = await refresh_watchlist(db, watchlist.id, [])
    membership = next(item for item in watchlist.memberships if item.symbol == "AAPL")
    assert membership.state == "pending_removal"
    assert _normalized(membership.pending_removal_since) == _naive(base_time + timedelta(seconds=302))

    monkeypatch.setattr("app.services.watchlist_service._utcnow", lambda: base_time + timedelta(seconds=4000))
    watchlist = await refresh_watchlist(db, watchlist.id, [])
    membership = next(item for item in watchlist.memberships if item.symbol == "AAPL")
    assert membership.state == "inactive"
    assert _normalized(membership.inactive_until) == _naive(base_time + timedelta(seconds=4900))

    monkeypatch.setattr("app.services.watchlist_service._utcnow", lambda: base_time + timedelta(seconds=4200))
    watchlist = await refresh_watchlist(db, watchlist.id, ["AAPL"])
    membership = next(item for item in watchlist.memberships if item.symbol == "AAPL")
    assert membership.state == "inactive"

    monkeypatch.setattr("app.services.watchlist_service._utcnow", lambda: base_time + timedelta(seconds=5001))
    watchlist = await refresh_watchlist(db, watchlist.id, ["AAPL"])
    membership = next(item for item in watchlist.memberships if item.symbol == "AAPL")
    assert membership.state == "candidate"
    assert _normalized(membership.candidate_since) == _naive(base_time + timedelta(seconds=5001))


@pytest.mark.asyncio
async def test_watchlist_manual_suspend_survives_refresh(db, monkeypatch):
    await create_all_tables()
    base_time = datetime(2024, 2, 1, 14, 30, tzinfo=timezone.utc)
    watchlist = await create_watchlist(
        db,
        name="Suspension Scanner",
        watchlist_type="scanner",
        refresh_cron="*/5 * * * *",
        config={"min_dwell_seconds": 0},
    )
    await db.commit()

    monkeypatch.setattr("app.services.watchlist_service._utcnow", lambda: base_time)
    watchlist = await refresh_watchlist(db, watchlist.id, ["SPY"])
    membership = next(item for item in watchlist.memberships if item.symbol == "SPY")
    assert membership.state == "active"

    monkeypatch.setattr("app.services.watchlist_service._utcnow", lambda: base_time + timedelta(seconds=5))
    membership = await set_watchlist_membership_state(db, watchlist.id, "SPY", state="suspended", reason="manual")
    assert membership.state == "suspended"

    monkeypatch.setattr("app.services.watchlist_service._utcnow", lambda: base_time + timedelta(seconds=30))
    watchlist = await refresh_watchlist(db, watchlist.id, [])
    membership = next(item for item in watchlist.memberships if item.symbol == "SPY")
    assert membership.state == "suspended"
