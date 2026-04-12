"""Tests for condition evaluation engine — including N-of-M logic."""
import pandas as pd
import numpy as np
import pytest
from app.strategies.conditions import (
    EvalContext, eval_single_condition, evaluate_condition_group, evaluate_conditions
)


def make_ctx(close=100.0, rsi=50.0, ema_20=98.0, adx=30.0):
    bar = pd.Series({
        "open": close * 0.99,
        "high": close * 1.01,
        "low": close * 0.98,
        "close": close,
        "volume": 1_000_000,
        "rsi_14": rsi,
        "ema_20": ema_20,
        "adx": adx,
        "bb_lower": 95.0,
        "bb_upper": 105.0,
    })
    df = pd.DataFrame([bar] * 5)
    return EvalContext(bar=bar, bar_index=2, df=df, account_equity=100_000)


def test_simple_greater_than():
    ctx = make_ctx(close=100, ema_20=98)
    cond = {"type": "single", "left": {"field": "close"}, "op": ">", "right": {"indicator": "ema_20"}}
    assert evaluate_condition_group(cond, ctx) is True


def test_simple_less_than_false():
    ctx = make_ctx(close=100, ema_20=105)
    cond = {"type": "single", "left": {"field": "close"}, "op": ">", "right": {"indicator": "ema_20"}}
    assert evaluate_condition_group(cond, ctx) is False


def test_all_of_passes():
    ctx = make_ctx(close=100, rsi=60, ema_20=98)
    group = {
        "type": "all_of",
        "conditions": [
            {"type": "single", "left": {"field": "close"}, "op": ">", "right": {"indicator": "ema_20"}},
            {"type": "single", "left": {"indicator": "rsi_14"}, "op": ">", "right": 50},
        ]
    }
    assert evaluate_condition_group(group, ctx) is True


def test_all_of_fails():
    ctx = make_ctx(close=100, rsi=40, ema_20=98)
    group = {
        "type": "all_of",
        "conditions": [
            {"type": "single", "left": {"field": "close"}, "op": ">", "right": {"indicator": "ema_20"}},
            {"type": "single", "left": {"indicator": "rsi_14"}, "op": ">", "right": 50},  # rsi=40 < 50
        ]
    }
    assert evaluate_condition_group(group, ctx) is False


def test_any_of():
    ctx = make_ctx(close=100, rsi=40, ema_20=98)
    group = {
        "type": "any_of",
        "conditions": [
            {"type": "single", "left": {"field": "close"}, "op": ">", "right": {"indicator": "ema_20"}},
            {"type": "single", "left": {"indicator": "rsi_14"}, "op": ">", "right": 50},  # fails
        ]
    }
    assert evaluate_condition_group(group, ctx) is True  # first passes


def test_n_of_m_4_of_5():
    """Critical: test 4-of-5 N-of-M logic."""
    ctx = make_ctx(close=100, rsi=60, ema_20=98, adx=30)
    bar = ctx.bar.copy()
    bar["macd"] = 0.5
    bar["macd_signal"] = 0.2
    ctx.bar = bar
    ctx.df = pd.DataFrame([bar] * 5)

    conditions = [
        {"type": "single", "left": {"field": "close"}, "op": ">", "right": {"indicator": "ema_20"}},  # True
        {"type": "single", "left": {"indicator": "rsi_14"}, "op": ">", "right": 50},                  # True (60>50)
        {"type": "single", "left": {"indicator": "adx"}, "op": ">", "right": 25},                     # True (30>25)
        {"type": "single", "left": {"indicator": "macd"}, "op": ">", "right": {"indicator": "macd_signal"}},  # True (0.5>0.2)
        {"type": "single", "left": {"indicator": "rsi_14"}, "op": ">", "right": 70},                  # False (60<70)
    ]

    group = {"type": "n_of_m", "n": 4, "conditions": conditions}
    assert evaluate_condition_group(group, ctx) is True   # 4 of 5 pass


def test_n_of_m_requires_minimum():
    ctx = make_ctx(close=100, rsi=40, ema_20=105, adx=20)
    # Only 1 condition will pass
    conditions = [
        {"type": "single", "left": {"field": "close"}, "op": ">", "right": 50},    # True (100>50)
        {"type": "single", "left": {"field": "close"}, "op": ">", "right": 200},   # False
        {"type": "single", "left": {"indicator": "rsi_14"}, "op": ">", "right": 50},  # False (40<50)
    ]
    group = {"type": "n_of_m", "n": 2, "conditions": conditions}
    assert evaluate_condition_group(group, ctx) is False   # only 1 passes, need 2


def test_6_of_7_logic():
    """Test the 6-of-7 example from requirements."""
    ctx = make_ctx(close=100, rsi=65, ema_20=95, adx=35)
    bar = ctx.bar.copy()
    # pd.Series.update does not add new keys, it only updates existing labels.
    bar["sma_50"] = 90.0
    bar["sma_200"] = 85.0
    bar["bb_lower"] = 88.0
    bar["stoch_k"] = 70.0
    ctx.bar = bar

    conditions = [
        {"type": "single", "left": {"field": "close"}, "op": ">", "right": {"indicator": "ema_20"}},      # T
        {"type": "single", "left": {"indicator": "rsi_14"}, "op": ">", "right": 60},                       # T (65)
        {"type": "single", "left": {"indicator": "adx"}, "op": ">", "right": 25},                          # T (35)
        {"type": "single", "left": {"field": "close"}, "op": ">", "right": {"indicator": "sma_50"}},       # T
        {"type": "single", "left": {"field": "close"}, "op": ">", "right": {"indicator": "sma_200"}},      # T
        {"type": "single", "left": {"indicator": "stoch_k"}, "op": ">", "right": 50},                      # T (70)
        {"type": "single", "left": {"indicator": "rsi_14"}, "op": ">", "right": 80},                       # F (65<80)
    ]

    group = {"type": "n_of_m", "n": 6, "conditions": conditions}
    assert evaluate_condition_group(group, ctx) is True   # 6 of 7 pass


def test_not_condition():
    ctx = make_ctx(close=100, rsi=40)
    group = {
        "type": "not",
        "condition": {"type": "single", "left": {"indicator": "rsi_14"}, "op": ">", "right": 50}
    }
    assert evaluate_condition_group(group, ctx) is True  # NOT (40 > 50) = NOT False = True


def test_regime_filter():
    ctx = make_ctx()
    ctx.regime = "trending_up"
    group = {"type": "regime_filter", "allowed": ["trending_up", "trending_down"]}
    assert evaluate_condition_group(group, ctx) is True

    ctx.regime = "ranging"
    assert evaluate_condition_group(group, ctx) is False


def test_evaluate_conditions_all_of():
    ctx = make_ctx(close=100, rsi=60, ema_20=98)
    conditions = [
        {"type": "single", "left": {"field": "close"}, "op": ">", "right": 50},
        {"type": "single", "left": {"indicator": "rsi_14"}, "op": ">", "right": 50},
    ]
    assert evaluate_conditions(conditions, ctx, "all_of") is True


def test_evaluate_conditions_n_of_m_str():
    ctx = make_ctx(close=100, rsi=40)
    conditions = [
        {"type": "single", "left": {"field": "close"}, "op": ">", "right": 50},    # T
        {"type": "single", "left": {"indicator": "rsi_14"}, "op": ">", "right": 50},  # F
        {"type": "single", "left": {"field": "close"}, "op": ">", "right": 200},   # F
    ]
    assert evaluate_conditions(conditions, ctx, "n_of_m:1") is True
    assert evaluate_conditions(conditions, ctx, "n_of_m:2") is False
