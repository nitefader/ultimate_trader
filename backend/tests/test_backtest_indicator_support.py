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


def test_prev_day_and_prev_week_levels_are_available_and_causal():
    idx = pd.date_range("2024-01-01", periods=10, freq="B")
    df = pd.DataFrame(
        {
            "open":  [10, 11, 12, 13, 14, 20, 21, 22, 23, 24],
            "high":  [11, 12, 13, 14, 15, 21, 22, 23, 24, 25],
            "low":   [9, 10, 11, 12, 13, 19, 20, 21, 22, 23],
            "close": [10, 11, 12, 13, 14, 20, 21, 22, 23, 24],
            "volume": [100] * 10,
        },
        index=idx,
    )

    engine = BacktestEngine(
        {
            "entry": {
                "directions": ["long"],
                "logic": "all_of",
                "conditions": [
                    {"type": "single", "left": {"field": "close"}, "op": ">", "right": {"indicator": "prev_day_high"}},
                    {"type": "single", "left": {"field": "close"}, "op": ">", "right": {"indicator": "prev_week_high"}},
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

    indicators = engine._compute_indicators(df)

    assert pd.isna(indicators.loc[idx[0], "prev_day_high"])
    assert indicators.loc[idx[1], "prev_day_high"] == 11
    assert indicators.loc[idx[1], "prev_day_low"] == 9
    assert indicators.loc[idx[1], "prev_day_close"] == 10

    # The whole second week should reference the first week's completed values.
    for ts in idx[5:]:
        assert indicators.loc[ts, "prev_week_high"] == 15
        assert indicators.loc[ts, "prev_week_low"] == 9
        assert indicators.loc[ts, "prev_week_close"] == 14


def test_session_state_and_prev_month_levels_are_available_and_causal():
    idx = pd.to_datetime(
        [
            "2024-06-28 14:30:00+00:00",
            "2024-07-01 14:30:00+00:00",
            "2024-11-29 15:30:00+00:00",
        ],
        utc=True,
    )
    df = pd.DataFrame(
        {
            "open": [10, 20, 30],
            "high": [11, 21, 31],
            "low": [9, 19, 29],
            "close": [10, 20, 30],
            "volume": [100, 100, 100],
        },
        index=idx,
    )

    engine = BacktestEngine({}, {})
    engine._required_indicator_refs = {
        "prev_month_high",
        "prev_month_low",
        "prev_month_close",
        "market_day_type",
        "in_regular_session",
    }

    indicators = engine._compute_indicators(df, symbol="AAPL")

    assert pd.isna(indicators.loc[idx[0], "prev_month_high"])
    assert indicators.loc[idx[1], "prev_month_high"] == 11
    assert indicators.loc[idx[1], "prev_month_low"] == 9
    assert indicators.loc[idx[1], "prev_month_close"] == 10
    assert indicators.loc[idx[2], "market_day_type"] == "half_day"
    assert indicators.loc[idx[2], "in_regular_session"] == 1.0


def test_donchian_channel_components_are_available_for_dc_refs() -> None:
    df = _make_breakout_df()

    engine = BacktestEngine({"indicators": {"donchian_period": 3}}, {})
    engine._required_indicator_refs = {"dc_upper", "dc_mid", "dc_lower"}

    indicators = engine._compute_indicators(df, symbol="AAPL")

    assert {"dc_upper", "dc_mid", "dc_lower"} <= set(indicators.columns)
    assert indicators["dc_upper"].notna().any()
    assert indicators["dc_lower"].notna().any()
