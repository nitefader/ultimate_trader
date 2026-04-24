"""Account ORM model — paper and live accounts."""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import get_settings
from app.core.security import decrypt_broker_config, encrypt_broker_config
from app.database import Base


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), default="paper")  # paper / live
    broker: Mapped[str] = mapped_column(String(64), default="paper_broker")

    # Connection / credentials (encrypted storage)
    # Encrypted JSON structure: {"paper": {"api_key": "...", "secret_key": "..."}, "live": {...}}
    broker_config_encrypted: Mapped[str | None] = mapped_column(String(4096), nullable=True)

    # Balances
    initial_balance: Mapped[float] = mapped_column(Float, default=100_000.0)
    current_balance: Mapped[float] = mapped_column(Float, default=100_000.0)
    equity: Mapped[float] = mapped_column(Float, default=100_000.0)
    unrealized_pnl: Mapped[float] = mapped_column(Float, default=0.0)

    # Risk limits per account
    max_position_size_pct: Mapped[float] = mapped_column(Float, default=0.10)
    max_daily_loss_pct: Mapped[float] = mapped_column(Float, default=0.03)
    max_drawdown_lockout_pct: Mapped[float] = mapped_column(Float, default=0.10)
    max_open_positions: Mapped[int] = mapped_column(default=10)
    leverage: Mapped[float] = mapped_column(Float, default=1.0)

    risk_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("risk_profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    risk_profile: Mapped["RiskProfile | None"] = relationship(
        "RiskProfile", back_populates="accounts"
    )

    # Account mode — controls PDT rules, short selling, leverage availability
    # CASH: no shorts, no leverage, T+1 settlement, PDT inapplicable
    # MARGIN: short selling enabled, leverage up to max, PDT tracked if equity < $25k
    account_mode: Mapped[str] = mapped_column(String(16), default="margin")  # cash | margin

    # Status
    is_connected: Mapped[bool] = mapped_column(Boolean, default=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_killed: Mapped[bool] = mapped_column(Boolean, default=False)
    kill_reason: Mapped[str | None] = mapped_column(String(255))

    # Symbol restrictions
    allowed_symbols: Mapped[list[str]] = mapped_column(JSON, default=list)  # empty = all allowed
    blocked_symbols: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Data service: None = "self" (use own creds), or FK to a DataService
    data_service_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    deployments: Mapped[list["Deployment"]] = relationship("Deployment", back_populates="account")

    @property
    def broker_config(self) -> dict[str, Any]:
        if not self.broker_config_encrypted:
            return {}
        return decrypt_broker_config(json.loads(self.broker_config_encrypted))

    @broker_config.setter
    def broker_config(self, value: dict[str, Any]) -> None:
        if not value:
            self.broker_config_encrypted = None
            return
        encrypted = encrypt_broker_config(value)
        self.broker_config_encrypted = json.dumps(encrypted)

    def has_alpaca_credentials(self) -> bool:
        """Return True if this account has both api_key and secret_key for its mode."""
        config = self.broker_config
        mode_config = config.get(self.mode, {})
        return bool(mode_config.get("api_key")) and bool(mode_config.get("secret_key"))
