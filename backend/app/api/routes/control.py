"""
Global kill switch, safety controls, and platform status endpoints.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.kill_switch import get_kill_switch
from app.database import get_db
from app.models.kill_switch import KillSwitchEvent


async def _broadcast_kill_event(action: str, reason: str, scope: str = "global", scope_id: str | None = None) -> None:
    try:
        from app.main import ws_manager  # lazy to avoid circular import
        await ws_manager.broadcast({
            "type": "kill_switch",
            "data": {
                "action": action,
                "reason": reason,
                "scope": scope,
                "scope_id": scope_id,
            },
            "ts": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass

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


def _cancellation_result_to_dict(result: Any) -> dict[str, Any]:
    """Serialize a CancellationResult dataclass to a JSON-safe dict."""
    def _entry(e: Any) -> dict[str, Any]:
        return {
            "order_id": e.order_id,
            "client_order_id": e.client_order_id,
            "symbol": e.symbol,
            "side": e.side,
            "qty": e.qty,
            "intent": e.intent,
            "reason": e.reason,
            "deployment_id": e.deployment_id,
        }
    return {
        "scope": result.scope,
        "dry_run": result.dry_run,
        "orders_canceled": [_entry(e) for e in result.canceled],
        "orders_skipped_protective": [_entry(e) for e in result.skipped_protective],
        "orders_skipped_has_position": [_entry(e) for e in result.skipped_has_position],
        "orders_skipped_unknown": [_entry(e) for e in result.skipped_unknown],
        "errors": result.errors,
    }


async def _run_cancellation_sweep(
    account_id: str,
    scope: str,
    deployment_id: str | None,
    dry_run: bool,
    db: AsyncSession,
) -> dict[str, Any]:
    """
    Load Alpaca config for an account and run cancel_resting_open_orders_without_positions.
    Returns the serialized CancellationResult, or an error dict if config is unavailable.
    """
    from app.models.account import Account
    from app.services.alpaca_service import (
        build_client_config, cancel_resting_open_orders_without_positions,
    )

    account = await db.get(Account, account_id)
    if not account or not account.broker_config:
        return {"kill_state_fetch_failed": True, "error": f"No broker config for account {account_id}"}

    broker_cfg = account.broker_config or {}
    mode_cfg = broker_cfg.get("paper") or broker_cfg.get("live") or {}
    api_key = mode_cfg.get("api_key", "")
    secret_key = mode_cfg.get("secret_key", "")
    mode = "paper" if "paper" in broker_cfg else "live"

    if not api_key or not secret_key:
        return {"kill_state_fetch_failed": True, "error": "Alpaca credentials not configured"}

    try:
        config = build_client_config(api_key, secret_key, mode)
    except Exception as exc:
        return {"kill_state_fetch_failed": True, "error": str(exc)}

    try:
        result = cancel_resting_open_orders_without_positions(
            config=config,
            scope=scope,
            deployment_id=deployment_id,
            dry_run=dry_run,
        )
        data = _cancellation_result_to_dict(result)
        data["kill_state_fetch_failed"] = False
        return data
    except Exception as exc:
        return {"kill_state_fetch_failed": True, "error": str(exc)}


@router.post("/kill-all")
async def kill_all(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    """Global kill — stops all trading immediately. Cancels resting open-intent orders."""
    reason = body.get("reason", "manual_kill")
    triggered_by = body.get("triggered_by", "user")
    dry_run = bool(body.get("dry_run", False))
    ks = get_kill_switch()

    # Persist kill state BEFORE cancellation sweep (hard rule: kill state survives sweep failure)
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
    await _broadcast_kill_event("kill", reason)

    # Run cancellation sweep across all accounts with broker configs
    from app.models.account import Account
    from sqlalchemy import select as _select
    accounts_result = await db.execute(_select(Account).where(Account.is_enabled == True))  # noqa: E712
    all_accounts = accounts_result.scalars().all()

    sweep_results: list[dict[str, Any]] = []
    for account in all_accounts:
        if not account.broker_config:
            continue
        sweep = await _run_cancellation_sweep(account.id, "account", None, dry_run, db)
        sweep["account_id"] = account.id
        sweep_results.append(sweep)

    return {
        "action": "global_kill",
        "scope": "global",
        "scope_id": None,
        "status": "all_trading_stopped",
        "reason": reason,
        "kill_switch": _sync_global_kill_switch(ks, await _get_last_global_event(db)),
        "sweep": sweep_results,
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
    await _broadcast_kill_event("resume", "manual_resume")
    return {
        "action": "global_resume",
        "scope": "global",
        "scope_id": None,
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
    await _broadcast_kill_event("kill", reason, scope="strategy", scope_id=strategy_id)
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


@router.post("/pause-deployment/{deployment_id}")
async def pause_deployment(
    deployment_id: str,
    body: dict[str, Any] | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Pause a single deployment — blocks new position-opening orders for this deployment only."""
    body = body or {}
    triggered_by = body.get("triggered_by", "user")
    dry_run = bool(body.get("dry_run", False))
    ks = get_kill_switch()

    # Load deployment to find account_id for sweep
    from app.models.deployment import Deployment
    dep = await db.get(Deployment, deployment_id)
    if dep is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Deployment {deployment_id} not found")

    # Persist pause in DB and in-memory kill switch
    dep.status = "paused"
    ks.pause_deployment(deployment_id, triggered_by=triggered_by)

    event = KillSwitchEvent(
        id=str(uuid.uuid4()),
        scope="deployment",
        scope_id=deployment_id,
        action="pause",
        triggered_by=triggered_by,
    )
    db.add(event)
    await db.commit()
    await _broadcast_kill_event("pause", "deployment_paused", scope="deployment", scope_id=deployment_id)

    # Sweep resting open-intent orders for this deployment
    sweep: dict[str, Any] = {}
    if dep.account_id:
        sweep = await _run_cancellation_sweep(dep.account_id, "deployment", deployment_id, dry_run, db)

    return {
        "action": "program_pause",
        "scope": "deployment",
        "scope_id": deployment_id,
        "status": "deployment_paused",
        "kill_state_fetch_failed": sweep.get("kill_state_fetch_failed", False),
        "orders_canceled": sweep.get("orders_canceled", []),
        "orders_skipped_protective": sweep.get("orders_skipped_protective", []),
        "orders_skipped_has_position": sweep.get("orders_skipped_has_position", []),
        "orders_skipped_unknown": sweep.get("orders_skipped_unknown", []),
        "errors": sweep.get("errors", []),
    }


@router.post("/resume-deployment/{deployment_id}")
async def resume_deployment(
    deployment_id: str,
    body: dict[str, Any] | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Resume a paused deployment. Does not override an account-level or global kill."""
    body = body or {}
    triggered_by = body.get("triggered_by", "user")
    ks = get_kill_switch()

    from app.models.deployment import Deployment
    dep = await db.get(Deployment, deployment_id)
    if dep is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Deployment {deployment_id} not found")

    # Check that higher-level scopes don't block the resume
    can_open, block_reason = ks.can_open_new_position(
        account_id=dep.account_id or "",
        deployment_id=deployment_id,
    )
    # Only warn — the resume proceeds; governor loop will re-check can_open_new_position on every tick
    if not can_open and not block_reason.startswith("program_paused"):
        logger.warning(
            "resume_deployment: deployment=%s resumed but higher scope still blocking: %s",
            deployment_id[:8], block_reason,
        )

    dep.status = "running"
    ks.resume_deployment(deployment_id, triggered_by=triggered_by)

    event = KillSwitchEvent(
        id=str(uuid.uuid4()),
        scope="deployment",
        scope_id=deployment_id,
        action="resume",
        triggered_by=triggered_by,
    )
    db.add(event)
    await db.commit()
    await _broadcast_kill_event("resume", "deployment_resumed", scope="deployment", scope_id=deployment_id)

    return {
        "action": "program_resume",
        "scope": "deployment",
        "scope_id": deployment_id,
        "status": "deployment_resumed",
        "higher_scope_block": None if can_open else block_reason,
    }


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
