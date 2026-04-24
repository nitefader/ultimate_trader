"""GovernorService — creates, activates, halts and queries AccountGovernors."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deployment import Deployment
from app.models.governor_event import GovernorEvent

logger = logging.getLogger(__name__)


async def get_governor_for_account(db: AsyncSession, account_id: str) -> Deployment | None:
    result = await db.execute(
        select(Deployment)
        .where(
            Deployment.account_id == account_id,
            Deployment.governor_status.isnot(None),
        )
        .order_by(Deployment.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def list_governors(db: AsyncSession) -> list[Deployment]:
    result = await db.execute(
        select(Deployment)
        .where(Deployment.governor_status.isnot(None))
        .order_by(Deployment.created_at.desc())
    )
    return list(result.scalars().all())


async def create_governor(
    db: AsyncSession,
    *,
    account_id: str,
    label: str,
    risk_profile_id: str | None = None,
    poll_config: dict | None = None,
    created_by: str = "user",
) -> Deployment:
    governor = Deployment(
        id=str(uuid.uuid4()),
        account_id=account_id,
        strategy_id="governor",           # sentinel value — not a real strategy
        strategy_version_id="governor",   # sentinel
        mode="paper",
        status="pending",
        governor_label=label,
        governor_status="initializing",
        risk_profile_id=risk_profile_id,
        poll_config=poll_config or {
            "base_interval_seconds": 60,
            "intraday_interval_seconds": 60,
            "day_interval_seconds": 300,
            "swing_interval_seconds": 3600,
        },
    )
    db.add(governor)
    await db.flush()
    await _emit_event(db, governor.id, "governor_created", detail={"label": label})
    logger.info("GovernorService: created governor %s for account %s", governor.id[:8], account_id[:8])
    return governor


async def activate_governor(db: AsyncSession, governor_id: str) -> Deployment | None:
    gov = await db.get(Deployment, governor_id)
    if gov is None:
        return None
    gov.governor_status = "active"
    gov.status = "running"
    gov.started_at = datetime.now(timezone.utc)
    await _emit_event(db, governor_id, "governor_activated")
    return gov


async def halt_governor(
    db: AsyncSession,
    governor_id: str,
    *,
    trigger: str = "manual",
    reason: str = "",
) -> Deployment | None:
    gov = await db.get(Deployment, governor_id)
    if gov is None:
        return None
    gov.governor_status = "halted"
    gov.halt_trigger = trigger
    gov.halt_at = datetime.now(timezone.utc)
    gov.stop_reason = reason
    await _emit_event(db, governor_id, "halt_triggered", detail={"trigger": trigger, "reason": reason})
    logger.warning("GovernorService: halted governor %s trigger=%s reason=%s",
                   governor_id[:8], trigger, reason)
    return gov


async def resume_governor(db: AsyncSession, governor_id: str) -> Deployment | None:
    gov = await db.get(Deployment, governor_id)
    if gov is None:
        return None
    gov.governor_status = "active"
    gov.halt_trigger = None
    gov.halt_at = None
    gov.stop_reason = None
    gov.daily_loss_lockout_triggered = False
    await _emit_event(db, governor_id, "governor_resumed")
    return gov


async def emit_governor_event(
    db: AsyncSession,
    governor_id: str,
    event_type: str,
    *,
    allocation_id: str | None = None,
    symbol: str | None = None,
    detail: dict | None = None,
) -> GovernorEvent:
    return await _emit_event(db, governor_id, event_type,
                             allocation_id=allocation_id, symbol=symbol, detail=detail or {})


async def _emit_event(
    db: AsyncSession,
    governor_id: str,
    event_type: str,
    *,
    allocation_id: str | None = None,
    symbol: str | None = None,
    detail: dict | None = None,
) -> GovernorEvent:
    ev = GovernorEvent(
        id=str(uuid.uuid4()),
        governor_id=governor_id,
        allocation_id=allocation_id,
        event_type=event_type,
        symbol=symbol,
        detail=detail or {},
    )
    db.add(ev)
    await db.flush()
    return ev


def serialize_governor(gov: Deployment) -> dict[str, Any]:
    return {
        "id": gov.id,
        "account_id": gov.account_id,
        "governor_label": gov.governor_label,
        "governor_status": gov.governor_status,
        "status": gov.status,
        "risk_profile_id": gov.risk_profile_id,
        "poll_config": gov.poll_config,
        "session_realized_pnl": gov.session_realized_pnl,
        "daily_loss_lockout_triggered": gov.daily_loss_lockout_triggered,
        "halt_trigger": gov.halt_trigger,
        "halt_at": gov.halt_at.isoformat() if gov.halt_at else None,
        "last_governor_tick_at": gov.last_governor_tick_at.isoformat() if gov.last_governor_tick_at else None,
        "created_at": gov.created_at.isoformat() if gov.created_at else None,
    }
