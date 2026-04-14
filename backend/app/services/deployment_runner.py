"""Thin per-deployment runner contract and in-memory implementation."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime

from app.services.market_data_bus import BarEvent


@dataclass
class InMemoryDeploymentRunner:
    deployment_id: str
    processed_bars: list[BarEvent] = field(default_factory=list)
    last_bar_by_symbol: dict[str, datetime] = field(default_factory=dict)
    _started: bool = False
    _queue: asyncio.Queue[BarEvent] = field(default_factory=asyncio.Queue)

    async def start(self) -> None:
        self._started = True

    async def stop(self) -> None:
        self._started = False

    async def on_bar(self, bar: BarEvent) -> None:
        if not self._started:
            return
        await self._queue.put(bar)
        self.processed_bars.append(bar)
        self.last_bar_by_symbol[bar.symbol.upper()] = bar.timestamp

    def status(self) -> dict[str, object]:
        return {
            "deployment_id": self.deployment_id,
            "started": self._started,
            "processed_bar_count": len(self.processed_bars),
            "last_bar_by_symbol": {
                symbol: ts.isoformat()
                for symbol, ts in sorted(self.last_bar_by_symbol.items())
            },
        }
