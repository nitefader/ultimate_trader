"""TradingProgram lifecycle helpers.

Programs stay editable while they are saved but not attached to any account.
Once a program has any active allocation, it becomes locked (`frozen`) until all
active allocations are stopped or killed.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trading_program import AccountAllocation, TradingProgram

ACTIVE_ALLOCATION_STATUSES = {"pending", "paper", "promoted_to_live", "paused"}


def missing_program_components(program: TradingProgram) -> list[str]:
    """Return user-facing component labels still missing from a program."""
    attached_components = {
        "strategy": bool(program.strategy_version_id),
        "strategy controls": bool(getattr(program, "strategy_governor_id", None)),
        "risk profile": bool(getattr(program, "risk_profile_id", None)),
        "execution style": bool(getattr(program, "execution_style_id", None)),
        "watchlists": bool(getattr(program, "watchlist_subscriptions", []) or []),
    }
    return [label for label, attached in attached_components.items() if not attached]


async def has_active_allocations(db: AsyncSession, program_id: str) -> bool:
    """Whether the program is currently attached to any active account allocation."""
    result = await db.execute(
        select(func.count())
        .select_from(AccountAllocation)
        .where(
            AccountAllocation.trading_program_id == program_id,
            AccountAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES),
        )
    )
    return bool(result.scalar_one())


async def sync_program_lock_state(
    db: AsyncSession,
    program: TradingProgram,
    *,
    actor: str = "system",
) -> bool:
    """Keep TradingProgram.status aligned with allocation-backed deployment state.

    Returns True when the in-memory ORM object was mutated.
    """
    if program.status == "deprecated":
        return False

    active = await has_active_allocations(db, program.id)

    if active and program.status != "frozen":
        program.status = "frozen"
        if program.frozen_at is None:
            program.frozen_at = datetime.now(timezone.utc)
        if not program.frozen_by:
            program.frozen_by = actor
        return True

    if not active and program.status == "frozen":
        program.status = "draft"
        program.frozen_at = None
        program.frozen_by = None
        return True

    return False
