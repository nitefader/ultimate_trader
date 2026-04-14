"""
Virtual position ledger — reconstructs per-deployment P&L from Alpaca fill events.

Architecture
------------
Every order submitted through the platform uses:
    client_order_id = f"{deployment_id}_{uuid4().hex[:8]}"

Alpaca passes client_order_id through on all fill events. This lets us:
1. Filter fills by deployment_id prefix → attribute each fill to its deployment.
2. Reconstruct virtual positions and P&L without a separate ledger table.
3. Compute FIFO cost-basis for multi-fill positions.

This module is the canonical implementation of that attribution scheme.

Usage
-----
    ledger = DeploymentLedger(deployment_id="dep-abc123")
    ledger.process_fill(fill)     # from Alpaca fill event
    pos = ledger.get_position("AAPL")
    pnl = ledger.realized_pnl("AAPL")
    summary = ledger.summary()

client_order_id format
----------------------
    f"{deployment_id}_{uuid4().hex[:8]}"

    deployment_id can contain hyphens and alphanumeric chars.
    The suffix after the last underscore is the 8-char random hex.
    extract_deployment_id() uses rsplit("_", 1)[0] to recover it.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def make_client_order_id(deployment_id: str) -> str:
    """Generate a traceable client_order_id for this deployment."""
    import uuid
    return f"{deployment_id}_{uuid.uuid4().hex[:8]}"


def extract_deployment_id(client_order_id: str) -> str | None:
    """
    Recover deployment_id from a client_order_id.
    Returns None if the format is not recognized.
    """
    if not client_order_id or "_" not in client_order_id:
        return None
    # rsplit on last underscore — deployment_id itself may contain underscores
    parts = client_order_id.rsplit("_", 1)
    if len(parts) == 2 and len(parts[1]) == 8:
        return parts[0]
    return None


@dataclass
class FillEvent:
    """Normalized fill from an Alpaca order fill websocket event or REST poll."""
    order_id: str
    client_order_id: str
    symbol: str
    side: str           # "buy" or "sell"
    quantity: float
    fill_price: float
    filled_at: datetime
    commission: float = 0.0
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_alpaca_event(cls, event: dict[str, Any]) -> "FillEvent | None":
        """
        Parse an Alpaca trade_updates websocket event.
        event["event"] must be "fill" or "partial_fill".
        """
        ev_type = str(event.get("event", "")).lower()
        if ev_type not in {"fill", "partial_fill"}:
            return None
        order = event.get("order", {})
        client_order_id = str(order.get("client_order_id", ""))
        order_id = str(order.get("id", ""))
        symbol = str(order.get("symbol", "")).upper()
        side = str(order.get("side", "")).lower()
        try:
            qty = float(event.get("qty") or order.get("filled_qty") or 0)
            price = float(event.get("price") or order.get("filled_avg_price") or 0)
        except (TypeError, ValueError):
            return None
        raw_ts = event.get("timestamp") or order.get("filled_at") or ""
        try:
            filled_at = datetime.fromisoformat(str(raw_ts).replace("Z", "+00:00"))
        except ValueError:
            filled_at = datetime.now(timezone.utc)

        return cls(
            order_id=order_id,
            client_order_id=client_order_id,
            symbol=symbol,
            side=side,
            quantity=qty,
            fill_price=price,
            filled_at=filled_at,
            raw=event,
        )


@dataclass
class _FifoLot:
    quantity: float
    cost_per_share: float
    side: str   # "long" or "short"


@dataclass
class DeploymentLedger:
    """
    Per-deployment virtual ledger.
    Reconstructs positions and P&L from fills attributed to this deployment.
    """
    deployment_id: str
    _lots: dict[str, list[_FifoLot]] = field(default_factory=dict, repr=False)
    _realized_pnl: dict[str, float] = field(default_factory=dict, repr=False)
    _fills: list[FillEvent] = field(default_factory=list, repr=False)

    def _belongs(self, fill: FillEvent) -> bool:
        return extract_deployment_id(fill.client_order_id) == self.deployment_id

    def process_fill(self, fill: FillEvent) -> bool:
        """
        Process a fill event. Returns True if fill was attributed to this deployment.
        Applies FIFO cost-basis for P&L on closing fills.
        """
        if not self._belongs(fill):
            return False

        self._fills.append(fill)
        sym = fill.symbol
        lots = self._lots.setdefault(sym, [])
        realized = self._realized_pnl.setdefault(sym, 0.0)

        if fill.side == "buy":
            lots.append(_FifoLot(quantity=fill.quantity, cost_per_share=fill.fill_price, side="long"))
        elif fill.side == "sell":
            # FIFO: reduce long lots from the front
            remaining = fill.quantity
            while remaining > 1e-8 and lots:
                lot = lots[0]
                if lot.quantity <= remaining:
                    realized += (fill.fill_price - lot.cost_per_share) * lot.quantity - fill.commission
                    remaining -= lot.quantity
                    lots.pop(0)
                else:
                    realized += (fill.fill_price - lot.cost_per_share) * remaining - fill.commission
                    lot.quantity -= remaining
                    remaining = 0.0
            self._realized_pnl[sym] = realized

        return True

    def get_position(self, symbol: str) -> dict[str, Any]:
        """Return current virtual position for symbol."""
        sym = symbol.upper()
        lots = self._lots.get(sym, [])
        total_qty = sum(lot.quantity for lot in lots)
        avg_cost = (
            sum(lot.quantity * lot.cost_per_share for lot in lots) / total_qty
            if total_qty > 1e-8 else 0.0
        )
        return {
            "symbol": sym,
            "quantity": round(total_qty, 6),
            "avg_cost": round(avg_cost, 4),
            "lot_count": len(lots),
        }

    def realized_pnl(self, symbol: str | None = None) -> float:
        """Total realized P&L, optionally filtered to one symbol."""
        if symbol:
            return round(self._realized_pnl.get(symbol.upper(), 0.0), 4)
        return round(sum(self._realized_pnl.values()), 4)

    def open_symbols(self) -> list[str]:
        return [sym for sym, lots in self._lots.items() if sum(l.quantity for l in lots) > 1e-8]

    def summary(self) -> dict[str, Any]:
        positions = {sym: self.get_position(sym) for sym in self._lots}
        return {
            "deployment_id": self.deployment_id,
            "fill_count": len(self._fills),
            "open_symbols": self.open_symbols(),
            "realized_pnl_total": self.realized_pnl(),
            "realized_pnl_by_symbol": {
                sym: round(pnl, 4) for sym, pnl in self._realized_pnl.items()
            },
            "positions": positions,
        }


class GlobalFillRouter:
    """
    Routes incoming fill events to the correct DeploymentLedger.
    Maintains one ledger per deployment_id.
    """

    def __init__(self) -> None:
        self._ledgers: dict[str, DeploymentLedger] = {}

    def get_or_create(self, deployment_id: str) -> DeploymentLedger:
        if deployment_id not in self._ledgers:
            self._ledgers[deployment_id] = DeploymentLedger(deployment_id)
        return self._ledgers[deployment_id]

    def route_fill(self, fill: FillEvent) -> str | None:
        """Route fill to the correct ledger. Returns deployment_id if routed, else None."""
        dep_id = extract_deployment_id(fill.client_order_id)
        if dep_id is None:
            logger.debug("GlobalFillRouter: unattributed fill %s — no deployment prefix", fill.client_order_id)
            return None
        ledger = self.get_or_create(dep_id)
        ledger.process_fill(fill)
        return dep_id

    def route_alpaca_event(self, event: dict[str, Any]) -> str | None:
        """Parse and route an Alpaca trade_updates event. Returns deployment_id or None."""
        fill = FillEvent.from_alpaca_event(event)
        if fill is None:
            return None
        return self.route_fill(fill)

    def summary(self) -> dict[str, Any]:
        return {
            "deployment_count": len(self._ledgers),
            "ledgers": {dep_id: ledger.summary() for dep_id, ledger in self._ledgers.items()},
        }


# Module-level singleton
_router = GlobalFillRouter()


def get_fill_router() -> GlobalFillRouter:
    return _router
