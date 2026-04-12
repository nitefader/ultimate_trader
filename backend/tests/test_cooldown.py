"""Tests for cooldown management."""
from datetime import datetime, timedelta
import pytest
from app.strategies.cooldown import CooldownManager


def make_mgr(rules):
    return CooldownManager(rules)


def test_no_cooldown_initially():
    mgr = make_mgr([{"trigger": "loss", "duration_minutes": 60}])
    now = datetime.now()
    assert mgr.is_in_cooldown("SPY", "s1", now, 0) is False


def test_cooldown_activates_on_loss():
    mgr = make_mgr([{"trigger": "loss", "duration_minutes": 60}])
    now = datetime.now()
    mgr.on_trade_exit("SPY", "s1", "stop_loss", -500, now, 10)
    assert mgr.is_in_cooldown("SPY", "s1", now + timedelta(minutes=30), 11) is True


def test_cooldown_expires():
    mgr = make_mgr([{"trigger": "loss", "duration_minutes": 60}])
    now = datetime.now()
    mgr.on_trade_exit("SPY", "s1", "stop_loss", -500, now, 10)
    # After 90 minutes, cooldown should expire
    assert mgr.is_in_cooldown("SPY", "s1", now + timedelta(minutes=90), 50) is False


def test_stop_out_cooldown():
    mgr = make_mgr([{"trigger": "stop_out", "duration_bars": 5}])
    now = datetime.now()
    mgr.on_trade_exit("SPY", "s1", "stop_loss", -200, now, 100)
    # Within cooldown bars
    assert mgr.is_in_cooldown("SPY", "s1", now + timedelta(hours=1), 103) is True
    # After cooldown bars
    assert mgr.is_in_cooldown("SPY", "s1", now + timedelta(hours=2), 106) is False


def test_consecutive_loss_trigger():
    mgr = make_mgr([{"trigger": "consecutive_loss", "consecutive_count": 2, "duration_minutes": 120}])
    now = datetime.now()
    # First loss — no cooldown yet (only 1 consecutive)
    mgr.on_trade_exit("SPY", "s1", "stop_loss", -100, now, 1)
    assert mgr.is_in_cooldown("SPY", "s1", now + timedelta(minutes=1), 2) is False
    # Second consecutive loss — cooldown triggers
    mgr.on_trade_exit("SPY", "s1", "stop_loss", -150, now + timedelta(minutes=5), 2)
    assert mgr.is_in_cooldown("SPY", "s1", now + timedelta(minutes=10), 3) is True


def test_win_resets_consecutive_losses():
    mgr = make_mgr([{"trigger": "consecutive_loss", "consecutive_count": 2, "duration_minutes": 60}])
    now = datetime.now()
    mgr.on_trade_exit("SPY", "s1", "stop_loss", -100, now, 1)
    # A win resets the streak
    mgr.on_trade_exit("SPY", "s1", "target_1", 200, now + timedelta(minutes=5), 2)
    # Another loss (only 1st consecutive now)
    mgr.on_trade_exit("SPY", "s1", "stop_loss", -100, now + timedelta(minutes=10), 3)
    assert mgr.is_in_cooldown("SPY", "s1", now + timedelta(minutes=15), 4) is False


def test_symbol_level_isolation():
    """Cooldown on SPY should not affect QQQ."""
    mgr = make_mgr([{"trigger": "loss", "duration_minutes": 120, "symbol_level": True}])
    now = datetime.now()
    mgr.on_trade_exit("SPY", "s1", "stop_loss", -500, now, 1)
    assert mgr.is_in_cooldown("SPY", "s1", now + timedelta(minutes=30), 5) is True
    assert mgr.is_in_cooldown("QQQ", "s1", now + timedelta(minutes=30), 5) is False


def test_reset_clears_cooldown():
    mgr = make_mgr([{"trigger": "loss", "duration_minutes": 120}])
    now = datetime.now()
    mgr.on_trade_exit("SPY", "s1", "stop_loss", -500, now, 1)
    mgr.reset("SPY", "s1")
    assert mgr.is_in_cooldown("SPY", "s1", now + timedelta(minutes=30), 5) is False
