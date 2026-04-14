from __future__ import annotations

from datetime import timezone

import pytest

from app.services.alpaca_stream_client import AlpacaStreamClient, parse_alpaca_stream_message


class FakeWebSocket:
    def __init__(self, messages: list[str]) -> None:
        self.messages = list(messages)
        self.sent: list[str] = []
        self.closed = False

    async def send(self, message: str) -> None:
        self.sent.append(message)

    async def recv(self) -> str:
        if not self.messages:
            raise RuntimeError("no more messages")
        return self.messages.pop(0)

    async def close(self) -> None:
        self.closed = True


def test_parse_alpaca_stream_message_extracts_bars() -> None:
    bars = parse_alpaca_stream_message(
        '[{"T":"b","S":"SPY","t":"2024-04-01T14:30:00Z","o":520.1,"h":521.0,"l":519.8,"c":520.5,"v":1200}]'
    )
    assert len(bars) == 1
    assert bars[0].symbol == "SPY"
    assert bars[0].timestamp.tzinfo == timezone.utc
    assert bars[0].close == 520.5


def test_parse_alpaca_stream_message_ignores_non_bar_and_bad_json() -> None:
    assert parse_alpaca_stream_message('{"T":"success","msg":"authenticated"}') == []
    assert parse_alpaca_stream_message("not json") == []


@pytest.mark.asyncio
async def test_alpaca_stream_client_connect_auth_subscribe_and_read():
    fake_socket = FakeWebSocket(
        ['[{"T":"b","S":"QQQ","t":"2024-04-01T14:31:00Z","o":1,"h":2,"l":0.5,"c":1.5,"v":100}]']
    )

    async def _factory(url: str):
        assert url == "wss://example.test"
        return fake_socket

    client = AlpacaStreamClient("wss://example.test", socket_factory=_factory)
    socket = await client.connect()
    await client.authenticate(socket, '{"action":"auth"}')
    await client.send_subscription(socket, '{"action":"subscribe","bars":["QQQ"]}')

    seen = []

    async def _on_bar(bar):
        seen.append(bar.symbol)

    processed = await client.read_messages(socket, on_bar=_on_bar, stop_after_messages=1)
    await client.close(socket)

    assert fake_socket.sent == ['{"action":"auth"}', '{"action":"subscribe","bars":["QQQ"]}']
    assert processed == 1
    assert seen == ["QQQ"]
    assert fake_socket.closed is True
