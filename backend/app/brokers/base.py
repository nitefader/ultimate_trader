"""Execution broker contract shared by paper and Alpaca brokers."""
from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class BrokerProtocol(Protocol):
    async def get_account(self) -> dict[str, Any]:
        ...

    async def get_positions(self) -> list[dict[str, Any]]:
        ...

    async def market_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        time_in_force: str = "day",
        client_order_id: str | None = None,
    ) -> dict[str, Any]:
        ...

    async def limit_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        limit_price: float,
        time_in_force: str = "day",
        client_order_id: str | None = None,
    ) -> dict[str, Any]:
        ...

    async def close_position(self, symbol: str, qty: float | None = None) -> dict[str, Any]:
        ...

    async def close_all_positions(self) -> list[dict[str, Any]] | dict[str, Any]:
        ...

    async def validate(self) -> dict[str, Any]:
        ...
