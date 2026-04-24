"""Deterministic feature-key construction."""
from __future__ import annotations

import json
from typing import Any, Mapping

from app.features.specs import FeatureSpec


def normalize_feature_params(params: Mapping[str, Any] | None) -> dict[str, Any]:
    def _normalize(value: Any) -> Any:
        if isinstance(value, Mapping):
            return {str(key): _normalize(value[key]) for key in sorted(value)}
        if isinstance(value, (list, tuple)):
            return [_normalize(item) for item in value]
        return value

    return _normalize(dict(params or {}))


def make_feature_key(spec: FeatureSpec) -> str:
    payload = {
        "kind": spec.kind.strip().lower(),
        "timeframe": spec.timeframe.strip().lower(),
        "source": spec.source.strip().lower(),
        "params": normalize_feature_params(spec.params),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def make_runtime_identity_key(symbol: str, timeframe: str, feature_keys: tuple[str, ...] | list[str] | set[str]) -> str:
    payload = {
        "symbol": symbol.strip().upper(),
        "timeframe": timeframe.strip().lower(),
        "feature_keys": sorted(feature_keys),
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
