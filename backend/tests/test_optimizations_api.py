from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.market_metadata import MarketMetadataSnapshot, MarketMetadataSymbol
from app.models.run import BacktestRun
from app.models.symbol_universe import SymbolUniverseSnapshot
from app.models.strategy import Strategy, StrategyVersion
from app.models.validation_evidence import ValidationEvidence


@pytest.mark.asyncio
async def test_optimization_profile_and_weight_generation(client, db):
    strategy = Strategy(name="Optimizer Strategy")
    db.add(strategy)
    await db.flush()

    version = StrategyVersion(strategy_id=strategy.id, version=1, config={"symbols": ["AAPL", "MSFT"]})
    db.add(version)
    await db.flush()

    run = BacktestRun(
        strategy_version_id=version.id,
        symbols=["AAPL", "MSFT"],
        timeframe="1d",
        start_date="2024-01-01",
        end_date="2024-03-31",
    )
    db.add(run)
    await db.flush()

    evidence = ValidationEvidence(
        run_id=run.id,
        per_symbol_oos_sharpe={"AAPL": 0.7, "MSFT": 0.5},
        cpcv={"aggregate": {"median_oos_sharpe": 1.2}},
    )
    db.add(evidence)

    universe = SymbolUniverseSnapshot(
        source_watchlist_id="watchlist-1",
        overlay_watchlist_ids=[],
        deny_list=[],
        effective_date="2024-03-31",
        resolved_symbols=["AAPL", "MSFT"],
        resolved_symbol_count=2,
        metadata_version_id="md_test_optimizer",
    )
    db.add(universe)

    snapshot = MarketMetadataSnapshot(
        metadata_version_id="md_test_optimizer",
        as_of_date="2024-03-31",
        symbol_count=2,
    )
    db.add(snapshot)
    await db.flush()
    db.add(
        MarketMetadataSymbol(
            snapshot_id=snapshot.id,
            symbol="AAPL",
            sector_tag="tech",
            benchmark_symbol="SPY",
            realized_vol_30d=0.2,
            avg_pairwise_correlation_60d=0.3,
        )
    )
    db.add(
        MarketMetadataSymbol(
            snapshot_id=snapshot.id,
            symbol="MSFT",
            sector_tag="tech",
            benchmark_symbol="SPY",
            realized_vol_30d=0.4,
            avg_pairwise_correlation_60d=0.3,
        )
    )
    await db.commit()

    create_resp = await client.post(
        "/api/v1/optimizations",
        json={
            "name": "Inverse Vol",
            "engine_id": "capped_inverse_vol",
            "strategy_version_id": version.id,
            "validation_evidence_id": evidence.id,
            "symbol_universe_snapshot_id": universe.id,
            "constraints": {"max_symbol_weight": 0.7},
            "covariance_model": {"model_id": "realized_vol"},
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    profile = create_resp.json()
    assert profile["engine_id"] == "capped_inverse_vol"

    weights_resp = await client.post(
        f"/api/v1/optimizations/{profile['id']}/weights",
        json={"symbols": ["AAPL", "MSFT"], "metadata_version_id": "md_test_optimizer"},
    )
    assert weights_resp.status_code == 200, weights_resp.text
    weight_profile = weights_resp.json()
    assert weight_profile["metadata_version_id"] == "md_test_optimizer"
    assert weight_profile["symbol_universe_snapshot_id"] == universe.id
    assert weight_profile["output_weights"]["AAPL"] > weight_profile["output_weights"]["MSFT"]

    list_resp = await client.get("/api/v1/optimizations")
    assert list_resp.status_code == 200
    assert any(item["id"] == profile["id"] for item in list_resp.json()["items"])


@pytest.mark.asyncio
async def test_optimization_weight_generation_requires_symbols(client):
    resp = await client.post(
        "/api/v1/optimizations/not-real/weights",
        json={"symbols": []},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "symbols required"
