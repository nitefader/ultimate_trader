"""TradingProgram and AccountAllocation ORM models.

Architecture
------------
TradingProgram is a frozen, versioned deployment template.

    TradingProgram
        └─ strategy_version_id      → StrategyVersion (immutable once frozen)
        └─ optimization_profile_id  → OptimizationProfile
        └─ weight_profile_id        → WeightProfile
        └─ symbol_universe_snapshot_id → SymbolUniverseSnapshot
        └─ execution_policy         → JSON (order type, fill model, slippage assumptions)

Any change to logic, universe, or optimizer → new TradingProgram version.
The saved program is deployed to accounts via AccountAllocation and becomes
locked while any active allocation exists.

AccountAllocation
-----------------
Binds a TradingProgram to an Account with bounded per-allocation overrides:
    - position_size_scale_pct   ±20% of program's base position sizing
    - session_window_shift_min  ±30 min shift of entry/exit window
    - drawdown_threshold_pct    override program's drawdown halt threshold

These overrides live on AccountAllocation, not TradingProgram.
The program itself stays frozen.

Conflict resolution policy (per allocation):
    FIRST_WINS (default): second signal for same symbol on same account suppressed
    AGGREGATE: explicit opt-in — net exposure across programs (disables per-program P&L isolation)

Status lifecycle:
    draft → frozen → deprecated
    Allocation: pending → paper → promoted_to_live | paused | stopped
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.strategy_governor import StrategyControls
from app.models.execution_style import ExecutionStyle
from app.models.risk_profile import RiskProfile


class TradingProgram(Base):
    """
    Frozen deployment template.
    Any change to logic/universe/optimizer/weights → new row.
    """
    __tablename__ = "trading_programs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Human-readable identity
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[int] = mapped_column(default=1)
    description: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)

    # Lineage — all component refs captured at freeze time
    strategy_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("strategy_versions.id"), index=True
    )
    optimization_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("optimization_profiles.id"), index=True
    )
    weight_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("weight_profiles.id"), index=True
    )
    symbol_universe_snapshot_id: Mapped[str | None] = mapped_column(
        ForeignKey("symbol_universe_snapshots.id"), index=True
    )

    # ExecutionPolicy — serialized at freeze time so it cannot drift
    # Keys: order_type (market|limit|bracket), time_in_force (day|gtc|ioc),
    #       fill_model (next_open|bar_close|vwap_proxy),
    #       slippage_bps_assumption, commission_per_share
    execution_policy: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # Duration mode snapshot from StrategyVersion at freeze time (denormalized for fast reads)
    duration_mode: Mapped[str] = mapped_column(String(16), default="swing")

    # Universe mode
    universe_mode: Mapped[str] = mapped_column(String(16), default="snapshot")
    # snapshot = frozen SymbolUniverseSnapshot; live_feed = polled from watchlists

    watchlist_subscriptions: Mapped[list[str]] = mapped_column(JSON, default=list)
    watchlist_combination_rule: Mapped[str] = mapped_column(String(32), default="union")
    # union | intersection | primary_only

    live_universe_deny_list: Mapped[list[str]] = mapped_column(JSON, default=list)
    live_universe_top_n: Mapped[int | None] = mapped_column(Integer, nullable=True)
    live_universe_resolved_symbols: Mapped[list[str]] = mapped_column(JSON, default=list)
    live_universe_resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    universe_poll_override_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Lifecycle
    # draft:      editable, not yet deployable
    # frozen:     locked — all component refs finalized, deployable
    # deprecated: superseded by a newer version; existing allocations can finish
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)

    frozen_at: Mapped[datetime | None] = mapped_column(DateTime)
    frozen_by: Mapped[str | None] = mapped_column(String(128))
    deprecation_reason: Mapped[str | None] = mapped_column(String(500))

    # Five-component architecture FKs
    strategy_governor_id: Mapped[str | None] = mapped_column(
        ForeignKey("strategy_controls.id"), index=True
    )
    execution_style_id: Mapped[str | None] = mapped_column(
        ForeignKey("execution_styles.id"), index=True
    )
    risk_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("risk_profiles.id"), index=True
    )

    # Promotion lineage — which program this was cloned/promoted from
    parent_program_id: Mapped[str | None] = mapped_column(
        ForeignKey("trading_programs.id"), index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_by: Mapped[str] = mapped_column(String(128), default="system")

    # Relationships
    strategy_controls: Mapped["StrategyControls | None"] = relationship("StrategyControls")
    execution_style: Mapped["ExecutionStyle | None"] = relationship("ExecutionStyle")
    risk_profile: Mapped["RiskProfile | None"] = relationship("RiskProfile")

    allocations: Mapped[list["AccountAllocation"]] = relationship(
        "AccountAllocation",
        back_populates="trading_program",
        cascade="all, delete-orphan",
    )
    parent_program: Mapped["TradingProgram | None"] = relationship(
        "TradingProgram", remote_side=[id]
    )


class AccountAllocation(Base):
    """
    Binds a frozen TradingProgram to an Account.
    Holds bounded overrides — the program itself stays frozen.
    """
    __tablename__ = "account_allocations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    trading_program_id: Mapped[str] = mapped_column(
        ForeignKey("trading_programs.id"), index=True
    )
    account_id: Mapped[str] = mapped_column(
        ForeignKey("accounts.id"), index=True
    )

    # Bounded overrides (all optional; None = use program default)
    # Position sizing: ±20% scale on program's base sizing
    position_size_scale_pct: Mapped[float | None] = mapped_column(Float)   # e.g. 1.1 = +10%, 0.9 = -10%

    # Session window shift: ±30 minutes (positive = later, negative = earlier)
    session_window_shift_min: Mapped[int | None] = mapped_column()          # clamped to [-30, +30]

    # Drawdown halt threshold override (pct of allocation capital)
    drawdown_threshold_pct: Mapped[float | None] = mapped_column(Float)    # e.g. 0.05 = halt at -5%

    # Capital allocation for this program on this account
    allocated_capital_usd: Mapped[float] = mapped_column(Float, default=0.0)

    # Conflict resolution policy for this allocation
    # first_wins (default): second signal for same symbol suppressed and logged
    # aggregate: net exposure across programs (disables per-program P&L isolation)
    conflict_resolution: Mapped[str] = mapped_column(String(32), default="first_wins")

    # Broker mode for this allocation
    # paper: routes to InternalPaperBroker (no real orders)
    # live:  routes to AlpacaLiveBroker
    broker_mode: Mapped[str] = mapped_column(String(16), default="paper")  # paper | live

    # Lifecycle
    # pending:          set up, not yet running
    # paper:            running on paper broker
    # promoted_to_live: promoted and running on live broker
    # paused:           manually paused (maintains state)
    # stopped:          cleanly stopped (terminal)
    # killed:           emergency halted by kill switch
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime)
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime)
    promoted_by: Mapped[str | None] = mapped_column(String(128))
    stop_reason: Mapped[str | None] = mapped_column(String(255))

    # Promotion review — JSON snapshot of gate checks at promotion time
    promotion_review_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # Notes / audit
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_by: Mapped[str] = mapped_column(String(128), default="system")

    # Relationships
    trading_program: Mapped[TradingProgram] = relationship(
        "TradingProgram", back_populates="allocations"
    )
