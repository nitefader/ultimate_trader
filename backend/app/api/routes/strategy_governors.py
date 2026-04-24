"""StrategyControls CRUD endpoints."""
from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.strategy_governor import StrategyControls

router = APIRouter(prefix="/strategy-controls", tags=["strategy_controls"])

logger = logging.getLogger(__name__)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class StrategyControlsCreate(BaseModel):
    name: str = Field(..., min_length=1)
    description: str | None = None
    timeframe: str = "1d"
    duration_mode: str = "swing"
    market_hours: dict[str, Any] = Field(default_factory=dict)
    pdt: dict[str, Any] = Field(default_factory=dict)
    gap_risk: dict[str, Any] = Field(default_factory=dict)
    regime_filter: dict[str, Any] = Field(default_factory=dict)
    cooldown_rules: list[Any] = Field(default_factory=list)
    max_trades_per_session: int | None = None
    max_trades_per_day: int | None = None
    min_time_between_entries_min: int | None = None
    earnings_blackout_enabled: bool = False
    tags: list[str] = Field(default_factory=list)
    source_type: str = "manual"


class StrategyControlsUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    timeframe: str | None = None
    duration_mode: str | None = None
    market_hours: dict[str, Any] | None = None
    pdt: dict[str, Any] | None = None
    gap_risk: dict[str, Any] | None = None
    regime_filter: dict[str, Any] | None = None
    cooldown_rules: list[Any] | None = None
    max_trades_per_session: int | None = None
    max_trades_per_day: int | None = None
    min_time_between_entries_min: int | None = None
    earnings_blackout_enabled: bool | None = None
    tags: list[str] | None = None
    source_type: str | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt(g: StrategyControls) -> dict[str, Any]:
    return {
        "id": g.id,
        "name": g.name,
        "description": g.description,
        "timeframe": g.timeframe,
        "duration_mode": g.duration_mode,
        "market_hours": g.market_hours or {},
        "pdt": g.pdt or {},
        "gap_risk": g.gap_risk or {},
        "regime_filter": g.regime_filter or {},
        "cooldown_rules": g.cooldown_rules or [],
        "max_trades_per_session": g.max_trades_per_session,
        "max_trades_per_day": g.max_trades_per_day,
        "min_time_between_entries_min": g.min_time_between_entries_min,
        "earnings_blackout_enabled": bool(g.earnings_blackout_enabled),
        "is_golden": bool(g.is_golden),
        "tags": g.tags or [],
        "source_type": g.source_type,
        "created_at": g.created_at.isoformat() if g.created_at else None,
        "updated_at": g.updated_at.isoformat() if g.updated_at else None,
    }


async def _get_or_404(controls_id: str, db: AsyncSession) -> StrategyControls:
    result = await db.execute(select(StrategyControls).where(StrategyControls.id == controls_id))
    g = result.scalars().first()
    if not g:
        raise HTTPException(status_code=404, detail="StrategyControls not found")
    return g


# ── AI Summarize ─────────────────────────────────────────────────────────────

class SummarizeControlsRequest(BaseModel):
    timeframe: str = "1d"
    duration_mode: str = "swing"
    market_hours: dict[str, Any] = Field(default_factory=dict)
    max_trades_per_session: int | None = None
    max_trades_per_day: int | None = None
    min_time_between_entries_min: int | None = None
    cooldown_rules: list[Any] = Field(default_factory=list)
    earnings_blackout_enabled: bool = False
    regime_filter: dict[str, Any] = Field(default_factory=dict)
    pdt: dict[str, Any] = Field(default_factory=dict)
    gap_risk: dict[str, Any] = Field(default_factory=dict)


_SUMMARIZE_SYSTEM_PROMPT = """You are a trading system configurator summarizing a Strategy Controls configuration.
Return a JSON object with:
- "summary": 2-3 sentence plain-English description of what these controls do, when they allow trading, what they block, and what cooldown/cap behavior is active
- "suggested_name": a highly scannable name for dropdown selection that embeds the most important operational details. Format: "<Style> <Timeframe> · <key session info> · <key cap or cooldown>". Examples: "NYSE Intraday 5m · 09:45-11:00, 13:30-15:00 · Max 3/day · 30min cooldown", "Swing Daily · All-session · 2-bar cooldown on stop", "Scalp 1m · 2 windows · Max 5/session · PDT enforced", "Position Weekly · Earnings blackout · No cap". Aim for 45-65 chars.
- "suggested_description": 1-2 sentences describing the trading style this suits, key session constraints, and important gates (PDT, earnings blackout, regime filter, gap risk). Useful as a tooltip.
- "compatibility": object with "day_trading": bool, "swing_trading": bool, "position_trading": bool
- "warnings": array of plain-English issues (e.g. "No session windows — fires all day", "No trade cap — unlimited entries", "Session windows set but timeframe is daily — windows will be ignored")
Return ONLY valid JSON, no markdown."""


@router.post("/summarize")
async def summarize_controls(body: SummarizeControlsRequest):
    try:
        from app.services.ai_service import generate_json

        mh = body.market_hours or {}
        windows: list[dict[str, Any]] = mh.get("entry_windows", [])
        force_flat_by: str | None = mh.get("force_flat_by")
        skip_first_minutes: int | None = mh.get("skip_first_minutes")
        timezone: str = mh.get("timezone", "America/New_York")

        lines: list[str] = [
            f"Timeframe: {body.timeframe}",
            f"Duration mode: {body.duration_mode}",
        ]

        if windows:
            win_str = ", ".join(f"{w.get('start', '?')}–{w.get('end', '?')}" for w in windows)
            lines.append(f"Entry windows ({len(windows)}): {win_str} ({timezone})")
        else:
            lines.append("Entry windows: none (all-session)")

        if force_flat_by:
            lines.append(f"Force flat by: {force_flat_by}")

        if skip_first_minutes:
            lines.append(f"Skip first {skip_first_minutes} minutes of session")

        if body.max_trades_per_session is not None:
            lines.append(f"Max trades per session: {body.max_trades_per_session}")
        else:
            lines.append("Max trades per session: unlimited")

        if body.max_trades_per_day is not None:
            lines.append(f"Max trades per day: {body.max_trades_per_day}")

        if body.min_time_between_entries_min is not None:
            lines.append(f"Min time between entries: {body.min_time_between_entries_min} minutes")

        if body.cooldown_rules:
            lines.append(f"Cooldown rules: {len(body.cooldown_rules)} rule(s)")

        if body.earnings_blackout_enabled:
            lines.append("Earnings blackout: enabled")

        allowed_regimes: list[str] = (body.regime_filter or {}).get("allowed", [])
        if allowed_regimes:
            lines.append(f"Regime filter — allowed: {', '.join(allowed_regimes)}")
        else:
            lines.append("Regime filter: none")

        pdt_enabled = (body.pdt or {}).get("enabled", False)
        if pdt_enabled:
            lines.append("PDT enforcement: enabled")

        gap_risk_enabled = (body.gap_risk or {}).get("enabled", False)
        if gap_risk_enabled:
            gap_threshold = (body.gap_risk or {}).get("threshold_pct")
            lines.append(f"Gap risk filter: enabled{f' (threshold {gap_threshold}%)' if gap_threshold else ''}")

        config_text = "\n".join(lines)

        result = await generate_json(_SUMMARIZE_SYSTEM_PROMPT, config_text)

        return {
            "summary": result.get("summary", ""),
            "suggested_name": result.get("suggested_name", ""),
            "suggested_description": result.get("suggested_description", ""),
            "compatibility": result.get("compatibility", {"day_trading": False, "swing_trading": False, "position_trading": False}),
            "warnings": result.get("warnings", []),
        }
    except Exception as exc:
        logger.exception("Error in summarize_controls: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to summarize strategy controls: {exc}") from exc


# ── CRUD endpoints ────────────────────────────────────────────────────────────

@router.get("")
async def list_strategy_controls(db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(StrategyControls).order_by(StrategyControls.created_at))
        return [_fmt(g) for g in result.scalars().all()]
    except Exception as exc:
        logger.exception("Error in list_strategy_controls: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to list strategy controls") from exc


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_strategy_controls(body: StrategyControlsCreate, db: AsyncSession = Depends(get_db)):
    try:
        g = StrategyControls(
            id=str(uuid.uuid4()),
            name=body.name,
            description=body.description,
            timeframe=body.timeframe,
            duration_mode=body.duration_mode,
            market_hours=body.market_hours,
            pdt=body.pdt,
            gap_risk=body.gap_risk,
            regime_filter=body.regime_filter,
            cooldown_rules=body.cooldown_rules,
            max_trades_per_session=body.max_trades_per_session,
            max_trades_per_day=body.max_trades_per_day,
            min_time_between_entries_min=body.min_time_between_entries_min,
            earnings_blackout_enabled=body.earnings_blackout_enabled,
            tags=body.tags,
            source_type=body.source_type,
        )
        db.add(g)
        await db.commit()
        await db.refresh(g)
        return _fmt(g)
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in create_strategy_controls: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to create strategy controls") from exc


@router.get("/{controls_id}")
async def get_strategy_controls(controls_id: str, db: AsyncSession = Depends(get_db)):
    try:
        return _fmt(await _get_or_404(controls_id, db))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error in get_strategy_controls for %s: %s", controls_id, exc)
        raise HTTPException(status_code=500, detail="Failed to retrieve strategy controls") from exc


@router.put("/{controls_id}")
async def update_strategy_controls(
    controls_id: str, body: StrategyControlsUpdate, db: AsyncSession = Depends(get_db)
):
    try:
        g = await _get_or_404(controls_id, db)
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(g, field, value)
        await db.commit()
        await db.refresh(g)
        return _fmt(g)
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in update_strategy_controls for %s: %s", controls_id, exc)
        raise HTTPException(status_code=500, detail="Failed to update strategy controls") from exc


@router.delete("/{controls_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_strategy_controls(controls_id: str, db: AsyncSession = Depends(get_db)):
    try:
        g = await _get_or_404(controls_id, db)
        if g.is_golden:
            raise HTTPException(status_code=403, detail="Golden templates are read-only. Duplicate to customize.")
        await db.delete(g)
        await db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in delete_strategy_controls for %s: %s", controls_id, exc)
        raise HTTPException(status_code=500, detail="Failed to delete strategy controls") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{controls_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_strategy_controls(controls_id: str, db: AsyncSession = Depends(get_db)):
    try:
        g = await _get_or_404(controls_id, db)
        new_g = StrategyControls(
            id=str(uuid.uuid4()),
            name=f"Copy of {g.name}",
            description=g.description,
            timeframe=g.timeframe,
            duration_mode=g.duration_mode,
            market_hours=dict(g.market_hours or {}),
            pdt=dict(g.pdt or {}),
            gap_risk=dict(g.gap_risk or {}),
            regime_filter=dict(g.regime_filter or {}),
            cooldown_rules=list(g.cooldown_rules or []),
            max_trades_per_session=g.max_trades_per_session,
            max_trades_per_day=g.max_trades_per_day,
            min_time_between_entries_min=g.min_time_between_entries_min,
            earnings_blackout_enabled=g.earnings_blackout_enabled,
            tags=list(g.tags or []),
            source_type="manual",
            is_golden=False,
        )
        db.add(new_g)
        await db.commit()
        await db.refresh(new_g)
        return _fmt(new_g)
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in duplicate_strategy_controls for %s: %s", controls_id, exc)
        raise HTTPException(status_code=500, detail="Failed to duplicate strategy controls") from exc
