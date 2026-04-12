"""
Fair Value Gap (FVG) detection and management.

A bullish FVG occurs when:
  bar[i-1].high < bar[i+1].low  (gap up — imbalance on the way up)

A bearish FVG occurs when:
  bar[i-1].low > bar[i+1].high  (gap down — imbalance on the way down)

In practice (to avoid lookahead) we detect on bar i+1 (the third bar is the confirming bar).
We record the gap as [low_of_gap, high_of_gap].
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

import pandas as pd


@dataclass
class FairValueGap:
    direction: Literal["bullish", "bearish"]
    high: float         # top of the gap
    low: float          # bottom of the gap
    midpoint: float
    detected_at: datetime | str
    source_bar_idx: int   # index of the middle bar (bar i)
    size: float           # gap size in price units
    filled: bool = False
    fill_time: datetime | str | None = None
    fill_price: float | None = None
    fresh: bool = True    # goes stale after N bars

    @property
    def quality_score(self) -> float:
        """Larger gaps score higher; normalised 0–1 (relative to recent ATR if provided)."""
        return min(self.size / 10.0, 1.0)  # basic heuristic


def detect_fvgs(
    df: pd.DataFrame,
    min_gap_pct: float = 0.001,     # minimum gap as fraction of close
    freshness_bars: int = 50,
) -> list[FairValueGap]:
    """
    Detect all FVGs in a OHLCV DataFrame (columns: open, high, low, close, volume).
    Returns a list of FairValueGap objects sorted by detection time.

    Parameters
    ----------
    df            : OHLCV DataFrame with DatetimeIndex
    min_gap_pct   : minimum gap size as fraction of close at detection
    freshness_bars: number of bars before a gap is considered stale
    """
    gaps: list[FairValueGap] = []
    highs = df["high"].values
    lows = df["low"].values
    closes = df["close"].values
    idx = df.index

    for i in range(1, len(df) - 1):
        # Bullish FVG: gap[i-1].high < gap[i+1].low
        gap_low = highs[i - 1]
        gap_high = lows[i + 1]
        if gap_high > gap_low:
            gap_size = gap_high - gap_low
            if gap_size / closes[i] >= min_gap_pct:
                gaps.append(FairValueGap(
                    direction="bullish",
                    high=gap_high,
                    low=gap_low,
                    midpoint=(gap_high + gap_low) / 2,
                    detected_at=idx[i + 1],
                    source_bar_idx=i,
                    size=gap_size,
                ))

        # Bearish FVG: gap[i-1].low > gap[i+1].high
        gap_low2 = highs[i + 1]
        gap_high2 = lows[i - 1]
        if gap_high2 > gap_low2:
            gap_size = gap_high2 - gap_low2
            if gap_size / closes[i] >= min_gap_pct:
                gaps.append(FairValueGap(
                    direction="bearish",
                    high=gap_high2,
                    low=gap_low2,
                    midpoint=(gap_high2 + gap_low2) / 2,
                    detected_at=idx[i + 1],
                    source_bar_idx=i,
                    size=gap_size,
                ))

    return gaps


def update_fvg_state(gaps: list[FairValueGap], current_bar: pd.Series, current_idx: int) -> None:
    """
    Update each gap's filled/fresh state based on the current price bar.
    Modifies in-place.
    """
    current_close = current_bar["close"]
    for gap in gaps:
        if gap.filled:
            continue
        age = current_idx - gap.source_bar_idx
        if age > 50:  # default freshness
            gap.fresh = False

        if gap.direction == "bullish":
            # Filled when price trades down into the gap
            if current_bar["low"] <= gap.high:
                gap.filled = True
                gap.fill_price = max(current_bar["low"], gap.low)
                gap.fill_time = current_bar.name
        else:
            # Bearish gap filled when price trades up into it
            if current_bar["high"] >= gap.low:
                gap.filled = True
                gap.fill_price = min(current_bar["high"], gap.high)
                gap.fill_time = current_bar.name


def get_nearest_fvg(
    gaps: list[FairValueGap],
    price: float,
    direction: Literal["bullish", "bearish"],
    only_fresh: bool = True,
) -> FairValueGap | None:
    """Return the nearest unfilled FVG of the given direction to price."""
    candidates = [
        g for g in gaps
        if g.direction == direction and not g.filled and (g.fresh or not only_fresh)
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda g: abs(g.midpoint - price))
