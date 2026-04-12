from __future__ import annotations

import yaml
from pathlib import Path
import pytest


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


@pytest.mark.asyncio
async def test_strategy_configs_validate(client):
    configs_dir = _repo_root() / "backend" / "configs" / "strategies"
    yamls = sorted(list(configs_dir.glob("*.yaml")))
    assert yamls, "Expected at least one sample strategy YAML"

    for p in yamls:
        cfg = yaml.safe_load(p.read_text(encoding="utf-8"))
        resp = await client.post("/api/v1/strategies/validate", json={"config": cfg})
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("valid") is True, f"{p.name} failed validation: {body}"


@pytest.mark.asyncio
async def test_strategy_validate_rejects_missing_entry_conditions(client):
    resp = await client.post(
        "/api/v1/strategies/validate",
        json={"config": {"entry": {"logic": "all_of", "conditions": []}}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert "Entry has no conditions" in body["errors"]


@pytest.mark.asyncio
async def test_strategy_validate_rejects_invalid_risk_bounds(client):
    resp = await client.post(
        "/api/v1/strategies/validate",
        json={
            "config": {
                "entry": {
                    "conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}],
                },
                "risk": {
                    "max_position_size_pct": 1.5,
                    "max_daily_loss_pct": -0.1,
                    "max_open_positions": 0,
                },
            }
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert "risk.max_position_size_pct must be between 0 and 1" in body["errors"]
    assert "risk.max_daily_loss_pct must be between 0 and 1" in body["errors"]
    assert "risk.max_open_positions must be greater than 0" in body["errors"]


@pytest.mark.asyncio
async def test_strategy_validate_rejects_non_list_symbols(client):
    resp = await client.post(
        "/api/v1/strategies/validate",
        json={
            "config": {
                "entry": {
                    "conditions": [{"type": "single", "left": {"field": "close"}, "op": ">", "right": 1}],
                },
                "symbols": "SPY",
            }
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert "symbols must be a list of ticker strings" in body["errors"]
