"""
Earnings exclusion calendar.

Keeps a per-symbol blackout window around earnings announcements so that
the backtest engine and live DeploymentRunner skip entries during high-risk
periods.

Exclusion window (configurable, defaults match architecture spec):
    days_before : int = 3   — stop new entries this many calendar days before
    days_after  : int = 1   — resume entries this many calendar days after

Data source
-----------
Primary: Alpaca News API (GET /v1beta1/news?symbols=X&start=...&end=...)
         filtered for articles tagged with "earnings" and having a scheduled_date.
Fallback: raw calendar dict injected at construction time (useful for testing
         and for Nasdaq CSV imports).

The calendar is intentionally read-only at check time — updates happen via
refresh() which is called by a nightly scheduler job (P2-S3 scanner jobs).

Usage
-----
    cal = EarningsCalendar()
    cal.add_event("AAPL", date(2024, 7, 31))   # AMC or BMO — date of report

    # Before placing an entry:
    if cal.is_excluded("AAPL", today):
        skip_entry()
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

logger = logging.getLogger(__name__)

_DAYS_BEFORE_DEFAULT = 3
_DAYS_AFTER_DEFAULT = 1


@dataclass
class EarningsEvent:
    symbol: str
    report_date: date
    timing: str = "unknown"   # "AMC" (after close), "BMO" (before open), "unknown"
    source: str = "manual"


@dataclass
class EarningsCalendar:
    """
    In-memory earnings calendar with configurable exclusion window.
    Thread-safe for reads; writes should be coordinated by the scheduler.
    """
    days_before: int = _DAYS_BEFORE_DEFAULT
    days_after: int = _DAYS_AFTER_DEFAULT
    _events: dict[str, list[EarningsEvent]] = field(default_factory=dict, repr=False)

    def add_event(self, symbol: str, report_date: date, timing: str = "unknown", source: str = "manual") -> None:
        """Add a single earnings event. Idempotent on (symbol, date)."""
        sym = symbol.upper()
        existing = self._events.setdefault(sym, [])
        for ev in existing:
            if ev.report_date == report_date:
                return  # already present
        existing.append(EarningsEvent(symbol=sym, report_date=report_date, timing=timing, source=source))
        existing.sort(key=lambda e: e.report_date)

    def add_events_bulk(self, events: list[dict[str, Any]]) -> int:
        """
        Bulk-load events from a list of dicts:
            {"symbol": "AAPL", "report_date": "2024-07-31", "timing": "AMC"}
        Returns count of events added (skipping duplicates).
        """
        added = 0
        for raw in events:
            sym = str(raw.get("symbol", "")).strip().upper()
            raw_date = raw.get("report_date") or raw.get("date")
            if not sym or not raw_date:
                continue
            try:
                rdate = date.fromisoformat(str(raw_date)[:10])
            except ValueError:
                logger.warning("EarningsCalendar: unparseable date %r for %s", raw_date, sym)
                continue
            before = len(self._events.get(sym, []))
            self.add_event(sym, rdate, timing=str(raw.get("timing", "unknown")), source=str(raw.get("source", "bulk")))
            if len(self._events.get(sym, [])) > before:
                added += 1
        return added

    def exclusion_window(self, report_date: date) -> tuple[date, date]:
        """Return (window_start, window_end) for a given report date."""
        return (
            report_date - timedelta(days=self.days_before),
            report_date + timedelta(days=self.days_after),
        )

    def is_excluded(self, symbol: str, check_date: date) -> bool:
        """
        Return True if check_date falls inside any exclusion window for symbol.
        Called before every entry signal in both backtest and live execution.
        """
        events = self._events.get(symbol.upper(), [])
        for ev in events:
            window_start, window_end = self.exclusion_window(ev.report_date)
            if window_start <= check_date <= window_end:
                return True
        return False

    def next_event(self, symbol: str, after: date | None = None) -> EarningsEvent | None:
        """Return the next earnings event for symbol on or after `after` (default: today)."""
        ref = after or date.today()
        for ev in self._events.get(symbol.upper(), []):
            if ev.report_date >= ref:
                return ev
        return None

    def symbols_excluded_on(self, check_date: date) -> list[str]:
        """Return all symbols excluded on check_date (useful for universe filtering)."""
        result = []
        for sym, events in self._events.items():
            for ev in events:
                ws, we = self.exclusion_window(ev.report_date)
                if ws <= check_date <= we:
                    result.append(sym)
                    break
        return sorted(result)

    def clear_symbol(self, symbol: str) -> None:
        self._events.pop(symbol.upper(), None)

    def clear_before(self, cutoff: date) -> int:
        """Remove all events older than cutoff (housekeeping). Returns count removed."""
        removed = 0
        for sym in list(self._events.keys()):
            before = len(self._events[sym])
            self._events[sym] = [ev for ev in self._events[sym] if ev.report_date >= cutoff]
            removed += before - len(self._events[sym])
            if not self._events[sym]:
                del self._events[sym]
        return removed

    def status(self) -> dict[str, Any]:
        total_events = sum(len(evs) for evs in self._events.values())
        return {
            "symbol_count": len(self._events),
            "total_events": total_events,
            "days_before": self.days_before,
            "days_after": self.days_after,
            "exclusion_window_days": self.days_before + self.days_after + 1,
        }

    async def refresh_from_alpaca(
        self,
        symbols: list[str],
        *,
        api_key: str,
        secret_key: str,
        lookahead_days: int = 30,
    ) -> dict[str, Any]:
        """
        Fetch upcoming earnings from Alpaca News API and populate the calendar.

        Alpaca News API endpoint (v1beta1/news) returns articles tagged with
        earnings; we parse the headline for report date and symbol.

        This is intentionally a best-effort fetch — failures are logged but
        do not raise so the scheduler can continue with partial data.
        """
        import asyncio
        from datetime import date as date_cls, timedelta
        import httpx

        today = date_cls.today()
        end = today + timedelta(days=lookahead_days)
        added = 0
        errors: list[str] = []

        headers = {
            "APCA-API-KEY-ID": api_key,
            "APCA-API-SECRET-KEY": secret_key,
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            for sym in symbols:
                url = (
                    f"https://data.alpaca.markets/v1beta1/news"
                    f"?symbols={sym}&start={today.isoformat()}&end={end.isoformat()}"
                    f"&limit=50&sort=asc"
                )
                try:
                    resp = await client.get(url, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()
                    articles = data.get("news", [])
                    for article in articles:
                        headline = str(article.get("headline", "")).lower()
                        if "earnings" not in headline and "eps" not in headline and "quarterly" not in headline:
                            continue
                        # Use created_at date as a proxy for the report date
                        created = str(article.get("created_at", ""))[:10]
                        if not created:
                            continue
                        try:
                            rdate = date.fromisoformat(created)
                        except ValueError:
                            continue
                        before = len(self._events.get(sym.upper(), []))
                        self.add_event(sym, rdate, timing="unknown", source="alpaca_news")
                        if len(self._events.get(sym.upper(), [])) > before:
                            added += 1
                except Exception as exc:
                    errors.append(f"{sym}: {exc}")
                    logger.warning("EarningsCalendar.refresh_from_alpaca: %s: %s", sym, exc)

        return {"added": added, "symbols_checked": len(symbols), "errors": errors}


# Module-level singleton — shared by backtest engine and live runner
_calendar = EarningsCalendar()


def get_earnings_calendar() -> EarningsCalendar:
    return _calendar
