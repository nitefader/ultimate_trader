"""Governor management endpoints — halt, resume, event log, and risk-profile attachment."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.account import Account
from app.models.deployment import Deployment
from app.models.governor_event import GovernorEvent
from app.models.risk_profile import RiskProfile
from app.models.trading_program import AccountAllocation, TradingProgram
from app.services import governor_service
from app.services.trading_program_service import missing_program_components, sync_program_lock_state


async def _broadcast_governor(event_type: str, data: dict) -> None:
    try:
        from app.main import ws_manager
        await ws_manager.broadcast({
            "type": "governor_event",
            "data": {"event_type": event_type, **data},
            "ts": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass

router = APIRouter(tags=["governor"])

logger = logging.getLogger(__name__)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class HaltBody(BaseModel):
    reason: str = "Manual halt from UI"


class RiskProfileAttachBody(BaseModel):
    risk_profile_id: str | None


class HotAddProgramBody(BaseModel):
    program_id: str
    allocated_capital_usd: float = 0.0
    broker_mode: str = "paper"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_event(ev: GovernorEvent) -> dict[str, Any]:
    return {
        "id": ev.id,
        "governor_id": ev.governor_id,
        "allocation_id": ev.allocation_id,
        "event_type": ev.event_type,
        "symbol": ev.symbol,
        "detail": ev.detail,
        "emitted_at": ev.emitted_at.isoformat() if ev.emitted_at else None,
    }


async def _get_account_or_404(account_id: str, db: AsyncSession) -> Account:
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")
    return a


async def _get_governor_or_404(account_id: str, db: AsyncSession) -> Deployment:
    gov = await governor_service.get_governor_for_account(db, account_id)
    if not gov:
        raise HTTPException(status_code=404, detail="No governor found for this account")
    return gov


async def _ensure_governor_for_account(account_id: str, db: AsyncSession) -> Deployment:
    gov = await governor_service.get_governor_for_account(db, account_id)
    if gov is not None:
        return gov

    account = await _get_account_or_404(account_id, db)
    gov = await governor_service.create_governor(
        db,
        account_id=account_id,
        label=f"{account.name} Governor",
        risk_profile_id=getattr(account, "risk_profile_id", None),
        created_by="user",
    )
    await governor_service.activate_governor(db, gov.id)
    await db.commit()
    await db.refresh(gov)
    await _broadcast_governor("governor_bootstrapped", {
        "account_id": account_id,
        "governor_id": gov.id,
        "account_name": account.name,
    })
    return gov


# ── Governor list / get ───────────────────────────────────────────────────────

@router.get("/governor")
async def list_governors(db: AsyncSession = Depends(get_db)):
    try:
        governors = await governor_service.list_governors(db)
        return [governor_service.serialize_governor(g) for g in governors]
    except Exception as exc:
        logger.exception("Error in list_governors: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to list governors") from exc


@router.get("/governor/{account_id}")
async def get_governor(account_id: str, db: AsyncSession = Depends(get_db)):
    try:
        await _get_account_or_404(account_id, db)
        gov = await _get_governor_or_404(account_id, db)
        return governor_service.serialize_governor(gov)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error in get_governor for account %s: %s", account_id, exc)
        raise HTTPException(status_code=500, detail="Failed to retrieve governor") from exc


@router.post("/governor/{account_id}/bootstrap")
async def bootstrap_governor(account_id: str, db: AsyncSession = Depends(get_db)):
    try:
        gov = await _ensure_governor_for_account(account_id, db)
        return governor_service.serialize_governor(gov)
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in bootstrap_governor for account %s: %s", account_id, exc)
        raise HTTPException(status_code=500, detail="Failed to bootstrap governor") from exc


# ── Governor halt / resume ────────────────────────────────────────────────────

@router.post("/governor/{account_id}/halt")
async def halt_governor(
    account_id: str, body: HaltBody, db: AsyncSession = Depends(get_db)
):
    try:
        await _get_account_or_404(account_id, db)
        gov = await _get_governor_or_404(account_id, db)
        updated = await governor_service.halt_governor(
            db, gov.id, trigger="manual", reason=body.reason
        )
        await db.commit()
        return governor_service.serialize_governor(updated)
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in halt_governor for account %s: %s", account_id, exc)
        raise HTTPException(status_code=500, detail="Failed to halt governor") from exc


@router.post("/governor/{account_id}/resume")
async def resume_governor(account_id: str, db: AsyncSession = Depends(get_db)):
    try:
        await _get_account_or_404(account_id, db)
        gov = await _get_governor_or_404(account_id, db)
        updated = await governor_service.resume_governor(db, gov.id)
        await db.commit()
        return governor_service.serialize_governor(updated)
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in resume_governor for account %s: %s", account_id, exc)
        raise HTTPException(status_code=500, detail="Failed to resume governor") from exc


# ── Governor hot-add program ─────────────────────────────────────────────────

@router.post("/governor/{account_id}/allocate")
async def hot_add_program(
    account_id: str, body: HotAddProgramBody, db: AsyncSession = Depends(get_db)
):
    try:
        await _get_account_or_404(account_id, db)
        gov = await _ensure_governor_for_account(account_id, db)

        program = await db.get(TradingProgram, body.program_id)
        if not program:
            raise HTTPException(status_code=404, detail="Program not found")
        await sync_program_lock_state(db, program)
        if program.status == "deprecated":
            raise HTTPException(status_code=400, detail="Deprecated programs cannot be allocated")
        missing_components = missing_program_components(program)
        if missing_components:
            raise HTTPException(
                status_code=400,
                detail=f"Program is not deployable yet. Missing components: {', '.join(missing_components)}",
            )

        # Check if already allocated (pending or paper status)
        existing = await db.execute(
            select(AccountAllocation).where(
                AccountAllocation.trading_program_id == body.program_id,
                AccountAllocation.account_id == account_id,
                AccountAllocation.status.in_(["pending", "paper", "promoted_to_live"]),
            )
        )
        if existing.scalars().first():
            raise HTTPException(status_code=409, detail="Program is already allocated to this account")

        allocation = AccountAllocation(
            id=str(uuid.uuid4()),
            trading_program_id=body.program_id,
            account_id=account_id,
            allocated_capital_usd=body.allocated_capital_usd,
            broker_mode=body.broker_mode,
            status="paper" if body.broker_mode == "paper" else "pending",
            started_at=datetime.now(timezone.utc),
            created_by="user",
        )
        db.add(allocation)
        await db.flush()
        await sync_program_lock_state(db, program, actor="allocation")

        event = GovernorEvent(
            id=str(uuid.uuid4()),
            governor_id=gov.id,
            allocation_id=allocation.id,
            event_type="program_added",
            detail={
                "program_id": body.program_id,
                "program_name": program.name,
                "allocated_capital_usd": body.allocated_capital_usd,
                "broker_mode": body.broker_mode,
            },
        )
        db.add(event)
        await db.commit()
        await db.refresh(allocation)
        await _broadcast_governor("program_added", {
            "account_id": account_id,
            "program_id": body.program_id,
            "program_name": program.name,
        })

        return {
            "allocation_id": allocation.id,
            "program_id": body.program_id,
            "program_name": program.name,
            "account_id": account_id,
            "governor_id": gov.id,
            "allocated_capital_usd": allocation.allocated_capital_usd,
            "broker_mode": allocation.broker_mode,
            "status": allocation.status,
            "started_at": allocation.started_at.isoformat() if allocation.started_at else None,
        }
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in hot_add_program for account %s: %s", account_id, exc)
        raise HTTPException(status_code=500, detail="Failed to allocate program") from exc


# ── Governor event log ────────────────────────────────────────────────────────

@router.get("/governor/{account_id}/events")
async def get_governor_events(
    account_id: str,
    event_type: str | None = Query(default=None, description="Filter by event type"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    try:
        await _get_account_or_404(account_id, db)
        gov = await _get_governor_or_404(account_id, db)

        query = (
            select(GovernorEvent)
            .where(GovernorEvent.governor_id == gov.id)
            .order_by(GovernorEvent.emitted_at.desc())
            .offset(offset)
            .limit(limit)
        )
        if event_type is not None:
            query = query.where(GovernorEvent.event_type == event_type)

        result = await db.execute(query)
        events = result.scalars().all()
        return {
            "governor_id": gov.id,
            "account_id": account_id,
            "limit": limit,
            "offset": offset,
            "event_type_filter": event_type,
            "events": [_fmt_event(e) for e in events],
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error in get_governor_events for account %s: %s", account_id, exc)
        raise HTTPException(status_code=500, detail="Failed to retrieve governor events") from exc


# ── Risk-profile attachment on accounts ──────────────────────────────────────

@router.put("/accounts/{account_id}/risk-profile")
async def attach_risk_profile(
    account_id: str, body: RiskProfileAttachBody, db: AsyncSession = Depends(get_db)
):
    a = await _get_account_or_404(account_id, db)

    if body.risk_profile_id is not None:
        profile = await db.get(RiskProfile, body.risk_profile_id)
        if not profile:
            raise HTTPException(status_code=404, detail="RiskProfile not found")

    a.risk_profile_id = body.risk_profile_id
    await db.commit()
    await db.refresh(a)
    return {
        "account_id": account_id,
        "risk_profile_id": a.risk_profile_id,
        "attached": a.risk_profile_id is not None,
    }


# ── Portfolio snapshot ────────────────────────────────────────────────────────

@router.get("/governor/{account_id}/portfolio-snapshot")
async def portfolio_snapshot(account_id: str, db: AsyncSession = Depends(get_db)):
    """
    Aggregate view of all active allocations for this governor.

    Returns per-allocation capital and an exposure matrix showing which symbols
    overlap across programs (correlation proxy).
    """
    try:
        await _get_account_or_404(account_id, db)
        gov = await _get_governor_or_404(account_id, db)

        from sqlalchemy.orm import selectinload as sl

        allocs_result = await db.execute(
            select(AccountAllocation)
            .options(sl(AccountAllocation.trading_program))
            .where(
                AccountAllocation.account_id == account_id,
                AccountAllocation.status.in_(["paper", "promoted_to_live"]),
            )
        )
        allocs = allocs_result.scalars().all()

        programs_info = []
        symbol_program_map: dict[str, list[str]] = {}
        total_capital = 0.0

        for alloc in allocs:
            prog = alloc.trading_program
            if not prog:
                continue
            capital = float(alloc.allocated_capital_usd or 0)
            total_capital += capital

            # Get watchlist symbols if available
            symbols: list[str] = []
            if prog.watchlist_subscriptions:
                from app.models.watchlist import Watchlist
                wl_ids = prog.watchlist_subscriptions if isinstance(prog.watchlist_subscriptions, list) else []
                for wl_id in wl_ids[:3]:  # cap at 3 watchlists to keep query light
                    wl = await db.get(Watchlist, wl_id)
                    if wl and wl.members:
                        symbols.extend(wl.members)

            programs_info.append({
                "allocation_id": alloc.id,
                "program_id": prog.id,
                "program_name": prog.name,
                "status": alloc.status,
                "broker_mode": alloc.broker_mode,
                "allocated_capital_usd": capital,
                "capital_pct": 0.0,  # filled below
                "symbol_count": len(set(symbols)),
                "symbols": sorted(set(symbols))[:20],
            })

            for sym in set(symbols):
                symbol_program_map.setdefault(sym, []).append(prog.name)

        # Fill capital_pct
        for p in programs_info:
            p["capital_pct"] = round(p["allocated_capital_usd"] / total_capital * 100, 1) if total_capital else 0.0

        # Build overlap matrix — programs that share symbols
        overlap: list[dict] = []
        prog_names = [p["program_name"] for p in programs_info]
        prog_symbols = {p["program_name"]: set(p["symbols"]) for p in programs_info}
        for i, n1 in enumerate(prog_names):
            for n2 in prog_names[i + 1:]:
                shared = prog_symbols[n1] & prog_symbols[n2]
                if shared:
                    overlap.append({
                        "program_a": n1,
                        "program_b": n2,
                        "shared_symbols": sorted(shared),
                        "overlap_count": len(shared),
                    })

        # Symbols with multiple programs = collision risk
        collisions = {
            sym: progs
            for sym, progs in symbol_program_map.items()
            if len(progs) > 1
        }

        return {
            "account_id": account_id,
            "governor_id": gov.id,
            "total_allocated_capital_usd": round(total_capital, 2),
            "program_count": len(programs_info),
            "programs": programs_info,
            "symbol_overlap": overlap,
            "collision_risk_symbols": [
                {"symbol": sym, "programs": progs}
                for sym, progs in collisions.items()
            ],
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error in portfolio_snapshot for account %s: %s", account_id, exc)
        raise HTTPException(status_code=500, detail="Failed to compute portfolio snapshot") from exc


@router.delete("/accounts/{account_id}/risk-profile", status_code=status.HTTP_200_OK)
async def detach_risk_profile(account_id: str, db: AsyncSession = Depends(get_db)):
    a = await _get_account_or_404(account_id, db)
    a.risk_profile_id = None
    await db.commit()
    return {"account_id": account_id, "risk_profile_id": None, "attached": False}


@router.get("/accounts/{account_id}/risk-profile")
async def get_account_risk_profile(account_id: str, db: AsyncSession = Depends(get_db)):
    a = await _get_account_or_404(account_id, db)

    if not a.risk_profile_id:
        return {"attached": False, "risk_profile": None}

    profile = await db.get(RiskProfile, a.risk_profile_id)
    if not profile:
        return {"attached": False, "risk_profile": None}

    return {
        "attached": True,
        "risk_profile": {
            "id": profile.id,
            "name": profile.name,
            "description": profile.description,
            "max_open_positions_long": profile.max_open_positions_long,
            "max_portfolio_heat_long": profile.max_portfolio_heat_long,
            "max_correlated_exposure_long": profile.max_correlated_exposure_long,
            "max_position_size_pct_long": profile.max_position_size_pct_long,
            "max_open_positions_short": profile.max_open_positions_short,
            "max_portfolio_heat_short": profile.max_portfolio_heat_short,
            "max_correlated_exposure_short": profile.max_correlated_exposure_short,
            "max_position_size_pct_short": profile.max_position_size_pct_short,
            "max_daily_loss_pct": profile.max_daily_loss_pct,
            "max_drawdown_lockout_pct": profile.max_drawdown_lockout_pct,
            "max_leverage": profile.max_leverage,
            "source_type": profile.source_type,
            "source_run_id": profile.source_run_id,
            "source_optimization_id": profile.source_optimization_id,
            "created_at": profile.created_at.isoformat() if profile.created_at else None,
            "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
        },
    }
