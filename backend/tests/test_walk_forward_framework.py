from __future__ import annotations

import pandas as pd

from app.core.backtest import BacktestEngine
from app.indicators.technical import swing_highs_lows
from app.services.backtest_service import (
    _compute_walk_forward_payload,
    _detect_non_causal_indicator_refs,
    _generate_calendar_folds,
    _with_parameter_overrides,
)


def _sample_strategy() -> dict:
    return {
        "entry": {
            "directions": ["long"],
            "logic": "all_of",
            "conditions": [
                {
                    "type": "single",
                    "left": {"field": "close"},
                    "op": ">",
                    "right": 100.0,
                }
            ],
        },
        "stop_loss": {"method": "fixed_pct", "value": 2.0},
        "targets": [{"method": "r_multiple", "r": 1.5}],
        "position_sizing": {"method": "fixed_shares", "shares": 10},
        "tick_size": 0.01,
    }


def _sample_data(periods: int = 900) -> dict[str, pd.DataFrame]:
    idx = pd.date_range("2018-01-01", periods=periods, freq="D")
    close = pd.Series(100 + (pd.Series(range(periods)) * 0.08).values, index=idx)
    df = pd.DataFrame(
        {
            "open": close - 0.2,
            "high": close + 0.5,
            "low": close - 0.5,
            "close": close,
            "volume": 1_000,
        },
        index=idx,
    )
    return {"SPY": df}


def test_generate_calendar_folds_non_overlapping() -> None:
    idx = pd.date_range("2018-01-01", periods=1200, freq="D")
    folds = _generate_calendar_folds(idx, train_window_months=12, test_window_months=3, max_folds=5)

    assert len(folds) == 5
    assert all(f["train_end"] < f["test_start"] for f in folds)
    for left, right in zip(folds, folds[1:]):
        assert left["test_end"] < right["test_start"]


def test_parameter_override_path_assignment() -> None:
    cfg = {
        "entry": {
            "conditions": [
                {"left": {"field": "close"}, "op": ">", "right": 100.0}
            ]
        }
    }

    out = _with_parameter_overrides(cfg, {"entry.conditions[0].right": 123.0})
    assert out["entry"]["conditions"][0]["right"] == 123.0
    assert cfg["entry"]["conditions"][0]["right"] == 100.0


def test_non_causal_indicator_detection() -> None:
    strategy_cfg = {"filters": {"smoother": "filtfilt"}}
    refs = _detect_non_causal_indicator_refs(strategy_cfg)
    assert "filtfilt" in refs


def test_walk_forward_empty_folds_sets_anti_bias_fail() -> None:
    strategy = _sample_strategy()
    data = _sample_data(periods=200)
    run_config = {
        "symbols": ["SPY"],
        "timeframe": "1d",
        "start_date": "2018-01-01",
        "end_date": "2018-12-31",
        "initial_capital": 100_000,
        "walk_forward": {
            "enabled": True,
            "train_window_months": 24,
            "test_window_months": 12,
            "max_folds": 0,
        },
    }

    payload = _compute_walk_forward_payload(data, strategy, run_config, naive_metrics={})
    assert payload["anti_bias"]["leakage_checks_passed"] is False
    assert payload["anti_bias"]["parameter_locking_passed"] is False


def test_walk_forward_payload_contains_oos_stitched_and_anti_bias_flags() -> None:
    strategy = _sample_strategy()
    data = _sample_data()
    run_config = {
        "symbols": ["SPY"],
        "timeframe": "1d",
        "start_date": "2018-01-01",
        "end_date": "2026-01-01",
        "initial_capital": 100_000,
        "commission_per_share": 0.005,
        "commission_pct_per_trade": 0.1,
        "slippage_ticks": 1,
        "walk_forward": {
            "enabled": True,
            "train_window_months": 12,
            "test_window_months": 3,
            "warmup_bars": 50,
            "max_folds": 3,
            "selection_metric": "sharpe_ratio",
        },
    }

    engine = BacktestEngine(strategy, run_config)
    naive_result = engine.run_backtest(data)

    payload = _compute_walk_forward_payload(
        data=data,
        strategy_config=strategy,
        run_config=run_config,
        naive_metrics=naive_result.metrics,
    )

    assert payload["method"] == "sliding_calendar_months"
    assert payload["aggregate_oos"]["fold_count"] >= 1
    assert payload["anti_bias"]["leakage_checks_passed"] is True
    assert payload["anti_bias"]["parameter_locking_passed"] is True
    assert payload["stitched_oos_equity"]
    assert all(bool(f.get("parameter_locking_validated")) for f in payload["folds"])


def test_commission_percent_is_applied() -> None:
    engine = BacktestEngine(_sample_strategy(), {"initial_capital": 100_000, "commission_per_share": 0.0, "commission_pct_per_trade": 0.1})
    commission = engine._calc_commission(quantity=10, price=100)
    assert round(commission, 4) == 1.0


def test_causal_swing_high_low_uses_only_past_bars() -> None:
    idx = pd.date_range("2024-01-01", periods=8, freq="D")
    high = pd.Series([10, 11, 12, 11, 10, 9, 15, 8], index=idx)
    low = pd.Series([9, 8, 7, 8, 9, 10, 6, 11], index=idx)

    swings = swing_highs_lows(high, low, lookback=3)

    # A future spike must not back-mark older bars.
    assert bool(swings.loc[idx[2], "swing_high"]) is False
    assert bool(swings.loc[idx[6], "swing_high"]) is True
