"""Trade and ScaleEvent ORM models."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(ForeignKey("backtest_runs.id", ondelete="CASCADE"), index=True)
    strategy_version_id: Mapped[str | None] = mapped_column(String(36), index=True)

    # Symbol and direction
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    direction: Mapped[str] = mapped_column(String(8))  # long / short

    # Entry
    entry_time: Mapped[datetime] = mapped_column(DateTime)
    entry_price: Mapped[float] = mapped_column(Float)
    entry_order_type: Mapped[str] = mapped_column(String(32), default="market")
    initial_quantity: Mapped[float] = mapped_column(Float)
    initial_stop: Mapped[float | None] = mapped_column(Float)
    initial_target: Mapped[float | None] = mapped_column(Float)

    # Exit
    exit_time: Mapped[datetime | None] = mapped_column(DateTime)
    exit_price: Mapped[float | None] = mapped_column(Float)
    exit_quantity: Mapped[float | None] = mapped_column(Float)
    exit_reason: Mapped[str | None] = mapped_column(String(128))
    # Examples: stop_loss, target_1, target_2, trailing_stop, time_exit, reversal, kill_switch, manual

    # P&L
    realized_pnl: Mapped[float | None] = mapped_column(Float)
    commission: Mapped[float] = mapped_column(Float, default=0.0)
    slippage: Mapped[float] = mapped_column(Float, default=0.0)
    net_pnl: Mapped[float | None] = mapped_column(Float)
    return_pct: Mapped[float | None] = mapped_column(Float)
    r_multiple: Mapped[float | None] = mapped_column(Float)  # PnL / initial risk

    # State
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    max_adverse_excursion: Mapped[float | None] = mapped_column(Float)
    max_favorable_excursion: Mapped[float | None] = mapped_column(Float)

    # Context
    regime_at_entry: Mapped[str | None] = mapped_column(String(64))
    entry_conditions_fired: Mapped[list[str]] = mapped_column(JSON, default=list)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)

    run: Mapped["BacktestRun"] = relationship("BacktestRun", back_populates="trades")
    scale_events: Mapped[list["ScaleEvent"]] = relationship("ScaleEvent", back_populates="trade", cascade="all, delete-orphan")


class ScaleEvent(Base):
    """Records each scale-in or scale-out event for a trade."""
    __tablename__ = "scale_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    trade_id: Mapped[str] = mapped_column(ForeignKey("trades.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(16))  # scale_in / scale_out
    time: Mapped[datetime] = mapped_column(DateTime)
    price: Mapped[float] = mapped_column(Float)
    quantity: Mapped[float] = mapped_column(Float)
    quantity_pct: Mapped[float] = mapped_column(Float)  # % of original position
    reason: Mapped[str | None] = mapped_column(String(128))
    new_stop: Mapped[float | None] = mapped_column(Float)
    realized_pnl: Mapped[float | None] = mapped_column(Float)

    trade: Mapped[Trade] = relationship("Trade", back_populates="scale_events")
