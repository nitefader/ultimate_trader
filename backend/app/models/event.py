"""Market event calendar and strategy event filters."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MarketEvent(Base):
    __tablename__ = "market_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(64))  # macro, earnings, fed, cpi, nfp, custom
    symbol: Mapped[str | None] = mapped_column(String(32), index=True)  # None = market-wide
    event_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    impact: Mapped[str] = mapped_column(String(16), default="high")  # low, medium, high
    source: Mapped[str] = mapped_column(String(64), default="manual")
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class EventFilter(Base):
    """Per-strategy event filter configuration."""
    __tablename__ = "event_filters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    strategy_version_id: Mapped[str] = mapped_column(String(36), index=True)

    # Categories to filter
    categories: Mapped[list[str]] = mapped_column(JSON, default=list)  # which event types to honor
    impact_levels: Mapped[list[str]] = mapped_column(JSON, default=["high"])

    # Time windows around events
    minutes_before: Mapped[int] = mapped_column(default=30)
    minutes_after: Mapped[int] = mapped_column(default=30)

    # Actions
    close_positions_before: Mapped[bool] = mapped_column(Boolean, default=False)
    minutes_before_close: Mapped[int] = mapped_column(default=15)
    reduce_size_pct: Mapped[float] = mapped_column(Float, default=0.0)  # 0 = disable entirely
    disable_entries: Mapped[bool] = mapped_column(Boolean, default=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
