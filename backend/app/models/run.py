"""BacktestRun and RunMetrics ORM models."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class BacktestRun(Base):
    __tablename__ = "backtest_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    strategy_version_id: Mapped[str] = mapped_column(ForeignKey("strategy_versions.id"), index=True)

    # Mode context
    mode: Mapped[str] = mapped_column(String(16), default="backtest")  # backtest / paper / live
    status: Mapped[str] = mapped_column(String(32), default="pending")
    # pending → running → completed / failed / cancelled

    # Configuration snapshot
    symbols: Mapped[list[str]] = mapped_column(JSON, default=list)
    timeframe: Mapped[str] = mapped_column(String(16), default="1d")
    start_date: Mapped[str] = mapped_column(String(32))
    end_date: Mapped[str] = mapped_column(String(32))
    initial_capital: Mapped[float] = mapped_column(Float, default=100_000.0)
    commission_per_share: Mapped[float] = mapped_column(Float, default=0.005)
    slippage_ticks: Mapped[int] = mapped_column(Integer, default=1)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # Timing
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)

    # Error info
    error_message: Mapped[str | None] = mapped_column(Text)

    # Relationships
    strategy_version: Mapped["StrategyVersion"] = relationship("StrategyVersion", back_populates="runs")
    trades: Mapped[list["Trade"]] = relationship("Trade", back_populates="run", cascade="all, delete-orphan")
    metrics: Mapped["RunMetrics"] = relationship("RunMetrics", back_populates="run", uselist=False, cascade="all, delete-orphan")


class RunMetrics(Base):
    __tablename__ = "run_metrics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(ForeignKey("backtest_runs.id", ondelete="CASCADE"), unique=True)

    # Return metrics
    total_return_pct: Mapped[float | None] = mapped_column(Float)
    cagr_pct: Mapped[float | None] = mapped_column(Float)
    sharpe_ratio: Mapped[float | None] = mapped_column(Float)
    sortino_ratio: Mapped[float | None] = mapped_column(Float)
    calmar_ratio: Mapped[float | None] = mapped_column(Float)

    # Drawdown
    max_drawdown_pct: Mapped[float | None] = mapped_column(Float)
    max_drawdown_duration_days: Mapped[int | None] = mapped_column(Integer)
    recovery_factor: Mapped[float | None] = mapped_column(Float)

    # Trade stats
    total_trades: Mapped[int | None] = mapped_column(Integer)
    winning_trades: Mapped[int | None] = mapped_column(Integer)
    losing_trades: Mapped[int | None] = mapped_column(Integer)
    win_rate_pct: Mapped[float | None] = mapped_column(Float)
    avg_win_pct: Mapped[float | None] = mapped_column(Float)
    avg_loss_pct: Mapped[float | None] = mapped_column(Float)
    expectancy: Mapped[float | None] = mapped_column(Float)
    profit_factor: Mapped[float | None] = mapped_column(Float)

    # Exposure
    avg_hold_days: Mapped[float | None] = mapped_column(Float)
    exposure_pct: Mapped[float | None] = mapped_column(Float)
    long_trades: Mapped[int | None] = mapped_column(Integer)
    short_trades: Mapped[int | None] = mapped_column(Integer)

    # Detailed breakdowns (stored as JSON)
    monthly_returns: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    equity_curve: Mapped[list] = mapped_column(JSON, default=list)          # [{date, equity, drawdown}]
    exit_reason_breakdown: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    regime_breakdown: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    monte_carlo: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    walk_forward: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    run: Mapped[BacktestRun] = relationship("BacktestRun", back_populates="metrics")
