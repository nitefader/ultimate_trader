from __future__ import annotations

from app.features.preview import build_feature_plan_preview


def test_build_feature_plan_preview_collects_canonical_features() -> None:
    preview = build_feature_plan_preview(
        {
            "timeframe": "5m",
            "symbols": ["aapl"],
            "entry": {
                "conditions": [
                    {"type": "single", "left": {"indicator": "ema_21"}, "op": ">", "right": {"indicator": "prev_month_high"}},
                    {"type": "single", "left": {"indicator": "market_day_type"}, "op": "==", "right": "regular"},
                ],
            },
        },
        duration_mode="day",
    )

    assert preview["symbols"] == ["AAPL"]
    assert preview["timeframes"] == ["5m"]
    kinds = {feature["kind"] for feature in preview["features"]}
    assert {"ema", "prev_month_high", "market_day_type"} <= kinds
    ema_feature = next(feature for feature in preview["features"] if feature["kind"] == "ema")
    assert ema_feature["params"] == {"length": 21}
    assert ema_feature["runtime_columns"] == ["ema_21"]


def test_build_feature_plan_preview_preserves_explicit_indicator_params() -> None:
    preview = build_feature_plan_preview(
        {
            "timeframe": "5m",
            "entry": {
                "conditions": [
                    {
                        "type": "single",
                        "left": {"field": "close"},
                        "op": ">",
                        "right": {"indicator": "ema", "period": 20},
                    }
                ],
            },
        },
        duration_mode="day",
    )

    assert len(preview["feature_keys"]) == 1
    assert '"kind":"ema"' in preview["feature_keys"][0]
    assert '"period":20' in preview["feature_keys"][0]
    ema_feature = preview["features"][0]
    assert ema_feature["params"] == {"period": 20}
    assert ema_feature["runtime_columns"] == ["ema_20"]
