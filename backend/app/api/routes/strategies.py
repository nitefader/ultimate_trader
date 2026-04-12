"""Strategy CRUD and version management endpoints."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.strategy import Strategy, StrategyVersion

router = APIRouter(prefix="/strategies", tags=["strategies"])

SUPPORTED_BACKTEST_TIMEFRAMES = {"1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"}


class StrategyCreateRequest(BaseModel):
    name: str
    description: str | None = None
    category: str = "custom"
    tags: list[str] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = "Initial version"


class StrategyVersionCreateRequest(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None


class StrategyValidateRequest(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)


def _validate_strategy_config(config: dict[str, Any]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    entry = config.get("entry")
    if not isinstance(entry, dict):
        errors.append("Missing 'entry' configuration")
        entry = {}

    conditions = entry.get("conditions", [])
    if not isinstance(conditions, list) or len(conditions) == 0:
        errors.append("Entry has no conditions")

    stop_loss = config.get("stop_loss")
    if not stop_loss:
        warnings.append("No stop_loss configured — trades may have unbounded risk")

    position_sizing = config.get("position_sizing")
    if not position_sizing:
        warnings.append("No position_sizing configured — using defaults")

    timeframe = config.get("timeframe")
    if isinstance(timeframe, str) and timeframe not in SUPPORTED_BACKTEST_TIMEFRAMES:
        warnings.append(
            f"Timeframe '{timeframe}' is not supported by yfinance backtests. Supported: {', '.join(sorted(SUPPORTED_BACKTEST_TIMEFRAMES))}"
        )

    symbols = config.get("symbols")
    if symbols is not None:
        if not isinstance(symbols, list):
            errors.append("symbols must be a list of ticker strings")
        elif len(symbols) == 0:
            errors.append("symbols cannot be empty when provided")
        elif any(not isinstance(s, str) or not s.strip() for s in symbols):
            errors.append("symbols must contain non-empty ticker strings")

    risk = config.get("risk")
    if isinstance(risk, dict):
        def _safe_float(key: str) -> float | None:
            value = risk.get(key)
            if value is None:
                return None
            try:
                return float(value)
            except (TypeError, ValueError):
                errors.append(f"risk.{key} must be numeric")
                return None

        max_position_size_pct = risk.get("max_position_size_pct")
        max_position_size_pct_f = _safe_float("max_position_size_pct")
        if max_position_size_pct_f is not None and not (0 < max_position_size_pct_f <= 1):
            errors.append("risk.max_position_size_pct must be between 0 and 1")

        max_daily_loss_pct_f = _safe_float("max_daily_loss_pct")
        if max_daily_loss_pct_f is not None and not (0 < max_daily_loss_pct_f <= 1):
            errors.append("risk.max_daily_loss_pct must be between 0 and 1")

        max_open_positions = risk.get("max_open_positions")
        if max_open_positions is not None:
            try:
                if int(max_open_positions) <= 0:
                    errors.append("risk.max_open_positions must be greater than 0")
            except (TypeError, ValueError):
                errors.append("risk.max_open_positions must be an integer")

        max_portfolio_heat_f = _safe_float("max_portfolio_heat")
        if max_portfolio_heat_f is not None and not (0 < max_portfolio_heat_f <= 1):
            errors.append("risk.max_portfolio_heat must be between 0 and 1")

    return errors, warnings


# ── Strategy endpoints ────────────────────────────────────────────────────────

@router.get("")
async def list_strategies(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Strategy).order_by(Strategy.created_at.desc()))
    strategies = result.scalars().all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "description": s.description,
            "category": s.category,
            "status": s.status,
            "tags": s.tags,
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        }
        for s in strategies
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_strategy(body: StrategyCreateRequest, db: AsyncSession = Depends(get_db)):
    errors, warnings = _validate_strategy_config(body.config)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors, "warnings": warnings})

    strategy = Strategy(
        id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        category=body.category,
        tags=body.tags,
        status="draft",
    )
    db.add(strategy)

    # Create first version
    version = StrategyVersion(
        id=str(uuid.uuid4()),
        strategy_id=strategy.id,
        version=1,
        config=body.config,
        notes=body.notes,
    )
    db.add(version)
    await db.flush()
    await db.refresh(strategy)
    return {"id": strategy.id, "version_id": version.id, "status": "created"}


@router.get("/{strategy_id}")
async def get_strategy(strategy_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Strategy)
        .options(selectinload(Strategy.versions))
        .where(Strategy.id == strategy_id)
    )
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "category": s.category,
        "status": s.status,
        "tags": s.tags,
        "versions": [
            {
                "id": v.id,
                "version": v.version,
                "config": v.config,
                "notes": v.notes,
                "promotion_status": v.promotion_status,
                "created_at": v.created_at.isoformat(),
            }
            for v in sorted(s.versions, key=lambda x: x.version, reverse=True)
        ],
        "created_at": s.created_at.isoformat(),
    }


@router.put("/{strategy_id}")
async def update_strategy(strategy_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    s = await db.get(Strategy, strategy_id)
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")
    if "name" in body:
        s.name = body["name"]
    if "description" in body:
        s.description = body["description"]
    if "status" in body:
        s.status = body["status"]
    if "tags" in body:
        s.tags = body["tags"]
    await db.flush()
    return {"id": s.id, "status": "updated"}


@router.delete("/{strategy_id}")
async def delete_strategy(strategy_id: str, db: AsyncSession = Depends(get_db)):
    s = await db.get(Strategy, strategy_id)
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")
    await db.delete(s)
    await db.flush()
    return {"status": "deleted"}


# ── Version endpoints ─────────────────────────────────────────────────────────

@router.post("/{strategy_id}/versions")
async def create_version(strategy_id: str, body: StrategyVersionCreateRequest, db: AsyncSession = Depends(get_db)):
    s = await db.get(Strategy, strategy_id)
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")

    errors, warnings = _validate_strategy_config(body.config)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors, "warnings": warnings})

    # Get latest version number
    result = await db.execute(
        select(StrategyVersion).where(StrategyVersion.strategy_id == strategy_id)
    )
    existing = result.scalars().all()
    next_ver = max((v.version for v in existing), default=0) + 1

    version = StrategyVersion(
        id=str(uuid.uuid4()),
        strategy_id=strategy_id,
        version=next_ver,
        config=body.config,
        notes=body.notes or f"Version {next_ver}",
    )
    db.add(version)
    await db.flush()
    return {"id": version.id, "version": next_ver}


@router.get("/{strategy_id}/versions/{version_id}")
async def get_version(strategy_id: str, version_id: str, db: AsyncSession = Depends(get_db)):
    sv = await db.get(StrategyVersion, version_id)
    if not sv or sv.strategy_id != strategy_id:
        raise HTTPException(status_code=404, detail="Version not found")
    return {
        "id": sv.id,
        "strategy_id": sv.strategy_id,
        "version": sv.version,
        "config": sv.config,
        "notes": sv.notes,
        "promotion_status": sv.promotion_status,
        "created_at": sv.created_at.isoformat(),
    }


@router.post("/validate")
async def validate_strategy(body: StrategyValidateRequest):
    """Validate a strategy configuration without saving it."""
    errors, warnings = _validate_strategy_config(body.config)

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }
