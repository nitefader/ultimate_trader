"""
Live Monitor API — aggregates all active paper/live deployments with
real-time position, order and P&L data from Alpaca.

GET /monitor/runs            — list all active deployments with cached stats
GET /monitor/runs/{id}       — single deployment detail + positions + orders
POST /monitor/runs/{id}/close-position — close a specific position
POST /monitor/runs/{id}/close-all     — close all positions for this deployment
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.core.kill_switch import get_kill_switch
from app.models.deployment import Deployment
from app.models.account import Account
from app.models.strategy import Strategy, StrategyVersion

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/monitor", tags=["monitor"])

_ACTIVE_STATUSES = {"running", "paused"}


def _enforce_trade_controls(account_id: str, strategy_id: str) -> None:
    ok, reason = get_kill_switch().can_trade(account_id=account_id, strategy_id=strategy_id)
    if not ok:
        raise HTTPException(status_code=400, detail=reason)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_broker(account: Account):
    """Build AlpacaBroker for this account. Returns None if not an Alpaca account."""
    if account.broker not in ("alpaca", "alpaca_paper", "alpaca_live"):
        # Only Alpaca accounts can be monitored live — paper_broker is simulated.
        return None
    try:
        from app.brokers.alpaca_broker import AlpacaBroker
        return AlpacaBroker.from_account(account)
    except ValueError as exc:
        logger.warning("Cannot build broker for account %s: %s", account.id, exc)
        return None


def _fmt_deployment(d: Deployment, account: Account, strategy: Strategy | None) -> dict[str, Any]:
    return {
        "id": d.id,
        "mode": d.mode,
        "status": d.status,
        "strategy_id": d.strategy_id,
        "strategy_name": strategy.name if strategy else None,
        "account_id": d.account_id,
        "account_name": account.name,
        "account_mode": account.mode,
        "account_equity": account.equity,
        "account_unrealized_pnl": account.unrealized_pnl,
        "broker": account.broker,
        "started_at": d.started_at.isoformat() if d.started_at else None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "config_overrides": d.config_overrides,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/runs")
async def list_active_runs(db: AsyncSession = Depends(get_db)):
    """
    Return all paper/live deployments that are currently running or paused,
    with lightweight account stats. Does NOT hit Alpaca (too slow for a list).
    """
    result = await db.execute(
        select(Deployment)
        .where(Deployment.status.in_(list(_ACTIVE_STATUSES)))
        .where(Deployment.mode.in_(["paper", "live"]))
        .order_by(Deployment.started_at.desc())
    )
    deployments = result.scalars().all()

    rows = []
    for d in deployments:
        account = await db.get(Account, d.account_id)
        strategy = await db.get(Strategy, d.strategy_id)
        if account:
            rows.append(_fmt_deployment(d, account, strategy))

    return rows


@router.get("/runs/{deployment_id}")
async def get_run_detail(deployment_id: str, db: AsyncSession = Depends(get_db)):
    """
    Return detailed info for one deployment including live Alpaca positions and orders.
    Falls back gracefully if credentials aren't configured (simulated / paper_broker).
    """
    d = await db.get(Deployment, deployment_id)
    if not d:
        raise HTTPException(status_code=404, detail="Deployment not found")

    account = await db.get(Account, d.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    strategy = await db.get(Strategy, d.strategy_id)
    base = _fmt_deployment(d, account, strategy)

    # Try to get live broker data
    broker = await _get_broker(account)
    if broker:
        status_data, orders_data = await asyncio.gather(
            broker.get_status(),
            broker.get_orders("open"),
            return_exceptions=True,
        )
        base["live_account"] = status_data if not isinstance(status_data, Exception) else {"error": str(status_data)}
        base["open_orders"] = orders_data if not isinstance(orders_data, Exception) else []
    else:
        # Simulated paper account — return stored stats
        base["live_account"] = {
            "paper": True,
            "equity": account.equity,
            "cash": account.current_balance,
            "portfolio_value": account.equity,
            "unrealized_pnl": account.unrealized_pnl,
            "simulated": True,
        }
        base["open_orders"] = []

    return base


@router.get("/runs/{deployment_id}/positions")
async def get_run_positions(deployment_id: str, db: AsyncSession = Depends(get_db)):
    """Return open positions for this deployment's account."""
    d = await db.get(Deployment, deployment_id)
    if not d:
        raise HTTPException(status_code=404, detail="Deployment not found")

    account = await db.get(Account, d.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    broker = await _get_broker(account)
    if broker:
        return await broker.get_positions()

    # Simulated — no live positions to return
    return []


@router.get("/runs/{deployment_id}/orders")
async def get_run_orders(
    deployment_id: str,
    status: str = "open",
    db: AsyncSession = Depends(get_db),
):
    """Return orders for this deployment's account."""
    d = await db.get(Deployment, deployment_id)
    if not d:
        raise HTTPException(status_code=404, detail="Deployment not found")

    account = await db.get(Account, d.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    broker = await _get_broker(account)
    if broker:
        return await broker.get_orders(status)
    return []


@router.post("/runs/{deployment_id}/close-position")
async def close_run_position(
    deployment_id: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
):
    """
    Close one position for this deployment.
    Body: {symbol: str, qty?: float}
    """
    d = await db.get(Deployment, deployment_id)
    if not d:
        raise HTTPException(status_code=404, detail="Deployment not found")

    account = await db.get(Account, d.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    symbol = body.get("symbol")
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")

    broker = await _get_broker(account)
    if not broker:
        raise HTTPException(status_code=400, detail="Live broker not available for this account")
    _enforce_trade_controls(account.id, d.strategy_id)

    qty = body.get("qty")
    return await broker.close_position(symbol, qty=qty)


@router.post("/runs/{deployment_id}/close-all")
async def close_all_run_positions(deployment_id: str, db: AsyncSession = Depends(get_db)):
    """Flatten all positions for this deployment — emergency exit."""
    d = await db.get(Deployment, deployment_id)
    if not d:
        raise HTTPException(status_code=404, detail="Deployment not found")

    account = await db.get(Account, d.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    broker = await _get_broker(account)
    if not broker:
        raise HTTPException(status_code=400, detail="Live broker not available for this account")
    _enforce_trade_controls(account.id, d.strategy_id)

    return await broker.close_all_positions()


@router.get("/accounts")
async def list_monitored_accounts(db: AsyncSession = Depends(get_db)):
    """
    Return all Alpaca-connected accounts with live status.
    Fetches Alpaca data concurrently for all configured accounts.
    """
    result = await db.execute(
        select(Account)
        .where(Account.is_enabled == True)
        .where(Account.broker.in_(["alpaca", "alpaca_paper", "alpaca_live"]))
    )
    accounts = result.scalars().all()

    async def _fetch(account: Account) -> dict[str, Any]:
        base: dict[str, Any] = {
            "id": account.id,
            "name": account.name,
            "mode": account.mode,
            "broker": account.broker,
            "is_killed": account.is_killed,
        }
        broker = await _get_broker(account)
        if broker:
            acct_data = await broker.get_account()
            base["live"] = acct_data
        else:
            base["live"] = None
        return base

    results = await asyncio.gather(*[_fetch(a) for a in accounts], return_exceptions=True)
    return [r for r in results if not isinstance(r, Exception)]
