"""In-memory market data bus for symbol-based runner fanout.

Kill switch integration (P2-S6)
--------------------------------
publish_bar() checks the kill switch before delivering each bar:
- Global kill: no bars delivered to any runner.
- Account kill: bars skipped for all deployments on that account.
The bus stores account_id per deployment (set at register_runner time).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from app.core.kill_switch import get_kill_switch

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BarEvent:
    symbol: str
    timeframe: str
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    source: str = "alpaca"


class DeploymentRunnerProtocol(Protocol):
    async def on_bar(self, bar: BarEvent) -> None:
        ...


class InMemoryMarketDataBus:
    def __init__(self) -> None:
        self._runner_symbols: dict[str, set[str]] = {}
        self._runners: dict[str, DeploymentRunnerProtocol] = {}
        self._deployment_account: dict[str, str] = {}   # deployment_id → account_id

    async def register_runner(
        self,
        deployment_id: str,
        symbols: set[str],
        runner: DeploymentRunnerProtocol,
        account_id: str | None = None,
    ) -> None:
        self._runner_symbols[deployment_id] = {symbol.upper() for symbol in symbols}
        self._runners[deployment_id] = runner
        if account_id:
            self._deployment_account[deployment_id] = account_id

    async def unregister_runner(self, deployment_id: str) -> None:
        self._runner_symbols.pop(deployment_id, None)
        self._runners.pop(deployment_id, None)
        self._deployment_account.pop(deployment_id, None)

    async def publish_bar(self, bar: BarEvent) -> int:
        ks = get_kill_switch()

        # Global kill — drop the bar entirely, log once per call.
        if ks.is_globally_killed:
            logger.debug("DataBus: global kill active — bar %s@%s dropped", bar.symbol, bar.timestamp)
            return 0

        delivered = 0
        symbol = bar.symbol.upper()
        for deployment_id, symbols in self._runner_symbols.items():
            if symbol not in symbols:
                continue
            runner = self._runners.get(deployment_id)
            if runner is None:
                continue

            # Account-level kill check
            account_id = self._deployment_account.get(deployment_id)
            if account_id and ks.is_account_killed(account_id):
                logger.debug(
                    "DataBus: account %s killed — skipping bar %s for deployment %s",
                    account_id, bar.symbol, deployment_id,
                )
                continue

            await runner.on_bar(bar)
            delivered += 1
        return delivered

    def status(self) -> dict[str, object]:
        return {
            "runner_count": len(self._runners),
            "subscriptions": {
                deployment_id: sorted(symbols)
                for deployment_id, symbols in sorted(self._runner_symbols.items())
            },
            "deployment_accounts": dict(self._deployment_account),
        }
