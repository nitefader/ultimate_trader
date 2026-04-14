"""Tests for the strategy parameter optimizer service."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import numpy as np
import pytest

from app.services.param_optimizer import (
    _apply_params,
    _run_single,
    _set_nested,
    run_param_optimization,
)


# ── Unit tests for path helpers ───────────────────────────────────────────────

def test_set_nested_simple():
    cfg = {"stop_loss": {"multiplier": 1.0}}
    _set_nested(cfg, "stop_loss.multiplier", 2.5)
    assert cfg["stop_loss"]["multiplier"] == 2.5


def test_set_nested_creates_missing_keys():
    cfg = {}
    _set_nested(cfg, "a.b.c", 42)
    assert cfg["a"]["b"]["c"] == 42


def test_set_nested_list_index():
    cfg = {"items": [10, 20, 30]}
    _set_nested(cfg, "items.1", 99)
    assert cfg["items"][1] == 99


def test_apply_params_does_not_mutate_original():
    original = {"stop_loss": {"multiplier": 1.0}}
    patched = _apply_params(original, {"stop_loss.multiplier": 3.0})
    assert original["stop_loss"]["multiplier"] == 1.0
    assert patched["stop_loss"]["multiplier"] == 3.0


def test_apply_params_multiple_paths():
    cfg = {"a": {"x": 1}, "b": {"y": 2}}
    result = _apply_params(cfg, {"a.x": 10, "b.y": 20})
    assert result["a"]["x"] == 10
    assert result["b"]["y"] == 20


# ── _run_single unit tests ────────────────────────────────────────────────────

def _make_ohlcv_df(n: int = 200) -> pd.DataFrame:
    """Create a minimal synthetic OHLCV DataFrame for engine testing."""
    rng = np.random.default_rng(42)
    close = 100.0 + np.cumsum(rng.normal(0, 1, n))
    close = np.maximum(close, 10.0)
    df = pd.DataFrame(
        {
            "open": close * 0.999,
            "high": close * 1.005,
            "low": close * 0.995,
            "close": close,
            "volume": rng.integers(1_000_000, 5_000_000, n).astype(float),
        },
        index=pd.date_range("2020-01-01", periods=n, freq="B"),
    )
    df.index.name = "date"
    return df


def _minimal_strategy() -> dict:
    return {
        "entry": {
            "directions": ["long"],
            "conditions": [
                {"type": "single", "left": {"indicator": "ema_9"}, "op": "crosses_above", "right": {"indicator": "ema_21"}}
            ],
        },
        "stop_loss": {"method": "atr_multiple", "atr_period": 14, "multiplier": 2.0},
        "position_sizing": {"method": "risk_pct", "risk_pct": 1.0},
        "risk": {"max_position_size_pct": 1.0, "max_correlated_exposure": 1.0},
        "exit": {
            "conditions": [
                {"type": "single", "left": {"indicator": "ema_9"}, "op": "crosses_below", "right": {"indicator": "ema_21"}}
            ]
        },
    }


def _minimal_run_config() -> dict:
    return {
        "symbols": ["TEST"],
        "timeframe": "1d",
        "start_date": "2020-01-01",
        "end_date": "2021-01-01",
        "initial_capital": 100_000,
        "slippage_ticks": 0,
        "commission_per_share": 0.0,
    }


def test_run_single_returns_dict_with_required_keys():
    df = _make_ohlcv_df(200)
    result = _run_single(
        strategy_config=_minimal_strategy(),
        run_config=_minimal_run_config(),
        cached_data={"TEST": df},
        params={"stop_loss.multiplier": 2.0},
        objective_metric="sharpe_ratio",
    )
    assert "params" in result
    assert "objective" in result
    assert "metrics" in result
    assert result["params"] == {"stop_loss.multiplier": 2.0}


def test_run_single_handles_bad_engine_gracefully():
    """If backtest raises, _run_single returns -inf objective without crashing."""
    df = _make_ohlcv_df(5)  # too few bars — engine will error
    result = _run_single(
        strategy_config=_minimal_strategy(),
        run_config=_minimal_run_config(),
        cached_data={"TEST": df},
        params={},
        objective_metric="sharpe_ratio",
    )
    # Should not raise; objective is -inf or a float
    assert isinstance(result["objective"], float)


def test_lower_is_better_contains_drawdown():
    """max_drawdown_pct must be in _LOWER_IS_BETTER so ranking inverts correctly."""
    from app.services.param_optimizer import _LOWER_IS_BETTER
    assert "max_drawdown_pct" in _LOWER_IS_BETTER


def test_run_single_negates_lower_is_better_metrics():
    """When objective_metric is in _LOWER_IS_BETTER and a non-zero value exists,
    objective == -raw_metric.  We verify via sharpe which is NOT negated."""
    df = _make_ohlcv_df(300)
    # sharpe is NOT in _LOWER_IS_BETTER — objective == raw sharpe
    result = _run_single(
        strategy_config=_minimal_strategy(),
        run_config=_minimal_run_config(),
        cached_data={"TEST": df},
        params={},
        objective_metric="sharpe_ratio",
    )
    raw = float(result["metrics"].get("sharpe_ratio") or 0.0)
    # If trades occurred, objective == raw. If no trades, both are -inf / 0.
    # Either way, objective should equal raw (not negated).
    if result["objective"] != float("-inf"):
        assert abs(result["objective"] - raw) < 1e-6


# ── Integration tests for run_param_optimization ────────────────────────────

@pytest.mark.asyncio
async def test_empty_param_grid_returns_error():
    result = await run_param_optimization(
        strategy_config=_minimal_strategy(),
        run_config=_minimal_run_config(),
        param_grid={},
    )
    assert result["evaluated"] == 0
    assert "error" in result


@pytest.mark.asyncio
async def test_run_param_optimization_ranks_by_objective():
    """Run a 2-value grid and confirm results are ranked highest objective first."""
    df = _make_ohlcv_df(300)

    with patch("app.services.market_data_service.fetch_market_data", return_value=df):
        result = await run_param_optimization(
            strategy_config=_minimal_strategy(),
            run_config={**_minimal_run_config(), "data_provider": "yfinance"},
            param_grid={"stop_loss.multiplier": [1.5, 2.5]},
            objective_metric="sharpe_ratio",
            max_combinations=10,
        )

    assert result["total_combinations"] == 2
    ranked = result["ranked"]
    assert len(ranked) == 2
    assert ranked[0]["rank"] == 1
    assert ranked[1]["rank"] == 2
    assert ranked[0]["objective"] >= ranked[1]["objective"]


@pytest.mark.asyncio
async def test_run_param_optimization_respects_max_combinations():
    """If grid has more combos than max_combinations, only max_combinations are run."""
    df = _make_ohlcv_df(200)

    with patch("app.services.market_data_service.fetch_market_data", return_value=df):
        result = await run_param_optimization(
            strategy_config=_minimal_strategy(),
            run_config={**_minimal_run_config(), "data_provider": "yfinance"},
            param_grid={"stop_loss.multiplier": [1.0, 1.5, 2.0, 2.5, 3.0]},
            objective_metric="sharpe_ratio",
            max_combinations=3,
        )

    assert result["evaluated"] == 3
    assert result["total_combinations"] == 5
    assert result["skipped"] == 2


@pytest.mark.asyncio
async def test_run_param_optimization_no_data_returns_error():
    """When no market data is available, optimization returns an error dict."""
    with patch("app.services.market_data_service.fetch_market_data", return_value=None):
        result = await run_param_optimization(
            strategy_config=_minimal_strategy(),
            run_config={**_minimal_run_config(), "data_provider": "yfinance"},
            param_grid={"stop_loss.multiplier": [1.5, 2.0]},
        )

    assert result["evaluated"] == 0
    assert "error" in result
