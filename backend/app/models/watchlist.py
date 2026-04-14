"""Watchlist and watchlist membership models."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Watchlist(Base):
    __tablename__ = "watchlists"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), index=True)
    watchlist_type: Mapped[str] = mapped_column(String(32), default="scanner")
    refresh_cron: Mapped[str | None] = mapped_column(String(64))
    min_refresh_interval_minutes: Mapped[int] = mapped_column(Integer, default=5)
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    memberships: Mapped[list["WatchlistMembership"]] = relationship(
        "WatchlistMembership",
        back_populates="watchlist",
        cascade="all, delete-orphan",
    )


class WatchlistMembership(Base):
    __tablename__ = "watchlist_memberships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    watchlist_id: Mapped[str] = mapped_column(ForeignKey("watchlists.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    state: Mapped[str] = mapped_column(String(32), default="candidate", index=True)
    resolved_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    candidate_since: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    active_since: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pending_removal_since: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    inactive_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)

    watchlist: Mapped[Watchlist] = relationship("Watchlist", back_populates="memberships")

    __table_args__ = (
        UniqueConstraint("watchlist_id", "symbol", "resolved_at", name="uq_watchlist_membership_resolution"),
    )
