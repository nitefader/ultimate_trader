"""Tests for kill switch behavior."""
import pytest
from app.core.kill_switch import KillSwitch


def test_global_kill():
    ks = KillSwitch()
    assert ks.is_globally_killed is False
    ks.kill_all("test reason")
    assert ks.is_globally_killed is True


def test_global_kill_blocks_can_trade():
    ks = KillSwitch()
    ks.kill_all("emergency")
    ok, reason = ks.can_trade(account_id="acc1", strategy_id="s1")
    assert ok is False
    assert "Global kill" in reason


def test_unkill_resumes():
    ks = KillSwitch()
    ks.kill_all("test")
    ks.unkill_all()
    ok, reason = ks.can_trade()
    assert ok is True


def test_account_kill():
    ks = KillSwitch()
    ks.kill_account("acc1")
    assert ks.is_account_killed("acc1") is True
    assert ks.is_account_killed("acc2") is False


def test_account_kill_blocks_trade():
    ks = KillSwitch()
    ks.kill_account("acc1", "daily loss")
    ok, reason = ks.can_trade(account_id="acc1")
    assert ok is False
    assert "acc1" in reason


def test_strategy_pause():
    ks = KillSwitch()
    ks.pause_strategy("s1")
    assert ks.is_strategy_killed("s1") is True
    ks.resume_strategy("s1")
    assert ks.is_strategy_killed("s1") is False


def test_global_kill_overrides_account():
    """Global kill should block even unblocked accounts."""
    ks = KillSwitch()
    ks.kill_all("global emergency")
    ok, _ = ks.can_trade(account_id="acc_not_individually_killed")
    assert ok is False


def test_event_log():
    ks = KillSwitch()
    ks.kill_all("test")
    ks.kill_account("acc1", "loss limit")
    ks.pause_strategy("s1")
    events = ks.get_events()
    assert len(events) == 3
    assert events[0]["action"] == "pause"   # most recent first


def test_status_report():
    ks = KillSwitch()
    ks.kill_all("test")
    ks.kill_account("acc1")
    status = ks.get_status()
    assert status["global_killed"] is True
    assert "acc1" in status["killed_accounts"]
