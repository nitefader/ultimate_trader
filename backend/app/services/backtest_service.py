"""
Backtest service — orchestrates the full backtest workflow.
Handles data fetching, engine execution, and persistence.
"""
from __future__ import annotations

import asyncio
import itertools
import logging
import uuid
from datetime import datetime, timezone
from copy import deepcopy
from typing import Any
import pandas as pd

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.backtest import BacktestEngine
from app.data.providers.yfinance_provider import fetch as fetch_yfinance
from app.data.providers.alpaca_provider import fetch as fetch_alpaca
from app.models.run import BacktestRun, RunMetrics
from app.models.trade import Trade, ScaleEvent
from app.services.reporting import compute_full_metrics

logger = logging.getLogger(__name__)

YF_INTRADAY_MAX_DAYS = {
    "1m": 7,
    "5m": 60,
    "15m": 60,
    "30m": 60,
    "1h": 730,
}


def recommend_data_provider(
    *,
    timeframe: str,
    start_date: str,
    end_date: str,
    symbol_count: int,
    has_alpaca_credentials: bool,
) -> dict[str, Any]:
    tf = str(timeframe).lower()
    start = pd.Timestamp(start_date)
    end = pd.Timestamp(end_date)
    span_days = max(int((end - start).days) + 1, 1)
    is_intraday = tf in {"1m", "5m", "15m", "30m", "1h", "4h"}

    if tf == "4h":
        if has_alpaca_credentials:
            return {
                "provider": "alpaca",
                "confidence": "high",
                "reason": "4h bars require Alpaca in this platform",
                "warnings": [],
            }
        return {
            "provider": "yfinance",
            "confidence": "low",
            "reason": "4h bars are not supported by yfinance and Alpaca credentials are missing",
            "warnings": ["Backtest will fail unless Alpaca credentials are supplied for 4h timeframe"],
        }

    if is_intraday and has_alpaca_credentials:
        return {
            "provider": "alpaca",
            "confidence": "high",
            "reason": "Intraday run with credentials available; Alpaca provides more consistent intraday history",
            "warnings": [],
        }

    if is_intraday:
        yf_limit = YF_INTRADAY_MAX_DAYS.get(tf)
        if yf_limit is not None and span_days > yf_limit:
            return {
                "provider": "alpaca" if has_alpaca_credentials else "yfinance",
                "confidence": "medium" if has_alpaca_credentials else "low",
                "reason": f"Requested {tf} range ({span_days} days) exceeds yfinance limit ({yf_limit} days)",
                "warnings": [] if has_alpaca_credentials else ["Alpaca credentials missing; this run may fail on yfinance limits"],
            }
        return {
            "provider": "yfinance",
            "confidence": "medium",
            "reason": "Intraday range fits yfinance limits",
            "warnings": ["For execution-grade intraday validation, Alpaca is recommended"],
        }

    # EOD / swing / long-history research
    if span_days > (365 * 7) and not has_alpaca_credentials:
        return {
            "provider": "yfinance",
            "confidence": "high",
            "reason": "Long-history daily/weekly runs are well-suited to yfinance",
            "warnings": [],
        }

    if symbol_count > 50 and has_alpaca_credentials:
        return {
            "provider": "alpaca",
            "confidence": "medium",
            "reason": "Large universe backtest with credentials available",
            "warnings": [],
        }

    return {
        "provider": "yfinance",
        "confidence": "high",
        "reason": "Default research mode for EOD workflows",
        "warnings": [],
    }


def _allocate_persisted_trade_id(source_trade_id: str | None, trade_id_map: dict[str, str]) -> str:
    """Return a unique DB trade row id and remember the first row for each source trade id."""
    persisted_id = str(uuid.uuid4())
    if source_trade_id and source_trade_id not in trade_id_map:
        trade_id_map[source_trade_id] = persisted_id
    return persisted_id


def _slice_data(data: dict, start_idx: int, end_idx: int) -> dict:
    sliced = {}
    for symbol, df in data.items():
        part = df.iloc[start_idx:end_idx].copy()
        if len(part) > 0:
            sliced[symbol] = part
    return sliced


def _slice_data_by_dates(data: dict, start_ts: pd.Timestamp, end_ts: pd.Timestamp) -> dict:
    sliced: dict[str, pd.DataFrame] = {}
    for symbol, df in data.items():
        part = df[(df.index >= start_ts) & (df.index <= end_ts)].copy()
        if len(part) > 0:
            sliced[symbol] = part
    return sliced


def _detect_non_causal_indicator_refs(strategy_config: dict) -> list[str]:
    non_causal_markers = (
        "filtfilt",
        "two_sided_filter",
        "future_leak",
        "lookahead",
        "next_bar_feature",
        "lead_",
    )

    hits: set[str] = set()

    def _walk(node: Any) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                k_l = str(k).lower()
                if "future" in k_l or "lookahead" in k_l:
                    hits.add(k_l)
                _walk(v)
        elif isinstance(node, list):
            for item in node:
                _walk(item)
        elif isinstance(node, str):
            s = node.lower()
            for marker in non_causal_markers:
                if marker in s:
                    hits.add(marker)

    _walk(strategy_config)
    return sorted(hits)


def _get_nested_path(target: dict, path: str) -> Any:
    current: Any = target
    parts = path.replace("]", "").split(".")
    for raw_part in parts:
        if "[" in raw_part:
            key, idx_s = raw_part.split("[")
            current = current[key][int(idx_s)]
        else:
            current = current[raw_part]
    return current


def _generate_calendar_folds(
    index: pd.DatetimeIndex,
    train_window_months: int,
    test_window_months: int,
    max_folds: int,
) -> list[dict[str, pd.Timestamp]]:
    if len(index) == 0:
        return []

    idx = pd.DatetimeIndex(sorted(index.unique()))
    first_day = pd.Timestamp(idx[0]).normalize()
    last_day = pd.Timestamp(idx[-1]).normalize()
    folds: list[dict[str, pd.Timestamp]] = []
    cursor = first_day

    while len(folds) < max_folds:
        train_start = cursor
        train_end_exclusive = train_start + pd.DateOffset(months=train_window_months)
        test_start = train_end_exclusive
        test_end_exclusive = test_start + pd.DateOffset(months=test_window_months)
        test_end = test_end_exclusive - pd.Timedelta(days=1)

        if test_start > last_day:
            break

        has_train = ((idx >= train_start) & (idx < train_end_exclusive)).any()
        has_test = ((idx >= test_start) & (idx < test_end_exclusive)).any()
        if has_train and has_test:
            folds.append(
                {
                    "train_start": train_start,
                    "train_end": train_end_exclusive - pd.Timedelta(days=1),
                    "test_start": test_start,
                    "test_end": test_end,
                }
            )

        cursor = cursor + pd.DateOffset(months=test_window_months)
        if cursor > last_day:
            break

    return folds


def _set_nested_path(target: dict, path: str, value: Any) -> None:
    current: Any = target
    parts = path.replace("]", "").split(".")
    for i, raw_part in enumerate(parts):
        if "[" in raw_part:
            key, idx_s = raw_part.split("[")
            idx = int(idx_s)
            current = current[key]
            if i == len(parts) - 1:
                current[idx] = value
                return
            current = current[idx]
            continue
        if i == len(parts) - 1:
            current[raw_part] = value
            return
        current = current[raw_part]


def _with_parameter_overrides(strategy_config: dict, selected_params: dict[str, Any]) -> dict:
    cfg = deepcopy(strategy_config)
    for path, value in selected_params.items():
        _set_nested_path(cfg, path, value)
    return cfg


def _filter_equity_curve_to_range(equity_curve: list[dict], start_ts: pd.Timestamp, end_ts: pd.Timestamp) -> list[dict]:
    out = []
    for pt in equity_curve:
        ts = pd.Timestamp(pt.get("date"))
        if start_ts <= ts <= end_ts:
            out.append(pt)
    return out


def _select_training_parameters(
    train_data: dict,
    strategy_config: dict,
    run_config: dict,
    wf_cfg: dict,
) -> tuple[dict[str, Any], dict[str, Any]]:
    param_candidates: dict[str, list[Any]] = wf_cfg.get("parameter_candidates", {}) or {}
    max_combos = int(wf_cfg.get("max_parameter_combinations", 64))
    metric_name = str(wf_cfg.get("selection_metric", "sharpe_ratio"))

    if not param_candidates:
        return {}, {"policy": "locked_config", "candidate_count": 1, "selection_metric": metric_name}

    candidate_items = [(path, values) for path, values in param_candidates.items() if isinstance(values, list) and values]
    if not candidate_items:
        return {}, {"policy": "locked_config", "candidate_count": 1, "selection_metric": metric_name}

    paths = [p for p, _ in candidate_items]
    grids = [v for _, v in candidate_items]

    best_params: dict[str, Any] = {}
    best_primary = float("-inf")
    best_secondary = float("-inf")
    tested = 0
    failed = 0

    for combo in itertools.product(*grids):
        tested += 1
        if tested > max_combos:
            break

        selected = {path: value for path, value in zip(paths, combo)}
        try:
            candidate_cfg = _with_parameter_overrides(strategy_config, selected)
            train_engine = BacktestEngine(candidate_cfg, run_config)
            train_result = train_engine.run_backtest(train_data)
            m = train_result.metrics or {}
            primary = float(m.get(metric_name) if m.get(metric_name) is not None else float("-inf"))
            secondary = float(m.get("total_return_pct") if m.get("total_return_pct") is not None else float("-inf"))
            if primary > best_primary or (primary == best_primary and secondary > best_secondary):
                best_primary = primary
                best_secondary = secondary
                best_params = selected
        except Exception:
            failed += 1

    details = {
        "policy": "train_only_grid_search",
        "candidate_count": tested,
        "failed_candidates": failed,
        "selection_metric": metric_name,
    }
    return best_params, details


def _compute_walk_forward_payload(
    data: dict,
    strategy_config: dict,
    run_config: dict,
    naive_metrics: dict | None = None,
) -> dict:
    if not data:
        return {}

    primary_symbol = next(iter(data.keys()))
    base_df = data[primary_symbol]
    n = len(base_df)
    if n < 80:
        return {
            "method": "insufficient_bars",
            "folds": [],
            "aggregate_oos": {},
            "warnings": ["Not enough bars for forward-test split"],
        }

    wf_cfg = (run_config.get("walk_forward") or {}) if isinstance(run_config, dict) else {}
    enabled = bool(wf_cfg.get("enabled", True))
    if not enabled:
        return {
            "method": "disabled",
            "folds": [],
            "aggregate_oos": {},
            "warnings": ["Walk-forward mode disabled for this run"],
        }

    train_window_months = int(wf_cfg.get("train_window_months", 12))
    test_window_months = int(wf_cfg.get("test_window_months", 3))
    warmup_bars = int(wf_cfg.get("warmup_bars", 100))
    max_folds = int(wf_cfg.get("max_folds", 24))
    non_causal_refs = _detect_non_causal_indicator_refs(strategy_config)

    folds = _generate_calendar_folds(base_df.index, train_window_months, test_window_months, max_folds)
    if not folds:
        return {
            "method": "sliding_calendar_months",
            "folds": [],
            "aggregate_oos": {},
            "warnings": ["No valid train/test fold windows for selected data range"],
            "anti_bias": {
                "leakage_checks_passed": False,
                "parameter_locking_passed": False,
                "causal_indicator_checks_passed": len(non_causal_refs) == 0,
                "non_causal_indicator_refs": non_causal_refs,
            },
        }

    fold_results = []
    stitched_oos_equity = []
    stitched_equity_level = float(run_config.get("initial_capital", 100_000.0))
    oos_returns: list[float] = []

    for idx, fold in enumerate(folds, start=1):
        train_start = fold["train_start"]
        train_end = fold["train_end"]
        test_start = fold["test_start"]
        test_end = fold["test_end"]

        fold_train_data = _slice_data_by_dates(data, train_start, train_end)
        if not fold_train_data:
            continue

        selected_params, selection_details = _select_training_parameters(
            train_data=fold_train_data,
            strategy_config=strategy_config,
            run_config=run_config,
            wf_cfg=wf_cfg,
        )
        locked_strategy_config = _with_parameter_overrides(strategy_config, selected_params)
        parameter_locking_validated = all(
            _get_nested_path(locked_strategy_config, path) == value
            for path, value in selected_params.items()
        )

        train_engine = BacktestEngine(deepcopy(locked_strategy_config), run_config)
        train_result = train_engine.run_backtest(fold_train_data)

        warmup_start = max(base_df.index[0], test_start - pd.Timedelta(days=warmup_bars * 3))
        fold_test_segment = _slice_data_by_dates(data, warmup_start, test_end)
        if not fold_test_segment:
            continue

        test_run_config = dict(run_config)
        test_run_config["signal_start_date"] = str(test_start.date())
        test_engine = BacktestEngine(deepcopy(locked_strategy_config), test_run_config)
        test_result = test_engine.run_backtest(fold_test_segment)

        test_equity_curve = _filter_equity_curve_to_range(test_result.equity_curve, test_start, test_end)
        test_metrics = compute_full_metrics(
            test_result.trades,
            test_equity_curve,
            float(run_config.get("initial_capital", 100_000.0)),
            timeframe=str(run_config.get("timeframe", "1d")),
        )

        test_ret = test_metrics.get("total_return_pct")
        if test_ret is not None:
            oos_returns.append(float(test_ret) / 100.0)

        if test_equity_curve:
            base_equity = float(test_equity_curve[0]["equity"])
            for point in test_equity_curve:
                rel = (float(point["equity"]) / base_equity) if base_equity > 0 else 1.0
                stitched_val = round(stitched_equity_level * rel, 2)
                stitched_oos_equity.append({"date": point["date"], "equity": stitched_val})
            stitched_equity_level = float(stitched_oos_equity[-1]["equity"])

        turnover_shares = float(sum(abs(float(t.get("quantity", 0.0))) * 2.0 for t in test_result.trades))
        cost_impact = float(sum(float(t.get("commission", 0.0)) for t in test_result.trades))

        fold_results.append(
            {
                "fold_id": f"wf_{idx}",
                "train_start": str(train_start),
                "train_end": str(train_end),
                "test_start": str(test_start),
                "test_end": str(test_end),
                "selected_parameters": selected_params,
                "parameter_locking_validated": parameter_locking_validated,
                "parameter_selection": selection_details,
                "train_metrics": train_result.metrics,
                "test_metrics": test_metrics,
                "train_trades_count": len(train_result.trades),
                "test_trades_count": len(test_result.trades),
                "turnover_shares": round(turnover_shares, 2),
                "cost_impact": round(cost_impact, 2),
                "equity_curve_segment": test_equity_curve,
                "notes": None,
            }
        )

    leakage_checks_passed = bool(fold_results) and all(pd.Timestamp(f["train_end"]) < pd.Timestamp(f["test_start"]) for f in fold_results)
    parameter_locking_passed = bool(fold_results) and all(bool(f.get("parameter_locking_validated", False)) for f in fold_results)
    causal_checks_passed = len(non_causal_refs) == 0

    oos_total_return_pct = None
    if stitched_oos_equity:
        start_eq = float(run_config.get("initial_capital", 100_000.0))
        end_eq = float(stitched_oos_equity[-1]["equity"])
        oos_total_return_pct = ((end_eq / start_eq) - 1.0) * 100.0

    aggregate = {
        "fold_count": len(fold_results),
        "oos_total_return_pct": round(oos_total_return_pct, 2) if oos_total_return_pct is not None else None,
        "avg_oos_return_pct": round(sum(oos_returns) / len(oos_returns) * 100, 2) if oos_returns else None,
        "positive_oos_fold_rate_pct": round(sum(1 for r in oos_returns if r > 0) / len(oos_returns) * 100, 1) if oos_returns else None,
    }

    warnings: list[str] = []
    if not causal_checks_passed:
        warnings.append(f"Non-causal indicator references detected: {', '.join(non_causal_refs)}")
    if not leakage_checks_passed:
        warnings.append("Fold boundary leakage check failed")
    if len(fold_results) == 0:
        warnings.append("No valid walk-forward folds were executed")

    naive = {
        "total_return_pct": naive_metrics.get("total_return_pct") if naive_metrics else None,
        "sharpe_ratio": naive_metrics.get("sharpe_ratio") if naive_metrics else None,
        "max_drawdown_pct": naive_metrics.get("max_drawdown_pct") if naive_metrics else None,
        "total_trades": naive_metrics.get("total_trades") if naive_metrics else None,
    }

    return {
        "method": "sliding_calendar_months",
        "settings": {
            "train_window_months": train_window_months,
            "test_window_months": test_window_months,
            "warmup_bars": warmup_bars,
            "max_folds": max_folds,
        },
        "folds": fold_results,
        "aggregate_oos": aggregate,
        "stitched_oos_equity": stitched_oos_equity,
        "naive_full_period": naive,
        "anti_bias": {
            "leakage_checks_passed": leakage_checks_passed,
            "parameter_locking_passed": parameter_locking_passed,
            "causal_indicator_checks_passed": causal_checks_passed,
            "non_causal_indicator_refs": non_causal_refs,
        },
        "warnings": warnings,
    }


async def launch_backtest(
    db: AsyncSession,
    strategy_version_id: str,
    strategy_config: dict,
    run_config: dict,
) -> BacktestRun:
    """Create a run record and execute the backtest."""
    run = BacktestRun(
        id=str(uuid.uuid4()),
        strategy_version_id=strategy_version_id,
        mode="backtest",
        status="running",
        symbols=run_config.get("symbols", []),
        timeframe=run_config.get("timeframe", "1d"),
        start_date=run_config.get("start_date", "2020-01-01"),
        end_date=run_config.get("end_date", "2023-12-31"),
        initial_capital=run_config.get("initial_capital", 100_000),
        commission_per_share=run_config.get("commission_per_share", 0.005),
        slippage_ticks=run_config.get("slippage_ticks", 1),
        parameters={
            **(run_config.get("parameters", {}) or {}),
            "commission_pct_per_trade": run_config.get("commission_pct_per_trade", 0.0),
            "walk_forward": run_config.get("walk_forward", {}),
        },
        started_at=datetime.now(timezone.utc),
    )
    db.add(run)
    await db.flush()

    try:
        # Load data
        data = {}
        missing_symbols: list[str] = []

        data_provider = str(run_config.get("data_provider", "auto")).lower()
        alpaca_api_key = str(run_config.get("alpaca_api_key", "") or "")
        alpaca_secret_key = str(run_config.get("alpaca_secret_key", "") or "")
        has_alpaca_credentials = bool(alpaca_api_key and alpaca_secret_key)

        provider_decision = recommend_data_provider(
            timeframe=run.timeframe,
            start_date=run.start_date,
            end_date=run.end_date,
            symbol_count=len(run.symbols),
            has_alpaca_credentials=has_alpaca_credentials,
        )

        selected_provider = provider_decision["provider"] if data_provider == "auto" else data_provider
        if selected_provider == "alpaca" and not has_alpaca_credentials:
            raise ValueError("Alpaca selected but credentials are missing")

        if selected_provider not in {"yfinance", "alpaca"}:
            raise ValueError(f"Unsupported data provider: {selected_provider}")

        for symbol in run.symbols:
            if selected_provider == "alpaca":
                df = await asyncio.get_running_loop().run_in_executor(
                    None,
                    fetch_alpaca,
                    symbol,
                    run.timeframe,
                    run.start_date,
                    run.end_date,
                    alpaca_api_key,
                    alpaca_secret_key,
                    False,
                )
            else:
                df = await asyncio.get_running_loop().run_in_executor(
                    None,
                    fetch_yfinance,
                    symbol,
                    run.timeframe,
                    run.start_date,
                    run.end_date,
                )
            if df is not None and len(df) > 0:
                data[symbol] = df
            else:
                logger.warning(f"No data for {symbol}")
                missing_symbols.append(symbol)

        run.parameters = {
            **(run.parameters or {}),
            "data_provider_requested": data_provider,
            "data_provider_used": selected_provider,
            "data_provider_recommendation": provider_decision,
        }

        allow_partial_symbols = bool(run_config.get("allow_partial_symbols", False))
        if missing_symbols and not allow_partial_symbols:
            missing = ", ".join(sorted(missing_symbols))
            raise ValueError(f"Missing data for requested symbols: {missing}")

        if not data:
            raise ValueError("No data loaded for any symbol")

        # Run backtest
        engine = BacktestEngine(strategy_config, run_config)
        result = await asyncio.get_running_loop().run_in_executor(None, engine.run_backtest, data)

        # Compute forward-test summary payload (walk-forward / train-test splits)
        walk_forward_payload = await asyncio.get_running_loop().run_in_executor(
            None,
            _compute_walk_forward_payload,
            data,
            strategy_config,
            run_config,
            result.metrics,
        )

        # Persist trades
        source_to_persisted_trade_id: dict[str, str] = {}
        for trade_dict in result.trades:
            entry_price = trade_dict["entry_price"]
            exit_price = trade_dict.get("exit_price")
            net_pnl = trade_dict.get("net_pnl")
            quantity = trade_dict.get("quantity", 0)
            source_trade_id = trade_dict.get("trade_id")
            persisted_trade_id = _allocate_persisted_trade_id(source_trade_id, source_to_persisted_trade_id)

            # Compute return_pct: net P&L as % of cost basis
            cost_basis = entry_price * quantity if quantity else 0
            return_pct = (net_pnl / cost_basis * 100) if (net_pnl is not None and cost_basis > 0) else None

            # Compute r_multiple: net P&L expressed in initial risk units
            # Initial risk = |entry - stop| * qty (stored in trade_dict if available)
            initial_risk = trade_dict.get("initial_risk")  # set by engine when stop is known
            if initial_risk is None and trade_dict.get("stop_price") and quantity:
                initial_risk = abs(entry_price - trade_dict["stop_price"]) * quantity
            r_multiple = (net_pnl / initial_risk) if (net_pnl is not None and initial_risk and initial_risk > 0) else None

            trade = Trade(
                id=persisted_trade_id,
                run_id=run.id,
                strategy_version_id=strategy_version_id,
                symbol=trade_dict["symbol"],
                direction=trade_dict["direction"],
                entry_time=trade_dict.get("entry_time") or datetime.now(timezone.utc),
                entry_price=entry_price,
                initial_quantity=quantity,
                exit_time=trade_dict.get("exit_time"),
                exit_price=exit_price,
                exit_quantity=quantity,
                exit_reason=trade_dict.get("exit_reason"),
                realized_pnl=trade_dict.get("gross_pnl"),
                commission=trade_dict.get("commission", 0),
                net_pnl=net_pnl,
                return_pct=return_pct,
                r_multiple=r_multiple,
                is_open=False,
                max_adverse_excursion=trade_dict.get("max_adverse"),
                max_favorable_excursion=trade_dict.get("max_favorable"),
                regime_at_entry=trade_dict.get("regime_at_entry"),
                metadata_={"source_trade_id": source_trade_id} if source_trade_id else {},
            )
            db.add(trade)

        # Persist scale events
        for se in result.scale_events:
            source_trade_id = se.get("trade_id")
            mapped_trade_id = source_to_persisted_trade_id.get(source_trade_id) if source_trade_id else None
            if mapped_trade_id is None:
                logger.warning("Skipping scale event with unknown source trade_id=%s", source_trade_id)
                continue

            scale_ev = ScaleEvent(
                trade_id=mapped_trade_id,
                event_type=se.get("type", "scale_out"),
                time=datetime.fromisoformat(se["time"]) if isinstance(se["time"], str) else se["time"],
                price=se["price"],
                quantity=se["quantity"],
                quantity_pct=0.0,
                reason=se.get("reason"),
            )
            db.add(scale_ev)

        # Persist metrics
        m = result.metrics
        metrics = RunMetrics(
            run_id=run.id,
            total_return_pct=m.get("total_return_pct"),
            cagr_pct=m.get("cagr_pct"),
            sharpe_ratio=m.get("sharpe_ratio"),
            sortino_ratio=m.get("sortino_ratio"),
            calmar_ratio=m.get("calmar_ratio"),
            max_drawdown_pct=m.get("max_drawdown_pct"),
            max_drawdown_duration_days=m.get("max_drawdown_duration_days"),
            recovery_factor=m.get("recovery_factor"),
            total_trades=m.get("total_trades"),
            winning_trades=m.get("winning_trades"),
            losing_trades=m.get("losing_trades"),
            win_rate_pct=m.get("win_rate_pct"),
            avg_win_pct=m.get("avg_win_pct"),
            avg_loss_pct=m.get("avg_loss_pct"),
            expectancy=m.get("expectancy"),
            profit_factor=m.get("profit_factor"),
            avg_hold_days=m.get("avg_hold_days"),
            long_trades=m.get("long_trades"),
            short_trades=m.get("short_trades"),
            monthly_returns=m.get("monthly_returns", {}),
            equity_curve=result.equity_curve,
            exit_reason_breakdown=m.get("exit_reason_breakdown", {}),
            regime_breakdown=m.get("regime_breakdown", {}),
            monte_carlo=m.get("monte_carlo", {}),
            walk_forward=walk_forward_payload,
        )
        db.add(metrics)

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)

    except Exception as e:
        logger.exception(f"Backtest failed: {e}")
        run.status = "failed"
        run.error_message = str(e)

    await db.flush()
    await db.commit()
    return run
