"""Feature-plan preview helpers shared by authoring and execution-adjacent flows."""
from __future__ import annotations

from typing import Any

from app.cerebro.registry import IndicatorRequirement, ProgramDemand
from app.features.catalog import feature_spec_from_value_spec
from app.features.keys import make_feature_key
from app.features.planner import FeaturePlan, build_feature_plan
from app.features.runtime_columns import resolve_runtime_columns


def collect_feature_specs_from_config(config: dict[str, Any], timeframe: str) -> list[Any]:
    specs_by_key: dict[str, Any] = {}

    def _check_value_spec(spec: Any) -> None:
        if not isinstance(spec, dict):
            return
        canonical = feature_spec_from_value_spec(spec, timeframe=timeframe, default_source="close")
        if canonical is None:
            return
        specs_by_key[make_feature_key(canonical)] = canonical

    def _walk_condition(cond: Any) -> None:
        if not isinstance(cond, dict):
            return
        _check_value_spec(cond.get("left"))
        _check_value_spec(cond.get("right"))
        for sub in cond.get("conditions", []):
            _walk_condition(sub)
        if cond.get("condition"):
            _walk_condition(cond["condition"])

    entry = config.get("entry", {})
    for cond in entry.get("conditions", []):
        _walk_condition(cond)
    for cond in entry.get("short_conditions", []):
        _walk_condition(cond)

    scale_in = config.get("scale_in") or {}
    for cond in scale_in.get("conditions", []):
        _walk_condition(cond)

    return [specs_by_key[key] for key in sorted(specs_by_key)]


def build_feature_plan_preview(
    config: dict[str, Any],
    *,
    duration_mode: str | None,
    symbols: list[str] | None = None,
    timeframe: str | None = None,
) -> dict[str, Any]:
    resolved_timeframe = str(timeframe or config.get("timeframe") or "1d").strip().lower()
    feature_specs = collect_feature_specs_from_config(config, resolved_timeframe)
    resolved_symbols = [
        str(symbol).strip().upper()
        for symbol in (symbols if symbols is not None else config.get("symbols", []))
        if str(symbol).strip()
    ]
    demand = ProgramDemand(
        program_id="preview",
        account_id="preview",
        symbols=set(resolved_symbols),
        timeframes={resolved_timeframe},
        indicators=[
            IndicatorRequirement(
                name=spec.kind,
                params=dict(spec.params),
                source=spec.source,
            )
            for spec in feature_specs
        ],
        duration_mode=duration_mode or "swing",
    )
    plan: FeaturePlan = build_feature_plan(demand)
    return {
        "symbols": list(plan.symbols),
        "timeframes": list(plan.timeframes),
        "feature_keys": list(plan.feature_keys),
        "warmup_bars_by_timeframe": plan.warmup_bars_by_timeframe,
        "features": [
            {
                "kind": spec.kind,
                "timeframe": spec.timeframe,
                "source": spec.source,
                "params": dict(spec.params),
                "runtime_columns": list(resolve_runtime_columns(spec)),
            }
            for spec in plan.feature_specs
        ],
    }
