"""
InternalPaperBroker — stateful BrokerProtocol implementation.

Simulates fills using:
    - Bar-close signal → next-open fill model (no lookahead)
    - Configurable slippage (bps) applied to fill price
    - Per-share commission model
    - In-memory position and P&L tracking

This class implements BrokerProtocol from app.brokers.base and is used by
AccountAllocation runners in paper mode. DB persistence of fills is handled
separately by the paper_broker service layer.

Slippage model
--------------
fill_price = next_open * (1 + slippage_bps / 10_000) for buys
fill_price = next_open * (1 - slippage_bps / 10_000) for sells

When next_open is not supplied (intraday/streaming contexts), the caller
should pass last_price as a proxy. The broker never reads market data itself.

Usage
-----
    broker = InternalPaperBroker(
        account_id="acc-123",
        initial_balance=100_000.0,
        slippage_bps=5.0,
        commission_per_share=0.005,
    )
    order = await broker.market_order("AAPL", qty=10.0, side="buy",
                                       fill_price_override=182.50)
    positions = await broker.get_positions()
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_SLIPPAGE_BPS = 5.0       # 0.05%
_DEFAULT_COMMISSION_PER_SHARE = 0.005   # $0.005/share


@dataclass
class _PaperPosition:
    symbol: str
    qty: float              # positive = long, negative = short
    avg_cost: float
    realized_pnl: float = 0.0
    unrealized_pnl: float = 0.0
    commission_paid: float = 0.0


@dataclass
class _PaperFill:
    order_id: str
    client_order_id: str | None
    symbol: str
    side: str           # buy | sell
    qty: float
    fill_price: float
    commission: float
    filled_at: str
    slippage_applied_bps: float


class InternalPaperBroker:
    """
    Stateful in-memory paper broker.

    Thread-safety: not thread-safe; use one instance per deployment runner.
    """

    def __init__(
        self,
        account_id: str = "paper",
        initial_balance: float = 100_000.0,
        slippage_bps: float = _DEFAULT_SLIPPAGE_BPS,
        commission_per_share: float = _DEFAULT_COMMISSION_PER_SHARE,
    ) -> None:
        self.account_id = account_id
        self.initial_balance = initial_balance
        self.cash = initial_balance
        self.slippage_bps = slippage_bps
        self.commission_per_share = commission_per_share

        self._positions: dict[str, _PaperPosition] = {}
        self._fills: list[_PaperFill] = []
        self._order_counter = 0

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _next_order_id(self) -> str:
        self._order_counter += 1
        return f"paper-{self.account_id[:8]}-{self._order_counter:06d}"

    def _apply_slippage(self, price: float, side: str) -> float:
        """Apply half-spread slippage proxy."""
        factor = self.slippage_bps / 10_000.0
        if side.lower() == "buy":
            return price * (1.0 + factor)
        return price * (1.0 - factor)

    def _commission(self, qty: float) -> float:
        return abs(qty) * self.commission_per_share

    def _fill(
        self,
        symbol: str,
        qty: float,
        side: str,
        fill_price: float,
        client_order_id: str | None,
    ) -> dict[str, Any]:
        """Execute a fill: update position + cash."""
        sym = symbol.upper()
        slipped_price = self._apply_slippage(fill_price, side)
        commission = self._commission(qty)
        order_id = self._next_order_id()
        signed_qty = qty if side.lower() == "buy" else -qty

        # Update position (FIFO avg cost simplified to weighted avg)
        pos = self._positions.get(sym)
        if pos is None:
            pos = _PaperPosition(symbol=sym, qty=0.0, avg_cost=0.0)
            self._positions[sym] = pos

        old_qty = pos.qty
        new_qty = old_qty + signed_qty

        if abs(old_qty) < 1e-8:
            # No prior position — just open
            pos.avg_cost = slipped_price
        elif (old_qty > 0 and signed_qty > 0) or (old_qty < 0 and signed_qty < 0):
            # Adding to position — update weighted avg cost
            pos.avg_cost = (old_qty * pos.avg_cost + signed_qty * slipped_price) / new_qty
        else:
            # Reducing or reversing position — realize P&L on closed portion
            closed_qty = min(abs(old_qty), abs(signed_qty))
            if old_qty > 0:
                realized = (slipped_price - pos.avg_cost) * closed_qty
            else:
                realized = (pos.avg_cost - slipped_price) * closed_qty
            pos.realized_pnl += realized - commission
            pos.commission_paid += commission

        pos.qty = new_qty
        if abs(new_qty) < 1e-8:
            # Fully closed
            del self._positions[sym]

        # Update cash
        cash_delta = -signed_qty * slipped_price - commission
        self.cash += cash_delta

        fill = _PaperFill(
            order_id=order_id,
            client_order_id=client_order_id,
            symbol=sym,
            side=side.lower(),
            qty=qty,
            fill_price=slipped_price,
            commission=commission,
            filled_at=self._now_iso(),
            slippage_applied_bps=self.slippage_bps,
        )
        self._fills.append(fill)

        logger.debug(
            "PaperBroker[%s]: %s %s %.4f @ %.4f (slipped) commission=%.4f cash→%.2f",
            self.account_id, side.upper(), sym, qty, slipped_price, commission, self.cash,
        )

        return {
            "id": order_id,
            "client_order_id": client_order_id,
            "status": "filled",
            "broker": "internal_paper",
            "symbol": sym,
            "qty": qty,
            "side": side.lower(),
            "fill_price": round(slipped_price, 4),
            "commission": round(commission, 4),
            "filled_at": fill.filled_at,
        }

    # ── BrokerProtocol interface ──────────────────────────────────────────────

    async def get_account(self) -> dict[str, Any]:
        equity = self._compute_equity()
        return {
            "mode": "paper",
            "broker": "internal_paper",
            "account_id": self.account_id,
            "cash": round(self.cash, 2),
            "equity": round(equity, 2),
            "initial_balance": round(self.initial_balance, 2),
            "unrealized_pnl": round(equity - self.cash, 2),
            "realized_pnl": round(self._total_realized_pnl(), 4),
            "status": "active",
        }

    async def get_positions(self) -> list[dict[str, Any]]:
        return [
            {
                "symbol": pos.symbol,
                "qty": round(pos.qty, 6),
                "avg_cost": round(pos.avg_cost, 4),
                "unrealized_pnl": round(pos.unrealized_pnl, 4),
                "realized_pnl": round(pos.realized_pnl, 4),
                "commission_paid": round(pos.commission_paid, 4),
                "market_value": None,  # caller must supply current price to compute
            }
            for pos in self._positions.values()
            if abs(pos.qty) > 1e-8
        ]

    async def market_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        time_in_force: str = "day",
        client_order_id: str | None = None,
        *,
        fill_price_override: float | None = None,
    ) -> dict[str, Any]:
        """
        Simulate a market order fill.

        fill_price_override: caller supplies next-open price (no lookahead).
        If not provided, a warning is logged and fill is deferred (returns pending).
        """
        if fill_price_override is None or fill_price_override <= 0:
            logger.warning(
                "PaperBroker[%s]: market_order %s %s — no fill_price_override supplied, fill deferred",
                self.account_id, side, symbol,
            )
            return {
                "id": self._next_order_id(),
                "client_order_id": client_order_id,
                "status": "pending_open",
                "broker": "internal_paper",
                "symbol": symbol.upper(),
                "qty": qty,
                "side": side.lower(),
                "note": "fill deferred: next-open price not yet available",
            }
        return self._fill(symbol, qty, side, fill_price_override, client_order_id)

    async def limit_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        limit_price: float,
        time_in_force: str = "day",
        client_order_id: str | None = None,
    ) -> dict[str, Any]:
        """Simulate limit order — fills immediately at limit_price (conservative)."""
        return self._fill(symbol, qty, side, limit_price, client_order_id)

    async def bracket_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        *,
        entry_price: float,
        stop_price: float | None = None,
        take_profit_price: float | None = None,
        client_order_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Simulate bracket order entry.
        Stop and take-profit legs are stored as metadata — the paper broker
        polling loop enforces them on subsequent bars.
        """
        fill_result = self._fill(symbol, qty, side, entry_price, client_order_id)
        fill_result["bracket"] = {
            "stop_price": stop_price,
            "take_profit_price": take_profit_price,
        }
        return fill_result

    async def close_position(self, symbol: str, qty: float | None = None) -> dict[str, Any]:
        sym = symbol.upper()
        pos = self._positions.get(sym)
        if pos is None or abs(pos.qty) < 1e-8:
            return {"status": "no_position", "symbol": sym, "broker": "internal_paper"}

        close_qty = abs(qty) if qty is not None else abs(pos.qty)
        close_side = "sell" if pos.qty > 0 else "buy"
        fill_price = pos.avg_cost  # Use cost basis as proxy when no market price is available
        return self._fill(sym, close_qty, close_side, fill_price, None)

    async def close_all_positions(self) -> list[dict[str, Any]]:
        results = []
        for sym in list(self._positions.keys()):
            result = await self.close_position(sym)
            results.append(result)
        return results

    async def validate(self) -> dict[str, Any]:
        return {
            "valid": True,
            "broker": "internal_paper",
            "account_id": self.account_id,
            "cash": round(self.cash, 2),
            "open_positions": len(self._positions),
        }

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _compute_equity(self) -> float:
        """Equity = cash + sum of position market values (using avg_cost as proxy)."""
        position_value = sum(pos.qty * pos.avg_cost for pos in self._positions.values())
        return self.cash + position_value

    def _total_realized_pnl(self) -> float:
        return sum(pos.realized_pnl for pos in self._positions.values())

    def update_market_prices(self, prices: dict[str, float]) -> None:
        """
        Update unrealized P&L using current market prices.
        Called by the polling loop after each bar.
        """
        for sym, price in prices.items():
            pos = self._positions.get(sym.upper())
            if pos and abs(pos.qty) > 1e-8:
                if pos.qty > 0:
                    pos.unrealized_pnl = (price - pos.avg_cost) * pos.qty
                else:
                    pos.unrealized_pnl = (pos.avg_cost - price) * abs(pos.qty)

    def fill_history(self, *, limit: int = 100) -> list[dict[str, Any]]:
        """Return recent fills (most recent first)."""
        return [
            {
                "order_id": f.order_id,
                "client_order_id": f.client_order_id,
                "symbol": f.symbol,
                "side": f.side,
                "qty": f.qty,
                "fill_price": round(f.fill_price, 4),
                "commission": round(f.commission, 4),
                "filled_at": f.filled_at,
                "slippage_bps": f.slippage_applied_bps,
            }
            for f in reversed(self._fills[-limit:])
        ]

    def summary(self) -> dict[str, Any]:
        equity = self._compute_equity()
        return {
            "account_id": self.account_id,
            "cash": round(self.cash, 2),
            "equity": round(equity, 2),
            "initial_balance": round(self.initial_balance, 2),
            "pnl_total": round(equity - self.initial_balance, 2),
            "realized_pnl": round(self._total_realized_pnl(), 4),
            "open_positions": len(self._positions),
            "fill_count": len(self._fills),
            "slippage_bps": self.slippage_bps,
            "commission_per_share": self.commission_per_share,
        }
