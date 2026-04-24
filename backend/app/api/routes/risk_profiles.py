"""RiskProfile CRUD endpoints."""
from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.risk_profile import RiskProfile

router = APIRouter(prefix="/risk-profiles", tags=["risk_profiles"])

logger = logging.getLogger(__name__)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class RiskProfileCreate(BaseModel):
    name: str = Field(..., min_length=1)
    description: str | None = None

    # Directional limits — Long side
    max_open_positions_long: int = 5
    max_portfolio_heat_long: float = 0.06
    max_correlated_exposure_long: float = 1.0
    max_position_size_pct_long: float = 0.10

    # Directional limits — Short side
    max_open_positions_short: int = 3
    max_portfolio_heat_short: float = 0.04
    max_correlated_exposure_short: float = 0.80
    max_position_size_pct_short: float = 0.08

    # Account-wide combined limits
    max_daily_loss_pct: float = 0.03
    max_drawdown_lockout_pct: float = 0.10
    max_leverage: float = 2.0

    # Generation provenance
    source_type: str = "manual"
    source_run_id: str | None = None
    source_optimization_id: str | None = None


class RiskProfileUpdate(BaseModel):
    name: str | None = None
    description: str | None = None

    max_open_positions_long: int | None = None
    max_portfolio_heat_long: float | None = None
    max_correlated_exposure_long: float | None = None
    max_position_size_pct_long: float | None = None

    max_open_positions_short: int | None = None
    max_portfolio_heat_short: float | None = None
    max_correlated_exposure_short: float | None = None
    max_position_size_pct_short: float | None = None

    max_daily_loss_pct: float | None = None
    max_drawdown_lockout_pct: float | None = None
    max_leverage: float | None = None

    source_type: str | None = None
    source_run_id: str | None = None
    source_optimization_id: str | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt(profile: RiskProfile, linked_accounts: list[dict[str, str]] | None = None) -> dict[str, Any]:
    return {
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
        "is_golden": bool(getattr(profile, "is_golden", False)),
        "tags": getattr(profile, "tags", []) or [],
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
        "linked_accounts": linked_accounts if linked_accounts is not None else [],
    }


async def _get_profile_or_404(profile_id: str, db: AsyncSession) -> RiskProfile:
    result = await db.execute(
        select(RiskProfile)
        .where(RiskProfile.id == profile_id)
        .options(selectinload(RiskProfile.accounts))
    )
    profile = result.scalars().first()
    if not profile:
        raise HTTPException(status_code=404, detail="RiskProfile not found")
    return profile


# ── CRUD endpoints ────────────────────────────────────────────────────────────

@router.get("")
async def list_risk_profiles(db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(
            select(RiskProfile)
            .options(selectinload(RiskProfile.accounts))
            .order_by(RiskProfile.created_at)
        )
        profiles = result.scalars().all()
        return [
            _fmt(p, linked_accounts=[{"id": a.id, "name": a.name} for a in p.accounts])
            for p in profiles
        ]
    except Exception as exc:
        logger.exception("Error in list_risk_profiles: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to list risk profiles") from exc


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_risk_profile(body: RiskProfileCreate, db: AsyncSession = Depends(get_db)):
    try:
        profile = RiskProfile(
            id=str(uuid.uuid4()),
            name=body.name,
            description=body.description,
            max_open_positions_long=body.max_open_positions_long,
            max_portfolio_heat_long=body.max_portfolio_heat_long,
            max_correlated_exposure_long=body.max_correlated_exposure_long,
            max_position_size_pct_long=body.max_position_size_pct_long,
            max_open_positions_short=body.max_open_positions_short,
            max_portfolio_heat_short=body.max_portfolio_heat_short,
            max_correlated_exposure_short=body.max_correlated_exposure_short,
            max_position_size_pct_short=body.max_position_size_pct_short,
            max_daily_loss_pct=body.max_daily_loss_pct,
            max_drawdown_lockout_pct=body.max_drawdown_lockout_pct,
            max_leverage=body.max_leverage,
            source_type=body.source_type,
            source_run_id=body.source_run_id,
            source_optimization_id=body.source_optimization_id,
        )
        db.add(profile)
        await db.flush()
        await db.commit()
        await db.refresh(profile)
        return _fmt(profile)
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in create_risk_profile: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to create risk profile") from exc


@router.get("/{profile_id}")
async def get_risk_profile(profile_id: str, db: AsyncSession = Depends(get_db)):
    try:
        profile = await _get_profile_or_404(profile_id, db)
        return _fmt(profile, linked_accounts=[{"id": a.id, "name": a.name} for a in profile.accounts])
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error in get_risk_profile for %s: %s", profile_id, exc)
        raise HTTPException(status_code=500, detail="Failed to retrieve risk profile") from exc


@router.put("/{profile_id}")
async def update_risk_profile(
    profile_id: str, body: RiskProfileUpdate, db: AsyncSession = Depends(get_db)
):
    try:
        profile = await _get_profile_or_404(profile_id, db)

        update_fields = body.model_dump(exclude_unset=True)
        for field, value in update_fields.items():
            setattr(profile, field, value)

        await db.commit()
        await db.refresh(profile)

        # Re-load with accounts after refresh
        result = await db.execute(
            select(RiskProfile)
            .where(RiskProfile.id == profile_id)
            .options(selectinload(RiskProfile.accounts))
        )
        profile = result.scalars().first()
        return _fmt(profile, linked_accounts=[{"id": a.id, "name": a.name} for a in profile.accounts])
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in update_risk_profile for %s: %s", profile_id, exc)
        raise HTTPException(status_code=500, detail="Failed to update risk profile") from exc


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_risk_profile(profile_id: str, db: AsyncSession = Depends(get_db)):
    try:
        profile = await _get_profile_or_404(profile_id, db)

        if getattr(profile, "is_golden", False):
            raise HTTPException(status_code=403, detail="Golden templates are read-only. Duplicate to customize.")

        if profile.accounts:
            logger.warning(
                "Deleting risk profile %s that is still linked to %d account(s): %s",
                profile_id,
                len(profile.accounts),
                [a.id for a in profile.accounts],
            )

        await db.delete(profile)
        await db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in delete_risk_profile for %s: %s", profile_id, exc)
        raise HTTPException(status_code=500, detail="Failed to delete risk profile") from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


_ANALYZE_SYSTEM_PROMPT = """You are a quantitative risk management expert reviewing a trading risk profile.
Analyze the provided parameter values and return a JSON object with:
- "health": "good" | "caution" | "risky" — overall assessment
- "summary": one sentence overview
- "suggested_name": a scannable profile name that embeds key parameters so it is self-identifying in a dropdown list. Format: "<Posture> <Style> · <N>pos · <heat>% heat · <daily>% daily". Examples: "Conservative Long-Only · 5pos · 6% heat · 2% daily", "Aggressive L/S · 10pos · 15% heat · 3% daily", "Balanced Swing · 5pos · 8% heat · 2% daily". Keep it under 55 characters.
- "suggested_description": one sentence that names the trading style this suits AND lists the 3-4 most important parameter values, so a user reading the dropdown tooltip knows exactly what they are selecting. Example: "Swing trader profile — 5 long / 3 short max, 6% / 4% heat, 2% daily loss, 1× leverage."
- "insights": array of objects {label, text, tone} where tone is "ok"|"warn"|"danger"
- "suggestions": array of plain-English suggestions to improve the profile

Focus on:
- Portfolio heat vs position size consistency (heat should be ~= positions * size)
- Daily loss vs drawdown lockout ratio (lockout should be 2-3× daily loss)
- Leverage appropriateness (>2× is aggressive for most retail traders)
- Long/short asymmetry (shorts usually warrant lower limits due to risk)
- Whether max correlated exposure leaves room for diversification

Return ONLY valid JSON, no markdown."""


class AnalyzeProfileRequest(BaseModel):
    max_open_positions_long: int
    max_portfolio_heat_long: float
    max_correlated_exposure_long: float
    max_position_size_pct_long: float
    max_open_positions_short: int
    max_portfolio_heat_short: float
    max_correlated_exposure_short: float
    max_position_size_pct_short: float
    max_daily_loss_pct: float
    max_drawdown_lockout_pct: float
    max_leverage: float


@router.post("/analyze")
async def analyze_risk_profile(body: AnalyzeProfileRequest):
    """Use AI to analyze risk profile parameters and return structured feedback."""
    from app.services.ai_service import generate_json

    params_text = (
        f"Long: max {body.max_open_positions_long} positions, "
        f"{body.max_portfolio_heat_long:.1f}% heat, "
        f"{body.max_correlated_exposure_long:.1f}% correlated exposure, "
        f"{body.max_position_size_pct_long:.1f}% max position size.\n"
        f"Short: max {body.max_open_positions_short} positions, "
        f"{body.max_portfolio_heat_short:.1f}% heat, "
        f"{body.max_correlated_exposure_short:.1f}% correlated exposure, "
        f"{body.max_position_size_pct_short:.1f}% max position size.\n"
        f"Account-wide: {body.max_daily_loss_pct:.1f}% daily loss limit, "
        f"{body.max_drawdown_lockout_pct:.1f}% drawdown lockout, "
        f"{body.max_leverage:.1f}× leverage."
    )
    try:
        result = await generate_json(_ANALYZE_SYSTEM_PROMPT, f"Analyze this risk profile:\n\n{params_text}")
        return {
            "health": result.get("health", "caution"),
            "summary": result.get("summary", ""),
            "suggested_name": result.get("suggested_name", ""),
            "suggested_description": result.get("suggested_description", ""),
            "insights": result.get("insights") or [],
            "suggestions": result.get("suggestions") or [],
        }
    except Exception as exc:
        logger.exception("Error in analyze_risk_profile: %s", exc)
        raise HTTPException(status_code=500, detail="AI analysis failed") from exc


@router.post("/{profile_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_risk_profile(profile_id: str, db: AsyncSession = Depends(get_db)):
    """Duplicate a risk profile (including golden ones). Result is always non-golden."""
    try:
        profile = await _get_profile_or_404(profile_id, db)
        new_profile = RiskProfile(
            id=str(uuid.uuid4()),
            name=f"Copy of {profile.name}",
            description=profile.description,
            max_open_positions_long=profile.max_open_positions_long,
            max_portfolio_heat_long=profile.max_portfolio_heat_long,
            max_correlated_exposure_long=profile.max_correlated_exposure_long,
            max_position_size_pct_long=profile.max_position_size_pct_long,
            max_open_positions_short=profile.max_open_positions_short,
            max_portfolio_heat_short=profile.max_portfolio_heat_short,
            max_correlated_exposure_short=profile.max_correlated_exposure_short,
            max_position_size_pct_short=profile.max_position_size_pct_short,
            max_daily_loss_pct=profile.max_daily_loss_pct,
            max_drawdown_lockout_pct=profile.max_drawdown_lockout_pct,
            max_leverage=profile.max_leverage,
            source_type="manual",
            is_golden=False,
            tags=list(getattr(profile, "tags", []) or []),
        )
        db.add(new_profile)
        await db.commit()
        await db.refresh(new_profile)
        return _fmt(new_profile)
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in duplicate_risk_profile for %s: %s", profile_id, exc)
        raise HTTPException(status_code=500, detail="Failed to duplicate risk profile") from exc
