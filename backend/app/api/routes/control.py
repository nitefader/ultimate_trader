"""
Global kill switch, safety controls, and platform status endpoints.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.kill_switch import get_kill_switch
from app.database import get_db
from app.models.kill_switch import KillSwitchEvent

router = APIRouter(prefix="/control", tags=["control"])


async def _get_last_global_event(db: AsyncSession) -> KillSwitchEvent | None:
    result = await db.execute(
        select(KillSwitchEvent)
        .where(KillSwitchEvent.scope == "global")
        .order_by(KillSwitchEvent.triggered_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _sync_global_kill_switch(ks, last_global: KillSwitchEvent | None) -> dict[str, Any]:
    """
    Keep the in-memory singleton aligned with the durable audit log.

    This makes the kill state stable even if different requests are handled by
    different app instances.
    """
    if last_global:
        if last_global.action == "kill":
            reason = last_global.reason or "restored_from_audit"
            current_reason = ks.get_status().get("global_kill_reason")
            if (not ks.is_globally_killed) or current_reason != reason:
                ks.kill_all(reason=reason, triggered_by="system")
        elif last_global.action == "resume" and ks.is_globally_killed:
            ks.unkill_all(triggered_by="system")
    elif ks.is_globally_killed:
        ks.unkill_all(triggered_by="system")

    return ks.get_status()


@router.get("/status")
async def platform_status(db: AsyncSession = Depends(get_db)):
    """Current platform-wide status - always visible in the UI."""
    ks = get_kill_switch()
    last_global = await _get_last_global_event(db)
    return {
        "kill_switch": _sync_global_kill_switch(ks, last_global),
        "platform_mode": get_settings().PLATFORM_MODE,
    }


@router.post("/kill-all")
async def kill_all(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    """GLOBAL KILL SWITCH - stops all trading immediately."""
    reason = body.get("reason", "manual_kill")
    triggered_by = body.get("triggered_by", "user")
    ks = get_kill_switch()
    ks.kill_all(reason=reason, triggered_by=triggered_by)

    event = KillSwitchEvent(
        id=str(uuid.uuid4()),
        scope="global",
        action="kill",
        reason=reason,
        triggered_by=triggered_by,
    )
    db.add(event)
    await db.commit()
    return {
        "status": "all_trading_stopped",
        "reason": reason,
        "kill_switch": _sync_global_kill_switch(ks, await _get_last_global_event(db)),
    }


@router.post("/resume-all")
async def resume_all(body: dict[str, Any] | None = None, db: AsyncSession = Depends(get_db)):
    """Resume all trading after a global kill."""
    body = body or {}
    ks = get_kill_switch()
    triggered_by = body.get("triggered_by", "user")
    ks.unkill_all(triggered_by=triggered_by)

    event = KillSwitchEvent(
        id=str(uuid.uuid4()),
        scope="global",
        action="resume",
        triggered_by=triggered_by,
    )
    db.add(event)
    await db.commit()
    return {
        "status": "trading_resumed",
        "kill_switch": _sync_global_kill_switch(ks, await _get_last_global_event(db)),
    }


@router.post("/kill-strategy/{strategy_id}")
async def kill_strategy(strategy_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    reason = body.get("reason", "manual")
    ks = get_kill_switch()
    triggered_by = body.get("triggered_by", "user")
    ks.kill_strategy(strategy_id, reason, triggered_by=triggered_by)

    event = KillSwitchEvent(
        id=str(uuid.uuid4()),
        scope="strategy",
        scope_id=strategy_id,
        action="kill",
        reason=reason,
        triggered_by=triggered_by,
    )
    db.add(event)
    await db.flush()
    return {"status": "strategy_killed", "strategy_id": strategy_id}


@router.post("/pause-strategy/{strategy_id}")
async def pause_strategy(strategy_id: str, body: dict[str, Any] | None = None, db: AsyncSession = Depends(get_db)):
    body = body or {}
    triggered_by = body.get("triggered_by", "user")
    ks = get_kill_switch()
    ks.pause_strategy(strategy_id, triggered_by=triggered_by)

    event = KillSwitchEvent(
        id=str(uuid.uuid4()),
        scope="strategy",
        scope_id=strategy_id,
        action="pause",
        triggered_by=triggered_by,
    )
    db.add(event)
    await db.flush()
    return {"status": "strategy_paused", "strategy_id": strategy_id}


@router.post("/resume-strategy/{strategy_id}")
async def resume_strategy(strategy_id: str, body: dict[str, Any] | None = None, db: AsyncSession = Depends(get_db)):
    body = body or {}
    triggered_by = body.get("triggered_by", "user")
    ks = get_kill_switch()
    ks.resume_strategy(strategy_id, triggered_by=triggered_by)

    event = KillSwitchEvent(
        id=str(uuid.uuid4()),
        scope="strategy",
        scope_id=strategy_id,
        action="resume",
        triggered_by=triggered_by,
    )
    db.add(event)
    await db.flush()
    return {"status": "strategy_resumed", "strategy_id": strategy_id}


@router.get("/kill-events")
async def get_kill_events(limit: int = 50, db: AsyncSession = Depends(get_db)):
    """
    Return durable control events from the database.

    Frontend expects keys: timestamp, action, scope, scope_id, reason, triggered_by.
    """
    result = await db.execute(
        select(KillSwitchEvent)
        .order_by(KillSwitchEvent.triggered_at.desc())
        .limit(limit)
    )
    events = result.scalars().all()
    return {
        "events": [
            {
                "id": e.id,
                "timestamp": e.triggered_at.isoformat() if e.triggered_at else None,
                "scope": e.scope,
                "scope_id": e.scope_id,
                "action": e.action,
                "reason": e.reason,
                "triggered_by": e.triggered_by,
            }
            for e in events
        ]
    }
