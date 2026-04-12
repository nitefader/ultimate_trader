"""
Position sizing engine.

All methods return quantity (shares/contracts) given entry configuration.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.indicators.technical import atr as calc_atr


def calculate_position_size(
    config: dict,
    entry_price: float,
    stop_price: float | None,
    account_equity: float,
    direction: str,
    df: pd.DataFrame,
    bar_index: int,
    leverage: float = 1.0,
) -> float:
    """
    Unified position size calculation.

    Methods:
      {"method": "fixed_shares", "shares": 100}
      {"method": "fixed_dollar", "amount": 10000}
      {"method": "fixed_pct_equity", "pct": 10.0}
      {"method": "risk_pct", "risk_pct": 1.0}           # risk 1% of equity
      {"method": "atr_risk", "atr_period": 14, "atr_mult": 1.0, "risk_pct": 1.0}
      {"method": "kelly", "win_rate": 0.55, "avg_win": 2.0, "avg_loss": 1.0}
    """
    method = config.get("method", "risk_pct")

    if not np.isfinite(entry_price) or entry_price <= 0:
        return 0.0
    if not np.isfinite(account_equity) or account_equity <= 0:
        return 0.0
    if not np.isfinite(leverage) or leverage <= 0:
        leverage = 1.0

    def _clamp_shares(shares: float) -> float:
        if not np.isfinite(shares) or shares <= 0:
            return 0.0
        return float(shares)

    if method == "fixed_shares":
        return _clamp_shares(float(config.get("shares", 100)))

    if method == "fixed_dollar":
        amount = float(config.get("amount", 10_000))
        amount_levered = amount * leverage
        return _clamp_shares(amount_levered / entry_price)

    if method == "fixed_pct_equity":
        pct = float(config.get("pct", 10.0)) / 100.0
        pct = min(max(pct, 0.0), 1.0)
        dollar_allocation = account_equity * pct * leverage
        return _clamp_shares(dollar_allocation / entry_price)

    if method == "risk_pct":
        risk_pct = float(config.get("risk_pct", 1.0)) / 100.0
        risk_pct = min(max(risk_pct, 0.0), 1.0)
        if stop_price is None or entry_price <= 0:
            return 0.0
        risk_per_share = abs(entry_price - stop_price)
        if risk_per_share <= 0:
            return 0.0
        dollar_risk = account_equity * risk_pct
        shares = dollar_risk / risk_per_share
        max_by_equity = (account_equity * leverage) / entry_price
        return _clamp_shares(min(shares, max_by_equity))

    if method == "atr_risk":
        period = int(config.get("atr_period", 14))
        mult = float(config.get("atr_mult", 1.0))
        risk_pct = float(config.get("risk_pct", 1.0)) / 100.0
        risk_pct = min(max(risk_pct, 0.0), 1.0)
        if bar_index < period:
            return 0.0
        atr_val = float(calc_atr(df["high"], df["low"], df["close"], period).iloc[bar_index])
        if np.isnan(atr_val) or atr_val <= 0:
            return 0.0
        risk_per_share = atr_val * mult
        dollar_risk = account_equity * risk_pct
        shares = dollar_risk / risk_per_share
        max_by_equity = (account_equity * leverage) / entry_price
        return _clamp_shares(min(shares, max_by_equity))

    if method == "kelly":
        win_rate = float(config.get("win_rate", 0.5))
        avg_win = float(config.get("avg_win", 2.0))
        avg_loss = float(config.get("avg_loss", 1.0))
        if avg_loss <= 0:
            return 0.0
        b = avg_win / avg_loss
        kelly_fraction = max(0.0, (b * win_rate - (1 - win_rate)) / b)
        # Half-Kelly for safety
        kelly_fraction = min(kelly_fraction * 0.5, 0.25)
        dollar_allocation = account_equity * kelly_fraction * leverage
        return _clamp_shares(dollar_allocation / entry_price)

    if method == "rolling_kelly":
        return _rolling_kelly(config, entry_price, account_equity, leverage)

    return 0.0


def _rolling_kelly(
    config: dict,
    entry_price: float,
    account_equity: float,
    leverage: float,
    closed_trades: list[dict] | None = None,
) -> float:
    """
    Adaptive Kelly fraction computed from the last N closed trades.

    Falls back to static Kelly parameters if insufficient trade history.

    Config keys:
      lookback        int   (default 30)  — how many recent closed trades to use
      min_trades      int   (default 10)  — minimum trades before switching from fallback
      fallback_pct    float (default 2.0) — fixed_pct_equity fallback fraction (%)
      max_fraction    float (default 0.25) — caps half-Kelly at this fraction of equity
    """
    lookback = int(config.get("lookback", 30))
    min_trades = int(config.get("min_trades", 10))
    fallback_pct = float(config.get("fallback_pct", 2.0)) / 100.0
    max_fraction = float(config.get("max_fraction", 0.25))

    trades = (closed_trades or [])[-lookback:]

    if len(trades) < min_trades:
        # Not enough history — use fixed fallback
        dollar_alloc = account_equity * fallback_pct * leverage
        return max(0.0, dollar_alloc / entry_price) if entry_price > 0 else 0.0

    wins = [t for t in trades if (t.get("net_pnl") or t.get("pnl") or 0) > 0]
    losses = [t for t in trades if (t.get("net_pnl") or t.get("pnl") or 0) <= 0]

    win_rate = len(wins) / len(trades)
    if win_rate <= 0:
        return 0.0

    avg_win_r = float(np.mean([t.get("r_multiple") or (t.get("net_pnl", 0) / max(abs(t.get("initial_risk", 1)), 1e-9)) for t in wins])) if wins else 2.0
    avg_loss_r = float(np.mean([abs(t.get("r_multiple") or (t.get("net_pnl", 0) / max(abs(t.get("initial_risk", 1)), 1e-9))) for t in losses])) if losses else 1.0

    if avg_loss_r <= 0:
        return 0.0

    b = avg_win_r / avg_loss_r
    kelly_fraction = max(0.0, (b * win_rate - (1 - win_rate)) / b)
    # Half-Kelly cap
    kelly_fraction = min(kelly_fraction * 0.5, max_fraction)

    dollar_alloc = account_equity * kelly_fraction * leverage
    return max(0.0, dollar_alloc / entry_price) if entry_price > 0 else 0.0


def scale_quantity(
    total_quantity: float,
    scale_config: list[dict],
    level: int,
) -> float:
    """
    Return quantity for a specific scale level.

    scale_config example:
      [
        {"level": 1, "pct": 50},    # 50% of position at first entry
        {"level": 2, "pct": 30},
        {"level": 3, "pct": 20},
      ]
    """
    if level < 0 or level >= len(scale_config):
        return 0.0
    entry = scale_config[level]
    pct = float(entry.get("pct", 100)) / 100.0
    return total_quantity * pct
