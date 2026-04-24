"""Deterministic feature-plan construction for programs."""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.features.keys import make_feature_key
from app.features.specs import FeatureSpec

if TYPE_CHECKING:
    from app.cerebro.registry import ProgramDemand

_WARMUP_PARAM_KEYS = ("length", "period", "window", "slow", "fast", "signal", "lookback")


@dataclass(frozen=True)
class FeaturePlan:
    program_id: str
    account_id: str
    symbols: tuple[str, ...]
    timeframes: tuple[str, ...]
    feature_specs: tuple[FeatureSpec, ...]
    feature_keys: tuple[str, ...]
    warmup_bars_by_timeframe: dict[str, int]


def estimate_feature_warmup_bars(spec: FeatureSpec) -> int:
    numeric_values: list[int] = []
    for key in _WARMUP_PARAM_KEYS:
        value = spec.params.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            numeric_values.append(value)
        elif isinstance(value, float) and value.is_integer():
            numeric_values.append(int(value))
    if not numeric_values:
        return 50
    return max(max(numeric_values) * 3, 50)


def build_feature_plan(demand: ProgramDemand) -> FeaturePlan:
    specs_by_key: dict[str, FeatureSpec] = {}
    warmup_bars_by_timeframe: dict[str, int] = {}

    for timeframe in sorted(demand.timeframes):
        for indicator in demand.indicators:
            spec = indicator.to_feature_spec(timeframe)
            feature_key = make_feature_key(spec)
            specs_by_key[feature_key] = spec
            warmup_bars_by_timeframe[timeframe] = max(
                warmup_bars_by_timeframe.get(timeframe, 0),
                estimate_feature_warmup_bars(spec),
            )

    ordered_keys = tuple(sorted(specs_by_key))
    ordered_specs = tuple(specs_by_key[key] for key in ordered_keys)
    return FeaturePlan(
        program_id=demand.program_id,
        account_id=demand.account_id,
        symbols=tuple(sorted(demand.symbols)),
        timeframes=tuple(sorted(demand.timeframes)),
        feature_specs=ordered_specs,
        feature_keys=ordered_keys,
        warmup_bars_by_timeframe=warmup_bars_by_timeframe,
    )
