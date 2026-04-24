from __future__ import annotations

from app.features.catalog import feature_spec_from_ref, is_supported_feature_ref, normalize_feature_ref_kind


def test_normalize_feature_ref_kind_handles_parameterized_refs() -> None:
    assert normalize_feature_ref_kind("ema_21") == "ema"
    assert normalize_feature_ref_kind("rsi_14") == "rsi"
    assert normalize_feature_ref_kind("prev_day_high") == "prev_day_high"


def test_is_supported_feature_ref_accepts_parameterized_and_exact_names() -> None:
    supported = {"ema", "rsi", "prev_day_high", "volume_sma", "zscore"}

    assert is_supported_feature_ref("ema_21", supported) is True
    assert is_supported_feature_ref("prev_day_high", supported) is True
    assert is_supported_feature_ref("volume_sma_20", supported) is True
    assert is_supported_feature_ref("unknown_thing", supported) is False


def test_feature_spec_from_ref_preserves_timeframe_and_params() -> None:
    spec = feature_spec_from_ref("ema_21", timeframe="5m")
    assert spec.kind == "ema"
    assert spec.timeframe == "5m"
    assert spec.params == {"length": 21}

    exact = feature_spec_from_ref("prev_week_high", timeframe="1d")
    assert exact.kind == "prev_week_high"
    assert exact.params == {}

    session_state = feature_spec_from_ref("market_day_type", timeframe="5m")
    assert session_state.kind == "market_day_type"
