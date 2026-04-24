"""CerebroEngine — central market data and indicator orchestration engine."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from app.cerebro.bar_aggregator import BarAggregator
from app.cerebro.indicator_cache import IndicatorCache, IndicatorFrame
from app.features.cache import FeatureCache
from app.features.frame import FeatureFrame
from app.features.source_contracts import make_warmup_provenance, resolve_warmup_source_contract
from app.cerebro.registry import CerebroRegistry, IndicatorRequirement, ProgramDemand
from app.features.planner import FeaturePlan
from app.services.market_data_bus import BarEvent

logger = logging.getLogger(__name__)

_COLD_START_DAYS: dict[str, int] = {
    "1m":  3,    # 3 days of 1Min bars (~1170 bars, > 250 window)
    "5m":  10,
    "15m": 20,
    "30m": 40,
    "1h":  80,
    "1d":  400,  # ~400 trading days for SMA200 + buffer
}
_COLD_START_CONCURRENCY = 8


class CerebroEngine:
    def __init__(self) -> None:
        self.registry = CerebroRegistry()
        self.indicator_cache = IndicatorCache()
        self.feature_cache = FeatureCache(self.indicator_cache)
        self.bar_aggregator = BarAggregator()
        self._running = False
        # program_id → async callback(IndicatorFrame)
        self._frame_callbacks: dict[str, Callable[[IndicatorFrame], Awaitable[None]]] = {}
        # program_id → async callback(dict news_event)
        self._news_callbacks: dict[str, Callable[[dict], Awaitable[None]]] = {}
        self._reconcile_scheduled = False
        self.registry.set_reconcile_callback(self._schedule_reconcile)

    async def start(self, api_key: str = "", secret_key: str = "", runtime_mode: str = "paper") -> None:
        self._running = True
        self._api_key = api_key
        self._secret_key = secret_key
        self._runtime_mode = runtime_mode
        await self._cold_start_all()
        logger.info("CerebroEngine: started")

    async def stop(self) -> None:
        self._running = False
        logger.info("CerebroEngine: stopped")

    async def subscribe_program(
        self,
        program_id: str,
        account_id: str,
        symbols: set[str],
        timeframes: set[str],
        indicators: list[dict] | None = None,
        duration_mode: str = "day",
        frame_callback: Callable[[IndicatorFrame], Awaitable[None]] | None = None,
        news_callback: Callable[[dict], Awaitable[None]] | None = None,
    ) -> None:
        ind_reqs = [IndicatorRequirement(name=i["name"], params=i.get("params", {}), source=i.get("source", "close"))
                    for i in (indicators or [])]
        demand = ProgramDemand(
            program_id=program_id,
            account_id=account_id,
            symbols={s.upper() for s in symbols},
            timeframes=timeframes,
            indicators=ind_reqs,
            duration_mode=duration_mode,
        )
        self.registry.register_program(program_id, demand)
        if frame_callback:
            self._frame_callbacks[program_id] = frame_callback
        if news_callback:
            self._news_callbacks[program_id] = news_callback

        # Warm up any new symbols not yet in cache
        new_sym_tfs = {(s.upper(), tf) for s in symbols for tf in timeframes
                       if self.indicator_cache.get(s.upper(), tf) is None}
        if new_sym_tfs:
            await self._cold_start_symbols(list(new_sym_tfs))
        for symbol in symbols:
            for timeframe in timeframes:
                self._annotate_runtime_feature_identity(symbol, timeframe)

        self.bar_aggregator.set_demanded_timeframes(
            {tf for (_, tf) in self.registry.get_all_demanded_symbol_tfs()} - {"1m"}
        )
        logger.info("CerebroEngine: subscribed program %s symbols=%d", program_id, len(symbols))

    async def unsubscribe_program(self, program_id: str) -> None:
        demand = self.registry.get_program_demand(program_id)
        if demand:
            self.registry.unregister_program(program_id)
            # Evict symbols no longer demanded by anyone
            for sym in demand.symbols:
                for tf in demand.timeframes:
                    if not self.registry.get_demand(sym, tf):
                        self.indicator_cache.evict(sym, tf)
        self._frame_callbacks.pop(program_id, None)
        self._news_callbacks.pop(program_id, None)

    async def update_program_symbols(self, program_id: str, new_symbols: set[str]) -> None:
        added, removed = self.registry.update_program_symbols(
            program_id, {s.upper() for s in new_symbols}
        )
        demand = self.registry.get_program_demand(program_id)
        if added and demand:
            new_sym_tfs = [(s, tf) for s in added for tf in demand.timeframes]
            await self._cold_start_symbols(new_sym_tfs)
        for sym in removed:
            if sym not in self.registry.get_all_demanded_symbols():
                for tf in (demand.timeframes if demand else set()):
                    self.indicator_cache.evict(sym, tf)
            elif demand:
                for tf in demand.timeframes:
                    self._annotate_runtime_feature_identity(sym, tf)

    def get_indicator_frame(self, symbol: str, timeframe: str) -> IndicatorFrame | None:
        frame = self.indicator_cache.get(symbol.upper(), timeframe)
        if frame and not frame.is_warm:
            logger.debug("CerebroEngine: %s/%s cache not yet warm (%d bars)",
                         symbol, timeframe, frame.bar_count)
        return frame

    def get_feature_frame(self, symbol: str, timeframe: str) -> FeatureFrame | None:
        return self.feature_cache.get_feature_frame(symbol.upper(), timeframe)

    def get_feature_frame_by_identity(self, runtime_identity_key: str) -> FeatureFrame | None:
        return self.feature_cache.get_feature_frame_by_identity(runtime_identity_key)

    def get_program_feature_plan(self, program_id: str) -> FeaturePlan | None:
        return self.registry.get_program_feature_plan(program_id)

    def _annotate_runtime_feature_identity(self, symbol: str, timeframe: str) -> None:
        specs = self.registry.get_required_feature_specs(symbol, timeframe)
        if specs:
            self.indicator_cache.annotate_feature_specs(symbol, timeframe, specs)
        else:
            self.indicator_cache.annotate_feature_keys(symbol, timeframe, set())

    async def on_bar(self, bar: BarEvent) -> None:
        if not self._running:
            return
        completed_bars = self.bar_aggregator.ingest(bar)
        for completed in completed_bars:
            frame = await self.indicator_cache.update(
                completed.symbol, completed.timeframe,
                {
                    "timestamp": completed.timestamp,
                    "open": completed.open,
                    "high": completed.high,
                    "low": completed.low,
                    "close": completed.close,
                    "volume": completed.volume,
                },
                source="alpaca_stream",
            )
            if frame:
                self._annotate_runtime_feature_identity(completed.symbol, completed.timeframe)
                await self._dispatch_frame(completed.symbol, completed.timeframe, frame)

    async def emit_news_event(self, news_event: dict) -> None:
        symbols_mentioned = {s.upper() for s in news_event.get("symbols_mentioned", [])}
        active = self.registry.get_active_symbols()
        relevant_symbols = symbols_mentioned & active
        if not relevant_symbols:
            return
        relevant_programs: set[str] = set()
        for sym in relevant_symbols:
            for demand in self.registry.all_programs().values():
                if sym in demand.symbols:
                    relevant_programs.add(demand.program_id)
        news_event["relevant_program_ids"] = list(relevant_programs)
        for pid in relevant_programs:
            cb = self._news_callbacks.get(pid)
            if cb:
                try:
                    await cb(news_event)
                except Exception as exc:
                    logger.warning("CerebroEngine: news callback error for %s: %s", pid, exc)

    async def _dispatch_frame(self, symbol: str, timeframe: str, frame: IndicatorFrame) -> None:
        demand = self.registry.get_demand(symbol, timeframe)
        if not demand:
            return
        for pid in list(demand.programs_demanding):
            cb = self._frame_callbacks.get(pid)
            if cb:
                try:
                    await cb(frame)
                except Exception as exc:
                    logger.warning("CerebroEngine: frame callback error for %s: %s", pid, exc)

    def _schedule_reconcile(self) -> None:
        if not self._reconcile_scheduled:
            self._reconcile_scheduled = True
            try:
                loop = asyncio.get_event_loop()
                loop.call_soon(self._do_reconcile)
            except RuntimeError:
                self._reconcile_scheduled = False

    def _do_reconcile(self) -> None:
        self._reconcile_scheduled = False
        self._sync_stream_subscriptions()

    def _sync_stream_subscriptions(self) -> None:
        try:
            from app.services.alpaca_stream_manager import get_alpaca_stream_manager
            demanded = self.registry.get_all_demanded_symbols()
            logger.debug("CerebroEngine: reconciling stream — %d symbols demanded", len(demanded))
        except Exception as exc:
            logger.warning("CerebroEngine: stream reconcile error: %s", exc)

    async def _cold_start_all(self) -> None:
        sym_tfs = list(self.registry.get_all_demanded_symbol_tfs())
        if sym_tfs:
            await self._cold_start_symbols(sym_tfs)

    async def _cold_start_symbols(self, sym_tfs: list[tuple[str, str]]) -> None:
        sem = asyncio.Semaphore(_COLD_START_CONCURRENCY)

        async def _warm_one(sym: str, tf: str) -> None:
            async with sem:
                try:
                    from app.services.market_data_service import fetch_market_data
                    from datetime import date, timedelta
                    contract = resolve_warmup_source_contract(
                        runtime_mode=self._runtime_mode,
                        alpaca_credentials_configured=bool(self._api_key and self._secret_key),
                    )
                    days = _COLD_START_DAYS.get(tf, 400)
                    end = date.today().isoformat()
                    start = (date.today() - timedelta(days=days)).isoformat()
                    df = await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: fetch_market_data(
                            symbol=sym, timeframe=tf, start=start, end=end,
                            provider=contract.selected_provider, api_key=self._api_key,
                            secret_key=self._secret_key,
                        )
                    )
                    if df is not None and not df.empty:
                        await self.indicator_cache.warm_up(
                            sym,
                            tf,
                            df,
                            provenance=make_warmup_provenance(contract),
                        )
                        self._annotate_runtime_feature_identity(sym, tf)
                except Exception as exc:
                    logger.warning("CerebroEngine: cold-start failed for %s/%s: %s", sym, tf, exc)

        tasks = [_warm_one(sym, tf) for (sym, tf) in sym_tfs]
        await asyncio.gather(*tasks)
        logger.info("CerebroEngine: cold-start complete for %d symbol/tf pairs", len(sym_tfs))


# ── Singleton ─────────────────────────────────────────────────────────────────

_cerebro: CerebroEngine | None = None
_cerebro_lock = asyncio.Lock()


async def get_cerebro_engine() -> CerebroEngine:
    global _cerebro
    async with _cerebro_lock:
        if _cerebro is None:
            _cerebro = CerebroEngine()
        return _cerebro
