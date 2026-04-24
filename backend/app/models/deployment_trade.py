"""DeploymentTrade — records simulated or live fills for a running deployment."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class DeploymentTrade(Base):
    """
    A single trade (entry + exit) recorded by the paper or live broker for a deployment.

    Paper trades are simulated fills. Live trades mirror Alpaca order fills.
    Open trades have exit_time=None and is_open=True.
    """
    __tablename__ = "deployment_trades"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    deployment_id: Mapped[str] = mapped_column(ForeignKey("deployments.id", ondelete="CASCADE"), index=True)
    strategy_version_id: Mapped[str | None] = mapped_column(String(36), index=True)

    symbol: Mapped[str] = mapped_column(String(32), index=True)
    direction: Mapped[str] = mapped_column(String(8))  # long / short

    # Entry
    entry_time: Mapped[datetime] = mapped_column(DateTime)
    entry_price: Mapped[float] = mapped_column(Float)
    quantity: Mapped[float] = mapped_column(Float)
    initial_stop: Mapped[float | None] = mapped_column(Float)
    initial_risk: Mapped[float | None] = mapped_column(Float)  # dollar risk at entry

    # Exit (None while open)
    exit_time: Mapped[datetime | None] = mapped_column(DateTime)
    exit_price: Mapped[float | None] = mapped_column(Float)
    exit_reason: Mapped[str | None] = mapped_column(String(128))

    # P&L (populated on close)
    gross_pnl: Mapped[float | None] = mapped_column(Float)
    commission: Mapped[float] = mapped_column(Float, default=0.0)
    net_pnl: Mapped[float | None] = mapped_column(Float)
    r_multiple: Mapped[float | None] = mapped_column(Float)

    # State
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)

    # Current unrealized data (updated each poll cycle for open trades)
    current_price: Mapped[float | None] = mapped_column(Float)
    unrealized_pnl: Mapped[float | None] = mapped_column(Float)
    current_stop: Mapped[float | None] = mapped_column(Float)

    # Stop ownership: "internal" = engine manages via replace_order;
    # "broker" = Alpaca trailing stop is live, engine must not submit competing stops
    stop_control: Mapped[str] = mapped_column(String(16), default="internal")
    # Alpaca order ID of the active stop/trailing-stop leg (None = no live stop order yet)
    alpaca_stop_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Context
    regime_at_entry: Mapped[str | None] = mapped_column(String(64))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    deployment: Mapped["Deployment"] = relationship("Deployment", back_populates="trades")
