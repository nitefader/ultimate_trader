from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.services.market_data_bus import InMemoryMarketDataBus, BarEvent
from app.services.technical_analysis import TechnicalAnalysisComputer


@pytest.mark.asyncio
async def test_technical_analysis_ema_computation():
    bus = InMemoryMarketDataBus()
    tac = TechnicalAnalysisComputer(market_data_bus=bus)

    await tac.register('dep-1', ['AAPL'], {'ema': [3]})

    # Publish three bars: closes 10, 12, 14 — EMA window=3 => alpha=0.5
    bars = [10.0, 12.0, 14.0]
    for i, price in enumerate(bars):
        bar = BarEvent(
            symbol='AAPL',
            timeframe='1Min',
            timestamp=datetime(2024, 1, 1, 12, 0 + i, tzinfo=timezone.utc),
            open=price,
            high=price,
            low=price,
            close=price,
            volume=100,
        )
        delivered = await bus.publish_bar(bar)
        assert delivered == 1

    latest = tac.get_latest('dep-1', 'AAPL', 'ema_3')
    # For sequence [10,12,14] with alpha=0.5, EMA final = 12.5
    assert latest is not None
    assert abs(latest - 12.5) < 1e-6
import pytest
from datetime import datetime, timezone, timedelta

from app.services.market_data_bus import InMemoryMarketDataBus, BarEvent
from app.services.technical_analysis import TechnicalAnalysisComputer


@pytest.mark.asyncio
async def test_technical_analysis_ema_computation():
    bus = InMemoryMarketDataBus()
    tac = TechnicalAnalysisComputer(market_data_bus=bus)

    deployment_id = "dep-ema-1"
    symbol = "AAPL"
    await tac.register(deployment_id, [symbol], {"ema": [3]})

    # Build 5 sequential bars, close prices: 10,11,12,13,14
    base = datetime.now(timezone.utc)
    closes = [10.0, 11.0, 12.0, 13.0, 14.0]
    for i, c in enumerate(closes):
        bar = BarEvent(
            symbol=symbol,
            timeframe="1Min",
            timestamp=base + timedelta(minutes=i),
            open=c,
            high=c,
            low=c,
            close=c,
            volume=100.0,
        )
        await bus.publish_bar(bar)

    # After 5 bars and EMA window=3 (alpha=0.5) final EMA expected ≈ 13.0625
    val = tac.get_latest(deployment_id, symbol, "ema_3")
    assert val is not None
    assert abs(val - 13.0625) < 1e-6

    # Clean up
    await tac.unregister(deployment_id)
