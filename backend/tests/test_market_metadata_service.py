from __future__ import annotations

import pandas as pd
import pytest

from app.database import create_all_tables
from app.services.market_metadata_service import (
    _pairwise_correlation_summary,
    create_market_metadata_snapshot,
    serialize_snapshot,
)


def _sample_price_frame(seed: float) -> pd.DataFrame:
    idx = pd.date_range("2024-01-01", periods=90, freq="D")
    close = pd.Series([seed + i * 0.5 for i in range(90)], index=idx)
    return pd.DataFrame(
        {
            "open": close - 0.1,
            "high": close + 0.2,
            "low": close - 0.2,
            "close": close,
            "volume": 1000,
        },
        index=idx,
    )


def test_pairwise_correlation_summary_returns_symbol_entries() -> None:
    summary = _pairwise_correlation_summary(
        {
            "SPY": _sample_price_frame(100.0),
            "QQQ": _sample_price_frame(200.0),
        },
        window=60,
    )
    assert "SPY" in summary
    assert "QQQ" in summary


@pytest.mark.asyncio
async def test_create_market_metadata_snapshot_persists(db, monkeypatch) -> None:
    await create_all_tables()
    monkeypatch.setattr(
        "app.services.market_metadata_service.fetch_market_data",
        lambda **kwargs: _sample_price_frame(100.0 if kwargs["symbol"] == "SPY" else 200.0),
    )

    snapshot = await create_market_metadata_snapshot(
        db,
        symbols=["SPY", "QQQ"],
        as_of_date="2024-03-31",
        provider="yfinance",
        sector_overrides={"SPY": "broad_market"},
    )
    await db.commit()
    await db.refresh(snapshot, attribute_names=["symbols"])

    payload = serialize_snapshot(snapshot)
    assert payload["metadata_version_id"].startswith("md_20240331_")
    assert payload["provider_requested"] == "yfinance"
    assert payload["provider_used"] == "yfinance"
    assert payload["fetch_start_date"] == "2023-12-02"
    assert payload["fetch_end_date"] == "2024-03-31"
    assert payload["symbol_count"] == 2
    assert payload["symbols"][0]["symbol"] == "QQQ" or payload["symbols"][0]["symbol"] == "SPY"
    assert any(item["sector_tag"] == "broad_market" for item in payload["symbols"])
    assert all(item["adv_usd_30d"] is not None for item in payload["symbols"])
    assert all(item["spread_proxy_bps_30d"] is not None for item in payload["symbols"])
    assert all(item["regime_tag"] in {"bull", "bear", "sideways", "unknown"} for item in payload["symbols"])


@pytest.mark.asyncio
async def test_create_market_metadata_snapshot_persists_auto_provider_resolution(db, monkeypatch) -> None:
    await create_all_tables()
    monkeypatch.setattr(
        "app.services.market_metadata_service.fetch_market_data",
        lambda **kwargs: _sample_price_frame(150.0),
    )

    snapshot = await create_market_metadata_snapshot(
        db,
        symbols=["SPY"],
        as_of_date="2024-03-31",
        provider="auto",
    )
    await db.commit()
    await db.refresh(snapshot, attribute_names=["symbols"])

    payload = serialize_snapshot(snapshot)
    assert payload["provider_requested"] == "auto"
    assert payload["provider_used"] == "yfinance"
