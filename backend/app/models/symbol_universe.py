"""Persisted SymbolUniverse snapshots for optimizer and program lineage."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SymbolUniverseSnapshot(Base):
    __tablename__ = "symbol_universe_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_watchlist_id: Mapped[str] = mapped_column(String(36), index=True)
    overlay_watchlist_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    deny_list: Mapped[list[str]] = mapped_column(JSON, default=list)
    top_n: Mapped[int | None] = mapped_column(default=None)
    effective_date: Mapped[str] = mapped_column(String(32), index=True)
    resolved_symbols: Mapped[list[str]] = mapped_column(JSON, default=list)
    resolved_symbol_count: Mapped[int] = mapped_column(default=0)
    metadata_version_id: Mapped[str | None] = mapped_column(String(64), index=True)
    resolution_notes: Mapped[str | None] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(64), default="watchlist_resolver")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
