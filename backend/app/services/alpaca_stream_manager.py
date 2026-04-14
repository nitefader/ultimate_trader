"""Singleton Alpaca market-data stream manager with dynamic subscriptions.

Reconnect policy
----------------
run_forever() wraps run_stream_once() in an exponential-backoff retry loop.
Delays: 1s, 2s, 4s, 8s, … capped at MAX_RECONNECT_DELAY_S (60s).
The loop only exits when _stop_requested is set (graceful shutdown).
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.services.alpaca_stream_client import AlpacaStreamClient
from app.services.deployment_runner import InMemoryDeploymentRunner
from app.services.market_data_bus import BarEvent, InMemoryMarketDataBus

ALPACA_DATA_STREAM_URL = "wss://stream.data.alpaca.markets/v2/sip"
_RECONNECT_BASE_S = 1.0
_RECONNECT_MAX_S = 60.0

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class AlpacaStreamManager:
    stream_url: str = ALPACA_DATA_STREAM_URL
    connected: bool = False
    stream_client: AlpacaStreamClient | None = None
    market_data_bus: InMemoryMarketDataBus = field(default_factory=InMemoryMarketDataBus)
    deployment_symbols: dict[str, set[str]] = field(default_factory=dict)
    deployment_runners: dict[str, InMemoryDeploymentRunner] = field(default_factory=dict)
    subscribed_symbols: set[str] = field(default_factory=set)
    pending_subscribe: set[str] = field(default_factory=set)
    pending_unsubscribe: set[str] = field(default_factory=set)
    api_key: str | None = field(default=None, repr=False)
    secret_key: str | None = field(default=None, repr=False)
    credential_source: dict[str, Any] = field(default_factory=dict)
    last_auth_at: datetime | None = None
    last_message_at: datetime | None = None
    last_subscription_payload: str | None = None
    last_reconciled_at: datetime | None = None
    reconnect_attempts: int = 0
    _stop_requested: bool = field(default=False, repr=False)

    def register_deployment(self, deployment_id: str, symbols: list[str]) -> dict[str, list[str]]:
        normalized = {str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()}
        self.deployment_symbols[deployment_id] = normalized
        return self.reconcile_subscriptions()

    def unregister_deployment(self, deployment_id: str) -> dict[str, list[str]]:
        self.deployment_symbols.pop(deployment_id, None)
        self.deployment_runners.pop(deployment_id, None)
        return self.reconcile_subscriptions()

    async def register_runner(
        self,
        deployment_id: str,
        symbols: list[str],
        account_id: str | None = None,
    ) -> InMemoryDeploymentRunner:
        normalized = sorted({str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()})
        runner = self.deployment_runners.get(deployment_id)
        if runner is None:
            runner = InMemoryDeploymentRunner(deployment_id)
            await runner.start()
            self.deployment_runners[deployment_id] = runner
        await self.market_data_bus.register_runner(deployment_id, set(normalized), runner, account_id=account_id)
        self.register_deployment(deployment_id, normalized)
        return runner

    async def unregister_runner(self, deployment_id: str) -> dict[str, list[str]]:
        await self.market_data_bus.unregister_runner(deployment_id)
        return self.unregister_deployment(deployment_id)

    def configure_credentials(
        self,
        *,
        api_key: str,
        secret_key: str,
        source_id: str | None = None,
        source_name: str | None = None,
        environment: str | None = None,
    ) -> None:
        self.api_key = api_key
        self.secret_key = secret_key
        self.credential_source = {
            "source_id": source_id,
            "source_name": source_name,
            "environment": environment,
            "configured": bool(api_key and secret_key),
        }

    def build_auth_payload(self, api_key: str, secret_key: str) -> str:
        payload = json.dumps({"action": "auth", "key": api_key, "secret": secret_key})
        self.last_auth_at = _utcnow()
        return payload

    def build_auth_payload_from_configured_service(self) -> str:
        if not self.api_key or not self.secret_key:
            raise ValueError("Alpaca stream credentials are not configured")
        return self.build_auth_payload(self.api_key, self.secret_key)

    def build_subscription_payload(
        self,
        *,
        subscribe: list[str] | None = None,
        unsubscribe: list[str] | None = None,
        channel: str = "bars",
    ) -> str:
        payload_dict: dict[str, Any] = {"action": "subscribe"}
        if subscribe:
            payload_dict[channel] = sorted({symbol.upper() for symbol in subscribe})
        if unsubscribe:
            payload_dict["action"] = "unsubscribe"
            payload_dict[channel] = sorted({symbol.upper() for symbol in unsubscribe})
        payload = json.dumps(payload_dict)
        self.last_subscription_payload = payload
        return payload

    def desired_symbols(self) -> set[str]:
        desired: set[str] = set()
        for symbols in self.deployment_symbols.values():
            desired.update(symbols)
        return desired

    def reconcile_subscriptions(self) -> dict[str, list[str]]:
        desired = self.desired_symbols()
        self.pending_subscribe = desired - self.subscribed_symbols
        self.pending_unsubscribe = self.subscribed_symbols - desired
        self.last_reconciled_at = _utcnow()
        return {
            "subscribe": sorted(self.pending_subscribe),
            "unsubscribe": sorted(self.pending_unsubscribe),
        }

    def mark_subscriptions_applied(
        self,
        *,
        subscribed: list[str] | None = None,
        unsubscribed: list[str] | None = None,
    ) -> None:
        for symbol in subscribed or []:
            self.subscribed_symbols.add(str(symbol).upper())
        for symbol in unsubscribed or []:
            self.subscribed_symbols.discard(str(symbol).upper())
        self.pending_subscribe = self.desired_symbols() - self.subscribed_symbols
        self.pending_unsubscribe = self.subscribed_symbols - self.desired_symbols()
        self.last_reconciled_at = _utcnow()

    def connect(self) -> None:
        self.connected = True
        if self.stream_client is None:
            self.stream_client = AlpacaStreamClient(self.stream_url)
        self.last_reconciled_at = _utcnow()

    def disconnect(self) -> None:
        self.connected = False
        self.last_reconciled_at = _utcnow()

    def status(self) -> dict[str, Any]:
        return {
            "stream_url": self.stream_url,
            "connected": self.connected,
            "stream_client_configured": self.stream_client is not None,
            "deployment_count": len(self.deployment_symbols),
            "runner_count": len(self.deployment_runners),
            "desired_symbols": sorted(self.desired_symbols()),
            "subscribed_symbols": sorted(self.subscribed_symbols),
            "pending_subscribe": sorted(self.pending_subscribe),
            "pending_unsubscribe": sorted(self.pending_unsubscribe),
            "credential_source": self.credential_source,
            "auth_configured": bool(self.api_key and self.secret_key),
            "last_auth_at": self.last_auth_at.isoformat() if self.last_auth_at else None,
            "last_message_at": self.last_message_at.isoformat() if self.last_message_at else None,
            "last_subscription_payload": self.last_subscription_payload,
            "last_reconciled_at": self.last_reconciled_at.isoformat() if self.last_reconciled_at else None,
            "market_data_bus": self.market_data_bus.status(),
        }

    async def publish_bar(self, bar: BarEvent) -> int:
        self.last_message_at = _utcnow()
        return await self.market_data_bus.publish_bar(bar)

    async def run_stream_once(self, *, stop_after_messages: int | None = None) -> int:
        if self.stream_client is None:
            self.stream_client = AlpacaStreamClient(self.stream_url)
        websocket = await self.stream_client.connect()
        try:
            auth_payload = self.build_auth_payload_from_configured_service()
            await self.stream_client.authenticate(websocket, auth_payload)

            changes = self.reconcile_subscriptions()
            if changes["subscribe"]:
                subscribe_payload = self.build_subscription_payload(subscribe=changes["subscribe"])
                await self.stream_client.send_subscription(websocket, subscribe_payload)
                self.mark_subscriptions_applied(subscribed=changes["subscribe"])
            if changes["unsubscribe"]:
                unsubscribe_payload = self.build_subscription_payload(unsubscribe=changes["unsubscribe"])
                await self.stream_client.send_subscription(websocket, unsubscribe_payload)
                self.mark_subscriptions_applied(unsubscribed=changes["unsubscribe"])

            self.connected = True
            processed = await self.stream_client.read_messages(
                websocket,
                on_bar=self.publish_bar,
                stop_after_messages=stop_after_messages,
            )
            return processed
        finally:
            self.connected = False
            await self.stream_client.close(websocket)


    def stop(self) -> None:
        """Signal the run_forever loop to exit after the current connection drops."""
        self._stop_requested = True

    async def run_forever(self) -> None:
        """
        Persistent stream loop with exponential-backoff reconnect.

        Runs until stop() is called. Each reconnect attempt doubles the delay
        (capped at _RECONNECT_MAX_S). A successful connection resets the counter.
        """
        self._stop_requested = False
        delay = _RECONNECT_BASE_S
        self.reconnect_attempts = 0

        while not self._stop_requested:
            if not self.api_key or not self.secret_key:
                logger.warning("AlpacaStreamManager: credentials not configured — waiting 10s")
                await asyncio.sleep(10)
                continue

            try:
                logger.info(
                    "AlpacaStreamManager: connecting (attempt %d)", self.reconnect_attempts + 1
                )
                await self.run_stream_once()
                # Successful connection terminated cleanly — reset backoff
                delay = _RECONNECT_BASE_S
                self.reconnect_attempts = 0
                logger.info("AlpacaStreamManager: stream ended cleanly")
            except asyncio.CancelledError:
                logger.info("AlpacaStreamManager: cancelled — exiting")
                break
            except Exception as exc:
                self.reconnect_attempts += 1
                logger.warning(
                    "AlpacaStreamManager: stream error (attempt %d): %s — reconnecting in %.1fs",
                    self.reconnect_attempts, exc, delay,
                )

            if self._stop_requested:
                break

            await asyncio.sleep(delay)
            delay = min(delay * 2, _RECONNECT_MAX_S)

        self.connected = False
        logger.info("AlpacaStreamManager: run_forever() exited")


_manager: AlpacaStreamManager | None = None
_manager_lock = asyncio.Lock()


async def get_alpaca_stream_manager() -> AlpacaStreamManager:
    global _manager
    async with _manager_lock:
        if _manager is None:
            _manager = AlpacaStreamManager()
        return _manager


async def reset_alpaca_stream_manager() -> AlpacaStreamManager:
    global _manager
    async with _manager_lock:
        _manager = AlpacaStreamManager()
        return _manager
