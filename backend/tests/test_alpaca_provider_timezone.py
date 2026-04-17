from __future__ import annotations

import pandas as pd
import pytest
from pathlib import Path

from app.data.providers import alpaca_provider


class FakeBars:
    def __init__(self, df: pd.DataFrame):
        self.df = df


class FakeClient:
    def __init__(self, bars: FakeBars | pd.DataFrame):
        self._bars = bars

    def get_stock_bars(self, request):
        return self._bars


def _multiindex_df(symbol: str) -> pd.DataFrame:
    # MultiIndex (symbol, timestamp) with tz-aware UTC timestamps
    times = pd.to_datetime(["2024-01-02T15:30:00Z", "2024-01-02T16:30:00Z"], utc=True)
    idx = pd.MultiIndex.from_product([[symbol], times], names=["symbol", "timestamp"])
    df = pd.DataFrame(
        {"open": [1.0, 2.0], "high": [1.1, 2.1], "low": [0.9, 1.9], "close": [1.0, 2.0], "volume": [100, 200]},
        index=idx,
    )
    return df


def test_alpaca_fetch_flattens_multiindex_and_normalizes_tz(tmp_path, monkeypatch):
    monkeypatch.setattr(alpaca_provider.settings, "CACHE_DIR", Path(tmp_path))

    raw = _multiindex_df("SPY")
    bars = FakeBars(raw)
    client = FakeClient(bars)

    monkeypatch.setattr(alpaca_provider, "_build_client", lambda a, b: client)

    out = alpaca_provider.fetch(
        symbol="SPY",
        timeframe="1d",
        start="2024-01-02",
        end="2024-01-03",
        api_key="K",
        secret_key="S",
        force_download=True,
    )

    assert isinstance(out, pd.DataFrame)
    assert out.index.tz is None
    assert list(out.columns) == ["open", "high", "low", "close", "volume"]
    assert len(out) == 2


def test_alpaca_fetch_falls_back_to_cached_file_on_error(tmp_path, monkeypatch):
    monkeypatch.setattr(alpaca_provider.settings, "CACHE_DIR", Path(tmp_path))

    idx = pd.to_datetime(["2024-01-02", "2024-01-03"])
    cached = pd.DataFrame({"open": [10, 11], "high": [12, 13], "low": [9, 10], "close": [11, 12], "volume": [1000, 1100]}, index=idx)

    cache_file = alpaca_provider._cache_path("SPY", "1d")
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cached.to_parquet(cache_file)

    def _bad_build(api_key, secret_key):
        class BadClient:
            def get_stock_bars(self, request):
                raise RuntimeError("simulated network error")
        return BadClient()

    monkeypatch.setattr(alpaca_provider, "_build_client", _bad_build)

    out = alpaca_provider.fetch(
        symbol="SPY",
        timeframe="1d",
        start="2024-01-02",
        end="2024-01-03",
        api_key="K",
        secret_key="S",
        force_download=False,
    )

    assert isinstance(out, pd.DataFrame)
    expected = cached.loc["2024-01-02":"2024-01-03"].copy()
    pd.testing.assert_frame_equal(out, expected)
