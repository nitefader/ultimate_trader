from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.services.alpaca_stream_client import AlpacaStreamClient
from app.services.deployment_runner import InMemoryDeploymentRunner
from app.services.alpaca_stream_manager import (
    ALPACA_DATA_STREAM_URL,
    get_alpaca_stream_manager,
    reset_alpaca_stream_manager,
)
from app.services.market_data_bus import BarEvent


@pytest.mark.asyncio
async def test_alpaca_stream_manager_reconciles_deployment_symbols():
    manager = await reset_alpaca_stream_manager()
    manager.connect()

    changes = manager.register_deployment("dep-1", ["aapl", "msft"])
    assert changes == {"subscribe": ["AAPL", "MSFT"], "unsubscribe": []}
    manager.mark_subscriptions_applied(subscribed=changes["subscribe"])

    changes = manager.register_deployment("dep-2", ["MSFT", "NVDA"])
    assert changes == {"subscribe": ["NVDA"], "unsubscribe": []}
    assert manager.status()["desired_symbols"] == ["AAPL", "MSFT", "NVDA"]
    manager.mark_subscriptions_applied(subscribed=changes["subscribe"])

    changes = manager.unregister_deployment("dep-1")
    assert changes == {"subscribe": [], "unsubscribe": ["AAPL"]}
    manager.mark_subscriptions_applied(unsubscribed=changes["unsubscribe"])
    assert manager.status()["subscribed_symbols"] == ["MSFT", "NVDA"]


@pytest.mark.asyncio
async def test_alpaca_stream_manager_singleton_and_status():
    manager = await reset_alpaca_stream_manager()
    manager.connect()
    changes = manager.register_deployment("dep-1", ["spy"])
    manager.mark_subscriptions_applied(subscribed=changes["subscribe"])

    same_manager = await get_alpaca_stream_manager()
    status = same_manager.status()

    assert same_manager is manager
    assert status["connected"] is True
    assert status["stream_url"] == ALPACA_DATA_STREAM_URL
    assert status["deployment_count"] == 1
    assert status["subscribed_symbols"] == ["SPY"]


@pytest.mark.asyncio
async def test_alpaca_stream_manager_publishes_to_market_data_bus():
    manager = await reset_alpaca_stream_manager()
    runner = InMemoryDeploymentRunner("dep-1")
    await runner.start()
    await manager.market_data_bus.register_runner("dep-1", {"SPY"}, runner)

    delivered = await manager.publish_bar(
        BarEvent(
            symbol="SPY",
            timeframe="1Min",
            timestamp=datetime(2024, 1, 1, 14, 30, tzinfo=timezone.utc),
            open=1.0,
            high=1.1,
            low=0.9,
            close=1.05,
            volume=1000,
        )
    )

    assert delivered == 1
    assert runner.status()["processed_bar_count"] == 1


@pytest.mark.asyncio
async def test_alpaca_stream_manager_builds_auth_and_subscription_payloads():
    manager = await reset_alpaca_stream_manager()
    auth_payload = manager.build_auth_payload("key123", "secret456")
    assert '"action": "auth"' in auth_payload
    assert '"key": "key123"' in auth_payload

    sub_payload = manager.build_subscription_payload(subscribe=["spy", "aapl"])
    assert '"action": "subscribe"' in sub_payload
    assert '"bars": ["AAPL", "SPY"]' in sub_payload

    unsub_payload = manager.build_subscription_payload(unsubscribe=["spy"])
    assert '"action": "unsubscribe"' in unsub_payload
    assert '"bars": ["SPY"]' in unsub_payload


@pytest.mark.asyncio
async def test_alpaca_stream_manager_uses_configured_service_credentials():
    manager = await reset_alpaca_stream_manager()
    manager.configure_credentials(
        api_key="key123",
        secret_key="secret456",
        source_id="svc-1",
        source_name="Paper Data",
        environment="paper",
    )

    auth_payload = manager.build_auth_payload_from_configured_service()
    status = manager.status()

    assert '"action": "auth"' in auth_payload
    assert status["auth_configured"] is True
    assert status["credential_source"]["source_id"] == "svc-1"
    assert status["credential_source"]["source_name"] == "Paper Data"
    assert status["credential_source"]["environment"] == "paper"
    assert "last_auth_at" in status


class _FakeWebSocket:
    def __init__(self, messages):
        self.messages = list(messages)
        self.sent = []
        self.closed = False

    async def send(self, message: str):
        self.sent.append(message)

    async def recv(self) -> str:
        if not self.messages:
            raise RuntimeError("done")
        return self.messages.pop(0)

    async def close(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_alpaca_stream_manager_runs_single_stream_cycle():
    manager = await reset_alpaca_stream_manager()
    manager.configure_credentials(
        api_key="key123",
        secret_key="secret456",
        source_id="svc-1",
        source_name="Paper Data",
        environment="paper",
    )
    await manager.register_runner("dep-1", ["SPY"])

    fake_socket = _FakeWebSocket(
        ['[{"T":"b","S":"SPY","t":"2024-04-01T14:30:00Z","o":1,"h":2,"l":0.5,"c":1.5,"v":100}]']
    )

    async def _factory(url: str):
        assert url == ALPACA_DATA_STREAM_URL
        return fake_socket

    manager.stream_client = AlpacaStreamClient(ALPACA_DATA_STREAM_URL, socket_factory=_factory)
    processed = await manager.run_stream_once(stop_after_messages=1)
    status = manager.status()

    assert processed == 1
    assert status["connected"] is False
    assert status["last_auth_at"] is not None
    assert status["last_message_at"] is not None
    assert '"action": "auth"' in fake_socket.sent[0]
    assert '"action": "subscribe"' in fake_socket.sent[1]
    assert fake_socket.closed is True
