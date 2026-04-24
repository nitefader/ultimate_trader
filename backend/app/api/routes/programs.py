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
from app.services.trading_program_service import missing_program_components, sync_program_lock_state

router = APIRouter(prefix="/programs", tags=["programs"])


class CreateProgramRequest(BaseModel):
    name: str
    description: str | None = None
    notes: str | None = None
    strategy_version_id: str | None = None
    strategy_governor_id: str | None = None
    execution_style_id: str | None = None
    risk_profile_id: str | None = None
    optimization_profile_id: str | None = None
    weight_profile_id: str | None = None
    symbol_universe_snapshot_id: str | None = None
    execution_policy: dict[str, Any] = {}
    duration_mode: str = "swing"
    parent_program_id: str | None = None


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


class ProgramValidationResponse(BaseModel):
    can_deploy: bool
    missing_components: list[str]
    warnings: list[str]
    expected_behavior: list[str]
    attached_components: dict[str, bool]


def _attached_components(program: TradingProgram) -> dict[str, bool]:
    return {
        "strategy": bool(program.strategy_version_id),
        "strategy_controls": bool(getattr(program, "strategy_governor_id", None)),
        "risk_profile": bool(getattr(program, "risk_profile_id", None)),
        "execution_style": bool(getattr(program, "execution_style_id", None)),
        "watchlists": bool(getattr(program, "watchlist_subscriptions", []) or []),
    }


async def _sync_program(db: AsyncSession, program: TradingProgram) -> None:
    if await sync_program_lock_state(db, program):
        await db.commit()
        await db.refresh(program)


@router.get("")
async def list_programs(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    result = await db.execute(select(TradingProgram).order_by(TradingProgram.created_at.desc()))
    programs = result.scalars().all()

    changed = False
    for program in programs:
        changed = await sync_program_lock_state(db, program) or changed
    if changed:
        await db.commit()

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
        notes=req.notes,
        strategy_version_id=req.strategy_version_id,
        strategy_governor_id=req.strategy_governor_id,
        execution_style_id=req.execution_style_id,
        risk_profile_id=req.risk_profile_id,
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
    await _sync_program(db, program)
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
    await _sync_program(db, program)
    if program.status == "frozen":
        raise HTTPException(
            status_code=400,
            detail="Cannot modify a deployed TradingProgram - stop or remove all active allocations first",
        )

    allowed_fields = {
        "name",
        "description",
        "notes",
        "strategy_version_id",
        "strategy_governor_id",
        "execution_style_id",
        "risk_profile_id",
        "optimization_profile_id",
        "weight_profile_id",
        "symbol_universe_snapshot_id",
        "execution_policy",
        "duration_mode",
        "watchlist_subscriptions",
        "watchlist_combination_rule",
    }
    for field, value in updates.items():
        if field in allowed_fields:
            setattr(program, field, value)

    await db.commit()
    await db.refresh(program)
    return serialize_trading_program(program)


@router.post("/{program_id}/validate", response_model=ProgramValidationResponse)
async def validate_program(
    program_id: str,
    db: AsyncSession = Depends(get_db),
) -> ProgramValidationResponse:
    program = await db.get(TradingProgram, program_id)
    if program is None:
        raise HTTPException(status_code=404, detail="TradingProgram not found")
    await _sync_program(db, program)

    attached_components = _attached_components(program)
    missing_components = missing_program_components(program)

    warnings: list[str] = []
    if program.status == "deprecated":
        warnings.append("Deprecated programs should not be deployed again.")
    if program.status == "frozen":
        warnings.append("Program is locked while it has active account allocations.")
    if program.duration_mode == "day" and not attached_components["strategy_controls"]:
        warnings.append("Day-mode programs are safer with Strategy Controls attached for session and PDT gating.")
    if attached_components["watchlists"] and (program.watchlist_combination_rule or "union") == "intersection":
        warnings.append("Intersection mode can reduce the resolved symbol universe sharply if watchlists do not overlap.")

    expected_behavior: list[str] = []
    if attached_components["strategy"]:
        expected_behavior.append("Signals will come from the linked strategy version.")
    if attached_components["strategy_controls"]:
        expected_behavior.append("Entry timing and gating will follow the linked Strategy Controls.")
    if attached_components["risk_profile"]:
        expected_behavior.append("Sizing and exposure limits will come from the linked Risk Profile.")
    if attached_components["execution_style"]:
        expected_behavior.append("Order expression and exit mechanics will come from the linked Execution Style.")
    if attached_components["watchlists"]:
        rule = (program.watchlist_combination_rule or "union").lower()
        expected_behavior.append(f"Universe resolution will use the selected watchlists with the {rule} rule.")

    return ProgramValidationResponse(
        can_deploy=program.status != "deprecated" and not missing_components,
        missing_components=missing_components,
        warnings=warnings,
        expected_behavior=expected_behavior,
        attached_components=attached_components,
    )


@router.post("/{program_id}/freeze")
async def freeze_program(program_id: str) -> dict[str, Any]:
    raise HTTPException(
        status_code=400,
        detail="Programs freeze automatically when allocated to an account and unfreeze when fully undeployed",
    )


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
    await _sync_program(db, program)

    missing_components = missing_program_components(program)
    if missing_components:
        raise HTTPException(
            status_code=400,
            detail=f"Program is not deployable yet. Missing components: {', '.join(missing_components)}",
        )

    if req.position_size_scale_pct is not None and not (0.8 <= req.position_size_scale_pct <= 1.2):
        raise HTTPException(status_code=400, detail="position_size_scale_pct must be between 0.8 and 1.2 (+/-20%)")
    if req.session_window_shift_min is not None and not (-30 <= req.session_window_shift_min <= 30):
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
    await db.flush()
    await sync_program_lock_state(db, program, actor="allocation")
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
    program = await db.get(TradingProgram, allocation.trading_program_id)
    if program is not None:
        await sync_program_lock_state(db, program, actor="allocation")
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
    program = await db.get(TradingProgram, allocation.trading_program_id)
    if program is not None:
        await sync_program_lock_state(db, program)
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
