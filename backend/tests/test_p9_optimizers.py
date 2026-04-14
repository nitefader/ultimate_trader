"""Tests for Phase 3 (P9) institutional optimizer engines and comparison lab."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from app.services.optimizer_framework import (
    ConstraintSet,
    CovarianceModel,
    ObjectiveFunction,
    OptimizationInput,
    BlackLittermanOptimizer,
    FactorRiskBudgetingOptimizer,
    BenchmarkRelativeOptimizer,
    MultiObjectiveParetoOptimizer,
    optimizer_registry,
)

# ── Fixtures ──────────────────────────────────────────────────────────────────

SYMBOLS = ["AAPL", "MSFT", "GOOGL", "NVDA"]

METADATA = {
    "AAPL":  {"realized_vol_30d": 0.18, "adv_30d": 120_000_000, "current_regime": "trend"},
    "MSFT":  {"realized_vol_30d": 0.16, "adv_30d": 100_000_000, "current_regime": "trend"},
    "GOOGL": {"realized_vol_30d": 0.20, "adv_30d":  80_000_000, "current_regime": "mean_rev"},
    "NVDA":  {"realized_vol_30d": 0.35, "adv_30d":  60_000_000, "current_regime": "high_vol"},
}

OOS_SHARPE = {"AAPL": 0.9, "MSFT": 0.8, "GOOGL": 0.6, "NVDA": 1.2}


def _make_input(symbols: list[str] = SYMBOLS) -> OptimizationInput:
    return OptimizationInput(
        symbols=symbols,
        metadata_by_symbol={s: METADATA[s] for s in symbols if s in METADATA},
        validation_payload={"per_symbol_oos_sharpe": {s: OOS_SHARPE.get(s, 0.5) for s in symbols}},
    )


def _obj(**kwargs) -> ObjectiveFunction:
    return ObjectiveFunction(objective_id="max_sharpe", config=kwargs)


def _cov() -> CovarianceModel:
    return CovarianceModel(model_id="diagonal")


def _constraints(max_w: float = 0.5) -> ConstraintSet:
    return ConstraintSet(max_symbol_weight=max_w)


# ── BlackLittermanOptimizer ───────────────────────────────────────────────────

class TestBlackLitterman:
    def test_weights_sum_to_one(self):
        engine = BlackLittermanOptimizer()
        weights, _ = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert abs(sum(weights.values()) - 1.0) < 1e-6

    def test_all_symbols_present(self):
        engine = BlackLittermanOptimizer()
        weights, _ = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert set(weights.keys()) == set(SYMBOLS)

    def test_explain_contains_views_applied(self):
        engine = BlackLittermanOptimizer()
        _, explain = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert "views_applied" in explain
        assert explain["views_applied"] == 0  # no views provided

    def test_view_with_high_confidence_pulls_weight_up(self):
        """A bullish view (high return + high confidence) on NVDA should increase its weight."""
        engine = BlackLittermanOptimizer()
        views = {"NVDA": {"return": 0.60, "confidence": 0.9}}
        w_no_view, _ = engine.fit(_make_input(), _obj(), _cov(), ConstraintSet())
        w_with_view, explain = engine.fit(_make_input(), _obj(views=views), _cov(), ConstraintSet())
        assert explain["views_applied"] == 1
        assert w_with_view["NVDA"] >= w_no_view["NVDA"]

    def test_explain_per_symbol_posterior_present(self):
        engine = BlackLittermanOptimizer()
        _, explain = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert "per_symbol_posterior" in explain
        for sym in SYMBOLS:
            assert sym in explain["per_symbol_posterior"]
            assert "mu_bl" in explain["per_symbol_posterior"][sym]

    def test_registered_in_registry(self):
        engine = optimizer_registry.get("black_litterman", "3")
        assert engine.engine_id == "black_litterman"

    def test_max_weight_constraint_respected(self):
        engine = BlackLittermanOptimizer()
        weights, _ = engine.fit(_make_input(), _obj(), _cov(), ConstraintSet(max_symbol_weight=0.30))
        assert all(w <= 0.30 + 1e-6 for w in weights.values())


# ── FactorRiskBudgetingOptimizer ──────────────────────────────────────────────

class TestFactorRiskBudgeting:
    def test_weights_sum_to_one(self):
        engine = FactorRiskBudgetingOptimizer()
        weights, _ = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert abs(sum(weights.values()) - 1.0) < 1e-6

    def test_all_symbols_present(self):
        engine = FactorRiskBudgetingOptimizer()
        weights, _ = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert set(weights.keys()) == set(SYMBOLS)

    def test_explain_contains_factor_budgets(self):
        engine = FactorRiskBudgetingOptimizer()
        _, explain = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert "factor_budgets" in explain
        assert set(explain["factor_budgets"].keys()) == {"momentum", "size", "volatility", "quality"}

    def test_custom_budget_changes_weights(self):
        """Concentrating budget entirely on momentum should push NVDA (highest OOS Sharpe) to top."""
        engine = FactorRiskBudgetingOptimizer()
        custom_budgets = {"momentum": 1.0, "size": 0.0, "volatility": 0.0, "quality": 0.0}
        weights, _ = engine.fit(
            _make_input(), _obj(factor_budgets=custom_budgets), _cov(), ConstraintSet()
        )
        # NVDA has highest OOS Sharpe → highest momentum score
        assert weights["NVDA"] == max(weights.values())

    def test_explain_per_symbol_factor_exposures(self):
        engine = FactorRiskBudgetingOptimizer()
        _, explain = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        for sym in SYMBOLS:
            assert sym in explain["per_symbol_factor_exposures"]
            exp = explain["per_symbol_factor_exposures"][sym]
            assert all(f in exp for f in ("momentum", "size", "volatility", "quality"))

    def test_registered_in_registry(self):
        engine = optimizer_registry.get("factor_risk_budgeting", "3")
        assert engine.engine_id == "factor_risk_budgeting"


# ── BenchmarkRelativeOptimizer ────────────────────────────────────────────────

class TestBenchmarkRelative:
    def test_weights_sum_to_one(self):
        engine = BenchmarkRelativeOptimizer()
        weights, _ = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert abs(sum(weights.values()) - 1.0) < 1e-6

    def test_all_symbols_present(self):
        engine = BenchmarkRelativeOptimizer()
        weights, _ = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert set(weights.keys()) == set(SYMBOLS)

    def test_explain_contains_ir_decomposition(self):
        engine = BenchmarkRelativeOptimizer()
        _, explain = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert "per_symbol_ir_decomposition" in explain
        for sym in SYMBOLS:
            assert sym in explain["per_symbol_ir_decomposition"]
            d = explain["per_symbol_ir_decomposition"][sym]
            assert "ir_score" in d and "te_estimate" in d

    def test_tight_tracking_error_changes_weights(self):
        """Different TE ceilings should produce different weight distributions."""
        engine = BenchmarkRelativeOptimizer()
        w_loose, ex_loose = engine.fit(_make_input(), _obj(max_tracking_error=0.20), _cov(), ConstraintSet())
        w_tight, ex_tight = engine.fit(_make_input(), _obj(max_tracking_error=0.001), _cov(), ConstraintSet())
        assert ex_loose["max_tracking_error"] == 0.20
        assert ex_tight["max_tracking_error"] == 0.001
        # The two weight vectors should differ in at least one symbol
        assert any(abs(w_loose.get(s, 0) - w_tight.get(s, 0)) > 1e-6 for s in SYMBOLS)

    def test_registered_in_registry(self):
        engine = optimizer_registry.get("benchmark_relative", "3")
        assert engine.engine_id == "benchmark_relative"


# ── MultiObjectiveParetoOptimizer ─────────────────────────────────────────────

class TestMultiObjectivePareto:
    def test_weights_sum_to_one(self):
        engine = MultiObjectiveParetoOptimizer()
        weights, _ = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert abs(sum(weights.values()) - 1.0) < 1e-6

    def test_all_symbols_present(self):
        engine = MultiObjectiveParetoOptimizer()
        weights, _ = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert set(weights.keys()) == set(SYMBOLS)

    def test_explain_contains_frontier(self):
        engine = MultiObjectiveParetoOptimizer()
        _, explain = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert "frontier" in explain
        assert explain["frontier_points"] > 0
        for point in explain["frontier"]:
            assert "lambda" in point and "objectives" in point

    def test_sharpe_preference_favors_high_sharpe_per_vol_symbols(self):
        """Pure Sharpe preference → highest Sharpe/vol score wins.

        sharpe_score = oos_sharpe / vol:
          AAPL: 0.9/0.18 = 5.0  ← winner
          MSFT: 0.8/0.16 = 5.0
          GOOGL: 0.6/0.20 = 3.0
          NVDA: 1.2/0.35 = 3.43
        """
        engine = MultiObjectiveParetoOptimizer()
        weights, explain = engine.fit(
            _make_input(),
            _obj(sharpe_weight=1.0, drawdown_weight=0.0, turnover_weight=0.0),
            _cov(),
            ConstraintSet(),
        )
        # AAPL and MSFT tie on sharpe_score (5.0), so both should be highest
        assert weights["AAPL"] >= weights["NVDA"]
        assert weights["MSFT"] >= weights["NVDA"]
        assert explain["preference"]["sharpe"] == pytest.approx(1.0)

    def test_selected_lambda_in_explain(self):
        engine = MultiObjectiveParetoOptimizer()
        _, explain = engine.fit(_make_input(), _obj(), _cov(), _constraints())
        assert "selected_lambda" in explain
        lam = explain["selected_lambda"]
        assert set(lam.keys()) == {"sharpe", "drawdown", "turnover"}

    def test_registered_in_registry(self):
        engine = optimizer_registry.get("multi_objective_pareto", "3")
        assert engine.engine_id == "multi_objective_pareto"

    def test_preference_is_normalized_and_stored(self):
        """User preference weights are normalized to sum to 1 and stored in explain."""
        engine = MultiObjectiveParetoOptimizer()
        weights, explain = engine.fit(
            _make_input(),
            _obj(sharpe_weight=2.0, drawdown_weight=1.0, turnover_weight=1.0),
            _cov(),
            ConstraintSet(),
        )
        pref = explain["preference"]
        assert abs(pref["sharpe"] + pref["drawdown"] + pref["turnover"] - 1.0) < 1e-6
        assert pref["sharpe"] == pytest.approx(0.5)
        assert pref["drawdown"] == pytest.approx(0.25)
        assert pref["turnover"] == pytest.approx(0.25)
        assert abs(sum(weights.values()) - 1.0) < 1e-6


# ── Registry completeness ─────────────────────────────────────────────────────

class TestRegistryCompleteness:
    def test_all_eleven_engines_registered(self):
        registered = optimizer_registry.list_registered()
        engine_ids = {e["engine_id"] for e in registered}
        expected = {
            # Phase 1
            "equal_weight", "capped_inverse_vol", "simple_shrinkage_mv",
            # Phase 2
            "ledoit_wolf_mv", "turnover_penalized", "slippage_aware", "regime_conditioned",
            # Phase 3
            "black_litterman", "factor_risk_budgeting", "benchmark_relative", "multi_objective_pareto",
        }
        assert expected == engine_ids

    def test_all_engines_produce_valid_weights(self):
        """Smoke test: every registered engine runs without error on 4-symbol input."""
        _VERSION_MAP = {
            "equal_weight": "1", "capped_inverse_vol": "1", "simple_shrinkage_mv": "1",
            "ledoit_wolf_mv": "2", "turnover_penalized": "2", "slippage_aware": "2", "regime_conditioned": "2",
            "black_litterman": "3", "factor_risk_budgeting": "3", "benchmark_relative": "3",
            "multi_objective_pareto": "3",
        }
        inp = _make_input()
        obj = _obj()
        cov = _cov()
        cs = _constraints()

        for entry in optimizer_registry.list_registered():
            engine = optimizer_registry.get(entry["engine_id"], entry["version"])
            weights, explain = engine.fit(inp, obj, cov, cs)
            assert abs(sum(weights.values()) - 1.0) < 1e-6, f"{entry['engine_id']} weights don't sum to 1"
            assert "method" in explain, f"{entry['engine_id']} explain missing 'method'"


# ── Compare endpoint (unit-level, no DB) ─────────────────────────────────────

class TestCompareEndpoint:
    """Unit-test the compare logic without HTTP overhead."""

    def _run_compare(self, engine_ids: list[str], symbols: list[str] = SYMBOLS) -> dict:
        from app.services.optimizer_framework import (
            ConstraintSet, CovarianceModel, ObjectiveFunction, OptimizationInput, optimizer_registry,
        )
        _VERSION_MAP = {
            "equal_weight": "1", "capped_inverse_vol": "1", "simple_shrinkage_mv": "1",
            "ledoit_wolf_mv": "2", "turnover_penalized": "2", "slippage_aware": "2", "regime_conditioned": "2",
            "black_litterman": "3", "factor_risk_budgeting": "3", "benchmark_relative": "3",
            "multi_objective_pareto": "3",
        }
        opt_input = OptimizationInput(
            symbols=symbols,
            metadata_by_symbol={s: METADATA[s] for s in symbols if s in METADATA},
            validation_payload={"per_symbol_oos_sharpe": {s: OOS_SHARPE.get(s, 0.5) for s in symbols}},
        )
        constraints = ConstraintSet()
        covariance_model = CovarianceModel(model_id="diagonal")
        results = []
        for eid in engine_ids:
            version = _VERSION_MAP.get(eid, "1")
            engine = optimizer_registry.get(eid, version)
            objective = ObjectiveFunction(objective_id="max_sharpe", config={})
            weights, explain = engine.fit(opt_input, objective, covariance_model, constraints)
            effective_n = 1.0 / sum(w ** 2 for w in weights.values()) if weights else 0
            results.append({
                "engine_id": eid,
                "weights": weights,
                "summary": {"effective_n": round(effective_n, 2), "symbol_count": len(weights)},
            })
        return {"results": results, "compared": len(results)}

    def test_compare_two_engines(self):
        result = self._run_compare(["equal_weight", "ledoit_wolf_mv"])
        assert result["compared"] == 2
        for r in result["results"]:
            assert abs(sum(r["weights"].values()) - 1.0) < 1e-6

    def test_equal_weight_has_maximum_effective_n(self):
        """Equal weight maximizes diversification (Effective N = N)."""
        result = self._run_compare(["equal_weight", "black_litterman", "multi_objective_pareto"])
        ew = next(r for r in result["results"] if r["engine_id"] == "equal_weight")
        assert abs(ew["summary"]["effective_n"] - len(SYMBOLS)) < 0.01

    def test_all_p3_engines_comparable(self):
        p3 = ["black_litterman", "factor_risk_budgeting", "benchmark_relative", "multi_objective_pareto"]
        result = self._run_compare(p3)
        assert result["compared"] == 4
        # Each engine should produce different weights (not all identical)
        weight_sets = [tuple(sorted(r["weights"].items())) for r in result["results"]]
        assert len(set(weight_sets)) > 1
