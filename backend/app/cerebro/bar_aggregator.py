"""BarAggregator — aggregates 1Min bars into higher timeframes with VWAP."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.services.market_data_bus import BarEvent

logger = logging.getLogger(__name__)

# How many 1Min bars make each higher timeframe
_TF_BAR_COUNTS = {
    "5m":  5,
    "15m": 15,
    "30m": 30,
    "1h":  60,
    "1d":  390,  # 6.5 hours * 60 minutes
}


@dataclass
class PartialBar:
    symbol: str
    timeframe: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    vwap_num: float   # sum(typical_price * volume)
    vwap_den: float   # sum(volume)
    bar_start: datetime
    bars_accumulated: int
    bars_needed: int

    @property
    def vwap(self) -> float:
        return self.vwap_num / self.vwap_den if self.vwap_den > 0 else self.close

    def to_bar_event(self) -> BarEvent:
        return BarEvent(
            symbol=self.symbol,
            timeframe=self.timeframe,
            timestamp=self.bar_start,
            open=self.open,
            high=self.high,
            low=self.low,
            close=self.close,
            volume=self.volume,
            source="cerebro_aggregated",
        )


class BarAggregator:
    def __init__(self, demanded_timeframes: set[str] | None = None) -> None:
        # symbol → timeframe → PartialBar
        self._partials: dict[str, dict[str, PartialBar]] = {}
        self._demanded_timeframes: set[str] = demanded_timeframes or set(_TF_BAR_COUNTS.keys())

    def set_demanded_timeframes(self, tfs: set[str]) -> None:
        self._demanded_timeframes = tfs & set(_TF_BAR_COUNTS.keys())

    def ingest(self, bar: BarEvent) -> list[BarEvent]:
        """
        Ingest a 1Min BarEvent. Returns list of completed higher-TF BarEvents.
        Always returns the original 1Min bar as first element.
        """
        completed: list[BarEvent] = [bar]

        sym = bar.symbol.upper()
        if sym not in self._partials:
            self._partials[sym] = {}

        typical = (bar.high + bar.low + bar.close) / 3.0

        for tf in self._demanded_timeframes:
            bars_needed = _TF_BAR_COUNTS.get(tf)
            if not bars_needed:
                continue

            if tf not in self._partials[sym]:
                self._partials[sym][tf] = PartialBar(
                    symbol=sym,
                    timeframe=tf,
                    open=bar.open,
                    high=bar.high,
                    low=bar.low,
                    close=bar.close,
                    volume=bar.volume,
                    vwap_num=typical * bar.volume,
                    vwap_den=bar.volume,
                    bar_start=bar.timestamp,
                    bars_accumulated=1,
                    bars_needed=bars_needed,
                )
            else:
                p = self._partials[sym][tf]
                p.high = max(p.high, bar.high)
                p.low = min(p.low, bar.low)
                p.close = bar.close
                p.volume += bar.volume
                p.vwap_num += typical * bar.volume
                p.vwap_den += bar.volume
                p.bars_accumulated += 1

                if p.bars_accumulated >= bars_needed:
                    completed.append(p.to_bar_event())
                    del self._partials[sym][tf]

        return completed

    def reset_symbol(self, symbol: str) -> None:
        self._partials.pop(symbol.upper(), None)
