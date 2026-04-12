"""Strategy and StrategyVersion ORM models."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Strategy(Base):
    __tablename__ = "strategies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(64), default="custom")  # momentum, mean_reversion, custom
    status: Mapped[str] = mapped_column(String(32), default="draft")  # draft, active, archived
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    versions: Mapped[list["StrategyVersion"]] = relationship("StrategyVersion", back_populates="strategy", cascade="all, delete-orphan")
    deployments: Mapped[list["Deployment"]] = relationship("Deployment", back_populates="strategy")


class StrategyVersion(Base):
    __tablename__ = "strategy_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    strategy_id: Mapped[str] = mapped_column(ForeignKey("strategies.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(default=1)

    # Full strategy definition as JSON — portable across modes
    config: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    # Metadata
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(String(128), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Promotion chain
    promoted_from_run_id: Mapped[str | None] = mapped_column(String(36))  # backtest run that triggered promotion
    promotion_status: Mapped[str] = mapped_column(String(32), default="backtest_only")
    # backtest_only → paper_approved → live_approved

    strategy: Mapped[Strategy] = relationship("Strategy", back_populates="versions")
    runs: Mapped[list] = relationship("BacktestRun", back_populates="strategy_version")
