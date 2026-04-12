"""Tests for risk engine."""
import pytest
from app.core.risk import RiskEngine, RiskConfig
from app.core.portfolio import Portfolio


def make_risk(max_pos_pct=0.10, max_daily_loss_pct=0.03, max_dd=0.10, max_positions=10):
    cfg = RiskConfig(
        max_position_size_pct=max_pos_pct,
        max_daily_loss_pct=max_daily_loss_pct,
        max_drawdown_lockout_pct=max_dd,
        max_open_positions=max_positions,
    )
    return RiskEngine(cfg)


def test_basic_approval():
    risk = make_risk()
    portfolio = Portfolio(100_000)
    approved, reason = risk.check_entry("SPY", "long", 10, 100.0, 95.0, portfolio)
    assert approved is True


def test_kill_switch_blocks_entry():
    risk = make_risk()
    portfolio = Portfolio(100_000)
    risk.kill("test")
    approved, reason = risk.check_entry("SPY", "long", 10, 100.0, 95.0, portfolio)
    assert approved is False
    assert "Kill switch" in reason


def test_max_positions_blocks():
    risk = make_risk(max_positions=2)
    portfolio = Portfolio(100_000)
    # Open 2 positions
    portfolio.open_position("SPY", "long", 10, 100.0)
    portfolio.open_position("QQQ", "long", 10, 100.0)
    approved, reason = risk.check_entry("AAPL", "long", 10, 100.0, 95.0, portfolio)
    assert approved is False
    assert "Max open positions" in reason


def test_position_size_limit():
    risk = make_risk(max_pos_pct=0.05)  # 5% max
    portfolio = Portfolio(100_000)
    # 60 shares * $100 = $6000 = 6% of $100k → exceeds 5%
    approved, reason = risk.check_entry("SPY", "long", 60, 100.0, 95.0, portfolio)
    assert approved is False
    assert "exceeds max" in reason


def test_daily_loss_lockout():
    risk = make_risk(max_daily_loss_pct=0.02)
    portfolio = Portfolio(100_000)
    # Simulate 3% loss
    risk.on_trade_close(-3000)
    approved, reason = risk.check_entry("SPY", "long", 10, 100.0, 95.0, portfolio)
    assert approved is False
    assert "Daily loss lockout" in reason


def test_daily_reset_clears_lockout():
    risk = make_risk(max_daily_loss_pct=0.02)
    portfolio = Portfolio(100_000)
    risk.on_trade_close(-3000)
    risk.reset_daily()
    approved, reason = risk.check_entry("SPY", "long", 10, 100.0, 95.0, portfolio)
    assert approved is True


def test_blocked_symbol():
    cfg = RiskConfig(blocked_symbols=["TSLA"])
    risk = RiskEngine(cfg)
    portfolio = Portfolio(100_000)
    approved, reason = risk.check_entry("TSLA", "long", 10, 100.0, 95.0, portfolio)
    assert approved is False
    assert "blocked" in reason


def test_allowed_symbols():
    cfg = RiskConfig(allowed_symbols=["SPY", "QQQ"])
    risk = RiskEngine(cfg)
    portfolio = Portfolio(100_000)
    approved, reason = risk.check_entry("AAPL", "long", 10, 100.0, 95.0, portfolio)
    assert approved is False
    assert "not in allowed list" in reason


def test_max_leverage_blocks_when_projected_exposure_too_high():
    cfg = RiskConfig(max_leverage=1.0, max_position_size_pct=1.0)
    risk = RiskEngine(cfg)
    portfolio = Portfolio(100_000)
    portfolio.open_position("SPY", "long", 500, 100.0)  # $50k gross exposure

    approved, reason = risk.check_entry("QQQ", "long", 600, 100.0, 95.0, portfolio)  # +$60k => 1.1x leverage
    assert approved is False
    assert "Projected leverage" in reason


def test_daily_trade_limit_blocks_after_max_closes():
    cfg = RiskConfig(max_daily_trades=2)
    risk = RiskEngine(cfg)
    portfolio = Portfolio(100_000)

    risk.on_trade_close(100)
    risk.on_trade_close(-50)

    approved, reason = risk.check_entry("SPY", "long", 10, 100.0, 95.0, portfolio)
    assert approved is False
    assert "Daily trade limit reached" in reason


def test_correlated_exposure_proxy_blocks_same_direction_over_limit():
    cfg = RiskConfig(max_correlated_exposure=0.30, max_position_size_pct=1.0)
    risk = RiskEngine(cfg)
    portfolio = Portfolio(100_000)
    portfolio.open_position("SPY", "long", 250, 100.0)  # 25% long exposure

    approved, reason = risk.check_entry("QQQ", "long", 100, 100.0, 95.0, portfolio)  # projected 35%
    assert approved is False
    assert "Correlated exposure proxy" in reason


def test_correlated_exposure_proxy_allows_opposite_direction():
    cfg = RiskConfig(max_correlated_exposure=0.30, max_position_size_pct=1.0)
    risk = RiskEngine(cfg)
    portfolio = Portfolio(100_000)
    portfolio.open_position("SPY", "long", 250, 100.0)

    approved, _ = risk.check_entry("QQQ", "short", 100, 100.0, 105.0, portfolio)
    assert approved is True
