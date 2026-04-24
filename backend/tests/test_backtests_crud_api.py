from __future__ import annotations

from datetime import datetime, timezone
import uuid

import pytest

from app.models.run import BacktestRun


async def _seed_run(db, *, status: str = "pending") -> BacktestRun:
    run = BacktestRun(
        id=str(uuid.uuid4()),
        strategy_version_id=str(uuid.uuid4()),
        mode="backtest",
        status=status,
        symbols=["SPY"],
        timeframe="1d",
        start_date="2022-01-01",
        end_date="2022-06-30",
        initial_capital=100000,
        parameters={"lookback": 20},
        created_at=datetime.now(timezone.utc),
    )
    db.add(run)
    await db.commit()
    return run


@pytest.mark.asyncio
async def test_update_pending_run_success(client, db):
    run = await _seed_run(db, status="pending")

    resp = await client.put(
        f"/api/v1/backtests/{run.id}",
        json={
            "symbols": ["spy", "QQQ", "SPY"],
            "timeframe": "1h",
            "start_date": "2023-01-01",
            "end_date": "2023-03-01",
            "initial_capital": 250000,
            "parameters": {"lookback": 50, "threshold": 1.5},
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["symbols"] == ["SPY", "QQQ"]
    assert body["timeframe"] == "1h"
    assert body["start_date"] == "2023-01-01"
    assert body["end_date"] == "2023-03-01"
    assert body["initial_capital"] == 250000


@pytest.mark.asyncio
async def test_update_non_pending_run_rejected(client, db):
    run = await _seed_run(db, status="completed")

    resp = await client.put(
        f"/api/v1/backtests/{run.id}",
        json={"symbols": ["AAPL"]},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_delete_run_success(client, db):
    run = await _seed_run(db, status="failed")

    resp = await client.delete(f"/api/v1/backtests/{run.id}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "deleted"

    get_resp = await client.get(f"/api/v1/backtests/{run.id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_running_run_rejected(client, db):
    run = await _seed_run(db, status="running")

    resp = await client.delete(f"/api/v1/backtests/{run.id}")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_get_run_exposes_feature_plan_preview(client, db):
    run = await _seed_run(db, status="completed")
    run.parameters = {
        "lookback": 20,
        "feature_plan_preview": {
            "symbols": ["SPY"],
            "timeframes": ["5m"],
            "feature_keys": ["5m:ema:close:length=20"],
            "warmup_bars_by_timeframe": {"5m": 60},
            "features": [
                {
                    "kind": "ema",
                    "timeframe": "5m",
                    "source": "close",
                    "params": {"length": 20},
                    "runtime_columns": ["ema_20"],
                },
            ],
        },
    }
    await db.commit()

    resp = await client.get(f"/api/v1/backtests/{run.id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["feature_plan_preview"]["feature_keys"] == ["5m:ema:close:length=20"]
    assert body["feature_plan_preview"]["warmup_bars_by_timeframe"] == {"5m": 60}
