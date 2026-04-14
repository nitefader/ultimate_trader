"""Optimization orchestration service for WeightProfile generation."""
from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Portfolio Stress Summary
# ---------------------------------------------------------------------------


def compute_portfolio_stress_summary(
    deployment_positions: dict[str, dict[str, float]],
    *,
    pairwise_correlations: dict[str, dict[str, float]] | None = None,
    correlation_threshold: float = 0.75,
) -> dict[str, Any]:
    """
    Compute a portfolio-level stress summary across active deployments.

    Parameters
    ----------
    deployment_positions : dict[deployment_id, dict[symbol, dollar_exposure]]
        Gross dollar exposure per symbol per active deployment. Exposures should
        be positive for long, negative for short (both contribute to gross abs).

    pairwise_correlations : dict[symbol_a, dict[symbol_b, float]] | None
        60-day rolling pairwise correlation matrix. If None, the correlation
        component is omitted from the output (marked as unavailable).

    correlation_threshold : float
        Pairs with abs(corr) >= this value are flagged as high-correlation risk.
        Default: 0.75 (per architecture spec).

    Returns
    -------
    dict with:
        exposure_matrix      — per-symbol gross dollar exposure across each deployment
        total_exposure       — per-symbol total gross dollar exposure summed across all deployments
        concentrated_symbols — symbols where >1 deployment holds exposure (overlap risk)
        correlation_matrix   — full pairwise correlation dict (if provided)
        flagged_pairs        — list of {symbol_a, symbol_b, correlation} for corr >= threshold
        deployment_count     — number of deployments included
        symbol_count         — total unique symbols across all deployments
        correlation_available — bool: whether pairwise_correlations was supplied
    """
    # Build exposure matrix: symbol → {deployment_id → gross_dollar_exposure}
    all_symbols: set[str] = set()
    for positions in deployment_positions.values():
        all_symbols.update(s.upper() for s in positions)

    exposure_matrix: dict[str, dict[str, float]] = {}
    for sym in sorted(all_symbols):
        exposure_matrix[sym] = {}
        for dep_id, positions in deployment_positions.items():
            exposure = positions.get(sym) or positions.get(sym.lower()) or 0.0
            exposure_matrix[sym][dep_id] = round(abs(float(exposure)), 4)

    # Total gross dollar exposure per symbol (sum across deployments)
    total_exposure: dict[str, float] = {
        sym: round(sum(dep_exposures.values()), 4)
        for sym, dep_exposures in exposure_matrix.items()
    }

    # Concentrated symbols: held by more than one deployment
    concentrated_symbols: list[str] = [
        sym
        for sym, dep_exposures in exposure_matrix.items()
        if sum(1 for v in dep_exposures.values() if v > 0) > 1
    ]

    # Correlation analysis
    correlation_available = pairwise_correlations is not None
    correlation_matrix: dict[str, dict[str, float]] = {}
    flagged_pairs: list[dict[str, Any]] = []

    if pairwise_correlations:
        symbols_list = sorted(all_symbols)
        for i, sym_a in enumerate(symbols_list):
            correlation_matrix[sym_a] = {}
            corr_row = pairwise_correlations.get(sym_a) or pairwise_correlations.get(sym_a.lower(), {})
            for j, sym_b in enumerate(symbols_list):
                if i == j:
                    correlation_matrix[sym_a][sym_b] = 1.0
                    continue
                # Check both directions for symmetry
                corr = (
                    corr_row.get(sym_b)
                    or corr_row.get(sym_b.lower())
                    or (pairwise_correlations.get(sym_b) or {}).get(sym_a)
                    or (pairwise_correlations.get(sym_b) or {}).get(sym_a.lower())
                    or 0.0
                )
                correlation_matrix[sym_a][sym_b] = round(float(corr), 4)
                # Flag high-correlation pairs (emit once per pair, i < j)
                if i < j and abs(float(corr)) >= correlation_threshold:
                    flagged_pairs.append({
                        "symbol_a": sym_a,
                        "symbol_b": sym_b,
                        "correlation": round(float(corr), 4),
                        "risk": "high" if abs(float(corr)) >= 0.9 else "elevated",
                    })

    return {
        "exposure_matrix": exposure_matrix,
        "total_exposure": total_exposure,
        "concentrated_symbols": sorted(concentrated_symbols),
        "correlation_matrix": correlation_matrix if correlation_available else {},
        "flagged_pairs": sorted(flagged_pairs, key=lambda p: -abs(p["correlation"])),
        "deployment_count": len(deployment_positions),
        "symbol_count": len(all_symbols),
        "correlation_available": correlation_available,
        "correlation_threshold": correlation_threshold,
    }

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.market_metadata import MarketMetadataSnapshot
from app.models.optimization import OptimizationProfile, WeightProfile
from app.models.symbol_universe import SymbolUniverseSnapshot
from app.models.validation_evidence import ValidationEvidence
from app.services.market_metadata_service import get_latest_snapshot, get_snapshot_by_version
from app.services.optimizer_framework import OptimizationInput, create_weight_profile


async def build_optimization_input(
    db: AsyncSession,
    *,
    symbols: list[str],
    symbol_universe_snapshot_id: str | None = None,
    validation_evidence_id: str | None = None,
    metadata_version_id: str | None = None,
) -> OptimizationInput:
    validation_payload: dict[str, Any] = {}
    if validation_evidence_id:
        evidence = await db.get(ValidationEvidence, validation_evidence_id)
        if evidence is None:
            raise ValueError("ValidationEvidence not found")
        validation_payload = {
            "method": evidence.method,
            "cpcv": evidence.cpcv,
            "walk_forward": evidence.walk_forward,
            "anti_bias": evidence.anti_bias,
            "per_symbol_oos_sharpe": evidence.per_symbol_oos_sharpe,
            "cost_sensitivity_curve": evidence.cost_sensitivity_curve,
            "warnings": evidence.warnings,
            "is_oos_degradation_ratio": evidence.is_oos_degradation_ratio,
            "stability_score": evidence.stability_score,
        }

    snapshot: MarketMetadataSnapshot | None
    if metadata_version_id:
        snapshot = await get_snapshot_by_version(db, metadata_version_id)
    else:
        snapshot = await get_latest_snapshot(db)
    if snapshot is None:
        raise ValueError("MarketMetadata snapshot not found")

    metadata_by_symbol = {}
    available = {item.symbol: item for item in snapshot.symbols}
    for symbol in symbols:
        item = available.get(symbol)
        if item is None:
            metadata_by_symbol[symbol] = {}
            continue
        metadata_by_symbol[symbol] = {
            "sector_tag": item.sector_tag,
            "benchmark_symbol": item.benchmark_symbol,
            "realized_vol_30d": item.realized_vol_30d,
            "avg_pairwise_correlation_60d": item.avg_pairwise_correlation_60d,
            "adv_usd_30d": item.adv_usd_30d,
            "spread_proxy_bps_30d": item.spread_proxy_bps_30d,
            "regime_tag": item.regime_tag,
        }

    return OptimizationInput(
        symbols=symbols,
        symbol_universe_snapshot_id=symbol_universe_snapshot_id,
        validation_evidence_id=validation_evidence_id,
        validation_payload=validation_payload,
        metadata_version_id=snapshot.metadata_version_id,
        metadata_by_symbol=metadata_by_symbol,
    )


async def create_optimization_profile(
    db: AsyncSession,
    *,
    name: str,
    engine_id: str,
    engine_version: str = "1",
    strategy_version_id: str | None = None,
    validation_evidence_id: str | None = None,
    symbol_universe_snapshot_id: str | None = None,
    objective_config: dict[str, Any] | None = None,
    covariance_model: dict[str, Any] | None = None,
    constraints: dict[str, Any] | None = None,
    notes: str | None = None,
) -> OptimizationProfile:
    profile = OptimizationProfile(
        name=name,
        engine_id=engine_id,
        engine_version=engine_version,
        strategy_version_id=strategy_version_id,
        validation_evidence_id=validation_evidence_id,
        symbol_universe_snapshot_id=symbol_universe_snapshot_id,
        objective_config=objective_config or {},
        covariance_model=covariance_model or {},
        constraints=constraints or {},
        notes=notes,
        status="ready",
    )
    db.add(profile)
    await db.flush()
    return profile


async def generate_weight_profile(
    db: AsyncSession,
    *,
    optimization_profile_id: str,
    symbols: list[str],
    symbol_universe_snapshot_id: str | None = None,
    metadata_version_id: str | None = None,
) -> WeightProfile:
    profile = await db.get(OptimizationProfile, optimization_profile_id)
    if profile is None:
        raise ValueError("OptimizationProfile not found")

    optimization_input = await build_optimization_input(
        db,
        symbols=[str(symbol).upper() for symbol in symbols],
        symbol_universe_snapshot_id=symbol_universe_snapshot_id or profile.symbol_universe_snapshot_id,
        validation_evidence_id=profile.validation_evidence_id,
        metadata_version_id=metadata_version_id,
    )
    weight_profile = await create_weight_profile(
        db,
        optimization_profile=profile,
        optimization_input=optimization_input,
    )
    profile.status = "weights_generated"
    await db.flush()
    return weight_profile


async def list_optimization_profiles(db: AsyncSession) -> list[OptimizationProfile]:
    result = await db.execute(
        select(OptimizationProfile).order_by(OptimizationProfile.created_at.desc())
    )
    return list(result.scalars().all())


async def get_optimization_profile(db: AsyncSession, optimization_profile_id: str) -> OptimizationProfile | None:
    return await db.get(OptimizationProfile, optimization_profile_id)


def serialize_optimization_profile(profile: OptimizationProfile) -> dict[str, Any]:
    return {
        "id": profile.id,
        "name": profile.name,
        "engine_id": profile.engine_id,
        "engine_version": profile.engine_version,
        "strategy_version_id": profile.strategy_version_id,
        "validation_evidence_id": profile.validation_evidence_id,
        "symbol_universe_snapshot_id": profile.symbol_universe_snapshot_id,
        "objective_config": profile.objective_config,
        "covariance_model": profile.covariance_model,
        "constraints": profile.constraints,
        "notes": profile.notes,
        "status": profile.status,
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


def compute_factor_shock_scenarios(
    weights: dict[str, float],
    metadata_by_symbol: dict[str, dict[str, Any]],
    capital: float = 100_000,
) -> dict[str, Any]:
    """P8-S5: Phase 2 factor shock stress scenarios.

    Three shocks applied to the weight portfolio:
      1. momentum_crash  — large momentum-factor drawdown (−3σ event)
      2. vol_spike       — realized vol doubles, cross-asset selloff
      3. size_factor     — large-cap underperforms, small-cap outperforms

    Returns per-symbol shocked returns, portfolio-level shocked return,
    and a max_dd_estimate for each scenario.
    """
    scenarios: dict[str, Any] = {}

    symbol_list = list(weights.keys())

    def _portfolio_return(shocked: dict[str, float]) -> float:
        return sum(weights.get(sym, 0.0) * shocked.get(sym, 0.0) for sym in symbol_list)

    # ── Scenario 1: Momentum crash (−3σ momentum factor) ──────────────────────
    mom_shocked: dict[str, float] = {}
    for sym in symbol_list:
        meta = metadata_by_symbol.get(sym, {})
        # Proxy: beta to momentum factor — use oos_sharpe as momentum signal proxy
        oos_sharpe = float(meta.get("oos_sharpe") or 0.5)
        beta_proxy = max(0.0, oos_sharpe / 1.5)  # normalize: sharpe 1.5 → β≈1.0
        # −3σ momentum shock: high-momentum stocks fall hardest
        mom_shocked[sym] = round(-0.15 * beta_proxy, 4)
    port_mom = _portfolio_return(mom_shocked)
    scenarios["momentum_crash"] = {
        "description": "Momentum factor −3σ drawdown",
        "per_symbol_shocked_return": mom_shocked,
        "portfolio_shocked_return": round(port_mom, 4),
        "max_dd_estimate": round(min(port_mom * 1.5, -0.01), 4),
    }

    # ── Scenario 2: Vol spike (VIX×2, broad deleveraging) ─────────────────────
    vol_shocked: dict[str, float] = {}
    for sym in symbol_list:
        meta = metadata_by_symbol.get(sym, {})
        vol = float(meta.get("realized_vol_30d") or 0.15)
        # Higher-vol names fall harder under a vol spike / forced deleveraging
        vol_ratio = vol / 0.15  # ratio vs 15% baseline
        vol_shocked[sym] = round(-0.08 * vol_ratio, 4)
    port_vol = _portfolio_return(vol_shocked)
    scenarios["vol_spike"] = {
        "description": "Realized vol ×2 (VIX spike / deleveraging)",
        "per_symbol_shocked_return": vol_shocked,
        "portfolio_shocked_return": round(port_vol, 4),
        "max_dd_estimate": round(min(port_vol * 1.4, -0.01), 4),
    }

    # ── Scenario 3: Size factor (large-cap underperforms small-cap) ───────────
    size_shocked: dict[str, float] = {}
    ADV_LARGE_CAP_THRESHOLD = 50_000_000  # $50M ADV
    for sym in symbol_list:
        meta = metadata_by_symbol.get(sym, {})
        adv = float(meta.get("adv_30d") or 0)
        if adv >= ADV_LARGE_CAP_THRESHOLD:
            size_shocked[sym] = -0.05  # large-cap underperforms
        elif adv > 0:
            size_shocked[sym] = +0.03  # small-cap outperforms
        else:
            size_shocked[sym] = -0.02  # unknown — slight negative
    port_size = _portfolio_return(size_shocked)
    scenarios["size_factor"] = {
        "description": "Size factor rotation (large-cap −5%, small-cap +3%)",
        "per_symbol_shocked_return": size_shocked,
        "portfolio_shocked_return": round(port_size, 4),
        "max_dd_estimate": round(min(port_size * 1.2, -0.005), 4),
    }

    worst_return = min(s["portfolio_shocked_return"] for s in scenarios.values())
    return {
        "scenarios": scenarios,
        "worst_case_portfolio_return": round(worst_return, 4),
        "worst_case_dollar_impact": round(worst_return * capital, 2),
        "capital": capital,
    }


def serialize_weight_profile(weight_profile: WeightProfile) -> dict[str, Any]:
    return {
        "id": weight_profile.id,
        "optimization_profile_id": weight_profile.optimization_profile_id,
        "engine_id": weight_profile.engine_id,
        "engine_version": weight_profile.engine_version,
        "evidence_id": weight_profile.evidence_id,
        "symbol_universe_snapshot_id": weight_profile.symbol_universe_snapshot_id,
        "metadata_version_id": weight_profile.metadata_version_id,
        "objective_used": weight_profile.objective_used,
        "constraints_used": weight_profile.constraints_used,
        "covariance_model_used": weight_profile.covariance_model_used,
        "input_universe_snapshot": weight_profile.input_universe_snapshot,
        "output_weights": weight_profile.output_weights,
        "explain_output": weight_profile.explain_output,
        "created_at": weight_profile.created_at.isoformat() if weight_profile.created_at else None,
    }
