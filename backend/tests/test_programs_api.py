from __future__ import annotations

import uuid

import pytest

from app.models.account import Account
from app.models.trading_program import TradingProgram


@pytest.mark.asyncio
async def test_create_program_returns_notes(client):
    resp = await client.post(
        "/api/v1/programs",
        json={
            "name": "Program With Notes",
            "description": "Program description",
            "notes": "Program notes go here.",
            "duration_mode": "swing",
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Program With Notes"
    assert body["notes"] == "Program notes go here."


@pytest.mark.asyncio
async def test_validate_program_reports_missing_components(client, db):
    program = TradingProgram(
        id=str(uuid.uuid4()),
        name="Incomplete Program",
        status="draft",
        duration_mode="day",
        watchlist_subscriptions=[],
    )
    db.add(program)
    await db.commit()

    resp = await client.post(f"/api/v1/programs/{program.id}/validate")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["can_deploy"] is False
    assert "strategy" in body["missing_components"]
    assert "strategy controls" in body["missing_components"]
    assert "Day-mode programs are safer with Strategy Controls attached for session and PDT gating." in body["warnings"]


@pytest.mark.asyncio
async def test_program_auto_locks_on_allocation_and_unlocks_on_stop(client, db):
    account = Account(
        id=str(uuid.uuid4()),
        name="Program Account",
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
    program = TradingProgram(
        id=str(uuid.uuid4()),
        name="Deployable Program",
        status="draft",
        duration_mode="swing",
        strategy_version_id="sv-1",
        strategy_governor_id="ctrl-1",
        risk_profile_id="risk-1",
        execution_style_id="exec-1",
        watchlist_subscriptions=["wl-1"],
    )
    db.add_all([account, program])
    await db.commit()

    create_resp = await client.post(
        f"/api/v1/programs/{program.id}/allocations",
        json={"account_id": account.id, "allocated_capital_usd": 10000, "broker_mode": "paper"},
    )
    assert create_resp.status_code == 200, create_resp.text

    await db.refresh(program)
    assert program.status == "frozen"
    assert program.frozen_at is not None

    allocation_id = create_resp.json()["id"]
    stop_resp = await client.post(f"/api/v1/programs/{program.id}/allocations/{allocation_id}/stop")
    assert stop_resp.status_code == 200, stop_resp.text

    await db.refresh(program)
    assert program.status == "draft"
    assert program.frozen_at is None
    assert program.frozen_by is None
