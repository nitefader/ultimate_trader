from __future__ import annotations

import pandas as pd
import pytest


@pytest.mark.asyncio
async def test_fetch_data_uses_market_data_service(client, monkeypatch):
    called: dict[str, object] = {}

    def _fake_fetch_market_data(**kwargs):
        called.update(kwargs)
        return pd.DataFrame(
            {"open": [1.0, 1.1], "high": [1.2, 1.3], "low": [0.9, 1.0], "close": [1.1, 1.2], "volume": [100, 120]},
            index=pd.to_datetime(["2024-01-01", "2024-01-02"]),
        )

    monkeypatch.setattr("app.api.routes.data.fetch_market_data", _fake_fetch_market_data)

    resp = await client.post(
        "/api/v1/data/fetch",
        json={
            "symbol": "spy",
            "timeframe": "1d",
            "start": "2024-01-01",
            "end": "2024-01-31",
            "provider": "yfinance",
        },
    )
    assert resp.status_code == 200, resp.text
    assert called["symbol"] == "SPY"
    assert called["provider"] == "yfinance"




@pytest.mark.asyncio
async def test_inventory_uses_market_data_service(client, monkeypatch):
    async def _fake_inventory(db):
        return [{"symbol": "SPY", "timeframe": "1d", "provider": "yfinance"}]

    monkeypatch.setattr(
        "app.api.routes.data.list_inventory_entries",
        _fake_inventory,
    )

    resp = await client.get("/api/v1/data/inventory")
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"][0]["symbol"] == "SPY"


@pytest.mark.asyncio
async def test_search_uses_market_data_service(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.data.search_market_symbols",
        lambda **kwargs: [{"symbol": "AAPL", "name": "Apple Inc."}],
    )

    resp = await client.get("/api/v1/data/search", params={"q": "apple", "provider": "yfinance"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["results"][0]["symbol"] == "AAPL"




@pytest.mark.asyncio
async def test_create_metadata_snapshot_route(client, monkeypatch):
    monkeypatch.setattr(
        "app.services.market_metadata_service.fetch_market_data",
        lambda **kwargs: pd.DataFrame(
            {"open": [1.0] * 90, "high": [1.2] * 90, "low": [0.8] * 90, "close": [1.0 + i * 0.01 for i in range(90)], "volume": [100] * 90},
            index=pd.date_range("2024-01-01", periods=90, freq="D"),
        ),
    )

    resp = await client.post(
        "/api/v1/data/metadata/snapshots",
        json={
            "symbols": ["SPY", "QQQ"],
            "as_of_date": "2024-03-31",
            "provider": "yfinance",
            "sector_overrides": {"SPY": "broad_market"},
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["symbol_count"] == 2
    assert body["metadata_version_id"].startswith("md_20240331_")
    assert all("adv_usd_30d" in item for item in body["symbols"])
    assert all("spread_proxy_bps_30d" in item for item in body["symbols"])
    assert all("regime_tag" in item for item in body["symbols"])

    detail = await client.get(f"/api/v1/data/metadata/snapshots/{body['metadata_version_id']}")
    assert detail.status_code == 200
    assert detail.json()["metadata_version_id"] == body["metadata_version_id"]

    latest = await client.get("/api/v1/data/metadata/snapshots/latest")
    assert latest.status_code == 200
    assert latest.json()["as_of_date"] == "2024-03-31"


@pytest.mark.asyncio
async def test_watchlist_routes_create_list_detail_refresh(client):
    create_resp = await client.post(
        "/api/v1/data/watchlists",
        json={
            "name": "Gap Scanner",
            "watchlist_type": "scanner",
            "refresh_cron": "*/15 * * * *",
            "min_refresh_interval_minutes": 15,
            "symbols": ["aapl", "msft", "AAPL"],
            "config": {"universe": "large_cap"},
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    created = create_resp.json()
    assert created["name"] == "Gap Scanner"
    assert created["watchlist_type"] == "scanner"
    assert [item["symbol"] for item in created["memberships"]] == ["AAPL", "MSFT"]
    assert all(item["state"] == "candidate" for item in created["memberships"])
    assert created["resolved_at"] is not None

    list_resp = await client.get("/api/v1/data/watchlists")
    assert list_resp.status_code == 200, list_resp.text
    items = list_resp.json()["items"]
    assert any(item["id"] == created["id"] for item in items)

    detail_resp = await client.get(f"/api/v1/data/watchlists/{created['id']}")
    assert detail_resp.status_code == 200, detail_resp.text
    assert detail_resp.json()["id"] == created["id"]

    refresh_resp = await client.post(
        f"/api/v1/data/watchlists/{created['id']}/refresh",
        json={"symbols": ["nvda", "amd", "nvda"]},
    )
    assert refresh_resp.status_code == 200, refresh_resp.text
    refreshed = refresh_resp.json()
    memberships_by_symbol = {item["symbol"]: item for item in refreshed["memberships"]}
    assert memberships_by_symbol["AMD"]["state"] == "candidate"
    assert memberships_by_symbol["NVDA"]["state"] == "candidate"
    assert memberships_by_symbol["AAPL"]["state"] == "inactive"
    assert memberships_by_symbol["MSFT"]["state"] == "inactive"
    assert all(item["metadata"]["source"] == "scanner" for item in refreshed["memberships"])


@pytest.mark.asyncio
async def test_watchlist_membership_state_override_route(client):
    create_resp = await client.post(
        "/api/v1/data/watchlists",
        json={
            "name": "Manual Override Scanner",
            "watchlist_type": "scanner",
            "refresh_cron": "*/15 * * * *",
            "symbols": ["spy"],
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    watchlist_id = create_resp.json()["id"]

    suspend_resp = await client.post(
        f"/api/v1/data/watchlists/{watchlist_id}/memberships/SPY/state",
        json={"state": "suspended", "reason": "manual review"},
    )
    assert suspend_resp.status_code == 200, suspend_resp.text
    suspended = suspend_resp.json()
    assert suspended["state"] == "suspended"
    assert suspended["metadata"]["suspension_reason"] == "manual review"

    activate_resp = await client.post(
        f"/api/v1/data/watchlists/{watchlist_id}/memberships/SPY/state",
        json={"state": "active"},
    )
    assert activate_resp.status_code == 200, activate_resp.text
    assert activate_resp.json()["state"] == "active"


@pytest.mark.asyncio
async def test_watchlist_create_requires_refresh_cron_for_scanner(client):
    resp = await client.post(
        "/api/v1/data/watchlists",
        json={
            "name": "Broken Scanner",
            "watchlist_type": "scanner",
            "symbols": ["spy"],
        },
    )
    assert resp.status_code == 400
    assert "refresh_cron" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_watchlist_refresh_missing_watchlist_returns_404(client):
    resp = await client.post(
        "/api/v1/data/watchlists/not-a-real-watchlist/refresh",
        json={"symbols": ["spy"]},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Watchlist not found"
