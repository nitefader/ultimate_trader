"""
Machine learning endpoints for feature engineering, model training, and signal generation.

Endpoints
---------
POST /ml/prepare-dataset       — Feature-engineer a dataset and return preview statistics
POST /ml/train-model           — Train a RandomForest, persist it, return rich metrics + model_id
GET  /ml/models                — List all persisted models with metadata
POST /ml/models/{model_id}/signals — Generate signal rows for the last N bars of a symbol
DELETE /ml/models/{model_id}   — Remove a persisted model and its metadata
POST /ml/compare               — Compare two models on the same held-out test window
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Depends
from app.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.models.deployment import Deployment
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import TimeSeriesSplit, train_test_split

from app.config import get_settings
from app.data.providers.yfinance_provider import fetch
from app.indicators.technical import add_technical_indicators

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ml", tags=["ml"])
settings = get_settings()

# ── Constants ─────────────────────────────────────────────────────────────────

_EXCLUDE_COLS = frozenset({"future_return", "target", "open", "high", "low", "close", "volume"})
_N_ESTIMATORS = 200
_N_CV_SPLITS = 5
_TOP_FEATURES = 15


# ── Feature engineering ───────────────────────────────────────────────────────

def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add a rich feature set on top of the base OHLCV + technical indicators.

    Categories added
    ----------------
    - Simple and log returns (1, 3, 5, 10-bar)
    - Rolling volatility (5, 10, 21-bar)
    - Price vs SMA ratios (SMA-20, SMA-50)
    - RSI divergence (RSI minus its own 5-bar SMA)
    - Volume ratios (current vol vs 5, 20-bar rolling mean)
    - Momentum (rate-of-change 5, 10, 20-bar)
    - High-low range normalised by ATR
    - Overnight gap (open vs prior close)
    """
    df = df.copy()
    close = df["close"]
    volume = df["volume"]

    # ── Returns ────────────────────────────────────────────────────────────────
    for n in (1, 3, 5, 10):
        df[f"return_{n}d"] = close.pct_change(n, fill_method=None)
        df[f"log_return_{n}d"] = np.log(close / close.shift(n))

    # ── Rolling volatility (std of log returns) ────────────────────────────────
    log_ret_1 = np.log(close / close.shift(1))
    for n in (5, 10, 21):
        df[f"vol_{n}d"] = log_ret_1.rolling(n).std()

    # ── Price vs SMA ratios ────────────────────────────────────────────────────
    for period in (20, 50):
        sma_col = f"sma_{period}_ratio"
        sma_val = close.rolling(period).mean()
        df[sma_col] = close / sma_val - 1

    # ── RSI divergence (RSI minus its 5-bar SMA) ──────────────────────────────
    if "rsi_14" in df.columns:
        df["rsi_divergence"] = df["rsi_14"] - df["rsi_14"].rolling(5).mean()

    # ── Volume ratios ──────────────────────────────────────────────────────────
    for n in (5, 20):
        avg_vol = volume.rolling(n).mean()
        df[f"vol_ratio_{n}d"] = volume / avg_vol.replace(0, np.nan)

    # ── Momentum (Rate of Change) ──────────────────────────────────────────────
    for n in (5, 10, 20):
        df[f"roc_{n}d"] = (close - close.shift(n)) / close.shift(n)

    # ── High-low range vs ATR ──────────────────────────────────────────────────
    if "atr_14" in df.columns:
        df["hl_atr_ratio"] = (df["high"] - df["low"]) / df["atr_14"].replace(0, np.nan)

    # ── Overnight gap ──────────────────────────────────────────────────────────
    df["overnight_gap"] = (df["open"] - close.shift(1)) / close.shift(1)

    # ── Bollinger %B (position within band) ───────────────────────────────────
    if "bb_upper" in df.columns and "bb_lower" in df.columns:
        band_width = df["bb_upper"] - df["bb_lower"]
        df["bb_pct_b"] = (close - df["bb_lower"]) / band_width.replace(0, np.nan)

    return df


def _build_dataset(
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
    target_horizon: int,
) -> tuple[pd.DataFrame, list[str]]:
    """
    Fetch, indicator-enrich, feature-engineer, and label a dataset.

    Returns
    -------
    df : cleaned DataFrame with all features + 'target' column
    feature_cols : ordered list of feature column names
    """
    df = fetch(symbol, timeframe, start, end, adjusted=True, force_download=False)
    df = add_technical_indicators(df)
    df = _engineer_features(df)

    # Target: 1 if forward return over horizon is positive
    df["future_return"] = df["close"].shift(-target_horizon) / df["close"] - 1
    df["target"] = (df["future_return"] > 0).astype(int)

    df = df.dropna()
    df = df.replace([np.inf, -np.inf], np.nan).dropna()

    feature_cols = [c for c in df.columns if c not in _EXCLUDE_COLS]
    return df, feature_cols


def _cross_validate(
    X: pd.DataFrame,
    y: pd.Series,
    n_splits: int = _N_CV_SPLITS,
    n_estimators: int = _N_ESTIMATORS,
) -> dict[str, Any]:
    """
    TimeSeriesSplit cross-validation.  Returns per-fold and aggregate scores.
    """
    tscv = TimeSeriesSplit(n_splits=n_splits)
    fold_metrics: list[dict] = []

    for fold_idx, (train_idx, val_idx) in enumerate(tscv.split(X)):
        X_tr, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_tr, y_val = y.iloc[train_idx], y.iloc[val_idx]

        clf = RandomForestClassifier(
            n_estimators=n_estimators,
            max_depth=10,
            min_samples_leaf=5,
            random_state=42,
            n_jobs=-1,
        )
        clf.fit(X_tr, y_tr)
        y_pred = clf.predict(X_val)
        y_prob = clf.predict_proba(X_val)[:, 1]

        fold_metrics.append(
            {
                "fold": fold_idx + 1,
                "accuracy": round(float(accuracy_score(y_val, y_pred)), 4),
                "f1": round(float(f1_score(y_val, y_pred, zero_division=0)), 4),
                "roc_auc": round(float(roc_auc_score(y_val, y_prob)), 4),
            }
        )

    cv_accuracies = [m["accuracy"] for m in fold_metrics]
    cv_f1s = [m["f1"] for m in fold_metrics]
    cv_aucs = [m["roc_auc"] for m in fold_metrics]

    return {
        "folds": fold_metrics,
        "mean_accuracy": round(float(np.mean(cv_accuracies)), 4),
        "std_accuracy": round(float(np.std(cv_accuracies)), 4),
        "mean_f1": round(float(np.mean(cv_f1s)), 4),
        "mean_roc_auc": round(float(np.mean(cv_aucs)), 4),
    }


# ── Persistence helpers ───────────────────────────────────────────────────────

def _model_path(model_id: str) -> Path:
    return settings.MODELS_DIR / f"{model_id}.joblib"


def _meta_path(model_id: str) -> Path:
    return settings.MODELS_DIR / f"{model_id}.meta.json"


def _save_model(model_id: str, clf: RandomForestClassifier, meta: dict) -> None:
    joblib.dump(clf, _model_path(model_id))
    with open(_meta_path(model_id), "w") as fh:
        json.dump(meta, fh, indent=2, default=str)
    logger.info("Model saved: %s", model_id)


def _load_model(model_id: str) -> tuple[RandomForestClassifier, dict]:
    mp = _model_path(model_id)
    mep = _meta_path(model_id)
    if not mp.exists():
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")
    clf = joblib.load(mp)
    meta: dict = {}
    if mep.exists():
        with open(mep) as fh:
            meta = json.load(fh)
    return clf, meta


def _list_models() -> list[dict]:
    metas: list[dict] = []
    for meta_file in sorted(settings.MODELS_DIR.glob("*.meta.json")):
        try:
            with open(meta_file) as fh:
                metas.append(json.load(fh))
        except Exception as exc:
            logger.warning("Could not read meta %s: %s", meta_file, exc)
    return metas


def _delete_model(model_id: str) -> None:
    mp = _model_path(model_id)
    mep = _meta_path(model_id)
    if not mp.exists():
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")
    mp.unlink(missing_ok=True)
    mep.unlink(missing_ok=True)
    logger.info("Model deleted: %s", model_id)


# ── Regime detection (simple volatility regime) ───────────────────────────────

def _assign_regime(df: pd.DataFrame) -> pd.Series:
    """
    Label each bar with a market regime based on 21-bar realised volatility
    compared to its 63-bar rolling median.

    Regimes: 'low_vol', 'normal', 'high_vol'
    """
    if "vol_21d" not in df.columns:
        log_ret = np.log(df["close"] / df["close"].shift(1))
        rv = log_ret.rolling(21).std()
    else:
        rv = df["vol_21d"]

    median_rv = rv.rolling(63).median()
    regime = pd.Series("normal", index=df.index)
    regime[rv < median_rv * 0.75] = "low_vol"
    regime[rv > median_rv * 1.25] = "high_vol"
    return regime


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/prepare-dataset")
async def prepare_dataset(body: dict[str, Any]) -> dict[str, Any]:
    """
    Prepare and preview an ML-ready dataset for a given symbol / timeframe.

    Body fields
    -----------
    symbol          : str  (required)
    timeframe       : str  (default "1d")
    start           : str  (default "2020-01-01")
    end             : str  (default "2023-12-31")
    target_horizon  : int  (default 5) — bars ahead for target label
    """
    symbol: str | None = body.get("symbol")
    timeframe: str = body.get("timeframe", "1d")
    start: str = body.get("start", "2020-01-01")
    end: str = body.get("end", "2023-12-31")
    target_horizon: int = int(body.get("target_horizon", 5))

    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")

    try:
        loop = asyncio.get_running_loop()
        df, feature_cols = await loop.run_in_executor(
            None, _build_dataset, symbol, timeframe, start, end, target_horizon
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("prepare-dataset failed for %s", symbol)
        raise HTTPException(status_code=500, detail=f"Dataset preparation failed: {exc}") from exc

    target = df["target"]
    preview = df[feature_cols].head(5).replace({np.nan: None, np.inf: None, -np.inf: None})

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "start": start,
        "end": end,
        "target_horizon": target_horizon,
        "samples": int(len(df)),
        "feature_count": len(feature_cols),
        "features": feature_cols,
        "target_distribution": {str(k): int(v) for k, v in target.value_counts().items()},
        "class_balance": round(float(target.mean()), 4),
        "feature_preview": preview.to_dict("records"),
    }


@router.post("/train-model")
async def train_model(body: dict[str, Any]) -> dict[str, Any]:
    """
    Train a RandomForestClassifier with TimeSeriesSplit cross-validation.

    Body fields
    -----------
    symbol          : str  (required)
    timeframe       : str  (default "1d")
    start           : str  (default "2020-01-01")
    end             : str  (default "2023-12-31")
    target_horizon  : int  (default 5)
    n_estimators    : int  (default 200)
    test_size       : float (default 0.2) — final hold-out fraction

    Returns
    -------
    model_id, training metrics, cross-val scores, top-15 feature importance
    """
    symbol: str | None = body.get("symbol")
    timeframe: str = body.get("timeframe", "1d")
    start: str = body.get("start", "2020-01-01")
    end: str = body.get("end", "2023-12-31")
    target_horizon: int = int(body.get("target_horizon", 5))
    n_estimators: int = int(body.get("n_estimators", _N_ESTIMATORS))
    test_size: float = float(body.get("test_size", 0.2))

    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")
    if not (0.05 <= test_size <= 0.5):
        raise HTTPException(status_code=400, detail="test_size must be between 0.05 and 0.50")

    loop = asyncio.get_running_loop()

    # ── Build dataset ──────────────────────────────────────────────────────────
    try:
        df, feature_cols = await loop.run_in_executor(
            None, _build_dataset, symbol, timeframe, start, end, target_horizon
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("train-model dataset build failed for %s", symbol)
        raise HTTPException(status_code=500, detail=f"Dataset build failed: {exc}") from exc

    X = df[feature_cols]
    y = df["target"]

    # ── Chronological train / test split ──────────────────────────────────────
    split_idx = int(len(X) * (1 - test_size))
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

    # ── Cross-validation on training portion ──────────────────────────────────
    try:
        cv_results = await loop.run_in_executor(
            None, _cross_validate, X_train, y_train, _N_CV_SPLITS, n_estimators
        )
    except Exception as exc:
        logger.exception("Cross-validation failed")
        raise HTTPException(status_code=500, detail=f"Cross-validation failed: {exc}") from exc

    # ── Final model trained on full training set ───────────────────────────────
    def _fit_final() -> RandomForestClassifier:
        clf = RandomForestClassifier(
            n_estimators=n_estimators,
            max_depth=10,
            min_samples_leaf=5,
            random_state=42,
            n_jobs=-1,
        )
        clf.fit(X_train, y_train)
        return clf

    try:
        clf = await loop.run_in_executor(None, _fit_final)
    except Exception as exc:
        logger.exception("Final model fit failed")
        raise HTTPException(status_code=500, detail=f"Model training failed: {exc}") from exc

    # ── Hold-out evaluation ───────────────────────────────────────────────────
    y_pred = clf.predict(X_test)
    y_prob = clf.predict_proba(X_test)[:, 1]

    accuracy = float(accuracy_score(y_test, y_pred))
    precision = float(precision_score(y_test, y_pred, zero_division=0))
    recall = float(recall_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    try:
        roc_auc = float(roc_auc_score(y_test, y_prob))
    except ValueError:
        roc_auc = float("nan")

    clf_report: dict = classification_report(y_test, y_pred, output_dict=True, zero_division=0)

    # ── Feature importance (top N) ─────────────────────────────────────────────
    importance_pairs = sorted(
        zip(feature_cols, clf.feature_importances_),
        key=lambda x: x[1],
        reverse=True,
    )
    top_features = {name: round(float(imp), 6) for name, imp in importance_pairs[:_TOP_FEATURES]}

    # ── Persist model + metadata ───────────────────────────────────────────────
    model_id = str(uuid.uuid4())
    trained_at = datetime.now(timezone.utc).isoformat()

    meta = {
        "model_id": model_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "start": start,
        "end": end,
        "target_horizon": target_horizon,
        "n_estimators": n_estimators,
        "feature_cols": feature_cols,
        "trained_at": trained_at,
        "samples_total": int(len(df)),
        "samples_train": int(len(X_train)),
        "samples_test": int(len(X_test)),
        "test_metrics": {
            "accuracy": round(accuracy, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "roc_auc": round(roc_auc, 4),
        },
        "cv_results": cv_results,
        "top_features": top_features,
    }

    try:
        await loop.run_in_executor(None, _save_model, model_id, clf, meta)
    except Exception as exc:
        logger.exception("Model persistence failed for %s", model_id)
        raise HTTPException(status_code=500, detail=f"Model save failed: {exc}") from exc

    return {
        "model_id": model_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "trained_at": trained_at,
        "samples_total": int(len(df)),
        "samples_train": int(len(X_train)),
        "samples_test": int(len(X_test)),
        "test_metrics": {
            "accuracy": round(accuracy, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "roc_auc": round(roc_auc, 4),
        },
        "classification_report": clf_report,
        "cross_validation": cv_results,
        "feature_importance_top15": top_features,
    }


@router.get("/models")
async def list_models() -> list[dict[str, Any]]:
    """
    Return metadata for every persisted model, ordered by training date descending.
    """
    try:
        models = await asyncio.get_running_loop().run_in_executor(None, _list_models)
    except Exception as exc:
        logger.exception("list_models failed")
        raise HTTPException(status_code=500, detail=f"Could not list models: {exc}") from exc

    models.sort(key=lambda m: m.get("trained_at", ""), reverse=True)
    return models


@router.post("/models/{model_id}/signals")
async def generate_signals(model_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """
    Generate trading signals for the last N bars of a symbol using a saved model.

    Body fields
    -----------
    symbol      : str  (required) — ticker to score
    n_bars      : int  (default 30) — how many recent bars to score
    timeframe   : str  (default inherits from model metadata)
    start       : str  (default "2018-01-01") — history start for feature construction
    end         : str  (default today)

    Returns
    -------
    {"model_id": ..., "symbol": ..., "signals": [{date, price, signal, probability, regime}]}
    """
    symbol: str | None = body.get("symbol")
    n_bars: int = int(body.get("n_bars", 30))
    end: str = body.get("end", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    start: str = body.get("start", "2018-01-01")

    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")
    if n_bars < 1 or n_bars > 500:
        raise HTTPException(status_code=400, detail="n_bars must be between 1 and 500")

    loop = asyncio.get_running_loop()

    # ── Load model + metadata ──────────────────────────────────────────────────
    try:
        clf, meta = await loop.run_in_executor(None, _load_model, model_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Model load failed: {exc}") from exc

    timeframe: str = body.get("timeframe", meta.get("timeframe", "1d"))
    feature_cols: list[str] = meta.get("feature_cols", [])
    target_horizon: int = int(meta.get("target_horizon", 5))

    if not feature_cols:
        raise HTTPException(status_code=500, detail="Model metadata missing feature_cols")

    # ── Build feature dataset ─────────────────────────────────────────────────
    try:
        df, _ = await loop.run_in_executor(
            None, _build_dataset, symbol, timeframe, start, end, target_horizon
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("signals dataset build failed")
        raise HTTPException(status_code=500, detail=f"Data preparation failed: {exc}") from exc

    # ── Align features with training schema ───────────────────────────────────
    missing_cols = [c for c in feature_cols if c not in df.columns]
    if missing_cols:
        raise HTTPException(
            status_code=422,
            detail=f"Dataset is missing features required by model: {missing_cols}",
        )

    X_score = df[feature_cols].tail(n_bars)
    close_tail = df["close"].reindex(X_score.index)

    # ── Score ──────────────────────────────────────────────────────────────────
    try:
        predictions = clf.predict(X_score)
        probabilities = clf.predict_proba(X_score)[:, 1]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc

    # ── Regime labels ──────────────────────────────────────────────────────────
    df_tail_full = df.tail(n_bars + 63)  # enough history for regime rolling window
    regime_series = _assign_regime(df_tail_full)
    regime_tail = regime_series.reindex(X_score.index).fillna("normal")

    # ── Build response rows ────────────────────────────────────────────────────
    signal_rows = []
    for date, price, signal, prob, regime in zip(
        X_score.index,
        close_tail.values,
        predictions,
        probabilities,
        regime_tail.values,
    ):
        signal_label = "BUY" if signal == 1 else "SELL"
        signal_rows.append(
            {
                "date": str(date.date()) if hasattr(date, "date") else str(date),
                "price": round(float(price), 4),
                "signal": signal_label,
                "probability": round(float(prob), 4),
                "regime": str(regime),
            }
        )

    return {
        "model_id": model_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "n_bars": len(signal_rows),
        "signals": signal_rows,
    }


@router.delete("/models/{model_id}")
async def delete_model(model_id: str) -> dict[str, str]:
    """
    Permanently delete a saved model and its metadata sidecar.
    """
    try:
        await asyncio.get_running_loop().run_in_executor(None, _delete_model, model_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Delete failed: {exc}") from exc

    return {"status": "deleted", "model_id": model_id}


@router.post("/compare")
async def compare_models(body: dict[str, Any]) -> dict[str, Any]:
    """
    Score two models on the same recent test window for the given symbol.

    Body fields
    -----------
    model_id_a  : str  (required)
    model_id_b  : str  (required)
    symbol      : str  (required) — ticker for the comparison window
    start       : str  (default "2022-01-01") — comparison window start
    end         : str  (default today)

    Returns
    -------
    Side-by-side metrics for both models plus per-row signal agreement rate.
    """
    model_id_a: str | None = body.get("model_id_a")
    model_id_b: str | None = body.get("model_id_b")
    symbol: str | None = body.get("symbol")
    start: str = body.get("start", "2022-01-01")
    end: str = body.get("end", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    if not model_id_a or not model_id_b:
        raise HTTPException(status_code=400, detail="model_id_a and model_id_b are required")
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")
    if model_id_a == model_id_b:
        raise HTTPException(status_code=400, detail="model_id_a and model_id_b must differ")

    loop = asyncio.get_running_loop()

    # ── Load both models ───────────────────────────────────────────────────────
    try:
        clf_a, meta_a = await loop.run_in_executor(None, _load_model, model_id_a)
        clf_b, meta_b = await loop.run_in_executor(None, _load_model, model_id_b)
    except HTTPException:
        raise

    # Use the shorter horizon to be conservative when building labels
    horizon_a = int(meta_a.get("target_horizon", 5))
    horizon_b = int(meta_b.get("target_horizon", 5))
    target_horizon = min(horizon_a, horizon_b)
    timeframe = meta_a.get("timeframe", "1d")  # must match for a fair comparison

    # ── Build shared dataset ───────────────────────────────────────────────────
    try:
        df, _ = await loop.run_in_executor(
            None, _build_dataset, symbol, timeframe, start, end, target_horizon
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Data build failed: {exc}") from exc

    y_true = df["target"]

    def _score_model(clf: RandomForestClassifier, feat_cols: list[str]) -> dict[str, Any]:
        missing = [c for c in feat_cols if c not in df.columns]
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"Dataset missing features: {missing}",
            )
        X = df[feat_cols]
        y_pred = clf.predict(X)
        y_prob = clf.predict_proba(X)[:, 1]
        try:
            auc = float(roc_auc_score(y_true, y_prob))
        except ValueError:
            auc = float("nan")
        return {
            "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
            "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
            "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
            "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
            "roc_auc": round(auc, 4),
            "predictions": y_pred.tolist(),
        }

    feat_a = meta_a.get("feature_cols", [])
    feat_b = meta_b.get("feature_cols", [])

    try:
        result_a = await loop.run_in_executor(None, _score_model, clf_a, feat_a)
        result_b = await loop.run_in_executor(None, _score_model, clf_b, feat_b)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Scoring failed: {exc}") from exc

    pred_a = result_a.pop("predictions")
    pred_b = result_b.pop("predictions")
    agreement_rate = float(np.mean(np.array(pred_a) == np.array(pred_b)))

    return {
        "symbol": symbol,
        "start": start,
        "end": end,
        "timeframe": timeframe,
        "comparison_samples": int(len(df)),
        "model_a": {
            "model_id": model_id_a,
            "trained_at": meta_a.get("trained_at"),
            "original_symbol": meta_a.get("symbol"),
            **result_a,
        },
        "model_b": {
            "model_id": model_id_b,
            "trained_at": meta_b.get("trained_at"),
            "original_symbol": meta_b.get("symbol"),
            **result_b,
        },
        "signal_agreement_rate": round(agreement_rate, 4),
        "winner_by_roc_auc": (
            model_id_a if result_a["roc_auc"] >= result_b["roc_auc"] else model_id_b
        ),
    }


# ── Decision support: promotion advice (Iteration 4) ─────────────────────────


@router.post("/promote-advice")
async def promote_advice(body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """
    Return a lightweight automated recommendation whether a paper deployment is ready to promote.

    Body fields
    -----------
    paper_deployment_id : str  (required)

    This endpoint intentionally uses simple, explainable heuristics for iteration 4:
    - ensures the deployment exists and is a paper deployment
    - reports whether it is running and how many days it has been running
    - looks for any recorded live-approval on the deployment
    - returns `recommend: true` if the checklist is complete and the deployment has run
    """
    paper_deployment_id: str | None = body.get("paper_deployment_id")
    if not paper_deployment_id:
        raise HTTPException(status_code=400, detail="paper_deployment_id is required")

    try:
        q = select(Deployment).options(selectinload(Deployment.approvals)).where(Deployment.id == paper_deployment_id)
        result = await db.execute(q)
        dep = result.scalar_one_or_none()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB query failed: {exc}") from exc

    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    if dep.mode != "paper":
        raise HTTPException(status_code=400, detail="Deployment is not a paper deployment")

    checks: dict[str, Any] = {
        "deployment_status": dep.status,
        "is_running": dep.status == "running",
        "is_paused": dep.status == "paused",
        "has_config_overrides": bool(dep.config_overrides),
    }
    reasons: list[str] = []

    if checks["is_running"]:
        reasons.append("Paper deployment is actively running")
    elif checks["is_paused"]:
        reasons.append("Paper deployment is paused and should be resumed or reviewed")
    else:
        reasons.append("Paper deployment is not actively running")

    all_approvals = list(getattr(dep, "approvals", []))
    paper_approval = next((a for a in all_approvals if a.to_mode == "paper"), None)
    live_approval = next((a for a in all_approvals if a.to_mode == "live"), None)
    checks["has_paper_approval"] = paper_approval is not None
    checks["has_live_approval"] = live_approval is not None
    checks["approval_count"] = len(all_approvals)

    live_checklist = dict(getattr(live_approval, "safety_checklist", {}) or {})
    # Keys must match those sent by the frontend promotion flow.
    required_live_checks = [
        "paper_performance_reviewed",
        "risk_limits_confirmed",
        "live_account_verified",
        "broker_connection_tested",
        "compliance_acknowledged",
    ]
    completed_live_checks = [key for key in required_live_checks if live_checklist.get(key)]
    checks["live_checklist_completed"] = len(completed_live_checks)
    checks["live_checklist_total"] = len(required_live_checks)
    checks["live_checklist_ready"] = len(completed_live_checks) == len(required_live_checks)

    if checks["has_live_approval"]:
        reasons.append("Independent live approval is recorded")
    else:
        reasons.append("No live approval has been recorded yet")

    if checks["live_checklist_ready"]:
        reasons.append("All live promotion checklist items are complete")
    elif live_approval:
        reasons.append("Live promotion checklist is only partially complete")
    else:
        reasons.append("Live promotion checklist has not been completed")

    days_running = None
    if dep.started_at:
        try:
            started = dep.started_at
            if getattr(started, "tzinfo", None) is None:
                started = started.replace(tzinfo=timezone.utc)
            days_running = int((datetime.now(timezone.utc) - started).days)
        except Exception:
            days_running = None
    checks["days_running"] = days_running

    if days_running is None:
        reasons.append("Paper deployment has not been started yet")
    else:
        reasons.append(f"Paper deployment has been running for {days_running} day(s)")

    recommend = bool(
        (checks["is_running"] or checks["is_paused"])
        and checks["live_checklist_ready"]
    )

    if checks["has_live_approval"]:
        recommend = recommend or checks["live_checklist_ready"]

    return {
        "deployment_id": dep.id,
        "recommend": bool(recommend),
        "reasons": reasons,
        "checks": checks,
    }
