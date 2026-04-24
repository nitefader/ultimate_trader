from __future__ import annotations

import re
import uuid

import pytest

from app.models.run import BacktestRun
from app.models.strategy import Strategy, StrategyVersion
from app.models.trading_program import TradingProgram

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


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

    async def _fake_launch_backtest(db, strategy_version_id, strategy_config, run_config, **kwargs):
        assert run_config["symbols"] == ["SPY", "QQQ"]
        assert run_config["timeframe"] == "1d"

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
    # Route creates the run record and returns a UUID immediately (async background execution)
    assert _UUID_RE.match(body["run_id"]), f"Expected UUID run_id, got: {body['run_id']}"
    assert body["status"] == "pending"


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

    async def _fake_launch_backtest(db, strategy_version_id, strategy_config, run_config, **kwargs):
        assert run_config["commission_pct_per_trade"] == 0.1
        assert run_config["walk_forward"]["enabled"] is True
        assert run_config["walk_forward"]["train_window_months"] == 12
        assert run_config["walk_forward"]["test_window_months"] == 3

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
    assert _UUID_RE.match(body["run_id"]), f"Expected UUID run_id, got: {body['run_id']}"


@pytest.mark.asyncio
async def test_launch_forwards_cpcv_config(client, monkeypatch):
    strategy_resp = await client.post(
        "/api/v1/strategies",
        json={
            "name": "Launch CPCV Forwarding",
            "config": {
                "entry": {
                    "conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}],
                },
            },
        },
    )
    assert strategy_resp.status_code == 201
    version_id = strategy_resp.json()["version_id"]

    async def _fake_launch_backtest(db, strategy_version_id, strategy_config, run_config, **kwargs):
        assert run_config["cpcv"]["enabled"] is True
        assert run_config["cpcv"]["n_paths"] == 8
        assert run_config["cpcv"]["k_test_paths"] == 2

    monkeypatch.setattr("app.api.routes.backtests.launch_backtest", _fake_launch_backtest)

    resp = await client.post(
        "/api/v1/backtests/launch",
        json={
            "strategy_version_id": version_id,
            "symbols": ["SPY"],
            "timeframe": "1d",
            "start_date": "2018-01-01",
            "end_date": "2024-12-31",
            "cpcv": {
                "enabled": True,
                "n_paths": 8,
                "k_test_paths": 2,
                "embargo_bars": 3,
                "max_combos": 20,
                "min_bars_path": 25,
            },
        },
    )
    assert resp.status_code == 200
    assert _UUID_RE.match(resp.json()["run_id"]), f"Expected UUID run_id, got: {resp.json()['run_id']}"


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

    async def _fake_launch_backtest(db, strategy_version_id, strategy_config, run_config, **kwargs):
        assert run_config["data_provider"] == "alpaca"
        assert run_config["alpaca_api_key"] == "key"
        assert run_config["alpaca_secret_key"] == "secret"

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
    assert _UUID_RE.match(resp.json()["run_id"]), f"Expected UUID run_id, got: {resp.json()['run_id']}"


def _trap_background_tasks(monkeypatch):
    async def _fake_run_backtest_background(*args, **kwargs):
        return None

    monkeypatch.setattr("app.api.routes.backtests._run_backtest_background", _fake_run_backtest_background)


@pytest.mark.asyncio
async def test_launch_persists_feature_plan_preview_immediately(client, db, monkeypatch):
    _trap_background_tasks(monkeypatch)

    strategy_resp = await client.post(
        "/api/v1/strategies",
        json={
            "name": "Launch Preview Snapshot",
            "config": {
                "entry": {
                    "conditions": [
                        {
                            "type": "single",
                            "left": {"field": "close"},
                            "op": ">",
                            "right": {"indicator": "ema", "period": 20},
                        }
                    ],
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
            "timeframe": "5m",
            "start_date": "2024-01-01",
            "end_date": "2024-01-31",
        },
    )
    assert resp.status_code == 200, resp.text

    run = await db.get(BacktestRun, resp.json()["run_id"])
    assert run is not None
    assert isinstance(run.parameters.get("feature_plan_preview"), dict)
    feature_keys = run.parameters["feature_plan_preview"]["feature_keys"]
    assert len(feature_keys) == 1
    assert '"kind":"ema"' in feature_keys[0]
    assert '"period":20' in feature_keys[0]


@pytest.mark.asyncio
async def test_program_launch_persists_overlay_feature_plan_preview_immediately(client, db, monkeypatch):
    _trap_background_tasks(monkeypatch)

    strategy_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    program_id = str(uuid.uuid4())
    strategy = Strategy(
        id=strategy_id,
        name="Program Launch Preview Strategy",
        category="custom",
        status="draft",
        tags=[],
    )
    version = StrategyVersion(
        id=version_id,
        strategy_id=strategy_id,
        version=1,
        config={
            "symbols": ["SPY"],
            "entry": {
                "conditions": [
                    {
                        "type": "single",
                        "left": {"field": "close"},
                        "op": ">",
                        "right": {"indicator": "opening_range_high"},
                    }
                ],
            },
        },
        duration_mode="day",
        promotion_status="backtest_only",
    )
    program = TradingProgram(
        id=program_id,
        name="Program Launch Preview",
        status="draft",
        strategy_version_id=version_id,
    )
    db.add(strategy)
    db.add(version)
    db.add(program)
    await db.commit()

    resp = await client.post(
        "/api/v1/backtests/launch",
        json={
            "program_id": program_id,
            "symbols": ["QQQ"],
            "timeframe": "5m",
            "start_date": "2024-01-01",
            "end_date": "2024-01-31",
        },
    )
    assert resp.status_code == 200, resp.text

    run = await db.get(BacktestRun, resp.json()["run_id"])
    assert run is not None
    preview = run.parameters.get("feature_plan_preview")
    assert isinstance(preview, dict)
    assert preview["symbols"] == ["QQQ"]
    assert any("opening_range_high" in key for key in preview["feature_keys"])


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
