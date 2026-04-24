from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import pytest

from app.cerebro.engine import CerebroEngine
from app.cerebro.indicator_cache import IndicatorCache
from app.features.source_contracts import (
    ALPACA_LIVE_PROVIDER,
    ALPACA_STREAM_CONTINUATION,
    YFINANCE_FALLBACK_PROVIDER,
    resolve_requested_provider,
    resolve_warmup_source_contract,
)


def test_resolve_warmup_source_contract_prefers_alpaca_for_live_with_credentials() -> None:
    contract = resolve_warmup_source_contract(runtime_mode="live", alpaca_credentials_configured=True)

    assert contract.selected_provider == ALPACA_LIVE_PROVIDER
    assert contract.continuation_provider == ALPACA_STREAM_CONTINUATION
    assert contract.fallback_allowed is False
    assert contract.fallback_reason is None


def test_resolve_warmup_source_contract_falls_back_when_live_credentials_missing() -> None:
    contract = resolve_warmup_source_contract(runtime_mode="live", alpaca_credentials_configured=False)

    assert contract.selected_provider == YFINANCE_FALLBACK_PROVIDER
    assert contract.continuation_provider == ALPACA_STREAM_CONTINUATION
    assert contract.fallback_allowed is True
    assert contract.fallback_reason == "alpaca_credentials_missing_for_live_default"


def test_resolve_requested_provider_respects_explicit_and_auto_defaults() -> None:
    assert resolve_requested_provider(
        requested_provider="alpaca",
        runtime_mode="research",
        alpaca_credentials_configured=False,
    ) == ALPACA_LIVE_PROVIDER

    assert resolve_requested_provider(
        requested_provider="auto",
        runtime_mode="research",
        alpaca_credentials_configured=True,
    ) == YFINANCE_FALLBACK_PROVIDER

    assert resolve_requested_provider(
        requested_provider="auto",
        runtime_mode="live",
        alpaca_credentials_configured=True,
    ) == ALPACA_LIVE_PROVIDER


@pytest.mark.asyncio
async def test_indicator_cache_preserves_warmup_provenance_on_stream_update() -> None:
    cache = IndicatorCache()
    bars = pd.DataFrame(
        [
            {
                "open": 100 + idx,
                "high": 101 + idx,
                "low": 99 + idx,
                "close": 100.5 + idx,
                "volume": 1000 + idx,
            }
            for idx in range(60)
        ],
        index=pd.date_range("2024-01-01", periods=60, freq="D"),
    )
    contract = resolve_warmup_source_contract(runtime_mode="paper", alpaca_credentials_configured=True)

    from app.features.source_contracts import make_warmup_provenance

    await cache.warm_up("AAPL", "1d", bars, provenance=make_warmup_provenance(contract))
    frame = cache.get("AAPL", "1d")
    assert frame is not None
    assert frame.provenance is not None
    assert frame.provenance.warmup_provider == ALPACA_LIVE_PROVIDER
    assert frame.provenance.continuation_provider == ALPACA_STREAM_CONTINUATION

    updated = await cache.update(
        "AAPL",
        "1d",
        {
            "timestamp": datetime(2024, 3, 1, tzinfo=timezone.utc),
            "open": 161.0,
            "high": 162.0,
            "low": 160.0,
            "close": 161.5,
            "volume": 2500.0,
        },
        source=ALPACA_STREAM_CONTINUATION,
    )
    assert updated is not None
    assert updated.provenance is not None
    assert updated.provenance.warmup_provider == ALPACA_LIVE_PROVIDER
    assert updated.provenance.continuation_provider == ALPACA_STREAM_CONTINUATION
    assert updated.provenance.last_updated_at is not None


@pytest.mark.asyncio
async def test_cerebro_engine_cold_start_uses_contract_selected_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = CerebroEngine()
    engine._api_key = "key"
    engine._secret_key = "secret"
    engine._runtime_mode = "live"

    captured: dict[str, str] = {}

    def fake_fetch_market_data(**kwargs):
        captured["provider"] = kwargs["provider"]
        return pd.DataFrame(
            [{"open": 1.0, "high": 1.1, "low": 0.9, "close": 1.0, "volume": 1000.0}],
            index=pd.date_range("2024-01-01", periods=1, freq="D"),
        )

    async def fake_warm_up(symbol: str, timeframe: str, bars_df: pd.DataFrame, provenance=None):
        captured["warmup_provider"] = provenance.warmup_provider if provenance else ""
        captured["continuation_provider"] = provenance.continuation_provider if provenance else ""

    monkeypatch.setattr("app.services.market_data_service.fetch_market_data", fake_fetch_market_data)
    monkeypatch.setattr(engine.indicator_cache, "warm_up", fake_warm_up)

    await engine._cold_start_symbols([("AAPL", "1d")])

    assert captured["provider"] == ALPACA_LIVE_PROVIDER
    assert captured["warmup_provider"] == ALPACA_LIVE_PROVIDER
    assert captured["continuation_provider"] == ALPACA_STREAM_CONTINUATION
