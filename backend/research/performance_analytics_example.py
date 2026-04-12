# Performance Analytics & Risk-Adjusted Metrics Example

"""
This example demonstrates how to compute additional risk-adjusted metrics and performance analytics for a strategy.

import numpy as np
import pandas as pd

def compute_alpha_beta(returns: pd.Series, benchmark: pd.Series) -> dict:
    # Align series
    returns, benchmark = returns.align(benchmark, join="inner")
    excess = returns - benchmark
    beta = np.cov(returns, benchmark)[0, 1] / np.var(benchmark) if np.var(benchmark) > 0 else 0.0
    alpha = excess.mean() * 252
    return {"alpha": round(alpha, 4), "beta": round(beta, 4)}

def compute_attribution(trades: list[dict]) -> dict:
    # Simple attribution by direction
    long_pnl = sum(t["net_pnl"] for t in trades if t.get("direction") == "long")
    short_pnl = sum(t["net_pnl"] for t in trades if t.get("direction") == "short")
    return {"long_pnl": long_pnl, "short_pnl": short_pnl}

# Usage:
# returns = pd.Series([...])
# benchmark = pd.Series([...])
# alpha_beta = compute_alpha_beta(returns, benchmark)
# attribution = compute_attribution(trades)
# print(alpha_beta, attribution)
"""
