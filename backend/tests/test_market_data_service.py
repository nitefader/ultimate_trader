from __future__ import annotations

import pandas as pd
import pytest

from app.brokers import AlpacaBroker, BrokerProtocol, InternalPaperBroker
from app.data.providers import ProviderCredentials
from app.data.providers.base import FetchRequest
from app.data.providers.registry import AlpacaHistoricalProvider, YFinanceHistoricalProvider, get_provider
from app.services.market_data_service import fetch_market_data


def test_get_provider_returns_registered_provider() -> None:
    provider = get_provider("yfinance")
    assert isinstance(provider, YFinanceHistoricalProvider)


def test_get_provider_rejects_unknown_provider() -> None:
    with pytest.raises(ValueError):
        get_provider("unknown")


def test_alpaca_provider_requires_credentials() -> None:
    provider = AlpacaHistoricalProvider()
    with pytest.raises(ValueError):
        provider.fetch(
            FetchRequest(
                symbol="SPY",
                timeframe="1d",
                start="2024-01-01",
                end="2024-12-31",
                credentials=ProviderCredentials(),
            )
        )


def test_fetch_market_data_dispatches_to_provider(monkeypatch) -> None:
    expected = pd.DataFrame(
        {"open": [1.0], "high": [2.0], "low": [0.5], "close": [1.5], "volume": [1000]},
        index=pd.to_datetime(["2024-01-02"]),
    )

    def _fake_fetch(self, request: FetchRequest) -> pd.DataFrame:
        assert request.symbol == "SPY"
        assert request.timeframe == "1d"
        return expected

    monkeypatch.setattr(YFinanceHistoricalProvider, "fetch", _fake_fetch)

    out = fetch_market_data(
        symbol="SPY",
        timeframe="1d",
        start="2024-01-01",
        end="2024-12-31",
        provider="yfinance",
    )

    assert out.equals(expected)


def test_broker_protocol_runtime_compatibility() -> None:
    assert isinstance(InternalPaperBroker(), BrokerProtocol)
    assert isinstance(AlpacaBroker.from_keys("AK", "SK", paper=True), BrokerProtocol)
