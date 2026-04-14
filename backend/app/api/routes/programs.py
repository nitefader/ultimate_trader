"""TradingProgram and AccountAllocation REST API endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.trading_program import AccountAllocation, TradingProgram
from app.services.promotion_service import (
    PromotionError,
    execute_promotion,
    prepare_promotion_review,
    revert_promotion,
    serialize_allocation,
    serialize_trading_program,
)

router = APIRouter(prefix="/programs", tags=["programs"])


# ── Request models ────────────────────────────────────────────────────────────

class CreateProgramRequest(BaseModel):
    name: str
    description: str | None = None
    strategy_version_id: str | None = None
    optimization_profile_id: str | None = None
    weight_profile_id: str | None = None
    symbol_universe_snapshot_id: str | None = None
    execution_policy: dict[str, Any] = {}
    duration_mode: str = "swing"
    parent_program_id: str | None = None


class FreezeProgramRequest(BaseModel):
    frozen_by: str = "user"


class CreateAllocationRequest(BaseModel):
    account_id: str
    allocated_capital_usd: float = 0.0
    conflict_resolution: str = "first_wins"
    broker_mode: str = "paper"
    position_size_scale_pct: float | None = None
    session_window_shift_min: int | None = None
    drawdown_threshold_pct: float | None = None
    notes: str | None = None


class PromotionReviewRequest(BaseModel):
    paper_perf_summary: dict[str, Any] = {}
    safety_checklist: dict[str, bool] = {}
    reviewer: str = "user"


class ExecutePromotionRequest(BaseModel):
    review_payload: dict[str, Any]
    promoted_by: str = "user"


class RevertPromotionRequest(BaseModel):
    reason: str = "manual revert"
    reverted_by: str = "user"


# ── TradingProgram endpoints ──────────────────────────────────────────────────

@router.get("")
async def list_programs(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    result = await db.execute(
        select(TradingProgram).order_by(TradingProgram.created_at.desc())
    )
    programs = result.scalars().all()
    return [serialize_trading_program(p) for p in programs]


@router.post("")
async def create_program(
    req: CreateProgramRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    program = TradingProgram(
        id=str(uuid.uuid4()),
        name=req.name,
        description=req.description,
        strategy_version_id=req.strategy_version_id,
        optimization_profile_id=req.optimization_profile_id,
        weight_profile_id=req.weight_profile_id,
        symbol_universe_snapshot_id=req.symbol_universe_snapshot_id,
        execution_policy=req.execution_policy,
        duration_mode=req.duration_mode,
        parent_program_id=req.parent_program_id,
        status="draft",
    )
    db.add(program)
    await db.commit()
    await db.refresh(program)
    return serialize_trading_program(program)


@router.get("/{program_id}")
async def get_program(
    program_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    program = await db.get(TradingProgram, program_id)
    if program is None:
        raise HTTPException(status_code=404, detail="TradingProgram not found")
    return serialize_trading_program(program)


@router.patch("/{program_id}")
async def update_program(
    program_id: str,
    updates: dict[str, Any],
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    program = await db.get(TradingProgram, program_id)
    if program is None:
        raise HTTPException(status_code=404, detail="TradingProgram not found")
    if program.status == "frozen":
        raise HTTPException(status_code=400, detail="Cannot modify a frozen TradingProgram — create a new version")

    allowed_fields = {
        "name", "description", "strategy_version_id", "optimization_profile_id",
        "weight_profile_id", "symbol_universe_snapshot_id", "execution_policy",
        "duration_mode",
    }
    for field, value in updates.items():
        if field in allowed_fields:
            setattr(program, field, value)

    await db.commit()
    await db.refresh(program)
    return serialize_trading_program(program)


@router.post("/{program_id}/freeze")
async def freeze_program(
    program_id: str,
    req: FreezeProgramRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    program = await db.get(TradingProgram, program_id)
    if program is None:
        raise HTTPException(status_code=404, detail="TradingProgram not found")
    if program.status == "frozen":
        raise HTTPException(status_code=400, detail="TradingProgram is already frozen")
    if program.status == "deprecated":
        raise HTTPException(status_code=400, detail="Cannot freeze a deprecated TradingProgram")

    program.status = "frozen"
    program.frozen_at = datetime.now(timezone.utc)
    program.frozen_by = req.frozen_by
    await db.commit()
    await db.refresh(program)
    return serialize_trading_program(program)


@router.post("/{program_id}/deprecate")
async def deprecate_program(
    program_id: str,
    reason: str = "superseded",
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    program = await db.get(TradingProgram, program_id)
    if program is None:
        raise HTTPException(status_code=404, detail="TradingProgram not found")
    program.status = "deprecated"
    program.deprecation_reason = reason
    await db.commit()
    await db.refresh(program)
    return serialize_trading_program(program)


# ── AccountAllocation endpoints ───────────────────────────────────────────────

@router.get("/{program_id}/allocations")
async def list_allocations(
    program_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    result = await db.execute(
        select(AccountAllocation)
        .where(AccountAllocation.trading_program_id == program_id)
        .order_by(AccountAllocation.created_at.desc())
    )
    return [serialize_allocation(a) for a in result.scalars().all()]


@router.post("/{program_id}/allocations")
async def create_allocation(
    program_id: str,
    req: CreateAllocationRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    program = await db.get(TradingProgram, program_id)
    if program is None:
        raise HTTPException(status_code=404, detail="TradingProgram not found")

    # Validate bounded overrides
    if req.position_size_scale_pct is not None:
        if not (0.8 <= req.position_size_scale_pct <= 1.2):
            raise HTTPException(status_code=400, detail="position_size_scale_pct must be between 0.8 and 1.2 (±20%)")
    if req.session_window_shift_min is not None:
        if not (-30 <= req.session_window_shift_min <= 30):
            raise HTTPException(status_code=400, detail="session_window_shift_min must be between -30 and +30 minutes")

    allocation = AccountAllocation(
        id=str(uuid.uuid4()),
        trading_program_id=program_id,
        account_id=req.account_id,
        allocated_capital_usd=req.allocated_capital_usd,
        conflict_resolution=req.conflict_resolution,
        broker_mode=req.broker_mode,
        position_size_scale_pct=req.position_size_scale_pct,
        session_window_shift_min=req.session_window_shift_min,
        drawdown_threshold_pct=req.drawdown_threshold_pct,
        notes=req.notes,
        status="pending",
    )
    db.add(allocation)
    await db.commit()
    await db.refresh(allocation)
    return serialize_allocation(allocation)


@router.get("/{program_id}/allocations/{allocation_id}")
async def get_allocation(
    program_id: str,
    allocation_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    allocation = await db.get(AccountAllocation, allocation_id)
    if allocation is None or allocation.trading_program_id != program_id:
        raise HTTPException(status_code=404, detail="AccountAllocation not found")
    return serialize_allocation(allocation)


@router.post("/{program_id}/allocations/{allocation_id}/start")
async def start_allocation(
    program_id: str,
    allocation_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    allocation = await db.get(AccountAllocation, allocation_id)
    if allocation is None or allocation.trading_program_id != program_id:
        raise HTTPException(status_code=404, detail="AccountAllocation not found")
    if allocation.status not in {"pending", "paused"}:
        raise HTTPException(status_code=400, detail=f"Cannot start allocation in status: {allocation.status}")

    allocation.status = "paper" if allocation.broker_mode == "paper" else "promoted_to_live"
    allocation.started_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(allocation)
    return serialize_allocation(allocation)


@router.post("/{program_id}/allocations/{allocation_id}/stop")
async def stop_allocation(
    program_id: str,
    allocation_id: str,
    reason: str = "manual",
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    allocation = await db.get(AccountAllocation, allocation_id)
    if allocation is None or allocation.trading_program_id != program_id:
        raise HTTPException(status_code=404, detail="AccountAllocation not found")

    allocation.status = "stopped"
    allocation.stopped_at = datetime.now(timezone.utc)
    allocation.stop_reason = reason
    await db.commit()
    await db.refresh(allocation)
    return serialize_allocation(allocation)


@router.post("/{program_id}/allocations/{allocation_id}/promotion-review")
async def prepare_promotion(
    program_id: str,
    allocation_id: str,
    req: PromotionReviewRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    allocation = await db.get(AccountAllocation, allocation_id)
    if allocation is None or allocation.trading_program_id != program_id:
        raise HTTPException(status_code=404, detail="AccountAllocation not found")

    try:
        review = await prepare_promotion_review(
            db,
            allocation_id,
            paper_perf_summary=req.paper_perf_summary,
            safety_checklist=req.safety_checklist,
            reviewer=req.reviewer,
        )
        return review
    except PromotionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{program_id}/allocations/{allocation_id}/promote")
async def promote_allocation(
    program_id: str,
    allocation_id: str,
    req: ExecutePromotionRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    allocation = await db.get(AccountAllocation, allocation_id)
    if allocation is None or allocation.trading_program_id != program_id:
        raise HTTPException(status_code=404, detail="AccountAllocation not found")

    try:
        allocation = await execute_promotion(
            db,
            allocation_id,
            review_payload=req.review_payload,
            promoted_by=req.promoted_by,
        )
        await db.commit()
        return serialize_allocation(allocation)
    except PromotionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{program_id}/allocations/{allocation_id}/revert")
async def revert_allocation_promotion(
    program_id: str,
    allocation_id: str,
    req: RevertPromotionRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    allocation = await db.get(AccountAllocation, allocation_id)
    if allocation is None or allocation.trading_program_id != program_id:
        raise HTTPException(status_code=404, detail="AccountAllocation not found")

    try:
        allocation = await revert_promotion(
            db,
            allocation_id,
            reason=req.reason,
            reverted_by=req.reverted_by,
        )
        await db.commit()
        return serialize_allocation(allocation)
    except PromotionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
