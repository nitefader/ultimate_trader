from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_resolve_universe_route(client):
    primary = await client.post(
        "/api/v1/data/watchlists",
        json={
            "name": "Primary Universe",
            "watchlist_type": "scanner",
            "refresh_cron": "*/5 * * * *",
            "symbols": ["SPY", "QQQ"],
            "config": {"min_dwell_seconds": 0},
        },
    )
    assert primary.status_code == 200, primary.text
    primary_id = primary.json()["id"]

    overlay = await client.post(
        "/api/v1/data/watchlists",
        json={
            "name": "Overlay Universe",
            "watchlist_type": "scanner",
            "refresh_cron": "*/5 * * * *",
            "symbols": ["IWM", "QQQ"],
            "config": {"min_dwell_seconds": 0},
        },
    )
    assert overlay.status_code == 200, overlay.text
    overlay_id = overlay.json()["id"]

    resp = await client.post(
        "/api/v1/universes/resolve",
        json={
            "source_watchlist_id": primary_id,
            "overlay_watchlist_ids": [overlay_id],
            "deny_list": ["QQQ"],
            "effective_date": "2024-04-01",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["effective_date"] == "2024-04-01"
    assert body["symbols"] == ["IWM", "SPY"]


@pytest.mark.asyncio
async def test_resolve_universe_route_requires_effective_date(client):
    resp = await client.post(
        "/api/v1/universes/resolve",
        json={"source_watchlist_id": "abc"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "effective_date required"


@pytest.mark.asyncio
async def test_create_and_fetch_persisted_universe_route(client):
    primary = await client.post(
        "/api/v1/data/watchlists",
        json={
            "name": "Persisted Primary Universe",
            "watchlist_type": "scanner",
            "refresh_cron": "*/5 * * * *",
            "symbols": ["DIA", "IWM"],
            "config": {"min_dwell_seconds": 0},
        },
    )
    assert primary.status_code == 200, primary.text
    primary_id = primary.json()["id"]

    create_resp = await client.post(
        "/api/v1/universes",
        json={
            "source_watchlist_id": primary_id,
            "effective_date": "2024-04-03",
            "metadata_version_id": "md_test",
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    body = create_resp.json()
    assert body["resolved_symbols"] == ["DIA", "IWM"]
    assert body["metadata_version_id"] == "md_test"

    detail_resp = await client.get(f"/api/v1/universes/{body['id']}")
    assert detail_resp.status_code == 200, detail_resp.text
    assert detail_resp.json()["id"] == body["id"]
