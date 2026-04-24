"""RiskProfile — standalone reusable risk configuration entity.

One profile can be attached to many accounts. Accounts without a profile
fall back to their own inline risk columns.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RiskProfile(Base):
    __tablename__ = "risk_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # Directional limits — Long side
    max_open_positions_long: Mapped[int] = mapped_column(Integer, default=5)
    max_portfolio_heat_long: Mapped[float] = mapped_column(Float, default=0.06)
    max_correlated_exposure_long: Mapped[float] = mapped_column(Float, default=1.0)
    max_position_size_pct_long: Mapped[float] = mapped_column(Float, default=0.10)

    # Directional limits — Short side
    max_open_positions_short: Mapped[int] = mapped_column(Integer, default=3)
    max_portfolio_heat_short: Mapped[float] = mapped_column(Float, default=0.04)
    max_correlated_exposure_short: Mapped[float] = mapped_column(Float, default=0.80)
    max_position_size_pct_short: Mapped[float] = mapped_column(Float, default=0.08)

    # Account-wide combined limits
    max_daily_loss_pct: Mapped[float] = mapped_column(Float, default=0.03)
    max_drawdown_lockout_pct: Mapped[float] = mapped_column(Float, default=0.10)
    max_leverage: Mapped[float] = mapped_column(Float, default=2.0)

    # Generation provenance
    source_type: Mapped[str] = mapped_column(String(32), default="manual")  # manual | backtest | optimizer
    source_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_optimization_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    is_golden: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    accounts: Mapped[list["Account"]] = relationship("Account", back_populates="risk_profile")
