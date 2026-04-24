"""ExecutionStyle — Alpaca order mechanics for a program.

Covers: entry order type, time-in-force, limit offset, bracket/OCO/trailing stop
configuration, scale-out levels, and backtest fill/cost assumptions.
One style can be reused across many programs.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ExecutionStyle(Base):
    __tablename__ = "execution_styles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # Entry order
    entry_order_type: Mapped[str] = mapped_column(String(32), default="market")  # market/limit/stop/stop_limit
    entry_time_in_force: Mapped[str] = mapped_column(String(16), default="day")  # day/gtc/ioc/opg/cls

    # Limit offset (for limit/stop_limit entry types)
    entry_limit_offset_method: Mapped[str | None] = mapped_column(String(16), nullable=True)  # atr/pct/fixed
    entry_limit_offset_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    entry_cancel_after_bars: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Exit bracket / OCO / trailing
    bracket_mode: Mapped[str] = mapped_column(String(32), default="bracket")  # none/bracket/oco/trailing_stop
    stop_order_type: Mapped[str] = mapped_column(String(32), default="market")   # market/limit (stop leg)
    take_profit_order_type: Mapped[str] = mapped_column(String(32), default="limit")  # market/limit (TP leg)

    # Trailing stop (when bracket_mode = trailing_stop)
    trailing_stop_type: Mapped[str | None] = mapped_column(String(16), nullable=True)  # percent/dollar
    trailing_stop_value: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Scale-out levels — [{pct: 50}, {pct: 20}, ...]
    scale_out: Mapped[list[Any]] = mapped_column(JSON, default=list)
    # ATR multipliers per scale level: [0.0, 0.85, 0.95, 1.15]
    # Index 0 = initial (before fills), index N = after Nth scale level fills
    # Formula for longs: stop = entry + ATR * mult (positive = above entry = locked profit)
    stop_progression_targets: Mapped[list[Any]] = mapped_column(JSON, default=list)

    # ATR source — controls which ATR value is used for stop distance calculations
    # "strategy" = use the ATR provided by the strategy's feature engine
    # "custom"   = override with a specific length + timeframe
    atr_source: Mapped[str] = mapped_column(String(16), default="strategy")  # strategy/custom
    atr_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    atr_timeframe: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Breakeven / Entry Reset — replaces move_stop_to_be_after_t1 bool
    # 1-indexed: 1 = trigger after T1, 2 = after T2, None = disabled
    breakeven_trigger_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # ATR offset from entry: 0.0 = exact entry, >0 = profit buffer, <0 = accept small loss
    breakeven_atr_offset: Mapped[float] = mapped_column(Float, default=0.0)

    # Final runner exit — what happens to the remaining position after all scale levels fill
    final_runner_exit_mode: Mapped[str] = mapped_column(String(32), default="internal")  # internal/alpaca_trailing
    final_runner_trail_type: Mapped[str | None] = mapped_column(String(16), nullable=True)   # percent/price
    final_runner_trail_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_runner_time_in_force: Mapped[str | None] = mapped_column(String(8), nullable=True)  # day/gtc

    # Backtest fill assumptions
    fill_model: Mapped[str] = mapped_column(String(32), default="next_open")  # next_open/bar_close/vwap_proxy
    slippage_bps_assumption: Mapped[float] = mapped_column(Float, default=5.0)
    commission_per_share: Mapped[float] = mapped_column(Float, default=0.005)

    # Template provenance
    is_golden: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_type: Mapped[str] = mapped_column(String(32), default="manual")

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
