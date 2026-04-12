"""Test account API endpoints."""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account


@pytest.mark.asyncio
async def test_list_accounts(client: AsyncClient, db: AsyncSession):
    """Test listing accounts."""
    # Create test account
    account = Account(
        name="Test Account",
        mode="paper",
        broker="paper_broker",
        initial_balance=100000.0,
        current_balance=100000.0,
        equity=100000.0,
    )
    db.add(account)
    await db.commit()
    
    response = await client.get("/api/v1/accounts")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert any(acc["name"] == "Test Account" for acc in data)


@pytest.mark.asyncio
async def test_list_accounts_include_activity(client: AsyncClient):
    response = await client.post("/api/v1/accounts", json={
        "name": "Activity Account",
        "mode": "paper",
        "initial_balance": 75000.0,
    })
    assert response.status_code == 201
    account_id = response.json()["id"]

    response = await client.get("/api/v1/accounts", params={"include_activity": "true"})
    assert response.status_code == 200
    data = response.json()
    account = next(acc for acc in data if acc["id"] == account_id)
    assert account["activity"]["deployment_count"] == 0
    assert account["activity"]["active_deployments"] == 0
    assert account["activity"]["open_positions"] == 0
    assert account["activity"]["open_orders"] == 0
    assert account["activity"]["can_delete"] is True


@pytest.mark.asyncio
async def test_create_account(client: AsyncClient):
    """Test creating an account."""
    response = await client.post("/api/v1/accounts", json={
        "name": "New Test Account",
        "mode": "paper",
        "initial_balance": 50000.0,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "New Test Account"
    assert data["initial_balance"] == 50000.0


@pytest.mark.asyncio
async def test_get_account(client: AsyncClient, db: AsyncSession):
    """Test getting a specific account."""
    account = Account(
        name="Get Test Account",
        mode="paper",
        broker="paper_broker",
        initial_balance=100000.0,
        current_balance=100000.0,
        equity=100000.0,
    )
    db.add(account)
    await db.commit()
    
    response = await client.get(f"/api/v1/accounts/{account.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Get Test Account"


@pytest.mark.asyncio
async def test_update_account(client: AsyncClient, db: AsyncSession):
    """Test updating an account."""
    account = Account(
        name="Update Test Account",
        mode="paper",
        broker="paper_broker",
        initial_balance=100000.0,
        current_balance=100000.0,
        equity=100000.0,
    )
    db.add(account)
    await db.commit()
    
    response = await client.put(f"/api/v1/accounts/{account.id}", json={
        "name": "Updated Test Account",
        "initial_balance": 125000.0,
    })
    assert response.status_code == 200
    
    # Verify update
    response = await client.get(f"/api/v1/accounts/{account.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Test Account"
    assert data["initial_balance"] == 125000.0
    assert data["current_balance"] == 125000.0
    assert data["equity"] == 125000.0


@pytest.mark.asyncio
async def test_delete_account(client: AsyncClient, db: AsyncSession):
    """Test deleting an account."""
    account = Account(
        name="Delete Test Account",
        mode="paper",
        broker="paper_broker",
        initial_balance=100000.0,
        current_balance=100000.0,
        equity=100000.0,
    )
    db.add(account)
    await db.commit()

    response = await client.delete(f"/api/v1/accounts/{account.id}")
    assert response.status_code == 204
    
    # Verify deletion
    response = await client.get(f"/api/v1/accounts/{account.id}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_account_blocked_when_active_deployment_exists(client: AsyncClient):
    strategy_response = await client.post(
        "/api/v1/strategies",
        json={
            "name": "Delete Guard Strategy",
            "category": "custom",
            "config": {
                "entry": {
                    "conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}],
                },
            },
        },
    )
    assert strategy_response.status_code == 201
    version_id = strategy_response.json()["version_id"]

    account_response = await client.post("/api/v1/accounts", json={"name": "Protected Account", "mode": "paper"})
    assert account_response.status_code == 201
    account_id = account_response.json()["id"]

    from tests.conftest import seed_fake_credentials
    await seed_fake_credentials(client, account_id, "paper")

    deployment_response = await client.post(
        "/api/v1/deployments/promote-to-paper",
        json={"strategy_version_id": version_id, "account_id": account_id},
    )
    assert deployment_response.status_code == 200

    delete_response = await client.delete(f"/api/v1/accounts/{account_id}")
    assert delete_response.status_code == 409
    detail = delete_response.json()["detail"]
    assert "Cannot delete account" in detail["message"]
    assert detail["activity"]["active_deployments"] == 1
    assert detail["activity"]["can_delete"] is False

    get_response = await client.get(f"/api/v1/accounts/{account_id}")
    assert get_response.status_code == 200


@pytest.mark.asyncio
async def test_delete_account_with_stopped_deployment_history_cleans_up_related_records(client: AsyncClient):
    strategy_response = await client.post(
        "/api/v1/strategies",
        json={
            "name": "Delete Historical Deployment Strategy",
            "category": "custom",
            "config": {
                "entry": {
                    "conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}],
                },
            },
        },
    )
    assert strategy_response.status_code == 201
    version_id = strategy_response.json()["version_id"]

    account_response = await client.post(
        "/api/v1/accounts",
        json={"name": "Historical Deployment Account", "mode": "paper"},
    )
    assert account_response.status_code == 201
    account_id = account_response.json()["id"]

    from tests.conftest import seed_fake_credentials
    await seed_fake_credentials(client, account_id, "paper")

    deployment_response = await client.post(
        "/api/v1/deployments/promote-to-paper",
        json={"strategy_version_id": version_id, "account_id": account_id},
    )
    assert deployment_response.status_code == 200
    deployment_id = deployment_response.json()["id"]

    stop_response = await client.post(
        f"/api/v1/deployments/{deployment_id}/stop",
        json={"reason": "historical cleanup test"},
    )
    assert stop_response.status_code == 200

    activity_response = await client.get("/api/v1/accounts", params={"include_activity": "true"})
    assert activity_response.status_code == 200
    activity_account = next(acc for acc in activity_response.json() if acc["id"] == account_id)
    assert activity_account["activity"]["deployment_count"] == 1
    assert activity_account["activity"]["active_deployments"] == 0
    assert activity_account["activity"]["can_delete"] is True

    delete_response = await client.delete(f"/api/v1/accounts/{account_id}")
    assert delete_response.status_code == 204

    get_response = await client.get(f"/api/v1/accounts/{account_id}")
    assert get_response.status_code == 404

    deployments_response = await client.get("/api/v1/deployments", params={"account_id": account_id})
    assert deployments_response.status_code == 200
    assert deployments_response.json() == []
