"""Versioned market metadata snapshot service."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import pandas as pd
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.source_contracts import resolve_requested_provider
from app.models.market_metadata import MarketMetadataSnapshot, MarketMetadataSymbol
from app.services.market_data_service import fetch_market_data


def _annualized_realized_vol(close: pd.Series, window: int = 30) -> float | None:
    returns = close.pct_change(fill_method=None).dropna()
    if len(returns) < max(window, 2):
        return None
    sample = returns.tail(window)
    std = float(sample.std(ddof=1))
    if std <= 1e-12:
        return 0.0
    return round(std * (252 ** 0.5), 6)


def _pairwise_correlation_summary(price_frames: dict[str, pd.DataFrame], window: int = 60) -> dict[str, float | None]:
    close_map = {
        symbol: df["close"].astype("float64")
        for symbol, df in price_frames.items()
        if df is not None and not df.empty and "close" in df.columns
    }
    if not close_map:
        return {}

    close_df = pd.DataFrame(close_map).sort_index()
    returns_df = close_df.pct_change(fill_method=None).dropna().tail(window)
    if returns_df.empty or returns_df.shape[1] == 1:
        return {symbol: None for symbol in close_map}

    corr = returns_df.corr()
    summary: dict[str, float | None] = {}
    for symbol in corr.columns:
        peers = corr.loc[symbol].drop(labels=[symbol], errors="ignore").dropna()
        summary[symbol] = None if peers.empty else round(float(peers.mean()), 6)
    return summary


def _average_daily_dollar_volume(frame: pd.DataFrame, window: int = 30) -> float | None:
    required = {"close", "volume"}
    if frame is None or frame.empty or not required.issubset(frame.columns):
        return None
    sample = frame.tail(window)
    if sample.empty:
        return None
    adv = (sample["close"].astype("float64") * sample["volume"].astype("float64")).mean()
    return round(float(adv), 2)


def _spread_proxy_bps(frame: pd.DataFrame, window: int = 30) -> float | None:
    required = {"high", "low", "close"}
    if frame is None or frame.empty or not required.issubset(frame.columns):
        return None
    sample = frame.tail(window)
    denominator = sample["close"].replace(0, pd.NA).astype("float64")
    ratio = ((sample["high"].astype("float64") - sample["low"].astype("float64")) / denominator).dropna()
    if ratio.empty:
        return None
    return round(float(ratio.mean()) * 10_000, 4)


def _regime_tag(frame: pd.DataFrame, short_window: int = 20, long_window: int = 60) -> str:
    if frame is None or frame.empty or "close" not in frame.columns:
        return "unknown"
    close = frame["close"].astype("float64")
    if len(close) < max(short_window, long_window):
        return "unknown"
    short_ma = float(close.tail(short_window).mean())
    long_ma = float(close.tail(long_window).mean())
    if short_ma > long_ma * 1.01:
        return "bull"
    if short_ma < long_ma * 0.99:
        return "bear"
    return "sideways"


async def create_market_metadata_snapshot(
    db: AsyncSession,
    *,
    symbols: list[str],
    as_of_date: str,
    provider: str = "auto",
    api_key: str = "",
    secret_key: str = "",
    sector_overrides: dict[str, str] | None = None,
    benchmark_overrides: dict[str, str] | None = None,
) -> MarketMetadataSnapshot:
    normalized_symbols = sorted({str(symbol).upper() for symbol in symbols if str(symbol).strip()})
    if not normalized_symbols:
        raise ValueError("At least one symbol is required")

    end_ts = pd.Timestamp(as_of_date)
    start_ts = (end_ts - pd.Timedelta(days=120)).strftime("%Y-%m-%d")
    end_str = end_ts.strftime("%Y-%m-%d")

    sector_overrides = {k.upper(): v for k, v in (sector_overrides or {}).items()}
    benchmark_overrides = {k.upper(): v for k, v in (benchmark_overrides or {}).items()}
    selected_provider = resolve_requested_provider(
        requested_provider=provider,
        runtime_mode="research",
        alpaca_credentials_configured=bool(api_key and secret_key),
    )

    price_frames: dict[str, pd.DataFrame] = {}
    for symbol in normalized_symbols:
        df = fetch_market_data(
            symbol=symbol,
            timeframe="1d",
            start=start_ts,
            end=end_str,
            provider=selected_provider,
            adjusted=True,
            force_download=False,
            api_key=api_key,
            secret_key=secret_key,
        )
        if df is not None and not df.empty:
            price_frames[symbol] = df

    corr_summary = _pairwise_correlation_summary(price_frames, window=60)
    metadata_version_id = f"md_{end_ts.strftime('%Y%m%d')}_{uuid.uuid4().hex[:8]}"

    snapshot = MarketMetadataSnapshot(
        metadata_version_id=metadata_version_id,
        as_of_date=end_str,
        provider_requested=(provider or "auto").strip().lower(),
        provider_used=selected_provider,
        fetch_start_date=start_ts,
        fetch_end_date=end_str,
        symbol_count=len(normalized_symbols),
        correlation_window_days=60,
    )
    db.add(snapshot)
    await db.flush()

    for symbol in normalized_symbols:
        frame = price_frames.get(symbol)
        realized_vol = _annualized_realized_vol(frame["close"], window=30) if frame is not None and "close" in frame.columns else None
        db.add(
            MarketMetadataSymbol(
                snapshot_id=snapshot.id,
                symbol=symbol,
                sector_tag=sector_overrides.get(symbol, "unknown"),
                benchmark_symbol=benchmark_overrides.get(symbol, "SPY"),
                realized_vol_30d=realized_vol,
                avg_pairwise_correlation_60d=corr_summary.get(symbol),
                adv_usd_30d=_average_daily_dollar_volume(frame, window=30) if frame is not None else None,
                spread_proxy_bps_30d=_spread_proxy_bps(frame, window=30) if frame is not None else None,
                regime_tag=_regime_tag(frame) if frame is not None else "unknown",
            )
        )

    await db.flush()
    await db.refresh(snapshot)
    return snapshot


def serialize_snapshot(snapshot: MarketMetadataSnapshot) -> dict[str, Any]:
    return {
        "id": snapshot.id,
        "metadata_version_id": snapshot.metadata_version_id,
        "as_of_date": snapshot.as_of_date,
        "provider_requested": snapshot.provider_requested,
        "provider_used": snapshot.provider_used,
        "fetch_start_date": snapshot.fetch_start_date,
        "fetch_end_date": snapshot.fetch_end_date,
        "symbol_count": snapshot.symbol_count,
        "correlation_window_days": snapshot.correlation_window_days,
        "created_at": snapshot.created_at.isoformat() if snapshot.created_at else None,
        "symbols": [
            {
                "symbol": item.symbol,
                "sector_tag": item.sector_tag,
                "benchmark_symbol": item.benchmark_symbol,
                "realized_vol_30d": item.realized_vol_30d,
                "avg_pairwise_correlation_60d": item.avg_pairwise_correlation_60d,
                "adv_usd_30d": item.adv_usd_30d,
                "spread_proxy_bps_30d": item.spread_proxy_bps_30d,
                "regime_tag": item.regime_tag,
            }
            for item in sorted(snapshot.symbols, key=lambda row: row.symbol)
        ],
    }


async def get_latest_snapshot(db: AsyncSession) -> MarketMetadataSnapshot | None:
    result = await db.execute(
        select(MarketMetadataSnapshot)
        .order_by(desc(MarketMetadataSnapshot.created_at))
    )
    snapshot = result.scalars().first()
    if snapshot is None:
        return None
    await db.refresh(snapshot, attribute_names=["symbols"])
    return snapshot


async def get_snapshot_by_version(db: AsyncSession, metadata_version_id: str) -> MarketMetadataSnapshot | None:
    result = await db.execute(
        select(MarketMetadataSnapshot)
        .where(MarketMetadataSnapshot.metadata_version_id == metadata_version_id)
    )
    snapshot = result.scalar_one_or_none()
    if snapshot is None:
        return None
    await db.refresh(snapshot, attribute_names=["symbols"])
    return snapshot
