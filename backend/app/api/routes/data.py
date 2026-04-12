"""Historical data cache management endpoints."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.data.providers import yfinance_provider as yf_prov
from app.data.providers import alpaca_provider as alp_prov

router = APIRouter(prefix="/data", tags=["data"])
settings = get_settings()

# ── Provider metadata ─────────────────────────────────────────────────────────

YFINANCE_INFO = {
    "name": "Yahoo Finance",
    "supported_timeframes": ["1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo"],
    "intraday_max_days": {
        "1m": 7,
        "5m": 60,
        "15m": 60,
        "30m": 60,
        "1h": 730,
    },
    "max_history_years": 20,
    "requires_credentials": False,
    "notes": (
        "Free, no credentials needed. "
        "Intraday data (< 1 day) is limited to 60 days of history. "
        "1-minute data is limited to 7 days."
    ),
}

ALPACA_INFO = alp_prov.PROVIDER_INFO


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cache_file_for(symbol: str, timeframe: str, provider: str) -> Path:
    if provider == "alpaca":
        return settings.CACHE_DIR / f"{symbol}_{timeframe}_alpaca.parquet"
    return settings.CACHE_DIR / f"{symbol}_{timeframe}.parquet"


@router.get("/bars/{symbol}/{timeframe}")
async def get_cached_bars(
    symbol: str,
    timeframe: str,
    provider: str = "yfinance",
    limit: int = 500,
):
    """Return cached OHLCV bars for charting from local parquet cache."""
    if limit < 10 or limit > 5000:
        raise HTTPException(status_code=422, detail="limit must be between 10 and 5000")

    symbol = symbol.upper()
    cache_file = _cache_file_for(symbol, timeframe, provider)
    if not cache_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No cache file found for {symbol}/{timeframe} (provider={provider})",
        )

    try:
        df = pd.read_parquet(cache_file)
        if df.empty:
            return {"symbol": symbol, "timeframe": timeframe, "provider": provider, "bars": []}

        df = df.sort_index().tail(limit)
        idx = pd.to_datetime(df.index, utc=True).tz_localize(None)

        bars = []
        for ts, row in zip(idx, df.itertuples(index=False)):
            bars.append(
                {
                    "t": ts.isoformat(),
                    "open": float(row.open),
                    "high": float(row.high),
                    "low": float(row.low),
                    "close": float(row.close),
                    "volume": float(row.volume),
                }
            )

        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "provider": provider,
            "bars": bars,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load cached bars: {e}")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/providers")
async def list_providers():
    """Return metadata for each supported data provider."""
    return {
        "providers": {
            "yfinance": YFINANCE_INFO,
            "alpaca": ALPACA_INFO,
        }
    }


@router.get("/inventory")
async def list_inventory():
    """List all cached data (from all providers)."""
    yf_items = yf_prov.list_cached_symbols()
    for item in yf_items:
        item.setdefault("provider", "yfinance")

    alp_items = alp_prov.list_cached_symbols()

    # Merge and deduplicate
    all_items = yf_items + alp_items
    all_items.sort(key=lambda x: (x["symbol"], x["timeframe"]))
    return {"items": all_items}


@router.get("/inventory/{symbol}/{timeframe}")
async def get_symbol_inventory(symbol: str, timeframe: str, provider: str = "yfinance"):
    if provider == "alpaca":
        info = alp_prov.get_inventory(symbol, timeframe)
    else:
        info = yf_prov.get_inventory(symbol, timeframe)
    if not info:
        raise HTTPException(
            status_code=404,
            detail=f"No cached data for {symbol}/{timeframe} (provider={provider})"
        )
    return info


@router.post("/fetch")
async def fetch_data(body: dict[str, Any]):
    """
    Download and cache OHLCV data for a symbol.

    body:
      symbol       (required)
      timeframe    default: "1d"
      start        default: "2020-01-01"
      end          default: "2024-01-01"
      provider     "yfinance" | "alpaca"  (default: "yfinance")
      force        bool  (default: false)
      api_key      required when provider="alpaca"
      secret_key   required when provider="alpaca"
    """
    symbol = (body.get("symbol") or "").upper()
    timeframe = body.get("timeframe", "1d")
    start = body.get("start", "2020-01-01")
    end = body.get("end", "2024-01-01")
    force = body.get("force", False) or body.get("force_download", False)
    provider = body.get("provider", "yfinance")

    if not symbol:
        raise HTTPException(status_code=400, detail="symbol required")

    try:
        if provider == "alpaca":
            api_key = body.get("api_key", "")
            secret_key = body.get("secret_key", "")
            if not api_key or not secret_key:
                raise HTTPException(
                    status_code=400,
                    detail="api_key and secret_key are required for Alpaca provider"
                )
            df = await asyncio.get_running_loop().run_in_executor(
                None, alp_prov.fetch, symbol, timeframe, start, end, api_key, secret_key, force
            )
        else:
            df = await asyncio.get_running_loop().run_in_executor(
                None, yf_prov.fetch, symbol, timeframe, start, end, True, force
            )

        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "provider": provider,
            "bar_count": len(df),
            "first_date": str(df.index[0].date()),
            "last_date": str(df.index[-1].date()),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data fetch failed: {e}")


@router.post("/fetch-many")
async def fetch_many(body: dict[str, Any]):
    """Download multiple symbols at once."""
    symbols = [s.upper() for s in body.get("symbols", [])]
    timeframe = body.get("timeframe", "1d")
    start = body.get("start", "2020-01-01")
    end = body.get("end", "2024-01-01")
    provider = body.get("provider", "yfinance")
    api_key = body.get("api_key", "")
    secret_key = body.get("secret_key", "")

    results = []
    for symbol in symbols:
        try:
            if provider == "alpaca":
                df = await asyncio.get_running_loop().run_in_executor(
                    None, alp_prov.fetch, symbol, timeframe, start, end, api_key, secret_key, False
                )
            else:
                df = await asyncio.get_running_loop().run_in_executor(
                    None, yf_prov.fetch, symbol, timeframe, start, end, True, False
                )
            results.append({"symbol": symbol, "status": "ok", "bar_count": len(df)})
        except Exception as e:
            results.append({"symbol": symbol, "status": "error", "error": str(e)})

    return {"results": results}


@router.delete("/cache/{symbol}/{timeframe}")
async def delete_cache(symbol: str, timeframe: str, provider: str = "yfinance"):
    """Delete a cached dataset."""
    symbol = symbol.upper()
    cache_file = _cache_file_for(symbol, timeframe, provider)
    if not cache_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No cache file found for {symbol}/{timeframe} (provider={provider})"
        )
    cache_file.unlink()
    return {"deleted": True, "symbol": symbol, "timeframe": timeframe, "provider": provider}


@router.get("/search")
async def search_tickers(
    q: str,
    limit: int = 15,
    provider: str = "yfinance",
    api_key: str = "",
    secret_key: str = "",
):
    """
    Search for ticker symbols.
    provider="yfinance" uses Yahoo Finance (no auth).
    provider="alpaca"   uses Alpaca Assets API (requires api_key + secret_key).
    """
    if not q or len(q) < 1:
        return {"results": [], "provider": provider}

    if provider == "alpaca":
        if not api_key or not secret_key:
            raise HTTPException(
                status_code=400,
                detail="api_key and secret_key required for Alpaca symbol search"
            )
        results = await asyncio.get_running_loop().run_in_executor(
            None, alp_prov.search_symbols, q, api_key, secret_key, limit
        )
    else:
        results = await asyncio.get_running_loop().run_in_executor(
            None, yf_prov.search_symbols, q, limit
        )

    return {"results": results, "provider": provider}
