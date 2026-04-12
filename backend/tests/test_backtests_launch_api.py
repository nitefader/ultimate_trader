from __future__ import annotations

from types import SimpleNamespace

import pytest


@pytest.mark.asyncio
async def test_launch_requires_strategy_version_id(client):
    resp = await client.post("/api/v1/backtests/launch", json={})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_launch_404_for_unknown_strategy_version(client):
    resp = await client.post(
        "/api/v1/backtests/launch",
        json={
            "strategy_version_id": "00000000-0000-0000-0000-000000000001",
            "symbols": ["SPY"],
            "timeframe": "1d",
            "start_date": "2024-01-01",
            "end_date": "2024-12-31",
        },
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_launch_rejects_unsupported_timeframe(client):
    strategy_resp = await client.post(
        "/api/v1/strategies",
        json={
            "name": "Launch Timeframe Guard",
            "config": {
                "entry": {
                    "conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}],
                },
            },
        },
    )
    assert strategy_resp.status_code == 201
    version_id = strategy_resp.json()["version_id"]

    resp = await client.post(
        "/api/v1/backtests/launch",
        json={
            "strategy_version_id": version_id,
            "symbols": ["SPY"],
            "timeframe": "2h",
            "start_date": "2024-01-01",
            "end_date": "2024-12-31",
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_launch_rejects_yfinance_with_4h(client):
    strategy_resp = await client.post(
        "/api/v1/strategies",
        json={
            "name": "Launch Provider Guard",
            "config": {
                "entry": {
                    "conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}],
                },
            },
        },
    )
    assert strategy_resp.status_code == 201
    version_id = strategy_resp.json()["version_id"]

    resp = await client.post(
        "/api/v1/backtests/launch",
        json={
            "strategy_version_id": version_id,
            "symbols": ["SPY"],
            "timeframe": "4h",
            "data_provider": "yfinance",
            "start_date": "2024-01-01",
            "end_date": "2024-12-31",
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_launch_rejects_end_before_start(client):
    strategy_resp = await client.post(
        "/api/v1/strategies",
        json={
            "name": "Launch Date Guard",
            "config": {
                "entry": {
                    "conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}],
                },
            },
        },
    )
    assert strategy_resp.status_code == 201
    version_id = strategy_resp.json()["version_id"]

    resp = await client.post(
        "/api/v1/backtests/launch",
        json={
            "strategy_version_id": version_id,
            "symbols": ["SPY"],
            "timeframe": "1d",
            "start_date": "2024-12-31",
            "end_date": "2024-01-01",
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_launch_normalizes_symbols_and_returns_success(client, monkeypatch):
    strategy_resp = await client.post(
        "/api/v1/strategies",
        json={
            "name": "Launch Symbol Normalize",
            "config": {
                "entry": {
                    "conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}],
                },
            },
        },
    )
    assert strategy_resp.status_code == 201
    version_id = strategy_resp.json()["version_id"]

    async def _fake_launch_backtest(db, strategy_version_id, strategy_config, run_config):
        assert run_config["symbols"] == ["SPY", "QQQ"]
        assert run_config["timeframe"] == "1d"
        return SimpleNamespace(id="run-1", status="completed", error_message=None)

    monkeypatch.setattr("app.api.routes.backtests.launch_backtest", _fake_launch_backtest)

    resp = await client.post(
        "/api/v1/backtests/launch",
        json={
            "strategy_version_id": version_id,
            "symbols": [" spy ", "QQQ", "spy"],
            "timeframe": "1d",
            "start_date": "2024-01-01",
            "end_date": "2024-12-31",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["run_id"] == "run-1"
    assert body["status"] == "completed"


@pytest.mark.asyncio
async def test_launch_forwards_walk_forward_and_commission_pct(client, monkeypatch):
    strategy_resp = await client.post(
        "/api/v1/strategies",
        json={
            "name": "Launch Walk Forward Forwarding",
            "config": {
                "entry": {
                    "conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}],
                },
            },
        },
    )
    assert strategy_resp.status_code == 201
    version_id = strategy_resp.json()["version_id"]

    async def _fake_launch_backtest(db, strategy_version_id, strategy_config, run_config):
        assert run_config["commission_pct_per_trade"] == 0.1
        assert run_config["walk_forward"]["enabled"] is True
        assert run_config["walk_forward"]["train_window_months"] == 12
        assert run_config["walk_forward"]["test_window_months"] == 3
        return SimpleNamespace(id="run-wf", status="completed", error_message=None)

    monkeypatch.setattr("app.api.routes.backtests.launch_backtest", _fake_launch_backtest)

    resp = await client.post(
        "/api/v1/backtests/launch",
        json={
            "strategy_version_id": version_id,
            "symbols": ["SPY"],
            "timeframe": "1d",
            "start_date": "2018-01-01",
            "end_date": "2024-12-31",
            "commission_pct_per_trade": 0.1,
            "walk_forward": {
                "enabled": True,
                "train_window_months": 12,
                "test_window_months": 3,
            },
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["run_id"] == "run-wf"


@pytest.mark.asyncio
async def test_launch_forwards_provider_fields(client, monkeypatch):
    strategy_resp = await client.post(
        "/api/v1/strategies",
        json={
            "name": "Launch Provider Forwarding",
            "config": {
                "entry": {
                    "conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}],
                },
            },
        },
    )
    assert strategy_resp.status_code == 201
    version_id = strategy_resp.json()["version_id"]

    async def _fake_launch_backtest(db, strategy_version_id, strategy_config, run_config):
        assert run_config["data_provider"] == "alpaca"
        assert run_config["alpaca_api_key"] == "key"
        assert run_config["alpaca_secret_key"] == "secret"
        return SimpleNamespace(id="run-provider", status="completed", error_message=None)

    monkeypatch.setattr("app.api.routes.backtests.launch_backtest", _fake_launch_backtest)

    resp = await client.post(
        "/api/v1/backtests/launch",
        json={
            "strategy_version_id": version_id,
            "symbols": ["SPY"],
            "timeframe": "1h",
            "start_date": "2024-10-01",
            "end_date": "2024-12-31",
            "data_provider": "alpaca",
            "alpaca_api_key": "key",
            "alpaca_secret_key": "secret",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["run_id"] == "run-provider"


@pytest.mark.asyncio
async def test_provider_recommendation_prefers_alpaca_for_4h_with_creds(client):
    resp = await client.post(
        "/api/v1/backtests/provider-recommendation",
        json={
            "symbols": ["SPY"],
            "timeframe": "4h",
            "start_date": "2024-01-01",
            "end_date": "2024-12-31",
            "has_alpaca_credentials": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["provider"] == "alpaca"
