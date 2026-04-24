"""ExecutionStyle CRUD endpoints."""
from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.execution_style import ExecutionStyle

router = APIRouter(prefix="/execution-styles", tags=["execution_styles"])

logger = logging.getLogger(__name__)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ExecutionStyleCreate(BaseModel):
    name: str = Field(..., min_length=1)
    description: str | None = None
    entry_order_type: str = "market"
    entry_time_in_force: str = "day"
    entry_limit_offset_method: str | None = None
    entry_limit_offset_value: float | None = None
    entry_cancel_after_bars: int | None = None
    bracket_mode: str = "bracket"
    stop_order_type: str = "market"
    take_profit_order_type: str = "limit"
    trailing_stop_type: str | None = None
    trailing_stop_value: float | None = None
    scale_out: list[Any] = Field(default_factory=list)
    stop_progression_targets: list[float] = Field(default_factory=list)
    atr_source: str = "strategy"
    atr_length: int | None = None
    atr_timeframe: str | None = None
    breakeven_trigger_level: int | None = None
    breakeven_atr_offset: float = 0.0
    final_runner_exit_mode: str = "internal"
    final_runner_trail_type: str | None = None
    final_runner_trail_value: float | None = None
    final_runner_time_in_force: str | None = None
    fill_model: str = "next_open"
    slippage_bps_assumption: float = 5.0
    commission_per_share: float = 0.005
    tags: list[str] = Field(default_factory=list)
    source_type: str = "manual"


class ExecutionStyleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    entry_order_type: str | None = None
    entry_time_in_force: str | None = None
    entry_limit_offset_method: str | None = None
    entry_limit_offset_value: float | None = None
    entry_cancel_after_bars: int | None = None
    bracket_mode: str | None = None
    stop_order_type: str | None = None
    take_profit_order_type: str | None = None
    trailing_stop_type: str | None = None
    trailing_stop_value: float | None = None
    scale_out: list[Any] | None = None
    stop_progression_targets: list[float] | None = None
    atr_source: str | None = None
    atr_length: int | None = None
    atr_timeframe: str | None = None
    breakeven_trigger_level: int | None = None
    breakeven_atr_offset: float | None = None
    final_runner_exit_mode: str | None = None
    final_runner_trail_type: str | None = None
    final_runner_trail_value: float | None = None
    final_runner_time_in_force: str | None = None
    fill_model: str | None = None
    slippage_bps_assumption: float | None = None
    commission_per_share: float | None = None
    tags: list[str] | None = None
    source_type: str | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt(s: ExecutionStyle) -> dict[str, Any]:
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "entry_order_type": s.entry_order_type,
        "entry_time_in_force": s.entry_time_in_force,
        "entry_limit_offset_method": s.entry_limit_offset_method,
        "entry_limit_offset_value": s.entry_limit_offset_value,
        "entry_cancel_after_bars": s.entry_cancel_after_bars,
        "bracket_mode": s.bracket_mode,
        "stop_order_type": s.stop_order_type,
        "take_profit_order_type": s.take_profit_order_type,
        "trailing_stop_type": s.trailing_stop_type,
        "trailing_stop_value": s.trailing_stop_value,
        "scale_out": s.scale_out or [],
        "stop_progression_targets": s.stop_progression_targets or [],
        "atr_source": s.atr_source or "strategy",
        "atr_length": s.atr_length,
        "atr_timeframe": s.atr_timeframe,
        "breakeven_trigger_level": s.breakeven_trigger_level,
        "breakeven_atr_offset": s.breakeven_atr_offset if s.breakeven_atr_offset is not None else 0.0,
        "final_runner_exit_mode": s.final_runner_exit_mode or "internal",
        "final_runner_trail_type": s.final_runner_trail_type,
        "final_runner_trail_value": s.final_runner_trail_value,
        "final_runner_time_in_force": s.final_runner_time_in_force,
        "fill_model": s.fill_model,
        "slippage_bps_assumption": s.slippage_bps_assumption,
        "commission_per_share": s.commission_per_share,
        "is_golden": bool(s.is_golden),
        "tags": s.tags or [],
        "source_type": s.source_type,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


async def _get_or_404(style_id: str, db: AsyncSession) -> ExecutionStyle:
    result = await db.execute(select(ExecutionStyle).where(ExecutionStyle.id == style_id))
    s = result.scalars().first()
    if not s:
        raise HTTPException(status_code=404, detail="ExecutionStyle not found")
    return s


# ── AI Analyze ────────────────────────────────────────────────────────────────

class AnalyzeStyleRequest(BaseModel):
    entry_order_type: str = "market"
    entry_time_in_force: str = "day"
    entry_limit_offset_method: str | None = None
    entry_limit_offset_value: float | None = None
    entry_cancel_after_bars: int | None = None
    bracket_mode: str = "bracket"
    stop_order_type: str = "market"
    take_profit_order_type: str = "limit"
    trailing_stop_type: str | None = None
    trailing_stop_value: float | None = None
    scale_out: list[Any] = Field(default_factory=list)
    atr_source: str = "strategy"
    atr_length: int | None = None
    atr_timeframe: str | None = None
    breakeven_trigger_level: int | None = None
    fill_model: str = "next_open"
    slippage_bps_assumption: float = 5.0
    commission_per_share: float = 0.005


_ANALYZE_SYSTEM_PROMPT = """You are a trading system configurator analyzing an Execution Style configuration.
Return a JSON object with:
- "suggested_name": a highly scannable name for dropdown selection. Format: "<Entry> <Bracket> · <TIF> · <scale/trail summary>". Examples: "Market Bracket · Day · 2-level scale-out", "Limit ATR Bracket · GTC · Breakeven move", "Market Trailing 2% · Day", "Stop-Limit Breakout · GTC · No scale-out". Aim for 35-55 chars.
- "suggested_description": 1-2 sentences covering entry order expression, bracket/exit behavior, and backtest fill assumption. Useful as a tooltip.
- "health": one of "clean", "caution", "risky"
- "insights": array of plain-English observations about the configuration (e.g., "Market stop on bracket = worst-case fill on gap nights", "Next Open fill model is conservative — good for daily strategies")
- "suggestions": array of improvement suggestions (e.g., "Consider limit stop leg to reduce slippage on volatile symbols")
- "warnings": array of conflict or risk warnings (e.g., "GTC + market order may fill outside session hours", "IOC TIF with bracket — unfilled entry cancels before bracket attaches")
Return ONLY valid JSON, no markdown."""


@router.post("/analyze")
async def analyze_execution_style(body: AnalyzeStyleRequest):
    try:
        from app.services.ai_service import generate_json

        lines: list[str] = [
            f"Entry order type: {body.entry_order_type}",
            f"Time in force: {body.entry_time_in_force}",
        ]

        if body.entry_limit_offset_method:
            lines.append(f"Limit offset: {body.entry_limit_offset_method} = {body.entry_limit_offset_value}")
        if body.entry_cancel_after_bars:
            lines.append(f"Cancel after {body.entry_cancel_after_bars} bars if unfilled")

        lines.append(f"Bracket mode: {body.bracket_mode}")
        if body.bracket_mode == "trailing_stop":
            lines.append(f"Trail: {body.trailing_stop_type} = {body.trailing_stop_value}")
        elif body.bracket_mode != "none":
            lines.append(f"Stop order type: {body.stop_order_type}")
            lines.append(f"Take-profit order type: {body.take_profit_order_type}")

        if body.scale_out:
            total_pct = sum(lvl.get("pct", 0) if isinstance(lvl, dict) else 0 for lvl in body.scale_out)
            scale_desc = ", ".join(
                f"exit {lvl.get('pct', '?')}% at T{i+1}" if isinstance(lvl, dict) else f"level {i+1}"
                for i, lvl in enumerate(body.scale_out)
            )
            lines.append(f"Scale-out: {len(body.scale_out)} level(s) — {scale_desc} ({total_pct:.0f}% total)")
            if body.atr_source == "custom" and body.atr_length is not None and body.atr_timeframe:
                lines.append(f"ATR source: custom {body.atr_length}-period on {body.atr_timeframe}")
            else:
                lines.append("ATR source: strategy feature engine")
            if body.breakeven_trigger_level is not None:
                lines.append(f"Move stop to breakeven after T{body.breakeven_trigger_level}: yes")
        else:
            lines.append("Scale-out: none")

        lines.append(f"Fill model: {body.fill_model}")
        lines.append(f"Slippage assumption: {body.slippage_bps_assumption} bps")
        lines.append(f"Commission: ${body.commission_per_share}/share")

        config_text = "\n".join(lines)
        result = await generate_json(_ANALYZE_SYSTEM_PROMPT, config_text)

        return {
            "suggested_name": result.get("suggested_name", ""),
            "suggested_description": result.get("suggested_description", ""),
            "health": result.get("health", "clean"),
            "insights": result.get("insights", []),
            "suggestions": result.get("suggestions", []),
            "warnings": result.get("warnings", []),
        }
    except Exception as exc:
        logger.exception("Error in analyze_execution_style: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to analyze execution style: {exc}") from exc


# ── CRUD endpoints ────────────────────────────────────────────────────────────

@router.get("")
async def list_execution_styles(db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(ExecutionStyle).order_by(ExecutionStyle.created_at))
        return [_fmt(s) for s in result.scalars().all()]
    except Exception as exc:
        logger.exception("Error in list_execution_styles: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to list execution styles") from exc


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_execution_style(body: ExecutionStyleCreate, db: AsyncSession = Depends(get_db)):
    try:
        s = ExecutionStyle(
            id=str(uuid.uuid4()),
            name=body.name,
            description=body.description,
            entry_order_type=body.entry_order_type,
            entry_time_in_force=body.entry_time_in_force,
            entry_limit_offset_method=body.entry_limit_offset_method,
            entry_limit_offset_value=body.entry_limit_offset_value,
            entry_cancel_after_bars=body.entry_cancel_after_bars,
            bracket_mode=body.bracket_mode,
            stop_order_type=body.stop_order_type,
            take_profit_order_type=body.take_profit_order_type,
            trailing_stop_type=body.trailing_stop_type,
            trailing_stop_value=body.trailing_stop_value,
            scale_out=body.scale_out,
            stop_progression_targets=body.stop_progression_targets,
            atr_source=body.atr_source,
            atr_length=body.atr_length,
            atr_timeframe=body.atr_timeframe,
            breakeven_trigger_level=body.breakeven_trigger_level,
            breakeven_atr_offset=body.breakeven_atr_offset,
            final_runner_exit_mode=body.final_runner_exit_mode,
            final_runner_trail_type=body.final_runner_trail_type,
            final_runner_trail_value=body.final_runner_trail_value,
            final_runner_time_in_force=body.final_runner_time_in_force,
            fill_model=body.fill_model,
            slippage_bps_assumption=body.slippage_bps_assumption,
            commission_per_share=body.commission_per_share,
            tags=body.tags,
            source_type=body.source_type,
        )
        db.add(s)
        await db.commit()
        await db.refresh(s)
        return _fmt(s)
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in create_execution_style: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to create execution style") from exc


@router.get("/{style_id}")
async def get_execution_style(style_id: str, db: AsyncSession = Depends(get_db)):
    try:
        return _fmt(await _get_or_404(style_id, db))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error in get_execution_style for %s: %s", style_id, exc)
        raise HTTPException(status_code=500, detail="Failed to retrieve execution style") from exc


@router.put("/{style_id}")
async def update_execution_style(
    style_id: str, body: ExecutionStyleUpdate, db: AsyncSession = Depends(get_db)
):
    try:
        s = await _get_or_404(style_id, db)
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(s, field, value)
        await db.commit()
        await db.refresh(s)
        return _fmt(s)
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in update_execution_style for %s: %s", style_id, exc)
        raise HTTPException(status_code=500, detail="Failed to update execution style") from exc


@router.delete("/{style_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_execution_style(style_id: str, db: AsyncSession = Depends(get_db)):
    try:
        s = await _get_or_404(style_id, db)
        if s.is_golden:
            raise HTTPException(status_code=403, detail="Golden templates are read-only. Duplicate to customize.")
        await db.delete(s)
        await db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in delete_execution_style for %s: %s", style_id, exc)
        raise HTTPException(status_code=500, detail="Failed to delete execution style") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{style_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_execution_style(style_id: str, db: AsyncSession = Depends(get_db)):
    try:
        s = await _get_or_404(style_id, db)
        new_s = ExecutionStyle(
            id=str(uuid.uuid4()),
            name=f"Copy of {s.name}",
            description=s.description,
            entry_order_type=s.entry_order_type,
            entry_time_in_force=s.entry_time_in_force,
            entry_limit_offset_method=s.entry_limit_offset_method,
            entry_limit_offset_value=s.entry_limit_offset_value,
            entry_cancel_after_bars=s.entry_cancel_after_bars,
            bracket_mode=s.bracket_mode,
            stop_order_type=s.stop_order_type,
            take_profit_order_type=s.take_profit_order_type,
            trailing_stop_type=s.trailing_stop_type,
            trailing_stop_value=s.trailing_stop_value,
            scale_out=list(s.scale_out or []),
            stop_progression_targets=list(s.stop_progression_targets or []),
            atr_source=s.atr_source or "strategy",
            atr_length=s.atr_length,
            atr_timeframe=s.atr_timeframe,
            breakeven_trigger_level=s.breakeven_trigger_level,
            breakeven_atr_offset=s.breakeven_atr_offset if s.breakeven_atr_offset is not None else 0.0,
            final_runner_exit_mode=s.final_runner_exit_mode or "internal",
            final_runner_trail_type=s.final_runner_trail_type,
            final_runner_trail_value=s.final_runner_trail_value,
            final_runner_time_in_force=s.final_runner_time_in_force,
            fill_model=s.fill_model,
            slippage_bps_assumption=s.slippage_bps_assumption,
            commission_per_share=s.commission_per_share,
            tags=list(s.tags or []),
            source_type="manual",
            is_golden=False,
        )
        db.add(new_s)
        await db.commit()
        await db.refresh(new_s)
        return _fmt(new_s)
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Error in duplicate_execution_style for %s: %s", style_id, exc)
        raise HTTPException(status_code=500, detail="Failed to duplicate execution style") from exc
