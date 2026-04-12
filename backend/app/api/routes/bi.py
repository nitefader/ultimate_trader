"""
Business Intelligence API — aggregated account and portfolio metrics.

GET /bi/overview  — aggregated snapshot across enabled accounts (equity, buying_power, unrealized P&L, exposure)
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.account import Account

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/bi", tags=["bi"])


async def _get_broker(account: Account):
    if account.broker not in ("alpaca", "alpaca_paper", "alpaca_live"):
        return None
    try:
        from app.brokers.alpaca_broker import AlpacaBroker

        return AlpacaBroker.from_account(account)
    except Exception as exc:
        logger.warning("Cannot build broker for account %s: %s", account.id, exc)
        return None


@router.get("/overview")
async def bi_overview(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Return an aggregated snapshot for enabled accounts.

    For Alpaca accounts this will fetch live account + positions where possible.
    The response contains per-account details and a numeric summary.
    """
    result = await db.execute(select(Account).where(Account.is_enabled == True))
    accounts = result.scalars().all()

    async def _fetch(acc: Account) -> dict[str, Any]:
        base = {
            "id": acc.id,
            "name": acc.name,
            "mode": acc.mode,
            "broker": acc.broker,
            "is_killed": acc.is_killed,
            "leverage": float(acc.leverage or 1.0),
        }

        broker = await _get_broker(acc)
        if broker:
            try:
                status = await broker.get_status()
                acct = status.get("account", {}) or {}
                positions = status.get("positions", []) or []

                gross_exposure = sum(abs((p.get("market_value") or 0.0)) for p in positions)
                unrealized_pnl = sum((p.get("unrealized_pl") or 0.0) for p in positions)

                equity = float(acct.get("equity") or acct.get("portfolio_value") or acc.equity)
                cash = float(acct.get("cash") or acc.current_balance)
                buying_power = float(acct.get("buying_power") or 0.0)

                return {
                    "account": base,
                    "live": True,
                    "equity": equity,
                    "cash": cash,
                    "buying_power": buying_power,
                    "unrealized_pnl": unrealized_pnl,
                    "gross_exposure": gross_exposure,
                    "positions": positions,
                }
            except Exception as exc:
                logger.warning("Failed to fetch broker data for account %s: %s", acc.id, exc)

        # Fallback to stored DB values for non-live/simulated accounts
        return {
            "account": base,
            "live": False,
            "equity": float(acc.equity or 0.0),
            "cash": float(acc.current_balance or 0.0),
            "buying_power": None,
            "unrealized_pnl": float(acc.unrealized_pnl or 0.0),
            "gross_exposure": 0.0,
            "positions": [],
        }

    results = await asyncio.gather(*[_fetch(a) for a in accounts], return_exceptions=True)
    rows = [r for r in results if not isinstance(r, Exception)]

    # Summary metrics
    total_equity = sum((r.get("equity") or 0.0) for r in rows)
    total_buying_power = sum((r.get("buying_power") or 0.0) for r in rows if r.get("buying_power") is not None)
    total_unrealized = sum((r.get("unrealized_pnl") or 0.0) for r in rows)
    total_exposure = sum((r.get("gross_exposure") or 0.0) for r in rows)
    accounts_monitored = len(rows)
    avg_leverage = float(sum((r["account"].get("leverage") or 1.0) for r in rows) / accounts_monitored) if accounts_monitored else 0.0

    summary = {
        "total_equity": total_equity,
        "total_buying_power": total_buying_power,
        "total_unrealized_pnl": total_unrealized,
        "total_exposure": total_exposure,
        "accounts_monitored": accounts_monitored,
        "avg_leverage": avg_leverage,
    }

    return {"accounts": rows, "summary": summary}
