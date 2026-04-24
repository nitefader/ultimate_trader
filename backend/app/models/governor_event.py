"""GovernorEvent — audit log for Account Governor decisions."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class GovernorEvent(Base):
    __tablename__ = "governor_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    governor_id: Mapped[str] = mapped_column(ForeignKey("deployments.id", ondelete="CASCADE"), index=True)
    allocation_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    event_type: Mapped[str] = mapped_column(String(64), index=True)
    # collision_suppressed | correlation_blocked | risk_blocked |
    # universe_updated | halt_triggered | program_paused | fill_confirmed

    symbol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    emitted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
