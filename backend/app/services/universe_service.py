"""Universe resolution service built on watchlist memberships."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.symbol_universe import SymbolUniverseSnapshot
from app.models.universe_snapshot import UniverseSnapshot
from app.services.watchlist_service import get_watchlist

ACTIVE_MEMBERSHIP_STATES = {"active", "suspended"}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def resolve_universe_snapshot(
    db: AsyncSession,
    *,
    source_watchlist_id: str,
    overlay_watchlist_ids: list[str] | None = None,
    deny_list: list[str] | None = None,
    top_n: int | None = None,
    effective_date: str,
    source: str = "watchlist_resolver",
    notes: str | None = None,
) -> UniverseSnapshot:
    source_watchlist = await get_watchlist(db, source_watchlist_id)
    if source_watchlist is None:
        raise ValueError("Source watchlist not found")

    overlay_watchlist_ids = overlay_watchlist_ids or []
    deny_set = {str(symbol).strip().upper() for symbol in (deny_list or []) if str(symbol).strip()}

    resolved: dict[str, dict[str, Any]] = {}

    def _ingest_memberships(watchlist, *, is_primary: bool) -> None:
        for membership in watchlist.memberships:
            if membership.state not in ACTIVE_MEMBERSHIP_STATES:
                continue
            symbol = membership.symbol.upper()
            if symbol in deny_set:
                continue
            if is_primary or symbol not in resolved:
                resolved[symbol] = {
                    "watchlist_id": watchlist.id,
                    "watchlist_name": watchlist.name,
                    "state": membership.state,
                    "metadata": membership.metadata_ or {},
                }

    _ingest_memberships(source_watchlist, is_primary=True)

    for watchlist_id in overlay_watchlist_ids:
        overlay = await get_watchlist(db, watchlist_id)
        if overlay is None:
            raise ValueError(f"Overlay watchlist not found: {watchlist_id}")
        _ingest_memberships(overlay, is_primary=False)

    symbols = sorted(resolved)
    if top_n is not None and top_n > 0:
        symbols = symbols[:top_n]

    return UniverseSnapshot(
        effective_date=datetime.fromisoformat(effective_date).date(),
        symbols=frozenset(symbols),
        resolved_at=_utcnow_iso(),
        source=source,
        notes=notes,
    )


def serialize_universe_snapshot(snapshot: UniverseSnapshot) -> dict[str, Any]:
    return snapshot.to_dict()


async def persist_symbol_universe_snapshot(
    db: AsyncSession,
    *,
    source_watchlist_id: str,
    overlay_watchlist_ids: list[str] | None = None,
    deny_list: list[str] | None = None,
    top_n: int | None = None,
    effective_date: str,
    metadata_version_id: str | None = None,
    source: str = "watchlist_resolver",
    notes: str | None = None,
) -> SymbolUniverseSnapshot:
    snapshot = await resolve_universe_snapshot(
        db,
        source_watchlist_id=source_watchlist_id,
        overlay_watchlist_ids=overlay_watchlist_ids,
        deny_list=deny_list,
        top_n=top_n,
        effective_date=effective_date,
        source=source,
        notes=notes,
    )
    persisted = SymbolUniverseSnapshot(
        source_watchlist_id=source_watchlist_id,
        overlay_watchlist_ids=list(overlay_watchlist_ids or []),
        deny_list=sorted({str(symbol).strip().upper() for symbol in (deny_list or []) if str(symbol).strip()}),
        top_n=top_n,
        effective_date=effective_date,
        resolved_symbols=sorted(snapshot.symbols),
        resolved_symbol_count=len(snapshot.symbols),
        metadata_version_id=metadata_version_id,
        resolution_notes=notes,
        source=source,
    )
    db.add(persisted)
    await db.flush()
    return persisted


async def get_symbol_universe_snapshot(db: AsyncSession, snapshot_id: str) -> SymbolUniverseSnapshot | None:
    return await db.get(SymbolUniverseSnapshot, snapshot_id)


def serialize_persisted_symbol_universe(snapshot: SymbolUniverseSnapshot) -> dict[str, Any]:
    return {
        "id": snapshot.id,
        "source_watchlist_id": snapshot.source_watchlist_id,
        "overlay_watchlist_ids": snapshot.overlay_watchlist_ids,
        "deny_list": snapshot.deny_list,
        "top_n": snapshot.top_n,
        "effective_date": snapshot.effective_date,
        "resolved_symbols": snapshot.resolved_symbols,
        "resolved_symbol_count": snapshot.resolved_symbol_count,
        "metadata_version_id": snapshot.metadata_version_id,
        "resolution_notes": snapshot.resolution_notes,
        "source": snapshot.source,
        "created_at": snapshot.created_at.isoformat() if snapshot.created_at else None,
    }
