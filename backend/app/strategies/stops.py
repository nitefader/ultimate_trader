"""
Stop loss calculation supporting multiple reference methods.

All functions return the stop price for a given entry/direction.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.indicators.technical import atr as calc_atr


def calculate_stop(
    config: dict,
    entry_price: float,
    direction: str,  # "long" or "short"
    bar: pd.Series,
    df: pd.DataFrame,
    bar_index: int,
    fvgs: list | None = None,
    sr_zones: list | None = None,
    swing_lows: list | None = None,
    swing_highs: list | None = None,
) -> float | None:
    """
    Unified stop price calculation.

    Config examples:
      {"method": "fixed_pct", "value": 2.0}               # 2% from entry
      {"method": "fixed_dollar", "value": 500}             # $500 from entry
      {"method": "atr_multiple", "period": 14, "mult": 2.0}
      {"method": "prev_bar_low"}                           # for long; prev_bar_high for short
      {"method": "n_bars_low", "n": 3}
      {"method": "swing_low", "lookback": 3}
      {"method": "fvg_low", "direction": "bullish"}
      {"method": "fvg_midpoint", "direction": "bullish"}
      {"method": "sr_support"}
      {"method": "session_low"}
      {"method": "chandelier", "period": 22, "mult": 3.0}
      {"method": "combined", "stops": [...], "rule": "farthest"}  # farthest/nearest
    """
    method = config.get("method", "fixed_pct")

    if method == "fixed_pct":
        pct = float(config.get("value", 2.0)) / 100.0
        if direction == "long":
            return entry_price * (1.0 - pct)
        else:
            return entry_price * (1.0 + pct)

    if method == "fixed_dollar":
        dollar = float(config.get("value", 500))
        if direction == "long":
            return entry_price - dollar
        else:
            return entry_price + dollar

    if method == "atr_multiple":
        period = int(config.get("period", 14))
        mult = float(config.get("mult", 2.0))
        if bar_index < period:
            return None
        atr_val = float(calc_atr(df["high"], df["low"], df["close"], period).iloc[bar_index])
        if np.isnan(atr_val):
            return None
        if direction == "long":
            return entry_price - mult * atr_val
        else:
            return entry_price + mult * atr_val

    if method == "prev_bar_low":
        if bar_index < 1:
            return None
        prev = df.iloc[bar_index - 1]
        if direction == "long":
            return float(prev["low"])
        else:
            return float(prev["high"])

    if method == "prev_bar_high":
        if bar_index < 1:
            return None
        prev = df.iloc[bar_index - 1]
        return float(prev["high"])

    if method == "n_bars_low":
        n = int(config.get("n", 3))
        start = max(0, bar_index - n)
        if direction == "long":
            return float(df["low"].iloc[start:bar_index + 1].min())
        else:
            return float(df["high"].iloc[start:bar_index + 1].max())

    if method == "swing_low":
        if direction == "long" and swing_lows:
            # Use most recent swing low below entry
            candidates = [sl for sl in swing_lows if sl.price < entry_price]
            if candidates:
                return float(max(candidates, key=lambda x: x.price).price)
        if direction == "short" and swing_highs:
            candidates = [sh for sh in swing_highs if sh.price > entry_price]
            if candidates:
                return float(min(candidates, key=lambda x: x.price).price)
        # Fallback to fixed pct
        return calculate_stop({"method": "fixed_pct", "value": 2.0}, entry_price, direction, bar, df, bar_index)

    if method == "fvg_low":
        fvg_direction = config.get("direction", "bullish")
        if fvgs:
            relevant = [f for f in fvgs if f.direction == fvg_direction and not f.filled]
            if relevant:
                nearest = min(relevant, key=lambda f: abs(f.midpoint - entry_price))
                if direction == "long":
                    return nearest.low
                else:
                    return nearest.high
        return calculate_stop({"method": "fixed_pct", "value": 2.0}, entry_price, direction, bar, df, bar_index)

    if method == "fvg_midpoint":
        fvg_direction = config.get("direction", "bullish")
        if fvgs:
            relevant = [f for f in fvgs if f.direction == fvg_direction and not f.filled]
            if relevant:
                nearest = min(relevant, key=lambda f: abs(f.midpoint - entry_price))
                return nearest.midpoint
        return calculate_stop({"method": "fixed_pct", "value": 2.0}, entry_price, direction, bar, df, bar_index)

    if method == "sr_support":
        if sr_zones and direction == "long":
            supports = [z for z in sr_zones if z.kind == "support" and z.midpoint < entry_price]
            if supports:
                return max(supports, key=lambda z: z.midpoint).midpoint
        if sr_zones and direction == "short":
            resistances = [z for z in sr_zones if z.kind == "resistance" and z.midpoint > entry_price]
            if resistances:
                return min(resistances, key=lambda z: z.midpoint).midpoint
        return calculate_stop({"method": "fixed_pct", "value": 2.0}, entry_price, direction, bar, df, bar_index)

    if method == "session_low":
        # Use session low (today's low so far)
        if direction == "long":
            return float(df["low"].iloc[max(0, bar_index - 78):bar_index + 1].min())  # ~78 5m bars = 1 session
        else:
            return float(df["high"].iloc[max(0, bar_index - 78):bar_index + 1].max())

    if method == "chandelier":
        period = int(config.get("period", 22))
        mult = float(config.get("mult", 3.0))
        if bar_index < period:
            return None
        window = df.iloc[bar_index - period:bar_index + 1]
        atr_val = float(calc_atr(df["high"], df["low"], df["close"], period).iloc[bar_index])
        if direction == "long":
            return float(window["high"].max()) - mult * atr_val
        else:
            return float(window["low"].min()) + mult * atr_val

    if method == "combined":
        stops_config = config.get("stops", [])
        rule = config.get("rule", "farthest")
        computed = []
        for sc in stops_config:
            v = calculate_stop(sc, entry_price, direction, bar, df, bar_index, fvgs, sr_zones, swing_lows, swing_highs)
            if v is not None:
                computed.append(v)
        if not computed:
            return None
        if direction == "long":
            return min(computed) if rule == "farthest" else max(computed)
        else:
            return max(computed) if rule == "farthest" else min(computed)

    return None


def calculate_target(
    config: dict,
    entry_price: float,
    stop_price: float | None,
    direction: str,
    bar: pd.Series,
    df: pd.DataFrame,
    bar_index: int,
    r_multiple: float | None = None,
    sr_zones: list | None = None,
    swing_highs: list | None = None,
    swing_lows: list | None = None,
) -> float | None:
    """
    Unified target price calculation.

    Config examples:
      {"method": "r_multiple", "r": 2.0}
      {"method": "fixed_pct", "value": 4.0}
      {"method": "atr_multiple", "period": 14, "mult": 3.0}
      {"method": "prev_day_high"}
      {"method": "sr_resistance"}
      {"method": "swing_high"}
    """
    method = config.get("method", "r_multiple")

    if method == "r_multiple":
        r = float(config.get("r", 2.0))
        if stop_price is None:
            return None
        risk = abs(entry_price - stop_price)
        if direction == "long":
            return entry_price + r * risk
        else:
            return entry_price - r * risk

    if method == "fixed_pct":
        pct = float(config.get("value", 4.0)) / 100.0
        if direction == "long":
            return entry_price * (1.0 + pct)
        else:
            return entry_price * (1.0 - pct)

    if method == "fixed_dollar":
        dollar = float(config.get("value", 1000))
        if direction == "long":
            return entry_price + dollar
        else:
            return entry_price - dollar

    if method == "atr_multiple":
        period = int(config.get("period", 14))
        mult = float(config.get("mult", 3.0))
        if bar_index < period:
            return None
        atr_val = float(calc_atr(df["high"], df["low"], df["close"], period).iloc[bar_index])
        if direction == "long":
            return entry_price + mult * atr_val
        else:
            return entry_price - mult * atr_val

    if method == "sr_resistance":
        if sr_zones and direction == "long":
            resistances = [z for z in sr_zones if z.kind == "resistance" and z.midpoint > entry_price]
            if resistances:
                return min(resistances, key=lambda z: z.midpoint).midpoint
        if sr_zones and direction == "short":
            supports = [z for z in sr_zones if z.kind == "support" and z.midpoint < entry_price]
            if supports:
                return max(supports, key=lambda z: z.midpoint).midpoint
        # Fallback
        return calculate_target({"method": "r_multiple", "r": 2.0}, entry_price, stop_price, direction, bar, df, bar_index)

    if method == "swing_high":
        if direction == "long" and swing_highs:
            candidates = [sh for sh in swing_highs if sh.price > entry_price]
            if candidates:
                return float(min(candidates, key=lambda x: x.price).price)
        if direction == "short" and swing_lows:
            candidates = [sl for sl in swing_lows if sl.price < entry_price]
            if candidates:
                return float(max(candidates, key=lambda x: x.price).price)

    if method == "prev_day_high":
        # Look for pd_high column if precomputed
        val = bar.get("pd_high")
        if val is not None and not np.isnan(val):
            return float(val)
        # Fallback: yesterday's high from df
        if bar_index > 0:
            return float(df["high"].iloc[max(0, bar_index - 1)])
        return None

    return None


def update_trailing_stop(
    config: dict,
    current_stop: float,
    direction: str,
    bar: pd.Series,
    df: pd.DataFrame,
    bar_index: int,
    entry_price: float,
    initial_stop: float,
) -> float:
    """
    Update a trailing stop. Returns the new stop (never worse than current).

    Config:
      {"method": "atr_trail", "period": 14, "mult": 2.0}
      {"method": "pct_trail", "value": 1.5}
      {"method": "highest_close_n", "n": 10}
      {"method": "chandelier", "period": 22, "mult": 3.0}
    """
    method = config.get("method", "atr_trail")

    new_stop = current_stop

    if method == "atr_trail":
        period = int(config.get("period", 14))
        mult = float(config.get("mult", 2.0))
        if bar_index >= period:
            atr_val = float(calc_atr(df["high"], df["low"], df["close"], period).iloc[bar_index])
            if not np.isnan(atr_val):
                if direction == "long":
                    new_stop = bar["high"] - mult * atr_val
                else:
                    new_stop = bar["low"] + mult * atr_val

    elif method == "pct_trail":
        pct = float(config.get("value", 1.5)) / 100.0
        if direction == "long":
            new_stop = bar["high"] * (1.0 - pct)
        else:
            new_stop = bar["low"] * (1.0 + pct)

    elif method == "highest_close_n":
        n = int(config.get("n", 10))
        start = max(0, bar_index - n)
        pct = float(config.get("value", 1.5)) / 100.0
        if direction == "long":
            highest = df["close"].iloc[start:bar_index + 1].max()
            new_stop = highest * (1.0 - pct)
        else:
            lowest = df["close"].iloc[start:bar_index + 1].min()
            new_stop = lowest * (1.0 + pct)

    elif method == "chandelier":
        period = int(config.get("period", 22))
        mult = float(config.get("mult", 3.0))
        if bar_index >= period:
            window = df.iloc[bar_index - period:bar_index + 1]
            atr_val = float(calc_atr(df["high"], df["low"], df["close"], period).iloc[bar_index])
            if direction == "long":
                new_stop = float(window["high"].max()) - mult * atr_val
            else:
                new_stop = float(window["low"].min()) + mult * atr_val

    # Never make stop worse
    if direction == "long":
        return max(current_stop, new_stop)
    else:
        return min(current_stop, new_stop)
