"""IndicatorCache — rolling window indicator computation, shared across all programs."""
from __future__ import annotations

import asyncio
import logging
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import pandas as pd
from app.features.keys import make_feature_key, make_runtime_identity_key
from app.features.runtime_columns import resolve_runtime_columns
from app.features.source_contracts import FrameProvenance
from app.features.specs import FeatureSpec

logger = logging.getLogger(__name__)

WINDOW_SIZE = 250  # bars kept per symbol/timeframe — covers SMA200 + buffer


@dataclass
class IndicatorFrame:
    symbol: str
    timeframe: str
    bars: pd.DataFrame       # OHLCV + timestamp index
    indicators: pd.DataFrame # computed indicator columns, same index as bars
    last_bar_time: datetime
    last_computed: datetime
    bar_count: int
    is_warm: bool            # True once >= 50 bars loaded
    provenance: FrameProvenance | None = None
    feature_specs: tuple[FeatureSpec, ...] = ()
    feature_keys: tuple[str, ...] = ()
    feature_columns: dict[str, tuple[str, ...]] = field(default_factory=dict)
    runtime_identity_key: str = ""


class IndicatorCache:
    def __init__(self) -> None:
        # symbol → timeframe → deque of OHLCV dicts
        self._windows: dict[str, dict[str, deque]] = {}
        # symbol → timeframe → IndicatorFrame
        self._frames: dict[str, dict[str, IndicatorFrame]] = {}
        self._frames_by_runtime_identity: dict[str, IndicatorFrame] = {}
        # warm-up locks per (symbol, tf) to prevent race between cold-start and first bar
        self._warm_locks: dict[tuple[str, str], asyncio.Lock] = {}

    def _get_lock(self, symbol: str, tf: str) -> asyncio.Lock:
        key = (symbol.upper(), tf)
        if key not in self._warm_locks:
            self._warm_locks[key] = asyncio.Lock()
        return self._warm_locks[key]

    async def warm_up(
        self,
        symbol: str,
        timeframe: str,
        bars_df: pd.DataFrame,
        provenance: FrameProvenance | None = None,
        feature_specs: list[FeatureSpec] | None = None,
    ) -> None:
        sym = symbol.upper()
        async with self._get_lock(sym, timeframe):
            if sym not in self._windows:
                self._windows[sym] = {}
            window = deque(maxlen=WINDOW_SIZE)
            for ts, row in bars_df.tail(WINDOW_SIZE).iterrows():
                window.append({
                    "timestamp": ts,
                    "open": float(row.get("open", 0)),
                    "high": float(row.get("high", 0)),
                    "low": float(row.get("low", 0)),
                    "close": float(row.get("close", 0)),
                    "volume": float(row.get("volume", 0)),
                })
            self._windows[sym][timeframe] = window
            frame = self._build_frame(sym, timeframe, window, provenance=provenance, feature_specs=feature_specs)
            if sym not in self._frames:
                self._frames[sym] = {}
            self._frames[sym][timeframe] = frame
            self._index_frame(frame)
            logger.info("IndicatorCache: warmed %s/%s with %d bars (warm=%s)",
                        sym, timeframe, len(window), frame.is_warm)

    async def update(self, symbol: str, timeframe: str, bar: dict, source: str = "runtime_bar") -> IndicatorFrame | None:
        sym = symbol.upper()
        async with self._get_lock(sym, timeframe):
            if sym not in self._windows or timeframe not in self._windows[sym]:
                self._windows.setdefault(sym, {})[timeframe] = deque(maxlen=WINDOW_SIZE)
            self._windows[sym][timeframe].append(bar)
            current_frame = self._frames.get(sym, {}).get(timeframe)
            provenance = current_frame.provenance.with_continuation(source) if current_frame and current_frame.provenance else None
            frame = self._build_frame(
                sym,
                timeframe,
                self._windows[sym][timeframe],
                provenance=provenance,
                feature_specs=list(current_frame.feature_specs) if current_frame else None,
            )
            self._frames.setdefault(sym, {})[timeframe] = frame
            self._index_frame(frame, previous_identity_key=current_frame.runtime_identity_key if current_frame else None)
            return frame

    def get(self, symbol: str, timeframe: str) -> IndicatorFrame | None:
        sym = symbol.upper()
        frames = self._frames.get(sym)
        if not frames:
            return None
        return frames.get(timeframe)

    def get_by_runtime_identity(self, runtime_identity_key: str) -> IndicatorFrame | None:
        return self._frames_by_runtime_identity.get(runtime_identity_key)

    def annotate_feature_keys(self, symbol: str, timeframe: str, feature_keys: set[str]) -> IndicatorFrame | None:
        frame = self.get(symbol, timeframe)
        if frame is None:
            return None
        ordered_keys = tuple(sorted(feature_keys))
        next_identity_key = make_runtime_identity_key(frame.symbol, frame.timeframe, ordered_keys)
        if frame.feature_keys == ordered_keys and frame.runtime_identity_key == next_identity_key:
            return frame
        previous_identity_key = frame.runtime_identity_key
        if not ordered_keys:
            frame.feature_specs = ()
            frame.feature_columns = {}
        frame.feature_keys = ordered_keys
        frame.runtime_identity_key = next_identity_key
        self._index_frame(frame, previous_identity_key=previous_identity_key)
        return frame

    def annotate_feature_specs(self, symbol: str, timeframe: str, feature_specs: list[FeatureSpec]) -> IndicatorFrame | None:
        frame = self.get(symbol, timeframe)
        if frame is None:
            return None
        ordered_specs = tuple(sorted(feature_specs, key=make_feature_key))
        mapping = {
            make_feature_key(spec): resolve_runtime_columns(spec)
            for spec in ordered_specs
        }
        next_feature_keys = tuple(sorted(mapping))
        next_identity = make_runtime_identity_key(frame.symbol, frame.timeframe, next_feature_keys)
        if (
            frame.feature_specs == ordered_specs
            and frame.feature_columns == mapping
            and frame.runtime_identity_key == next_identity
        ):
            return frame

        window = self._windows.get(symbol.upper(), {}).get(timeframe)
        if window is None:
            return frame

        rebuilt = self._build_frame(
            symbol.upper(),
            timeframe,
            window,
            provenance=frame.provenance,
            feature_specs=list(ordered_specs),
        )
        rebuilt.feature_specs = ordered_specs
        rebuilt.feature_columns = mapping
        rebuilt.feature_keys = next_feature_keys
        rebuilt.runtime_identity_key = next_identity
        self._frames.setdefault(symbol.upper(), {})[timeframe] = rebuilt
        self._index_frame(rebuilt, previous_identity_key=frame.runtime_identity_key)
        return rebuilt

    def evict(self, symbol: str, timeframe: str | None = None) -> None:
        sym = symbol.upper()
        if timeframe:
            frame = self._frames.get(sym, {}).get(timeframe)
            if frame is not None:
                self._frames_by_runtime_identity.pop(frame.runtime_identity_key, None)
            self._windows.get(sym, {}).pop(timeframe, None)
            self._frames.get(sym, {}).pop(timeframe, None)
        else:
            for frame in self._frames.get(sym, {}).values():
                self._frames_by_runtime_identity.pop(frame.runtime_identity_key, None)
            self._windows.pop(sym, None)
            self._frames.pop(sym, None)
        logger.debug("IndicatorCache: evicted %s/%s", sym, timeframe or "*")

    def _index_frame(self, frame: IndicatorFrame, previous_identity_key: str | None = None) -> None:
        if previous_identity_key and previous_identity_key != frame.runtime_identity_key:
            self._frames_by_runtime_identity.pop(previous_identity_key, None)
        self._frames_by_runtime_identity[frame.runtime_identity_key] = frame

    def _build_frame(
        self,
        symbol: str,
        timeframe: str,
        window: deque,
        provenance: FrameProvenance | None = None,
        feature_specs: list[FeatureSpec] | None = None,
    ) -> IndicatorFrame:
        if not window:
            empty = pd.DataFrame()
            return IndicatorFrame(symbol, timeframe, empty, empty,
                                  datetime.now(timezone.utc), datetime.now(timezone.utc), 0, False, provenance)
        bars_df = pd.DataFrame(list(window))
        timestamp_index = pd.DatetimeIndex(pd.to_datetime(bars_df["timestamp"], utc=True)).tz_convert(None)
        bars_df = bars_df.drop(columns=["timestamp"]).set_index(timestamp_index)
        bars_df.index.name = "timestamp"
        bars_df = bars_df.rename(columns={"open": "open", "high": "high",
                                          "low": "low", "close": "close", "volume": "volume"})

        indicators_df = self._compute_indicators(symbol, bars_df, feature_specs=feature_specs)
        last_bar_time = bars_df.index[-1].to_pydatetime() if len(bars_df) > 0 else datetime.now(timezone.utc)
        is_warm = len(window) >= 50
        ordered_specs = tuple(sorted(feature_specs or [], key=make_feature_key))
        feature_columns = {
            make_feature_key(spec): resolve_runtime_columns(spec)
            for spec in ordered_specs
        }
        feature_keys = tuple(sorted(feature_columns))

        return IndicatorFrame(
            symbol=symbol,
            timeframe=timeframe,
            bars=bars_df,
            indicators=indicators_df,
            last_bar_time=last_bar_time,
            last_computed=datetime.now(timezone.utc),
            bar_count=len(window),
            is_warm=is_warm,
            provenance=provenance,
            feature_specs=ordered_specs,
            feature_keys=feature_keys,
            feature_columns=feature_columns,
            runtime_identity_key=make_runtime_identity_key(symbol, timeframe, feature_keys),
        )

    def _compute_indicators(
        self,
        symbol: str,
        bars_df: pd.DataFrame,
        feature_specs: list[FeatureSpec] | None = None,
    ) -> pd.DataFrame:
        try:
            from app.core.backtest import BacktestEngine
            engine = BacktestEngine({}, {})
            if feature_specs:
                engine._required_indicator_refs = {
                    column
                    for spec in feature_specs
                    for column in resolve_runtime_columns(spec)
                }
            return engine._compute_indicators(bars_df, symbol=symbol)
        except Exception as exc:
            logger.warning("IndicatorCache: indicator computation failed: %s", exc)
            return pd.DataFrame(index=bars_df.index)
