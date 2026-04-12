import pytest
from datetime import datetime, timedelta, timezone
from tests.conftest import seed_fake_credentials


@pytest.mark.asyncio
async def test_promote_advice_returns_true_when_live_approval_exists(client, db):
    # Create a strategy (creates v1 automatically)
    r = await client.post(
        "/api/v1/strategies",
        json={"name": "Advice Strategy", "category": "custom", "config": {"entry": {"conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}]}}},
    )
    assert r.status_code == 201
    version_id = r.json()["version_id"]

    # Create a paper account
    r = await client.post("/api/v1/accounts", json={"name": "Paper Advice", "mode": "paper"})
    assert r.status_code == 201
    paper_account_id = r.json()["id"]

    await seed_fake_credentials(client, paper_account_id, "paper")

    # Promote to paper
    r = await client.post(
        "/api/v1/deployments/promote-to-paper",
        json={"strategy_version_id": version_id, "account_id": paper_account_id},
    )
    assert r.status_code == 200
    dep_id = r.json()["id"]

    # Create an explicit approval record (simulate a risk/compliance approval)
    from app.models.deployment import DeploymentApproval

    approval = DeploymentApproval(
        deployment_id=dep_id,
        from_mode="paper",
        to_mode="live",
        approved_by="pytest",
        notes="approved for test",
        safety_checklist={"paper_performance_reviewed": True},
    )
    db.add(approval)
    await db.commit()

    # Request promote advice
    r = await client.post("/api/v1/ml/promote-advice", json={"paper_deployment_id": dep_id})
    assert r.status_code == 200
    data = r.json()
    assert data["deployment_id"] == dep_id
    assert data["recommend"] is False
    assert data["checks"]["has_live_approval"] is True
    assert data["checks"]["live_checklist_ready"] is False


@pytest.mark.asyncio
async def test_promote_advice_requires_runtime_and_checklist_for_recommendation(client, db):
    r = await client.post(
        "/api/v1/strategies",
        json={"name": "Advice Runtime Strategy", "category": "custom", "config": {"entry": {"conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}]}}},
    )
    assert r.status_code == 201
    version_id = r.json()["version_id"]

    r = await client.post("/api/v1/accounts", json={"name": "Paper Runtime", "mode": "paper"})
    assert r.status_code == 201
    paper_account_id = r.json()["id"]

    await seed_fake_credentials(client, paper_account_id, "paper")

    r = await client.post(
        "/api/v1/deployments/promote-to-paper",
        json={"strategy_version_id": version_id, "account_id": paper_account_id},
    )
    assert r.status_code == 200
    dep_id = r.json()["id"]

    await client.post(f"/api/v1/deployments/{dep_id}/start", json={})

    from app.models.deployment import DeploymentApproval, Deployment

    dep = await db.get(Deployment, dep_id)
    dep.started_at = datetime.now(timezone.utc) - timedelta(days=35)

    live_approval = DeploymentApproval(
        deployment_id=dep_id,
        from_mode="paper",
        to_mode="live",
        approved_by="pytest",
        notes="full checklist",
        safety_checklist={
            "paper_performance_reviewed": True,
            "risk_limits_confirmed": True,
            "live_account_verified": True,
            "broker_connection_tested": True,
            "compliance_acknowledged": True,
        },
    )
    db.add(live_approval)
    await db.commit()

    r = await client.post("/api/v1/ml/promote-advice", json={"paper_deployment_id": dep_id})
    assert r.status_code == 200
    data = r.json()
    assert data["recommend"] is True
    assert data["checks"]["is_running"] is True
    assert data["checks"]["days_running"] >= 35
    assert data["checks"]["live_checklist_ready"] is True
