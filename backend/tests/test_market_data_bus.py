from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.services.deployment_runner import InMemoryDeploymentRunner
from app.services.market_data_bus import BarEvent, InMemoryMarketDataBus


@pytest.mark.asyncio
async def test_market_data_bus_fanout_by_symbol():
    bus = InMemoryMarketDataBus()
    runner_one = InMemoryDeploymentRunner("dep-1")
    runner_two = InMemoryDeploymentRunner("dep-2")
    await runner_one.start()
    await runner_two.start()

    await bus.register_runner("dep-1", {"AAPL", "MSFT"}, runner_one)
    await bus.register_runner("dep-2", {"MSFT"}, runner_two)

    delivered = await bus.publish_bar(
        BarEvent(
            symbol="MSFT",
            timeframe="1Min",
            timestamp=datetime(2024, 1, 1, 14, 30, tzinfo=timezone.utc),
            open=1.0,
            high=1.1,
            low=0.9,
            close=1.05,
            volume=1000,
        )
    )

    assert delivered == 2
    assert runner_one.status()["processed_bar_count"] == 1
    assert runner_two.status()["processed_bar_count"] == 1


@pytest.mark.asyncio
async def test_market_data_bus_unregister_runner():
    bus = InMemoryMarketDataBus()
    runner = InMemoryDeploymentRunner("dep-1")
    await runner.start()
    await bus.register_runner("dep-1", {"AAPL"}, runner)
    await bus.unregister_runner("dep-1")

    delivered = await bus.publish_bar(
        BarEvent(
            symbol="AAPL",
            timeframe="1Min",
            timestamp=datetime(2024, 1, 1, 14, 31, tzinfo=timezone.utc),
            open=1.0,
            high=1.1,
            low=0.9,
            close=1.05,
            volume=1000,
        )
    )

    assert delivered == 0
    assert runner.status()["processed_bar_count"] == 0
