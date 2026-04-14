"""Historical data cache management endpoints."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.services.market_data_service import (
    cache_path_for,
    fetch_market_data,
    get_inventory as get_inventory_entry,
    list_inventory as list_inventory_entries,
    search_symbols as search_market_symbols,
)
from app.services.market_metadata_service import (
    create_market_metadata_snapshot,
    get_latest_snapshot,
    get_snapshot_by_version,
    serialize_snapshot,
)
from app.services.watchlist_service import (
    create_watchlist,
    get_watchlist,
    list_watchlists as list_watchlist_entries,
    refresh_watchlist,
    set_watchlist_membership_state,
    serialize_watchlist,
)
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
    return cache_path_for(symbol, timeframe, provider)


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
    return {"items": list_inventory_entries()}


@router.get("/inventory/{symbol}/{timeframe}")
async def get_symbol_inventory(symbol: str, timeframe: str, provider: str = "yfinance"):
    info = get_inventory_entry(symbol, timeframe, provider)
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
        api_key = body.get("api_key", "") if provider == "alpaca" else ""
        secret_key = body.get("secret_key", "") if provider == "alpaca" else ""
        df = await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: fetch_market_data(
                symbol=symbol,
                timeframe=timeframe,
                start=start,
                end=end,
                provider=provider,
                adjusted=True,
                force_download=force,
                api_key=api_key,
                secret_key=secret_key,
            ),
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
            df = await asyncio.get_running_loop().run_in_executor(
                None,
                lambda symbol=symbol: fetch_market_data(
                    symbol=symbol,
                    timeframe=timeframe,
                    start=start,
                    end=end,
                    provider=provider,
                    adjusted=True,
                    force_download=False,
                    api_key=api_key,
                    secret_key=secret_key,
                ),
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
        None,
        lambda: search_market_symbols(
            query=q,
            provider=provider,
            max_results=limit,
            api_key=api_key,
            secret_key=secret_key,
        ),
    )

    return {"results": results, "provider": provider}


@router.post("/metadata/snapshots")
async def create_metadata_snapshot(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    symbols = [str(s).upper() for s in body.get("symbols", []) if str(s).strip()]
    as_of_date = body.get("as_of_date")
    provider = body.get("provider", "yfinance")
    if not symbols:
        raise HTTPException(status_code=400, detail="symbols required")
    if not as_of_date:
        raise HTTPException(status_code=400, detail="as_of_date required")

    try:
        snapshot = await create_market_metadata_snapshot(
            db,
            symbols=symbols,
            as_of_date=as_of_date,
            provider=provider,
            api_key=body.get("api_key", ""),
            secret_key=body.get("secret_key", ""),
            sector_overrides=body.get("sector_overrides", {}) or {},
            benchmark_overrides=body.get("benchmark_overrides", {}) or {},
        )
        await db.commit()
        await db.refresh(snapshot, attribute_names=["symbols"])
        return serialize_snapshot(snapshot)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Metadata snapshot creation failed: {exc}") from exc


@router.get("/metadata/snapshots/latest")
async def latest_metadata_snapshot(db: AsyncSession = Depends(get_db)):
    snapshot = await get_latest_snapshot(db)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="No market metadata snapshots found")
    return serialize_snapshot(snapshot)


@router.get("/metadata/snapshots/{metadata_version_id}")
async def metadata_snapshot_detail(metadata_version_id: str, db: AsyncSession = Depends(get_db)):
    snapshot = await get_snapshot_by_version(db, metadata_version_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Market metadata snapshot not found")
    return serialize_snapshot(snapshot)


@router.post("/watchlists")
async def create_watchlist_route(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")

    try:
        watchlist = await create_watchlist(
            db,
            name=name,
            watchlist_type=str(body.get("watchlist_type", "scanner")).strip() or "scanner",
            refresh_cron=body.get("refresh_cron"),
            min_refresh_interval_minutes=int(body.get("min_refresh_interval_minutes", 5)),
            config=body.get("config") or {},
        )
        if body.get("symbols") is not None:
            watchlist = await refresh_watchlist(db, watchlist.id, list(body.get("symbols") or []))
        await db.commit()
        await db.refresh(watchlist, attribute_names=["memberships"])
        return serialize_watchlist(watchlist)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Watchlist creation failed: {exc}") from exc


@router.get("/watchlists")
async def list_watchlists_route(db: AsyncSession = Depends(get_db)):
    watchlists = await list_watchlist_entries(db)
    return {"items": [serialize_watchlist(item) for item in watchlists]}


@router.get("/watchlists/{watchlist_id}")
async def watchlist_detail(watchlist_id: str, db: AsyncSession = Depends(get_db)):
    watchlist = await get_watchlist(db, watchlist_id)
    if watchlist is None:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return serialize_watchlist(watchlist)


@router.post("/watchlists/{watchlist_id}/refresh")
async def refresh_watchlist_route(watchlist_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    try:
        watchlist = await refresh_watchlist(db, watchlist_id, list(body.get("symbols") or []) if "symbols" in body else None)
        await db.commit()
        await db.refresh(watchlist, attribute_names=["memberships"])
        return serialize_watchlist(watchlist)
    except ValueError as exc:
        await db.rollback()
        status_code = 404 if str(exc) == "Watchlist not found" else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Watchlist refresh failed: {exc}") from exc


@router.post("/watchlists/{watchlist_id}/memberships/{symbol}/state")
async def set_watchlist_membership_state_route(
    watchlist_id: str,
    symbol: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
):
    requested_state = str(body.get("state", "")).strip().lower()
    if not requested_state:
        raise HTTPException(status_code=400, detail="state required")

    try:
        membership = await set_watchlist_membership_state(
            db,
            watchlist_id,
            symbol,
            state=requested_state,
            reason=body.get("reason"),
        )
        await db.commit()
        return {
            "symbol": membership.symbol,
            "state": membership.state,
            "resolved_at": membership.resolved_at.isoformat() if membership.resolved_at else None,
            "suspended_at": membership.suspended_at.isoformat() if membership.suspended_at else None,
            "metadata": membership.metadata_,
        }
    except ValueError as exc:
        await db.rollback()
        message = str(exc)
        status_code = 404 if message in {"Watchlist not found", "Watchlist membership not found"} else 400
        raise HTTPException(status_code=status_code, detail=message) from exc
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Membership state update failed: {exc}") from exc
