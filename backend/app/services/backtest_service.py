"""
Backtest service — orchestrates the full backtest workflow.
Handles data fetching, engine execution, and persistence.
"""
from __future__ import annotations

import asyncio
import itertools
import math
import logging
import uuid
from datetime import datetime, date, timezone
from copy import deepcopy
from itertools import combinations
from typing import Any
import pandas as pd

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.backtest import BacktestEngine
from app.features.preview import build_feature_plan_preview
from app.features.source_contracts import resolve_requested_provider
from app.models.run import BacktestRun, RunMetrics
from app.models.validation_evidence import ValidationEvidence
from app.models.trade import Trade, ScaleEvent
from app.services.market_data_service import fetch_market_data
from app.services.reporting import compute_full_metrics
from app.models.trading_program import TradingProgram
from app.models.strategy import StrategyVersion

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


async def resolve_program_to_config(program_id: str, db: AsyncSession) -> tuple[str, dict, list[str]]:
    """
    Load a TradingProgram and its components, return (strategy_version_id, flat_config, symbols).

    Overlay order: strategy version config → governor → execution style → risk profile → watchlists.
    Falls back to the strategy version's embedded values for any missing component.
    Raises ValueError if the program or its strategy version is not found.
    """
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        __import__("sqlalchemy", fromlist=["select"]).select(TradingProgram)
        .options(
            selectinload(TradingProgram.strategy_controls),
            selectinload(TradingProgram.execution_style),
            selectinload(TradingProgram.risk_profile),
        )
        .where(TradingProgram.id == program_id)
    )
    program = result.scalar_one_or_none()
    if not program:
        raise ValueError(f"TradingProgram {program_id} not found")

    if not program.strategy_version_id:
        raise ValueError(f"Program {program_id} has no strategy version attached")

    sv = await db.get(StrategyVersion, program.strategy_version_id)
    if not sv:
        raise ValueError(f"StrategyVersion {program.strategy_version_id} not found")

    config = deepcopy(dict(sv.config))

    # Overlay Strategy Controls
    gov = program.strategy_controls
    if gov:
        config["timeframe"] = gov.timeframe
        config["duration_mode"] = gov.duration_mode
        if gov.market_hours:
            config["market_hours"] = gov.market_hours
        if gov.pdt:
            config["pdt"] = gov.pdt
        if gov.gap_risk:
            config["gap_risk"] = gov.gap_risk
        if gov.regime_filter:
            config["regime_filter"] = gov.regime_filter
        if gov.cooldown_rules:
            config["cooldown_rules"] = gov.cooldown_rules
        if gov.max_trades_per_session is not None:
            config.setdefault("risk", {})["max_trades_per_session"] = gov.max_trades_per_session
        if gov.min_time_between_entries_min is not None:
            config.setdefault("risk", {})["min_time_between_entries_min"] = gov.min_time_between_entries_min

    # Overlay Execution Style
    style = program.execution_style
    if style:
        config["entry_module"] = {
            "order_type": style.entry_order_type,
            "time_in_force": style.entry_time_in_force,
            "limit_offset_method": style.entry_limit_offset_method,
            "limit_offset_value": style.entry_limit_offset_value,
            "cancel_after_bars": style.entry_cancel_after_bars,
            "bracket_mode": style.bracket_mode,
            "stop_order_type": style.stop_order_type,
            "take_profit_order_type": style.take_profit_order_type,
            "trailing_stop_type": style.trailing_stop_type,
            "trailing_stop_value": style.trailing_stop_value,
        }
        config["scale_out"] = style.scale_out or []
        config["fill_model"] = style.fill_model
        config["slippage_bps_assumption"] = style.slippage_bps_assumption
        config["commission_per_share"] = style.commission_per_share
        if style.atr_source == "custom" and style.atr_timeframe:
            config["_atr_override_config"] = {
                "source": "custom",
                "length": style.atr_length or 14,
                "timeframe": style.atr_timeframe,
            }

    # Overlay Risk Profile
    rp = program.risk_profile
    if rp:
        config["position_sizing"] = {
            "method": "risk_pct",
            "risk_pct": rp.max_position_size_pct_long,
        }
        config["leverage"] = rp.max_leverage
        config.setdefault("risk", {}).update({
            "max_position_size_pct": rp.max_position_size_pct_long,
            "max_daily_loss_pct": rp.max_daily_loss_pct,
            "max_drawdown_lockout_pct": rp.max_drawdown_lockout_pct,
            "max_open_positions": rp.max_open_positions_long,
            "max_portfolio_heat": rp.max_portfolio_heat_long,
        })

    # Resolve symbols from watchlist subscriptions
    symbols: list[str] = []
    watchlist_ids: list[str] = program.watchlist_subscriptions or []
    if watchlist_ids:
        from app.models.watchlist import Watchlist, WatchlistMembership
        from sqlalchemy import select as _select
        from sqlalchemy.orm import selectinload as _selectinload
        wl_result = await db.execute(
            _select(Watchlist)
            .options(_selectinload(Watchlist.memberships))
            .where(Watchlist.id.in_(watchlist_ids))
        )
        watchlists = wl_result.scalars().all()
        rule = program.watchlist_combination_rule or "union"

        def _active_symbols(wl: Watchlist) -> list[str]:
            return [m.symbol for m in wl.memberships if m.state == "active"]

        if rule == "intersection" and watchlists:
            sets = [set(_active_symbols(wl)) for wl in watchlists]
            symbols = sorted(sets[0].intersection(*sets[1:]))
        else:
            seen: set[str] = set()
            for wl in watchlists:
                for s in _active_symbols(wl):
                    if s not in seen:
                        symbols.append(s)
                        seen.add(s)

    if not symbols:
        symbols = config.get("symbols", [])

    return program.strategy_version_id, config, symbols


def _json_serializable(obj: Any) -> Any:
    """
    Recursively convert any non-JSON-serializable objects (datetime, pd.Timestamp,
    np.int64, np.float64, etc.) to JSON-safe Python primitives.
    Called before persisting walk_forward and validation_evidence payloads.
    """
    if isinstance(obj, dict):
        return {k: _json_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_serializable(v) for v in obj]
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if hasattr(obj, "isoformat"):  # pd.Timestamp, np.datetime64 wrapped
        return obj.isoformat()
    if isinstance(obj, (pd.Timestamp,)):
        return obj.isoformat()
    if isinstance(obj, float) and (obj != obj or obj == float("inf") or obj == float("-inf")):
        return None  # NaN/Inf → null
    if hasattr(obj, "item"):  # np scalar → Python scalar
        return obj.item()
    return obj


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


def _compute_cpcv_payload(
    data: dict,
    strategy_config: dict,
    run_config: dict,
) -> dict:
    """
    Combinatorial Purged Cross-Validation (CPCV).

    Primary overfitting guard — runs before walk-forward.

    Algorithm
    ---------
    1. Split the full date range into N equal-length paths.
    2. For each combination of k test paths (C(N,k) combos):
       a. Train on the remaining N-k paths (combined, non-contiguous OK).
       b. Test on the k held-out paths.
    3. Aggregate: median OOS Sharpe, % positive OOS folds, IS/OOS degradation ratio.

    A strategy that passes CPCV (median OOS Sharpe > 0, degradation ratio < 2.0)
    is then submitted to walk-forward as the secondary guard.

    Parameters (from run_config["cpcv"])
    ------------------------------------
    n_paths       : int  — number of equal paths to split data into (default 6)
    k_test_paths  : int  — paths per test combination (default 2)
    embargo_bars  : int  — bars to drop between train and test (purge buffer, default 5)
    max_combos    : int  — cap combinatorial explosion (default 30)
    min_bars_path : int  — minimum bars per path, skip if shorter (default 30)
    """
    if not data:
        return {}

    primary_symbol = next(iter(data.keys()))
    base_df = data[primary_symbol]
    n_total_bars = len(base_df)

    cpcv_cfg = (run_config.get("cpcv") or {}) if isinstance(run_config, dict) else {}
    enabled = bool(cpcv_cfg.get("enabled", True))
    if not enabled:
        return {"method": "disabled", "folds": [], "warnings": ["CPCV disabled for this run"]}

    n_paths = int(cpcv_cfg.get("n_paths", 6))
    k_test = int(cpcv_cfg.get("k_test_paths", 2))
    embargo_bars = int(cpcv_cfg.get("embargo_bars", 5))
    max_combos = int(cpcv_cfg.get("max_combos", 30))
    min_bars_path = int(cpcv_cfg.get("min_bars_path", 30))

    # Need at least n_paths paths and k < n_paths
    if k_test >= n_paths:
        return {
            "method": "cpcv",
            "folds": [],
            "warnings": [f"k_test_paths ({k_test}) must be < n_paths ({n_paths})"],
        }

    if n_total_bars < n_paths * min_bars_path:
        return {
            "method": "cpcv",
            "folds": [],
            "warnings": [
                f"Insufficient bars ({n_total_bars}) for {n_paths} paths × {min_bars_path} min bars/path. "
                f"Need at least {n_paths * min_bars_path} bars."
            ],
        }

    # Split index into N equal-length paths
    path_size = n_total_bars // n_paths
    path_indices = list(range(n_paths))
    paths: list[tuple[int, int]] = []   # (start_bar_idx, end_bar_idx_exclusive)
    for i in range(n_paths):
        start = i * path_size
        end = (i + 1) * path_size if i < n_paths - 1 else n_total_bars
        paths.append((start, end))

    # Enumerate all C(N, k) test combinations, capped at max_combos
    all_combos = list(combinations(path_indices, k_test))
    if len(all_combos) > max_combos:
        # Evenly spaced sample — preserves diversity without just taking the first N
        step = len(all_combos) / max_combos
        all_combos = [all_combos[round(i * step)] for i in range(max_combos)]

    fold_results = []

    for combo_idx, test_path_ids in enumerate(all_combos):
        train_path_ids = [p for p in path_indices if p not in test_path_ids]

        # Build train data: concatenate train paths with embargo gaps removed
        train_frames: list[pd.DataFrame] = []
        for pid in train_path_ids:
            s, e = paths[pid]
            train_frames.append(base_df.iloc[s:e])

        # Build test data: concatenate test paths
        test_frames: list[pd.DataFrame] = []
        for pid in sorted(test_path_ids):
            s, e = paths[pid]
            # Apply embargo: skip first `embargo_bars` bars of each test path
            # to prevent information leakage from the adjacent train path.
            purge_start = min(s + embargo_bars, e)
            test_frames.append(base_df.iloc[purge_start:e])

        if not train_frames or not test_frames:
            continue

        train_df = pd.concat(train_frames).sort_index()
        test_df = pd.concat(test_frames).sort_index()

        if len(train_df) < min_bars_path or len(test_df) < min_bars_path:
            continue

        # Build per-symbol data dicts (multi-symbol: apply same path split to each)
        train_data = {}
        test_data = {}
        for sym, sym_df in data.items():
            sym_n = len(sym_df)
            sym_path_size = sym_n // n_paths
            t_frames = []
            ts_frames = []
            for pid in train_path_ids:
                s = pid * sym_path_size
                e = (pid + 1) * sym_path_size if pid < n_paths - 1 else sym_n
                t_frames.append(sym_df.iloc[s:e])
            for pid in sorted(test_path_ids):
                s = pid * sym_path_size
                e = (pid + 1) * sym_path_size if pid < n_paths - 1 else sym_n
                purge_start = min(s + embargo_bars, e)
                ts_frames.append(sym_df.iloc[purge_start:e])
            if t_frames:
                combined = pd.concat(t_frames).sort_index()
                if len(combined) > 0:
                    train_data[sym] = combined
            if ts_frames:
                combined = pd.concat(ts_frames).sort_index()
                if len(combined) > 0:
                    test_data[sym] = combined

        if not train_data or not test_data:
            continue

        try:
            selected_params, selection_details = _select_training_parameters(
                train_data=train_data,
                strategy_config=strategy_config,
                run_config=run_config,
                wf_cfg=(run_config.get("walk_forward") or {}) if isinstance(run_config, dict) else {},
            )
            locked_strategy_config = _with_parameter_overrides(strategy_config, selected_params)
            parameter_locking_validated = all(
                _get_nested_path(locked_strategy_config, path) == value
                for path, value in selected_params.items()
            )

            train_engine = BacktestEngine(deepcopy(locked_strategy_config), run_config)
            train_result = train_engine.run_backtest(train_data)
            is_sharpe = float(train_result.metrics.get("sharpe_ratio") or 0.0)

            test_run_config = dict(run_config)
            test_run_config["signal_start_date"] = str(test_df.index[0].date())
            test_engine = BacktestEngine(deepcopy(locked_strategy_config), test_run_config)
            test_result = test_engine.run_backtest(test_data)
            oos_sharpe = float(test_result.metrics.get("sharpe_ratio") or 0.0)

            fold_results.append({
                "combo_id": f"cpcv_{combo_idx + 1}",
                "test_path_ids": list(test_path_ids),
                "train_path_ids": train_path_ids,
                "train_bars": len(train_df),
                "test_bars": len(test_df),
                "selected_parameters": selected_params,
                "parameter_locking_validated": parameter_locking_validated,
                "parameter_selection": selection_details,
                "is_sharpe": round(is_sharpe, 3),
                "oos_sharpe": round(oos_sharpe, 3),
                "is_trades": len(train_result.trades),
                "oos_trades": len(test_result.trades),
                "oos_return_pct": round(float(test_result.metrics.get("total_return_pct") or 0.0), 2),
            })
        except Exception as exc:
            fold_results.append({
                "combo_id": f"cpcv_{combo_idx + 1}",
                "test_path_ids": list(test_path_ids),
                "train_path_ids": train_path_ids,
                "error": str(exc),
            })

    # Aggregate
    valid_oos = [f["oos_sharpe"] for f in fold_results if "oos_sharpe" in f]
    valid_is = [f["is_sharpe"] for f in fold_results if "is_sharpe" in f]
    median_oos_sharpe = float(sorted(valid_oos)[len(valid_oos) // 2]) if valid_oos else None
    median_is_sharpe = float(sorted(valid_is)[len(valid_is) // 2]) if valid_is else None
    pct_positive_oos = round(sum(1 for s in valid_oos if s > 0) / len(valid_oos) * 100, 1) if valid_oos else None

    # IS/OOS degradation ratio: how much Sharpe degrades from IS to OOS.
    # Ratio > 2.0 is a strong curve-fit signal.
    degradation_ratio = None
    if median_is_sharpe and median_oos_sharpe is not None:
        if abs(median_oos_sharpe) > 1e-6:
            degradation_ratio = round(median_is_sharpe / median_oos_sharpe, 3)
        elif median_is_sharpe > 0:
            degradation_ratio = float("inf")  # IS positive, OOS zero/negative — curve fit

    warnings: list[str] = []
    if degradation_ratio is not None and degradation_ratio != float("inf") and degradation_ratio > 2.0:
        warnings.append(f"IS/OOS Sharpe degradation ratio {degradation_ratio:.2f} > 2.0 — likely curve-fit")
    if degradation_ratio == float("inf"):
        warnings.append("OOS Sharpe is zero or negative while IS Sharpe is positive — strong curve-fit signal")
    if pct_positive_oos is not None and pct_positive_oos < 50:
        warnings.append(f"Only {pct_positive_oos}% of OOS folds are profitable — strategy may not generalize")
    if not fold_results:
        warnings.append("No CPCV folds completed")

    pass_primary_guard = bool(valid_oos) and (
        median_oos_sharpe is not None
        and median_oos_sharpe > 0
        and (
            degradation_ratio is None
            or degradation_ratio < 2.0
        )
        and pct_positive_oos is not None
        and pct_positive_oos >= 50.0
        and all(bool(f.get("parameter_locking_validated", False)) for f in fold_results if "oos_sharpe" in f)
    )

    return {
        "method": "cpcv",
        "settings": {
            "n_paths": n_paths,
            "k_test_paths": k_test,
            "embargo_bars": embargo_bars,
            "total_combos_evaluated": len(fold_results),
        },
        "folds": fold_results,
        "aggregate": {
            "median_is_sharpe": round(median_is_sharpe, 3) if median_is_sharpe is not None else None,
            "median_oos_sharpe": round(median_oos_sharpe, 3) if median_oos_sharpe is not None else None,
            "pct_positive_oos_folds": pct_positive_oos,
            "is_oos_degradation_ratio": degradation_ratio if degradation_ratio != float("inf") else None,
            "is_oos_degradation_infinite": degradation_ratio == float("inf"),
            "fold_count": len(fold_results),
            "pass_primary_guard": pass_primary_guard,
        },
        "warnings": warnings,
    }


def _cpcv_primary_guard_passed(cpcv_payload: dict | None) -> bool:
    if not isinstance(cpcv_payload, dict):
        return False
    aggregate = cpcv_payload.get("aggregate")
    if not isinstance(aggregate, dict):
        return False
    return bool(aggregate.get("pass_primary_guard", False))


def _trade_return_sharpe(trades: list[dict[str, Any]]) -> float | None:
    returns: list[float] = []
    for trade in trades:
        ret = trade.get("return_pct")
        if ret is None:
            qty = float(trade.get("quantity", 0.0) or 0.0)
            entry = float(trade.get("entry_price", 0.0) or 0.0)
            pnl = trade.get("net_pnl")
            cost_basis = qty * entry
            if pnl is None or cost_basis <= 0:
                continue
            ret = float(pnl) / cost_basis * 100.0
        returns.append(float(ret))

    if len(returns) < 2:
        return None

    series = pd.Series(returns, dtype="float64")
    std = float(series.std(ddof=1))
    if std <= 1e-9:
        return None
    return float((series.mean() / std) * math.sqrt(len(series)))


def _score_stability(
    *,
    cpcv_passed: bool,
    oos_positive_rate_pct: float | None,
    degradation_ratio: float | None,
    infinite_degradation: bool,
    walk_forward_positive_rate_pct: float | None,
    anti_bias: dict[str, Any],
) -> float:
    score = 0.0
    if cpcv_passed:
        score += 0.35
    if anti_bias.get("leakage_checks_passed"):
        score += 0.15
    if anti_bias.get("parameter_locking_passed"):
        score += 0.15
    if anti_bias.get("causal_indicator_checks_passed"):
        score += 0.1
    if oos_positive_rate_pct is not None:
        score += min(max(float(oos_positive_rate_pct) / 100.0, 0.0), 1.0) * 0.15
    if walk_forward_positive_rate_pct is not None:
        score += min(max(float(walk_forward_positive_rate_pct) / 100.0, 0.0), 1.0) * 0.1

    if infinite_degradation:
        score -= 0.2
    elif degradation_ratio is not None:
        score -= min(max((float(degradation_ratio) - 1.0) / 3.0, 0.0), 0.2)

    return round(min(max(score, 0.0), 1.0), 3)


def _compute_cost_sensitivity_curve(
    data: dict[str, pd.DataFrame],
    strategy_config: dict,
    run_config: dict,
) -> list[dict[str, Any]]:
    if not data:
        return []

    baseline_bps = float(run_config.get("slippage_pct", 0.0) or 0.0) * 100.0
    bps_points = [baseline_bps, baseline_bps + 0.5, baseline_bps + 1.0, baseline_bps + 2.0, baseline_bps + 5.0]
    curve: list[dict[str, Any]] = []

    for bps in bps_points:
        scenario_run_config = dict(run_config)
        scenario_run_config["slippage_ticks"] = 0
        scenario_run_config["slippage_pct"] = float(bps) / 100.0
        scenario_run_config.pop("signal_start_date", None)
        try:
            scenario_engine = BacktestEngine(deepcopy(strategy_config), scenario_run_config)
            scenario_result = scenario_engine.run_backtest(data)
            metrics = scenario_result.metrics or {}
            curve.append(
                {
                    "slippage_bps": round(float(bps), 2),
                    "sharpe_ratio": metrics.get("sharpe_ratio"),
                    "total_return_pct": metrics.get("total_return_pct"),
                    "trade_count": metrics.get("total_trades"),
                }
            )
        except Exception as exc:
            curve.append(
                {
                    "slippage_bps": round(float(bps), 2),
                    "error": str(exc),
                }
            )

    return curve


def _build_validation_evidence_payload(
    *,
    walk_forward_payload: dict,
    strategy_config: dict,
    run_config: dict,
    data: dict[str, pd.DataFrame],
) -> dict[str, Any]:
    cpcv = walk_forward_payload.get("cpcv") if isinstance(walk_forward_payload, dict) else {}
    cpcv_aggregate = cpcv.get("aggregate") if isinstance(cpcv, dict) else {}
    anti_bias = walk_forward_payload.get("anti_bias") if isinstance(walk_forward_payload, dict) else {}
    aggregate_oos = walk_forward_payload.get("aggregate_oos") if isinstance(walk_forward_payload, dict) else {}
    fold_results = walk_forward_payload.get("folds") if isinstance(walk_forward_payload, dict) else []

    regime_totals: dict[str, float] = {}
    oos_symbol_returns: dict[str, list[float]] = {}
    for fold in fold_results or []:
        test_metrics = fold.get("test_metrics") if isinstance(fold, dict) else None
        regime_breakdown = test_metrics.get("regime_breakdown") if isinstance(test_metrics, dict) else None
        if isinstance(regime_breakdown, dict):
            for regime, pnl in regime_breakdown.items():
                regime_totals[regime] = round(regime_totals.get(regime, 0.0) + float(pnl or 0.0), 2)

        test_trades = fold.get("test_trades") if isinstance(fold, dict) else None
        if isinstance(test_trades, list):
            for trade in test_trades:
                symbol = str(trade.get("symbol", "")).upper()
                if not symbol:
                    continue
                ret = trade.get("return_pct")
                if ret is None:
                    qty = float(trade.get("quantity", 0.0) or 0.0)
                    entry = float(trade.get("entry_price", 0.0) or 0.0)
                    pnl = trade.get("net_pnl")
                    cost_basis = qty * entry
                    if pnl is None or cost_basis <= 0:
                        continue
                    ret = float(pnl) / cost_basis * 100.0
                oos_symbol_returns.setdefault(symbol, []).append(float(ret))

    per_symbol_oos_sharpe: dict[str, float | None] = {}
    for symbol, returns in oos_symbol_returns.items():
        if len(returns) < 2:
            per_symbol_oos_sharpe[symbol] = None
            continue
        series = pd.Series(returns, dtype="float64")
        std = float(series.std(ddof=1))
        per_symbol_oos_sharpe[symbol] = None if std <= 1e-9 else round(float((series.mean() / std) * math.sqrt(len(series))), 3)

    cost_sensitivity_curve = _compute_cost_sensitivity_curve(data, strategy_config, run_config)
    degradation_ratio = cpcv_aggregate.get("is_oos_degradation_ratio") if isinstance(cpcv_aggregate, dict) else None
    infinite_degradation = bool(cpcv_aggregate.get("is_oos_degradation_infinite")) if isinstance(cpcv_aggregate, dict) else False
    stability_score = _score_stability(
        cpcv_passed=bool(cpcv_aggregate.get("pass_primary_guard")) if isinstance(cpcv_aggregate, dict) else False,
        oos_positive_rate_pct=cpcv_aggregate.get("pct_positive_oos_folds") if isinstance(cpcv_aggregate, dict) else None,
        degradation_ratio=float(degradation_ratio) if degradation_ratio is not None else None,
        infinite_degradation=infinite_degradation,
        walk_forward_positive_rate_pct=aggregate_oos.get("positive_oos_fold_rate_pct") if isinstance(aggregate_oos, dict) else None,
        anti_bias=anti_bias if isinstance(anti_bias, dict) else {},
    )

    warnings: list[str] = []
    if isinstance(cpcv, dict):
        warnings.extend(str(w) for w in cpcv.get("warnings", []) or [])
    warnings.extend(str(w) for w in walk_forward_payload.get("warnings", []) or [])

    return {
        "method": "cpcv_walk_forward",
        "cpcv": cpcv if isinstance(cpcv, dict) else {},
        "walk_forward": walk_forward_payload,
        "anti_bias": anti_bias if isinstance(anti_bias, dict) else {},
        "regime_performance": regime_totals,
        "per_symbol_oos_sharpe": per_symbol_oos_sharpe,
        "cost_sensitivity_curve": cost_sensitivity_curve,
        "warnings": list(dict.fromkeys(warnings)),
        "is_oos_degradation_ratio": float(degradation_ratio) if degradation_ratio is not None else None,
        "stability_score": stability_score,
    }


def _compute_walk_forward_payload(
    data: dict,
    strategy_config: dict,
    run_config: dict,
    naive_metrics: dict | None = None,
) -> dict:
    if not data:
        return {}

    cpcv_payload = _compute_cpcv_payload(data, strategy_config, run_config)
    cpcv_primary_guard_passed = _cpcv_primary_guard_passed(cpcv_payload)

    primary_symbol = next(iter(data.keys()))
    base_df = data[primary_symbol]
    n = len(base_df)
    if n < 80:
        return {
            "method": "insufficient_bars",
            "folds": [],
            "aggregate_oos": {},
            "cpcv": cpcv_payload,
            "warnings": ["Not enough bars for forward-test split"],
            "anti_bias": {
                "cpcv_primary_guard_passed": cpcv_primary_guard_passed,
                "leakage_checks_passed": False,
                "parameter_locking_passed": False,
                "causal_indicator_checks_passed": len(_detect_non_causal_indicator_refs(strategy_config)) == 0,
                "non_causal_indicator_refs": _detect_non_causal_indicator_refs(strategy_config),
            },
        }

    wf_cfg = (run_config.get("walk_forward") or {}) if isinstance(run_config, dict) else {}
    enabled = bool(wf_cfg.get("enabled", True))
    non_causal_refs = _detect_non_causal_indicator_refs(strategy_config)
    if not enabled:
        return {
            "method": "disabled",
            "folds": [],
            "aggregate_oos": {},
            "cpcv": cpcv_payload,
            "warnings": ["Walk-forward mode disabled for this run"],
            "anti_bias": {
                "cpcv_primary_guard_passed": cpcv_primary_guard_passed,
                "leakage_checks_passed": False,
                "parameter_locking_passed": False,
                "causal_indicator_checks_passed": len(non_causal_refs) == 0,
                "non_causal_indicator_refs": non_causal_refs,
            },
        }

    train_window_months = int(wf_cfg.get("train_window_months", 12))
    test_window_months = int(wf_cfg.get("test_window_months", 3))
    warmup_bars = int(wf_cfg.get("warmup_bars", 100))
    max_folds = int(wf_cfg.get("max_folds", 24))

    folds = _generate_calendar_folds(base_df.index, train_window_months, test_window_months, max_folds)
    if not folds:
        return {
            "method": "sliding_calendar_months",
            "folds": [],
            "aggregate_oos": {},
            "cpcv": cpcv_payload,
            "warnings": ["No valid train/test fold windows for selected data range"],
            "anti_bias": {
                "cpcv_primary_guard_passed": cpcv_primary_guard_passed,
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
                "test_trades": test_result.trades,
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
        "cpcv": cpcv_payload,
        "folds": fold_results,
        "aggregate_oos": aggregate,
        "stitched_oos_equity": stitched_oos_equity,
        "naive_full_period": naive,
        "anti_bias": {
            "cpcv_primary_guard_passed": cpcv_primary_guard_passed,
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
    run_id: str | None = None,
) -> BacktestRun:
    """Execute the backtest. If run_id is given, load the existing pending record; otherwise create one."""
    if run_id:
        run = await db.get(BacktestRun, run_id)
        if run is None:
            raise ValueError(f"BacktestRun {run_id} not found")
        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        await db.flush()
    else:
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
                "cpcv": run_config.get("cpcv", {}),
            },
            started_at=datetime.now(timezone.utc),
        )
        db.add(run)
        await db.flush()

    try:
        # Backtester has NO date clamping — use whatever range the user requested.
        # If you have the data, you should be able to test it. Only warn on very large requests.
        from app.services.data_limits import check_bar_count

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

        selected_provider = resolve_requested_provider(
            requested_provider=provider_decision["provider"] if data_provider == "auto" else data_provider,
            runtime_mode="research",
            alpaca_credentials_configured=has_alpaca_credentials,
        )
        if selected_provider == "alpaca" and not has_alpaca_credentials:
            raise ValueError("Alpaca selected but credentials are missing")

        if selected_provider not in {"yfinance", "alpaca"}:
            raise ValueError(f"Unsupported data provider: {selected_provider}")

        for symbol in run.symbols:
            df = await asyncio.get_running_loop().run_in_executor(
                None,
                lambda symbol=symbol: fetch_market_data(
                    symbol=symbol,
                    timeframe=run.timeframe,
                    start=run.start_date,
                    end=run.end_date,
                    provider=selected_provider,
                    adjusted=True,
                    force_download=False,
                    api_key=alpaca_api_key,
                    secret_key=alpaca_secret_key,
                ),
            )
            if df is not None and len(df) > 0:
                check_bar_count(symbol, len(df), run.timeframe, mode="backtest")
                data[symbol] = df
            else:
                logger.warning(f"No data for {symbol}")
                missing_symbols.append(symbol)

        run.parameters = {
            **(run.parameters or {}),
            "data_provider_requested": data_provider,
            "data_provider_used": selected_provider,
            "data_provider_recommendation": provider_decision,
            "feature_plan_preview": build_feature_plan_preview(
                strategy_config,
                duration_mode=strategy_config.get("duration_mode"),
                symbols=list(run.symbols or []),
                timeframe=str(run.timeframe),
            ),
        }

        allow_partial_symbols = bool(run_config.get("allow_partial_symbols", False))
        if missing_symbols and not allow_partial_symbols:
            missing = ", ".join(sorted(missing_symbols))
            raise ValueError(f"Missing data for requested symbols: {missing}")

        if not data:
            raise ValueError("No data loaded for any symbol")

        # Fetch separate ATR timeframe bars when execution style requests a custom ATR source
        atr_cfg = strategy_config.get("_atr_override_config")
        if atr_cfg and atr_cfg.get("timeframe") and atr_cfg["timeframe"] != str(run.timeframe):
            atr_override_data: dict = {}
            for symbol in list(data.keys()):
                atr_df = await asyncio.get_running_loop().run_in_executor(
                    None,
                    lambda sym=symbol: fetch_market_data(
                        symbol=sym,
                        timeframe=atr_cfg["timeframe"],
                        start=run.start_date,
                        end=run.end_date,
                        provider=selected_provider,
                        adjusted=True,
                        force_download=False,
                        api_key=alpaca_api_key,
                        secret_key=alpaca_secret_key,
                    ),
                )
                if atr_df is not None and len(atr_df) > 0:
                    atr_override_data[symbol] = atr_df
                else:
                    logger.warning("ATR override: no %s bars for %s — falling back to trade-TF ATR", atr_cfg["timeframe"], symbol)
            if atr_override_data:
                strategy_config["_atr_override_data"] = atr_override_data

        # Fetch per-indicator alternate timeframe bars (Phase 2 multi-TF conditions)
        # Also collects stop/target configs that carry a "timeframe" ATR override.
        _extra_tf_refs: dict[str, set[str]] = {}

        def _walk_for_tf_refs(node: Any) -> None:
            if isinstance(node, dict):
                # Condition ValueSpec: {indicator, timeframe}
                if "indicator" in node and "timeframe" in node and node.get("timeframe"):
                    _extra_tf_refs.setdefault(node["timeframe"], set()).add(node["indicator"])
                # Stop/target ATR timeframe: {method: "atr_multiple"|"chandelier", timeframe}
                if node.get("method") in ("atr_multiple", "chandelier") and node.get("timeframe"):
                    # We need OHLCV bars for that TF so the engine can compute ATR on-the-fly.
                    # Register with a sentinel so the TF is fetched even if no indicator names.
                    _extra_tf_refs.setdefault(node["timeframe"], set())
                for v in node.values():
                    _walk_for_tf_refs(v)
            elif isinstance(node, list):
                for item in node:
                    _walk_for_tf_refs(item)

        _walk_for_tf_refs(strategy_config)

        trade_tf = str(run.timeframe)
        required_extra_tfs = {tf for tf in _extra_tf_refs if tf != trade_tf}
        if required_extra_tfs:
            extra_tf_data: dict[str, dict[str, pd.DataFrame]] = {}
            for tf in required_extra_tfs:
                extra_tf_data[tf] = {}
                for symbol in list(data.keys()):
                    try:
                        alt_df = await asyncio.get_running_loop().run_in_executor(
                            None,
                            lambda sym=symbol, _tf=tf: fetch_market_data(
                                symbol=sym,
                                timeframe=_tf,
                                start=run.start_date,
                                end=run.end_date,
                                provider=selected_provider,
                                adjusted=True,
                                force_download=False,
                                api_key=alpaca_api_key,
                                secret_key=alpaca_secret_key,
                            ),
                        )
                        if alt_df is not None and len(alt_df) > 0:
                            # Compute indicators so the referenced names are available
                            temp_engine = BacktestEngine(dict(strategy_config), {})
                            extra_tf_data[tf][symbol] = temp_engine._compute_indicators(alt_df, symbol=symbol)
                        else:
                            logger.warning("Multi-TF: no %s bars for %s — skipping alt TF indicators", tf, symbol)
                    except Exception as exc:
                        logger.warning("Multi-TF: failed to fetch %s bars for %s: %s", tf, symbol, exc)
            if extra_tf_data:
                strategy_config["_extra_tf_data"] = extra_tf_data

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
        validation_evidence_payload = await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: _build_validation_evidence_payload(
                walk_forward_payload=walk_forward_payload,
                strategy_config=strategy_config,
                run_config=run_config,
                data=data,
            ),
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
            sqn=m.get("sqn"),
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
            monthly_returns=_json_serializable(m.get("monthly_returns", {})),
            equity_curve=_json_serializable(result.equity_curve),
            exit_reason_breakdown=_json_serializable(m.get("exit_reason_breakdown", {})),
            regime_breakdown=_json_serializable(m.get("regime_breakdown", {})),
            monte_carlo=_json_serializable(m.get("monte_carlo", {})),
            walk_forward=_json_serializable(walk_forward_payload),
        )
        db.add(metrics)
        vep = _json_serializable(validation_evidence_payload)
        db.add(
            ValidationEvidence(
                run_id=run.id,
                method=vep.get("method", "cpcv_walk_forward"),
                cpcv=vep.get("cpcv", {}),
                walk_forward=vep.get("walk_forward", {}),
                anti_bias=vep.get("anti_bias", {}),
                regime_performance=vep.get("regime_performance", {}),
                per_symbol_oos_sharpe=vep.get("per_symbol_oos_sharpe", {}),
                cost_sensitivity_curve=vep.get("cost_sensitivity_curve", []),
                warnings=vep.get("warnings", []),
                is_oos_degradation_ratio=vep.get("is_oos_degradation_ratio"),
                stability_score=vep.get("stability_score"),
            )
        )

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)

    except Exception as e:
        logger.exception(f"Backtest failed: {e}")
        run.status = "failed"
        run.error_message = str(e)

    await db.flush()
    await db.commit()
    return run
