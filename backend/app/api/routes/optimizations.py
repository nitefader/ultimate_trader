"""Optimization profile and weight generation routes."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.optimization_service import (
    create_optimization_profile,
    generate_weight_profile,
    get_optimization_profile,
    list_optimization_profiles,
    serialize_optimization_profile,
    serialize_weight_profile,
)
from app.services.optimizer_framework import (
    ConstraintSet,
    CovarianceModel,
    ObjectiveFunction,
    OptimizationInput,
    optimizer_registry,
)

router = APIRouter(prefix="/optimizations", tags=["optimizations"])


@router.get("")
async def list_profiles(db: AsyncSession = Depends(get_db)):
    profiles = await list_optimization_profiles(db)
    return {"items": [serialize_optimization_profile(profile) for profile in profiles]}


@router.post("")
async def create_profile(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    name = str(body.get("name", "")).strip()
    engine_id = str(body.get("engine_id", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    if not engine_id:
        raise HTTPException(status_code=400, detail="engine_id required")
    try:
        profile = await create_optimization_profile(
            db,
            name=name,
            engine_id=engine_id,
            engine_version=str(body.get("engine_version", "1")),
            strategy_version_id=body.get("strategy_version_id"),
            validation_evidence_id=body.get("validation_evidence_id"),
            symbol_universe_snapshot_id=body.get("symbol_universe_snapshot_id"),
            objective_config=body.get("objective_config") or {},
            covariance_model=body.get("covariance_model") or {},
            constraints=body.get("constraints") or {},
            notes=body.get("notes"),
        )
        await db.commit()
        return serialize_optimization_profile(profile)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{optimization_profile_id}")
async def profile_detail(optimization_profile_id: str, db: AsyncSession = Depends(get_db)):
    profile = await get_optimization_profile(db, optimization_profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="OptimizationProfile not found")
    return serialize_optimization_profile(profile)


@router.post("/{optimization_profile_id}/weights")
async def generate_weights(optimization_profile_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    symbols = [str(symbol).upper() for symbol in body.get("symbols", []) if str(symbol).strip()]
    if not symbols:
        raise HTTPException(status_code=400, detail="symbols required")
    try:
        weight_profile = await generate_weight_profile(
            db,
            optimization_profile_id=optimization_profile_id,
            symbols=symbols,
            symbol_universe_snapshot_id=body.get("symbol_universe_snapshot_id"),
            metadata_version_id=body.get("metadata_version_id"),
        )
        await db.commit()
        return serialize_weight_profile(weight_profile)
    except ValueError as exc:
        await db.rollback()
        message = str(exc)
        status_code = 404 if message in {"OptimizationProfile not found", "ValidationEvidence not found", "MarketMetadata snapshot not found"} else 400
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.get("/engines")
async def list_engines() -> dict[str, Any]:
    """Return all registered optimizer engines with id, version, and phase."""
    _PHASE_MAP = {
        "equal_weight": 1, "capped_inverse_vol": 1, "simple_shrinkage_mv": 1,
        "ledoit_wolf_mv": 2, "turnover_penalized": 2, "slippage_aware": 2, "regime_conditioned": 2,
        "black_litterman": 3, "factor_risk_budgeting": 3, "benchmark_relative": 3, "multi_objective_pareto": 3,
    }
    return {
        "engines": [
            {**e, "phase": _PHASE_MAP.get(e["engine_id"], 1)}
            for e in optimizer_registry.list_registered()
        ]
    }


@router.post("/compare")
async def compare_engines(body: dict[str, Any]) -> dict[str, Any]:
    """P9-S5: Optimizer comparison lab.

    Run multiple engines against the same symbols + metadata and return
    side-by-side weight output and explain data for the frontend lab.

    Request body:
        engine_ids: list[str]           — engines to compare (uses version "1/2/3" auto-detected)
        symbols: list[str]
        metadata_by_symbol: dict        — optional per-symbol metadata
        per_symbol_oos_sharpe: dict     — optional OOS Sharpe per symbol
        constraints: dict               — optional ConstraintSet overrides
        objective_config: dict          — optional objective config (views, capital, etc.)
    """
    engine_ids: list[str] = body.get("engine_ids") or []
    symbols: list[str] = [str(s).upper() for s in body.get("symbols") or [] if str(s).strip()]

    if not engine_ids:
        raise HTTPException(status_code=400, detail="engine_ids required")
    if not symbols:
        raise HTTPException(status_code=400, detail="symbols required")

    metadata_by_symbol: dict[str, Any] = body.get("metadata_by_symbol") or {}
    per_symbol_oos: dict[str, float] = body.get("per_symbol_oos_sharpe") or {}
    constraints_dict: dict[str, Any] = body.get("constraints") or {}
    objective_config: dict[str, Any] = body.get("objective_config") or {}

    optimization_input = OptimizationInput(
        symbols=symbols,
        metadata_by_symbol=metadata_by_symbol,
        validation_payload={"per_symbol_oos_sharpe": per_symbol_oos},
    )
    constraints = ConstraintSet.from_dict(constraints_dict) if constraints_dict else ConstraintSet()
    covariance_model = CovarianceModel(model_id="diagonal")

    # Engine version auto-detection map
    _VERSION_MAP = {
        "equal_weight": "1", "capped_inverse_vol": "1", "simple_shrinkage_mv": "1",
        "ledoit_wolf_mv": "2", "turnover_penalized": "2", "slippage_aware": "2", "regime_conditioned": "2",
        "black_litterman": "3", "factor_risk_budgeting": "3", "benchmark_relative": "3", "multi_objective_pareto": "3",
    }

    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for engine_id in engine_ids:
        version = _VERSION_MAP.get(engine_id, "1")
        try:
            engine = optimizer_registry.get(engine_id, version)
        except ValueError as exc:
            errors.append({"engine_id": engine_id, "error": str(exc)})
            continue

        objective = ObjectiveFunction(objective_id="max_sharpe", config=objective_config)
        try:
            weights, explain = engine.fit(optimization_input, objective, covariance_model, constraints)
            # Compute simple aggregate metrics for comparison
            avg_weight = sum(weights.values()) / len(weights) if weights else 0
            max_weight = max(weights.values()) if weights else 0
            effective_n = 1.0 / sum(w ** 2 for w in weights.values()) if weights else 0
            results.append({
                "engine_id": engine_id,
                "version": version,
                "weights": weights,
                "explain": explain,
                "summary": {
                    "symbol_count": len(weights),
                    "effective_n": round(effective_n, 2),
                    "max_weight": round(max_weight, 4),
                    "avg_weight": round(avg_weight, 4),
                    "concentration_hhi": round(sum(w ** 2 for w in weights.values()), 4),
                },
            })
        except Exception as exc:  # noqa: BLE001
            errors.append({"engine_id": engine_id, "error": str(exc)})

    return {
        "symbols": symbols,
        "results": results,
        "errors": errors,
        "compared": len(results),
    }
