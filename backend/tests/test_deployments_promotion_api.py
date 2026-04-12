import pytest
from unittest.mock import AsyncMock, patch
from tests.conftest import seed_fake_credentials


@pytest.mark.asyncio
async def test_promote_backtest_to_paper_persists_deployment(client):
    # Create a strategy (creates v1 automatically)
    r = await client.post(
        "/api/v1/strategies",
        json={"name": "Promo Strategy", "description": "test", "category": "custom", "config": {"entry": {"conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}]}}},
    )
    assert r.status_code == 201
    version_id = r.json()["version_id"]

    # Create a paper account
    r = await client.post("/api/v1/accounts", json={"name": "Paper A", "mode": "paper"})
    assert r.status_code == 201
    paper_account_id = r.json()["id"]

    await seed_fake_credentials(client, paper_account_id, "paper")

    # Promote to paper
    r = await client.post(
        "/api/v1/deployments/promote-to-paper",
        json={"strategy_version_id": version_id, "account_id": paper_account_id, "notes": "pytest paper"},
    )
    assert r.status_code == 200
    dep_id = r.json()["id"]

    # Ensure it is listed (durable via DB commit on request end)
    r = await client.get("/api/v1/deployments")
    assert r.status_code == 200
    deployments = r.json()
    assert any(d["id"] == dep_id for d in deployments)


@pytest.mark.asyncio
async def test_promote_paper_to_live_enforces_checklist_and_persists(client):
    # Strategy + paper deployment first
    r = await client.post(
        "/api/v1/strategies",
        json={"name": "Live Promo Strategy", "category": "custom", "config": {"entry": {"conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}]}}},
    )
    assert r.status_code == 201
    version_id = r.json()["version_id"]

    r = await client.post("/api/v1/accounts", json={"name": "Paper B", "mode": "paper"})
    assert r.status_code == 201
    paper_account_id = r.json()["id"]

    await seed_fake_credentials(client, paper_account_id, "paper")

    r = await client.post(
        "/api/v1/deployments/promote-to-paper",
        json={"strategy_version_id": version_id, "account_id": paper_account_id},
    )
    assert r.status_code == 200
    paper_dep_id = r.json()["id"]

    # Live account
    r = await client.post("/api/v1/accounts", json={"name": "Live A", "mode": "live"})
    assert r.status_code == 201
    live_account_id = r.json()["id"]

    await seed_fake_credentials(client, live_account_id, "live")

    # Missing checklist should 400
    r = await client.post(
        "/api/v1/deployments/promote-to-live",
        json={"paper_deployment_id": paper_dep_id, "live_account_id": live_account_id, "safety_checklist": {}},
    )
    assert r.status_code == 400

    checklist = {
        "paper_performance_reviewed": True,
        "risk_limits_confirmed": True,
        "live_account_verified": True,
        "broker_connection_tested": True,
        "compliance_acknowledged": True,
        "market_conditions_assessed": True,
    }
    r = await client.post(
        "/api/v1/deployments/promote-to-live",
        json={
            "paper_deployment_id": paper_dep_id,
            "live_account_id": live_account_id,
            "safety_checklist": checklist,
            "notes": "pytest live",
        },
    )
    assert r.status_code == 200
    live_dep_id = r.json()["id"]

    # Ensure live deployment persisted and references the paper deployment
    r = await client.get(f"/api/v1/deployments/{live_dep_id}")
    assert r.status_code == 200
    dep = r.json()
    assert dep["mode"] == "live"
    assert dep["promoted_from_deployment_id"] == paper_dep_id


@pytest.mark.asyncio
async def test_start_deployment_resumes_paused_deployment(client):
    r = await client.post(
        "/api/v1/strategies",
        json={"name": "Resume Dep Strategy", "category": "custom", "config": {"entry": {"conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}]}}},
    )
    assert r.status_code == 201
    version_id = r.json()["version_id"]

    r = await client.post("/api/v1/accounts", json={"name": "Paper Resume", "mode": "paper"})
    assert r.status_code == 201
    paper_account_id = r.json()["id"]

    await seed_fake_credentials(client, paper_account_id, "paper")

    r = await client.post(
        "/api/v1/deployments/promote-to-paper",
        json={"strategy_version_id": version_id, "account_id": paper_account_id},
    )
    assert r.status_code == 200
    dep_id = r.json()["id"]

    r = await client.post(f"/api/v1/deployments/{dep_id}/start", json={})
    assert r.status_code == 200
    assert r.json()["status"] == "running"


@pytest.mark.asyncio
async def test_global_kill_blocks_deployment_start(client):
    r = await client.post(
        "/api/v1/strategies",
        json={"name": "Killed Start Strategy", "category": "custom", "config": {"entry": {"conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}]}}},
    )
    assert r.status_code == 201
    version_id = r.json()["version_id"]

    r = await client.post("/api/v1/accounts", json={"name": "Paper Kill Start", "mode": "paper"})
    assert r.status_code == 201
    paper_account_id = r.json()["id"]

    await seed_fake_credentials(client, paper_account_id, "paper")

    r = await client.post(
        "/api/v1/deployments/promote-to-paper",
        json={"strategy_version_id": version_id, "account_id": paper_account_id},
    )
    assert r.status_code == 200
    dep_id = r.json()["id"]

    r = await client.post("/api/v1/control/kill-all", json={"reason": "pytest global kill", "triggered_by": "pytest"})
    assert r.status_code == 200

    r = await client.post(f"/api/v1/deployments/{dep_id}/start", json={})
    assert r.status_code == 400

    r = await client.post("/api/v1/control/resume-all", json={"triggered_by": "pytest"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_global_kill_blocks_monitor_close_all(client):
    r = await client.post(
        "/api/v1/strategies",
        json={"name": "Killed Monitor Strategy", "category": "custom", "config": {"entry": {"conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}]}}},
    )
    assert r.status_code == 201
    version_id = r.json()["version_id"]

    r = await client.post(
        "/api/v1/accounts",
        json={"name": "Live Kill Monitor", "mode": "live", "broker": "alpaca"},
    )
    assert r.status_code == 201
    live_account_id = r.json()["id"]

    await seed_fake_credentials(client, live_account_id, "live")

    r = await client.post("/api/v1/accounts", json={"name": "Paper Source", "mode": "paper"})
    assert r.status_code == 201
    paper_account_id = r.json()["id"]

    await seed_fake_credentials(client, paper_account_id, "paper")

    r = await client.post(
        "/api/v1/deployments/promote-to-paper",
        json={"strategy_version_id": version_id, "account_id": paper_account_id},
    )
    assert r.status_code == 200
    paper_dep_id = r.json()["id"]

    checklist = {
        "paper_performance_reviewed": True,
        "risk_limits_confirmed": True,
        "live_account_verified": True,
        "broker_connection_tested": True,
        "compliance_acknowledged": True,
        "market_conditions_assessed": True,
    }
    r = await client.post(
        "/api/v1/deployments/promote-to-live",
        json={"paper_deployment_id": paper_dep_id, "live_account_id": live_account_id, "safety_checklist": checklist},
    )
    assert r.status_code == 200
    live_dep_id = r.json()["id"]

    r = await client.post("/api/v1/control/kill-all", json={"reason": "pytest monitor kill", "triggered_by": "pytest"})
    assert r.status_code == 200

    fake_broker = AsyncMock()
    fake_broker.close_all_positions = AsyncMock(return_value={"status": "ok"})
    with patch("app.api.routes.monitor._get_broker", new=AsyncMock(return_value=fake_broker)):
        r = await client.post(f"/api/v1/monitor/runs/{live_dep_id}/close-all")
    assert r.status_code == 400

    r = await client.post("/api/v1/control/resume-all", json={"triggered_by": "pytest"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_start_deployment_sets_running_and_started_at(client):
    # Strategy
    r = await client.post(
        "/api/v1/strategies",
        json={"name": "Start Dep Strategy", "category": "custom", "config": {"entry": {"conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}]}}},
    )
    assert r.status_code == 201
    version_id = r.json()["version_id"]

    # Paper account
    r = await client.post("/api/v1/accounts", json={"name": "Paper Start", "mode": "paper"})
    assert r.status_code == 201
    paper_account_id = r.json()["id"]

    await seed_fake_credentials(client, paper_account_id, "paper")

    # Promote (pending)
    r = await client.post(
        "/api/v1/deployments/promote-to-paper",
        json={"strategy_version_id": version_id, "account_id": paper_account_id},
    )
    assert r.status_code == 200
    dep_id = r.json()["id"]
    assert r.json()["status"] == "pending"
    assert r.json()["started_at"] is None

    # Start
    r = await client.post(f"/api/v1/deployments/{dep_id}/start", json={})
    assert r.status_code == 200
    assert r.json()["status"] == "running"
    assert r.json()["started_at"] is not None
