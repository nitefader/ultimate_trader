"""Provider-agnostic historical market data service."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from app.data.providers import FetchRequest, ProviderCredentials, get_provider, list_providers


def cache_path_for(symbol: str, timeframe: str, provider: str) -> Path:
    return get_provider(provider).cache_path(symbol.upper(), timeframe)


def fetch_market_data(
    *,
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
    provider: str = "yfinance",
    adjusted: bool = True,
    force_download: bool = False,
    api_key: str = "",
    secret_key: str = "",
) -> pd.DataFrame:
    data_provider = get_provider(provider)
    request = FetchRequest(
        symbol=symbol.upper(),
        timeframe=timeframe,
        start=start,
        end=end,
        adjusted=adjusted,
        force_download=force_download,
        credentials=ProviderCredentials(api_key=api_key, secret_key=secret_key),
    )
    return data_provider.fetch(request)


def get_inventory(symbol: str, timeframe: str, provider: str = "yfinance") -> dict[str, Any] | None:
    return get_provider(provider).get_inventory(symbol.upper(), timeframe)


def list_inventory() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for provider in list_providers():
        items.extend(provider.list_cached_symbols())
    items.sort(key=lambda item: (item.get("symbol", ""), item.get("timeframe", ""), item.get("provider", "")))
    return items


def search_symbols(
    *,
    query: str,
    provider: str = "yfinance",
    max_results: int = 15,
    api_key: str = "",
    secret_key: str = "",
) -> list[dict[str, Any]]:
    return get_provider(provider).search_symbols(
        query,
        max_results=max_results,
        credentials=ProviderCredentials(api_key=api_key, secret_key=secret_key),
    )
