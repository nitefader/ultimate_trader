"""Server-side watchlist refresh and lifecycle materialization service."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.watchlist import Watchlist, WatchlistMembership

STATE_CANDIDATE = "candidate"
STATE_ACTIVE = "active"
STATE_PENDING_REMOVAL = "pending_removal"
STATE_INACTIVE = "inactive"
STATE_SUSPENDED = "suspended"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_symbols(symbols: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in symbols:
        symbol = str(raw).strip().upper()
        if symbol and symbol not in seen:
            out.append(symbol)
            seen.add(symbol)
    return out


def _lifecycle_config(watchlist: Watchlist) -> dict[str, int]:
    config = watchlist.config or {}
    return {
        "min_dwell_seconds": max(0, int(config.get("min_dwell_seconds", 300))),
        "reentry_cooldown_seconds": max(0, int(config.get("reentry_cooldown_seconds", 900))),
        "ttl_seconds": max(60, int(config.get("ttl_seconds", 86400))),
        "pending_removal_grace_seconds": max(0, int(config.get("pending_removal_grace_seconds", 3600))),
    }


def _serialize_timestamp(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _promote_candidate_if_ready(membership: WatchlistMembership, *, now: datetime, dwell_seconds: int) -> None:
    candidate_since = membership.candidate_since or now
    if (now - candidate_since).total_seconds() >= dwell_seconds:
        membership.state = STATE_ACTIVE
        membership.active_since = membership.active_since or now
        membership.pending_removal_since = None
        membership.inactive_until = None


def _mark_inactive(membership: WatchlistMembership, *, now: datetime, cooldown_seconds: int) -> None:
    membership.state = STATE_INACTIVE
    membership.pending_removal_since = None
    membership.active_since = None
    membership.candidate_since = None
    membership.inactive_until = now + timedelta(seconds=cooldown_seconds)


async def create_watchlist(
    db: AsyncSession,
    *,
    name: str,
    watchlist_type: str = "scanner",
    refresh_cron: str | None = None,
    min_refresh_interval_minutes: int = 5,
    config: dict[str, Any] | None = None,
) -> Watchlist:
    if watchlist_type == "scanner" and min_refresh_interval_minutes < 5:
        raise ValueError("scanner watchlists require a min_refresh_interval_minutes of at least 5")
    watchlist = Watchlist(
        name=name,
        watchlist_type=watchlist_type,
        refresh_cron=refresh_cron,
        min_refresh_interval_minutes=min_refresh_interval_minutes,
        config=config or {},
    )
    db.add(watchlist)
    await db.flush()
    return watchlist


async def list_watchlists(db: AsyncSession) -> list[Watchlist]:
    result = await db.execute(select(Watchlist).order_by(Watchlist.created_at.desc()))
    watchlists = list(result.scalars().all())
    for item in watchlists:
        await db.refresh(item, attribute_names=["memberships"])
    return watchlists


async def get_watchlist(db: AsyncSession, watchlist_id: str) -> Watchlist | None:
    watchlist = await db.get(Watchlist, watchlist_id)
    if watchlist is None:
        return None
    await db.refresh(watchlist, attribute_names=["memberships"])
    return watchlist


async def refresh_watchlist(db: AsyncSession, watchlist_id: str, symbols: list[str] | None = None) -> Watchlist:
    watchlist = await db.get(Watchlist, watchlist_id)
    if watchlist is None:
        raise ValueError("Watchlist not found")

    if watchlist.watchlist_type == "scanner" and watchlist.refresh_cron is None:
        raise ValueError("scanner watchlists require refresh_cron")

    await db.refresh(watchlist, attribute_names=["memberships"])

    refresh_symbols = set(_normalize_symbols(symbols if symbols is not None else watchlist.config.get("symbols", [])))
    now = _utcnow()
    lifecycle = _lifecycle_config(watchlist)
    membership_by_symbol = {membership.symbol: membership for membership in watchlist.memberships}

    for symbol, membership in membership_by_symbol.items():
        membership.resolved_at = now
        metadata = dict(membership.metadata_ or {})
        metadata["source"] = watchlist.watchlist_type
        metadata["last_seen_in_refresh"] = symbol in refresh_symbols
        membership.metadata_ = metadata

        if membership.state == STATE_SUSPENDED:
            continue

        if symbol in refresh_symbols:
            if membership.state == STATE_INACTIVE:
                if membership.inactive_until and now < membership.inactive_until:
                    continue
                membership.state = STATE_CANDIDATE
                membership.candidate_since = now
                membership.inactive_until = None
                membership.pending_removal_since = None
                membership.active_since = None
            elif membership.state == STATE_PENDING_REMOVAL:
                membership.state = STATE_ACTIVE
                membership.pending_removal_since = None
                membership.inactive_until = None
                membership.active_since = membership.active_since or now
            elif membership.state == STATE_CANDIDATE:
                membership.candidate_since = membership.candidate_since or now

            if membership.state == STATE_CANDIDATE:
                _promote_candidate_if_ready(
                    membership,
                    now=now,
                    dwell_seconds=lifecycle["min_dwell_seconds"],
                )
        else:
            if membership.state == STATE_CANDIDATE:
                _mark_inactive(
                    membership,
                    now=now,
                    cooldown_seconds=lifecycle["reentry_cooldown_seconds"],
                )
            elif membership.state == STATE_ACTIVE:
                membership.state = STATE_PENDING_REMOVAL
                membership.pending_removal_since = now
            elif membership.state == STATE_PENDING_REMOVAL:
                pending_since = membership.pending_removal_since or now
                if (now - pending_since).total_seconds() >= lifecycle["pending_removal_grace_seconds"]:
                    _mark_inactive(
                        membership,
                        now=now,
                        cooldown_seconds=lifecycle["reentry_cooldown_seconds"],
                    )

    for symbol in sorted(refresh_symbols):
        if symbol in membership_by_symbol:
            continue
        membership = WatchlistMembership(
            watchlist_id=watchlist.id,
            symbol=symbol,
            state=STATE_CANDIDATE,
            resolved_at=now,
            candidate_since=now,
            metadata_={"source": watchlist.watchlist_type, "last_seen_in_refresh": True},
        )
        _promote_candidate_if_ready(
            membership,
            now=now,
            dwell_seconds=lifecycle["min_dwell_seconds"],
        )
        db.add(membership)

    watchlist.updated_at = now
    await db.flush()
    await db.refresh(watchlist, attribute_names=["memberships"])
    return watchlist


async def set_watchlist_membership_state(
    db: AsyncSession,
    watchlist_id: str,
    symbol: str,
    *,
    state: str,
    reason: str | None = None,
) -> WatchlistMembership:
    watchlist = await db.get(Watchlist, watchlist_id)
    if watchlist is None:
        raise ValueError("Watchlist not found")

    await db.refresh(watchlist, attribute_names=["memberships"])
    membership = next((item for item in watchlist.memberships if item.symbol == symbol.upper()), None)
    if membership is None:
        raise ValueError("Watchlist membership not found")

    now = _utcnow()
    metadata = dict(membership.metadata_ or {})
    metadata["source"] = watchlist.watchlist_type

    if state == STATE_SUSPENDED:
        membership.state = STATE_SUSPENDED
        membership.suspended_at = now
        if reason:
            metadata["suspension_reason"] = reason
    elif state == STATE_ACTIVE:
        membership.state = STATE_ACTIVE
        membership.active_since = membership.active_since or now
        membership.pending_removal_since = None
        membership.inactive_until = None
        membership.suspended_at = None
        metadata.pop("suspension_reason", None)
    else:
        raise ValueError("Unsupported membership state transition")

    membership.metadata_ = metadata
    membership.resolved_at = now
    watchlist.updated_at = now
    await db.flush()
    return membership


def serialize_watchlist(watchlist: Watchlist) -> dict[str, Any]:
    latest_resolved_at = None
    if watchlist.memberships:
        latest_resolved_at = max(item.resolved_at for item in watchlist.memberships if item.resolved_at is not None)
    return {
        "id": watchlist.id,
        "name": watchlist.name,
        "watchlist_type": watchlist.watchlist_type,
        "refresh_cron": watchlist.refresh_cron,
        "min_refresh_interval_minutes": watchlist.min_refresh_interval_minutes,
        "config": watchlist.config,
        "created_at": _serialize_timestamp(watchlist.created_at),
        "updated_at": _serialize_timestamp(watchlist.updated_at),
        "resolved_at": _serialize_timestamp(latest_resolved_at),
        "memberships": [
            {
                "symbol": item.symbol,
                "state": item.state,
                "resolved_at": _serialize_timestamp(item.resolved_at),
                "candidate_since": _serialize_timestamp(item.candidate_since),
                "active_since": _serialize_timestamp(item.active_since),
                "pending_removal_since": _serialize_timestamp(item.pending_removal_since),
                "inactive_until": _serialize_timestamp(item.inactive_until),
                "suspended_at": _serialize_timestamp(item.suspended_at),
                "metadata": item.metadata_,
            }
            for item in sorted(watchlist.memberships, key=lambda entry: entry.symbol)
        ],
    }
