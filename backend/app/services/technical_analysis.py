"""Lightweight Technical Analysis computer service.

Provides EMA (and placeholder for RSI) computations per-deployment and per-symbol.
Registers as a per-deployment runner on an InMemoryMarketDataBus so it receives
bars via `on_bar()` and updates indicator state.

API:
 - `await register(deployment_id, symbols, indicators)`
 - `await unregister(deployment_id)`
 - `get_latest(deployment_id, symbol, indicator_name) -> float | None`
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any
from collections import defaultdict

from app.services.market_data_bus import InMemoryMarketDataBus, BarEvent


class TechnicalAnalysisComputer:
    def __init__(self, market_data_bus: InMemoryMarketDataBus | None = None) -> None:
        self.market_data_bus = market_data_bus or InMemoryMarketDataBus()
        # per-deployment -> symbol -> indicator_key -> value
        self._values: dict[str, dict[str, dict[str, float | None]]] = defaultdict(lambda: defaultdict(dict))
        # per-deployment indicator config: deployment -> symbol -> list of indicator specs
        self._configs: dict[str, dict[str, dict[str, Any]]] = {}
        # store created runners so we can unregister
        self._runners: dict[str, object] = {}

    async def register(self, deployment_id: str, symbols: list[str], indicators: dict[str, list[int]]) -> None:
        """Register a deployment's symbols and requested indicators.

        `indicators` example: {"ema": [3, 10], "rsi": [14]}
        """
        normalized = {s.strip().upper() for s in symbols if s}
        # build per-symbol config
        cfg: dict[str, dict[str, Any]] = {}
        for sym in normalized:
            cfg[sym] = {}
            # EMA
            ema_windows = indicators.get("ema", [])
            for w in ema_windows:
                key = f"ema_{w}"
                alpha = 2.0 / (w + 1)
                cfg[sym][key] = {"window": w, "alpha": alpha, "value": None}
                self._values.setdefault(deployment_id, {}).setdefault(sym, {})[key] = None
            # RSI placeholder — not implemented fully, reserve key space
            rsi_windows = indicators.get("rsi", [])
            for w in rsi_windows:
                key = f"rsi_{w}"
                cfg[sym][key] = {"window": w, "values": []}
                self._values.setdefault(deployment_id, {}).setdefault(sym, {})[key] = None

        self._configs[deployment_id] = cfg

        # Create a small runner that captures deployment_id and forwards bars
        tac = self

        class _Runner:
            def __init__(self, dep_id: str, tac_ref: TechnicalAnalysisComputer) -> None:
                self.dep_id = dep_id
                self.tac_ref = tac_ref

            async def on_bar(self, bar: BarEvent) -> None:
                await self.tac_ref._handle_bar(self.dep_id, bar)

        runner = _Runner(deployment_id, tac)
        self._runners[deployment_id] = runner
        await self.market_data_bus.register_runner(deployment_id, normalized, runner)

    async def unregister(self, deployment_id: str) -> None:
        await self.market_data_bus.unregister_runner(deployment_id)
        self._configs.pop(deployment_id, None)
        self._values.pop(deployment_id, None)
        self._runners.pop(deployment_id, None)

    async def _handle_bar(self, deployment_id: str, bar: BarEvent) -> None:
        sym = bar.symbol.upper()
        cfg = self._configs.get(deployment_id, {})
        symbol_cfg = cfg.get(sym)
        if not symbol_cfg:
            return
        price = float(bar.close)
        values = self._values.setdefault(deployment_id, {}).setdefault(sym, {})

        # EMA updates — broadcast each computed indicator via ws_manager
        logger = logging.getLogger(__name__)
        for key, spec in symbol_cfg.items():
            if key.startswith("ema_"):
                prev = values.get(key)
                alpha = spec.get("alpha", 0.0)
                if prev is None:
                    # initialize EMA to first close
                    new = price
                else:
                    new = prev * (1.0 - alpha) + price * alpha
                values[key] = new
                # Broadcast indicator update (best-effort, don't raise on failure)
                try:
                    from app.main import ws_manager

                    asyncio.create_task(
                        ws_manager.broadcast({
                            "type": "indicator_update",
                            "data": {
                                "deployment_id": deployment_id,
                                "symbol": sym,
                                "indicator": key,
                                "value": new,
                                "timestamp": str(bar.timestamp),
                            },
                        })
                    )
                except Exception as exc:
                    logger.debug("TAC: failed to schedule indicator broadcast: %s", exc)
            elif key.startswith("rsi_"):
                # Simple placeholder: keep recent closes; real RSI requires gains/losses
                arr = spec.setdefault("values", [])
                arr.append(price)
                if len(arr) > spec.get("window", 14) * 3:
                    arr.pop(0)
                # Not computing RSI now — leave None until implemented
                values[key] = None

    def get_latest(self, deployment_id: str, symbol: str, indicator_name: str) -> float | None:
        return self._values.get(deployment_id, {}).get(symbol.upper(), {}).get(indicator_name)
