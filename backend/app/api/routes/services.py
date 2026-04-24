"""
API routes for Data Services — shared Alpaca data credentials.

Used by the backtester to download market data via Alpaca, and by live
accounts that choose a shared data service instead of their own keys.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.data_service import DataService
from app.services.alpaca_stream_manager import get_alpaca_stream_manager

router = APIRouter(prefix="/services", tags=["services"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class DataServiceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    provider: str = Field(default="alpaca", pattern=r"^(alpaca|yfinance|gemini|groq)$")
    environment: str = Field(default="paper", pattern=r"^(paper|live|n/a)$")
    api_key: str = ""
    secret_key: str = ""
    is_default: bool = False
    is_default_ai: bool = False
    model: str | None = "gemini-1.5-flash"


class DataServiceUpdate(BaseModel):
    name: str | None = None
    provider: str | None = Field(default=None, pattern=r"^(alpaca|yfinance|gemini|groq)$")
    environment: str | None = Field(default=None, pattern=r"^(paper|live|n/a)$")
    api_key: str | None = None
    secret_key: str | None = None
    is_default: bool | None = None
    is_default_ai: bool | None = None
    is_active: bool | None = None
    model: str | None = None


class DataServiceTestRequest(BaseModel):
    api_key: str = ""
    secret_key: str = ""
    environment: str = "paper"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_masked(value: str) -> bool:
    """Return True if value looks like a masked secret (contains ****)."""
    return "****" in value


async def _clear_other_defaults(db, exclude_id: str | None = None) -> None:
    """Ensure at most one default data service exists."""
    result = await db.execute(select(DataService).where(DataService.is_default == True))  # noqa: E712
    for svc in result.scalars().all():
        if svc.id != exclude_id:
            svc.is_default = False


async def _clear_other_ai_defaults(db, exclude_id: str | None = None) -> None:
    """Ensure at most one default AI service exists."""
    result = await db.execute(select(DataService).where(DataService.is_default_ai == True))  # noqa: E712
    for svc in result.scalars().all():
        if svc.id != exclude_id:
            svc.is_default_ai = False


async def _get_preferred_alpaca_service(db) -> DataService | None:
    result = await db.execute(
        select(DataService)
        .where(
            DataService.provider == "alpaca",
            DataService.is_active == True,  # noqa: E712
        )
        .order_by(DataService.is_default.desc(), DataService.created_at.desc())
    )
    candidates = [svc for svc in result.scalars().all() if svc.has_credentials()]
    if not candidates:
        return None
    defaults = [svc for svc in candidates if svc.is_default]
    if defaults:
        return defaults[0]
    if len(candidates) == 1:
        return candidates[0]
    return candidates[0]


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
        provider_default_model = "llama-3.3-70b-versatile" if body.provider == "groq" else "gemini-1.5-flash"
        svc = DataService(
            id=str(uuid.uuid4()),
            name=body.name.strip(),
            provider=body.provider,
            environment=body.environment,
            model=body.model.strip() if body.model else provider_default_model,
        )

        if body.api_key:
            svc.api_key = body.api_key
        if body.secret_key:
            svc.secret_key = body.secret_key

        if body.is_default:
            await _clear_other_defaults(db)
            svc.is_default = True

        if body.is_default_ai:
            await _clear_other_ai_defaults(db)
            svc.is_default_ai = True

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
        if body.model is not None:
            svc.model = body.model.strip()

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

        if body.is_default_ai is True:
            await _clear_other_ai_defaults(db, exclude_id=svc.id)
            svc.is_default_ai = True
        elif body.is_default_ai is False:
            svc.is_default_ai = False

        await db.commit()
        await db.refresh(svc)
        return svc.to_dict()


@router.post("/{service_id}/set-default")
async def set_default_service(service_id: str) -> dict[str, Any]:
    """Mark this service as the default data service (clears other defaults)."""
    async with AsyncSessionLocal() as db:
        svc = await db.get(DataService, service_id)
        if not svc:
            raise HTTPException(404, "Data service not found")
        if svc.provider in ("gemini", "groq"):
            raise HTTPException(400, f"{svc.provider.title()} is an AI service, not a data service. Use set-default-ai.")

        await _clear_other_defaults(db, exclude_id=svc.id)
        svc.is_default = True
        await db.commit()
        await db.refresh(svc)
        return svc.to_dict()


@router.post("/{service_id}/set-default-ai")
async def set_default_ai_service(service_id: str) -> dict[str, Any]:
    """Mark this service as the default AI service (clears other AI defaults)."""
    async with AsyncSessionLocal() as db:
        svc = await db.get(DataService, service_id)
        if not svc:
            raise HTTPException(404, "Data service not found")
        if svc.provider not in ("gemini", "groq"):
            raise HTTPException(400, "Only AI providers (gemini, groq) can be set as default AI service.")

        await _clear_other_ai_defaults(db, exclude_id=svc.id)
        svc.is_default_ai = True
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
    """Test the data service connection."""
    async with AsyncSessionLocal() as db:
        svc = await db.get(DataService, service_id)
        if not svc:
            raise HTTPException(404, "Data service not found")

        if not svc.has_credentials():
            raise HTTPException(400, "No credentials configured for this service")

        if svc.provider == "gemini":
            import httpx
            # Normalize the model ID (strip spaces/newlines)
            model_id = (svc.model or "gemini-1.5-flash").strip()
            
            # Discovery endpoint verifies the key without consuming generation quota
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}" 
            headers = {"x-goog-api-key": svc.api_key}
            try:
                # Increase timeout for slower network conditions
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return {"valid": True, "status": "connected (discovery)", "buying_power": None}
                elif resp.status_code == 400:
                    return {"valid": False, "error": "Invalid API key"}
                elif resp.status_code == 403:
                    return {"valid": False, "error": "API key unauthorized — check Google Cloud project permissions"}
                elif resp.status_code == 404:
                    return {"valid": False, "error": f"Model '{model_id}' not found or inaccessible"}
                elif resp.status_code == 429:
                    return {"valid": False, "error": "Quota exceeded. Check your billing/usage limits at aistudio.google.com"}
                else:
                    return {"valid": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
            except httpx.ConnectTimeout:
                return {"valid": False, "error": "Connection timed out. Check your internet or VPN/Proxy settings."}
            except httpx.ReadTimeout:
                return {"valid": False, "error": "Google API took too long to respond. Try again in a moment."}
            except Exception as exc:
                return {"valid": False, "error": str(exc)}

        if svc.provider == "groq":
            import httpx
            model_id = (svc.model or "llama-3.3-70b-versatile").strip()
            url = f"https://api.groq.com/openai/v1/models/{model_id}"
            headers = {"Authorization": f"Bearer {svc.api_key}"}
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return {"valid": True, "status": "connected", "buying_power": None}
                elif resp.status_code == 401:
                    return {"valid": False, "error": "Invalid API key"}
                elif resp.status_code == 404:
                    return {"valid": False, "error": f"Model '{model_id}' not found"}
                elif resp.status_code == 429:
                    return {"valid": False, "error": "Rate limit exceeded"}
                else:
                    return {"valid": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
            except httpx.ConnectTimeout:
                return {"valid": False, "error": "Connection timed out. Check your internet or VPN/Proxy settings."}
            except httpx.ReadTimeout:
                return {"valid": False, "error": "Groq API took too long to respond. Try again in a moment."}
            except Exception as exc:
                return {"valid": False, "error": str(exc)}

        from app.services.alpaca_service import build_client_config, validate_credentials
        try:
            config = build_client_config(
                api_key=svc.api_key,
                secret_key=svc.secret_key,
                mode=svc.environment,
            )
            result = await asyncio.get_running_loop().run_in_executor(
                None, lambda: validate_credentials(config)
            )
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
        result = await asyncio.get_running_loop().run_in_executor(
            None, lambda: validate_credentials(config)
        )
        return result
    except Exception as exc:
        return {"valid": False, "error": str(exc)}


@router.get("/alpaca-stream/status")
async def alpaca_stream_status() -> dict[str, Any]:
    """Return the shared Alpaca data stream manager status."""
    async with AsyncSessionLocal() as db:
        preferred = await _get_preferred_alpaca_service(db)
    manager = await get_alpaca_stream_manager()
    if preferred is not None:
        manager.configure_credentials(
            api_key=preferred.api_key,
            secret_key=preferred.secret_key,
            source_id=preferred.id,
            source_name=preferred.name,
            environment=preferred.environment,
        )
    return manager.status()
