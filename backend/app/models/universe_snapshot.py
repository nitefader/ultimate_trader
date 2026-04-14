"""
UniverseSnapshot — point-in-time record of which symbols were active in a universe.

Purpose
-------
Prevents survivorship bias in backtests by restricting the set of tradeable symbols
at each bar to only those that were part of the universe at that moment in time.

Without this, a backtest that uses today's S&P 500 constituents to trade 2015 data
would implicitly include companies that were added to the index *because* they
performed well — a form of lookahead bias.

Usage in backtest
-----------------
Pass a list of UniverseSnapshot entries via run_config["universe_schedule"]:

    universe_schedule = [
        {"effective_date": "2020-01-01", "symbols": ["AAPL", "MSFT", "AMZN"]},
        {"effective_date": "2021-06-01", "symbols": ["AAPL", "MSFT", "AMZN", "TSLA"]},
    ]

The engine resolves the active symbol set at each bar by finding the most recent
snapshot whose effective_date <= current bar date. Any symbol in `data` that is
not in the active set is skipped for entry (but open positions are still managed
to exit — we never force-close a position just because a symbol left the universe).

If no universe_schedule is provided, all symbols in `data` are active for the
full backtest period (legacy behaviour, unchanged).

Fields
------
effective_date  : Date from which this snapshot is valid (inclusive)
symbols         : Set of symbols active from effective_date onward
resolved_at     : When this snapshot was generated (for audit)
source          : How the snapshot was generated (e.g. "manual", "sp500_constituent_db")
notes           : Optional free-text annotation
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import FrozenSet


@dataclass(frozen=True)
class UniverseSnapshot:
    effective_date: date
    symbols: FrozenSet[str]
    resolved_at: str | None = None          # ISO datetime string
    source: str = "manual"
    notes: str | None = None

    @classmethod
    def from_dict(cls, d: dict) -> "UniverseSnapshot":
        """Build from a plain dict (e.g. from run_config["universe_schedule"])."""
        raw_date = d["effective_date"]
        if isinstance(raw_date, str):
            raw_date = date.fromisoformat(raw_date)
        return cls(
            effective_date=raw_date,
            symbols=frozenset(str(s).upper() for s in d.get("symbols", [])),
            resolved_at=d.get("resolved_at"),
            source=str(d.get("source", "manual")),
            notes=d.get("notes"),
        )

    def to_dict(self) -> dict:
        return {
            "effective_date": self.effective_date.isoformat(),
            "symbols": sorted(self.symbols),
            "resolved_at": self.resolved_at,
            "source": self.source,
            "notes": self.notes,
        }


class UniverseSchedule:
    """
    Ordered list of UniverseSnapshot entries.
    Resolves the active symbol set for any given bar date in O(log n).
    """

    def __init__(self, snapshots: list[UniverseSnapshot]) -> None:
        # Sort ascending by effective_date so bisect works correctly.
        self._snapshots: list[UniverseSnapshot] = sorted(snapshots, key=lambda s: s.effective_date)

    @classmethod
    def from_run_config(cls, run_config: dict) -> "UniverseSchedule | None":
        """
        Build from run_config["universe_schedule"] if present.
        Returns None when no schedule is provided (all symbols active throughout).
        """
        raw = run_config.get("universe_schedule")
        if not raw or not isinstance(raw, list) or len(raw) == 0:
            return None
        return cls([UniverseSnapshot.from_dict(entry) for entry in raw])

    def active_symbols_at(self, bar_date: date) -> FrozenSet[str] | None:
        """
        Return the frozenset of active symbols for bar_date, or None if the
        schedule has no entry covering that date (caller should treat None as
        "unrestricted" — all symbols in `data` are active).
        """
        if not self._snapshots:
            return None
        # Find the latest snapshot whose effective_date <= bar_date.
        lo, hi = 0, len(self._snapshots) - 1
        result = None
        while lo <= hi:
            mid = (lo + hi) // 2
            if self._snapshots[mid].effective_date <= bar_date:
                result = self._snapshots[mid]
                lo = mid + 1
            else:
                hi = mid - 1
        return result.symbols if result is not None else None

    def __len__(self) -> int:
        return len(self._snapshots)
