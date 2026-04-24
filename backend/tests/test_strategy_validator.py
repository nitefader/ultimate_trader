import pytest

from app.api.routes.strategies import StrategyCreateRequest


def _example_config_with_forbidden() -> dict:
    return {
        "entry": {"conditions": [{"left": {"field": "close"}, "op": ">", "right": 1}]},
        "risk_pct": 0.01,
    }


def test_validator_allows_when_not_enforced(monkeypatch):
    monkeypatch.delenv("ULTRATRADER_ENFORCE_STRATEGY_COMPONENT_SEPARATION", raising=False)
    cfg = _example_config_with_forbidden()
    req = StrategyCreateRequest(name="test", config=cfg)
    assert req.config.get("risk_pct") == 0.01


def test_validator_rejects_when_enforced(monkeypatch):
    monkeypatch.setenv("ULTRATRADER_ENFORCE_STRATEGY_COMPONENT_SEPARATION", "1")
    cfg = _example_config_with_forbidden()
    with pytest.raises(Exception) as exc:
        StrategyCreateRequest(name="test", config=cfg)
    # error message indicates config contains disallowed fields
    assert "contains fields" in str(exc.value).lower() or "contains forbidden" in str(exc.value).lower()
