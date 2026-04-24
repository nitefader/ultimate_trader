"""CerebroRegistry — tracks what every running program needs from the market."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from app.features.keys import make_feature_key
from app.features.planner import FeaturePlan, build_feature_plan
from app.features.specs import FeatureRequirement as CanonicalFeatureRequirement, FeatureSpec

logger = logging.getLogger(__name__)


@dataclass
class IndicatorRequirement:
    name: str        # "sma", "ema", "atr", "rsi", "macd", "bbands", "regime", etc.
    params: dict[str, Any] = field(default_factory=dict)     # {"period": 14}
    source: str = "close"

    def to_feature_spec(self, timeframe: str) -> FeatureSpec:
        return FeatureSpec(
            kind=self.name,
            timeframe=timeframe,
            source=self.source,
            params=dict(self.params),
        )


@dataclass
class ProgramDemand:
    program_id: str
    account_id: str
    symbols: set[str]
    timeframes: set[str]
    indicators: list[IndicatorRequirement]
    duration_mode: str   # intraday | day | swing
    registered_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_refreshed: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class SymbolTimeframeDemand:
    symbol: str
    timeframe: str
    programs_demanding: set[str] = field(default_factory=set)
    required_features: dict[str, CanonicalFeatureRequirement] = field(default_factory=dict)

    @property
    def required_indicators(self) -> list[IndicatorRequirement]:
        return [
            IndicatorRequirement(
                name=requirement.spec.kind,
                params=dict(requirement.spec.params),
                source=requirement.spec.source,
            )
            for requirement in self.required_features.values()
        ]

    @property
    def required_feature_keys(self) -> set[str]:
        return set(self.required_features.keys())


class CerebroRegistry:
    def __init__(self) -> None:
        self._demand_by_program: dict[str, ProgramDemand] = {}
        self._demand_by_symbol_tf: dict[tuple[str, str], SymbolTimeframeDemand] = {}
        self._reconcile_callback: Callable | None = None

    def set_reconcile_callback(self, cb: Callable) -> None:
        self._reconcile_callback = cb

    def register_program(self, program_id: str, demand: ProgramDemand) -> None:
        old = self._demand_by_program.get(program_id)
        if old:
            self._remove_program_from_index(program_id, old)
        self._demand_by_program[program_id] = demand
        self._add_program_to_index(program_id, demand)
        logger.info("CerebroRegistry: registered program %s symbols=%d tfs=%s",
                    program_id, len(demand.symbols), demand.timeframes)
        if self._reconcile_callback:
            self._reconcile_callback()

    def unregister_program(self, program_id: str) -> None:
        demand = self._demand_by_program.pop(program_id, None)
        if demand:
            self._remove_program_from_index(program_id, demand)
            logger.info("CerebroRegistry: unregistered program %s", program_id)
            if self._reconcile_callback:
                self._reconcile_callback()

    def update_program_symbols(self, program_id: str, new_symbols: set[str]) -> tuple[set[str], set[str]]:
        demand = self._demand_by_program.get(program_id)
        if not demand:
            return set(), set()
        old_symbols = demand.symbols.copy()
        added = new_symbols - old_symbols
        removed = old_symbols - new_symbols
        self._remove_program_from_index(program_id, demand)
        demand.symbols = new_symbols
        demand.last_refreshed = datetime.now(timezone.utc)
        self._add_program_to_index(program_id, demand)
        if (added or removed) and self._reconcile_callback:
            self._reconcile_callback()
        return added, removed

    def get_demand(self, symbol: str, timeframe: str) -> SymbolTimeframeDemand | None:
        return self._demand_by_symbol_tf.get((symbol.upper(), timeframe))

    def get_all_demanded_symbols(self) -> set[str]:
        return {sym for (sym, _) in self._demand_by_symbol_tf}

    def get_all_demanded_symbol_tfs(self) -> set[tuple[str, str]]:
        return set(self._demand_by_symbol_tf.keys())

    def get_active_symbols(self) -> set[str]:
        return self.get_all_demanded_symbols()

    def get_program_demand(self, program_id: str) -> ProgramDemand | None:
        return self._demand_by_program.get(program_id)

    def all_programs(self) -> dict[str, ProgramDemand]:
        return dict(self._demand_by_program)

    def get_required_feature_keys(self, symbol: str, timeframe: str) -> set[str]:
        demand = self.get_demand(symbol, timeframe)
        return demand.required_feature_keys if demand else set()

    def get_required_feature_specs(self, symbol: str, timeframe: str) -> list[FeatureSpec]:
        demand = self.get_demand(symbol, timeframe)
        if not demand:
            return []
        return [demand.required_features[key].spec for key in sorted(demand.required_features)]

    def get_program_feature_specs(self, program_id: str) -> list[FeatureSpec]:
        demand = self._demand_by_program.get(program_id)
        if not demand:
            return []
        specs: dict[str, FeatureSpec] = {}
        for timeframe in sorted(demand.timeframes):
            for indicator in demand.indicators:
                spec = indicator.to_feature_spec(timeframe)
                specs[make_feature_key(spec)] = spec
        return [specs[key] for key in sorted(specs)]

    def get_program_feature_plan(self, program_id: str) -> FeaturePlan | None:
        demand = self._demand_by_program.get(program_id)
        if not demand:
            return None
        return build_feature_plan(demand)

    def _add_program_to_index(self, program_id: str, demand: ProgramDemand) -> None:
        for symbol in demand.symbols:
            for tf in demand.timeframes:
                key = (symbol.upper(), tf)
                if key not in self._demand_by_symbol_tf:
                    self._demand_by_symbol_tf[key] = SymbolTimeframeDemand(symbol=symbol.upper(), timeframe=tf)
                stf = self._demand_by_symbol_tf[key]
                stf.programs_demanding.add(program_id)
                for ind in demand.indicators:
                    spec = ind.to_feature_spec(tf)
                    feature_key = make_feature_key(spec)
                    if feature_key not in stf.required_features:
                        stf.required_features[feature_key] = CanonicalFeatureRequirement(
                            spec=spec,
                            requested_by=program_id,
                        )

    def _remove_program_from_index(self, program_id: str, demand: ProgramDemand) -> None:
        for symbol in demand.symbols:
            for tf in demand.timeframes:
                key = (symbol.upper(), tf)
                stf = self._demand_by_symbol_tf.get(key)
                if stf:
                    stf.programs_demanding.discard(program_id)
                    if not stf.programs_demanding:
                        del self._demand_by_symbol_tf[key]
