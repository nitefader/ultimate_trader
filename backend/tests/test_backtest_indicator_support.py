from __future__ import annotations

import pandas as pd
import pytest

from app.core.backtest import BacktestEngine


def _make_breakout_df() -> pd.DataFrame:
    idx = pd.date_range("2024-01-01", periods=9, freq="D")
    return pd.DataFrame(
        {
            "open": [100, 101, 102, 103, 104, 105, 110, 112, 114],
            "high": [101, 102, 103, 104, 105, 106, 112, 116, 117],
            "low": [99, 100, 101, 102, 103, 104, 109, 111, 113],
            "close": [100, 101, 102, 103, 104, 105, 111, 115, 116],
            "volume": [100, 100, 100, 100, 100, 100, 500, 220, 180],
        },
        index=idx,
    )


def test_dynamic_indicator_breakout_strategy_generates_trade():
    config = {
        "entry": {
            "directions": ["long"],
            "logic": "all_of",
            "conditions": [
                {
                    "type": "single",
                    "left": {"field": "close"},
                    "op": ">",
                    "right": {"indicator": "high_3"},
                },
                {
                    "type": "single",
                    "left": {"indicator": "volume"},
                    "op": ">",
                    "right": {"indicator": "volume_avg_3", "mult": 1.1},
                },
            ],
        },
        "stop_loss": {"method": "fixed_pct", "value": 2.0},
        "targets": [{"method": "r_multiple", "r": 1.0}],
        "position_sizing": {"method": "fixed_shares", "shares": 10},
        "tick_size": 0.01,
    }

    df = _make_breakout_df()
    engine = BacktestEngine(
        config,
        {
            "symbols": ["SPY"],
            "timeframe": "1d",
            "start_date": str(df.index[0].date()),
            "end_date": str(df.index[-1].date()),
            "initial_capital": 100_000,
        },
    )

    result = engine.run_backtest({"SPY": df})

    assert len(result.trades) >= 1
    assert result.trades[0]["symbol"] == "SPY"


def test_unsupported_indicator_reference_raises_clear_error():
    df = _make_breakout_df()
    engine = BacktestEngine(
        {
            "entry": {
                "directions": ["long"],
                "logic": "all_of",
                "conditions": [
                    {
                        "type": "single",
                        "left": {"field": "close"},
                        "op": ">",
                        "right": {"indicator": "spread_zscore"},
                    }
                ],
            },
            "stop_loss": {"method": "fixed_pct", "value": 2.0},
            "position_sizing": {"method": "fixed_shares", "shares": 10},
        },
        {
            "symbols": ["SPY"],
            "timeframe": "1d",
            "start_date": str(df.index[0].date()),
            "end_date": str(df.index[-1].date()),
            "initial_capital": 100_000,
        },
    )

    with pytest.raises(ValueError, match="unsupported indicator reference"):
        engine.run_backtest({"SPY": df})


def test_volume_sma_indicator_generates_trade():
    df = _make_breakout_df()
    config = {
        "entry": {
            "directions": ["long"],
            "logic": "all_of",
            "conditions": [
                {
                    "type": "single",
                    "left": {"field": "close"},
                    "op": ">",
                    "right": {"indicator": "high_3"},
                },
                {
                    "type": "single",
                    "left": {"indicator": "volume"},
                    "op": ">",
                    "right": {"indicator": "volume_sma_3", "mult": 1.1},
                },
            ],
        },
        "stop_loss": {"method": "fixed_pct", "value": 2.0},
        "targets": [{"method": "r_multiple", "r": 1.0}],
        "position_sizing": {"method": "fixed_shares", "shares": 10},
        "tick_size": 0.01,
    }

    engine = BacktestEngine(
        config,
        {
            "symbols": ["SPY"],
            "timeframe": "1d",
            "start_date": str(df.index[0].date()),
            "end_date": str(df.index[-1].date()),
            "initial_capital": 100_000,
        },
    )

    result = engine.run_backtest({"SPY": df})
    assert len(result.trades) >= 1
