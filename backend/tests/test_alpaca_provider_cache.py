import pandas as pd
import pytest

from app.data.providers import alpaca_provider as provider


def _write_sample_cache(path, symbol="FOO", timeframe="1d"):
    provider.settings.CACHE_DIR = path
    cache_file = provider._cache_path(symbol, timeframe)
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    idx = pd.date_range("2022-01-01", "2022-01-10", freq="D")
    df = pd.DataFrame(
        {
            "open": 1.0,
            "high": 2.0,
            "low": 0.5,
            "close": 1.5,
            "volume": 100,
        },
        index=idx,
    )
    df.to_parquet(cache_file)
    return cache_file


def test_fetch_uses_cache_on_download_error(monkeypatch, tmp_path):
    """If the Alpaca download fails, the provider should fall back to the cached parquet."""
    cache_file = _write_sample_cache(tmp_path, symbol="FOO", timeframe="1d")

    class FakeClient:
        def get_stock_bars(self, req):
            raise RuntimeError("Simulated API failure")

    monkeypatch.setattr(provider, "_build_client", lambda api_key, secret_key: FakeClient())

    df = provider.fetch(
        "FOO",
        "1d",
        "2022-01-02T00:00:00Z",
        "2022-01-05T00:00:00Z",
        api_key="k",
        secret_key="s",
        force_download=False,
    )

    assert len(df) == 4
    assert df.index[0].date().isoformat() == "2022-01-02"
    assert df.index[-1].date().isoformat() == "2022-01-05"


def test_tz_aware_start_handled_correctly(monkeypatch, tmp_path):
    """Ensure tz-aware start/end strings are handled against tz-naive cache indexes."""
    _write_sample_cache(tmp_path, symbol="BAR", timeframe="1d")

    class FakeClient:
        def get_stock_bars(self, req):
            raise RuntimeError("Simulated API failure")

    monkeypatch.setattr(provider, "_build_client", lambda api_key, secret_key: FakeClient())

    # tz-aware start (UTC) — provider should normalize and still read from cache
    df = provider.fetch(
        "BAR",
        "1d",
        "2022-01-03T00:00:00+00:00",
        "2022-01-04T00:00:00+00:00",
        api_key="k",
        secret_key="s",
        force_download=False,
    )

    assert len(df) == 2
    assert df.index[0].date().isoformat() == "2022-01-03"
    assert df.index[-1].date().isoformat() == "2022-01-04"
import pandas as pd
import pytest

from app.data.providers import alpaca_provider as provider


def _write_sample_cache(path, symbol="FOO", timeframe="1d"):
    cache_dir = path
    provider.settings.CACHE_DIR = cache_dir
    cache_file = provider._cache_path(symbol, timeframe)
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    idx = pd.date_range("2022-01-01", "2022-01-10", freq="D")
    df = pd.DataFrame(
        {
            "open": 1.0,
            "high": 2.0,
            "low": 0.5,
            "close": 1.5,
            "volume": 100,
        },
        index=idx,
    )
    df.to_parquet(cache_file)
    return cache_file


def test_fetch_uses_cache_on_download_error(monkeypatch, tmp_path):
    """If the Alpaca download fails, the provider should fall back to the cached parquet."""
    cache_file = _write_sample_cache(tmp_path, symbol="FOO", timeframe="1d")

    class FakeClient:
        def get_stock_bars(self, req):
            raise RuntimeError("Simulated API failure")

    monkeypatch.setattr(provider, "_build_client", lambda api_key, secret_key: FakeClient())

    df = provider.fetch(
        "FOO",
        "1d",
        "2022-01-02T00:00:00Z",
        "2022-01-05T00:00:00Z",
        api_key="k",
        secret_key="s",
        force_download=False,
    )

    assert len(df) == 4
    assert df.index[0].date().isoformat() == "2022-01-02"
    assert df.index[-1].date().isoformat() == "2022-01-05"


def test_tz_aware_start_handled_correctly(monkeypatch, tmp_path):
    """Ensure tz-aware start/end strings are handled against tz-naive cache indexes."""
    _write_sample_cache(tmp_path, symbol="BAR", timeframe="1d")

    class FakeClient:
        def get_stock_bars(self, req):
            raise RuntimeError("Simulated API failure")

    monkeypatch.setattr(provider, "_build_client", lambda api_key, secret_key: FakeClient())

    # tz-aware start (UTC) — provider should normalize and still read from cache
    df = provider.fetch(
        "BAR",
        "1d",
        "2022-01-03T00:00:00+00:00",
        "2022-01-04T00:00:00+00:00",
        api_key="k",
        secret_key="s",
        force_download=False,
    )

    assert len(df) == 2
    assert df.index[0].date().isoformat() == "2022-01-03"
    assert df.index[-1].date().isoformat() == "2022-01-04"
