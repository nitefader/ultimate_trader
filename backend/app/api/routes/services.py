"""
API routes for Data Services — shared Alpaca data credentials.

Used by the backtester to download market data via Alpaca, and by live
accounts that choose a shared data service instead of their own keys.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.data_service import DataService

router = APIRouter(prefix="/services", tags=["services"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class DataServiceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    provider: str = Field(default="alpaca", pattern=r"^(alpaca|yfinance)$")
    environment: str = Field(default="paper", pattern=r"^(paper|live)$")
    api_key: str = ""
    secret_key: str = ""
    is_default: bool = False


class DataServiceUpdate(BaseModel):
    name: str | None = None
    provider: str | None = Field(default=None, pattern=r"^(alpaca|yfinance)$")
    environment: str | None = Field(default=None, pattern=r"^(paper|live)$")
    api_key: str | None = None
    secret_key: str | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class DataServiceTestRequest(BaseModel):
    api_key: str = ""
    secret_key: str = ""
    environment: str = "paper"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_masked(value: str) -> bool:
    """Return True if value looks like a masked secret (contains ****)."""
    return "****" in value


async def _clear_other_defaults(db, exclude_id: str | None = None) -> None:
    """Ensure at most one default service exists."""
    result = await db.execute(select(DataService).where(DataService.is_default == True))  # noqa: E712
    for svc in result.scalars().all():
        if svc.id != exclude_id:
            svc.is_default = False


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_services() -> list[dict[str, Any]]:
    """List all configured data services (credentials masked)."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(DataService).order_by(DataService.created_at))
        services = result.scalars().all()
        return [s.to_dict() for s in services]


@router.get("/default")
async def get_default_service() -> dict[str, Any]:
    """Return the default data service, or 404 if none configured."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DataService).where(DataService.is_default == True, DataService.is_active == True)  # noqa: E712
        )
        svc = result.scalar_one_or_none()
        if not svc:
            raise HTTPException(404, "No default data service configured")
        return svc.to_dict()


@router.get("/{service_id}")
async def get_service(service_id: str) -> dict[str, Any]:
    """Get a single data service by ID."""
    async with AsyncSessionLocal() as db:
        svc = await db.get(DataService, service_id)
        if not svc:
            raise HTTPException(404, "Data service not found")
        return svc.to_dict()


@router.post("", status_code=201)
async def create_service(body: DataServiceCreate) -> dict[str, Any]:
    """Create a new data service with optional credentials."""
    async with AsyncSessionLocal() as db:
        svc = DataService(
            id=str(uuid.uuid4()),
            name=body.name.strip(),
            provider=body.provider,
            environment=body.environment,
        )

        if body.api_key:
            svc.api_key = body.api_key
        if body.secret_key:
            svc.secret_key = body.secret_key

        if body.is_default:
            await _clear_other_defaults(db)
            svc.is_default = True

        db.add(svc)
        await db.commit()
        await db.refresh(svc)
        return svc.to_dict()


@router.put("/{service_id}")
async def update_service(service_id: str, body: DataServiceUpdate) -> dict[str, Any]:
    """Update an existing data service. Masked credential values are ignored."""
    async with AsyncSessionLocal() as db:
        svc = await db.get(DataService, service_id)
        if not svc:
            raise HTTPException(404, "Data service not found")

        if body.name is not None:
            svc.name = body.name.strip()
        if body.provider is not None:
            svc.provider = body.provider
        if body.environment is not None:
            svc.environment = body.environment
        if body.is_active is not None:
            svc.is_active = body.is_active

        # Only update credentials if they are not masked placeholders
        if body.api_key is not None and not _is_masked(body.api_key):
            svc.api_key = body.api_key
        if body.secret_key is not None and not _is_masked(body.secret_key):
            svc.secret_key = body.secret_key

        if body.is_default is True:
            await _clear_other_defaults(db, exclude_id=svc.id)
            svc.is_default = True
        elif body.is_default is False:
            svc.is_default = False

        await db.commit()
        await db.refresh(svc)
        return svc.to_dict()


@router.post("/{service_id}/set-default")
async def set_default_service(service_id: str) -> dict[str, Any]:
    """Mark this service as the default (clears other defaults)."""
    async with AsyncSessionLocal() as db:
        svc = await db.get(DataService, service_id)
        if not svc:
            raise HTTPException(404, "Data service not found")

        await _clear_other_defaults(db, exclude_id=svc.id)
        svc.is_default = True
        await db.commit()
        await db.refresh(svc)
        return svc.to_dict()


@router.delete("/{service_id}")
async def delete_service(service_id: str) -> dict[str, str]:
    """Delete a data service."""
    async with AsyncSessionLocal() as db:
        svc = await db.get(DataService, service_id)
        if not svc:
            raise HTTPException(404, "Data service not found")

        await db.delete(svc)
        await db.commit()
        return {"deleted": service_id}


@router.post("/{service_id}/test")
async def test_service_connection(service_id: str) -> dict[str, Any]:
    """Test the data service connection by fetching Alpaca account info."""
    async with AsyncSessionLocal() as db:
        svc = await db.get(DataService, service_id)
        if not svc:
            raise HTTPException(404, "Data service not found")

        if not svc.has_credentials():
            raise HTTPException(400, "No credentials configured for this service")

        from app.services.alpaca_service import build_client_config, validate_credentials
        try:
            config = build_client_config(
                api_key=svc.api_key,
                secret_key=svc.secret_key,
                mode=svc.environment,
            )
            result = validate_credentials(config)
            return result
        except Exception as exc:
            return {"valid": False, "error": str(exc)}


@router.post("/test-inline")
async def test_inline_credentials(body: DataServiceTestRequest) -> dict[str, Any]:
    """Test credentials without saving them first."""
    if not body.api_key or not body.secret_key:
        raise HTTPException(400, "Both api_key and secret_key are required")

    from app.services.alpaca_service import build_client_config, validate_credentials
    try:
        config = build_client_config(
            api_key=body.api_key,
            secret_key=body.secret_key,
            mode=body.environment,
        )
        result = validate_credentials(config)
        return result
    except Exception as exc:
        return {"valid": False, "error": str(exc)}
