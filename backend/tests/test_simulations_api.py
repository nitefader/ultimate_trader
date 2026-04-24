from __future__ import annotations

import uuid

import pytest

from app.models.strategy import Strategy, StrategyVersion
from datetime import datetime, timezone

from app.models.trading_program import TradingProgram
from app.models.watchlist import Watchlist, WatchlistMembership


@pytest.mark.asyncio
async def test_simulation_program_launch_uses_resolved_program_config(client, db, monkeypatch):
    strategy_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    program_id = str(uuid.uuid4())

    strategy = Strategy(
        id=strategy_id,
        name="Simulation Program Strategy",
        category="custom",
        status="draft",
        tags=[],
    )
    version = StrategyVersion(
        id=version_id,
        strategy_id=strategy_id,
        version=1,
        config={
            "entry": {
                "conditions": [
                    {
                        "type": "single",
                        "left": {"field": "close"},
                        "op": ">",
                        "right": {"indicator": "ema", "period": 20},
                    }
                ]
            }
        },
        duration_mode="day",
        promotion_status="backtest_only",
    )
    program = TradingProgram(
        id=program_id,
        name="Simulation Program",
        status="draft",
        strategy_version_id=version_id,
    )
    db.add(strategy)
    db.add(version)
    db.add(program)
    await db.commit()

    captured: dict[str, object] = {}

    async def _fake_create_simulation(**kwargs):
        captured.update(kwargs)
        return {"simulation_id": "sim-1", "strategy_name": "Simulation Program Strategy", "symbols": kwargs["symbols"]}

    monkeypatch.setattr("app.api.routes.simulations.simulation_service.create_simulation", _fake_create_simulation)

    resp = await client.post(
        "/api/v1/simulations/create",
        json={
            "program_id": program_id,
            "symbols": ["QQQ"],
            "timeframe": "5m",
            "start_date": "2024-01-01",
            "end_date": "2024-01-31",
        },
    )
    assert resp.status_code == 200, resp.text
    assert captured["strategy_version_id"] == version_id
    assert captured["symbols"] == ["QQQ"]
    assert isinstance(captured["strategy_config_override"], dict)
    config = captured["strategy_config_override"]
    assert config["entry"]["conditions"][0]["right"] == {"indicator": "ema", "period": 20}


@pytest.mark.asyncio
async def test_simulation_program_launch_uses_resolved_symbols_when_request_symbols_empty(client, db, monkeypatch):
    strategy_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    program_id = str(uuid.uuid4())
    watchlist_id = str(uuid.uuid4())

    strategy = Strategy(
        id=strategy_id,
        name="Simulation Program Symbols",
        category="custom",
        status="draft",
        tags=[],
    )
    version = StrategyVersion(
        id=version_id,
        strategy_id=strategy_id,
        version=1,
        config={"entry": {"conditions": []}},
        duration_mode="day",
        promotion_status="backtest_only",
    )
    watchlist = Watchlist(
        id=watchlist_id,
        name="Program Watchlist",
        watchlist_type="manual",
    )
    program = TradingProgram(
        id=program_id,
        name="Simulation Program Symbols",
        status="draft",
        strategy_version_id=version_id,
        watchlist_subscriptions=[watchlist_id],
    )
    now = datetime.now(timezone.utc)
    membership = WatchlistMembership(
        id=str(uuid.uuid4()),
        watchlist_id=watchlist_id,
        symbol="NVDA",
        state="active",
        resolved_at=now,
        active_since=now,
    )
    db.add(strategy)
    db.add(version)
    db.add(watchlist)
    db.add(program)
    db.add(membership)
    await db.commit()

    captured: dict[str, object] = {}

    async def _fake_create_simulation(**kwargs):
        captured.update(kwargs)
        return {"simulation_id": "sim-2", "strategy_name": "Simulation Program Symbols", "symbols": kwargs["symbols"]}

    monkeypatch.setattr("app.api.routes.simulations.simulation_service.create_simulation", _fake_create_simulation)

    resp = await client.post(
        "/api/v1/simulations/create",
        json={
            "program_id": program_id,
            "symbols": [],
            "timeframe": "5m",
            "start_date": "2024-01-01",
            "end_date": "2024-01-31",
        },
    )
    assert resp.status_code == 200, resp.text
    assert captured["symbols"] == ["NVDA"]
