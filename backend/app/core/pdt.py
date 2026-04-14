"""
PDT (Pattern Day Trader) rule enforcement.

FINRA Rule 4210: a margin account that executes 4+ day trades in a rolling
5-business-day window is classified as a PDT account and must maintain $25k
minimum equity.  We enforce the simpler retail-friendly version: max 3 day
trades in a rolling 5-session window for MARGIN accounts with equity < $25k.

CASH accounts are not subject to PDT rules but cannot short and must wait T+1
for settled funds.

Usage
-----
    state = PDTState(account_id="...")
    # Before submitting a new DAY-mode round trip:
    if not state.can_trade(account_equity=18_000):
        raise PDTLimitReached(...)
    # After the round trip closes:
    state.record_day_trade()
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

PDT_EQUITY_THRESHOLD = 25_000.0   # USD — below this, the 3-trade cap applies
PDT_MAX_DAY_TRADES   = 3          # per rolling window
PDT_WINDOW_SESSIONS  = 5          # business days


class PDTLimitReached(Exception):
    """Raised when a DAY-mode program tries to trade beyond the PDT cap."""
    def __init__(self, used: int, account_equity: float) -> None:
        super().__init__(
            f"PDT limit reached: {used}/{PDT_MAX_DAY_TRADES} day trades used "
            f"in rolling {PDT_WINDOW_SESSIONS}-session window. "
            f"Account equity ${account_equity:,.0f} is below the $25k threshold."
        )
        self.used = used
        self.account_equity = account_equity


@dataclass
class PDTState:
    """
    Per-account PDT tracker.  Intended to live on AccountAllocation or be
    looked up from a lightweight cache keyed by account_id.

    Fields
    ------
    account_id     : the account this state belongs to
    trade_dates    : UTC dates on which a day-trade round-trip completed
    """
    account_id: str
    trade_dates: list[date] = field(default_factory=list)

    # ── Public API ────────────────────────────────────────────────────────────

    @property
    def window_start(self) -> date:
        """First date of the current rolling 5-business-day window."""
        today = _today()
        return _subtract_business_days(today, PDT_WINDOW_SESSIONS - 1)

    @property
    def trades_in_window(self) -> list[date]:
        """Day-trade dates that fall within the current rolling window."""
        start = self.window_start
        return [d for d in self.trade_dates if d >= start]

    @property
    def used(self) -> int:
        return len(self.trades_in_window)

    @property
    def remaining(self) -> int:
        return max(0, PDT_MAX_DAY_TRADES - self.used)

    def can_trade(self, account_equity: float, account_mode: str = "margin") -> bool:
        """
        Return True if this account may open a new DAY-mode round trip.

        CASH accounts always return True (no PDT cap, but no shorts allowed).
        MARGIN accounts with equity >= $25k always return True.
        MARGIN accounts below $25k are capped at 3 day trades per window.
        """
        if account_mode == "cash":
            return True
        if account_equity >= PDT_EQUITY_THRESHOLD:
            return True
        return self.used < PDT_MAX_DAY_TRADES

    def assert_can_trade(self, account_equity: float, account_mode: str = "margin") -> None:
        """Raise PDTLimitReached if the account cannot open another day trade."""
        if not self.can_trade(account_equity, account_mode):
            raise PDTLimitReached(used=self.used, account_equity=account_equity)

    def record_day_trade(self, trade_date: date | None = None) -> None:
        """
        Record that a day-trade round trip completed.
        Prune expired dates from the window while we're here.
        """
        today = trade_date or _today()
        self.trade_dates.append(today)
        self._prune()

    def expiry_dates(self) -> list[date]:
        """Return the business-day expiry dates of each counted trade."""
        return [_add_business_days(d, PDT_WINDOW_SESSIONS) for d in self.trades_in_window]

    def summary(self) -> dict:
        return {
            "account_id": self.account_id,
            "used": self.used,
            "remaining": self.remaining,
            "window_start": self.window_start.isoformat(),
            "trade_dates_in_window": [d.isoformat() for d in self.trades_in_window],
            "expiry_dates": [d.isoformat() for d in self.expiry_dates()],
        }

    # ── Private ───────────────────────────────────────────────────────────────

    def _prune(self) -> None:
        """Remove trade dates outside the rolling window."""
        start = self.window_start
        self.trade_dates = [d for d in self.trade_dates if d >= start]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _today() -> date:
    return datetime.now(tz=timezone.utc).date()


def _subtract_business_days(d: date, n: int) -> date:
    """Return the date n business days before d (Mon–Fri only)."""
    result = d
    count = 0
    while count < n:
        result -= timedelta(days=1)
        if result.weekday() < 5:   # Mon=0 … Fri=4
            count += 1
    return result


def _add_business_days(d: date, n: int) -> date:
    """Return the date n business days after d."""
    result = d
    count = 0
    while count < n:
        result += timedelta(days=1)
        if result.weekday() < 5:
            count += 1
    return result
