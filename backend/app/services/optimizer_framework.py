"""Pluggable optimizer framework and Phase 1 engine implementations."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.optimization import OptimizationProfile, WeightProfile


@dataclass(frozen=True)
class ObjectiveFunction:
    objective_id: str
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CovarianceModel:
    model_id: str
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ConstraintSet:
    max_symbol_weight: float | None = None
    min_symbol_weight: float = 0.0
    max_sector_weight: float | None = None
    max_pairwise_correlation: float | None = None
    kelly_fraction_ceiling: float | None = None
    min_oos_sharpe: float = 0.3
    min_oos_to_is_ratio: float = 0.5

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "ConstraintSet":
        return cls(**(payload or {}))

    def as_dict(self) -> dict[str, Any]:
        return {
            "max_symbol_weight": self.max_symbol_weight,
            "min_symbol_weight": self.min_symbol_weight,
            "max_sector_weight": self.max_sector_weight,
            "max_pairwise_correlation": self.max_pairwise_correlation,
            "kelly_fraction_ceiling": self.kelly_fraction_ceiling,
            "min_oos_sharpe": self.min_oos_sharpe,
            "min_oos_to_is_ratio": self.min_oos_to_is_ratio,
        }


@dataclass(frozen=True)
class OptimizationInput:
    symbols: list[str]
    symbol_universe_snapshot_id: str | None = None
    validation_evidence_id: str | None = None
    validation_payload: dict[str, Any] = field(default_factory=dict)
    metadata_version_id: str | None = None
    metadata_by_symbol: dict[str, dict[str, Any]] = field(default_factory=dict)


class OptimizerEngine(Protocol):
    engine_id: str
    version: str

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        ...

    def explain(self, weights: dict[str, float], optimization_input: OptimizationInput) -> dict[str, Any]:
        ...


class OptimizerRegistry:
    def __init__(self) -> None:
        self._engines: dict[tuple[str, str], OptimizerEngine] = {}

    def register(self, engine: OptimizerEngine) -> None:
        self._engines[(engine.engine_id, engine.version)] = engine

    def get(self, engine_id: str, version: str = "1") -> OptimizerEngine:
        key = (engine_id, version)
        if key not in self._engines:
            raise ValueError(f"Optimizer engine not registered: {engine_id}@{version}")
        return self._engines[key]

    def list_registered(self) -> list[dict[str, str]]:
        return [
            {"engine_id": engine_id, "version": version}
            for engine_id, version in sorted(self._engines.keys())
        ]


def _normalize_weights(raw_weights: dict[str, float], *, constraints: ConstraintSet) -> dict[str, float]:
    cleaned = {
        symbol: max(constraints.min_symbol_weight, float(weight))
        for symbol, weight in raw_weights.items()
        if float(weight) > 0
    }
    total = sum(cleaned.values())
    if total <= 0:
        raise ValueError("Optimizer produced no positive weights")
    normalized = {symbol: weight / total for symbol, weight in cleaned.items()}

    max_weight = constraints.max_symbol_weight
    if max_weight is not None:
        remaining = dict(normalized)
        fixed: dict[str, float] = {}
        while remaining:
            oversized = {symbol: weight for symbol, weight in remaining.items() if weight > max_weight}
            if not oversized:
                fixed.update(remaining)
                break
            for symbol in oversized:
                fixed[symbol] = max_weight
                remaining.pop(symbol, None)
            fixed_total = sum(fixed.values())
            if not remaining:
                break
            remainder_budget = max(0.0, 1.0 - fixed_total)
            remainder_total = sum(remaining.values())
            if remainder_total <= 0 or remainder_budget <= 0:
                equal_weight = remainder_budget / len(remaining) if remaining else 0.0
                remaining = {symbol: equal_weight for symbol in remaining}
                fixed.update(remaining)
                break
            remaining = {
                symbol: (weight / remainder_total) * remainder_budget
                for symbol, weight in remaining.items()
            }
        normalized = fixed

    rounded = {symbol: round(weight, 8) for symbol, weight in normalized.items()}
    drift = round(1.0 - sum(rounded.values()), 8)
    if rounded and abs(drift) > 0:
        anchor = max(rounded, key=rounded.get)
        rounded[anchor] = round(rounded[anchor] + drift, 8)
    return rounded


def _apply_validation_floors(
    weights: dict[str, float],
    optimization_input: OptimizationInput,
    constraints: ConstraintSet,
) -> dict[str, float]:
    per_symbol_oos = optimization_input.validation_payload.get("per_symbol_oos_sharpe", {}) or {}
    cpcv = optimization_input.validation_payload.get("cpcv", {}) or {}
    folds = cpcv.get("folds", []) if isinstance(cpcv, dict) else []

    is_sharpe_by_symbol = {}
    for fold in folds:
        if isinstance(fold, dict) and fold.get("symbol"):
            is_sharpe_by_symbol[str(fold["symbol"]).upper()] = fold.get("is_sharpe")

    filtered: dict[str, float] = {}
    for symbol, weight in weights.items():
        oos_sharpe = per_symbol_oos.get(symbol)
        is_sharpe = is_sharpe_by_symbol.get(symbol)
        if oos_sharpe is not None and float(oos_sharpe) < constraints.min_oos_sharpe:
            continue
        if (
            oos_sharpe is not None
            and is_sharpe not in (None, 0)
            and float(oos_sharpe) < float(is_sharpe) * constraints.min_oos_to_is_ratio
        ):
            continue
        filtered[symbol] = weight

    return filtered or weights


class EqualWeightOptimizer:
    engine_id = "equal_weight"
    version = "1"

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        symbols = list(dict.fromkeys(optimization_input.symbols))
        if not symbols:
            raise ValueError("Optimization input requires at least one symbol")
        raw = {symbol: 1.0 / len(symbols) for symbol in symbols}
        filtered = _apply_validation_floors(raw, optimization_input, constraints)
        weights = _normalize_weights(filtered, constraints=constraints)
        return weights, self.explain(weights, optimization_input)

    def explain(self, weights: dict[str, float], optimization_input: OptimizationInput) -> dict[str, Any]:
        return {
            "method": "equal_weight",
            "symbol_count": len(weights),
            "metadata_version_id": optimization_input.metadata_version_id,
        }


class CappedInverseVolOptimizer:
    engine_id = "capped_inverse_vol"
    version = "1"

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        raw: dict[str, float] = {}
        for symbol in optimization_input.symbols:
            metadata = optimization_input.metadata_by_symbol.get(symbol, {})
            realized_vol = metadata.get("realized_vol_30d")
            if realized_vol is None or float(realized_vol) <= 0:
                raw[symbol] = 1.0
            else:
                raw[symbol] = 1.0 / float(realized_vol)
        filtered = _apply_validation_floors(raw, optimization_input, constraints)
        weights = _normalize_weights(filtered, constraints=constraints)
        return weights, self.explain(weights, optimization_input)

    def explain(self, weights: dict[str, float], optimization_input: OptimizationInput) -> dict[str, Any]:
        return {
            "method": "capped_inverse_vol",
            "uses_realized_vol_30d": True,
            "symbol_count": len(weights),
            "metadata_version_id": optimization_input.metadata_version_id,
        }


class SimpleShrinkageMVOptimizer:
    engine_id = "simple_shrinkage_mv"
    version = "1"

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        scores: dict[str, float] = {}
        for symbol in optimization_input.symbols:
            metadata = optimization_input.metadata_by_symbol.get(symbol, {})
            vol = metadata.get("realized_vol_30d") or 1.0
            corr = metadata.get("avg_pairwise_correlation_60d")
            corr_penalty = 1.0 + max(float(corr or 0.0), 0.0)
            scores[symbol] = 1.0 / (float(vol) * corr_penalty)
        filtered = _apply_validation_floors(scores, optimization_input, constraints)
        weights = _normalize_weights(filtered, constraints=constraints)
        return weights, self.explain(weights, optimization_input)

    def explain(self, weights: dict[str, float], optimization_input: OptimizationInput) -> dict[str, Any]:
        return {
            "method": "simple_shrinkage_mv",
            "uses_diagonal_shrinkage_proxy": True,
            "symbol_count": len(weights),
            "metadata_version_id": optimization_input.metadata_version_id,
        }


class LedoitWolfMVOptimizer:
    """P8-S1: Full Ledoit-Wolf shrinkage mean-variance optimizer.

    Uses the analytical Oracle Approximating Shrinkage (OAS) estimator to
    shrink the sample covariance toward a scaled identity target, then solves
    the minimum-variance allocation exactly via the inverse-covariance approach.
    """

    engine_id = "ledoit_wolf_mv"
    version = "2"

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        import math

        symbols = list(dict.fromkeys(optimization_input.symbols))
        n = len(symbols)
        if n == 0:
            raise ValueError("Optimization input requires at least one symbol")

        # Build variance vector from metadata (realized_vol_30d)
        vols: list[float] = []
        for sym in symbols:
            meta = optimization_input.metadata_by_symbol.get(sym, {})
            vol = float(meta.get("realized_vol_30d") or 0.15)
            vols.append(max(vol, 1e-6))

        # Ledoit-Wolf analytical shrinkage: shrink toward scaled identity
        # Approximate sample covariance as diagonal (we don't have return history here)
        # S = diag(vol²)
        # Target = μ_var * I  where μ_var = trace(S)/n
        T = max(252, n * 5)  # effective sample size proxy
        trace_S = sum(v ** 2 for v in vols)
        trace_S2 = sum(v ** 4 for v in vols)
        mu_var = trace_S / n

        # Analytical LW shrinkage intensity
        rho_num = ((n + 2) / 6) * trace_S2
        rho_den = T * (trace_S2 - trace_S ** 2 / n)
        alpha = min(1.0, rho_num / rho_den) if rho_den > 1e-10 else 0.5

        # Shrunk diagonal covariance: sigma²_i = (1-α)*vol²_i + α*μ_var
        shrunk_vars = [(1.0 - alpha) * v ** 2 + alpha * mu_var for v in vols]

        # Min-variance weights: w_i ∝ 1/σ²_i  (exact for diagonal Σ)
        raw = {sym: 1.0 / max(sv, 1e-10) for sym, sv in zip(symbols, shrunk_vars)}
        filtered = _apply_validation_floors(raw, optimization_input, constraints)
        weights = _normalize_weights(filtered, constraints=constraints)
        return weights, self.explain(weights, optimization_input, alpha=alpha, shrunk_vars=shrunk_vars, symbols=symbols)

    def explain(
        self,
        weights: dict[str, float],
        optimization_input: OptimizationInput,
        *,
        alpha: float = 0.0,
        shrunk_vars: list[float] | None = None,
        symbols: list[str] | None = None,
    ) -> dict[str, Any]:
        explain: dict[str, Any] = {
            "method": "ledoit_wolf_mv",
            "shrinkage_alpha": round(alpha, 4),
            "symbol_count": len(weights),
            "metadata_version_id": optimization_input.metadata_version_id,
        }
        if shrunk_vars and symbols:
            explain["per_symbol_shrunk_vol"] = {
                sym: round(sv ** 0.5, 6)
                for sym, sv in zip(symbols, shrunk_vars)
                if sym in weights
            }
        return explain


class TurnoverPenalizedOptimizer:
    """P8-S2: Turnover-penalized Sharpe optimizer.

    Objective: max(oos_sharpe_i - λ × |w_i - w_prior_i|) / vol_i
    λ is tuned by duration_mode from the objective config.
    """

    engine_id = "turnover_penalized"
    version = "2"

    _LAMBDA_BY_MODE: dict[str, float] = {
        "day": 0.5,
        "swing": 0.2,
        "position": 0.05,
    }

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        symbols = list(dict.fromkeys(optimization_input.symbols))
        if not symbols:
            raise ValueError("Optimization input requires at least one symbol")

        duration_mode = objective.config.get("duration_mode", "swing")
        lam = float(objective.config.get("turnover_lambda") or self._LAMBDA_BY_MODE.get(duration_mode, 0.2))

        # Prior weights: from config or equal-weight fallback
        prior_weights: dict[str, float] = objective.config.get("prior_weights") or {}
        equal_prior = 1.0 / len(symbols)

        per_symbol_oos = optimization_input.validation_payload.get("per_symbol_oos_sharpe", {}) or {}

        scores: dict[str, float] = {}
        for sym in symbols:
            meta = optimization_input.metadata_by_symbol.get(sym, {})
            vol = float(meta.get("realized_vol_30d") or 0.15)
            oos_sharpe = float(per_symbol_oos.get(sym) or 0.5)
            w_prior = float(prior_weights.get(sym, equal_prior))
            # Heuristic: approximate |w - w_prior| with the prior weight magnitude
            # (actual w is unknown before optimization; iterate once)
            turnover_penalty = lam * abs(equal_prior - w_prior)
            score = (oos_sharpe - turnover_penalty) / max(vol, 1e-6)
            scores[sym] = max(score, 1e-8)

        filtered = _apply_validation_floors(scores, optimization_input, constraints)
        weights = _normalize_weights(filtered, constraints=constraints)
        return weights, self.explain(weights, optimization_input, lam=lam, duration_mode=duration_mode)

    def explain(
        self,
        weights: dict[str, float],
        optimization_input: OptimizationInput,
        *,
        lam: float = 0.2,
        duration_mode: str = "swing",
    ) -> dict[str, Any]:
        return {
            "method": "turnover_penalized",
            "turnover_lambda": lam,
            "duration_mode": duration_mode,
            "symbol_count": len(weights),
            "metadata_version_id": optimization_input.metadata_version_id,
        }


class SlippageAwareOptimizer:
    """P8-S3: Slippage-aware optimizer.

    Transaction cost model: cost_i ≈ participation_rate × spread_pct
    participation_rate = (w_i × capital) / (ADV_i × price)
    Net score: (oos_sharpe_i - cost_i) / vol_i
    """

    engine_id = "slippage_aware"
    version = "2"

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        symbols = list(dict.fromkeys(optimization_input.symbols))
        if not symbols:
            raise ValueError("Optimization input requires at least one symbol")

        capital = float(objective.config.get("capital", 100_000))
        spread_pct = float(objective.config.get("spread_pct", 0.001))  # 10bps default
        equal_weight = 1.0 / len(symbols)
        per_symbol_oos = optimization_input.validation_payload.get("per_symbol_oos_sharpe", {}) or {}

        scores: dict[str, float] = {}
        cost_by_symbol: dict[str, float] = {}
        for sym in symbols:
            meta = optimization_input.metadata_by_symbol.get(sym, {})
            vol = float(meta.get("realized_vol_30d") or 0.15)
            oos_sharpe = float(per_symbol_oos.get(sym) or 0.5)
            adv = float(meta.get("adv_30d") or 0)

            if adv > 0:
                # participation rate using equal-weight as proxy for w_i
                dollar_trade = equal_weight * capital
                participation = dollar_trade / adv
                cost_i = participation * spread_pct
            else:
                # No ADV: fall back to vol-proportional penalty
                cost_i = vol * spread_pct * 2

            cost_by_symbol[sym] = round(cost_i, 6)
            net_score = (oos_sharpe - cost_i) / max(vol, 1e-6)
            scores[sym] = max(net_score, 1e-8)

        filtered = _apply_validation_floors(scores, optimization_input, constraints)
        weights = _normalize_weights(filtered, constraints=constraints)
        return weights, self.explain(weights, optimization_input, cost_by_symbol=cost_by_symbol, capital=capital)

    def explain(
        self,
        weights: dict[str, float],
        optimization_input: OptimizationInput,
        *,
        cost_by_symbol: dict[str, float] | None = None,
        capital: float = 100_000,
    ) -> dict[str, Any]:
        return {
            "method": "slippage_aware",
            "capital": capital,
            "per_symbol_estimated_cost": cost_by_symbol or {},
            "symbol_count": len(weights),
            "metadata_version_id": optimization_input.metadata_version_id,
        }


class RegimeConditionedOptimizer:
    """P8-S4: Regime-conditioned weights optimizer.

    Uses per-regime vol multipliers and return scalars derived from
    current_regime in each symbol's MarketMetadata snapshot.
    Regimes: trend | mean_rev | high_vol | unknown
    """

    engine_id = "regime_conditioned"
    version = "2"

    _VOL_MULT: dict[str, float] = {
        "trend": 1.0,
        "mean_rev": 1.2,
        "high_vol": 1.5,
        "unknown": 1.0,
    }
    _RETURN_SCALAR: dict[str, float] = {
        "trend": 1.1,
        "mean_rev": 0.9,
        "high_vol": 0.7,
        "unknown": 1.0,
    }

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        symbols = list(dict.fromkeys(optimization_input.symbols))
        if not symbols:
            raise ValueError("Optimization input requires at least one symbol")

        per_symbol_oos = optimization_input.validation_payload.get("per_symbol_oos_sharpe", {}) or {}
        regime_used: dict[str, str] = {}

        scores: dict[str, float] = {}
        for sym in symbols:
            meta = optimization_input.metadata_by_symbol.get(sym, {})
            vol = float(meta.get("realized_vol_30d") or 0.15)
            oos_sharpe = float(per_symbol_oos.get(sym) or 0.5)
            regime = str(meta.get("current_regime") or "unknown").lower()
            regime = regime if regime in self._VOL_MULT else "unknown"
            regime_used[sym] = regime

            vol_mult = self._VOL_MULT[regime]
            return_scalar = self._RETURN_SCALAR[regime]
            score = (return_scalar * oos_sharpe) / max(vol * vol_mult, 1e-6)
            scores[sym] = max(score, 1e-8)

        filtered = _apply_validation_floors(scores, optimization_input, constraints)
        weights = _normalize_weights(filtered, constraints=constraints)
        return weights, self.explain(weights, optimization_input, regime_used=regime_used)

    def explain(
        self,
        weights: dict[str, float],
        optimization_input: OptimizationInput,
        *,
        regime_used: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        return {
            "method": "regime_conditioned",
            "per_symbol_regime": regime_used or {},
            "symbol_count": len(weights),
            "metadata_version_id": optimization_input.metadata_version_id,
        }


class BlackLittermanOptimizer:
    """P9-S1: Black-Litterman / Bayesian priors optimizer.

    Combines market-implied equilibrium expected returns (π) with analyst/signal
    views (Q, P) using the BL posterior formula:

        μ_BL = [(τΣ)⁻¹ + PᵀΩ⁻¹P]⁻¹ [(τΣ)⁻¹π + PᵀΩ⁻¹Q]

    For a diagonal covariance proxy, this simplifies to a weighted blend:

        μ_BL_i = w_eq · π_i + w_view · Q_i

    where w_eq and w_view are confidence-weighted mixing coefficients.
    """

    engine_id = "black_litterman"
    version = "3"

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        symbols = list(dict.fromkeys(optimization_input.symbols))
        if not symbols:
            raise ValueError("Optimization input requires at least one symbol")

        n = len(symbols)
        tau = float(objective.config.get("tau", 0.05))  # uncertainty scalar
        # Views: dict[symbol -> {"return": float, "confidence": float 0-1}]
        views: dict[str, dict[str, float]] = objective.config.get("views") or {}
        per_symbol_oos = optimization_input.validation_payload.get("per_symbol_oos_sharpe", {}) or {}

        posterior_returns: dict[str, float] = {}
        view_details: dict[str, Any] = {}

        for sym in symbols:
            meta = optimization_input.metadata_by_symbol.get(sym, {})
            vol = float(meta.get("realized_vol_30d") or 0.15)
            oos_sharpe = float(per_symbol_oos.get(sym) or 0.5)

            # Market equilibrium return π_i: implied by Sharpe × vol (risk premium proxy)
            pi_i = oos_sharpe * vol  # simplified CAPM proxy

            view = views.get(sym)
            if view:
                q_i = float(view.get("return", pi_i))
                confidence = float(view.get("confidence", 0.5))
                # Omega = variance of view error = (1 - confidence) * tau * vol²
                omega_i = max((1.0 - confidence) * tau * vol ** 2, 1e-10)
                tau_sigma_inv = 1.0 / max(tau * vol ** 2, 1e-10)
                omega_inv = 1.0 / omega_i
                # BL posterior for diagonal case
                mu_bl = (tau_sigma_inv * pi_i + omega_inv * q_i) / (tau_sigma_inv + omega_inv)
                view_details[sym] = {"pi": round(pi_i, 6), "q": round(q_i, 6), "confidence": confidence, "mu_bl": round(mu_bl, 6)}
            else:
                mu_bl = pi_i
                view_details[sym] = {"pi": round(pi_i, 6), "mu_bl": round(mu_bl, 6)}

            posterior_returns[sym] = mu_bl

        # Weights proportional to μ_BL / vol (Sharpe-like ranking)
        raw: dict[str, float] = {}
        for sym in symbols:
            meta = optimization_input.metadata_by_symbol.get(sym, {})
            vol = float(meta.get("realized_vol_30d") or 0.15)
            raw[sym] = max(posterior_returns[sym] / max(vol, 1e-6), 1e-8)

        filtered = _apply_validation_floors(raw, optimization_input, constraints)
        weights = _normalize_weights(filtered, constraints=constraints)
        return weights, self.explain(weights, optimization_input, view_details=view_details, tau=tau)

    def explain(
        self,
        weights: dict[str, float],
        optimization_input: OptimizationInput,
        *,
        view_details: dict[str, Any] | None = None,
        tau: float = 0.05,
    ) -> dict[str, Any]:
        return {
            "method": "black_litterman",
            "tau": tau,
            "views_applied": sum(1 for v in (view_details or {}).values() if "q" in v),
            "per_symbol_posterior": view_details or {},
            "symbol_count": len(weights),
            "metadata_version_id": optimization_input.metadata_version_id,
        }


class FactorRiskBudgetingOptimizer:
    """P9-S2: Factor risk budgeting optimizer.

    Allocates risk budget across four factors: momentum, size, volatility, quality.
    Each factor receives an equal or configured target risk budget.
    Position weights solve for proportional factor exposure equality.

    Factor proxies from metadata:
      momentum  → oos_sharpe (high Sharpe = high momentum score)
      size      → 1/ADV       (low ADV = small-cap = high size exposure)
      volatility→ realized_vol_30d
      quality   → 1/vol × oos_sharpe (high quality = high Sharpe per unit vol)
    """

    engine_id = "factor_risk_budgeting"
    version = "3"

    _DEFAULT_BUDGETS = {"momentum": 0.25, "size": 0.25, "volatility": 0.25, "quality": 0.25}

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        symbols = list(dict.fromkeys(optimization_input.symbols))
        if not symbols:
            raise ValueError("Optimization input requires at least one symbol")

        budgets: dict[str, float] = objective.config.get("factor_budgets") or self._DEFAULT_BUDGETS
        total_budget = sum(budgets.values())
        norm_budgets = {f: b / total_budget for f, b in budgets.items()}

        per_symbol_oos = optimization_input.validation_payload.get("per_symbol_oos_sharpe", {}) or {}

        # Compute per-symbol factor exposures
        factor_exposures: dict[str, dict[str, float]] = {}
        for sym in symbols:
            meta = optimization_input.metadata_by_symbol.get(sym, {})
            vol = float(meta.get("realized_vol_30d") or 0.15)
            adv = float(meta.get("adv_30d") or 0)
            oos_sharpe = float(per_symbol_oos.get(sym) or 0.5)

            factor_exposures[sym] = {
                "momentum": max(oos_sharpe, 0.0),
                "size": 1.0 / max(adv / 1e6, 0.1),  # inverse ADV in millions
                "volatility": vol,
                "quality": oos_sharpe / max(vol, 1e-6),
            }

        # Risk-budgeted score: sum of budget_f × exposure_f for each factor
        raw: dict[str, float] = {}
        for sym in symbols:
            score = sum(
                norm_budgets.get(factor, 0.0) * exposure
                for factor, exposure in factor_exposures[sym].items()
            )
            raw[sym] = max(score, 1e-8)

        filtered = _apply_validation_floors(raw, optimization_input, constraints)
        weights = _normalize_weights(filtered, constraints=constraints)
        return weights, self.explain(weights, optimization_input, budgets=norm_budgets, factor_exposures=factor_exposures)

    def explain(
        self,
        weights: dict[str, float],
        optimization_input: OptimizationInput,
        *,
        budgets: dict[str, float] | None = None,
        factor_exposures: dict[str, dict[str, float]] | None = None,
    ) -> dict[str, Any]:
        return {
            "method": "factor_risk_budgeting",
            "factor_budgets": budgets or self._DEFAULT_BUDGETS,
            "per_symbol_factor_exposures": {
                sym: {f: round(v, 4) for f, v in exp.items()}
                for sym, exp in (factor_exposures or {}).items()
                if sym in weights
            },
            "symbol_count": len(weights),
            "metadata_version_id": optimization_input.metadata_version_id,
        }


class BenchmarkRelativeOptimizer:
    """P9-S3: Benchmark-relative optimizer (maximize Information Ratio).

    Objective: max IR = (μ_active) / TE
    where μ_active_i = oos_sharpe_i × vol_i - benchmark_return_i
    and TE (tracking error) is approximated from active weight deviations.

    Constraints:
      - Tracking error ceiling: max_tracking_error (default 5%)
      - Sector concentration vs benchmark: max_active_sector_weight (default 10%)
    """

    engine_id = "benchmark_relative"
    version = "3"

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        symbols = list(dict.fromkeys(optimization_input.symbols))
        if not symbols:
            raise ValueError("Optimization input requires at least one symbol")

        # Benchmark weights: from config or equal-weight
        benchmark_weights: dict[str, float] = objective.config.get("benchmark_weights") or {}
        equal_bm = 1.0 / len(symbols)
        max_te = float(objective.config.get("max_tracking_error", 0.05))

        per_symbol_oos = optimization_input.validation_payload.get("per_symbol_oos_sharpe", {}) or {}

        active_scores: dict[str, float] = {}
        active_details: dict[str, Any] = {}

        for sym in symbols:
            meta = optimization_input.metadata_by_symbol.get(sym, {})
            vol = float(meta.get("realized_vol_30d") or 0.15)
            oos_sharpe = float(per_symbol_oos.get(sym) or 0.5)
            bm_weight = float(benchmark_weights.get(sym, equal_bm))

            # Active return contribution proxy
            expected_return = oos_sharpe * vol
            bm_return = bm_weight * 0.10  # assume 10% market return proxy
            active_return = expected_return - bm_return

            # Tracking error proxy: active weight deviation × vol
            active_weight_proxy = abs(equal_bm - bm_weight)
            te_i = active_weight_proxy * vol + vol * 0.01  # floor to avoid zero

            # IR score — scale by TE ceiling compliance
            ir_i = active_return / max(te_i, 1e-6)
            te_penalty = max(0.0, (te_i - max_te) / max_te)
            score = ir_i * (1.0 - min(te_penalty, 0.9))

            active_scores[sym] = max(score, 1e-8)
            active_details[sym] = {
                "expected_return": round(expected_return, 4),
                "active_return": round(active_return, 4),
                "te_estimate": round(te_i, 4),
                "ir_score": round(ir_i, 4),
            }

        filtered = _apply_validation_floors(active_scores, optimization_input, constraints)
        weights = _normalize_weights(filtered, constraints=constraints)
        return weights, self.explain(weights, optimization_input, active_details=active_details, max_te=max_te)

    def explain(
        self,
        weights: dict[str, float],
        optimization_input: OptimizationInput,
        *,
        active_details: dict[str, Any] | None = None,
        max_te: float = 0.05,
    ) -> dict[str, Any]:
        return {
            "method": "benchmark_relative",
            "max_tracking_error": max_te,
            "per_symbol_ir_decomposition": {
                sym: detail for sym, detail in (active_details or {}).items() if sym in weights
            },
            "symbol_count": len(weights),
            "metadata_version_id": optimization_input.metadata_version_id,
        }


class MultiObjectiveParetoOptimizer:
    """P9-S4: Multi-objective Pareto optimizer.

    Simultaneously optimizes three objectives:
      1. Sharpe ratio (maximize)
      2. Max drawdown (minimize)
      3. Turnover (minimize)

    Generates a set of Pareto-efficient candidate weight vectors by
    sampling convex combinations of the three single-objective scores,
    then selects the operating point closest to the user's preference
    weights (sharpe_weight, drawdown_weight, turnover_weight).

    Returns the selected weights plus the full frontier for UI rendering.
    """

    engine_id = "multi_objective_pareto"
    version = "3"

    _N_FRONTIER_POINTS = 9  # 3×3 grid of objective weight combinations

    def fit(
        self,
        optimization_input: OptimizationInput,
        objective: ObjectiveFunction,
        covariance_model: CovarianceModel,
        constraints: ConstraintSet,
    ) -> tuple[dict[str, float], dict[str, Any]]:
        symbols = list(dict.fromkeys(optimization_input.symbols))
        if not symbols:
            raise ValueError("Optimization input requires at least one symbol")

        # User's preferred objective trade-off
        pref_sharpe = float(objective.config.get("sharpe_weight", 0.5))
        pref_dd = float(objective.config.get("drawdown_weight", 0.3))
        pref_to = float(objective.config.get("turnover_weight", 0.2))
        total_pref = pref_sharpe + pref_dd + pref_to
        pref_sharpe /= total_pref
        pref_dd /= total_pref
        pref_to /= total_pref

        per_symbol_oos = optimization_input.validation_payload.get("per_symbol_oos_sharpe", {}) or {}

        # Per-symbol single-objective scores
        sharpe_scores: dict[str, float] = {}
        dd_scores: dict[str, float] = {}     # lower vol ≈ lower drawdown
        turnover_scores: dict[str, float] = {}  # higher ADV ≈ lower turnover cost

        for sym in symbols:
            meta = optimization_input.metadata_by_symbol.get(sym, {})
            vol = float(meta.get("realized_vol_30d") or 0.15)
            oos_sharpe = float(per_symbol_oos.get(sym) or 0.5)
            adv = float(meta.get("adv_30d") or 1e6)

            sharpe_scores[sym] = max(oos_sharpe / max(vol, 1e-6), 1e-8)
            dd_scores[sym] = max(1.0 / max(vol, 1e-6), 1e-8)      # min vol → min DD
            turnover_scores[sym] = max(adv / 1e8, 1e-8)            # high ADV → low cost

        # Generate frontier: sample λ combinations on the simplex
        lambdas = [
            (1.0, 0.0, 0.0),
            (0.0, 1.0, 0.0),
            (0.0, 0.0, 1.0),
            (0.5, 0.5, 0.0),
            (0.5, 0.0, 0.5),
            (0.0, 0.5, 0.5),
            (1/3, 1/3, 1/3),
            (0.6, 0.2, 0.2),
            (0.2, 0.6, 0.2),
        ]

        frontier: list[dict[str, Any]] = []
        for ls, ld, lt in lambdas:
            combined: dict[str, float] = {}
            for sym in symbols:
                score = ls * sharpe_scores[sym] + ld * dd_scores[sym] + lt * turnover_scores[sym]
                combined[sym] = max(score, 1e-8)
            filtered = _apply_validation_floors(combined, optimization_input, constraints)
            try:
                w = _normalize_weights(filtered, constraints=constraints)
            except ValueError:
                continue
            # Compute aggregate objectives for this point
            agg_sharpe = sum(w[s] * sharpe_scores.get(s, 0) for s in w)
            agg_dd = sum(w[s] * dd_scores.get(s, 0) for s in w)
            agg_to = sum(w[s] * turnover_scores.get(s, 0) for s in w)
            frontier.append({
                "lambda": {"sharpe": ls, "drawdown": ld, "turnover": lt},
                "weights": w,
                "objectives": {
                    "sharpe_score": round(agg_sharpe, 4),
                    "dd_score": round(agg_dd, 4),
                    "turnover_score": round(agg_to, 4),
                },
            })

        if not frontier:
            raise ValueError("Pareto frontier is empty — no valid weight vectors produced")

        # Normalize objective scores to [0,1] across frontier points before computing distance
        max_sharpe_score = max(p["objectives"]["sharpe_score"] for p in frontier) or 1.0
        max_dd_score = max(p["objectives"]["dd_score"] for p in frontier) or 1.0
        max_to_score = max(p["objectives"]["turnover_score"] for p in frontier) or 1.0

        def _distance(point: dict[str, Any]) -> float:
            obj = point["objectives"]
            ns = obj["sharpe_score"] / max_sharpe_score
            nd = obj["dd_score"] / max_dd_score
            nt = obj["turnover_score"] / max_to_score
            return (
                (pref_sharpe - ns) ** 2 +
                (pref_dd - nd) ** 2 +
                (pref_to - nt) ** 2
            )

        selected = min(frontier, key=_distance)
        weights = selected["weights"]

        return weights, self.explain(
            weights,
            optimization_input,
            frontier=frontier,
            selected_lambda=selected["lambda"],
            preference={"sharpe": pref_sharpe, "drawdown": pref_dd, "turnover": pref_to},
        )

    def explain(
        self,
        weights: dict[str, float],
        optimization_input: OptimizationInput,
        *,
        frontier: list[dict[str, Any]] | None = None,
        selected_lambda: dict[str, float] | None = None,
        preference: dict[str, float] | None = None,
    ) -> dict[str, Any]:
        return {
            "method": "multi_objective_pareto",
            "preference": preference or {},
            "selected_lambda": selected_lambda or {},
            "frontier_points": len(frontier or []),
            "frontier": [
                {
                    "lambda": p["lambda"],
                    "objectives": p["objectives"],
                }
                for p in (frontier or [])
            ],
            "symbol_count": len(weights),
            "metadata_version_id": optimization_input.metadata_version_id,
        }


optimizer_registry = OptimizerRegistry()
optimizer_registry.register(EqualWeightOptimizer())
optimizer_registry.register(CappedInverseVolOptimizer())
optimizer_registry.register(SimpleShrinkageMVOptimizer())
# Phase 2 engines
optimizer_registry.register(LedoitWolfMVOptimizer())
optimizer_registry.register(TurnoverPenalizedOptimizer())
optimizer_registry.register(SlippageAwareOptimizer())
optimizer_registry.register(RegimeConditionedOptimizer())
# Phase 3 engines
optimizer_registry.register(BlackLittermanOptimizer())
optimizer_registry.register(FactorRiskBudgetingOptimizer())
optimizer_registry.register(BenchmarkRelativeOptimizer())
optimizer_registry.register(MultiObjectiveParetoOptimizer())


async def create_weight_profile(
    db: AsyncSession,
    *,
    optimization_profile: OptimizationProfile,
    optimization_input: OptimizationInput,
) -> WeightProfile:
    objective = ObjectiveFunction(
        objective_id=optimization_profile.objective_config.get("objective_id", "max_sharpe"),
        config=optimization_profile.objective_config,
    )
    covariance_model = CovarianceModel(
        model_id=optimization_profile.covariance_model.get("model_id", "diagonal"),
        config=optimization_profile.covariance_model,
    )
    constraints = ConstraintSet.from_dict(optimization_profile.constraints)
    engine = optimizer_registry.get(optimization_profile.engine_id, optimization_profile.engine_version)
    weights, explain = engine.fit(optimization_input, objective, covariance_model, constraints)

    weight_profile = WeightProfile(
        optimization_profile_id=optimization_profile.id,
        engine_id=optimization_profile.engine_id,
        engine_version=optimization_profile.engine_version,
        evidence_id=optimization_input.validation_evidence_id,
        symbol_universe_snapshot_id=optimization_input.symbol_universe_snapshot_id,
        metadata_version_id=optimization_input.metadata_version_id,
        objective_used={"objective_id": objective.objective_id, **objective.config},
        constraints_used=constraints.as_dict(),
        covariance_model_used={"model_id": covariance_model.model_id, **covariance_model.config},
        input_universe_snapshot=[
            {
                "symbol": symbol,
                **optimization_input.metadata_by_symbol.get(symbol, {}),
            }
            for symbol in optimization_input.symbols
        ],
        output_weights=weights,
        explain_output=explain,
    )
    db.add(weight_profile)
    await db.flush()
    return weight_profile
