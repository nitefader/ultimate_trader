"""ValidationEvidence ORM model for backtest robustness evidence."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ValidationEvidence(Base):
    __tablename__ = "validation_evidence"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(ForeignKey("backtest_runs.id", ondelete="CASCADE"), unique=True, index=True)

    method: Mapped[str] = mapped_column(String(32), default="cpcv_walk_forward")
    cpcv: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    walk_forward: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    anti_bias: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    regime_performance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    per_symbol_oos_sharpe: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    cost_sensitivity_curve: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_oos_degradation_ratio: Mapped[float | None] = mapped_column(Float)
    stability_score: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    run: Mapped["BacktestRun"] = relationship("BacktestRun", back_populates="validation_evidence")
