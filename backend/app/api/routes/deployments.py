"""Deployment and promotion workflow endpoints."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.deployment import Deployment, DeploymentApproval
from app.models.deployment_trade import DeploymentTrade
from app.services.deployment_service import (
    promote_to_paper, promote_to_live,
    start_deployment,
    pause_deployment, stop_deployment,
)

router = APIRouter(prefix="/deployments", tags=["deployments"])


@router.get("")
async def list_deployments(
    account_id: str | None = None,
    mode: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Deployment).order_by(Deployment.created_at.desc())
    if account_id:
        q = q.where(Deployment.account_id == account_id)
    if mode:
        q = q.where(Deployment.mode == mode)
    result = await db.execute(q)
    deps = result.scalars().all()
    return [_fmt(d) for d in deps]


@router.post("/promote-to-paper")
async def api_promote_to_paper(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    try:
        dep = await promote_to_paper(
            db,
            strategy_version_id=body["strategy_version_id"],
            account_id=body["account_id"],
            config_overrides=body.get("config_overrides"),
            promoted_from_run_id=body.get("run_id"),
            notes=body.get("notes"),
        )
        return _fmt(dep)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/promote-to-live")
async def api_promote_to_live(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    try:
        dep = await promote_to_live(
            db,
            paper_deployment_id=body["paper_deployment_id"],
            live_account_id=body["live_account_id"],
            config_overrides=body.get("config_overrides"),
            notes=body.get("notes"),
            safety_checklist=body.get("safety_checklist", {}),
        )
        return _fmt(dep)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{deployment_id}")
async def get_deployment(deployment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Deployment)
        .options(selectinload(Deployment.approvals))
        .where(Deployment.id == deployment_id)
    )
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    data = _fmt(dep)
    data["approvals"] = [
        {
            "id": a.id,
            "from_mode": a.from_mode,
            "to_mode": a.to_mode,
            "approved_by": a.approved_by,
            "approved_at": a.approved_at.isoformat(),
            "notes": a.notes,
            "safety_checklist": a.safety_checklist,
        }
        for a in dep.approvals
    ]
    return data


@router.post("/{deployment_id}/pause")
async def api_pause(deployment_id: str, db: AsyncSession = Depends(get_db)):
    try:
        dep = await pause_deployment(db, deployment_id)
        return {"status": dep.status}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{deployment_id}/start")
async def api_start(deployment_id: str, db: AsyncSession = Depends(get_db)):
    try:
        dep = await start_deployment(db, deployment_id)
        return {"status": dep.status, "started_at": dep.started_at.isoformat() if dep.started_at else None}
    except ValueError as e:
        # Not found vs invalid transition.
        msg = str(e)
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@router.post("/{deployment_id}/stop")
async def api_stop(deployment_id: str, body: dict[str, Any] = None, db: AsyncSession = Depends(get_db)):
    body = body or {}
    try:
        dep = await stop_deployment(db, deployment_id, reason=body.get("reason", "manual"))
        return {"status": dep.status}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/{deployment_id}")
async def update_deployment(deployment_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    dep = await db.get(Deployment, deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    if "status" in body:
        raise HTTPException(status_code=400, detail="status is read-only; use start/pause/stop endpoints")
    if "config_overrides" in body:
        dep.config_overrides = body["config_overrides"]
    await db.flush()
    return _fmt(dep)


@router.delete("/{deployment_id}")
async def delete_deployment(deployment_id: str, db: AsyncSession = Depends(get_db)):
    dep = await db.get(Deployment, deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    await db.delete(dep)
    await db.flush()
    return {"status": "deleted"}


@router.get("/{deployment_id}/positions")
async def get_deployment_positions(deployment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Deployment)
        .options(selectinload(Deployment.account))
        .where(Deployment.id == deployment_id)
    )
    dep = result.scalar_one_or_none()
    if not dep or not dep.account:
        raise HTTPException(status_code=404, detail="Deployment not found")
    
    # For live deployments, get from Alpaca
    if dep.mode == 'live':
        from app.services.alpaca_service import AlpacaConfigError, build_client_config, get_positions

        config = dep.account.broker_config or {}
        mode = str(dep.account.mode).strip().lower()
        mode_config = config.get(mode, {})
        api_key = mode_config.get("api_key", "")
        secret_key = mode_config.get("secret_key", "")

        if api_key and secret_key:
            try:
                client_config = build_client_config(
                    api_key=api_key,
                    secret_key=secret_key,
                    mode=mode,
                    base_url=mode_config.get("base_url"),
                )
            except AlpacaConfigError as exc:
                return {"positions": [], "error": str(exc)}

            positions = await asyncio.get_running_loop().run_in_executor(
                None, lambda: get_positions(client_config)
            )
            return {"positions": positions}
    
    # For paper deployments, return open DeploymentTrade rows as positions
    result2 = await db.execute(
        select(DeploymentTrade).where(
            DeploymentTrade.deployment_id == deployment_id,
            DeploymentTrade.is_open == True,
        )
    )
    open_trades = result2.scalars().all()
    return {
        "positions": [_fmt_trade(t) for t in open_trades],
        "source": "paper_simulated",
    }


@router.get("/{deployment_id}/trades")
async def get_deployment_trades(
    deployment_id: str,
    open_only: bool = False,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """Return paper broker trade history for a deployment."""
    dep = await db.get(Deployment, deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")

    q = (
        select(DeploymentTrade)
        .where(DeploymentTrade.deployment_id == deployment_id)
        .order_by(DeploymentTrade.entry_time.desc())
        .limit(limit)
    )
    if open_only:
        q = q.where(DeploymentTrade.is_open == True)

    result = await db.execute(q)
    trades = result.scalars().all()

    open_trades = [t for t in trades if t.is_open]
    closed_trades = [t for t in trades if not t.is_open]

    total_realized = sum((t.net_pnl or 0) for t in closed_trades)
    total_unrealized = sum((t.unrealized_pnl or 0) for t in open_trades)
    win_trades = [t for t in closed_trades if (t.net_pnl or 0) > 0]
    win_rate = (len(win_trades) / len(closed_trades) * 100) if closed_trades else None

    return {
        "trades": [_fmt_trade(t) for t in trades],
        "summary": {
            "open_count": len(open_trades),
            "closed_count": len(closed_trades),
            "total_realized_pnl": round(total_realized, 2),
            "total_unrealized_pnl": round(total_unrealized, 2),
            "win_rate_pct": round(win_rate, 1) if win_rate is not None else None,
        },
    }


def _fmt_trade(t: DeploymentTrade) -> dict:
    return {
        "id": t.id,
        "symbol": t.symbol,
        "direction": t.direction,
        "entry_time": t.entry_time.isoformat() if t.entry_time else None,
        "entry_price": t.entry_price,
        "quantity": t.quantity,
        "initial_stop": t.initial_stop,
        "current_stop": t.current_stop,
        "current_price": t.current_price,
        "unrealized_pnl": t.unrealized_pnl,
        "exit_time": t.exit_time.isoformat() if t.exit_time else None,
        "exit_price": t.exit_price,
        "exit_reason": t.exit_reason,
        "net_pnl": t.net_pnl,
        "r_multiple": t.r_multiple,
        "is_open": t.is_open,
        "regime_at_entry": t.regime_at_entry,
    }


def _fmt(d: Deployment) -> dict:
    return {
        "id": d.id,
        "strategy_id": d.strategy_id,
        "strategy_version_id": d.strategy_version_id,
        "account_id": d.account_id,
        "mode": d.mode,
        "status": d.status,
        "config_overrides": d.config_overrides,
        "promoted_from_run_id": d.promoted_from_run_id,
        "promoted_from_deployment_id": d.promoted_from_deployment_id,
        "started_at": d.started_at.isoformat() if d.started_at else None,
        "stopped_at": d.stopped_at.isoformat() if d.stopped_at else None,
        "stop_reason": d.stop_reason,
        "created_at": d.created_at.isoformat(),
    }
