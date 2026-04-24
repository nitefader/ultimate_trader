"""Feature-aware cache facade over the current IndicatorCache."""
from __future__ import annotations

from app.cerebro.indicator_cache import IndicatorCache
from app.features.frame import FeatureFrame


class FeatureCache:
    """Compatibility facade while runtime storage remains backed by IndicatorCache."""

    def __init__(self, indicator_cache: IndicatorCache) -> None:
        self._indicator_cache = indicator_cache

    def get_feature_frame(self, symbol: str, timeframe: str) -> FeatureFrame | None:
        frame = self._indicator_cache.get(symbol, timeframe)
        if frame is None:
            return None
        return FeatureFrame.from_indicator_frame(frame)

    def get_feature_frame_by_identity(self, runtime_identity_key: str) -> FeatureFrame | None:
        frame = self._indicator_cache.get_by_runtime_identity(runtime_identity_key)
        if frame is None:
            return None
        return FeatureFrame.from_indicator_frame(frame)
