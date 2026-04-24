"""StrategyControls — controls *when* a strategy's signals are allowed to fire.

Covers: timeframe, session windows, regime filter, cooldown rules, PDT enforcement,
gap risk, and session-level entry caps. One controls instance can be reused across many programs.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StrategyControls(Base):
    __tablename__ = "strategy_controls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # Bar resolution
    timeframe: Mapped[str] = mapped_column(String(16), default="1d")  # 1m/5m/15m/30m/1h/4h/1d/1w
    duration_mode: Mapped[str] = mapped_column(String(16), default="swing")  # day/swing/position

    # Session windows — {entry_windows:[{start,end}], force_flat_by, timezone, skip_first_bar}
    market_hours: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # PDT enforcement — {enforce, max_day_trades_per_window, window_sessions, equity_threshold, on_limit_reached}
    pdt: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # Gap risk — {max_gap_pct, earnings_blackout, earnings_blackout_days_before, weekend_position_allowed}
    gap_risk: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # Regime filter — {allowed: ["trending_up", "trending_down", ...]}
    regime_filter: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # Cooldown rules — [{after: "loss", bars: 3, scope: "symbol"}, ...]
    cooldown_rules: Mapped[list[Any]] = mapped_column(JSON, default=list)

    # Session-level hard caps
    max_trades_per_session: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_trades_per_day: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    min_time_between_entries_min: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Explicit earnings gate (independent of gap_risk.earnings_blackout)
    earnings_blackout_enabled: Mapped[bool] = mapped_column(Boolean, default=False)

    # Template provenance
    is_golden: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_type: Mapped[str] = mapped_column(String(32), default="manual")  # manual/template

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
