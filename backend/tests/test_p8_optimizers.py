"""Tests for Phase 2 (P8) advanced optimizer engines and factor shock scenarios."""
from __future__ import annotations

import pytest

from app.services.optimizer_framework import (
    ConstraintSet,
    CovarianceModel,
    ObjectiveFunction,
    OptimizationInput,
    LedoitWolfMVOptimizer,
    TurnoverPenalizedOptimizer,
    SlippageAwareOptimizer,
    RegimeConditionedOptimizer,
    optimizer_registry,
)
from app.services.optimization_service import compute_factor_shock_scenarios


# ── Fixtures ──────────────────────────────────────────────────────────────────

SYMBOLS = ["AAPL", "MSFT", "GOOGL", "NVDA"]

METADATA = {
    "AAPL":  {"realized_vol_30d": 0.18, "avg_pairwise_correlation_60d": 0.55, "adv_30d": 120_000_000, "current_regime": "trend"},
    "MSFT":  {"realized_vol_30d": 0.16, "avg_pairwise_correlation_60d": 0.50, "adv_30d": 100_000_000, "current_regime": "trend"},
    "GOOGL": {"realized_vol_30d": 0.20, "avg_pairwise_correlation_60d": 0.60, "adv_30d":  80_000_000, "current_regime": "mean_rev"},
    "NVDA":  {"realized_vol_30d": 0.35, "avg_pairwise_correlation_60d": 0.45, "adv_30d":  60_000_000, "current_regime": "high_vol"},
}

OOS_SHARPE = {"AAPL": 0.9, "MSFT": 0.8, "GOOGL": 0.6, "NVDA": 1.2}

def _make_input(symbols: list[str] = SYMBOLS) -> OptimizationInput:
    return OptimizationInput(
        symbols=symbols,
        metadata_by_symbol={s: METADATA[s] for s in symbols if s in METADATA},
        validation_payload={"per_symbol_oos_sharpe": {s: OOS_SHARPE.get(s, 0.5) for s in symbols}},
    )

def _default_objective(**kwargs) -> ObjectiveFunction:
    return ObjectiveFunction(objective_id="max_sharpe", config=kwargs)

def _default_covariance() -> CovarianceModel:
    return CovarianceModel(model_id="diagonal")

def _default_constraints() -> ConstraintSet:
    return ConstraintSet(max_symbol_weight=0.5)


# ── LedoitWolfMVOptimizer ─────────────────────────────────────────────────────

class TestLedoitWolfMV:
    def test_weights_sum_to_one(self):
        engine = LedoitWolfMVOptimizer()
        weights, _ = engine.fit(_make_input(), _default_objective(), _default_covariance(), _default_constraints())
        assert abs(sum(weights.values()) - 1.0) < 1e-6

    def test_lower_vol_gets_higher_weight(self):
        engine = LedoitWolfMVOptimizer()
        weights, _ = engine.fit(_make_input(), _default_objective(), _default_covariance(), _default_constraints())
        # MSFT (vol=0.16) should outweigh NVDA (vol=0.35)
        assert weights["MSFT"] > weights["NVDA"]

    def test_all_symbols_present(self):
        engine = LedoitWolfMVOptimizer()
        weights, _ = engine.fit(_make_input(), _default_objective(), _default_covariance(), _default_constraints())
        assert set(weights.keys()) == set(SYMBOLS)

    def test_explain_contains_shrinkage_alpha(self):
        engine = LedoitWolfMVOptimizer()
        _, explain = engine.fit(_make_input(), _default_objective(), _default_covariance(), _default_constraints())
        assert "shrinkage_alpha" in explain
        assert 0.0 <= explain["shrinkage_alpha"] <= 1.0

    def test_max_weight_constraint_respected(self):
        engine = LedoitWolfMVOptimizer()
        constraints = ConstraintSet(max_symbol_weight=0.30)
        weights, _ = engine.fit(_make_input(), _default_objective(), _default_covariance(), constraints)
        assert all(w <= 0.30 + 1e-6 for w in weights.values())

    def test_registered_in_registry(self):
        engine = optimizer_registry.get("ledoit_wolf_mv", "2")
        assert engine.engine_id == "ledoit_wolf_mv"

    def test_single_symbol(self):
        engine = LedoitWolfMVOptimizer()
        inp = OptimizationInput(
            symbols=["AAPL"],
            metadata_by_symbol={"AAPL": METADATA["AAPL"]},
            validation_payload={},
        )
        weights, _ = engine.fit(inp, _default_objective(), _default_covariance(), _default_constraints())
        assert weights == {"AAPL": 1.0}


# ── TurnoverPenalizedOptimizer ────────────────────────────────────────────────

class TestTurnoverPenalized:
    def test_weights_sum_to_one(self):
        engine = TurnoverPenalizedOptimizer()
        weights, _ = engine.fit(_make_input(), _default_objective(duration_mode="swing"), _default_covariance(), _default_constraints())
        assert abs(sum(weights.values()) - 1.0) < 1e-6

    def test_explain_contains_lambda_and_mode(self):
        engine = TurnoverPenalizedOptimizer()
        _, explain = engine.fit(_make_input(), _default_objective(duration_mode="day"), _default_covariance(), _default_constraints())
        assert explain["turnover_lambda"] == 0.5
        assert explain["duration_mode"] == "day"

    def test_position_mode_lower_lambda_than_day(self):
        engine = TurnoverPenalizedOptimizer()
        _, explain_day = engine.fit(_make_input(), _default_objective(duration_mode="day"), _default_covariance(), _default_constraints())
        _, explain_pos = engine.fit(_make_input(), _default_objective(duration_mode="position"), _default_covariance(), _default_constraints())
        assert explain_day["turnover_lambda"] > explain_pos["turnover_lambda"]

    def test_custom_lambda_override(self):
        engine = TurnoverPenalizedOptimizer()
        _, explain = engine.fit(_make_input(), _default_objective(turnover_lambda=0.99), _default_covariance(), _default_constraints())
        assert explain["turnover_lambda"] == 0.99

    def test_registered_in_registry(self):
        engine = optimizer_registry.get("turnover_penalized", "2")
        assert engine.engine_id == "turnover_penalized"

    def test_high_oos_sharpe_gets_higher_weight(self):
        engine = TurnoverPenalizedOptimizer()
        weights, _ = engine.fit(_make_input(), _default_objective(duration_mode="swing"), _default_covariance(), _default_constraints())
        # NVDA has highest OOS Sharpe (1.2) but also highest vol (0.35)
        # AAPL has 0.9 with vol 0.18 — AAPL should win on net score
        assert weights["AAPL"] > weights["NVDA"]


# ── SlippageAwareOptimizer ────────────────────────────────────────────────────

class TestSlippageAware:
    def test_weights_sum_to_one(self):
        engine = SlippageAwareOptimizer()
        weights, _ = engine.fit(_make_input(), _default_objective(capital=100_000), _default_covariance(), _default_constraints())
        assert abs(sum(weights.values()) - 1.0) < 1e-6

    def test_explain_contains_cost_by_symbol(self):
        engine = SlippageAwareOptimizer()
        _, explain = engine.fit(_make_input(), _default_objective(capital=100_000), _default_covariance(), _default_constraints())
        assert "per_symbol_estimated_cost" in explain
        assert set(explain["per_symbol_estimated_cost"].keys()) == set(SYMBOLS)

    def test_high_adv_lower_cost_than_no_adv(self):
        engine = SlippageAwareOptimizer()
        # Symbol with no ADV should have higher estimated cost
        inp_no_adv = OptimizationInput(
            symbols=["X"],
            metadata_by_symbol={"X": {"realized_vol_30d": 0.15, "adv_30d": 0}},
            validation_payload={},
        )
        inp_high_adv = OptimizationInput(
            symbols=["X"],
            metadata_by_symbol={"X": {"realized_vol_30d": 0.15, "adv_30d": 100_000_000}},
            validation_payload={},
        )
        _, ex_no = engine.fit(inp_no_adv, _default_objective(capital=100_000), _default_covariance(), _default_constraints())
        _, ex_hi = engine.fit(inp_high_adv, _default_objective(capital=100_000), _default_covariance(), _default_constraints())
        assert ex_no["per_symbol_estimated_cost"]["X"] > ex_hi["per_symbol_estimated_cost"]["X"]

    def test_registered_in_registry(self):
        engine = optimizer_registry.get("slippage_aware", "2")
        assert engine.engine_id == "slippage_aware"


# ── RegimeConditionedOptimizer ────────────────────────────────────────────────

class TestRegimeConditioned:
    def test_weights_sum_to_one(self):
        engine = RegimeConditionedOptimizer()
        weights, _ = engine.fit(_make_input(), _default_objective(), _default_covariance(), _default_constraints())
        assert abs(sum(weights.values()) - 1.0) < 1e-6

    def test_explain_contains_per_symbol_regime(self):
        engine = RegimeConditionedOptimizer()
        _, explain = engine.fit(_make_input(), _default_objective(), _default_covariance(), _default_constraints())
        assert "per_symbol_regime" in explain
        assert explain["per_symbol_regime"]["AAPL"] == "trend"
        assert explain["per_symbol_regime"]["GOOGL"] == "mean_rev"
        assert explain["per_symbol_regime"]["NVDA"] == "high_vol"

    def test_high_vol_regime_penalizes_weight(self):
        """high_vol regime multiplier (1.5) reduces score vs trend regime (1.0) for same vol/sharpe."""
        engine = RegimeConditionedOptimizer()
        # Same vol and sharpe; only regime differs.
        # trend score = (1.1 * 1.0) / (0.20 * 1.0) = 5.5
        # high_vol score = (0.7 * 1.0) / (0.20 * 1.5) = 2.33
        # So trend weight > high_vol weight
        inp = OptimizationInput(
            symbols=["A", "B"],
            metadata_by_symbol={
                "A": {"realized_vol_30d": 0.20, "current_regime": "trend"},
                "B": {"realized_vol_30d": 0.20, "current_regime": "high_vol"},
            },
            validation_payload={"per_symbol_oos_sharpe": {"A": 1.0, "B": 1.0}},
        )
        # No max_weight cap so regime penalty is visible in unnormalized scores
        weights, _ = engine.fit(inp, _default_objective(), _default_covariance(), ConstraintSet())
        assert weights["A"] > weights["B"]

    def test_unknown_regime_falls_back_gracefully(self):
        engine = RegimeConditionedOptimizer()
        inp = OptimizationInput(
            symbols=["X"],
            metadata_by_symbol={"X": {"realized_vol_30d": 0.15, "current_regime": "alien_regime"}},
            validation_payload={},
        )
        weights, explain = engine.fit(inp, _default_objective(), _default_covariance(), _default_constraints())
        assert weights == {"X": 1.0}
        assert explain["per_symbol_regime"]["X"] == "unknown"

    def test_registered_in_registry(self):
        engine = optimizer_registry.get("regime_conditioned", "2")
        assert engine.engine_id == "regime_conditioned"


# ── compute_factor_shock_scenarios ────────────────────────────────────────────

class TestFactorShockScenarios:
    def _make_weights(self) -> dict[str, float]:
        return {"AAPL": 0.30, "MSFT": 0.30, "GOOGL": 0.20, "NVDA": 0.20}

    def test_returns_all_three_scenarios(self):
        result = compute_factor_shock_scenarios(self._make_weights(), METADATA)
        assert set(result["scenarios"].keys()) == {"momentum_crash", "vol_spike", "size_factor"}

    def test_portfolio_shocked_return_is_weighted_sum(self):
        weights = {"AAPL": 0.5, "MSFT": 0.5}
        meta = {
            "AAPL": {"realized_vol_30d": 0.18, "adv_30d": 120_000_000},
            "MSFT": {"realized_vol_30d": 0.16, "adv_30d": 100_000_000},
        }
        result = compute_factor_shock_scenarios(weights, meta)
        for scenario in result["scenarios"].values():
            per_sym = scenario["per_symbol_shocked_return"]
            expected = sum(weights[s] * per_sym[s] for s in weights)
            assert abs(scenario["portfolio_shocked_return"] - round(expected, 4)) < 1e-4

    def test_worst_case_is_minimum_of_scenarios(self):
        result = compute_factor_shock_scenarios(self._make_weights(), METADATA)
        scenario_returns = [s["portfolio_shocked_return"] for s in result["scenarios"].values()]
        assert result["worst_case_portfolio_return"] == min(scenario_returns)

    def test_worst_case_dollar_impact_matches_return(self):
        capital = 50_000
        result = compute_factor_shock_scenarios(self._make_weights(), METADATA, capital=capital)
        expected = round(result["worst_case_portfolio_return"] * capital, 2)
        assert result["worst_case_dollar_impact"] == expected

    def test_momentum_crash_negative_for_positive_sharpe(self):
        """High-momentum (high OOS Sharpe) symbols should have negative return in momentum crash."""
        weights = {"NVDA": 1.0}  # highest OOS Sharpe = 1.2
        meta = {"NVDA": {"realized_vol_30d": 0.35, "adv_30d": 60_000_000}}
        meta_with_oos = {"NVDA": {**meta["NVDA"], "oos_sharpe": 1.2}}
        result = compute_factor_shock_scenarios(weights, meta_with_oos)
        assert result["scenarios"]["momentum_crash"]["portfolio_shocked_return"] < 0

    def test_large_cap_negative_in_size_factor(self):
        """Large-cap (high ADV) symbols should be negative in size factor scenario."""
        weights = {"BIG": 1.0}
        meta = {"BIG": {"realized_vol_30d": 0.15, "adv_30d": 200_000_000}}
        result = compute_factor_shock_scenarios(weights, meta)
        assert result["scenarios"]["size_factor"]["portfolio_shocked_return"] < 0

    def test_small_cap_positive_in_size_factor(self):
        """Small-cap (low ADV) symbols should be positive in size factor scenario."""
        weights = {"SMALL": 1.0}
        meta = {"SMALL": {"realized_vol_30d": 0.30, "adv_30d": 1_000_000}}
        result = compute_factor_shock_scenarios(weights, meta)
        assert result["scenarios"]["size_factor"]["portfolio_shocked_return"] > 0

    def test_empty_weights_returns_zero_returns(self):
        result = compute_factor_shock_scenarios({}, {})
        assert result["worst_case_portfolio_return"] == 0.0
