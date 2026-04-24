import pytest

import importlib


@pytest.mark.asyncio
async def test_alpaca_account_stream_forwards_trade_update(monkeypatch):
    """Ensure trade_updates events are forwarded to ws_manager.broadcast()"""
    # Replace the app.main.ws_manager with a dummy recorder
    main = importlib.import_module("app.main")

    calls = []

    class DummyWS:
        async def broadcast(self, message):
            calls.append(message)

    monkeypatch.setattr(main, "ws_manager", DummyWS())

    # Patch the alpaca_service runner to call the provided callback with a fake event
    alpaca_service = importlib.import_module("app.services.alpaca_service")

    async def fake_create_runner(callback, api_key, secret_key, paper):
        event = {
            "event": "fill",
            "order": {
                "symbol": "AAPL",
                "side": "buy",
                "qty": 1,
                "filled_qty": 1,
                "filled_avg_price": 150.0,
                "id": "ord-1",
                "client_order_id": "co-1",
                "status": "filled",
            },
        }
        await callback(event)

    monkeypatch.setattr(alpaca_service, "create_account_stream_runner", fake_create_runner)

    # Invoke the account-stream single-run function which will use our patched runner
    acct_stream = importlib.import_module("app.services.alpaca_account_stream")
    await acct_stream._run_account_stream_once("AK", "SK", True)

    assert len(calls) == 1
    msg = calls[0]
    assert msg["type"] == "order_fill"
    data = msg["data"]
    assert data["symbol"] == "AAPL"
    assert data["order_id"] == "ord-1"
    assert data["client_order_id"] == "co-1"
    assert data["status"] == "filled"
    assert "ts" in msg
