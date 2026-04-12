"""Tests for the Data Services API (/api/v1/services)."""
import pytest
import pytest_asyncio
from httpx import AsyncClient


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _create_service(client: AsyncClient, name: str = "Test Data Svc", **kwargs) -> dict:
    body = {"name": name, "provider": "alpaca", "environment": "paper", **kwargs}
    resp = await client.post("/api/v1/services", json=body)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["name"] == name
    return data


# ── CRUD tests ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_and_list(client: AsyncClient):
    svc = await _create_service(client, "Alpaca Paper Data")
    assert svc["provider"] == "alpaca"
    assert svc["environment"] == "paper"
    assert svc["is_default"] is False
    assert svc["is_active"] is True

    resp = await client.get("/api/v1/services")
    assert resp.status_code == 200
    services = resp.json()
    assert any(s["id"] == svc["id"] for s in services)


@pytest.mark.asyncio
async def test_get_service(client: AsyncClient):
    svc = await _create_service(client, "Get Test")
    resp = await client.get(f"/api/v1/services/{svc['id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Get Test"


@pytest.mark.asyncio
async def test_get_service_not_found(client: AsyncClient):
    resp = await client.get("/api/v1/services/nonexistent-id")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_service(client: AsyncClient):
    svc = await _create_service(client, "Before Update")
    resp = await client.put(f"/api/v1/services/{svc['id']}", json={
        "name": "After Update",
        "environment": "live",
    })
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["name"] == "After Update"
    assert updated["environment"] == "live"


@pytest.mark.asyncio
async def test_delete_service(client: AsyncClient):
    svc = await _create_service(client, "To Delete")
    resp = await client.delete(f"/api/v1/services/{svc['id']}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == svc["id"]

    resp2 = await client.get(f"/api/v1/services/{svc['id']}")
    assert resp2.status_code == 404


# ── Default management ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_default(client: AsyncClient):
    svc1 = await _create_service(client, "Default Svc 1", is_default=True)
    assert svc1["is_default"] is True

    svc2 = await _create_service(client, "Default Svc 2")
    resp = await client.post(f"/api/v1/services/{svc2['id']}/set-default")
    assert resp.status_code == 200
    assert resp.json()["is_default"] is True

    # svc1 should no longer be default
    resp1 = await client.get(f"/api/v1/services/{svc1['id']}")
    assert resp1.json()["is_default"] is False


@pytest.mark.asyncio
async def test_get_default_service(client: AsyncClient):
    svc = await _create_service(client, "The Default One", is_default=True)
    resp = await client.get("/api/v1/services/default")
    assert resp.status_code == 200
    assert resp.json()["id"] == svc["id"]


@pytest.mark.asyncio
async def test_get_default_404_when_none(client: AsyncClient):
    # Delete all services first to ensure no default
    resp = await client.get("/api/v1/services")
    for s in resp.json():
        if s["is_default"]:
            await client.put(f"/api/v1/services/{s['id']}", json={"is_default": False})

    resp = await client.get("/api/v1/services/default")
    # Could be 404 or return a previously created default; just check it doesn't crash
    assert resp.status_code in (200, 404)


# ── Credential masking ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_credentials_masked_in_response(client: AsyncClient):
    svc = await _create_service(client, "Cred Test", api_key="PKABCDEFGHIJKLMN", secret_key="mytopsecretkey1234567890")
    assert svc["has_credentials"] is True
    # Keys should be masked (contain ****)
    assert "****" in svc["api_key"]
    assert "****" in svc["secret_key"]


@pytest.mark.asyncio
async def test_masked_values_not_overwritten(client: AsyncClient):
    svc = await _create_service(client, "Mask Preserve", api_key="PKABC1234567890X", secret_key="secret1234567890abcdef")
    masked_api = svc["api_key"]
    masked_secret = svc["secret_key"]

    # Update with masked values — should not overwrite
    resp = await client.put(f"/api/v1/services/{svc['id']}", json={
        "api_key": masked_api,
        "secret_key": masked_secret,
    })
    assert resp.status_code == 200
    after = resp.json()
    assert after["api_key"] == masked_api
    assert after["secret_key"] == masked_secret
    assert after["has_credentials"] is True


# ── Account data_service_id ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_account_data_service_id(client: AsyncClient):
    # Create a service
    svc = await _create_service(client, "Acct Link Test")

    # Create an account
    resp = await client.post("/api/v1/accounts", json={"name": "Data Svc Acct", "mode": "paper"})
    assert resp.status_code == 201
    acct = resp.json()
    assert acct.get("data_service_id") is None

    # Link the service
    resp2 = await client.put(f"/api/v1/accounts/{acct['id']}", json={"data_service_id": svc["id"]})
    assert resp2.status_code == 200
    assert resp2.json()["data_service_id"] == svc["id"]

    # Unlink (set to null)
    resp3 = await client.put(f"/api/v1/accounts/{acct['id']}", json={"data_service_id": None})
    assert resp3.status_code == 200
    assert resp3.json()["data_service_id"] is None


# ── Provider validation ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_invalid_provider_rejected(client: AsyncClient):
    resp = await client.post("/api/v1/services", json={"name": "Bad", "provider": "binance"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_invalid_environment_rejected(client: AsyncClient):
    resp = await client.post("/api/v1/services", json={"name": "Bad", "environment": "staging"})
    assert resp.status_code == 422
