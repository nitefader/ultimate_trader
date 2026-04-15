"""Backtest launch and results endpoints."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from app.database import get_db, AsyncSessionLocal
from app.data.providers.yfinance_provider import TIMEFRAME_MAP
from app.data.providers.alpaca_provider import TIMEFRAME_MAP as ALPACA_TIMEFRAME_MAP
from app.models.run import BacktestRun, RunMetrics
from app.models.validation_evidence import ValidationEvidence
from app.models.strategy import Strategy, StrategyVersion
from app.models.trade import Trade
from app.services.backtest_service import launch_backtest, recommend_data_provider

router = APIRouter(prefix="/backtests", tags=["backtests"])

SUPPORTED_BACKTEST_TIMEFRAMES = tuple(sorted(set(TIMEFRAME_MAP.keys()) | set(ALPACA_TIMEFRAME_MAP.keys())))


class BacktestLaunchRequest(BaseModel):
    strategy_version_id: str
    symbols: list[str] | None = None
    timeframe: str | None = None
    start_date: str = "2018-01-01"
    end_date: str = datetime.utcnow().strftime("%Y-%m-%d")
    initial_capital: float = Field(default=100_000, gt=0)
    commission_per_share: float = Field(default=0.005, ge=0)
    commission_pct_per_trade: float = Field(default=0.1, ge=0)
    slippage_ticks: int = Field(default=1, ge=0)
    data_provider: str = Field(default="auto")  # auto | yfinance | alpaca
    alpaca_api_key: str | None = None
    alpaca_secret_key: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    walk_forward: dict[str, Any] = Field(default_factory=lambda: {
        "enabled": True,
        "train_window_months": 12,
        "test_window_months": 3,
        "warmup_bars": 100,
        "max_folds": 24,
    })
    cpcv: dict[str, Any] = Field(default_factory=lambda: {
        "enabled": True,
        "n_paths": 6,
        "k_test_paths": 2,
        "embargo_bars": 5,
        "max_combos": 30,
        "min_bars_path": 30,
    })

    @field_validator("timeframe")
    @classmethod
    def _validate_timeframe(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if value not in SUPPORTED_BACKTEST_TIMEFRAMES:
            supported = ", ".join(SUPPORTED_BACKTEST_TIMEFRAMES)
            raise ValueError(f"Unsupported timeframe '{value}'. Supported: {supported}")
        return value

    @model_validator(mode="after")
    def _validate_dates(self) -> "BacktestLaunchRequest":
        start = datetime.strptime(self.start_date, "%Y-%m-%d").date()
        end = datetime.strptime(self.end_date, "%Y-%m-%d").date()
        if end < start:
            raise ValueError("end_date must be on or after start_date")

        wf = self.walk_forward or {}
        if wf.get("enabled", True):
            train_months = int(wf.get("train_window_months", 12))
            test_months = int(wf.get("test_window_months", 3))
            if train_months <= 0 or test_months <= 0:
                raise ValueError("walk_forward train/test windows must be positive")

        cpcv = self.cpcv or {}
        if cpcv.get("enabled", True):
            n_paths = int(cpcv.get("n_paths", 6))
            k_test_paths = int(cpcv.get("k_test_paths", 2))
            embargo_bars = int(cpcv.get("embargo_bars", 5))
            min_bars_path = int(cpcv.get("min_bars_path", 30))
            max_combos = int(cpcv.get("max_combos", 30))
            if n_paths <= 1:
                raise ValueError("cpcv n_paths must be greater than 1")
            if k_test_paths <= 0 or k_test_paths >= n_paths:
                raise ValueError("cpcv k_test_paths must be positive and less than n_paths")
            if embargo_bars < 0 or min_bars_path <= 0 or max_combos <= 0:
                raise ValueError("cpcv embargo_bars must be >= 0 and min_bars_path/max_combos must be positive")
        return self


class ProviderRecommendationRequest(BaseModel):
    symbols: list[str] = Field(default_factory=lambda: ["SPY"])
    timeframe: str = "1d"
    start_date: str = "2018-01-01"
    end_date: str = datetime.utcnow().strftime("%Y-%m-%d")
    has_alpaca_credentials: bool = False


class ParamOptimizeRequest(BaseModel):
    strategy_version_id: str
    symbols: list[str] = Field(default_factory=lambda: ["SPY"])
    timeframe: str = "1d"
    start_date: str = "2020-01-01"
    end_date: str = datetime.utcnow().strftime("%Y-%m-%d")
    initial_capital: float = Field(default=100_000, gt=0)
    data_provider: str = "yfinance"
    alpaca_api_key: str | None = None
    alpaca_secret_key: str | None = None
    param_grid: dict[str, list[Any]] = Field(
        ...,
        description=(
            "Map of dot-path → list of candidate values. "
            'Example: {"stop_loss.multiplier": [1.5, 2.0, 2.5]}'
        ),
    )
    objective_metric: str = "sharpe_ratio"
    max_combinations: int = Field(default=64, ge=1, le=512)
    commission_per_share: float = Field(default=0.005, ge=0)
    slippage_ticks: int = Field(default=1, ge=0)


class CompareRunsRequest(BaseModel):
    other_run_id: str


class BacktestRunUpdateRequest(BaseModel):
    symbols: list[str] | None = None
    timeframe: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    initial_capital: float | None = Field(default=None, gt=0)
    parameters: dict[str, Any] | None = None

    @field_validator("timeframe")
    @classmethod
    def _validate_timeframe(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if value not in SUPPORTED_BACKTEST_TIMEFRAMES:
            supported = ", ".join(SUPPORTED_BACKTEST_TIMEFRAMES)
            raise ValueError(f"Unsupported timeframe '{value}'. Supported: {supported}")
        return value

    @model_validator(mode="after")
    def _validate_dates(self) -> "BacktestRunUpdateRequest":
        start = self.start_date
        end = self.end_date
        if start is None and end is None:
            return self
        if start is not None and end is None:
            end = start
        if start is None and end is not None:
            start = end
        assert start is not None and end is not None
        start_date = datetime.strptime(start, "%Y-%m-%d").date()
        end_date = datetime.strptime(end, "%Y-%m-%d").date()
        if end_date < start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


@router.post("/provider-recommendation")
async def provider_recommendation(body: ProviderRecommendationRequest):
    if body.timeframe not in SUPPORTED_BACKTEST_TIMEFRAMES:
        supported = ", ".join(SUPPORTED_BACKTEST_TIMEFRAMES)
        raise HTTPException(status_code=422, detail=f"Unsupported timeframe '{body.timeframe}'. Supported: {supported}")

    decision = recommend_data_provider(
        timeframe=body.timeframe,
        start_date=body.start_date,
        end_date=body.end_date,
        symbol_count=max(len(body.symbols), 1),
        has_alpaca_credentials=body.has_alpaca_credentials,
    )
    return decision


def _normalize_symbols(symbols: list[str] | None) -> list[str]:
    if not symbols:
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in symbols:
        sym = str(raw).strip().upper()
        if not sym:
            continue
        if sym not in seen:
            normalized.append(sym)
            seen.add(sym)
    return normalized


async def _run_backtest_background(run_id: str, strategy_version_id: str, strategy_config: dict, run_config: dict) -> None:
    """Execute a backtest in the background using its own DB session."""
    async with AsyncSessionLocal() as db:
        try:
            await launch_backtest(db, strategy_version_id, strategy_config, run_config, run_id=run_id)
        except Exception as e:
            logger.exception(f"Background backtest {run_id} failed: {e}")
            # Mark the run as failed so the UI shows the error
            from app.models.run import BacktestRun
            run = await db.get(BacktestRun, run_id)
            if run:
                run.status = "failed"
                run.error_message = str(e)
                await db.commit()


@router.post("/launch")
async def launch(body: BacktestLaunchRequest, db: AsyncSession = Depends(get_db)):
    """
    Launch a backtest. Returns immediately with the run_id; execution happens in the background.
    Poll GET /backtests/{run_id} to track progress.
    """
    strategy_version_id = body.strategy_version_id

    try:
        sv = await db.get(StrategyVersion, strategy_version_id)
    except Exception as e:
        logger.exception(f"Database error fetching strategy_version {strategy_version_id}: {e}")
        raise HTTPException(status_code=500, detail="Database error. Check server logs for details.")

    if not sv:
        raise HTTPException(status_code=404, detail=f"StrategyVersion {strategy_version_id} not found")

    strategy_config = dict(sv.config)
    symbols = _normalize_symbols(body.symbols if body.symbols is not None else strategy_config.get("symbols", ["SPY"]))
    if not symbols:
        raise HTTPException(status_code=422, detail="At least one valid symbol is required")

    timeframe = body.timeframe or strategy_config.get("timeframe", "1d")
    if timeframe not in SUPPORTED_BACKTEST_TIMEFRAMES:
        supported = ", ".join(SUPPORTED_BACKTEST_TIMEFRAMES)
        raise HTTPException(status_code=422, detail=f"Unsupported timeframe '{timeframe}'. Supported: {supported}")

    provider = (body.data_provider or "auto").lower()
    if provider not in {"auto", "yfinance", "alpaca"}:
        raise HTTPException(status_code=422, detail="data_provider must be one of: auto, yfinance, alpaca")

    if provider == "yfinance" and timeframe not in TIMEFRAME_MAP:
        raise HTTPException(status_code=422, detail=f"Timeframe '{timeframe}' is not supported by yfinance")
    if provider == "alpaca" and timeframe not in ALPACA_TIMEFRAME_MAP:
        raise HTTPException(status_code=422, detail=f"Timeframe '{timeframe}' is not supported by alpaca")

    run_config = {
        "symbols": symbols,
        "timeframe": timeframe,
        "start_date": body.start_date,
        "end_date": body.end_date,
        "initial_capital": body.initial_capital,
        "commission_per_share": body.commission_per_share,
        "commission_pct_per_trade": body.commission_pct_per_trade,
        "slippage_ticks": body.slippage_ticks,
        "data_provider": provider,
        "alpaca_api_key": body.alpaca_api_key or "",
        "alpaca_secret_key": body.alpaca_secret_key or "",
        "parameters": body.parameters,
        "walk_forward": body.walk_forward,
        "cpcv": body.cpcv,
    }

    # Create the run record now so we have an ID to return immediately
    import uuid as _uuid
    from datetime import timezone
    from app.models.run import BacktestRun as _BacktestRun
    run_id = str(_uuid.uuid4())
    run = _BacktestRun(
        id=run_id,
        strategy_version_id=strategy_version_id,
        mode="backtest",
        status="pending",
        symbols=symbols,
        timeframe=timeframe,
        start_date=body.start_date,
        end_date=body.end_date,
        initial_capital=body.initial_capital,
        commission_per_share=body.commission_per_share,
        slippage_ticks=body.slippage_ticks,
        parameters={
            **(body.parameters or {}),
            "commission_pct_per_trade": body.commission_pct_per_trade,
            "walk_forward": body.walk_forward if isinstance(body.walk_forward, dict) else (body.walk_forward.model_dump() if body.walk_forward else {}),
            "cpcv": body.cpcv if isinstance(body.cpcv, dict) else (body.cpcv.model_dump() if body.cpcv else {}),
        },
        started_at=datetime.now(timezone.utc),
    )
    db.add(run)
    await db.commit()

    # Kick off in background — asyncio.create_task keeps the async/greenlet context
    # that SQLAlchemy's async engine requires. BackgroundTasks runs outside that context.
    asyncio.create_task(
        _run_backtest_background(run_id, strategy_version_id, strategy_config, run_config)
    )

    return {
        "run_id": run_id,
        "status": "pending",
    }


@router.get("")
async def list_runs(
    strategy_id: str | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    # Eagerly load metrics so they are available in the list response.
    # RunHistory and Dashboard use metrics (return, sharpe, drawdown, trades) from the list.
    q = (
        select(BacktestRun)
        .options(
            selectinload(BacktestRun.metrics),
            selectinload(BacktestRun.validation_evidence),
            selectinload(BacktestRun.strategy_version).selectinload(StrategyVersion.strategy),
        )
        .order_by(BacktestRun.created_at.desc())
        .limit(limit)
    )
    if strategy_id:
        q = q.join(StrategyVersion).where(StrategyVersion.strategy_id == strategy_id)
    result = await db.execute(q)
    runs = result.scalars().all()
    return [_fmt_run(r) for r in runs]


def _fmt_run(r: BacktestRun) -> dict:
    """Serialise a BacktestRun including a compact metrics summary."""
    sv = getattr(r, 'strategy_version', None)
    strategy = getattr(sv, 'strategy', None) if sv else None
    base = {
        "id": r.id,
        "strategy_version_id": r.strategy_version_id,
        "strategy_id": strategy.id if strategy else None,
        "strategy_name": strategy.name if strategy else None,
        "strategy_version_number": sv.version if sv else None,
        "mode": r.mode,
        "status": r.status,
        "symbols": r.symbols,
        "timeframe": r.timeframe,
        "start_date": r.start_date,
        "end_date": r.end_date,
        "initial_capital": r.initial_capital,
        "created_at": r.created_at.isoformat(),
        "completed_at": r.completed_at.isoformat() if r.completed_at else None,
        "error_message": r.error_message,
        "metrics": None,
        "validation_evidence": None,
    }
    if r.metrics:
        m = r.metrics
        base["metrics"] = {
            "total_return_pct": m.total_return_pct,
            "cagr_pct": m.cagr_pct,
            "sharpe_ratio": m.sharpe_ratio,
            "sortino_ratio": m.sortino_ratio,
            "calmar_ratio": m.calmar_ratio,
            "sqn": m.sqn,
            "max_drawdown_pct": m.max_drawdown_pct,
            "max_drawdown_duration_days": m.max_drawdown_duration_days,
            "recovery_factor": m.recovery_factor,
            "total_trades": m.total_trades,
            "winning_trades": m.winning_trades,
            "losing_trades": m.losing_trades,
            "win_rate_pct": m.win_rate_pct,
            "avg_win_pct": m.avg_win_pct,
            "avg_loss_pct": m.avg_loss_pct,
            "expectancy": m.expectancy,
            "profit_factor": m.profit_factor,
            "avg_hold_days": m.avg_hold_days,
            "long_trades": m.long_trades,
            "short_trades": m.short_trades,
            "exit_reason_breakdown": m.exit_reason_breakdown,
            "regime_breakdown": m.regime_breakdown,
            "monthly_returns": m.monthly_returns,
            "monte_carlo": m.monte_carlo,
            "walk_forward": m.walk_forward,
            "no_trades": m.total_trades == 0,
        }
    if r.validation_evidence:
        ve = r.validation_evidence
        base["validation_evidence"] = {
            "method": ve.method,
            "cpcv": ve.cpcv,
            "walk_forward": ve.walk_forward,
            "anti_bias": ve.anti_bias,
            "regime_performance": ve.regime_performance,
            "per_symbol_oos_sharpe": ve.per_symbol_oos_sharpe,
            "cost_sensitivity_curve": ve.cost_sensitivity_curve,
            "warnings": ve.warnings,
            "is_oos_degradation_ratio": ve.is_oos_degradation_ratio,
            "stability_score": ve.stability_score,
            "created_at": ve.created_at.isoformat() if ve.created_at else None,
        }
    return base


@router.get("/{run_id}")
async def get_run(run_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BacktestRun)
        .options(
            selectinload(BacktestRun.metrics),
            selectinload(BacktestRun.validation_evidence),
            selectinload(BacktestRun.strategy_version).selectinload(StrategyVersion.strategy),
        )
        .where(BacktestRun.id == run_id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return _fmt_run(run)


@router.get("/{run_id}/equity-curve")
async def get_equity_curve(run_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RunMetrics).where(RunMetrics.run_id == run_id)
    )
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Metrics not found")
    return {"equity_curve": m.equity_curve}


@router.put("/{run_id}")
async def update_run(run_id: str, body: BacktestRunUpdateRequest, db: AsyncSession = Depends(get_db)):
    run = await db.get(BacktestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    if run.status != "pending":
        raise HTTPException(status_code=409, detail="Only pending runs can be updated")

    payload = body.model_dump(exclude_unset=True)
    if not payload:
        return _fmt_run(run)

    if "symbols" in payload:
        symbols = _normalize_symbols(payload.get("symbols"))
        if not symbols:
            raise HTTPException(status_code=422, detail="At least one valid symbol is required")
        run.symbols = symbols

    if "timeframe" in payload and payload["timeframe"] is not None:
        run.timeframe = payload["timeframe"]
    if "start_date" in payload and payload["start_date"] is not None:
        run.start_date = payload["start_date"]
    if "end_date" in payload and payload["end_date"] is not None:
        run.end_date = payload["end_date"]
    if "initial_capital" in payload and payload["initial_capital"] is not None:
        run.initial_capital = payload["initial_capital"]
    if "parameters" in payload and payload["parameters"] is not None:
        run.parameters = payload["parameters"]

    await db.commit()
    result = await db.execute(
        select(BacktestRun)
        .options(selectinload(BacktestRun.metrics), selectinload(BacktestRun.validation_evidence))
        .where(BacktestRun.id == run_id)
    )
    updated = result.scalar_one()
    return _fmt_run(updated)


@router.delete("/{run_id}")
async def delete_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(BacktestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "running":
        raise HTTPException(status_code=409, detail="Cannot delete a running run")
    await db.delete(run)
    await db.commit()
    return {"status": "deleted"}


@router.get("/{run_id}/trades")
async def get_trades(run_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Trade).where(Trade.run_id == run_id).order_by(Trade.entry_time)
    )
    trades = result.scalars().all()
    return [
        {
            "id": t.id,
            "symbol": t.symbol,
            "direction": t.direction,
            "entry_time": t.entry_time.isoformat() if t.entry_time else None,
            "entry_price": t.entry_price,
            "exit_time": t.exit_time.isoformat() if t.exit_time else None,
            "exit_price": t.exit_price,
            "quantity": t.initial_quantity,
            "exit_reason": t.exit_reason,
            "net_pnl": t.net_pnl,
            "return_pct": t.return_pct,
            "r_multiple": t.r_multiple,
            "regime_at_entry": t.regime_at_entry,
        }
        for t in trades
    ]


@router.post("/{run_id}/compare")
async def compare_runs(run_id: str, body: CompareRunsRequest, db: AsyncSession = Depends(get_db)):
    """Compare this run with another run."""
    other_run_id = body.other_run_id
    if run_id == other_run_id:
        raise HTTPException(status_code=400, detail="other_run_id must be different from run_id")

    runs = []
    for rid in [run_id, other_run_id]:
        r = await db.execute(
            select(BacktestRun).options(selectinload(BacktestRun.metrics)).where(BacktestRun.id == rid)
            .options(selectinload(BacktestRun.validation_evidence))
        )
        run = r.scalar_one_or_none()
        if not run:
            raise HTTPException(status_code=404, detail=f"Run {rid} not found")
        runs.append(run)

    def _anti_bias_passed(run: BacktestRun) -> bool | None:
        anti = run.validation_evidence.anti_bias if run.validation_evidence else None
        if not isinstance(anti, dict):
            wf = run.metrics.walk_forward if run.metrics else None
            anti = wf.get("anti_bias") if isinstance(wf, dict) else None
        if not isinstance(anti, dict):
            return None
        required_checks = [
            anti.get("leakage_checks_passed"),
            anti.get("parameter_locking_passed"),
            anti.get("causal_indicator_checks_passed"),
        ]
        if "cpcv_primary_guard_passed" in anti:
            required_checks.append(anti.get("cpcv_primary_guard_passed"))
        return bool(all(required_checks))

    def fmt(run: BacktestRun) -> dict:
        m = run.metrics
        wf = run.validation_evidence.walk_forward if run.validation_evidence else (m.walk_forward if m else None)
        agg_oos = wf.get("aggregate_oos") if isinstance(wf, dict) else None
        cpcv = run.validation_evidence.cpcv if run.validation_evidence else (wf.get("cpcv") if isinstance(wf, dict) else None)
        cpcv_agg = cpcv.get("aggregate") if isinstance(cpcv, dict) else None
        return {
            "run_id": run.id,
            "status": run.status,
            "symbols": run.symbols,
            "timeframe": run.timeframe,
            "start_date": run.start_date,
            "end_date": run.end_date,
            "total_return_pct": m.total_return_pct if m else None,
            "cagr_pct": m.cagr_pct if m else None,
            "sharpe_ratio": m.sharpe_ratio if m else None,
            "max_drawdown_pct": m.max_drawdown_pct if m else None,
            "win_rate_pct": m.win_rate_pct if m else None,
            "profit_factor": m.profit_factor if m else None,
            "total_trades": m.total_trades if m else None,
            "oos_total_return_pct": agg_oos.get("oos_total_return_pct") if isinstance(agg_oos, dict) else None,
            "avg_oos_return_pct": agg_oos.get("avg_oos_return_pct") if isinstance(agg_oos, dict) else None,
            "cpcv_median_oos_sharpe": cpcv_agg.get("median_oos_sharpe") if isinstance(cpcv_agg, dict) else None,
            "cpcv_passed": cpcv_agg.get("pass_primary_guard") if isinstance(cpcv_agg, dict) else None,
            "anti_bias_passed": _anti_bias_passed(run),
        }

    left = fmt(runs[0])
    right = fmt(runs[1])

    def _delta(key: str) -> float | None:
        lv = left.get(key)
        rv = right.get(key)
        if lv is None or rv is None:
            return None
        try:
            return float(lv) - float(rv)
        except (TypeError, ValueError):
            return None

    deltas = {
        "total_return_pct": _delta("total_return_pct"),
        "sharpe_ratio": _delta("sharpe_ratio"),
        "max_drawdown_pct": _delta("max_drawdown_pct"),
        "win_rate_pct": _delta("win_rate_pct"),
        "total_trades": _delta("total_trades"),
        "oos_total_return_pct": _delta("oos_total_return_pct"),
        "cpcv_median_oos_sharpe": _delta("cpcv_median_oos_sharpe"),
    }

    return {"left_run": left, "right_run": right, "deltas": deltas}


# ── Parameter optimization ────────────────────────────────────────────────────

@router.post("/optimize")
async def optimize_params(body: ParamOptimizeRequest, db: AsyncSession = Depends(get_db)):
    """
    Grid-search parameter optimization for a strategy version.

    Runs the backtest engine over all combinations in param_grid (capped at
    max_combinations) and returns ranked results by objective_metric.

    This is strategy-parameter optimization (EMA periods, multipliers, etc.).
    For portfolio-weight optimization see /api/v1/optimizations.
    """
    from app.services.param_optimizer import run_param_optimization

    sv = await db.get(StrategyVersion, body.strategy_version_id)
    if not sv:
        raise HTTPException(status_code=404, detail="StrategyVersion not found")

    if not body.param_grid:
        raise HTTPException(status_code=422, detail="param_grid must not be empty")

    run_config = {
        "symbols": body.symbols,
        "timeframe": body.timeframe,
        "start_date": body.start_date,
        "end_date": body.end_date,
        "initial_capital": body.initial_capital,
        "data_provider": body.data_provider,
        "alpaca_api_key": body.alpaca_api_key or "",
        "alpaca_secret_key": body.alpaca_secret_key or "",
        "commission_per_share": body.commission_per_share,
        "slippage_ticks": body.slippage_ticks,
    }

    try:
        result = await run_param_optimization(
            strategy_config=sv.config,
            run_config=run_config,
            param_grid=body.param_grid,
            objective_metric=body.objective_metric,
            max_combinations=body.max_combinations,
        )
    except Exception as exc:
        logger.exception("param optimization failed for sv %s: %s", body.strategy_version_id, exc)
        raise HTTPException(status_code=500, detail="Parameter optimization failed. Check server logs.")

    return result
