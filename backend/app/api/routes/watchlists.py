"""Watchlist Library REST API."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.watchlist import Watchlist, WatchlistMembership
from app.services.watchlist_service import (
    create_watchlist,
    get_watchlist,
    list_watchlists,
    refresh_watchlist,
    serialize_watchlist,
    set_watchlist_membership_state,
)

router = APIRouter(prefix="/watchlists", tags=["watchlists"])


class CreateWatchlistRequest(BaseModel):
    name: str
    watchlist_type: str = "manual"
    refresh_cron: str | None = None
    refresh_window: str | None = None   # named window — e.g. "market_open", "eod"
    min_refresh_interval_minutes: int = 5
    config: dict[str, Any] = {}


class AddSymbolsRequest(BaseModel):
    symbols: list[str]


class MembershipStateRequest(BaseModel):
    state: str
    reason: str | None = None


class RenameWatchlistRequest(BaseModel):
    name: str


@router.get("/refresh-windows")
async def list_refresh_windows() -> dict[str, Any]:
    """
    Return all named refresh windows and their resolved cron expressions.

    Callers may store a named window in watchlist.config["refresh_window"]
    instead of a raw cron string. The scheduler resolves these at runtime.
    """
    from app.services.watchlist_scheduler import NAMED_REFRESH_WINDOWS

    labels = {
        "pre_market":     "Pre-Market (08:30 ET weekdays)",
        "market_open":    "Market Open (09:30 ET weekdays)",
        "mid_session":    "Mid-Session (12:00 ET weekdays)",
        "market_close":   "Market Close (15:45 ET weekdays)",
        "eod":            "End of Day (16:30 ET weekdays)",
        "after_hours":    "After Hours (18:00 ET weekdays)",
        "daily_midnight": "Daily Midnight (00:00 UTC)",
        "every_5m":       "Every 5 Minutes",
        "every_15m":      "Every 15 Minutes",
        "every_30m":      "Every 30 Minutes",
        "hourly":         "Hourly",
    }

    return {
        "windows": [
            {
                "key": key,
                "label": labels.get(key, key),
                "cron": cron,
            }
            for key, cron in NAMED_REFRESH_WINDOWS.items()
        ]
    }


@router.get("")
async def list_all(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    watchlists = await list_watchlists(db)
    return [serialize_watchlist(w) for w in watchlists]


@router.post("")
async def create(req: CreateWatchlistRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    try:
        # Merge refresh_window into config so the scheduler can resolve it
        merged_config = dict(req.config)
        if req.refresh_window:
            from app.services.watchlist_scheduler import NAMED_REFRESH_WINDOWS
            if req.refresh_window not in NAMED_REFRESH_WINDOWS:
                raise ValueError(
                    f"Unknown refresh_window '{req.refresh_window}'. "
                    f"Valid options: {', '.join(NAMED_REFRESH_WINDOWS.keys())}"
                )
            merged_config["refresh_window"] = req.refresh_window

        wl = await create_watchlist(
            db,
            name=req.name,
            watchlist_type=req.watchlist_type,
            refresh_cron=req.refresh_cron,
            min_refresh_interval_minutes=req.min_refresh_interval_minutes,
            config=merged_config,
        )
        await db.commit()
        await db.refresh(wl, attribute_names=["memberships"])
        return serialize_watchlist(wl)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{watchlist_id}")
async def get_one(watchlist_id: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    wl = await get_watchlist(db, watchlist_id)
    if wl is None:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return serialize_watchlist(wl)


@router.post("/{watchlist_id}/refresh")
async def refresh(
    watchlist_id: str,
    req: AddSymbolsRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Add/update symbols via a refresh cycle. Runs full lifecycle transitions."""
    wl = await db.get(Watchlist, watchlist_id)
    if wl is None:
        raise HTTPException(status_code=404, detail="Watchlist not found")

    try:
        updated = await refresh_watchlist(db, watchlist_id, symbols=req.symbols)
        await db.commit()
        return serialize_watchlist(updated)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/{watchlist_id}")
async def rename_watchlist(
    watchlist_id: str,
    req: RenameWatchlistRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Rename a watchlist."""
    wl = await db.get(Watchlist, watchlist_id)
    if wl is None:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    wl.name = name
    await db.commit()
    await db.refresh(wl, attribute_names=["memberships"])
    return serialize_watchlist(wl)


@router.delete("/{watchlist_id}/members/{symbol}", status_code=204, response_model=None)
async def remove_member(
    watchlist_id: str,
    symbol: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Hard-delete a membership row from a watchlist."""
    wl = await db.get(Watchlist, watchlist_id)
    if wl is None:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    result = await db.execute(
        select(WatchlistMembership).where(
            WatchlistMembership.watchlist_id == watchlist_id,
            WatchlistMembership.symbol == symbol.upper(),
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=404, detail="Member not found")
    await db.delete(membership)
    await db.commit()


@router.patch("/{watchlist_id}/members/{symbol}")
async def update_member_state(
    watchlist_id: str,
    symbol: str,
    req: MembershipStateRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Manually transition a membership state (e.g. suspend)."""
    try:
        membership = await set_watchlist_membership_state(
            db,
            watchlist_id,
            symbol.upper(),
            state=req.state,
            reason=req.reason,
        )
        await db.commit()
        return {
            "symbol": membership.symbol,
            "state": membership.state,
            "watchlist_id": watchlist_id,
        }
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
