"""
Market regime classification engine.

Regimes: trending_up, trending_down, ranging, high_volatility, low_volatility
Strategies can filter entries by regime and adapt parameters per regime.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd

from app.indicators.technical import adx, atr, ema, sma

RegimeLabel = Literal[
    "trending_up",
    "trending_down",
    "ranging",
    "high_volatility",
    "low_volatility",
    "unknown",
]


@dataclass
class RegimeState:
    label: RegimeLabel
    adx_value: float | None = None
    atr_percentile: float | None = None  # ATR vs its own 252-bar distribution
    slope: float | None = None           # regression slope of price over N bars
    trend_strength: float | None = None  # 0–1


def classify_regime(
    df: pd.DataFrame,
    adx_period: int = 14,
    adx_trend_threshold: float = 25.0,
    atr_period: int = 14,
    vol_lookback: int = 63,     # ~3 months for vol percentile
    slope_period: int = 20,
    high_vol_percentile: float = 75.0,
    low_vol_percentile: float = 25.0,
) -> pd.Series:
    """
    Classify regime at each bar. Returns a Series of RegimeLabel strings.
    Uses only past data (shift(1) where needed).
    """
    high = df["high"]
    low = df["low"]
    close = df["close"]

    adx_df = adx(high, low, close, adx_period)
    atr_series = atr(high, low, close, atr_period)
    ema_fast = ema(close, 20)
    ema_slow = ema(close, 50)

    # ATR percentile (rolling)
    atr_pct = atr_series.rolling(vol_lookback).rank(pct=True) * 100

    # Linear slope of close over slope_period bars
    def slope_func(x: np.ndarray) -> float:
        if np.isnan(x).any():
            return np.nan
        n = len(x)
        x_idx = np.arange(n)
        coeffs = np.polyfit(x_idx, x, 1)
        return coeffs[0] / (x[-1] + 1e-9)  # normalised by price

    slope = close.rolling(slope_period).apply(slope_func, raw=True)

    adx_vals  = adx_df["adx"]
    plus_di   = adx_df["plus_di"]
    minus_di  = adx_df["minus_di"]

    has_data  = adx_vals.notna() & atr_pct.notna()

    is_high_vol  = has_data & (atr_pct >= high_vol_percentile)
    is_low_vol   = has_data & (atr_pct <= low_vol_percentile) & ~is_high_vol
    is_trending  = has_data & ~is_high_vol & ~is_low_vol & (adx_vals >= adx_trend_threshold)

    trend_up   = is_trending & (plus_di > minus_di) & ema_fast.notna() & (ema_fast > ema_slow)
    trend_down = is_trending & (minus_di > plus_di) & ema_fast.notna() & (ema_fast < ema_slow)
    ranging    = (has_data & ~is_high_vol & ~is_low_vol & ~trend_up & ~trend_down)

    labels = pd.Series("unknown", index=df.index, dtype=object)
    labels = np.where(ranging,       "ranging",         labels)
    labels = np.where(trend_down,    "trending_down",   labels)
    labels = np.where(trend_up,      "trending_up",     labels)
    labels = np.where(is_low_vol,    "low_volatility",  labels)
    labels = np.where(is_high_vol,   "high_volatility", labels)
    labels = np.where(~has_data,     "unknown",         labels)

    return pd.Series(labels, index=df.index, dtype=object)


def get_current_regime(df: pd.DataFrame, **kwargs) -> RegimeState:
    """Classify the regime for the most recent bar."""
    labels = classify_regime(df, **kwargs)
    last_label = labels.iloc[-1]
    adx_df = adx(df["high"], df["low"], df["close"])
    atr_series = atr(df["high"], df["low"], df["close"])

    return RegimeState(
        label=last_label,
        adx_value=float(adx_df["adx"].iloc[-1]) if not pd.isna(adx_df["adx"].iloc[-1]) else None,
        atr_percentile=float(atr_series.rolling(63).rank(pct=True).iloc[-1] * 100) if len(df) >= 63 else None,
    )
