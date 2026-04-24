"""Feature-reference parsing helpers shared by authoring and runtime layers."""
from __future__ import annotations

import re
from typing import Any

from app.features.specs import FeatureSpec

_PARAMETERIZED_REF_PATTERNS: tuple[tuple[re.Pattern[str], str, str], ...] = (
    (re.compile(r"^ema_(\d+)$"), "ema", "length"),
    (re.compile(r"^sma_(\d+)$"), "sma", "length"),
    (re.compile(r"^rsi_(\d+)$"), "rsi", "length"),
    (re.compile(r"^atr_(\d+)$"), "atr", "length"),
    (re.compile(r"^zscore_(\d+)$"), "zscore", "window"),
    (re.compile(r"^hull_ma_(\d+)$"), "hull_ma", "length"),
    (re.compile(r"^volume_sma_(\d+)$"), "volume_sma", "length"),
)


def normalize_feature_ref_kind(ref: str) -> str:
    normalized = ref.strip().lower()
    for pattern, base_kind, _param_name in _PARAMETERIZED_REF_PATTERNS:
        if pattern.fullmatch(normalized):
            return base_kind
    return normalized


def is_supported_feature_ref(ref: str, supported_kinds: set[str]) -> bool:
    normalized = ref.strip().lower()
    if normalized in supported_kinds:
        return True
    return normalize_feature_ref_kind(normalized) in supported_kinds


def feature_spec_from_ref(ref: str, timeframe: str, source: str = "close") -> FeatureSpec:
    normalized = ref.strip().lower()
    for pattern, base_kind, param_name in _PARAMETERIZED_REF_PATTERNS:
        match = pattern.fullmatch(normalized)
        if match:
            return FeatureSpec(
                kind=base_kind,
                timeframe=timeframe,
                source=source,
                params={param_name: int(match.group(1))},
            )
    return FeatureSpec(kind=normalized, timeframe=timeframe, source=source)


def feature_spec_from_value_spec(spec: dict[str, Any], timeframe: str, default_source: str = "close") -> FeatureSpec | None:
    indicator_ref = spec.get("indicator")
    if not indicator_ref:
        return None

    canonical = feature_spec_from_ref(
        str(indicator_ref),
        timeframe=timeframe,
        source=str(spec.get("source", default_source)),
    )
    extra_params = {
        str(key): value
        for key, value in spec.items()
        if key not in {"indicator", "source", "n_bars_back"}
        and isinstance(value, (str, int, float, bool))
    }
    if not extra_params:
        return canonical

    merged_params = dict(canonical.params)
    merged_params.update(extra_params)
    return FeatureSpec(
        kind=canonical.kind,
        timeframe=canonical.timeframe,
        source=canonical.source,
        params=merged_params,
    )
