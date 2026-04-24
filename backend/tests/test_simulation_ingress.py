from __future__ import annotations

import pandas as pd
import pytest

from app.services import simulation_service


@pytest.mark.asyncio
async def test_simulation_records_actual_provider_per_symbol(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeStrategyVersion:
        config = {
            "entry": {
                "conditions": [
                    {
                        "type": "single",
                        "left": {"field": "close"},
                        "op": ">",
                        "right": {"indicator": "ema", "period": 20},
                    }
                ]
            }
        }
        strategy_id = "strat-1"
        duration_mode = "day"

    class _FakeStrategy:
        name = "Test Strategy"

    class _FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, model, object_id):
            if model.__name__ == "StrategyVersion":
                return _FakeStrategyVersion()
            return _FakeStrategy()

    class _FakeStepper:
        def __init__(self, strategy_config, run_config):
            self.strategy_config = strategy_config
            self.run_config = run_config

        def prepare(self, data):
            return {"prepared_symbols": sorted(data.keys())}

    async def _fake_resolve_alpaca_credentials(api_key=None, secret_key=None):
        return "key", "secret"

    def _fake_fetch_market_data(**kwargs):
        provider = kwargs["provider"]
        symbol = kwargs["symbol"]
        if symbol == "AAPL" and provider == "alpaca":
            raise RuntimeError("alpaca failed")
        return pd.DataFrame(
            {"open": [1.0], "high": [1.2], "low": [0.9], "close": [1.1], "volume": [100]},
            index=pd.to_datetime(["2024-01-01"]),
        )

    monkeypatch.setattr(simulation_service, "AsyncSessionLocal", lambda: _FakeSession())
    monkeypatch.setattr(simulation_service, "BacktestStepper", _FakeStepper)
    monkeypatch.setattr("app.services.data_limits.resolve_alpaca_credentials", _fake_resolve_alpaca_credentials)
    monkeypatch.setattr("app.services.market_data_service.fetch_market_data", _fake_fetch_market_data)

    metadata = await simulation_service.create_simulation(
        strategy_version_id="sv-1",
        symbols=["AAPL", "MSFT"],
        timeframe="1m",
        start_date="2024-01-01",
        end_date="2024-01-02",
        data_provider="auto",
    )

    assert metadata["provider"] == "alpaca"
    assert metadata["provider_requested"] == "auto"
    assert metadata["symbol_providers"]["AAPL"]["actual_provider"] == "yfinance"
    assert metadata["symbol_providers"]["AAPL"]["fallback_used"] is True
    assert metadata["symbol_providers"]["MSFT"]["actual_provider"] == "alpaca"
    assert metadata["symbol_providers"]["MSFT"]["fallback_used"] is False
    preview = metadata["feature_plan_preview"]
    assert preview["symbols"] == ["AAPL", "MSFT"]
    assert len(preview["feature_keys"]) == 1
    assert '"kind":"ema"' in preview["feature_keys"][0]
    assert '"period":20' in preview["feature_keys"][0]
