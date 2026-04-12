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

    labels = pd.Series("unknown", index=df.index, dtype=object)

    for i in range(len(df)):
        adx_val = adx_df["adx"].iloc[i]
        plus_di = adx_df["plus_di"].iloc[i]
        minus_di = adx_df["minus_di"].iloc[i]
        atr_p = atr_pct.iloc[i]
        sl = slope.iloc[i]
        ef = ema_fast.iloc[i]
        es = ema_slow.iloc[i]

        if pd.isna(adx_val) or pd.isna(atr_p):
            labels.iloc[i] = "unknown"
            continue

        # High / low volatility overrides trend classification
        if atr_p >= high_vol_percentile:
            labels.iloc[i] = "high_volatility"
        elif atr_p <= low_vol_percentile:
            labels.iloc[i] = "low_volatility"
        elif adx_val >= adx_trend_threshold:
            if plus_di > minus_di and not pd.isna(ef) and ef > es:
                labels.iloc[i] = "trending_up"
            elif minus_di > plus_di and not pd.isna(ef) and ef < es:
                labels.iloc[i] = "trending_down"
            else:
                labels.iloc[i] = "ranging"
        else:
            labels.iloc[i] = "ranging"

    return labels


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
