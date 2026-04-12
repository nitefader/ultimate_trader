"""Tests for portfolio accounting and P&L math."""
import pytest
from app.core.portfolio import Portfolio


def test_open_long_position():
    p = Portfolio(initial_cash=100_000)
    pos = p.open_position("AAPL", "long", 100, 150.0, commission=0.5)
    assert pos.quantity == 100
    assert pos.avg_entry == 150.0
    assert p.cash == pytest.approx(100_000 - 100 * 150 - 0.5)
    assert p.num_open_positions == 1


def test_open_short_position():
    p = Portfolio(initial_cash=100_000)
    pos = p.open_position("AAPL", "short", 50, 200.0, commission=0.25)
    assert pos.direction == "short"
    assert pos.quantity == 50


def test_close_long_profit():
    p = Portfolio(initial_cash=100_000)
    pos = p.open_position("SPY", "long", 100, 400.0, commission=0.5)
    trade = p.close_position(pos, price=420.0, commission=0.5)
    # net_pnl includes both entry and exit commissions.
    assert trade["net_pnl"] == pytest.approx(100 * (420 - 400) - 1.0, abs=0.01)
    assert p.num_open_positions == 0


def test_close_long_loss():
    p = Portfolio(initial_cash=100_000)
    pos = p.open_position("SPY", "long", 100, 400.0, commission=0.5)
    trade = p.close_position(pos, price=390.0, commission=0.5)
    assert trade["net_pnl"] < 0


def test_unrealized_pnl():
    p = Portfolio(initial_cash=100_000)
    pos = p.open_position("SPY", "long", 100, 400.0)
    p.update_prices({"SPY": 410.0})
    assert p.unrealized_pnl == pytest.approx(100 * 10)


def test_equity_tracks_unrealized():
    p = Portfolio(initial_cash=100_000)
    pos = p.open_position("SPY", "long", 100, 400.0)
    p.update_prices({"SPY": 420.0})
    # equity = cash + market value for long positions (cost basis already deducted from cash)
    assert p.equity == pytest.approx(100_000 - 100 * 400 + 100 * 420)


def test_partial_close():
    p = Portfolio(initial_cash=100_000)
    pos = p.open_position("SPY", "long", 100, 400.0)
    p.close_position(pos, price=410.0, quantity=50, commission=0.25)
    # 50 shares remain
    assert pos.quantity == pytest.approx(50, abs=0.01)


def test_max_drawdown():
    p = Portfolio(initial_cash=100_000)
    # Build equity curve with a drawdown
    p.equity_curve = [
        {"date": "2024-01-01", "equity": 100_000, "cash": 100_000, "drawdown": 0.0, "regime": "unknown"},
        {"date": "2024-01-02", "equity": 110_000, "cash": 110_000, "drawdown": 0.0, "regime": "unknown"},
        {"date": "2024-01-03", "equity": 95_000, "cash": 95_000, "drawdown": 0.136, "regime": "unknown"},
    ]
    p._peak_equity = 110_000
    p.cash = 95_000  # align current equity with the last equity_curve point
    dd = p.current_drawdown
    assert dd == pytest.approx((110_000 - 95_000) / 110_000, abs=0.01)  # ~13.6% drawdown


def test_portfolio_heat():
    p = Portfolio(initial_cash=100_000)
    pos = p.open_position("SPY", "long", 100, 400.0, stop_price=390.0)
    # Risk = (400 - 390) * 100 = 1000; equity ≈ 100_000 - 40000 cost
    # heat = 1000 / equity
    heat = p.portfolio_heat
    assert heat > 0
    assert heat < 0.05  # should be small relative to equity


def test_add_to_position():
    p = Portfolio(initial_cash=100_000)
    pos = p.open_position("SPY", "long", 100, 400.0)
    p.add_to_position(pos, 100, 410.0)
    assert pos.quantity == 200
    assert pos.avg_entry == pytest.approx(405.0)
    assert pos.add_count == 1
