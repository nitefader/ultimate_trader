from __future__ import annotations

import pandas as pd
import pytest

from app.api.routes import data as data_routes


@pytest.mark.asyncio
async def test_fetch_data_auto_resolves_provider_via_shared_contract(monkeypatch):
    called: dict[str, object] = {}

    def _fake_fetch_market_data(**kwargs):
        called.update(kwargs)
        return pd.DataFrame(
            {"open": [1.0], "high": [1.2], "low": [0.9], "close": [1.1], "volume": [100]},
            index=pd.to_datetime(["2024-01-01"]),
        )

    async def _fake_upsert_inventory(*args, **kwargs):
        return None

    monkeypatch.setattr(data_routes, "fetch_market_data", _fake_fetch_market_data)
    monkeypatch.setattr(data_routes, "upsert_inventory", _fake_upsert_inventory)

    body = await data_routes.fetch_data(
        {
            "symbol": "spy",
            "timeframe": "1m",
            "start": "2024-01-01",
            "end": "2024-01-02",
            "provider": "auto",
            "api_key": "key",
            "secret_key": "secret",
        },
        db=None,
    )

    assert called["provider"] == "alpaca"
    assert body["provider_requested"] == "auto"
    assert body["provider"] == "alpaca"


@pytest.mark.asyncio
async def test_indicators_reports_actual_provider_when_falling_back(monkeypatch, tmp_path):
    def _fake_cache_file_for(symbol: str, timeframe: str, provider: str):
        base = tmp_path / f"{symbol}_{timeframe}_{provider}.parquet"
        if provider == "alpaca":
            pd.DataFrame(
                {"open": [1.0], "high": [1.2], "low": [0.9], "close": [1.1], "volume": [100]},
                index=pd.to_datetime(["2024-01-01"]),
            ).to_parquet(base)
        return base

    monkeypatch.setattr(data_routes, "_cache_file_for", _fake_cache_file_for)

    body = await data_routes.get_bars_with_indicators("SPY", "1d", provider="yfinance", limit=10, indicators="")
    assert body["provider"] == "alpaca"
