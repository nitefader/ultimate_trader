"""Strategy CRUD and version management endpoints."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.strategy import Strategy, StrategyVersion
from app.models.run import BacktestRun
from app.models.deployment import Deployment

router = APIRouter(prefix="/strategies", tags=["strategies"])

SUPPORTED_BACKTEST_TIMEFRAMES = {"1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"}


VALID_DURATION_MODES = {"day", "swing", "position"}

VALID_INDICATOR_KINDS = {
    # Moving averages
    "sma", "ema", "wma", "vwma", "hull_ma",
    # Momentum / oscillators
    "rsi",
    # MACD family — macd() produces three flat columns: macd, macd_signal, macd_hist
    "macd", "macd_signal", "macd_hist",
    # Bands / channels
    "bollinger", "bb_upper", "bb_mid", "bb_lower",
    "keltner", "donchian",
    # Volatility
    "atr",
    # Trend strength
    "adx", "plus_di", "minus_di",
    # Stochastic — stochastic() produces stoch_k, stoch_d
    "stochastic", "stoch_k", "stoch_d",
    # Pattern / structure
    "chandelier",
    "fractals",
    "swing_highs_lows", "swing_high", "swing_low",
    # Volume / price
    "obv",
    "vwap", "vwap_session",
    "volume_sma_20",
    # Pivot points — pivot_points() produces pp, r1/r2/r3, s1/s2/s3
    "pivot_points", "pp",
    "r1", "r2", "r3", "s1", "s2", "s3",
    # Ichimoku — components
    "ichimoku",
    "ichimoku_tenkan", "ichimoku_kijun",
    "ichimoku_senkou_a", "ichimoku_senkou_b", "ichimoku_chikou",
    # Opening range
    "opening_range_high", "opening_range_low",
    # Gap
    "open_gap_pct",
}


class StrategyCreateRequest(BaseModel):
    name: str
    description: str | None = None
    category: str = "custom"
    tags: list[str] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = "Initial version"
    duration_mode: str = "swing"


class StrategyVersionCreateRequest(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None
    duration_mode: str | None = None  # if None, inherits from previous version


class StrategyValidateRequest(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)
    duration_mode: str | None = None


def _validate_indicator_kinds(config: dict[str, Any]) -> list[str]:
    """
    Walk all ValueSpec references in conditions and check that any 'indicator'
    field uses a known IndicatorKind.  Returns a list of warning strings.
    NLP-generated strategies are validated here before being saved.
    """
    warnings: list[str] = []

    def _check_value_spec(spec: Any, path: str) -> None:
        if not isinstance(spec, dict):
            return
        kind = spec.get("indicator") or spec.get("kind")
        if kind and kind not in VALID_INDICATOR_KINDS:
            warnings.append(
                f"Unknown indicator kind '{kind}' at {path}. "
                f"Supported: {', '.join(sorted(VALID_INDICATOR_KINDS))}"
            )

    def _walk_condition(cond: Any, path: str) -> None:
        if not isinstance(cond, dict):
            return
        _check_value_spec(cond.get("left"), f"{path}.left")
        _check_value_spec(cond.get("right"), f"{path}.right")
        for sub in cond.get("conditions", []):
            _walk_condition(sub, f"{path}.sub")
        if cond.get("condition"):
            _walk_condition(cond["condition"], f"{path}.condition")

    entry = config.get("entry", {})
    for i, cond in enumerate(entry.get("conditions", [])):
        _walk_condition(cond, f"entry.conditions[{i}]")
    for i, cond in enumerate(entry.get("short_conditions", [])):
        _walk_condition(cond, f"entry.short_conditions[{i}]")

    scale_in = config.get("scale_in") or {}
    for i, cond in enumerate(scale_in.get("conditions", [])):
        _walk_condition(cond, f"scale_in.conditions[{i}]")

    return warnings


def _validate_duration_mode(duration_mode: str | None) -> list[str]:
    """Return errors if duration_mode is not a valid value."""
    if duration_mode is None:
        return []
    if duration_mode not in VALID_DURATION_MODES:
        return [f"Invalid duration_mode '{duration_mode}'. Must be one of: {', '.join(sorted(VALID_DURATION_MODES))}"]
    return []


def _validate_strategy_config(config: dict[str, Any], duration_mode: str | None = None) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    entry = config.get("entry")
    if not isinstance(entry, dict):
        errors.append("Missing 'entry' configuration")
        entry = {}

    conditions = entry.get("conditions", [])
    if not isinstance(conditions, list) or len(conditions) == 0:
        errors.append("Entry has no conditions")

    stop_loss = config.get("stop_loss")
    if not stop_loss:
        warnings.append("No stop_loss configured — trades may have unbounded risk")

    position_sizing = config.get("position_sizing")
    if not position_sizing:
        warnings.append("No position_sizing configured — using defaults")

    timeframe = config.get("timeframe")
    if isinstance(timeframe, str) and timeframe not in SUPPORTED_BACKTEST_TIMEFRAMES:
        warnings.append(
            f"Timeframe '{timeframe}' is not supported by yfinance backtests. Supported: {', '.join(sorted(SUPPORTED_BACKTEST_TIMEFRAMES))}"
        )

    symbols = config.get("symbols")
    if symbols is not None:
        if not isinstance(symbols, list):
            errors.append("symbols must be a list of ticker strings")
        elif len(symbols) == 0:
            errors.append("symbols cannot be empty when provided")
        elif any(not isinstance(s, str) or not s.strip() for s in symbols):
            errors.append("symbols must contain non-empty ticker strings")

    risk = config.get("risk")
    if isinstance(risk, dict):
        def _safe_float(key: str) -> float | None:
            value = risk.get(key)
            if value is None:
                return None
            try:
                return float(value)
            except (TypeError, ValueError):
                errors.append(f"risk.{key} must be numeric")
                return None

        max_position_size_pct = risk.get("max_position_size_pct")
        max_position_size_pct_f = _safe_float("max_position_size_pct")
        if max_position_size_pct_f is not None and not (0 < max_position_size_pct_f <= 1):
            errors.append("risk.max_position_size_pct must be between 0 and 1")

        max_daily_loss_pct_f = _safe_float("max_daily_loss_pct")
        if max_daily_loss_pct_f is not None and not (0 < max_daily_loss_pct_f <= 1):
            errors.append("risk.max_daily_loss_pct must be between 0 and 1")

        max_open_positions = risk.get("max_open_positions")
        if max_open_positions is not None:
            try:
                if int(max_open_positions) <= 0:
                    errors.append("risk.max_open_positions must be greater than 0")
            except (TypeError, ValueError):
                errors.append("risk.max_open_positions must be an integer")

        max_portfolio_heat_f = _safe_float("max_portfolio_heat")
        if max_portfolio_heat_f is not None and not (0 < max_portfolio_heat_f <= 1):
            errors.append("risk.max_portfolio_heat must be between 0 and 1")

    errors += _validate_duration_mode(duration_mode)
    warnings += _validate_indicator_kinds(config)

    return errors, warnings


# ── Strategy endpoints ────────────────────────────────────────────────────────

@router.get("")
async def list_strategies(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Strategy).order_by(Strategy.created_at.desc()))
    strategies = result.scalars().all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "description": s.description,
            "category": s.category,
            "status": s.status,
            "tags": s.tags,
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        }
        for s in strategies
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_strategy(body: StrategyCreateRequest, db: AsyncSession = Depends(get_db)):
    errors, warnings = _validate_strategy_config(body.config, body.duration_mode)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors, "warnings": warnings})

    strategy = Strategy(
        id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        category=body.category,
        tags=body.tags,
        status="draft",
    )
    db.add(strategy)

    version = StrategyVersion(
        id=str(uuid.uuid4()),
        strategy_id=strategy.id,
        version=1,
        config=body.config,
        notes=body.notes,
        duration_mode=body.duration_mode,
    )
    db.add(version)
    await db.flush()
    await db.refresh(strategy)
    return {"id": strategy.id, "version_id": version.id, "status": "created"}


@router.get("/{strategy_id}")
async def get_strategy(strategy_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Strategy)
        .options(selectinload(Strategy.versions))
        .where(Strategy.id == strategy_id)
    )
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "category": s.category,
        "status": s.status,
        "tags": s.tags,
        "versions": [
            {
                "id": v.id,
                "version": v.version,
                "config": v.config,
                "notes": v.notes,
                "duration_mode": v.duration_mode,
                "promotion_status": v.promotion_status,
                "created_at": v.created_at.isoformat(),
            }
            for v in sorted(s.versions, key=lambda x: x.version, reverse=True)
        ],
        "created_at": s.created_at.isoformat(),
    }


@router.put("/{strategy_id}")
async def update_strategy(strategy_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    s = await db.get(Strategy, strategy_id)
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")
    if "name" in body:
        s.name = body["name"]
    if "description" in body:
        s.description = body["description"]
    if "status" in body:
        s.status = body["status"]
    if "tags" in body:
        s.tags = body["tags"]
    await db.flush()
    return {"id": s.id, "status": "updated"}


@router.delete("/{strategy_id}")
async def delete_strategy(strategy_id: str, db: AsyncSession = Depends(get_db)):
    s = await db.get(Strategy, strategy_id)
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # Collect all version IDs for this strategy
    ver_result = await db.execute(
        select(StrategyVersion.id).where(StrategyVersion.strategy_id == strategy_id)
    )
    version_ids = [row[0] for row in ver_result.all()]

    blockers: list[str] = []

    if version_ids:
        # Check for any BacktestRun tied to a version of this strategy
        run_result = await db.execute(
            select(BacktestRun.id, BacktestRun.status)
            .where(BacktestRun.strategy_version_id.in_(version_ids))
            .limit(5)
        )
        runs = run_result.all()
        if runs:
            blockers.append(
                f"{len(runs)} backtest run(s) reference this strategy "
                f"(e.g. run {runs[0][0][:8]}…, status={runs[0][1]}). "
                "Delete those runs first or archive them."
            )

        # Check for any Deployment tied to a version of this strategy
        dep_result = await db.execute(
            select(Deployment.id, Deployment.status)
            .where(Deployment.strategy_version_id.in_(version_ids))
            .limit(5)
        )
        deployments = dep_result.all()
        if deployments:
            active = [d for d in deployments if d[1] in ("running", "paused")]
            blockers.append(
                f"{len(deployments)} deployment(s) reference this strategy"
                + (f" — {len(active)} currently active" if active else "")
                + ". Stop and remove those deployments before deleting."
            )

    if blockers:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"Cannot delete strategy '{s.name}' — it is referenced by other components.",
                "blockers": blockers,
            },
        )

    await db.delete(s)
    await db.flush()
    return {"status": "deleted"}


# ── Version endpoints ─────────────────────────────────────────────────────────

@router.post("/{strategy_id}/versions")
async def create_version(strategy_id: str, body: StrategyVersionCreateRequest, db: AsyncSession = Depends(get_db)):
    s = await db.get(Strategy, strategy_id)
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")

    errors, warnings = _validate_strategy_config(body.config)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors, "warnings": warnings})

    # Get latest version number
    result = await db.execute(
        select(StrategyVersion).where(StrategyVersion.strategy_id == strategy_id)
    )
    existing = result.scalars().all()
    next_ver = max((v.version for v in existing), default=0) + 1
    # Inherit duration_mode from latest version if not specified
    prev_mode = max(existing, key=lambda v: v.version).duration_mode if existing else "swing"
    mode = body.duration_mode or prev_mode

    errors, warnings = _validate_strategy_config(body.config, mode)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors, "warnings": warnings})

    version = StrategyVersion(
        id=str(uuid.uuid4()),
        strategy_id=strategy_id,
        version=next_ver,
        config=body.config,
        notes=body.notes or f"Version {next_ver}",
        duration_mode=mode,
    )
    db.add(version)
    await db.flush()
    return {"id": version.id, "version": next_ver, "duration_mode": mode}


@router.get("/{strategy_id}/versions/{version_id}")
async def get_version(strategy_id: str, version_id: str, db: AsyncSession = Depends(get_db)):
    sv = await db.get(StrategyVersion, version_id)
    if not sv or sv.strategy_id != strategy_id:
        raise HTTPException(status_code=404, detail="Version not found")
    return {
        "id": sv.id,
        "strategy_id": sv.strategy_id,
        "version": sv.version,
        "config": sv.config,
        "notes": sv.notes,
        "duration_mode": sv.duration_mode,
        "promotion_status": sv.promotion_status,
        "created_at": sv.created_at.isoformat(),
    }


@router.delete("/{strategy_id}/versions/{version_id}")
async def delete_version(strategy_id: str, version_id: str, db: AsyncSession = Depends(get_db)):
    """
    Delete a single strategy version.

    Guardrails:
    - Cannot delete the only remaining version (strategy must have at least one version).
    - Cannot delete a version with promotion_status of 'paper_approved' or 'live_approved'.
    """
    sv = await db.get(StrategyVersion, version_id)
    if not sv or sv.strategy_id != strategy_id:
        raise HTTPException(status_code=404, detail="Version not found")

    # Guardrail: check actual runs and deployments tied to this version
    ver_blockers: list[str] = []

    run_result = await db.execute(
        select(BacktestRun.id, BacktestRun.status)
        .where(BacktestRun.strategy_version_id == version_id)
        .limit(3)
    )
    ver_runs = run_result.all()
    if ver_runs:
        ver_blockers.append(
            f"{len(ver_runs)} backtest run(s) reference v{sv.version} — delete those runs first."
        )

    dep_result = await db.execute(
        select(Deployment.id, Deployment.status)
        .where(Deployment.strategy_version_id == version_id)
        .limit(3)
    )
    ver_deps = dep_result.all()
    if ver_deps:
        ver_blockers.append(
            f"{len(ver_deps)} deployment(s) reference v{sv.version} — stop and remove those deployments first."
        )

    if ver_blockers:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"Cannot delete v{sv.version} — it is referenced by other components.",
                "blockers": ver_blockers,
            },
        )

    # Ensure strategy retains at least one version
    result = await db.execute(
        select(StrategyVersion).where(StrategyVersion.strategy_id == strategy_id)
    )
    all_versions = result.scalars().all()
    if len(all_versions) <= 1:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete the only version of a strategy. Delete the whole strategy instead.",
        )

    await db.delete(sv)
    await db.flush()
    return {"status": "deleted", "version_id": version_id}


@router.post("/validate")
async def validate_strategy(body: StrategyValidateRequest):
    """Validate a strategy configuration without saving it."""
    errors, warnings = _validate_strategy_config(body.config, body.duration_mode)
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }


@router.post("/{strategy_id}/clone", status_code=status.HTTP_201_CREATED)
async def clone_strategy(strategy_id: str, db: AsyncSession = Depends(get_db)):
    """
    Clone an existing strategy — copies the latest version config into a new
    Strategy record named '{original} (copy)'.  The clone starts as draft with
    version 1 and inherits duration_mode from the source.
    """
    result = await db.execute(
        select(Strategy)
        .options(selectinload(Strategy.versions))
        .where(Strategy.id == strategy_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Strategy not found")

    latest = max(source.versions, key=lambda v: v.version) if source.versions else None

    clone = Strategy(
        id=str(uuid.uuid4()),
        name=f"{source.name} (copy)",
        description=source.description,
        category=source.category,
        tags=list(source.tags),
        status="draft",
    )
    db.add(clone)

    version = StrategyVersion(
        id=str(uuid.uuid4()),
        strategy_id=clone.id,
        version=1,
        config=latest.config if latest else {},
        notes=f"Cloned from {source.name} v{latest.version if latest else 1}",
        duration_mode=latest.duration_mode if latest else "swing",
    )
    db.add(version)
    await db.flush()
    return {"id": clone.id, "version_id": version.id, "source_strategy_id": strategy_id, "status": "cloned"}
