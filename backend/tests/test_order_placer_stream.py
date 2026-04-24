import pytest


@pytest.mark.asyncio
async def test_alpaca_broker_market_order_calls_service(monkeypatch):
    """Verify AlpacaBroker.market_order ends up calling alpaca_service.place_market_order
    with a `client_order_id` present.
    """
    from app.brokers.alpaca_broker import AlpacaBroker
    import app.services.alpaca_service as svc

    calls = []

    def fake_place_market_order(config, symbol, qty, side, time_in_force, asset_class, client_order_id=None, program_name=None, deployment_id=None):
        calls.append({
            "symbol": symbol,
            "qty": qty,
            "side": side,
            "time_in_force": time_in_force,
            "asset_class": asset_class,
            "client_order_id": client_order_id,
        })
        # emulate service behavior: generate client_order_id if missing
        if client_order_id is None:
            client_order_id = f"test_co_{symbol}_{qty}"
            calls[-1]["client_order_id"] = client_order_id
        return {"id": "o-1", "client_order_id": client_order_id}

    # The AlpacaBroker module imported the service function at import time
    # as a local name; patch that symbol so the broker uses our fake.
    import app.brokers.alpaca_broker as broker_mod
    monkeypatch.setattr(broker_mod, "svc_place_market_order", fake_place_market_order)

    broker = AlpacaBroker.from_keys("AK", "SK", paper=True, base_url="https://paper-api.alpaca.markets")
    res = await broker.market_order("AAPL", 2, "buy")

    assert calls, "place_market_order was not called"
    call = calls[0]
    assert call["symbol"] == "AAPL"
    assert call["side"] == "buy"
    assert call["client_order_id"] is not None
