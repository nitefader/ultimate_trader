from __future__ import annotations

from app.cerebro.registry import IndicatorRequirement, ProgramDemand
from app.features.planner import build_feature_plan


def test_build_feature_plan_is_deterministic_and_deduped() -> None:
    demand = ProgramDemand(
        program_id="program-a",
        account_id="acct-1",
        symbols={"MSFT", "AAPL"},
        timeframes={"1d", "5m"},
        indicators=[
            IndicatorRequirement(name="ema", params={"length": 20, "smoothing": "ema"}),
            IndicatorRequirement(name="ema", params={"smoothing": "ema", "length": 20}),
            IndicatorRequirement(name="rsi", params={"length": 14}),
        ],
        duration_mode="day",
    )

    plan_a = build_feature_plan(demand)
    plan_b = build_feature_plan(demand)

    assert plan_a == plan_b
    assert len(plan_a.feature_specs) == 4
    assert plan_a.symbols == ("AAPL", "MSFT")
    assert plan_a.timeframes == ("1d", "5m")


def test_build_feature_plan_infers_warmup_bars_per_timeframe() -> None:
    demand = ProgramDemand(
        program_id="program-a",
        account_id="acct-1",
        symbols={"AAPL"},
        timeframes={"5m"},
        indicators=[
            IndicatorRequirement(name="ema", params={"length": 20}),
            IndicatorRequirement(name="macd", params={"fast": 12, "slow": 26, "signal": 9}),
        ],
        duration_mode="day",
    )

    plan = build_feature_plan(demand)

    assert plan.warmup_bars_by_timeframe["5m"] == 78
