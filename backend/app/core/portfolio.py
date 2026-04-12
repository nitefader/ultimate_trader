"""
Portfolio accounting — tracks equity, positions, P&L.
This is the source of truth for all financial state during a backtest or live session.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class Position:
    symbol: str
    direction: str        # "long" or "short"
    quantity: float       # shares/contracts
    avg_entry: float
    current_price: float
    stop_price: float | None
    target_prices: list[float]  # ordered targets
    trailing_stop_config: dict | None = None
    scale_config: list[dict] | None = None

    # Lifecycle
    entry_time: datetime | None = None
    entry_order_type: str = "market"
    add_count: int = 0              # number of scale-in adds
    partial_exit_count: int = 0
    max_favorable: float = 0.0
    max_adverse: float = 0.0
    regime_at_entry: str | None = None
    entry_conditions_fired: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    trade_id: str | None = None     # links to Trade ORM record
    entry_commission_paid: float = 0.0
    initial_risk: float | None = None

    @property
    def market_value(self) -> float:
        if self.direction == "long":
            return self.quantity * self.current_price
        else:
            return -self.quantity * self.current_price

    @property
    def unrealized_pnl(self) -> float:
        if self.direction == "long":
            return self.quantity * (self.current_price - self.avg_entry)
        else:
            return self.quantity * (self.avg_entry - self.current_price)

    @property
    def unrealized_pnl_pct(self) -> float:
        cost = self.quantity * self.avg_entry
        return self.unrealized_pnl / cost if cost > 0 else 0.0

    def update_price(self, price: float) -> None:
        prev = self.current_price
        self.current_price = price
        if self.direction == "long":
            pnl_change = self.quantity * (price - prev)
        else:
            pnl_change = self.quantity * (prev - price)
        self.max_favorable = max(self.max_favorable, self.unrealized_pnl)
        self.max_adverse = min(self.max_adverse, self.unrealized_pnl)


class Portfolio:
    """
    Full portfolio state with positions, cash, equity, and P&L accounting.
    """

    def __init__(self, initial_cash: float = 100_000.0, commission_per_share: float = 0.005):
        self.initial_cash = initial_cash
        self.cash = initial_cash
        self.commission_per_share = commission_per_share
        self.positions: dict[str, list[Position]] = {}   # symbol → list (multiple directions)
        self.closed_trades: list[dict] = []
        self.equity_curve: list[dict] = []   # [{date, equity, cash, drawdown}]
        self._peak_equity = initial_cash
        self._max_drawdown = 0.0

    @property
    def equity(self) -> float:
        """
        Total portfolio equity.

        For LONG positions the cost basis was deducted from cash on entry, so we
        add back the current *market value* (qty × current_price) — not just the
        unrealized gain — to get the true portfolio value.

        For SHORT positions we use the simplified margin model where cash is NOT
        credited with the short-sale proceeds on entry (only commission is
        deducted).  In that model the unrealized P&L already represents the
        correct equity contribution.
        """
        total = self.cash
        for positions in self.positions.values():
            for p in positions:
                if p.direction == "long":
                    # cash was reduced by qty*avg_entry on open; add back market value
                    total += p.quantity * p.current_price
                else:
                    # short simplified model: unrealized_pnl = qty*(avg_entry - current)
                    total += p.unrealized_pnl
        return total

    @property
    def unrealized_pnl(self) -> float:
        return sum(p.unrealized_pnl for positions in self.positions.values() for p in positions)

    @property
    def market_value(self) -> float:
        return sum(p.market_value for positions in self.positions.values() for p in positions)

    @property
    def num_open_positions(self) -> int:
        return sum(len(v) for v in self.positions.values())

    @property
    def portfolio_heat(self) -> float:
        """Total risk as fraction of equity (stop-based)."""
        total_risk = 0.0
        eq = self.equity
        for positions in self.positions.values():
            for p in positions:
                if p.stop_price:
                    risk = abs(p.avg_entry - p.stop_price) * p.quantity
                    total_risk += risk
        return total_risk / eq if eq > 0 else 0.0

    @property
    def current_drawdown(self) -> float:
        eq = self.equity
        if eq > self._peak_equity:
            self._peak_equity = eq
        return (self._peak_equity - eq) / self._peak_equity if self._peak_equity > 0 else 0.0

    def open_position(
        self,
        symbol: str,
        direction: str,
        quantity: float,
        price: float,
        commission: float = 0.0,
        stop_price: float | None = None,
        target_prices: list[float] | None = None,
        entry_time: datetime | None = None,
        **kwargs,
    ) -> Position:
        # Long: spend cash to buy. Short: no cash spent (margin held, simplified).
        if direction == "long":
            self.cash -= quantity * price + commission
        else:
            self.cash -= commission  # just commission for short entry

        pos = Position(
            symbol=symbol,
            direction=direction,
            quantity=quantity,
            avg_entry=price,
            current_price=price,
            stop_price=stop_price,
            target_prices=target_prices or [],
            entry_time=entry_time,
            entry_commission_paid=commission,
            **kwargs,
        )

        if symbol not in self.positions:
            self.positions[symbol] = []
        self.positions[symbol].append(pos)
        return pos

    def add_to_position(
        self,
        pos: Position,
        quantity: float,
        price: float,
        commission: float = 0.0,
        new_stop: float | None = None,
    ) -> None:
        """Scale in to an existing position, updating average entry."""
        total_qty = pos.quantity + quantity
        pos.avg_entry = (pos.avg_entry * pos.quantity + price * quantity) / total_qty
        pos.quantity = total_qty
        pos.current_price = price
        pos.add_count += 1
        if new_stop is not None:
            pos.stop_price = new_stop
        if pos.direction == "long":
            self.cash -= quantity * price + commission
        else:
            self.cash -= commission
        pos.entry_commission_paid += commission

    def close_position(
        self,
        pos: Position,
        price: float,
        quantity: float | None = None,  # None = full close
        commission: float = 0.0,
        exit_reason: str = "manual",
        exit_time: datetime | None = None,
    ) -> dict:
        """
        Close (or partially close) a position.
        Returns a trade record dict.
        """
        close_qty = quantity if quantity is not None else pos.quantity
        position_qty_before_close = pos.quantity
        entry_commission_alloc = 0.0
        if position_qty_before_close > 0 and pos.entry_commission_paid > 0:
            entry_commission_alloc = pos.entry_commission_paid * (close_qty / position_qty_before_close)

        if pos.direction == "long":
            gross_pnl = close_qty * (price - pos.avg_entry)
            proceeds = close_qty * price - commission
        else:
            gross_pnl = close_qty * (pos.avg_entry - price)
            proceeds = -(close_qty * price) + commission  # short: we receive when covering

        net_pnl = gross_pnl - commission - entry_commission_alloc

        # Unified cash accounting:
        # Long: receive proceeds (price * qty), pay commission
        # Short: return borrowed shares — profit = (entry - exit) * qty, pay commission
        if pos.direction == "long":
            self.cash += close_qty * price - commission
        else:
            # Short: cash was NOT deducted on entry (short sale proceeds held as margin)
            # On close: net PnL = (avg_entry - price) * qty - commission
            self.cash += gross_pnl - commission

        trade_record = {
            "symbol": pos.symbol,
            "direction": pos.direction,
            "entry_price": pos.avg_entry,
            "exit_price": price,
            "quantity": close_qty,
            "gross_pnl": gross_pnl,
            "commission": entry_commission_alloc + commission,
            "entry_commission": entry_commission_alloc,
            "exit_commission": commission,
            "net_pnl": net_pnl,
            "exit_reason": exit_reason,
            "exit_time": exit_time,
            "entry_time": pos.entry_time,
            "max_favorable": pos.max_favorable,
            "max_adverse": pos.max_adverse,
            "regime_at_entry": pos.regime_at_entry,
            "trade_id": pos.trade_id,
            "initial_risk": pos.initial_risk,
        }

        pos.quantity -= close_qty
        pos.partial_exit_count += 1
        pos.entry_commission_paid = max(0.0, pos.entry_commission_paid - entry_commission_alloc)

        if pos.quantity <= 1e-8:
            # Fully closed — remove from positions
            sym_list = self.positions.get(pos.symbol, [])
            if pos in sym_list:
                sym_list.remove(pos)
            if not sym_list:
                del self.positions[pos.symbol]

        self.closed_trades.append(trade_record)
        return trade_record

    def update_prices(self, prices: dict[str, float]) -> None:
        """Update current prices for all positions."""
        for symbol, price in prices.items():
            for pos in self.positions.get(symbol, []):
                pos.update_price(price)

    def record_equity(self, timestamp, regime: str = "unknown") -> None:
        eq = self.equity
        if eq > self._peak_equity:
            self._peak_equity = eq
        dd = (self._peak_equity - eq) / self._peak_equity if self._peak_equity > 0 else 0.0
        self._max_drawdown = max(self._max_drawdown, dd)
        self.equity_curve.append({
            "date": str(timestamp),
            "equity": round(eq, 2),
            "cash": round(self.cash, 2),
            "drawdown": round(dd, 4),
            "regime": regime,
        })

    def get_position(self, symbol: str, direction: str) -> Position | None:
        for pos in self.positions.get(symbol, []):
            if pos.direction == direction:
                return pos
        return None

    def get_daily_pnl(self) -> float:
        """P&L for today — based on equity curve if available."""
        if len(self.equity_curve) < 2:
            return 0.0
        today_eq = self.equity_curve[-1]["equity"]
        # Find yesterday's close (same-day bars won't work, but good for daily)
        yesterday_eq = self.equity_curve[-2]["equity"]
        return today_eq - yesterday_eq

    def summary(self) -> dict:
        return {
            "initial_cash": self.initial_cash,
            "current_equity": round(self.equity, 2),
            "cash": round(self.cash, 2),
            "unrealized_pnl": round(self.unrealized_pnl, 2),
            "open_positions": self.num_open_positions,
            "total_return_pct": round((self.equity - self.initial_cash) / self.initial_cash * 100, 2),
            "max_drawdown_pct": round(self._max_drawdown * 100, 2),
            "portfolio_heat_pct": round(self.portfolio_heat * 100, 2),
        }
