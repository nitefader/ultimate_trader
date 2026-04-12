"""Kill switch event log."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class KillSwitchEvent(Base):
    __tablename__ = "kill_switch_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    scope: Mapped[str] = mapped_column(String(32))   # global / account / strategy / deployment
    scope_id: Mapped[str | None] = mapped_column(String(36))   # the account/strategy/deployment id
    action: Mapped[str] = mapped_column(String(32))  # kill / pause / flatten / resume
    reason: Mapped[str | None] = mapped_column(String(512))
    triggered_by: Mapped[str] = mapped_column(String(128), default="user")
    triggered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, server_default=func.now())
