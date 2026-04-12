import pytest
from tests.conftest import seed_fake_credentials


@pytest.mark.asyncio
async def test_promoted_deployments_show_up_in_live_monitor_runs(client):
    # Strategy
    r = await client.post(
        "/api/v1/strategies",
        json={"name": "Monitor Strategy", "category": "custom", "config": {"entry": {"conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}]}}},
    )
    assert r.status_code == 201
    version_id = r.json()["version_id"]

    # Paper account
    r = await client.post("/api/v1/accounts", json={"name": "Paper Monitor", "mode": "paper"})
    assert r.status_code == 201
    paper_account_id = r.json()["id"]

    await seed_fake_credentials(client, paper_account_id, "paper")

    # Promote to paper (starts as pending until explicitly started)
    r = await client.post(
        "/api/v1/deployments/promote-to-paper",
        json={"strategy_version_id": version_id, "account_id": paper_account_id},
    )
    assert r.status_code == 200
    dep_id = r.json()["id"]
    assert r.json()["status"] == "pending"

    # Explicitly start the deployment
    r = await client.post(f"/api/v1/deployments/{dep_id}/start", json={})
    assert r.status_code == 200
    assert r.json()["status"] == "running"
    assert r.json()["started_at"] is not None

    # Live monitor runs should include it
    r = await client.get("/api/v1/monitor/runs")
    assert r.status_code == 200
    runs = r.json()
    assert any(run["id"] == dep_id for run in runs)

