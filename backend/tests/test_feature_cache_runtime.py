from __future__ import annotations

import pandas as pd
import pytest

from app.cerebro.indicator_cache import IndicatorCache
from app.features.cache import FeatureCache
from app.features.specs import FeatureSpec


@pytest.mark.asyncio
async def test_feature_cache_returns_feature_frame_with_runtime_identity() -> None:
    indicator_cache = IndicatorCache()
    bars = pd.DataFrame(
        [
            {
                "open": 100 + idx,
                "high": 101 + idx,
                "low": 99 + idx,
                "close": 100.5 + idx,
                "volume": 1000 + idx,
            }
            for idx in range(80)
        ],
        index=pd.date_range("2024-01-01", periods=80, freq="D"),
    )

    await indicator_cache.warm_up("AAPL", "1d", bars)
    indicator_cache.annotate_feature_specs(
        "AAPL",
        "1d",
        [FeatureSpec(kind="ema", timeframe="1d", params={"length": 20})],
    )

    cache = FeatureCache(indicator_cache)
    frame = cache.get_feature_frame("AAPL", "1d")

    assert frame is not None
    assert frame.runtime_identity_key
    assert frame.feature_keys
    assert frame.feature_columns
    same_frame = cache.get_feature_frame_by_identity(frame.runtime_identity_key)
    assert same_frame is not None
    assert same_frame.runtime_identity_key == frame.runtime_identity_key


@pytest.mark.asyncio
async def test_feature_cache_identity_lookup_tracks_runtime_demand_changes() -> None:
    indicator_cache = IndicatorCache()
    bars = pd.DataFrame(
        [
            {
                "open": 100 + idx,
                "high": 101 + idx,
                "low": 99 + idx,
                "close": 100.5 + idx,
                "volume": 1000 + idx,
            }
            for idx in range(80)
        ],
        index=pd.date_range("2024-01-01", periods=80, freq="D"),
    )

    await indicator_cache.warm_up("AAPL", "1d", bars)
    indicator_cache.annotate_feature_specs(
        "AAPL",
        "1d",
        [FeatureSpec(kind="ema", timeframe="1d", params={"length": 20})],
    )

    cache = FeatureCache(indicator_cache)
    first_frame = cache.get_feature_frame("AAPL", "1d")
    assert first_frame is not None

    indicator_cache.annotate_feature_specs(
        "AAPL",
        "1d",
        [
            FeatureSpec(kind="ema", timeframe="1d", params={"length": 20}),
            FeatureSpec(kind="prev_day_high", timeframe="1d"),
        ],
    )

    second_frame = cache.get_feature_frame("AAPL", "1d")
    assert second_frame is not None
    assert second_frame.runtime_identity_key != first_frame.runtime_identity_key
    assert cache.get_feature_frame_by_identity(first_frame.runtime_identity_key) is None
    assert cache.get_feature_frame_by_identity(second_frame.runtime_identity_key) is not None


@pytest.mark.asyncio
async def test_runtime_identity_survives_live_bar_update() -> None:
    indicator_cache = IndicatorCache()
    bars = pd.DataFrame(
        [
            {
                "open": 100 + idx,
                "high": 101 + idx,
                "low": 99 + idx,
                "close": 100.5 + idx,
                "volume": 1000 + idx,
            }
            for idx in range(80)
        ],
        index=pd.date_range("2024-01-01", periods=80, freq="D"),
    )

    await indicator_cache.warm_up("AAPL", "1d", bars)
    indicator_cache.annotate_feature_specs(
        "AAPL",
        "1d",
        [
            FeatureSpec(kind="ema", timeframe="1d", params={"length": 20}),
            FeatureSpec(kind="prev_day_high", timeframe="1d"),
        ],
    )

    cache = FeatureCache(indicator_cache)
    original = cache.get_feature_frame("AAPL", "1d")
    assert original is not None

    await indicator_cache.update(
        "AAPL",
        "1d",
        {
            "timestamp": pd.Timestamp("2024-03-21T00:00:00Z"),
            "open": 181.0,
            "high": 182.0,
            "low": 180.0,
            "close": 181.5,
            "volume": 1400.0,
        },
    )

    updated = cache.get_feature_frame("AAPL", "1d")
    assert updated is not None
    assert updated.runtime_identity_key == original.runtime_identity_key
    assert updated.feature_keys == original.feature_keys
    assert cache.get_feature_frame_by_identity(original.runtime_identity_key) is not None
