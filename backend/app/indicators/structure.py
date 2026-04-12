"""
Market structure detection:
- Swing highs / lows
- Break of structure (BOS)
- Higher high / higher low / lower high / lower low state
- Trend leg detection
- Market structure shift (MSS)
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import numpy as np
import pandas as pd


@dataclass
class SwingPoint:
    kind: Literal["high", "low"]
    price: float
    bar_index: int
    timestamp: datetime | str


@dataclass
class StructureState:
    bias: Literal["bullish", "bearish", "neutral"]
    last_hh: float | None = None   # last higher high
    last_hl: float | None = None   # last higher low
    last_lh: float | None = None   # last lower high
    last_ll: float | None = None   # last lower low
    bos_count_up: int = 0          # break-of-structure bull
    bos_count_down: int = 0        # break-of-structure bear
    swing_highs: list[SwingPoint] = None
    swing_lows: list[SwingPoint] = None

    def __post_init__(self):
        if self.swing_highs is None:
            self.swing_highs = []
        if self.swing_lows is None:
            self.swing_lows = []


def detect_swing_points(
    high: pd.Series,
    low: pd.Series,
    lookback: int = 3,
) -> tuple[list[SwingPoint], list[SwingPoint]]:
    """
    Detect swing highs and lows with a symmetric lookback on each side.
    Only complete (non-edge) swings are returned to avoid lookahead.

    NOTE: The last `lookback` bars will not have confirmed swings — this is by design.
    """
    swing_highs: list[SwingPoint] = []
    swing_lows: list[SwingPoint] = []

    h = high.values
    l = low.values
    idx = high.index

    for i in range(lookback, len(h) - lookback):
        window_h = h[i - lookback:i + lookback + 1]
        window_l = l[i - lookback:i + lookback + 1]

        if h[i] == max(window_h):
            swing_highs.append(SwingPoint("high", float(h[i]), i, idx[i]))
        if l[i] == min(window_l):
            swing_lows.append(SwingPoint("low", float(l[i]), i, idx[i]))

    return swing_highs, swing_lows


def classify_structure(
    swing_highs: list[SwingPoint],
    swing_lows: list[SwingPoint],
    close: float,
) -> StructureState:
    """
    Classify market structure using the last few swing points.
    Returns a StructureState with bias and HH/HL/LH/LL tracking.
    """
    state = StructureState(bias="neutral")
    state.swing_highs = swing_highs
    state.swing_lows = swing_lows

    if len(swing_highs) < 2 or len(swing_lows) < 2:
        return state

    recent_highs = sorted(swing_highs, key=lambda x: x.bar_index)[-4:]
    recent_lows = sorted(swing_lows, key=lambda x: x.bar_index)[-4:]

    # Check for HH (higher high)
    hh_count = sum(
        1 for i in range(1, len(recent_highs))
        if recent_highs[i].price > recent_highs[i - 1].price
    )
    # Check for HL (higher low)
    hl_count = sum(
        1 for i in range(1, len(recent_lows))
        if recent_lows[i].price > recent_lows[i - 1].price
    )
    # Check for LH (lower high)
    lh_count = sum(
        1 for i in range(1, len(recent_highs))
        if recent_highs[i].price < recent_highs[i - 1].price
    )
    # Check for LL (lower low)
    ll_count = sum(
        1 for i in range(1, len(recent_lows))
        if recent_lows[i].price < recent_lows[i - 1].price
    )

    bull_score = hh_count + hl_count
    bear_score = lh_count + ll_count

    if bull_score > bear_score:
        state.bias = "bullish"
        state.last_hh = recent_highs[-1].price if recent_highs else None
        state.last_hl = recent_lows[-1].price if recent_lows else None
    elif bear_score > bull_score:
        state.bias = "bearish"
        state.last_lh = recent_highs[-1].price if recent_highs else None
        state.last_ll = recent_lows[-1].price if recent_lows else None
    else:
        state.bias = "neutral"

    # Detect break of structure
    if swing_highs and close > swing_highs[-1].price:
        state.bos_count_up += 1
    if swing_lows and close < swing_lows[-1].price:
        state.bos_count_down += 1

    return state


def nearest_swing_high(swing_highs: list[SwingPoint], price: float, within_pct: float = 0.05) -> SwingPoint | None:
    candidates = [sh for sh in swing_highs if abs(sh.price - price) / price <= within_pct and sh.price > price]
    return min(candidates, key=lambda x: x.price) if candidates else None


def nearest_swing_low(swing_lows: list[SwingPoint], price: float, within_pct: float = 0.05) -> SwingPoint | None:
    candidates = [sl for sl in swing_lows if abs(sl.price - price) / price <= within_pct and sl.price < price]
    return max(candidates, key=lambda x: x.price) if candidates else None
