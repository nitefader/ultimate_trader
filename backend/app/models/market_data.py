"""Local historical data cache models."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DataInventory(Base):
    """Index of what data has been downloaded and cached."""
    __tablename__ = "data_inventory"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    timeframe: Mapped[str] = mapped_column(String(16), nullable=False)  # 1m, 5m, 15m, 1h, 1d, 1wk
    source: Mapped[str] = mapped_column(String(64), default="yfinance")
    adjusted: Mapped[bool] = mapped_column(default=True)

    # Coverage
    first_date: Mapped[str] = mapped_column(String(32))
    last_date: Mapped[str] = mapped_column(String(32))
    bar_count: Mapped[int] = mapped_column(Integer, default=0)

    # Freshness
    last_updated: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # When the dataset file was downloaded to local cache (UTC)
    downloaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    is_complete: Mapped[bool] = mapped_column(default=False)

    # Storage path (parquet file in CACHE_DIR)
    file_path: Mapped[str] = mapped_column(String(512))

    __table_args__ = (
        UniqueConstraint("symbol", "timeframe", "source", name="uq_data_inventory"),
    )


class CachedBar(Base):
    """
    Individual OHLCV bars — used for small datasets.
    For large datasets we use parquet files and DataInventory just tracks the file.
    """
    __tablename__ = "cached_bars"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    timeframe: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)

    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float)

    __table_args__ = (
        UniqueConstraint("symbol", "timeframe", "timestamp", name="uq_cached_bar"),
    )
