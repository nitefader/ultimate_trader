"""Universe resolution routes."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.universe_service import (
    get_symbol_universe_snapshot,
    persist_symbol_universe_snapshot,
    resolve_universe_snapshot,
    serialize_persisted_symbol_universe,
    serialize_universe_snapshot,
)

router = APIRouter(prefix="/universes", tags=["universes"])


@router.post("/resolve")
async def resolve_universe(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    source_watchlist_id = str(body.get("source_watchlist_id", "")).strip()
    effective_date = str(body.get("effective_date", "")).strip()
    if not source_watchlist_id:
        raise HTTPException(status_code=400, detail="source_watchlist_id required")
    if not effective_date:
        raise HTTPException(status_code=400, detail="effective_date required")

    try:
        snapshot = await resolve_universe_snapshot(
            db,
            source_watchlist_id=source_watchlist_id,
            overlay_watchlist_ids=list(body.get("overlay_watchlist_ids") or []),
            deny_list=list(body.get("deny_list") or []),
            top_n=body.get("top_n"),
            effective_date=effective_date,
            source=str(body.get("source", "watchlist_resolver")),
            notes=body.get("notes"),
        )
        return serialize_universe_snapshot(snapshot)
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.post("")
async def create_persisted_universe(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    source_watchlist_id = str(body.get("source_watchlist_id", "")).strip()
    effective_date = str(body.get("effective_date", "")).strip()
    if not source_watchlist_id:
        raise HTTPException(status_code=400, detail="source_watchlist_id required")
    if not effective_date:
        raise HTTPException(status_code=400, detail="effective_date required")
    try:
        snapshot = await persist_symbol_universe_snapshot(
            db,
            source_watchlist_id=source_watchlist_id,
            overlay_watchlist_ids=list(body.get("overlay_watchlist_ids") or []),
            deny_list=list(body.get("deny_list") or []),
            top_n=body.get("top_n"),
            effective_date=effective_date,
            metadata_version_id=body.get("metadata_version_id"),
            source=str(body.get("source", "watchlist_resolver")),
            notes=body.get("notes"),
        )
        await db.commit()
        return serialize_persisted_symbol_universe(snapshot)
    except ValueError as exc:
        await db.rollback()
        message = str(exc)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.get("/{universe_snapshot_id}")
async def universe_detail(universe_snapshot_id: str, db: AsyncSession = Depends(get_db)):
    snapshot = await get_symbol_universe_snapshot(db, universe_snapshot_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="SymbolUniverse snapshot not found")
    return serialize_persisted_symbol_universe(snapshot)
