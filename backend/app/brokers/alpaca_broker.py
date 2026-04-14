"""
Async Alpaca broker wrapper.

This broker delegates all paper/live trading work to the shared alpaca_service
module so both modes use the same internal config and request models.
"""
from __future__ import annotations

import asyncio
from typing import Any

from app.services.alpaca_service import (
    AlpacaClientConfig,
    AlpacaClosePositionRequest,
    build_client_config,
    cancel_all_orders as svc_cancel_all_orders,
    cancel_order as svc_cancel_order,
    check_symbols_eligibility as svc_check_symbols_eligibility,
    close_all_positions as svc_close_all_positions,
    close_position as svc_close_position,
    get_account as svc_get_account,
    get_account_status as svc_get_account_status,
    get_asset_info as svc_get_asset_info,
    get_orders as svc_get_orders,
    get_positions as svc_get_positions,
    place_bracket_order as svc_place_bracket_order,
    place_limit_order as svc_place_limit_order,
    place_market_order as svc_place_market_order,
)


class AlpacaBroker:
    """Async facade for the shared Alpaca Trading API v2 service."""

    def __init__(self, config: AlpacaClientConfig) -> None:
        self._config = config

    @classmethod
    def from_account(cls, account: Any) -> "AlpacaBroker":
        mode = str(account.mode).strip().lower()
        mode_config = (account.broker_config or {}).get(mode, {})
        api_key = mode_config.get("api_key", "")
        secret_key = mode_config.get("secret_key", "")
        if not api_key or not secret_key:
            raise ValueError(f"Alpaca {mode} credentials not configured for account '{account.name}'")

        config = build_client_config(
            api_key=api_key,
            secret_key=secret_key,
            mode=mode,
            base_url=mode_config.get("base_url"),
        )
        return cls(config)

    @classmethod
    def from_keys(
        cls,
        api_key: str,
        secret_key: str,
        paper: bool = True,
        base_url: str | None = None,
    ) -> "AlpacaBroker":
        config = build_client_config(
            api_key=api_key,
            secret_key=secret_key,
            mode="paper" if paper else "live",
            base_url=base_url,
        )
        return cls(config)

    async def _run(self, fn, *args, **kwargs):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))

    async def get_account(self) -> dict[str, Any]:
        return await self._run(svc_get_account, self._config)

    async def get_status(self) -> dict[str, Any]:
        return await self._run(svc_get_account_status, self._config)

    async def get_positions(self) -> list[dict[str, Any]]:
        return await self._run(svc_get_positions, self._config)

    async def get_orders(self, status: str = "open") -> list[dict[str, Any]]:
        return await self._run(svc_get_orders, self._config, status)

    async def market_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        time_in_force: str = "day",
        client_order_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._run(
            svc_place_market_order,
            self._config,
            symbol,
            qty,
            side,
            time_in_force,
            "us_equity",
            client_order_id,
        )

    async def limit_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        limit_price: float,
        time_in_force: str = "day",
        client_order_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._run(
            svc_place_limit_order,
            self._config,
            symbol,
            qty,
            side,
            limit_price,
            time_in_force,
            "us_equity",
            client_order_id,
        )

    async def cancel_order(self, order_id: str) -> dict[str, Any]:
        return await self._run(svc_cancel_order, self._config, order_id)

    async def cancel_all_orders(self) -> dict[str, Any]:
        return await self._run(svc_cancel_all_orders, self._config)

    async def close_position(self, symbol: str, qty: float | None = None) -> dict[str, Any]:
        return await self._run(
            svc_close_position,
            self._config,
            AlpacaClosePositionRequest(symbol=symbol, qty=qty),
        )

    async def close_all_positions(self) -> list[dict[str, Any]]:
        return await self._run(svc_close_all_positions, self._config)

    async def bracket_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        *,
        stop_price: float | None = None,
        take_profit_price: float | None = None,
        time_in_force: str = "day",
        client_order_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._run(
            svc_place_bracket_order,
            self._config,
            symbol,
            qty,
            side,
            stop_price=stop_price,
            take_profit_price=take_profit_price,
            time_in_force=time_in_force,
            client_order_id=client_order_id,
        )

    async def get_asset_info(self, symbol: str) -> dict[str, Any]:
        return await self._run(svc_get_asset_info, self._config, symbol)

    async def check_symbols_eligibility(
        self,
        symbols: list[str],
        *,
        require_shortable: bool = False,
        require_fractionable: bool = False,
    ) -> dict[str, Any]:
        return await self._run(
            svc_check_symbols_eligibility,
            self._config,
            symbols,
            require_shortable=require_shortable,
            require_fractionable=require_fractionable,
        )

    async def validate(self) -> dict[str, Any]:
        return await self.get_account()
