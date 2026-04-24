"""Deployment and approval tracking — promotion workflow."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Deployment(Base):
    """
    A strategy version deployed to an account in a specific mode.
    Tracks the full paper → live promotion lifecycle.
    """
    __tablename__ = "deployments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    strategy_id: Mapped[str] = mapped_column(ForeignKey("strategies.id"), index=True)
    strategy_version_id: Mapped[str] = mapped_column(ForeignKey("strategy_versions.id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)

    mode: Mapped[str] = mapped_column(String(16))   # backtest / paper / live
    status: Mapped[str] = mapped_column(String(32), default="pending")
    # pending → running → paused → stopped → failed

    # Config overrides for this deployment (can differ from strategy defaults)
    config_overrides: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # Lifecycle
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime)
    stop_reason: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # Promotion source
    promoted_from_deployment_id: Mapped[str | None] = mapped_column(String(36))  # paper deployment that promoted to live
    promoted_from_run_id: Mapped[str | None] = mapped_column(String(36))

    # Governor identity
    governor_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    governor_status: Mapped[str] = mapped_column(String(32), default="active")
    # active | initializing | paused | halted

    # Risk profile link
    risk_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    # Governor poll configuration
    poll_config: Mapped[dict] = mapped_column(JSON, default=dict)

    # Collision + correlation state (ephemeral snapshot for UI)
    collision_state_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    correlation_data_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Daily accounting
    session_realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    daily_loss_lockout_triggered: Mapped[bool] = mapped_column(Boolean, default=False)

    # Halt info
    halt_trigger: Mapped[str | None] = mapped_column(String(64), nullable=True)
    halt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Observability
    last_governor_tick_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    strategy: Mapped["Strategy"] = relationship("Strategy", back_populates="deployments")
    account: Mapped["Account"] = relationship("Account", back_populates="deployments")
    approvals: Mapped[list["DeploymentApproval"]] = relationship("DeploymentApproval", back_populates="deployment", cascade="all, delete-orphan")
    trades: Mapped[list["DeploymentTrade"]] = relationship("DeploymentTrade", back_populates="deployment", cascade="all, delete-orphan")


class DeploymentApproval(Base):
    """Explicit approval record for mode promotion."""
    __tablename__ = "deployment_approvals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    deployment_id: Mapped[str] = mapped_column(ForeignKey("deployments.id", ondelete="CASCADE"), index=True)

    # What mode was approved to move into
    from_mode: Mapped[str] = mapped_column(String(16))  # backtest / paper
    to_mode: Mapped[str] = mapped_column(String(16))    # paper / live

    approved_by: Mapped[str] = mapped_column(String(128), default="user")
    approved_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    notes: Mapped[str | None] = mapped_column(Text)

    # Safety checklist results at approval time
    safety_checklist: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    deployment: Mapped[Deployment] = relationship("Deployment", back_populates="approvals")
