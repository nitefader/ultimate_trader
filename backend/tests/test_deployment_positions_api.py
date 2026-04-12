import pytest
from tests.conftest import seed_fake_credentials


@pytest.mark.asyncio
async def test_deployment_positions_endpoint_does_not_crash_without_credentials(client):
    # Strategy + paper deployment first
    r = await client.post(
        "/api/v1/strategies",
        json={"name": "Positions Strategy", "category": "custom", "config": {"entry": {"conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}]}}},
    )
    assert r.status_code == 201
    version_id = r.json()["version_id"]

    r = await client.post("/api/v1/accounts", json={"name": "Live NoCreds", "mode": "live"})
    assert r.status_code == 201
    live_account_id = r.json()["id"]

    await seed_fake_credentials(client, live_account_id, "live")

    # Create a paper deployment to use as source for live promotion
    r = await client.post("/api/v1/accounts", json={"name": "Paper For Positions", "mode": "paper"})
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

    # No credentials configured: should return empty positions, not 500
    r = await client.get(f"/api/v1/deployments/{live_dep_id}/positions")
    assert r.status_code == 200
    body = r.json()
    assert body["positions"] == []


