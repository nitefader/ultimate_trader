"""DataService ORM model — shared Alpaca data credentials used by backtester and live accounts."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.security import decrypt_secret, encrypt_secret, mask_secret
from app.database import Base


class DataService(Base):
    __tablename__ = "data_services"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), default="alpaca")  # alpaca | yfinance (yfinance needs no keys)
    environment: Mapped[str] = mapped_column(String(16), default="paper")  # paper | live

    # Encrypted credentials
    api_key_encrypted: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    secret_key_encrypted: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # ── Credential helpers ────────────────────────────────────────────────

    @property
    def api_key(self) -> str:
        if not self.api_key_encrypted:
            return ""
        return decrypt_secret(self.api_key_encrypted)

    @api_key.setter
    def api_key(self, value: str) -> None:
        self.api_key_encrypted = encrypt_secret(value) if value else None

    @property
    def secret_key(self) -> str:
        if not self.secret_key_encrypted:
            return ""
        return decrypt_secret(self.secret_key_encrypted)

    @secret_key.setter
    def secret_key(self, value: str) -> None:
        self.secret_key_encrypted = encrypt_secret(value) if value else None

    @property
    def api_key_masked(self) -> str:
        return mask_secret(self.api_key) if self.api_key else ""

    @property
    def secret_key_masked(self) -> str:
        return mask_secret(self.secret_key) if self.secret_key else ""

    def has_credentials(self) -> bool:
        return bool(self.api_key) and bool(self.secret_key)

    def to_dict(self, unmask: bool = False) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "provider": self.provider,
            "environment": self.environment,
            "api_key": self.api_key if unmask else self.api_key_masked,
            "secret_key": self.secret_key if unmask else self.secret_key_masked,
            "has_credentials": self.has_credentials(),
            "is_default": self.is_default,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
