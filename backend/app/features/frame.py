"""Feature-aware runtime frame adapter."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import pandas as pd

from app.cerebro.indicator_cache import IndicatorFrame
from app.features.source_contracts import FrameProvenance


@dataclass(frozen=True)
class FeatureFrame:
    symbol: str
    timeframe: str
    bars: pd.DataFrame
    indicators: pd.DataFrame
    last_bar_time: datetime
    last_computed: datetime
    bar_count: int
    is_warm: bool
    provenance: FrameProvenance | None
    feature_keys: tuple[str, ...] = ()
    feature_columns: dict[str, tuple[str, ...]] = field(default_factory=dict)
    runtime_identity_key: str = ""

    @classmethod
    def from_indicator_frame(cls, frame: IndicatorFrame) -> "FeatureFrame":
        return cls(
            symbol=frame.symbol,
            timeframe=frame.timeframe,
            bars=frame.bars,
            indicators=frame.indicators,
            last_bar_time=frame.last_bar_time,
            last_computed=frame.last_computed,
            bar_count=frame.bar_count,
            is_warm=frame.is_warm,
            provenance=frame.provenance,
            feature_keys=frame.feature_keys,
            feature_columns=dict(frame.feature_columns),
            runtime_identity_key=frame.runtime_identity_key,
        )
