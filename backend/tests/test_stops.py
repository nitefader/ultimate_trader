"""Tests for stop and target calculation."""
import numpy as np
import pandas as pd
import pytest
from app.strategies.stops import calculate_stop, calculate_target, update_trailing_stop


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
