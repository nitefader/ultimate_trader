"""
Support and resistance zone engine.
Zones are derived from multiple sources and stored as structured objects.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import pandas as pd

from app.indicators.technical import pivot_points, sma


@dataclass
class SRZone:
    kind: Literal["support", "resistance"]
    price_low: float          # bottom of zone
    price_high: float         # top of zone
    strength: float           # touch count or score 0–1
    source: str               # pivot, swing, session, ma, consolidation
    first_touch: str | None = None
    last_touch: str | None = None
    touch_count: int = 1

    @property
    def midpoint(self) -> float:
        return (self.price_low + self.price_high) / 2

    def contains(self, price: float) -> bool:
        return self.price_low <= price <= self.price_high

    def is_nearby(self, price: float, tolerance_pct: float = 0.005) -> bool:
        return abs(self.midpoint - price) / price <= tolerance_pct


class SupportResistanceEngine:
    """
    Derives S/R zones from multiple sources and merges overlapping zones.
    """

    def __init__(self, zone_merge_pct: float = 0.002):
        self.zone_merge_pct = zone_merge_pct  # zones within this % are merged
        self.zones: list[SRZone] = []

    def compute(
        self,
        df: pd.DataFrame,
        swing_lookback: int = 3,
        pivot_period: int = 1,         # 1 = previous bar pivot
        include_ma: bool = True,
        ma_periods: list[int] | None = None,
    ) -> list[SRZone]:
        """Derive all S/R zones from the provided OHLCV DataFrame."""
        zones: list[SRZone] = []
        zones += self._pivot_zones(df)
        zones += self._swing_zones(df, swing_lookback)
        zones += self._session_zones(df)
        if include_ma:
            zones += self._ma_zones(df, ma_periods or [20, 50, 200])
        zones += self._consolidation_zones(df)

        self.zones = self._merge_zones(zones)
        return self.zones

    # ── Private helpers ────────────────────────────────────────────────────────

    def _pivot_zones(self, df: pd.DataFrame) -> list[SRZone]:
        pp_df = pivot_points(df["high"], df["low"], df["close"])
        zones = []
        tick = df["close"].mean() * 0.001  # 0.1% of average close as zone width

        for col, kind in [("r1", "resistance"), ("r2", "resistance"), ("r3", "resistance"),
                          ("s1", "support"), ("s2", "support"), ("s3", "support")]:
            last_val = pp_df[col].dropna().iloc[-1] if len(pp_df[col].dropna()) > 0 else None
            if last_val and last_val > 0:
                zones.append(SRZone(
                    kind=kind,
                    price_low=last_val - tick,
                    price_high=last_val + tick,
                    strength=0.6,
                    source=f"pivot_{col}",
                ))
        return zones

    def _swing_zones(self, df: pd.DataFrame, lookback: int) -> list[SRZone]:
        from app.indicators.structure import detect_swing_points
        sh_list, sl_list = detect_swing_points(df["high"], df["low"], lookback)
        tick = df["close"].mean() * 0.001
        zones = []

        # Count touches: how many swing highs cluster near the same level
        for sh in sh_list:
            zones.append(SRZone(
                kind="resistance",
                price_low=sh.price - tick,
                price_high=sh.price + tick,
                strength=0.5,
                source="swing_high",
                first_touch=str(sh.timestamp),
                last_touch=str(sh.timestamp),
            ))
        for sl in sl_list:
            zones.append(SRZone(
                kind="support",
                price_low=sl.price - tick,
                price_high=sl.price + tick,
                strength=0.5,
                source="swing_low",
                first_touch=str(sl.timestamp),
                last_touch=str(sl.timestamp),
            ))
        return zones

    def _session_zones(self, df: pd.DataFrame) -> list[SRZone]:
        """Previous day/week high and low as S/R zones."""
        if not isinstance(df.index, pd.DatetimeIndex):
            return []
        tick = df["close"].mean() * 0.001
        zones = []
        daily_hi = df["high"].resample("D").max().shift(1).reindex(df.index, method="ffill")
        daily_lo = df["low"].resample("D").min().shift(1).reindex(df.index, method="ffill")

        last_hi = daily_hi.dropna().iloc[-1] if len(daily_hi.dropna()) > 0 else None
        last_lo = daily_lo.dropna().iloc[-1] if len(daily_lo.dropna()) > 0 else None

        if last_hi:
            zones.append(SRZone(kind="resistance", price_low=last_hi - tick, price_high=last_hi + tick, strength=0.7, source="prev_day_high"))
        if last_lo:
            zones.append(SRZone(kind="support", price_low=last_lo - tick, price_high=last_lo + tick, strength=0.7, source="prev_day_low"))
        return zones

    def _ma_zones(self, df: pd.DataFrame, periods: list[int]) -> list[SRZone]:
        tick = df["close"].mean() * 0.001
        zones = []
        last_close = df["close"].iloc[-1]
        for p in periods:
            ma_val = sma(df["close"], p).iloc[-1]
            if pd.isna(ma_val):
                continue
            kind = "support" if ma_val < last_close else "resistance"
            zones.append(SRZone(
                kind=kind,
                price_low=ma_val - tick,
                price_high=ma_val + tick,
                strength=0.4 + (0.1 * (periods.index(p))),
                source=f"sma_{p}",
            ))
        return zones

    def _consolidation_zones(self, df: pd.DataFrame, window: int = 20) -> list[SRZone]:
        """Find price ranges where the market consolidated (low ATR relative to recent range)."""
        from app.indicators.technical import atr as calc_atr
        if len(df) < window * 2:
            return []
        atr_val = calc_atr(df["high"], df["low"], df["close"], 14)
        range_pct = (df["high"] - df["low"]) / df["close"]
        consol_mask = range_pct < range_pct.rolling(window).mean() * 0.5
        zones = []
        if consol_mask.any():
            consol_bars = df[consol_mask].tail(20)
            if len(consol_bars) > 3:
                zone_high = consol_bars["high"].max()
                zone_low = consol_bars["low"].min()
                zones.append(SRZone(
                    kind="support",
                    price_low=zone_low,
                    price_high=(zone_low + zone_high) / 2,
                    strength=0.6,
                    source="consolidation",
                ))
                zones.append(SRZone(
                    kind="resistance",
                    price_low=(zone_low + zone_high) / 2,
                    price_high=zone_high,
                    strength=0.6,
                    source="consolidation",
                ))
        return zones

    def _merge_zones(self, zones: list[SRZone]) -> list[SRZone]:
        """Merge overlapping zones of the same kind (single pass), boosting strength."""
        if not zones:
            return []
        all_merged: list[SRZone] = []
        for kind in ("support", "resistance"):
            bucket = sorted(
                [z for z in zones if z.kind == kind],
                key=lambda z: z.midpoint,
            )
            if not bucket:
                continue
            merged: list[SRZone] = []
            i = 0
            while i < len(bucket):
                base = bucket[i]
                j = i + 1
                ref = max(base.midpoint, 1e-9)
                while j < len(bucket) and abs(bucket[j].midpoint - ref) / ref <= self.zone_merge_pct:
                    base.price_low  = min(base.price_low,  bucket[j].price_low)
                    base.price_high = max(base.price_high, bucket[j].price_high)
                    base.touch_count += 1
                    base.strength = min(base.strength + 0.1, 1.0)
                    j += 1
                merged.append(base)
                i = j
            all_merged.extend(merged)
        return all_merged

    def get_nearest_support(self, price: float) -> SRZone | None:
        candidates = [z for z in self.zones if z.kind == "support" and z.midpoint < price]
        return max(candidates, key=lambda z: z.midpoint) if candidates else None

    def get_nearest_resistance(self, price: float) -> SRZone | None:
        candidates = [z for z in self.zones if z.kind == "resistance" and z.midpoint > price]
        return min(candidates, key=lambda z: z.midpoint) if candidates else None

    def confluence_score(self, price: float, tolerance_pct: float = 0.005) -> float:
        """How many zones are near this price? Returns normalised score 0–1."""
        nearby = [z for z in self.zones if z.is_nearby(price, tolerance_pct)]
        return min(len(nearby) * 0.2, 1.0)
