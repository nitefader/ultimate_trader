from __future__ import annotations

from datetime import datetime, timezone
import uuid

import pytest

from app.models.run import BacktestRun, RunMetrics


async def _seed_run(db, *, with_walk_forward: bool = False) -> BacktestRun:
    run_id = str(uuid.uuid4())
    run = BacktestRun(
        id=run_id,
        strategy_version_id=str(uuid.uuid4()),
        mode='backtest',
        status='completed',
        symbols=['SPY'],
        timeframe='1d',
        start_date='2020-01-01',
        end_date='2020-12-31',
        initial_capital=100000,
        created_at=datetime.now(timezone.utc),
    )
    db.add(run)
    await db.flush()

    walk_forward = None
    if with_walk_forward:
        walk_forward = {
            'aggregate_oos': {
                'oos_total_return_pct': 12.3,
                'avg_oos_return_pct': 2.1,
            },
            'anti_bias': {
                'leakage_checks_passed': True,
                'parameter_locking_passed': True,
                'causal_indicator_checks_passed': True,
            },
        }

    metrics = RunMetrics(
        id=str(uuid.uuid4()),
        run_id=run_id,
        total_return_pct=10.0,
        cagr_pct=8.0,
        sharpe_ratio=1.2,
        max_drawdown_pct=5.0,
        win_rate_pct=55.0,
        profit_factor=1.5,
        total_trades=42,
        walk_forward=walk_forward,
    )
    db.add(metrics)
    await db.commit()
    return run


@pytest.mark.asyncio
async def test_compare_runs_success(client, db):
    run_a = await _seed_run(db)
    run_b = await _seed_run(db)

    resp = await client.post(f'/api/v1/backtests/{run_a.id}/compare', json={'other_run_id': run_b.id})
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body['left_run']['run_id'] == run_a.id
    assert body['right_run']['run_id'] == run_b.id
    assert 'deltas' in body
    assert 'total_return_pct' in body['deltas']


@pytest.mark.asyncio
async def test_compare_runs_requires_other_run_id(client, db):
    run_a = await _seed_run(db)
    resp = await client.post(f'/api/v1/backtests/{run_a.id}/compare', json={})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_compare_runs_rejects_self_compare(client, db):
    run_a = await _seed_run(db)
    resp = await client.post(f'/api/v1/backtests/{run_a.id}/compare', json={'other_run_id': run_a.id})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_compare_runs_404_for_missing_other(client, db):
    run_a = await _seed_run(db)
    resp = await client.post(
        f'/api/v1/backtests/{run_a.id}/compare',
        json={'other_run_id': '00000000-0000-0000-0000-000000000999'},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_compare_runs_includes_walk_forward_fields(client, db):
    run_a = await _seed_run(db, with_walk_forward=True)
    run_b = await _seed_run(db, with_walk_forward=True)

    resp = await client.post(f'/api/v1/backtests/{run_a.id}/compare', json={'other_run_id': run_b.id})
    assert resp.status_code == 200
    body = resp.json()

    assert body['left_run']['oos_total_return_pct'] == 12.3
    assert body['left_run']['avg_oos_return_pct'] == 2.1
    assert body['left_run']['anti_bias_passed'] is True
