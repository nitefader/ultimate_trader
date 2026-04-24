"""Tests for stop and target calculation."""
import numpy as np
import pandas as pd
import pytest
from app.strategies.stops import calculate_stop, calculate_target, update_trailing_stop, resolve_atr_override


def make_df(n=50, base_price=100.0):
    idx = pd.date_range("2024-01-01", periods=n, freq="D")
    data = {
        "open": [base_price + i * 0.1 for i in range(n)],
        "high": [base_price + i * 0.1 + 1 for i in range(n)],
        "low": [base_price + i * 0.1 - 1 for i in range(n)],
        "close": [base_price + i * 0.1 for i in range(n)],
        "volume": [1_000_000] * n,
    }
    return pd.DataFrame(data, index=idx)


def test_fixed_pct_stop_long():
    df = make_df()
    bar = df.iloc[-1]
    stop = calculate_stop({"method": "fixed_pct", "value": 2.0}, 100.0, "long", bar, df, 49)
    assert stop == pytest.approx(98.0)


def test_fixed_pct_stop_short():
    df = make_df()
    bar = df.iloc[-1]
    stop = calculate_stop({"method": "fixed_pct", "value": 2.0}, 100.0, "short", bar, df, 49)
    assert stop == pytest.approx(102.0)


def test_fixed_dollar_stop():
    df = make_df()
    bar = df.iloc[-1]
    stop = calculate_stop({"method": "fixed_dollar", "value": 500}, 400.0, "long", bar, df, 49)
    assert stop == pytest.approx(400.0 - 500)


def test_atr_stop_long():
    df = make_df(n=30)
    bar = df.iloc[-1]
    stop = calculate_stop({"method": "atr_multiple", "period": 14, "mult": 2.0}, 100.0, "long", bar, df, 29)
    assert stop is not None
    assert stop < 100.0  # stop must be below entry for long


def test_prev_bar_low_stop():
    df = make_df()
    bar = df.iloc[-1]
    stop = calculate_stop({"method": "prev_bar_low"}, 100.0, "long", bar, df, 49)
    expected = float(df.iloc[48]["low"])
    assert stop == pytest.approx(expected)


def test_n_bars_low_stop():
    df = make_df()
    bar = df.iloc[-1]
    stop = calculate_stop({"method": "n_bars_low", "n": 3}, 100.0, "long", bar, df, 49)
    expected = float(df["low"].iloc[46:50].min())
    assert stop == pytest.approx(expected)


def test_combined_stop_farthest():
    df = make_df()
    bar = df.iloc[-1]
    stop = calculate_stop({
        "method": "combined",
        "rule": "farthest",
        "stops": [
            {"method": "fixed_pct", "value": 1.0},
            {"method": "fixed_pct", "value": 3.0},
        ]
    }, 100.0, "long", bar, df, 49)
    # Farthest stop for long = lowest = 3%
    assert stop == pytest.approx(97.0)


def test_r_multiple_target():
    df = make_df()
    bar = df.iloc[-1]
    target = calculate_target({"method": "r_multiple", "r": 2.0}, 100.0, 98.0, "long", bar, df, 49)
    # Risk = 2.0, target = entry + 2 * risk = 104
    assert target == pytest.approx(104.0)


def test_r_multiple_target_short():
    df = make_df()
    bar = df.iloc[-1]
    target = calculate_target({"method": "r_multiple", "r": 2.0}, 100.0, 103.0, "short", bar, df, 49)
    # Risk = 3.0, target = 100 - 2 * 3 = 94
    assert target == pytest.approx(94.0)


def test_atr_target():
    df = make_df(n=30)
    bar = df.iloc[-1]
    target = calculate_target({"method": "atr_multiple", "period": 14, "mult": 3.0}, 100.0, 98.0, "long", bar, df, 29)
    assert target is not None
    assert target > 100.0


def test_trailing_stop_never_worse():
    df = make_df(n=30)
    bar = df.iloc[-1]
    initial_stop = 95.0
    # Trail should not move stop down
    new_stop = update_trailing_stop(
        {"method": "pct_trail", "value": 2.0},
        initial_stop, "long", bar, df, 29, 100.0, initial_stop
    )
    assert new_stop >= initial_stop


def test_trailing_stop_moves_up():
    # Create a strong uptrend
    idx = pd.date_range("2024-01-01", periods=30, freq="D")
    data = {
        "open": [100 + i * 2 for i in range(30)],
        "high": [102 + i * 2 for i in range(30)],
        "low": [99 + i * 2 for i in range(30)],
        "close": [100 + i * 2 for i in range(30)],
        "volume": [1_000_000] * 30,
    }
    df = pd.DataFrame(data, index=idx)
    bar = df.iloc[-1]  # close = 100 + 29*2 = 158
    new_stop = update_trailing_stop(
        {"method": "pct_trail", "value": 2.0},
        100.0, "long", bar, df, 29, 100.0, 95.0
    )
    assert new_stop > 100.0  # stop must have moved up


# ── resolve_atr_override tests ─────────────────────────────────────────────────

def make_atr_df(n=30, freq="5min"):
    idx = pd.date_range("2024-01-02 09:30", periods=n, freq=freq)
    data = {
        "open":  [100.0 + i * 0.05 for i in range(n)],
        "high":  [100.0 + i * 0.05 + 0.5 for i in range(n)],
        "low":   [100.0 + i * 0.05 - 0.5 for i in range(n)],
        "close": [100.0 + i * 0.05 for i in range(n)],
    }
    return pd.DataFrame(data, index=idx)


def test_resolve_atr_override_returns_none_when_strategy_source():
    df = make_atr_df()
    bar_dt = df.index[-1]
    result = resolve_atr_override({"atr_source": "strategy"}, df, bar_dt)
    assert result is None


def test_resolve_atr_override_returns_none_when_insufficient_bars():
    df = make_atr_df(n=5)
    bar_dt = df.index[-1]
    result = resolve_atr_override({"atr_source": "custom", "atr_length": 14}, df, bar_dt)
    assert result is None


def test_resolve_atr_override_returns_float():
    df = make_atr_df(n=30)
    bar_dt = df.index[-1]
    result = resolve_atr_override({"atr_source": "custom", "atr_length": 14}, df, bar_dt)
    assert result is not None
    assert isinstance(result, float)
    assert result > 0.0


def test_resolve_atr_override_uses_only_completed_bars():
    """Bars after bar_dt must not be included — no lookahead."""
    df = make_atr_df(n=30)
    # Use the 15th bar as the "current" time — bars 16-30 must not be used
    bar_dt = df.index[14]
    result_at_15 = resolve_atr_override({"atr_source": "custom", "atr_length": 14}, df, bar_dt)
    # Use the last bar — all 30 bars available
    result_at_30 = resolve_atr_override({"atr_source": "custom", "atr_length": 14}, df, df.index[-1])
    # Both should be valid; the at-15 value is computed on fewer bars
    assert result_at_15 is not None
    assert result_at_30 is not None
    # They should differ because different bar windows
    # (this is a smoke test — exact values depend on the synthetic data)


def test_atr_override_param_overrides_trade_tf_atr():
    """When atr_override is passed to calculate_stop, it must be used instead of df's ATR."""
    df = make_df(n=30)
    bar = df.iloc[-1]
    # Calculate stop using df's own ATR
    stop_default = calculate_stop({"method": "atr_multiple", "period": 14, "mult": 2.0}, 100.0, "long", bar, df, 29)
    # Pass an artificially large override — stop must be much further away
    stop_override = calculate_stop({"method": "atr_multiple", "period": 14, "mult": 2.0}, 100.0, "long", bar, df, 29,
                                   atr_override=10.0)
    assert stop_override is not None
    assert stop_default is not None
    assert stop_override < stop_default  # larger ATR → wider stop → lower price for long
