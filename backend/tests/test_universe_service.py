from __future__ import annotations

import pytest

from app.database import create_all_tables
from app.services.universe_service import persist_symbol_universe_snapshot, resolve_universe_snapshot
from app.services.watchlist_service import create_watchlist, refresh_watchlist, set_watchlist_membership_state


@pytest.mark.asyncio
async def test_resolve_universe_snapshot_from_watchlists(db):
    await create_all_tables()

    primary = await create_watchlist(
        db,
        name="Primary",
        watchlist_type="scanner",
        refresh_cron="*/5 * * * *",
        config={"min_dwell_seconds": 0},
    )
    overlay = await create_watchlist(
        db,
        name="Overlay",
        watchlist_type="scanner",
        refresh_cron="*/5 * * * *",
        config={"min_dwell_seconds": 0},
    )
    await db.flush()
    await refresh_watchlist(db, primary.id, ["AAPL", "MSFT"])
    await refresh_watchlist(db, overlay.id, ["MSFT", "NVDA"])
    await set_watchlist_membership_state(db, primary.id, "AAPL", state="suspended", reason="manual")
    await db.commit()

    snapshot = await resolve_universe_snapshot(
        db,
        source_watchlist_id=primary.id,
        overlay_watchlist_ids=[overlay.id],
        deny_list=["MSFT"],
        top_n=5,
        effective_date="2024-04-01",
    )

    assert snapshot.effective_date.isoformat() == "2024-04-01"
    assert snapshot.source == "watchlist_resolver"
    assert sorted(snapshot.symbols) == ["AAPL", "NVDA"]


@pytest.mark.asyncio
async def test_resolve_universe_snapshot_missing_source_raises(db):
    await create_all_tables()
    with pytest.raises(ValueError, match="Source watchlist not found"):
        await resolve_universe_snapshot(
            db,
            source_watchlist_id="missing",
            effective_date="2024-04-01",
        )


@pytest.mark.asyncio
async def test_persist_symbol_universe_snapshot(db):
    await create_all_tables()

    primary = await create_watchlist(
        db,
        name="Persisted Primary",
        watchlist_type="scanner",
        refresh_cron="*/5 * * * *",
        config={"min_dwell_seconds": 0},
    )
    await db.flush()
    await refresh_watchlist(db, primary.id, ["SPY", "QQQ"])

    persisted = await persist_symbol_universe_snapshot(
        db,
        source_watchlist_id=primary.id,
        effective_date="2024-04-02",
        metadata_version_id="md_test",
    )
    await db.commit()

    assert persisted.source_watchlist_id == primary.id
    assert persisted.resolved_symbols == ["QQQ", "SPY"]
    assert persisted.metadata_version_id == "md_test"
