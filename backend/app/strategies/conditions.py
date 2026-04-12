"""
Condition evaluation engine.

Conditions are defined as JSON/dict structures and evaluated against a bar context.
Supports:
  - Simple conditions (indicator comparison)
  - all_of / any_of / n_of_m composition
  - Weighted and N-of-M logic
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd


@dataclass
class EvalContext:
    """Everything available to a condition at eval time."""

    bar: pd.Series
    bar_index: int
    df: pd.DataFrame
    position_size: float = 0.0
    open_pnl: float = 0.0
    account_equity: float = 100_000.0
    regime: str = "unknown"
    fvgs: list = None
    sr_zones: list = None
    swing_highs: list = None
    swing_lows: list = None
    extra: dict[str, Any] = None

    def __post_init__(self):
        self.fvgs = self.fvgs or []
        self.sr_zones = self.sr_zones or []
        self.swing_highs = self.swing_highs or []
        self.swing_lows = self.swing_lows or []
        self.extra = self.extra or {}


def _apply_numeric_modifiers(value: float | str | bool, spec: dict[str, Any]) -> float | str | bool:
    if not isinstance(value, (int, float, np.floating)):
        return value

    numeric_value = float(value)
    if "mult" in spec:
        numeric_value *= float(spec["mult"])
    if "div" in spec:
        divisor = float(spec["div"])
        numeric_value = numeric_value / divisor if divisor else np.nan
    if "add" in spec:
        numeric_value += float(spec["add"])
    if "offset" in spec:
        numeric_value += float(spec["offset"])
    if spec.get("abs"):
        numeric_value = abs(numeric_value)
    return numeric_value


def _resolve_value(spec: Any, ctx: EvalContext) -> float | str | bool:
    """
    Resolve a value spec to a concrete value.

    A spec can be:
    - A literal number/string
    - {"field": "close"}           -> bar["close"]
    - {"indicator": "rsi_14"}      -> bar["rsi_14"] (must be precomputed)
    - {"prev_bar": "high"}         -> previous bar's high
    - {"n_bars_back": N, "field": "low"}
    - {"account": "equity"}
    - {"regime": True}             -> current regime label
    """
    if not isinstance(spec, dict):
        return spec

    value: float | str | bool = np.nan

    if "field" in spec:
        value = float(ctx.bar.get(spec["field"], np.nan))
    elif "indicator" in spec:
        value = float(ctx.bar.get(spec["indicator"], np.nan))
    elif "prev_bar" in spec:
        n = spec.get("n", 1)
        target_idx = ctx.bar_index - n
        if target_idx >= 0:
            value = float(ctx.df.iloc[target_idx].get(spec["prev_bar"], np.nan))
    elif "n_bars_back" in spec:
        n = spec["n_bars_back"]
        field = spec["field"]
        target_idx = ctx.bar_index - n
        if target_idx >= 0:
            value = float(ctx.df.iloc[target_idx].get(field, np.nan))
    elif "account" in spec:
        mapping = {
            "equity": ctx.account_equity,
            "open_pnl": ctx.open_pnl,
            "position_size": ctx.position_size,
        }
        value = float(mapping.get(spec["account"], np.nan))
    elif "regime" in spec:
        value = ctx.regime
    elif "nearest_sr_support" in spec:
        if ctx.sr_zones:
            below = [z for z in ctx.sr_zones if z.kind == "support" and z.midpoint < ctx.bar["close"]]
            value = max((z.midpoint for z in below), default=np.nan)
    elif "nearest_sr_resistance" in spec:
        if ctx.sr_zones:
            above = [z for z in ctx.sr_zones if z.kind == "resistance" and z.midpoint > ctx.bar["close"]]
            value = min((z.midpoint for z in above), default=np.nan)
    elif "nearest_fvg_low" in spec:
        direction = spec.get("direction", "bullish")
        for fvg in ctx.fvgs:
            if fvg.direction == direction and not fvg.filled:
                value = fvg.low
                break
    elif "nearest_fvg_high" in spec:
        direction = spec.get("direction", "bullish")
        for fvg in ctx.fvgs:
            if fvg.direction == direction and not fvg.filled:
                value = fvg.high
                break

    return _apply_numeric_modifiers(value, spec)


COMPARATORS = {
    ">": lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    "crosses_above": None,
    "crosses_below": None,
    "between": lambda a, b: b[0] <= a <= b[1],
    "in": lambda a, b: a in b,
}


def eval_single_condition(cond: dict[str, Any], ctx: EvalContext) -> bool:
    """
    Evaluate a single condition dict of the form:
      {
        "left":  {"field": "close"},
        "op":    ">",
        "right": {"indicator": "sma_20"}
      }
    """
    left_val = _resolve_value(cond["left"], ctx)
    right_val = _resolve_value(cond["right"], ctx)
    op = cond["op"]

    if isinstance(left_val, float) and np.isnan(left_val):
        return False
    if isinstance(right_val, float) and np.isnan(right_val):
        return False

    if op == "crosses_above":
        if ctx.bar_index < 1:
            return False
        prev_ctx = EvalContext(
            bar=ctx.df.iloc[ctx.bar_index - 1],
            bar_index=ctx.bar_index - 1,
            df=ctx.df,
        )
        prev_left = _resolve_value(cond["left"], prev_ctx)
        prev_right = _resolve_value(cond["right"], prev_ctx)
        return bool(prev_left <= prev_right and left_val > right_val)

    if op == "crosses_below":
        if ctx.bar_index < 1:
            return False
        prev_ctx = EvalContext(
            bar=ctx.df.iloc[ctx.bar_index - 1],
            bar_index=ctx.bar_index - 1,
            df=ctx.df,
        )
        prev_left = _resolve_value(cond["left"], prev_ctx)
        prev_right = _resolve_value(cond["right"], prev_ctx)
        return bool(prev_left >= prev_right and left_val < right_val)

    comparator = COMPARATORS.get(op)
    if comparator is None:
        raise ValueError(f"Unknown operator: {op}")

    return bool(comparator(left_val, right_val))


def evaluate_condition_group(group: dict[str, Any], ctx: EvalContext) -> bool:
    """
    Evaluate a condition group.

    Supported types:
      - {"type": "single", ...}
      - {"type": "all_of", "conditions": [...]}
      - {"type": "any_of", "conditions": [...]}
      - {"type": "n_of_m", "n": 4, "conditions": [...]}
      - {"type": "regime_filter", "allowed": ["trending_up", "ranging"]}
    """
    gtype = group.get("type", "single")

    if gtype == "single":
        return eval_single_condition(group, ctx)

    if gtype == "all_of":
        return all(evaluate_condition_group(c, ctx) for c in group["conditions"])

    if gtype == "any_of":
        return any(evaluate_condition_group(c, ctx) for c in group["conditions"])

    if gtype == "n_of_m":
        n = group["n"]
        results = [evaluate_condition_group(c, ctx) for c in group["conditions"]]
        return sum(results) >= n

    if gtype == "regime_filter":
        allowed = group.get("allowed", [])
        return ctx.regime in allowed

    if gtype == "not":
        return not evaluate_condition_group(group["condition"], ctx)

    raise ValueError(f"Unknown condition group type: {gtype}")


def evaluate_conditions(conditions: list[dict[str, Any]], ctx: EvalContext, logic: str = "all_of") -> bool:
    """Evaluate a list of conditions with a top-level logic operator."""
    if not conditions:
        return False
    if logic == "all_of":
        return all(evaluate_condition_group(c, ctx) for c in conditions)
    if logic == "any_of":
        return any(evaluate_condition_group(c, ctx) for c in conditions)
    if logic.startswith("n_of_m:"):
        n = int(logic.split(":")[1])
        return sum(evaluate_condition_group(c, ctx) for c in conditions) >= n
    return False
