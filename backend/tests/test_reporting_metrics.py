from __future__ import annotations

from app.services.reporting import compute_full_metrics


def test_avg_win_loss_pct_uses_trade_return_pct_values():
    trades = [
        {"net_pnl": 100.0, "return_pct": 2.0, "direction": "long"},
        {"net_pnl": -50.0, "return_pct": -1.0, "direction": "long"},
        {"net_pnl": 200.0, "return_pct": 4.0, "direction": "short"},
    ]
    equity_curve = [
        {"date": "2026-01-01", "equity": 100000.0, "cash": 100000.0, "drawdown": 0.0, "regime": "unknown"},
        {"date": "2026-01-02", "equity": 100200.0, "cash": 100200.0, "drawdown": 0.0, "regime": "unknown"},
        {"date": "2026-01-03", "equity": 100250.0, "cash": 100250.0, "drawdown": 0.0, "regime": "unknown"},
    ]

    metrics = compute_full_metrics(trades, equity_curve, initial_capital=100000.0, timeframe="1d")

    # winners: 2.0%, 4.0% -> avg 3.0
    assert metrics["avg_win_pct"] == 3.0
    # losers: -1.0% -> abs avg 1.0
    assert metrics["avg_loss_pct"] == 1.0


def test_no_trades_flag_present_when_no_trades():
    metrics = compute_full_metrics(
        trades=[],
        equity_curve=[
            {"date": "2026-01-01", "equity": 100000.0, "cash": 100000.0, "drawdown": 0.0, "regime": "unknown"},
            {"date": "2026-01-02", "equity": 100000.0, "cash": 100000.0, "drawdown": 0.0, "regime": "unknown"},
        ],
        initial_capital=100000.0,
        timeframe="1d",
    )

    assert metrics["no_trades"] is True
