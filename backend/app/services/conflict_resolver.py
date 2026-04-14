"""
Conflict resolution — pre-submission net exposure check.

Before any order is submitted on an account, this resolver computes the net
exposure per symbol across ALL active programs on that account and applies the
configured conflict_resolution policy for each AccountAllocation.

Policies
--------
first_wins (default)
    The first program to hold (or have a pending order for) a symbol "wins".
    Any subsequent signal for the same symbol from a different program on the
    same account is suppressed and logged. Per-program P&L isolation is maintained.

aggregate
    Net exposure is computed and used. Explicit opt-in only — a per-allocation
    setting. Disables per-program P&L isolation for affected symbols.

Usage
-----
    resolver = ConflictResolver(account_id="acc-123")
    decision = resolver.check_signal(
        requesting_allocation_id="alloc-abc",
        symbol="AAPL",
        side="buy",
        existing_positions={
            "alloc-xyz": {"AAPL": {"qty": 100, "side": "buy"}},
        },
    )
    if decision.suppressed:
        logger.info("Signal suppressed: %s", decision.reason)
        return
    # proceed with order submission
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class SignalDecision:
    """Result of a conflict check for a single signal."""
    symbol: str
    side: str
    requesting_allocation_id: str
    suppressed: bool
    reason: str
    policy_applied: str
    conflicting_allocations: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "side": self.side,
            "requesting_allocation_id": self.requesting_allocation_id,
            "suppressed": self.suppressed,
            "reason": self.reason,
            "policy_applied": self.policy_applied,
            "conflicting_allocations": self.conflicting_allocations,
        }


class ConflictResolver:
    """
    Per-account conflict resolver.

    Maintains a live view of which allocation holds which symbols on an account
    (updated after each fill or position change via register_position / clear_position).

    check_signal() is the hot path — called before every order submission.
    """

    def __init__(self, account_id: str) -> None:
        self.account_id = account_id
        # allocation_id → {symbol → {"qty": float, "side": "buy"|"sell"}}
        self._positions: dict[str, dict[str, dict[str, Any]]] = {}
        # allocation_id → conflict_resolution policy ("first_wins" | "aggregate")
        self._policies: dict[str, str] = {}
        self._suppression_log: list[dict[str, Any]] = []

    def register_allocation(self, allocation_id: str, conflict_resolution: str = "first_wins") -> None:
        """Register an allocation's conflict resolution policy."""
        self._policies[allocation_id] = conflict_resolution
        self._positions.setdefault(allocation_id, {})

    def unregister_allocation(self, allocation_id: str) -> None:
        """Remove an allocation (called when stopped or killed)."""
        self._policies.pop(allocation_id, None)
        self._positions.pop(allocation_id, None)

    def register_position(
        self,
        allocation_id: str,
        symbol: str,
        qty: float,
        side: str,
    ) -> None:
        """Update position record for an allocation after a fill."""
        sym = symbol.upper()
        pos = self._positions.setdefault(allocation_id, {})
        if abs(qty) < 1e-8:
            pos.pop(sym, None)
        else:
            pos[sym] = {"qty": qty, "side": side.lower()}

    def clear_position(self, allocation_id: str, symbol: str) -> None:
        """Remove a position from the tracker (e.g. after full exit)."""
        sym = symbol.upper()
        self._positions.get(allocation_id, {}).pop(sym, None)

    def holders_of(self, symbol: str, exclude_allocation_id: str | None = None) -> list[str]:
        """Return allocation_ids that currently hold the given symbol."""
        sym = symbol.upper()
        return [
            alloc_id
            for alloc_id, positions in self._positions.items()
            if sym in positions and alloc_id != exclude_allocation_id
        ]

    def check_signal(
        self,
        requesting_allocation_id: str,
        symbol: str,
        side: str,
        *,
        pending_orders: dict[str, set[str]] | None = None,
    ) -> SignalDecision:
        """
        Check whether a new signal should be suppressed.

        Parameters
        ----------
        requesting_allocation_id : str
            The AccountAllocation issuing the signal.
        symbol : str
            Target symbol.
        side : str
            "buy" or "sell".
        pending_orders : dict[allocation_id, set[symbols]] | None
            Optional map of allocations with pending orders (not yet filled).
            These count as "holds" under first_wins.

        Returns
        -------
        SignalDecision — suppressed=False means proceed, suppressed=True means drop.
        """
        sym = symbol.upper()
        policy = self._policies.get(requesting_allocation_id, "first_wins")

        if policy == "aggregate":
            # Aggregate: always proceed — caller aggregates net exposure
            return SignalDecision(
                symbol=sym,
                side=side,
                requesting_allocation_id=requesting_allocation_id,
                suppressed=False,
                reason="aggregate policy — net exposure computed by caller",
                policy_applied="aggregate",
            )

        # first_wins: check if any *other* allocation already holds or has pending orders for this symbol
        holding = self.holders_of(sym, exclude_allocation_id=requesting_allocation_id)

        # Also check pending orders
        pending_holders: list[str] = []
        if pending_orders:
            for alloc_id, symbols in pending_orders.items():
                if alloc_id != requesting_allocation_id and sym in {s.upper() for s in symbols}:
                    pending_holders.append(alloc_id)

        conflicting = list({*holding, *pending_holders})

        if conflicting:
            reason = (
                f"first_wins: symbol {sym} already held/pending by "
                f"{', '.join(conflicting)} — signal suppressed"
            )
            logger.info(
                "ConflictResolver[%s]: suppressing %s %s signal from %s — %s",
                self.account_id, side, sym, requesting_allocation_id, reason,
            )
            decision = SignalDecision(
                symbol=sym,
                side=side,
                requesting_allocation_id=requesting_allocation_id,
                suppressed=True,
                reason=reason,
                policy_applied="first_wins",
                conflicting_allocations=conflicting,
            )
            self._suppression_log.append(decision.to_dict())
            return decision

        return SignalDecision(
            symbol=sym,
            side=side,
            requesting_allocation_id=requesting_allocation_id,
            suppressed=False,
            reason="no conflict detected",
            policy_applied="first_wins",
        )

    def suppression_log(self, *, limit: int = 100) -> list[dict[str, Any]]:
        """Return recent suppression events (most recent first)."""
        return list(reversed(self._suppression_log[-limit:]))

    def status(self) -> dict[str, Any]:
        return {
            "account_id": self.account_id,
            "allocation_count": len(self._policies),
            "policies": dict(self._policies),
            "symbol_holders": {
                sym: [
                    alloc_id
                    for alloc_id, positions in self._positions.items()
                    if sym in positions
                ]
                for sym in {
                    s for pos in self._positions.values() for s in pos
                }
            },
            "suppression_count": len(self._suppression_log),
        }


class GlobalConflictRegistry:
    """One ConflictResolver per account — module-level singleton registry."""

    def __init__(self) -> None:
        self._resolvers: dict[str, ConflictResolver] = {}

    def get_or_create(self, account_id: str) -> ConflictResolver:
        if account_id not in self._resolvers:
            self._resolvers[account_id] = ConflictResolver(account_id)
        return self._resolvers[account_id]

    def remove(self, account_id: str) -> None:
        self._resolvers.pop(account_id, None)

    def status(self) -> dict[str, Any]:
        return {
            "account_count": len(self._resolvers),
            "resolvers": {acct: r.status() for acct, r in self._resolvers.items()},
        }


_registry = GlobalConflictRegistry()


def get_conflict_registry() -> GlobalConflictRegistry:
    return _registry
