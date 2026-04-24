"""
RiskProfileGenerator — suggests RiskProfile parameters from backtest results or optimizer output.

Pure functions only — no DB access. Callers persist the result.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

logger = logging.getLogger(__name__)

_LONG_HEAT_CAP = 0.15
_SHORT_HEAT_CAP = 0.12
_LONG_HEAT_FLOOR = 0.03
_SHORT_HEAT_FLOOR = 0.02
_DAILY_LOSS_CAP = 0.08
_DAILY_LOSS_FLOOR = 0.01
_DD_CAP = 0.25
_DD_FLOOR = 0.05
_LEVERAGE_CAP = 4.0
_LEVERAGE_FLOOR = 1.0


def suggest_from_backtest(
    metrics: dict[str, Any],
    trades: list[dict[str, Any]],
    initial_capital: float = 100_000.0,
) -> dict[str, Any]:
    """
    Derive suggested RiskProfile fields from a completed backtest.

    Args:
        metrics: output of reporting.compute_full_metrics()
        trades: list of trade dicts with keys: direction, entry_price, quantity,
                net_pnl, initial_risk, entry_time, exit_time
        initial_capital: starting capital used in the backtest

    Returns:
        dict matching RiskProfileCreate schema (all values, no id/timestamps)
    """
    long_trades = [t for t in trades if str(t.get("direction", "")).lower() == "long"]
    short_trades = [t for t in trades if str(t.get("direction", "")).lower() == "short"]

    # ── Max open positions ────────────────────────────────────────────────────
    max_concurrent_long = _max_concurrent(long_trades) + 1
    max_concurrent_short = _max_concurrent(short_trades) + 1
    max_open_positions_long = max(3, max_concurrent_long)
    max_open_positions_short = max(2, max_concurrent_short)

    # ── Position size limits ──────────────────────────────────────────────────
    long_sizes = [
        abs(float(t.get("entry_price", 0)) * float(t.get("quantity", 0))) / initial_capital
        for t in long_trades if t.get("entry_price") and t.get("quantity")
    ]
    short_sizes = [
        abs(float(t.get("entry_price", 0)) * float(t.get("quantity", 0))) / initial_capital
        for t in short_trades if t.get("entry_price") and t.get("quantity")
    ]
    max_position_size_pct_long = min(0.25, _percentile(long_sizes, 95) * 1.25) if long_sizes else 0.10
    max_position_size_pct_short = min(0.20, _percentile(short_sizes, 95) * 1.25) if short_sizes else (max_position_size_pct_long * 0.75)

    # ── Portfolio heat ────────────────────────────────────────────────────────
    long_risks = [float(t.get("initial_risk", 0)) / initial_capital for t in long_trades if t.get("initial_risk")]
    short_risks = [float(t.get("initial_risk", 0)) / initial_capital for t in short_trades if t.get("initial_risk")]
    raw_long_heat = _median(long_risks) * 1.5 if long_risks else 0.06
    raw_short_heat = _median(short_risks) * 1.5 if short_risks else 0.04
    max_portfolio_heat_long = max(_LONG_HEAT_FLOOR, min(_LONG_HEAT_CAP, raw_long_heat))
    max_portfolio_heat_short = max(_SHORT_HEAT_FLOOR, min(_SHORT_HEAT_CAP, raw_short_heat))

    # ── Account-wide limits ───────────────────────────────────────────────────
    max_dd_pct = float(metrics.get("max_drawdown_pct", 10.0)) / 100.0
    max_drawdown_lockout_pct = max(_DD_FLOOR, min(_DD_CAP, max_dd_pct * 1.30))

    daily_pnls = _daily_pnl_by_date(trades)
    worst_day = min(daily_pnls.values()) if daily_pnls else 0.0
    raw_daily = abs(worst_day / initial_capital) * 1.25 if worst_day < 0 else max_dd_pct / 5
    max_daily_loss_pct = max(_DAILY_LOSS_FLOOR, min(_DAILY_LOSS_CAP, raw_daily))

    max_leverage = max(_LEVERAGE_FLOOR, min(_LEVERAGE_CAP,
                       round(max(max_position_size_pct_long, max_position_size_pct_short) * 4, 1)))

    return {
        "max_open_positions_long": max_open_positions_long,
        "max_open_positions_short": max_open_positions_short,
        "max_portfolio_heat_long": round(max_portfolio_heat_long, 4),
        "max_portfolio_heat_short": round(max_portfolio_heat_short, 4),
        "max_correlated_exposure_long": 1.0,
        "max_correlated_exposure_short": 0.80,
        "max_position_size_pct_long": round(max_position_size_pct_long, 4),
        "max_position_size_pct_short": round(max_position_size_pct_short, 4),
        "max_daily_loss_pct": round(max_daily_loss_pct, 4),
        "max_drawdown_lockout_pct": round(max_drawdown_lockout_pct, 4),
        "max_leverage": max_leverage,
        "source_type": "backtest",
    }


def suggest_from_optimization(output_weights: dict[str, float]) -> dict[str, Any]:
    """
    Derive suggested RiskProfile fields from optimizer output weights.

    Args:
        output_weights: symbol → weight (positive=long, negative=short)
    """
    long_weights = {s: w for s, w in output_weights.items() if w > 0}
    short_weights = {s: w for s, w in output_weights.items() if w < 0}

    long_vals = list(long_weights.values())
    short_vals = [abs(w) for w in short_weights.values()]

    max_open_positions_long = max(3, len(long_weights) + 2)
    max_open_positions_short = max(2, len(short_weights) + 1)
    max_position_size_pct_long = min(0.25, (max(long_vals) * 1.20) if long_vals else 0.10)
    max_position_size_pct_short = min(0.20, (max(short_vals) * 1.20) if short_vals else 0.08)
    max_corr_long = min(2.0, (sum(long_vals) * 1.10) if long_vals else 1.0)
    max_corr_short = min(1.5, (sum(short_vals) * 1.10) if short_vals else 0.80)
    total_exposure = sum(abs(w) for w in output_weights.values())
    max_leverage = max(_LEVERAGE_FLOOR, min(_LEVERAGE_CAP, round(total_exposure * 1.10, 1)))

    return {
        "max_open_positions_long": max_open_positions_long,
        "max_open_positions_short": max_open_positions_short,
        "max_portfolio_heat_long": 0.06,
        "max_portfolio_heat_short": 0.04,
        "max_correlated_exposure_long": round(max_corr_long, 4),
        "max_correlated_exposure_short": round(max_corr_short, 4),
        "max_position_size_pct_long": round(max_position_size_pct_long, 4),
        "max_position_size_pct_short": round(max_position_size_pct_short, 4),
        "max_daily_loss_pct": 0.03,
        "max_drawdown_lockout_pct": 0.10,
        "max_leverage": max_leverage,
        "source_type": "optimizer",
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _max_concurrent(trades: list[dict]) -> int:
    if not trades:
        return 0
    events: list[tuple[datetime, int]] = []
    for t in trades:
        try:
            entry = _parse_dt(t.get("entry_time"))
            exit_ = _parse_dt(t.get("exit_time"))
            if entry:
                events.append((entry, +1))
            if exit_:
                events.append((exit_, -1))
        except Exception:
            continue
    events.sort(key=lambda x: x[0])
    current = peak = 0
    for _, delta in events:
        current += delta
        peak = max(peak, current)
    return peak


def _daily_pnl_by_date(trades: list[dict]) -> dict[str, float]:
    by_date: dict[str, float] = {}
    for t in trades:
        pnl = t.get("net_pnl")
        exit_time = t.get("exit_time")
        if pnl is None or exit_time is None:
            continue
        try:
            dt = _parse_dt(exit_time)
            if dt:
                key = dt.strftime("%Y-%m-%d")
                by_date[key] = by_date.get(key, 0.0) + float(pnl)
        except Exception:
            continue
    return by_date


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


def _percentile(values: list[float], p: int) -> float:
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    idx = int(len(sorted_vals) * p / 100)
    idx = min(idx, len(sorted_vals) - 1)
    return sorted_vals[idx]


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    mid = len(sorted_vals) // 2
    if len(sorted_vals) % 2 == 0:
        return (sorted_vals[mid - 1] + sorted_vals[mid]) / 2.0
    return sorted_vals[mid]
