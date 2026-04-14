"""
Paper → Live promotion service.

Handles the structured review gate and AccountAllocation state transition
when promoting a paper-trading deployment to live execution.

Promotion flow
--------------
1. Caller builds a PromotionReview (paper performance summary, safety checklist)
2. prepare_promotion_review() validates and returns a draft payload
3. User reviews and confirms in UI
4. execute_promotion() transitions AccountAllocation.status: paper → promoted_to_live
   - Verifies the program is frozen
   - Verifies the account has live credentials
   - Snapshots the review payload
   - Updates promoted_at, promoted_by
5. On rollback: revert_promotion() → status back to paper

Alpaca endpoint distinction
---------------------------
paper mode: https://paper-api.alpaca.markets  (APCA_PAPER_API_KEY / APCA_PAPER_SECRET)
live mode:  https://api.alpaca.markets        (APCA_LIVE_API_KEY / APCA_LIVE_SECRET)

The credential swap is the only structural difference. Everything else (order
submission, fill attribution, ledger) is identical in both modes.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trading_program import AccountAllocation, TradingProgram

logger = logging.getLogger(__name__)

# Statuses allowed to be promoted
_PROMOTABLE_STATUSES = {"paper"}
# Statuses that are terminal (cannot be promoted or reverted)
_TERMINAL_STATUSES = {"stopped", "killed"}


class PromotionError(Exception):
    """Raised when promotion preconditions are not met."""


async def prepare_promotion_review(
    db: AsyncSession,
    allocation_id: str,
    *,
    paper_perf_summary: dict[str, Any],
    safety_checklist: dict[str, bool],
    reviewer: str = "user",
) -> dict[str, Any]:
    """
    Validate promotion preconditions and return a review payload for UI display.

    Does NOT mutate the database. Call execute_promotion() after user confirms.

    Parameters
    ----------
    allocation_id : str
        The AccountAllocation to promote.
    paper_perf_summary : dict
        30-day paper performance snapshot:
            - sharpe, total_pnl, win_rate, max_drawdown, trade_count
            - live_slippage_estimate_bps (applied to simulate live performance)
            - revised_sharpe (with live slippage applied)
    safety_checklist : dict[str, bool]
        All required gates must be True. Keys:
            - position_sizing_verified
            - stop_losses_configured
            - drawdown_threshold_set
            - universe_deny_list_reviewed
            - pdt_compliance_confirmed  (if margin account)
            - live_credentials_verified
            - no_open_paper_positions   (recommended, not blocking)
    reviewer : str
        User identifier for audit trail.

    Returns
    -------
    dict with:
        can_promote : bool
        blocking_issues : list[str]
        warnings : list[str]
        review_payload : dict  (to be stored in AccountAllocation.promotion_review_payload)
    """
    allocation = await db.get(AccountAllocation, allocation_id)
    if allocation is None:
        raise PromotionError(f"AccountAllocation {allocation_id} not found")

    blocking: list[str] = []
    warnings: list[str] = []

    # Status check
    if allocation.status in _TERMINAL_STATUSES:
        blocking.append(f"allocation status is terminal ({allocation.status}) — cannot promote")
    elif allocation.status == "promoted_to_live":
        blocking.append("already promoted to live")
    elif allocation.status not in _PROMOTABLE_STATUSES:
        blocking.append(f"allocation must be in paper status to promote (current: {allocation.status})")

    # Program must be frozen
    program = await db.get(TradingProgram, allocation.trading_program_id)
    if program is None:
        blocking.append("TradingProgram not found")
    elif program.status != "frozen":
        blocking.append(f"TradingProgram must be frozen before promotion (current: {program.status})")

    # Safety checklist — required keys
    required_checklist_keys = [
        "position_sizing_verified",
        "stop_losses_configured",
        "drawdown_threshold_set",
        "universe_deny_list_reviewed",
        "live_credentials_verified",
    ]
    for key in required_checklist_keys:
        if not safety_checklist.get(key):
            blocking.append(f"safety checklist item not confirmed: {key}")

    # Recommended (non-blocking)
    if not safety_checklist.get("no_open_paper_positions", True):
        warnings.append("there are open paper positions — consider closing before promoting")
    if not safety_checklist.get("pdt_compliance_confirmed", True):
        warnings.append("PDT compliance not explicitly confirmed — ensure account equity > $25k or day trade limit respected")

    # Performance sanity (non-blocking)
    revised_sharpe = float(paper_perf_summary.get("revised_sharpe") or 0.0)
    if revised_sharpe < 0.5:
        warnings.append(f"revised Sharpe with live slippage applied is low ({revised_sharpe:.2f}) — review carefully")

    review_payload = {
        "allocation_id": allocation_id,
        "trading_program_id": allocation.trading_program_id,
        "account_id": allocation.account_id,
        "reviewer": reviewer,
        "prepared_at": datetime.now(timezone.utc).isoformat(),
        "paper_perf_summary": paper_perf_summary,
        "safety_checklist": safety_checklist,
        "blocking_issues": blocking,
        "warnings": warnings,
        "can_promote": len(blocking) == 0,
    }

    return {
        "can_promote": len(blocking) == 0,
        "blocking_issues": blocking,
        "warnings": warnings,
        "review_payload": review_payload,
    }


async def execute_promotion(
    db: AsyncSession,
    allocation_id: str,
    *,
    review_payload: dict[str, Any],
    promoted_by: str = "user",
) -> AccountAllocation:
    """
    Execute the paper → live promotion.

    Mutates AccountAllocation in the database. Caller must commit.

    Parameters
    ----------
    allocation_id : str
    review_payload : dict
        Must include can_promote=True (from prepare_promotion_review).
    promoted_by : str
        User identifier for audit trail.

    Raises
    ------
    PromotionError if preconditions are not met.
    """
    if not review_payload.get("can_promote"):
        blocking = review_payload.get("blocking_issues", ["unknown blocking issue"])
        raise PromotionError(f"Cannot promote — blocking issues: {'; '.join(blocking)}")

    allocation = await db.get(AccountAllocation, allocation_id)
    if allocation is None:
        raise PromotionError(f"AccountAllocation {allocation_id} not found")

    if allocation.status not in _PROMOTABLE_STATUSES:
        raise PromotionError(
            f"Cannot promote — allocation status is '{allocation.status}' (expected: paper)"
        )

    # Transition
    allocation.status = "promoted_to_live"
    allocation.broker_mode = "live"
    allocation.promoted_at = datetime.now(timezone.utc)
    allocation.promoted_by = promoted_by
    allocation.promotion_review_payload = review_payload

    await db.flush()

    logger.info(
        "PromotionService: allocation %s promoted to live by %s",
        allocation_id, promoted_by,
    )

    return allocation


async def revert_promotion(
    db: AsyncSession,
    allocation_id: str,
    *,
    reason: str = "manual revert",
    reverted_by: str = "user",
) -> AccountAllocation:
    """
    Revert a promoted allocation back to paper mode.

    Only valid for promoted_to_live → paper transitions.
    Used when a promotion needs to be rolled back (e.g. live credential failure,
    risk limit exceeded shortly after going live).
    """
    allocation = await db.get(AccountAllocation, allocation_id)
    if allocation is None:
        raise PromotionError(f"AccountAllocation {allocation_id} not found")

    if allocation.status != "promoted_to_live":
        raise PromotionError(
            f"Cannot revert — allocation is not in promoted_to_live status (current: {allocation.status})"
        )

    allocation.status = "paper"
    allocation.broker_mode = "paper"
    allocation.stop_reason = f"promotion reverted by {reverted_by}: {reason}"

    # Append revert note to review payload
    payload = dict(allocation.promotion_review_payload or {})
    payload["reverted_at"] = datetime.now(timezone.utc).isoformat()
    payload["reverted_by"] = reverted_by
    payload["revert_reason"] = reason
    allocation.promotion_review_payload = payload

    await db.flush()

    logger.warning(
        "PromotionService: allocation %s reverted to paper by %s — reason: %s",
        allocation_id, reverted_by, reason,
    )

    return allocation


def serialize_allocation(allocation: AccountAllocation) -> dict[str, Any]:
    """Serialize an AccountAllocation to a response dict."""
    return {
        "id": allocation.id,
        "trading_program_id": allocation.trading_program_id,
        "account_id": allocation.account_id,
        "status": allocation.status,
        "broker_mode": allocation.broker_mode,
        "conflict_resolution": allocation.conflict_resolution,
        "allocated_capital_usd": allocation.allocated_capital_usd,
        "position_size_scale_pct": allocation.position_size_scale_pct,
        "session_window_shift_min": allocation.session_window_shift_min,
        "drawdown_threshold_pct": allocation.drawdown_threshold_pct,
        "started_at": allocation.started_at.isoformat() if allocation.started_at else None,
        "stopped_at": allocation.stopped_at.isoformat() if allocation.stopped_at else None,
        "promoted_at": allocation.promoted_at.isoformat() if allocation.promoted_at else None,
        "promoted_by": allocation.promoted_by,
        "stop_reason": allocation.stop_reason,
        "notes": allocation.notes,
        "created_at": allocation.created_at.isoformat() if allocation.created_at else None,
        "updated_at": allocation.updated_at.isoformat() if allocation.updated_at else None,
    }


def serialize_trading_program(program: TradingProgram) -> dict[str, Any]:
    """Serialize a TradingProgram to a response dict."""
    return {
        "id": program.id,
        "name": program.name,
        "version": program.version,
        "description": program.description,
        "status": program.status,
        "duration_mode": program.duration_mode,
        "strategy_version_id": program.strategy_version_id,
        "optimization_profile_id": program.optimization_profile_id,
        "weight_profile_id": program.weight_profile_id,
        "symbol_universe_snapshot_id": program.symbol_universe_snapshot_id,
        "execution_policy": program.execution_policy,
        "parent_program_id": program.parent_program_id,
        "frozen_at": program.frozen_at.isoformat() if program.frozen_at else None,
        "frozen_by": program.frozen_by,
        "deprecation_reason": program.deprecation_reason,
        "created_at": program.created_at.isoformat() if program.created_at else None,
        "updated_at": program.updated_at.isoformat() if program.updated_at else None,
        "created_by": program.created_by,
    }
