from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_create_watchlist_route_returns_empty_memberships_without_missing_greenlet(client):
    resp = await client.post(
        "/api/v1/watchlists",
        json={
            "name": "Manual Focus List",
            "watchlist_type": "manual",
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Manual Focus List"
    assert body["watchlist_type"] == "manual"
    assert body["memberships"] == []
    assert body["id"]


@pytest.mark.asyncio
async def test_watchlists_create_and_detail_routes_return_frontend_shape(client):
    create_resp = await client.post(
        "/api/v1/watchlists",
        json={
            "name": "UI Watchlist",
            "watchlist_type": "manual",
        },
    )

    assert create_resp.status_code == 200, create_resp.text
    created = create_resp.json()

    detail_resp = await client.get(f"/api/v1/watchlists/{created['id']}")
    assert detail_resp.status_code == 200, detail_resp.text
    detail = detail_resp.json()

    assert detail["id"] == created["id"]
    assert detail["name"] == "UI Watchlist"
    assert detail["watchlist_type"] == "manual"
    assert "memberships" in detail
    assert isinstance(detail["memberships"], list)
