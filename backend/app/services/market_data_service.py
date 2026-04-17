"""Provider-agnostic historical market data service."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from app.data.providers import FetchRequest, ProviderCredentials, get_provider, list_providers
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from app.models.market_data import DataInventory


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


async def list_inventory_db(db: AsyncSession) -> list[dict[str, Any]]:
    """List inventory from DB; fall back to provider-based cache scan when DB is empty."""
    result = await db.execute(select(DataInventory).order_by(DataInventory.symbol, DataInventory.timeframe))
    rows = result.scalars().all()
    items: list[dict[str, Any]] = []
    for inv in rows:
        file_size_kb = None
        try:
            if inv.file_path:
                p = Path(inv.file_path)
                if p.exists():
                    file_size_kb = round(p.stat().st_size / 1024, 1)
        except Exception:
            file_size_kb = None

        items.append({
            "symbol": inv.symbol,
            "timeframe": inv.timeframe,
            "provider": inv.source,
            "first_date": inv.first_date,
            "last_date": inv.last_date,
            "bar_count": inv.bar_count,
            "file_size_kb": file_size_kb or 0,
            "downloaded_at": inv.downloaded_at.isoformat() + 'Z' if inv.downloaded_at else None,
        })

    if not items:
        # Fallback to provider-based listing if DB empty/uninitialized
        for prov in list_providers():
            items.extend(prov.list_cached_symbols())
        items.sort(key=lambda item: (item.get("symbol", ""), item.get("timeframe", ""), item.get("provider", "")))

    return items


async def get_inventory_db(db: AsyncSession, symbol: str, timeframe: str, provider: str = "yfinance") -> dict[str, Any] | None:
    symbol = symbol.upper()
    result = await db.execute(
        select(DataInventory).where(
            DataInventory.symbol == symbol,
            DataInventory.timeframe == timeframe,
            DataInventory.source == provider,
        )
    )
    inv = result.scalar_one_or_none()
    if inv is None:
        # fall back to provider file-based inventory
        return get_provider(provider).get_inventory(symbol, timeframe)

    file_size_kb = None
    try:
        if inv.file_path:
            p = Path(inv.file_path)
            if p.exists():
                file_size_kb = round(p.stat().st_size / 1024, 1)
    except Exception:
        file_size_kb = None

    return {
        "symbol": inv.symbol,
        "timeframe": inv.timeframe,
        "provider": inv.source,
        "first_date": inv.first_date,
        "last_date": inv.last_date,
        "bar_count": inv.bar_count,
        "file_size_kb": file_size_kb or 0,
        "downloaded_at": inv.downloaded_at.isoformat() + 'Z' if inv.downloaded_at else None,
    }


async def upsert_inventory_db(
    db: AsyncSession,
    *,
    symbol: str,
    timeframe: str,
    provider: str,
    file_path: str,
    first_date: str,
    last_date: str,
    bar_count: int,
) -> DataInventory:
    symbol = symbol.upper()
    result = await db.execute(
        select(DataInventory).where(
            DataInventory.symbol == symbol,
            DataInventory.timeframe == timeframe,
            DataInventory.source == provider,
        )
    )
    inv = result.scalar_one_or_none()
    now = datetime.utcnow()
    if inv is None:
        inv = DataInventory(
            symbol=symbol,
            timeframe=timeframe,
            source=provider,
            adjusted=True,
            first_date=first_date,
            last_date=last_date,
            bar_count=bar_count,
            last_updated=now,
            downloaded_at=now,
            is_complete=True,
            file_path=str(file_path),
        )
        db.add(inv)
    else:
        inv.first_date = first_date
        inv.last_date = last_date
        inv.bar_count = bar_count
        inv.file_path = str(file_path)
        inv.downloaded_at = now
        inv.last_updated = now
        inv.is_complete = True

    await db.flush()
    return inv


async def delete_inventory_db(db: AsyncSession, symbol: str, timeframe: str, provider: str) -> bool:
    symbol = symbol.upper()
    result = await db.execute(
        select(DataInventory).where(
            DataInventory.symbol == symbol,
            DataInventory.timeframe == timeframe,
            DataInventory.source == provider,
        )
    )
    inv = result.scalar_one_or_none()
    if inv is None:
        return False
    await db.delete(inv)
    await db.flush()
    return True
