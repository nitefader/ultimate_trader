from __future__ import annotations

from app.cerebro.registry import CerebroRegistry, IndicatorRequirement, ProgramDemand
from app.features.keys import make_feature_key
from app.features.specs import FeatureSpec


def test_make_feature_key_is_deterministic_for_param_order() -> None:
    left = FeatureSpec(kind="ema", timeframe="5m", source="close", params={"length": 20, "smoothing": "ema"})
    right = FeatureSpec(kind="ema", timeframe="5m", source="close", params={"smoothing": "ema", "length": 20})

    assert make_feature_key(left) == make_feature_key(right)


def test_registry_dedupes_equivalent_feature_specs_by_canonical_key() -> None:
    registry = CerebroRegistry()
    registry.register_program(
        "program-a",
        ProgramDemand(
            program_id="program-a",
            account_id="acct-1",
            symbols={"AAPL"},
            timeframes={"5m"},
            indicators=[IndicatorRequirement(name="ema", params={"length": 20, "smoothing": "ema"})],
            duration_mode="day",
        ),
    )
    registry.register_program(
        "program-b",
        ProgramDemand(
            program_id="program-b",
            account_id="acct-1",
            symbols={"AAPL"},
            timeframes={"5m"},
            indicators=[IndicatorRequirement(name="ema", params={"smoothing": "ema", "length": 20})],
            duration_mode="day",
        ),
    )

    demand = registry.get_demand("AAPL", "5m")
    assert demand is not None
    assert len(demand.required_feature_keys) == 1
    assert demand.programs_demanding == {"program-a", "program-b"}


def test_registry_keeps_distinct_feature_keys_for_same_indicator_with_different_params() -> None:
    registry = CerebroRegistry()
    registry.register_program(
        "program-a",
        ProgramDemand(
            program_id="program-a",
            account_id="acct-1",
            symbols={"AAPL"},
            timeframes={"5m"},
            indicators=[
                IndicatorRequirement(name="ema", params={"length": 10}),
                IndicatorRequirement(name="ema", params={"length": 20}),
            ],
            duration_mode="day",
        ),
    )

    demand = registry.get_demand("AAPL", "5m")
    assert demand is not None
    assert len(demand.required_feature_keys) == 2
    assert sorted(indicator.params["length"] for indicator in demand.required_indicators) == [10, 20]


def test_registry_exposes_program_feature_specs_per_timeframe() -> None:
    registry = CerebroRegistry()
    registry.register_program(
        "program-a",
        ProgramDemand(
            program_id="program-a",
            account_id="acct-1",
            symbols={"AAPL"},
            timeframes={"5m", "1d"},
            indicators=[IndicatorRequirement(name="rsi", params={"length": 14}, source="close")],
            duration_mode="swing",
        ),
    )

    specs = registry.get_program_feature_specs("program-a")

    assert {(spec.kind, spec.timeframe, spec.source) for spec in specs} == {
        ("rsi", "1d", "close"),
        ("rsi", "5m", "close"),
    }


def test_registry_exposes_program_feature_plan() -> None:
    registry = CerebroRegistry()
    registry.register_program(
        "program-a",
        ProgramDemand(
            program_id="program-a",
            account_id="acct-1",
            symbols={"AAPL"},
            timeframes={"5m"},
            indicators=[IndicatorRequirement(name="ema", params={"length": 21})],
            duration_mode="day",
        ),
    )

    plan = registry.get_program_feature_plan("program-a")

    assert plan is not None
    assert plan.program_id == "program-a"
    assert plan.timeframes == ("5m",)
    assert len(plan.feature_keys) == 1
