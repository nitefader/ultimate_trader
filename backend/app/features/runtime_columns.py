"""Compatibility mapping from canonical feature specs to runtime indicator columns."""
from __future__ import annotations

from app.features.specs import FeatureSpec


def _int_param(spec: FeatureSpec, *keys: str, default: int | None = None) -> int | None:
    for key in keys:
        value = spec.params.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
    return default


def resolve_runtime_columns(spec: FeatureSpec) -> tuple[str, ...]:
    kind = spec.kind.strip().lower()

    if kind in {"ema", "sma", "rsi", "atr", "zscore", "hull_ma"}:
        period = _int_param(spec, "length", "period", "window", default=14 if kind in {"rsi", "atr"} else None)
        return (f"{kind}_{period}",) if period is not None else (kind,)

    if kind in {"macd", "macd_signal", "macd_hist"}:
        return (kind,)
    if kind == "bollinger":
        return ("bb_upper", "bb_mid", "bb_lower", "bb_width")
    if kind in {"bb_upper", "bb_mid", "bb_lower", "bb_width"}:
        return (kind,)
    if kind == "stochastic":
        return ("stoch_k", "stoch_d")
    if kind in {"stoch_k", "stoch_d"}:
        return (kind,)
    if kind == "pivot_points":
        return ("pp", "r1", "r2", "r3", "s1", "s2", "s3")
    if kind in {"pp", "r1", "r2", "r3", "s1", "s2", "s3"}:
        return (kind,)
    if kind in {
        "adx", "plus_di", "minus_di", "vwap", "open_gap_pct", "opening_range_high", "opening_range_low",
        "prev_day_high", "prev_day_low", "prev_day_close", "prev_week_high", "prev_week_low", "prev_week_close",
        "prev_month_high", "prev_month_low", "prev_month_close",
        "market_day_type", "in_regular_session", "earnings_blackout_active",
        "swing_high", "swing_low", "ibs", "bt_snipe", "strat_dir", "strat_num", "donchian_high", "donchian_low",
        "sar", "sar_trend", "volume_sma_20",
    }:
        return (kind,)
    return (kind,)
