from __future__ import annotations

import pytest

from app.database import create_all_tables
from app.models.optimization import OptimizationProfile
from app.services.optimizer_framework import (
    OptimizationInput,
    optimizer_registry,
    create_weight_profile,
)


@pytest.mark.asyncio
async def test_optimizer_registry_has_phase1_engines():
    registered = optimizer_registry.list_registered()
    assert {"engine_id": "equal_weight", "version": "1"} in registered
    assert {"engine_id": "capped_inverse_vol", "version": "1"} in registered
    assert {"engine_id": "simple_shrinkage_mv", "version": "1"} in registered


@pytest.mark.asyncio
async def test_create_weight_profile_equal_weight(db):
    await create_all_tables()

    profile = OptimizationProfile(
        name="EW Profile",
        engine_id="equal_weight",
        objective_config={"objective_id": "max_sharpe"},
        covariance_model={"model_id": "diagonal"},
        constraints={"max_symbol_weight": 0.6},
    )
    db.add(profile)
    await db.flush()

    weight_profile = await create_weight_profile(
        db,
        optimization_profile=profile,
        optimization_input=OptimizationInput(
            symbols=["AAPL", "MSFT", "NVDA"],
            validation_payload={"per_symbol_oos_sharpe": {"AAPL": 0.5, "MSFT": 0.6, "NVDA": 0.7}},
        ),
    )

    assert weight_profile.engine_id == "equal_weight"
    assert set(weight_profile.output_weights) == {"AAPL", "MSFT", "NVDA"}
    assert round(sum(weight_profile.output_weights.values()), 8) == 1.0


@pytest.mark.asyncio
async def test_capped_inverse_vol_uses_metadata_and_validation_floor(db):
    await create_all_tables()

    profile = OptimizationProfile(
        name="InvVol Profile",
        engine_id="capped_inverse_vol",
        constraints={"max_symbol_weight": 0.7, "min_oos_sharpe": 0.3},
        covariance_model={"model_id": "realized_vol"},
    )
    db.add(profile)
    await db.flush()

    weight_profile = await create_weight_profile(
        db,
        optimization_profile=profile,
        optimization_input=OptimizationInput(
            symbols=["AAPL", "MSFT", "TSLA"],
            metadata_version_id="md_test",
            metadata_by_symbol={
                "AAPL": {"realized_vol_30d": 0.2},
                "MSFT": {"realized_vol_30d": 0.4},
                "TSLA": {"realized_vol_30d": 0.8},
            },
            validation_payload={
                "per_symbol_oos_sharpe": {"AAPL": 0.8, "MSFT": 0.4, "TSLA": 0.1},
            },
        ),
    )

    assert "TSLA" not in weight_profile.output_weights
    assert weight_profile.metadata_version_id == "md_test"
    assert weight_profile.output_weights["AAPL"] > weight_profile.output_weights["MSFT"]


@pytest.mark.asyncio
async def test_simple_shrinkage_mv_penalizes_correlation(db):
    await create_all_tables()

    profile = OptimizationProfile(
        name="Shrinkage Profile",
        engine_id="simple_shrinkage_mv",
        covariance_model={"model_id": "shrinkage_proxy"},
    )
    db.add(profile)
    await db.flush()

    weight_profile = await create_weight_profile(
        db,
        optimization_profile=profile,
        optimization_input=OptimizationInput(
            symbols=["LOWCORR", "HIGHCORR"],
            metadata_by_symbol={
                "LOWCORR": {"realized_vol_30d": 0.3, "avg_pairwise_correlation_60d": 0.1},
                "HIGHCORR": {"realized_vol_30d": 0.3, "avg_pairwise_correlation_60d": 0.8},
            },
        ),
    )

    assert weight_profile.output_weights["LOWCORR"] > weight_profile.output_weights["HIGHCORR"]
