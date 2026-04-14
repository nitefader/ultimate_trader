"""Optimizer lineage models for institutional portfolio construction."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class OptimizationProfile(Base):
    __tablename__ = "optimization_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    strategy_version_id: Mapped[str | None] = mapped_column(ForeignKey("strategy_versions.id"), index=True)
    validation_evidence_id: Mapped[str | None] = mapped_column(ForeignKey("validation_evidence.id"), index=True)
    symbol_universe_snapshot_id: Mapped[str | None] = mapped_column(ForeignKey("symbol_universe_snapshots.id"), index=True)

    name: Mapped[str] = mapped_column(String(255), default="Optimization Profile")
    engine_id: Mapped[str] = mapped_column(String(64), index=True)
    engine_version: Mapped[str] = mapped_column(String(32), default="1")
    status: Mapped[str] = mapped_column(String(32), default="draft")

    objective_config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    covariance_model: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    constraints: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(String(500))

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    weight_profiles: Mapped[list["WeightProfile"]] = relationship(
        "WeightProfile",
        back_populates="optimization_profile",
        cascade="all, delete-orphan",
    )


class WeightProfile(Base):
    __tablename__ = "weight_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    optimization_profile_id: Mapped[str] = mapped_column(ForeignKey("optimization_profiles.id", ondelete="CASCADE"), index=True)
    parent_weight_profile_id: Mapped[str | None] = mapped_column(ForeignKey("weight_profiles.id"), index=True)

    engine_id: Mapped[str] = mapped_column(String(64), index=True)
    engine_version: Mapped[str] = mapped_column(String(32), default="1")
    evidence_id: Mapped[str | None] = mapped_column(ForeignKey("validation_evidence.id"), index=True)
    symbol_universe_snapshot_id: Mapped[str | None] = mapped_column(ForeignKey("symbol_universe_snapshots.id"), index=True)
    metadata_version_id: Mapped[str | None] = mapped_column(String(64), index=True)

    objective_used: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    constraints_used: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    covariance_model_used: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    input_universe_snapshot: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    output_weights: Mapped[dict[str, float]] = mapped_column(JSON, default=dict)
    explain_output: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    optimization_profile: Mapped[OptimizationProfile] = relationship("OptimizationProfile", back_populates="weight_profiles")
    parent_weight_profile: Mapped["WeightProfile | None"] = relationship("WeightProfile", remote_side=[id])
