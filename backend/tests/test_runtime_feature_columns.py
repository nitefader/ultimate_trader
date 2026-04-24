from __future__ import annotations

import pandas as pd
import pytest

from app.cerebro.indicator_cache import IndicatorCache
from app.features.keys import make_feature_key, make_runtime_identity_key
from app.features.specs import FeatureSpec


@pytest.mark.asyncio
async def test_indicator_cache_annotates_runtime_columns_for_feature_specs() -> None:
    cache = IndicatorCache()
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

    await cache.warm_up("AAPL", "1d", bars)
    frame = cache.annotate_feature_specs(
        "AAPL",
        "1d",
        [
            FeatureSpec(kind="ema", timeframe="1d", params={"length": 20}),
            FeatureSpec(kind="macd", timeframe="1d"),
            FeatureSpec(kind="prev_day_high", timeframe="1d"),
            FeatureSpec(kind="prev_month_high", timeframe="1d"),
            FeatureSpec(kind="market_day_type", timeframe="1d"),
        ],
    )

    assert frame is not None
    assert "ema_20" in frame.indicators.columns
    assert "macd" in frame.indicators.columns
    assert frame.feature_columns[make_feature_key(FeatureSpec(kind="ema", timeframe="1d", params={"length": 20}))] == ("ema_20",)
    assert frame.feature_columns[make_feature_key(FeatureSpec(kind="macd", timeframe="1d"))] == ("macd",)
    assert frame.feature_columns[make_feature_key(FeatureSpec(kind="prev_day_high", timeframe="1d"))] == ("prev_day_high",)
    assert frame.feature_columns[make_feature_key(FeatureSpec(kind="prev_month_high", timeframe="1d"))] == ("prev_month_high",)
    assert frame.feature_columns[make_feature_key(FeatureSpec(kind="market_day_type", timeframe="1d"))] == ("market_day_type",)
    assert frame.runtime_identity_key == make_runtime_identity_key("AAPL", "1d", frame.feature_keys)


@pytest.mark.asyncio
async def test_runtime_identity_key_changes_when_feature_demand_changes() -> None:
    cache = IndicatorCache()
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

    await cache.warm_up("AAPL", "1d", bars)
    frame_one = cache.annotate_feature_specs(
        "AAPL",
        "1d",
        [FeatureSpec(kind="ema", timeframe="1d", params={"length": 20})],
    )
    assert frame_one is not None
    first_identity = frame_one.runtime_identity_key

    frame_two = cache.annotate_feature_specs(
        "AAPL",
        "1d",
        [FeatureSpec(kind="ema", timeframe="1d", params={"length": 50})],
    )
    assert frame_two is not None
    assert "ema_50" in frame_two.indicators.columns
    assert frame_two.runtime_identity_key != first_identity
