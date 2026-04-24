from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.account import Account
from app.models.strategy import Strategy, StrategyVersion
from app.models.trading_program import AccountAllocation, TradingProgram


@pytest.mark.asyncio
async def test_bootstrap_governor_creates_active_governor(client, db):
    account = Account(
        id=str(uuid.uuid4()),
        name="Bootstrap Account",
        mode="paper",
        broker="paper_broker",
        initial_balance=100000.0,
        current_balance=100000.0,
        equity=100000.0,
        leverage=1.0,
        max_position_size_pct=0.1,
        max_daily_loss_pct=0.03,
        max_drawdown_lockout_pct=0.1,
        max_open_positions=10,
    )
    db.add(account)
    await db.commit()

    resp = await client.post(f"/api/v1/governor/{account.id}/bootstrap")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["account_id"] == account.id
    assert body["governor_status"] == "active"


@pytest.mark.asyncio
async def test_allocate_lazily_bootstraps_governor(client, db):
    account = Account(
        id=str(uuid.uuid4()),
        name="Allocate Account",
        mode="paper",
        broker="paper_broker",
        initial_balance=100000.0,
        current_balance=100000.0,
        equity=100000.0,
        leverage=1.0,
        max_position_size_pct=0.1,
        max_daily_loss_pct=0.03,
        max_drawdown_lockout_pct=0.1,
        max_open_positions=10,
    )
    strategy = Strategy(
        id=str(uuid.uuid4()),
        name="Gov Strategy",
        category="custom",
        status="draft",
        tags=[],
    )
    version = StrategyVersion(
        id=str(uuid.uuid4()),
        strategy_id=strategy.id,
        version=1,
        config={"entry": {"conditions": []}},
        duration_mode="swing",
        promotion_status="backtest_only",
    )
    program = TradingProgram(
        id=str(uuid.uuid4()),
        name="Deployable Program",
        status="draft",
        strategy_version_id=version.id,
        strategy_governor_id="ctrl-1",
        risk_profile_id="risk-1",
        execution_style_id="exec-1",
        watchlist_subscriptions=["wl-1"],
    )
    db.add_all([account, strategy, version, program])
    await db.commit()

    resp = await client.post(
        f"/api/v1/governor/{account.id}/allocate",
        json={
          "program_id": program.id,
          "allocated_capital_usd": 25000,
          "broker_mode": "paper",
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["account_id"] == account.id
    assert body["program_id"] == program.id

    await db.refresh(program)
    assert program.status == "frozen"

    allocs = await db.execute(select(AccountAllocation).where(AccountAllocation.account_id == account.id))
    assert allocs.scalars().first() is not None
