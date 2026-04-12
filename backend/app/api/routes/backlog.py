"""Program backlog endpoints for thin-slice planning and oversight."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.program_backlog import ProgramBacklogItem

router = APIRouter(prefix="/backlog", tags=["backlog"])

DEFAULT_ITEMS = [
    {
        "order_index": 10,
        "title": "Promotion safety contract",
        "objective": "Align paper-to-live controls with the master spec before expanding more workflows.",
        "scope": "Backend promotion checklist, resume/start behavior, frontend approval visibility.",
        "business_impact": "Reduces unsafe promotions and gives clear milestone evidence before live-risk actions.",
        "status": "completed",
        "review": "passed",
        "verification": "Backend promotion tests passing and frontend build verified.",
        "next_gate": "Use this slice as the baseline review gate for deployment-related work.",
        "blocked_by_ids": [],
    },
    {
        "order_index": 20,
        "title": "Program backlog oversight view",
        "objective": "Create the oversight and BI surface for thin-slice execution.",
        "scope": "Logs tab expansion, slice tracking, review checkpoints, verification summary.",
        "business_impact": "Gives leadership a live view of execution order, quality gates, and remaining risk.",
        "status": "completed",
        "review": "passed",
        "verification": "Frontend oversight tab is live and build-verified.",
        "next_gate": "Use this view as the control surface for future slices before execution begins.",
        "blocked_by_ids": [],
    },
    {
        "order_index": 30,
        "title": "Dependency-aware release planning",
        "objective": "Map core workflow dependencies so execution follows incremental release trains rather than big-bang delivery.",
        "scope": "Foundation, evidence, access, execution, and control lanes with staged release gates.",
        "business_impact": "Prevents later slices from depending on unfinished operational prerequisites.",
        "status": "completed",
        "review": "passed",
        "verification": "Dependency lanes and release trains are visible in the Program Backlog view.",
        "next_gate": "Keep all future slices sequenced by dependency lane before implementation starts.",
        "blocked_by_ids": [],
    },
    {
        "order_index": 40,
        "title": "Kill-switch enforcement audit",
        "objective": "Verify kill-switch behavior is enforced across operational paths, not just logged.",
        "scope": "Execution-path audit, contract tests, control/monitor integration review.",
        "business_impact": "Largest safety risk identified by independent review.",
        "status": "queued",
        "review": "not_started",
        "verification": "Pending.",
        "next_gate": "Do not claim deeper live-readiness until this slice passes review.",
        "blocked_by_ids": [],
    },
]


def _serialize(item: ProgramBacklogItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "title": item.title,
        "objective": item.objective,
        "scope": item.scope,
        "business_impact": item.business_impact,
        "order_index": item.order_index,
        "blocked_by_ids": item.blocked_by_ids,
        "status": item.status,
        "review": item.review,
        "verification": item.verification,
        "next_gate": item.next_gate,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


async def _validate_dependencies(
    db: AsyncSession,
    *,
    item_id: str | None,
    blocked_by_ids: list[str],
    requested_status: str,
) -> None:
    if item_id and item_id in blocked_by_ids:
        raise HTTPException(status_code=400, detail="A backlog item cannot depend on itself")

    if not blocked_by_ids:
        return

    result = await db.execute(
        select(ProgramBacklogItem).where(ProgramBacklogItem.id.in_(blocked_by_ids))
    )
    deps = {item.id: item for item in result.scalars().all()}
    missing = [dep_id for dep_id in blocked_by_ids if dep_id not in deps]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown dependency ids: {missing}")

    if requested_status in {"in_progress", "completed"}:
        incomplete = [dep_id for dep_id, dep in deps.items() if dep.status != "completed"]
        if incomplete:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot move item to {requested_status} while dependencies are incomplete: {incomplete}",
            )


async def _seed_defaults_if_empty(db: AsyncSession) -> None:
    result = await db.execute(select(ProgramBacklogItem.id).limit(1))
    if result.first():
        return
    for row in DEFAULT_ITEMS:
        db.add(ProgramBacklogItem(**row))
    await db.flush()


@router.get("")
async def list_backlog_items(db: AsyncSession = Depends(get_db)):
    await _seed_defaults_if_empty(db)
    result = await db.execute(select(ProgramBacklogItem).order_by(ProgramBacklogItem.order_index.asc(), ProgramBacklogItem.created_at.asc()))
    return [_serialize(item) for item in result.scalars().all()]


@router.post("")
async def create_backlog_item(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    title = str(body.get("title", "")).strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    blocked_by_ids = body.get("blocked_by_ids", [])
    status = body.get("status", "queued")

    await _validate_dependencies(
        db,
        item_id=None,
        blocked_by_ids=blocked_by_ids,
        requested_status=status,
    )

    item = ProgramBacklogItem(
        title=title,
        objective=body.get("objective", ""),
        scope=body.get("scope", ""),
        business_impact=body.get("business_impact", ""),
        order_index=int(body.get("order_index", 0)),
        blocked_by_ids=blocked_by_ids,
        status=status,
        review=body.get("review", "not_started"),
        verification=body.get("verification", ""),
        next_gate=body.get("next_gate", ""),
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return _serialize(item)


@router.put("/{item_id}")
async def update_backlog_item(item_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    item = await db.get(ProgramBacklogItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Backlog item not found")

    blocked_by_ids = body.get("blocked_by_ids", item.blocked_by_ids)
    requested_status = body.get("status", item.status)
    await _validate_dependencies(
        db,
        item_id=item_id,
        blocked_by_ids=blocked_by_ids,
        requested_status=requested_status,
    )

    for field in ["title", "objective", "scope", "business_impact", "order_index", "blocked_by_ids", "status", "review", "verification", "next_gate"]:
        if field in body:
            setattr(item, field, body[field])
    await db.flush()
    await db.refresh(item)
    return _serialize(item)
