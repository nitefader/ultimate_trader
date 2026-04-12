"""
Risk management engine.
Enforces all risk limits before orders are submitted.
Returns (approved, reason) tuple.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.core.portfolio import Portfolio


@dataclass
class RiskConfig:
    max_position_size_pct: float = 0.10      # max 10% of equity per position
    max_daily_loss_pct: float = 0.03         # 3% daily loss lockout
    max_drawdown_lockout_pct: float = 0.10   # 10% drawdown lockout
    max_open_positions: int = 10
    max_portfolio_heat: float = 0.06         # 6% total risk across all positions
    max_correlated_exposure: float = 0.30    # 30% in same sector/direction
    max_leverage: float = 4.0
    allowed_symbols: list[str] | None = None   # None = all
    blocked_symbols: list[str] | None = None
    max_daily_trades: int | None = None        # None = unlimited

    @classmethod
    def from_config(cls, config: dict) -> "RiskConfig":
        return cls(**{k: v for k, v in config.items() if k in cls.__dataclass_fields__})


class RiskEngine:
    def __init__(self, config: RiskConfig):
        self.config = config
        self._daily_pnl: float = 0.0
        self._daily_trade_count: int = 0
        self._killed: bool = False
        self._kill_reason: str | None = None

    def check_entry(
        self,
        symbol: str,
        direction: str,
        quantity: float,
        price: float,
        stop_price: float | None,
        portfolio: Portfolio,
    ) -> tuple[bool, str]:
        """
        Returns (approved, reason).
        If not approved, reason explains why.
        """
        if self._killed:
            return False, f"Kill switch active: {self._kill_reason}"

        equity = portfolio.equity
        if equity <= 0:
            return False, "Equity is zero or negative"

        # Symbol allow/block list
        if self.config.allowed_symbols and symbol not in self.config.allowed_symbols:
            return False, f"Symbol {symbol} not in allowed list"
        if self.config.blocked_symbols and symbol in self.config.blocked_symbols:
            return False, f"Symbol {symbol} is blocked"

        # Max open positions
        if portfolio.num_open_positions >= self.config.max_open_positions:
            return False, f"Max open positions reached ({self.config.max_open_positions})"

        # Max position size
        position_value = quantity * price
        if position_value / equity > self.config.max_position_size_pct:
            return False, f"Position size {position_value/equity:.1%} exceeds max {self.config.max_position_size_pct:.1%}"

        # Max leverage (gross exposure / equity)
        existing_gross_exposure = sum(
            abs(p.quantity * p.current_price)
            for positions in portfolio.positions.values()
            for p in positions
        )
        projected_gross_exposure = existing_gross_exposure + abs(position_value)
        projected_leverage = projected_gross_exposure / equity
        if projected_leverage > self.config.max_leverage:
            return False, f"Projected leverage {projected_leverage:.2f} exceeds max {self.config.max_leverage:.2f}"

        # Portfolio heat check
        if stop_price:
            new_risk = abs(price - stop_price) * quantity
            total_risk = portfolio.portfolio_heat * equity + new_risk
            if total_risk / equity > self.config.max_portfolio_heat:
                return False, f"Portfolio heat {total_risk/equity:.1%} would exceed max {self.config.max_portfolio_heat:.1%}"

        # Correlated exposure proxy: cap same-direction gross exposure share of equity.
        # This is a conservative directional proxy until sector/beta correlation bucketing is available.
        same_direction_exposure = sum(
            abs(p.quantity * p.current_price)
            for positions in portfolio.positions.values()
            for p in positions
            if p.direction == direction
        ) + abs(position_value)
        if same_direction_exposure / equity > self.config.max_correlated_exposure:
            return False, (
                f"Correlated exposure proxy {same_direction_exposure/equity:.1%} "
                f"would exceed max {self.config.max_correlated_exposure:.1%}"
            )

        # Daily loss lockout
        if self._daily_pnl < 0 and abs(self._daily_pnl) / equity > self.config.max_daily_loss_pct:
            return False, f"Daily loss lockout triggered: {self._daily_pnl/equity:.1%} loss"

        # Drawdown lockout
        if portfolio.current_drawdown > self.config.max_drawdown_lockout_pct:
            return False, f"Drawdown lockout: {portfolio.current_drawdown:.1%} drawdown"

        # Cash check
        if portfolio.cash < quantity * price:
            return False, f"Insufficient cash: need {quantity*price:.2f}, have {portfolio.cash:.2f}"

        # Daily trade limit
        if self.config.max_daily_trades and self._daily_trade_count >= self.config.max_daily_trades:
            return False, f"Daily trade limit reached ({self.config.max_daily_trades})"

        return True, "approved"

    def on_trade_close(self, net_pnl: float) -> None:
        self._daily_pnl += net_pnl
        self._daily_trade_count += 1

    def reset_daily(self) -> None:
        self._daily_pnl = 0.0
        self._daily_trade_count = 0

    def kill(self, reason: str = "manual") -> None:
        self._killed = True
        self._kill_reason = reason

    def unkill(self) -> None:
        self._killed = False
        self._kill_reason = None

    @property
    def is_killed(self) -> bool:
        return self._killed
