"""
Alpaca account event streaming — subscribes to trade_updates (fills, order state changes)
and publishes them into ws_manager.broadcast() so the frontend Live Monitor gets real-time
fills/position changes without polling.

Usage (in lifespan startup):
    from app.services.alpaca_account_stream import start_alpaca_account_stream
    asyncio.create_task(start_alpaca_account_stream())

The service reads credentials from the first active Account with broker_config and
restarts automatically on disconnect with exponential backoff.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_RECONNECT_BASE_S = 5.0
_RECONNECT_MAX_S = 120.0


async def _run_account_stream_once(api_key: str, secret_key: str, paper: bool) -> None:
    """
    Connect to Alpaca TradingStream, subscribe to trade_updates, and forward
    each event to ws_manager.broadcast() as { type: "order_fill", data: {...} }.

    Runs until the connection drops.
    """
    # Import ws_manager lazily to avoid circular import
    from app.main import ws_manager
    from app.services.alpaca_service import create_account_stream_runner

    async def handle_trade_update(data: dict) -> None:
        try:
            event_type = data.get("event", "")
            order = data.get("order", {})

            # Map Alpaca events → our WS event types
            if event_type in ("fill", "partial_fill"):
                ws_type = "order_fill"
            elif event_type in ("canceled", "expired", "rejected"):
                ws_type = "governor_event"
            else:
                ws_type = "order_fill"

            await ws_manager.broadcast({
                "type": ws_type,
                "data": {
                    "event": event_type,
                    "symbol": order.get("symbol"),
                    "side": order.get("side"),
                    "qty": order.get("qty"),
                    "filled_qty": order.get("filled_qty"),
                    "filled_avg_price": order.get("filled_avg_price"),
                    "order_id": order.get("id"),
                    "client_order_id": order.get("client_order_id"),
                    "status": order.get("status"),
                },
                "ts": datetime.now(timezone.utc).isoformat(),
            })
        except Exception as exc:
            logger.warning("alpaca_account_stream: error broadcasting trade update: %s", exc)

    logger.info("alpaca_account_stream: starting %s stream (delegated to alpaca_service)", "paper" if paper else "live")
    # Delegate TradingStream creation/run to alpaca_service. Tests can inject a
    # fake stream via the `stream_factory` parameter on create_account_stream_runner.
    await create_account_stream_runner(handle_trade_update, api_key, secret_key, paper)


_TRADING_ACCOUNT_NAME = "Paper1_OtijiTrader_UseTest"


async def start_alpaca_account_stream() -> None:
    """
    Long-running coroutine — call as asyncio.create_task() in lifespan startup.

    Reads Alpaca credentials from Paper1_OtijiTrader_UseTest (the designated trading
    account). Falls back to any account with credentials if the named account is not
    found. Auto-reconnects with exponential backoff.
    """
    from app.database import AsyncSessionLocal
    from app.models.account import Account
    from sqlalchemy import select

    delay = _RECONNECT_BASE_S

    while True:
        api_key: str | None = None
        secret_key: str | None = None
        paper = True

        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Account).limit(20))
                accounts = result.scalars().all()

            # Prefer the designated trading account; fall back to first with credentials
            ordered = sorted(
                accounts,
                key=lambda a: 0 if a.name == _TRADING_ACCOUNT_NAME else 1,
            )
            for acct in ordered:
                cfg = acct.broker_config or {}
                for mode in ("paper", "live"):
                    mode_cfg = cfg.get(mode, {})
                    key = mode_cfg.get("api_key", "")
                    secret = mode_cfg.get("secret_key", "")
                    if key and secret:
                        api_key = key
                        secret_key = secret
                        paper = (mode == "paper")
                        logger.info(
                            "alpaca_account_stream: using account %r (%s mode)",
                            acct.name, mode,
                        )
                        break
                if api_key:
                    break

        except Exception as exc:
            logger.warning("alpaca_account_stream: DB credential lookup failed: %s — retrying in %.1fs", exc, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, _RECONNECT_MAX_S)
            continue

        if not api_key or not secret_key:
            logger.debug("alpaca_account_stream: no Alpaca credentials found — sleeping 60s")
            await asyncio.sleep(60)
            delay = _RECONNECT_BASE_S
            continue

        try:
            await asyncio.wait_for(
                _run_account_stream_once(api_key, secret_key, paper),
                timeout=None,
            )
            # Clean exit — reset backoff
            delay = _RECONNECT_BASE_S
            logger.info("alpaca_account_stream: stream ended cleanly — reconnecting in %.1fs", delay)
        except asyncio.CancelledError:
            logger.info("alpaca_account_stream: cancelled")
            return
        except Exception as exc:
            logger.warning(
                "alpaca_account_stream: stream error: %s — reconnecting in %.1fs", exc, delay
            )

        await asyncio.sleep(delay)
        delay = min(delay * 2, _RECONNECT_MAX_S)
