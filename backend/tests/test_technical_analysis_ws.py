import asyncio
import pytest

from datetime import datetime, timezone

from app.services.market_data_bus import InMemoryMarketDataBus, BarEvent
from app.services.technical_analysis import TechnicalAnalysisComputer


@pytest.mark.asyncio
async def test_technical_analysis_broadcasts_indicator(monkeypatch):
    bus = InMemoryMarketDataBus()
    tac = TechnicalAnalysisComputer(market_data_bus=bus)

    # Dummy WS manager to capture broadcasts
    messages = []

    class DummyWS:
        async def broadcast(self, msg):
            messages.append(msg)

    # Patch app.main.ws_manager lazily
    import app.main as main
    monkeypatch.setattr(main, "ws_manager", DummyWS())

    await tac.register("dep-1", ["AAPL"], {"ema": [3]})

    bar = BarEvent(
        symbol="AAPL",
        timeframe="1m",
        timestamp=datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc),
        open=10.0,
        high=10.5,
        low=9.8,
        close=10.0,
        volume=100,
    )

    delivered = await bus.publish_bar(bar)
    assert delivered == 1

    # Allow broadcast task to run
    await asyncio.sleep(0.05)

    assert messages, "No broadcasts captured"
    found = False
    for m in messages:
        if m.get("type") == "indicator_update":
            data = m.get("data", {})
            assert data.get("deployment_id") == "dep-1"
            assert data.get("symbol") == "AAPL"
            assert data.get("indicator") == "ema_3"
            assert abs(float(data.get("value")) - 10.0) < 1e-6
            found = True
    assert found, "indicator_update not found in broadcasts"
