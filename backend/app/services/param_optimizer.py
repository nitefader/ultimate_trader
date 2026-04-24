"""
Strategy parameter optimizer — exhaustive grid search over the backtest engine.

This is distinct from the portfolio-weight optimizer (optimizer_framework.py).
That optimizes capital allocation across strategies.
This optimizes *strategy parameters* (e.g. EMA periods, ATR multiplier) by
running the backtest engine over a parameter grid and ranking configs by a
chosen objective metric.

Architecture
------------
- Caller provides a strategy config, run config, and a param_grid dict.
- param_grid maps dotted config paths to lists of candidate values.
  Example: {"stop_loss.multiplier": [1.5, 2.0, 2.5], "entry.conditions.0.right.value": [9, 12, 21]}
- All combinations are enumerated (capped at max_combinations).
- Each combination is run through the backtest engine in-process.
- Results are ranked by objective_metric (default: sharpe_ratio).
- Returns a ranked list of param sets with their full metric snapshots.

Usage
-----
    results = await run_param_optimization(
        strategy_config=sv.config,
        run_config=run_config,
        param_grid={"stop_loss.multiplier": [1.5, 2.0, 2.5]},
        objective_metric="sharpe_ratio",
        max_combinations=50,
    )
    best = results["ranked"][0]
    best_params = best["params"]
    best_metrics = best["metrics"]

Concurrency
-----------
Backtest runs are CPU-bound. Each combination runs in a ThreadPoolExecutor
worker to avoid blocking the event loop. Workers are capped at MAX_WORKERS.
"""
from __future__ import annotations

import asyncio
import itertools
import logging
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from app.features.source_contracts import resolve_requested_provider
from app.services.backtest_service import recommend_data_provider

logger = logging.getLogger(__name__)

MAX_WORKERS = 4
_DEFAULT_MAX_COMBINATIONS = 64
_DEFAULT_OBJECTIVE = "sharpe_ratio"

# Metrics where lower is better (we negate for ranking)
_LOWER_IS_BETTER = {"max_drawdown_pct", "max_drawdown"}


def _set_nested(cfg: dict, path: str, value: Any) -> None:
    """Set a value in a nested dict using dot-separated path."""
    parts = path.split(".")
    node = cfg
    for part in parts[:-1]:
        if part.isdigit():
            # list index — caller must ensure node is a list
            node = node[int(part)]
        else:
            node = node.setdefault(part, {})
    last = parts[-1]
    if last.isdigit() and isinstance(node, list):
        node[int(last)] = value
    else:
        node[last] = value


def _apply_params(strategy_config: dict, params: dict[str, Any]) -> dict:
    cfg = deepcopy(strategy_config)
    for path, value in params.items():
        try:
            _set_nested(cfg, path, value)
        except (KeyError, IndexError, TypeError) as exc:
            logger.warning("param_optimizer: could not set %s=%s — %s", path, value, exc)
    return cfg


def _run_single(
    strategy_config: dict,
    run_config: dict,
    cached_data: dict[str, pd.DataFrame],
    params: dict[str, Any],
    objective_metric: str,
) -> dict[str, Any]:
    """Execute one backtest combination synchronously (runs in thread)."""
    from app.core.backtest import BacktestEngine
    from app.services.reporting import compute_full_metrics

    patched_config = _apply_params(strategy_config, params)
    engine = BacktestEngine(patched_config, run_config)

    try:
        result = engine.run(cached_data)
    except Exception as exc:
        logger.debug("param_optimizer: backtest failed for params %s: %s", params, exc)
        return {
            "params": params,
            "objective": float("-inf"),
            "metrics": {},
            "error": str(exc),
            "run_id": None,
        }

    trades = result.get("trades", [])
    equity_curve = result.get("equity_curve", [])
    initial_capital = float(run_config.get("initial_capital", 100_000))
    timeframe = str(run_config.get("timeframe", "1d"))

    metrics = compute_full_metrics(
        trades=trades,
        equity_curve=equity_curve,
        initial_capital=initial_capital,
        timeframe=timeframe,
    )

    raw_objective = float(metrics.get(objective_metric) or 0.0)
    if not isinstance(raw_objective, float) or (raw_objective != raw_objective):  # NaN guard
        raw_objective = float("-inf")

    # Negate metrics where lower is better so ranking is always "highest = best"
    objective = -raw_objective if objective_metric in _LOWER_IS_BETTER else raw_objective

    return {
        "params": params,
        "objective": objective,
        "metrics": metrics,
        "error": None,
        "run_id": str(uuid.uuid4()),
    }


async def run_param_optimization(
    *,
    strategy_config: dict,
    run_config: dict,
    param_grid: dict[str, list[Any]],
    objective_metric: str = _DEFAULT_OBJECTIVE,
    max_combinations: int = _DEFAULT_MAX_COMBINATIONS,
) -> dict[str, Any]:
    """
    Run grid-search parameter optimization.

    Returns:
        {
            "total_combinations": int,
            "evaluated": int,
            "skipped": int,
            "objective_metric": str,
            "ranked": [
                {
                    "rank": 1,
                    "params": {...},
                    "objective": float,
                    "metrics": {...},
                    "error": None | str,
                }
            ],
            "best_params": {...},
            "best_metrics": {...},
            "started_at": ISO str,
            "completed_at": ISO str,
            "elapsed_seconds": float,
        }
    """
    started_at = datetime.now(timezone.utc)

    # Validate grid
    valid_grid = {k: v for k, v in param_grid.items() if isinstance(v, list) and v}
    if not valid_grid:
        return {
            "total_combinations": 0,
            "evaluated": 0,
            "skipped": 0,
            "objective_metric": objective_metric,
            "ranked": [],
            "best_params": {},
            "best_metrics": {},
            "started_at": started_at.isoformat(),
            "completed_at": started_at.isoformat(),
            "elapsed_seconds": 0.0,
            "error": "param_grid is empty or all values are empty lists",
        }

    paths = list(valid_grid.keys())
    value_lists = [valid_grid[p] for p in paths]
    all_combos = list(itertools.product(*value_lists))
    total = len(all_combos)

    if total > max_combinations:
        logger.info(
            "param_optimizer: %d combinations exceed max %d — truncating",
            total, max_combinations,
        )
        all_combos = all_combos[:max_combinations]

    evaluated_count = len(all_combos)
    skipped = total - evaluated_count

    # Fetch market data once — shared across all combinations
    symbols: list[str] = run_config.get("symbols", [])
    timeframe: str = run_config.get("timeframe", "1d")
    start_date: str = run_config.get("start_date", "2020-01-01")
    end_date: str = run_config.get("end_date", "2023-12-31")
    data_provider: str = str(run_config.get("data_provider", "auto")).lower()
    alpaca_api_key: str = str(run_config.get("alpaca_api_key", "") or "")
    alpaca_secret_key: str = str(run_config.get("alpaca_secret_key", "") or "")
    has_alpaca_credentials = bool(alpaca_api_key and alpaca_secret_key)
    provider_decision = recommend_data_provider(
        timeframe=timeframe,
        start_date=start_date,
        end_date=end_date,
        symbol_count=len(symbols),
        has_alpaca_credentials=has_alpaca_credentials,
    )
    selected_provider = resolve_requested_provider(
        requested_provider=provider_decision["provider"] if data_provider == "auto" else data_provider,
        runtime_mode="research",
        alpaca_credentials_configured=has_alpaca_credentials,
    )

    from app.services.market_data_service import fetch_market_data

    cached_data: dict[str, pd.DataFrame] = {}
    for symbol in symbols:
        try:
            df = await asyncio.get_running_loop().run_in_executor(
                None,
                lambda s=symbol: fetch_market_data(
                    symbol=s,
                    timeframe=timeframe,
                    start=start_date,
                    end=end_date,
                    provider=selected_provider,
                    api_key=alpaca_api_key,
                    secret_key=alpaca_secret_key,
                ),
            )
            if df is not None and not df.empty:
                cached_data[symbol] = df
            else:
                logger.warning("param_optimizer: no data for %s", symbol)
        except Exception as exc:
            logger.warning("param_optimizer: data fetch failed for %s: %s", symbol, exc)

    if not cached_data:
        completed_at = datetime.now(timezone.utc)
        return {
            "total_combinations": total,
            "evaluated": 0,
            "skipped": total,
            "objective_metric": objective_metric,
            "ranked": [],
            "best_params": {},
            "best_metrics": {},
            "started_at": started_at.isoformat(),
            "completed_at": completed_at.isoformat(),
            "elapsed_seconds": (completed_at - started_at).total_seconds(),
            "error": "No market data available for any symbol",
        }

    # Build param dicts for all combos
    param_sets = [dict(zip(paths, combo)) for combo in all_combos]

    loop = asyncio.get_running_loop()

    # Run all combinations concurrently in thread pool
    sem = asyncio.Semaphore(MAX_WORKERS)

    async def _run_with_sem(params: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            return await loop.run_in_executor(
                None,
                lambda p=params: _run_single(
                    strategy_config, run_config, cached_data, p, objective_metric
                ),
            )

    tasks = [_run_with_sem(p) for p in param_sets]
    results: list[dict[str, Any]] = await asyncio.gather(*tasks)

    # Rank by objective (highest first); errors sort to end
    results.sort(key=lambda r: r["objective"], reverse=True)

    ranked = []
    for i, r in enumerate(results, 1):
        ranked.append({
            "rank": i,
            "params": r["params"],
            "objective": r["objective"],
            "metrics": r["metrics"],
            "error": r.get("error"),
        })

    best = ranked[0] if ranked else {}
    completed_at = datetime.now(timezone.utc)

    return {
        "total_combinations": total,
        "evaluated": evaluated_count,
        "skipped": skipped,
        "objective_metric": objective_metric,
        "ranked": ranked,
        "best_params": best.get("params", {}),
        "best_metrics": best.get("metrics", {}),
        "started_at": started_at.isoformat(),
        "completed_at": completed_at.isoformat(),
        "elapsed_seconds": (completed_at - started_at).total_seconds(),
    }
