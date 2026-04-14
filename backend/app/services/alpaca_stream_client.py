"""Low-level Alpaca websocket transport and bar parsing."""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Protocol

import websockets

from app.services.market_data_bus import BarEvent


class WebSocketProtocol(Protocol):
    async def send(self, message: str) -> None:
        ...

    async def recv(self) -> str:
        ...

    async def close(self) -> None:
        ...


def _parse_timestamp(raw: str) -> datetime:
    normalized = raw.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    return dt.astimezone(timezone.utc)


def parse_alpaca_stream_message(message: str, *, timeframe: str = "1Min") -> list[BarEvent]:
    try:
        payload = json.loads(message)
    except json.JSONDecodeError:
        return []

    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        return []

    bars: list[BarEvent] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        event_type = str(item.get("T", "")).lower()
        if event_type != "b":
            continue
        symbol = str(item.get("S", "")).upper()
        timestamp = item.get("t")
        if not symbol or not timestamp:
            continue
        try:
            bars.append(
                BarEvent(
                    symbol=symbol,
                    timeframe=timeframe,
                    timestamp=_parse_timestamp(str(timestamp)),
                    open=float(item.get("o", 0.0)),
                    high=float(item.get("h", 0.0)),
                    low=float(item.get("l", 0.0)),
                    close=float(item.get("c", 0.0)),
                    volume=float(item.get("v", 0.0)),
                    source="alpaca",
                )
            )
        except (TypeError, ValueError):
            continue
    return bars


@dataclass
class AlpacaStreamClient:
    stream_url: str
    socket_factory: Callable[[str], Awaitable[WebSocketProtocol]] | None = None

    async def connect(self) -> WebSocketProtocol:
        if self.socket_factory is not None:
            return await self.socket_factory(self.stream_url)
        return await websockets.connect(self.stream_url)

    async def authenticate(self, websocket: WebSocketProtocol, auth_payload: str) -> None:
        await websocket.send(auth_payload)

    async def send_subscription(self, websocket: WebSocketProtocol, payload: str) -> None:
        await websocket.send(payload)

    async def read_messages(
        self,
        websocket: WebSocketProtocol,
        *,
        on_bar: Callable[[BarEvent], Awaitable[None]],
        stop_after_messages: int | None = None,
    ) -> int:
        processed = 0
        while True:
            if stop_after_messages is not None and processed >= stop_after_messages:
                return processed
            raw = await websocket.recv()
            bars = parse_alpaca_stream_message(raw)
            for bar in bars:
                await on_bar(bar)
                processed += 1
                if stop_after_messages is not None and processed >= stop_after_messages:
                    return processed

    async def close(self, websocket: WebSocketProtocol) -> None:
        await websocket.close()
