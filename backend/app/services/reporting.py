"""
Performance reporting — computes all metrics from trades and equity curve.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd


def compute_full_metrics(
    trades: list[dict],
    equity_curve: list[dict],
    initial_capital: float,
    timeframe: str = "1d",
) -> dict[str, Any]:
    """Compute the full set of performance metrics."""
    if not equity_curve:
        return {"error": "No equity curve data"}

    eq_df = pd.DataFrame(equity_curve)
    bars_per_year_map = {
        "1m": 252 * 390,
        "5m": 252 * 78,
        "15m": 252 * 26,
        "30m": 252 * 13,
        "1h": 252 * 7,
        "2h": 252 * 4,
        "4h": 252 * 2,
        "1d": 252,
        "1wk": 52,
        "1mo": 12,
    }
    bars_per_year = bars_per_year_map.get(str(timeframe).lower(), 252)

    equity_series = eq_df["equity"]
    drawdown_series = eq_df["drawdown"]

    # ── Return metrics ─────────────────────────────────────────────────────────
    final_equity = float(equity_series.iloc[-1])
    total_return = (final_equity - initial_capital) / initial_capital
    total_return_pct = total_return * 100

    # CAGR
    n_bars = len(equity_series)
    if n_bars > 1 and "date" in eq_df.columns:
        try:
            start_date = pd.to_datetime(eq_df["date"].iloc[0])
            end_date = pd.to_datetime(eq_df["date"].iloc[-1])
            years = max((end_date - start_date).days / 365.25, 1 / 365.25)
            cagr = ((final_equity / initial_capital) ** (1 / years) - 1) * 100
        except Exception:
            cagr = total_return_pct
    else:
        cagr = total_return_pct

    # ── Drawdown ───────────────────────────────────────────────────────────────
    max_drawdown = float(drawdown_series.max()) * 100

    # Drawdown duration
    in_drawdown = drawdown_series > 0
    if in_drawdown.any():
        runs = (in_drawdown != in_drawdown.shift()).cumsum()
        dd_lengths = in_drawdown.groupby(runs).sum()
        max_dd_duration = int(dd_lengths.max())
    else:
        max_dd_duration = 0

    # ── Sharpe / Sortino / Calmar ──────────────────────────────────────────────
    returns = equity_series.pct_change().dropna()
    mean_ret = float(returns.mean())
    std_ret = float(returns.std())
    risk_free = 0.0  # assume 0 for simplicity

    sharpe = (mean_ret - risk_free) / std_ret * math.sqrt(bars_per_year) if std_ret > 0 else 0.0

    downside = returns[returns < 0]
    sortino_std = float(downside.std()) if len(downside) > 0 else std_ret
    sortino = (mean_ret - risk_free) / sortino_std * math.sqrt(bars_per_year) if sortino_std > 0 else 0.0

    calmar = (cagr / 100) / (max_drawdown / 100) if max_drawdown > 0 else 0.0

    recovery_factor = total_return / (max_drawdown / 100) if max_drawdown > 0 else 0.0

    # ── Trade stats ────────────────────────────────────────────────────────────
    if trades:
        # Only include closed trades with a committed net_pnl.
        # Trades with net_pnl=None are open or incomplete — treating them as 0
        # would inflate trade count and deflate win rate / profit factor.
        closed_trades = [t for t in trades if t.get("net_pnl") is not None]
        trade_pnls = [float(t["net_pnl"]) for t in closed_trades]
        winners = [p for p in trade_pnls if p > 0]
        losers = [p for p in trade_pnls if p < 0]

        total_trades = len(trade_pnls)
        win_count = len(winners)
        loss_count = len(losers)
        win_rate = win_count / total_trades * 100 if total_trades > 0 else 0.0

        avg_win = float(np.mean(winners)) if winners else 0.0
        avg_loss = float(np.mean(losers)) if losers else 0.0

        def _trade_return_pct(trade: dict) -> float | None:
            rp = trade.get("return_pct")
            if rp is not None:
                return float(rp)
            qty = float(trade.get("quantity") or 0)
            entry_price = float(trade.get("entry_price") or 0)
            net_pnl = trade.get("net_pnl")
            cost_basis = qty * entry_price
            if net_pnl is None or cost_basis <= 0:
                return None
            return float(net_pnl) / cost_basis * 100.0

        winner_return_pcts = [
            r for t in closed_trades if float(t["net_pnl"]) > 0 for r in [_trade_return_pct(t)] if r is not None
        ]
        loser_return_pcts = [
            r for t in closed_trades if float(t["net_pnl"]) < 0 for r in [_trade_return_pct(t)] if r is not None
        ]
        avg_win_pct = float(np.mean(winner_return_pcts)) if winner_return_pcts else 0.0
        avg_loss_pct = abs(float(np.mean(loser_return_pcts))) if loser_return_pcts else 0.0

        # Expectancy is dollar-denominated (avg_win + avg_loss are both $ P&L).
        # avg_win is positive, avg_loss is negative. Formula: E = W%*avg_win + L%*avg_loss.
        expectancy = (win_rate / 100 * avg_win) + ((1 - win_rate / 100) * avg_loss)

        gross_profit = sum(winners)
        gross_loss = abs(sum(losers))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")

        # Hold durations
        hold_durations = []
        for t in closed_trades:
            et = t.get("entry_time")
            xt = t.get("exit_time")
            if et and xt:
                try:
                    delta = (pd.Timestamp(xt) - pd.Timestamp(et)).total_seconds() / 86400
                    hold_durations.append(delta)
                except Exception:
                    pass
        avg_hold = float(np.mean(hold_durations)) if hold_durations else 0.0

        long_trades = sum(1 for t in closed_trades if t.get("direction") == "long")
        short_trades = sum(1 for t in closed_trades if t.get("direction") == "short")

        # Exit reason breakdown
        exit_reasons: dict[str, int] = {}
        for t in closed_trades:
            r = t.get("exit_reason", "unknown")
            exit_reasons[r] = exit_reasons.get(r, 0) + 1

        # Regime breakdown — P&L attribution by regime at entry
        regime_pnl: dict[str, float] = {}
        for t in closed_trades:
            r = t.get("regime_at_entry", "unknown") or "unknown"
            regime_pnl[r] = regime_pnl.get(r, 0.0) + float(t["net_pnl"])

        # SQN (System Quality Number) — Van Tharp's metric
        # Uses R-multiples when available, falls back to dollar P&L as a proxy.
        r_values = [float(t["r_multiple"]) for t in closed_trades if t.get("r_multiple") is not None]
        if len(r_values) >= 2:
            sqn_r_arr = np.array(r_values)
            sqn_std = float(np.std(sqn_r_arr, ddof=1))
            sqn = float(np.sqrt(len(r_values)) * np.mean(sqn_r_arr) / sqn_std) if sqn_std > 0 else 0.0
        elif len(trade_pnls) >= 2:
            # Fallback: normalise dollar P&L by initial capital to get pseudo-R
            pnl_arr = np.array(trade_pnls) / initial_capital * 100.0
            sqn_std = float(np.std(pnl_arr, ddof=1))
            sqn = float(np.sqrt(len(pnl_arr)) * np.mean(pnl_arr) / sqn_std) if sqn_std > 0 else 0.0
        else:
            sqn = 0.0

    else:
        total_trades = win_count = loss_count = 0
        win_rate = avg_win = avg_loss = avg_win_pct = avg_loss_pct = 0.0
        expectancy = profit_factor = avg_hold = long_trades = short_trades = 0
        exit_reasons = {}
        regime_pnl = {}
        sqn = 0.0

    # no_trades: True if there were no closed trades with confirmed P&L
    no_trades = len(trades) == 0 or (trades and all(t.get("net_pnl") is None for t in trades))

    # ── Monthly returns ────────────────────────────────────────────────────────
    monthly_returns: dict[str, float] = {}
    if "date" in eq_df.columns:
        try:
            eq_df["date"] = pd.to_datetime(eq_df["date"])
            eq_df = eq_df.set_index("date")
            monthly = eq_df["equity"].resample("ME").last()
            monthly_pct = monthly.pct_change(fill_method=None).dropna() * 100
            for ts, val in monthly_pct.items():
                monthly_returns[ts.strftime("%Y-%m")] = round(float(val), 2)
        except Exception:
            pass

    # ── Monte Carlo ────────────────────────────────────────────────────────────
    monte_carlo = _monte_carlo(trade_pnls if trades else [], initial_capital, n_sims=500) if trades else {}

    return {
        # Returns
        "total_return_pct": round(total_return_pct, 2),
        "cagr_pct": round(cagr, 2),
        "final_equity": round(final_equity, 2),
        # Risk-adjusted
        "sharpe_ratio": round(sharpe, 3),
        "sortino_ratio": round(sortino, 3),
        "calmar_ratio": round(calmar, 3),
        "sqn": round(sqn, 3),
        # Drawdown
        "max_drawdown_pct": round(max_drawdown, 2),
        "max_drawdown_duration_days": max_dd_duration,
        "recovery_factor": round(recovery_factor, 2),
        # Trade stats
        "total_trades": total_trades,
        "winning_trades": win_count,
        "losing_trades": loss_count,
        "win_rate_pct": round(win_rate, 1),
        "avg_win_pct": round(avg_win_pct, 2),
        "avg_loss_pct": round(avg_loss_pct, 2),
        "expectancy": round(expectancy, 2),
        "profit_factor": round(profit_factor, 2) if profit_factor != float("inf") else 999.0,
        # Exposure
        "avg_hold_days": round(avg_hold, 2),
        "long_trades": long_trades,
        "short_trades": short_trades,
        # Breakdowns
        "exit_reason_breakdown": exit_reasons,
        "regime_breakdown": {k: round(v, 2) for k, v in regime_pnl.items()},
        "monthly_returns": monthly_returns,
        "monte_carlo": monte_carlo,
        "no_trades": no_trades,
    }


def _monte_carlo(trade_pnls: list[float], initial_capital: float, n_sims: int = 500) -> dict:
    """Simple Monte Carlo: randomly resample trade sequence N times."""
    if len(trade_pnls) < 5:
        return {}

    pnl_arr = np.array(trade_pnls)
    final_equities = []
    max_drawdowns = []

    rng = np.random.default_rng(42)
    for _ in range(n_sims):
        shuffled = rng.choice(pnl_arr, size=len(pnl_arr), replace=True)
        equity = initial_capital + np.cumsum(shuffled)
        final_equities.append(float(equity[-1]))
        peak = np.maximum.accumulate(equity)
        dd = ((peak - equity) / peak).max()
        max_drawdowns.append(float(dd))

    fe = np.array(final_equities)
    md = np.array(max_drawdowns)

    return {
        "median_return_pct": round(float(np.median(fe) / initial_capital - 1) * 100, 2),
        "p5_return_pct": round(float(np.percentile(fe, 5) / initial_capital - 1) * 100, 2),
        "p95_return_pct": round(float(np.percentile(fe, 95) / initial_capital - 1) * 100, 2),
        "median_max_drawdown_pct": round(float(np.median(md)) * 100, 2),
        "p95_max_drawdown_pct": round(float(np.percentile(md, 95)) * 100, 2),
        "probability_profitable": round(float((fe > initial_capital).mean()) * 100, 1),
    }
