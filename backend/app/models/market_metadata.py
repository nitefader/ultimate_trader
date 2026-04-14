"""Versioned market metadata snapshots used by optimizers and universe tooling."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MarketMetadataSnapshot(Base):
    __tablename__ = "market_metadata_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    metadata_version_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    as_of_date: Mapped[str] = mapped_column(String(32), index=True)
    symbol_count: Mapped[int] = mapped_column(Integer, default=0)
    correlation_window_days: Mapped[int] = mapped_column(Integer, default=60)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    symbols: Mapped[list["MarketMetadataSymbol"]] = relationship(
        "MarketMetadataSymbol",
        back_populates="snapshot",
        cascade="all, delete-orphan",
    )


class MarketMetadataSymbol(Base):
    __tablename__ = "market_metadata_symbols"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("market_metadata_snapshots.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    sector_tag: Mapped[str] = mapped_column(String(128), default="unknown")
    benchmark_symbol: Mapped[str] = mapped_column(String(32), default="SPY")
    realized_vol_30d: Mapped[float | None] = mapped_column(Float)
    avg_pairwise_correlation_60d: Mapped[float | None] = mapped_column(Float)
    adv_usd_30d: Mapped[float | None] = mapped_column(Float)
    spread_proxy_bps_30d: Mapped[float | None] = mapped_column(Float)
    regime_tag: Mapped[str] = mapped_column(String(32), default="unknown")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    snapshot: Mapped[MarketMetadataSnapshot] = relationship("MarketMetadataSnapshot", back_populates="symbols")

    __table_args__ = (
        UniqueConstraint("snapshot_id", "symbol", name="uq_market_metadata_snapshot_symbol"),
    )
