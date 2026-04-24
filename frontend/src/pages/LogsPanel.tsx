import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { controlApi } from '../api/accounts'
import { adminApi } from '../api/admin'
import type { UserJourneyValidationsResponse } from '../types'
import { usePollingGate } from '../hooks/usePollingGate'
import { SelectMenu } from '../components/SelectMenu'
import { Tooltip } from '../components/Tooltip'
import clsx from 'clsx'
import {
  Shield, RefreshCw, CheckCircle2, Clock3, AlertTriangle, Circle,
  ChevronDown, ChevronRight, Layers, Zap, BarChart2, BookOpen,
  Target, Play, Cpu, Map, Lock, FileText, Bot, ExternalLink,
} from 'lucide-react'

type LogsTab = 'events' | 'roadmap' | 'journeys' | 'issues' | 'feature_build'
type StepStatus = 'complete' | 'active' | 'pending' | 'blocked'
type PhaseStatus = 'complete' | 'active' | 'pending'
type IssueSeverity = 'critical' | 'high' | 'medium'

// ─── Roadmap Data ────────────────────────────────────────────────────────────

interface RoadmapStep {
  id: string
  title: string
  detail: string
  status: StepStatus
  exitGate?: string
}

interface RoadmapSubphase {
  id: string
  title: string
  description: string
  status: PhaseStatus
  steps: RoadmapStep[]
  exitGate: string
}

interface RoadmapPhase {
  id: string
  number: number
  title: string
  theme: string
  icon: React.ReactNode
  status: PhaseStatus
  subphases: RoadmapSubphase[]
}

const PHASES: RoadmapPhase[] = [
  {
    id: 'P1',
    number: 1,
    title: 'Foundation + Architecture',
    theme: 'Data models, optimizer framework, audit lineage, runtime integrity',
    icon: <Layers size={15} />,
    status: 'complete',
    subphases: [
      {
        id: 'P1.SP1',
        title: 'Plan + Pre-ARB',
        description: 'Lock architecture, data models, and gate registry before any code is written.',
        status: 'complete',
        exitGate: 'Pre-architecture review board sign-off recorded.',
        steps: [
          { id: 'P1-S1', title: 'Lock canonical layer stack', detail: 'Watchlist → StrategyVersion → ValidationEvidence → OptimizationProfile → SymbolUniverse → WeightProfile → TradingProgram → AccountAllocation → ExecutionPolicy → Order. Immutability rules confirmed.', status: 'complete' },
          { id: 'P1-S2', title: 'Define optimizer framework interfaces', detail: 'OptimizerEngine (Protocol), ObjectiveFunction, CovarianceModel, ConstraintSet, ValidationEvidence, WeightProfile — all frozen dataclasses. Phase 1 engines: EqualWeight, CappedInverseVol, SimpleShrinkageMV.', status: 'complete' },
          { id: 'P1-S3', title: 'Define duration modes', detail: 'duration_mode: DAY | SWING | POSITION on StrategyVersion. Each mode specifies data cadence, risk model, optimizer objective, liquidation rule, and PDT applicability.', status: 'complete' },
          { id: 'P1-S4', title: 'Define watchlist membership lifecycle', detail: 'States: CANDIDATE → ACTIVE → PENDING_REMOVAL → INACTIVE. ACTIVE → SUSPENDED (manual only). min_dwell_seconds=300, reentry_cooldown_seconds=900. TTL default 86400s.', status: 'complete' },
          { id: 'P1-S5', title: 'Audit lineage spec', detail: 'client_order_id = f"{deployment_id}_{uuid4().hex[:8]}". Every Order joins to AccountAllocation → TradingProgram → all layers. Fully reconstructable from one join chain.', status: 'complete' },
          { id: 'P1-S6', title: 'Gate registry and acceptance criteria', detail: 'Build / Functional / Integration / UX / Data / Trading Logic / Safety / Verification / Roadmap gates defined. Each phase has an explicit exit gate.', status: 'complete' },
        ],
      },
      {
        id: 'P1.SP2',
        title: 'Runtime Integrity',
        description: 'Deterministic startup, health checks, kill switch enforcement, control-plane readiness.',
        status: 'complete',
        exitGate: 'Build and verification gates green with reproducible startup.',
        steps: [
          { id: 'P1-S7', title: 'Normalize startup process ownership', detail: 'Backend uvicorn + frontend Vite start deterministically. No port conflicts. Health endpoints /health and /api/health return 200 with uptime.', status: 'complete' },
          { id: 'P1-S8', title: 'Kill switch + resume integrity', detail: 'KillSwitch.kill_account() / unkill_account() verified. Resume endpoint calls unkill_account() (not resume_account()). onError surfaced in AccountMonitor.', status: 'complete' },
          { id: 'P1-S9', title: 'CASH vs MARGIN account mode', detail: 'account_mode: CASH | MARGIN on AccountAllocation. CASH: no shorts, no leverage, T+1 settlement, PDTState not instantiated. Separate code paths enforced.', status: 'complete' },
          { id: 'P1-S10', title: 'PDT enforcement at AccountAllocation', detail: 'PDTState { day_trades_used, window_trades[] } on MARGIN sub-$25k accounts. Hard block at 3/3 before DAY-mode program submits. Rolling 5-session window.', status: 'complete' },
        ],
      },
    ],
  },
  {
    id: 'P2',
    number: 2,
    title: 'Data Layer',
    theme: 'Provider abstraction, Parquet cache, watchlist materialization, MarketMetadata snapshots',
    icon: <BarChart2 size={15} />,
    status: 'complete',
    subphases: [
      {
        id: 'P2.SP1',
        title: 'Provider + Cache Core',
        description: 'Data provider abstraction, Parquet cache, fetch/augment/delete lifecycle.',
        status: 'complete',
        exitGate: 'Data gate passes with no corruption or duplicate drift.',
        steps: [
          { id: 'P2-S1', title: 'BrokerProtocol + provider abstraction', detail: 'InternalPaperBroker and AlpacaBroker both implement BrokerProtocol. SQLite Parquet cache with freshness + dedupe policy.', status: 'complete' },
          { id: 'P2-S2', title: 'MarketMetadata nightly snapshot', detail: 'Versioned metadata_version_id snapshot: GICS sector tags, benchmark mappings, 60-day rolling correlation base. WeightProfile stores metadata_version_id used at fit time.', status: 'complete' },
          { id: 'P2-S3', title: 'Scanner watchlist backend jobs', detail: 'refresh_cron field (min 5-min interval) on scanner watchlists. Jobs persist to watchlist_membership table with resolved_at. API now supports create/list/detail/refresh with server-side membership materialization only.', status: 'complete' },
          { id: 'P2-S4', title: 'Symbol membership lifecycle enforcement', detail: 'CANDIDATE dwell timer, ACTIVE TTL, PENDING_REMOVAL grace (1hr), INACTIVE cooldown, SUSPENDED manual override. min_dwell + reentry_cooldown prevent thrash.', status: 'complete' },
        ],
      },
      {
        id: 'P2.SP2',
        title: 'Alpaca Streaming Pipeline',
        description: 'AlpacaStreamManager, DataBus, per-deployment bar routing, dynamic universe resubscription.',
        status: 'complete',
        exitGate: 'Streaming bars flow to all active deployments; universe rebalance re-subscriptions verified.',
        steps: [
          { id: 'P2-S5', title: 'AlpacaStreamManager singleton', detail: 'run_forever() added: persistent loop with exponential-backoff reconnect (1s→60s cap). stop() signals graceful exit. reconnect_attempts tracked. Credentials checked before each attempt. Existing auth/subscribe/reconcile/publish_bar chain unchanged.', status: 'complete' },
          { id: 'P2-S6', title: 'DataBus broadcast to DeploymentRunner', detail: 'Kill switch wired into publish_bar(): global kill drops all bars; account-level kill skips per-deployment delivery. account_id stored per deployment at register_runner time. register_runner() updated in both AlpacaStreamManager and InMemoryMarketDataBus to accept account_id.', status: 'complete' },
          { id: 'P2-S7', title: 'Earnings exclusion integration', detail: 'EarningsCalendar singleton (backend/app/services/earnings_calendar.py). add_event/add_events_bulk/is_excluded/clear_before. refresh_from_alpaca() fetches News API articles tagged with earnings. Wired into BacktestEngine._process_entries() — skips entries in exclusion window (days_before=3, days_after=1). Open positions unaffected.', status: 'complete' },
          { id: 'P2-S8', title: 'Virtual position ledger via client_order_id', detail: 'position_ledger.py: make_client_order_id(), extract_deployment_id(), FillEvent, DeploymentLedger (FIFO cost-basis), GlobalFillRouter singleton (get_fill_router()). Routes Alpaca trade_updates fills to correct deployment via client_order_id prefix. FIFO realized P&L per symbol.', status: 'complete' },
        ],
      },
    ],
  },
  {
    id: 'P3',
    number: 3,
    title: 'Strategy Registry',
    theme: 'Versioned strategy catalog, indicator engine, signal logic, duration-aware validation',
    icon: <BookOpen size={15} />,
    status: 'complete',
    subphases: [
      {
        id: 'P3.SP1',
        title: 'Indicator Engine',
        description: 'Full indicator library, typed IndicatorSpec, regime vectorization fixes.',
        status: 'complete',
        exitGate: 'All indicators produce correct output; regime.py vectorized; no double-merge in support_resistance.',
        steps: [
          { id: 'P3-S1', title: 'Fix regime.py vectorization', detail: 'Replace row loop (for i in range(len(df))) with np.where chains. Performance and correctness fix.', status: 'complete' },
          { id: 'P3-S2', title: 'Fix support_resistance.py double merge', detail: 'Remove duplicate _merge_zones pass. Single merge pass only.', status: 'complete' },
          { id: 'P3-S3', title: 'Fix FairValueGap quality_score', detail: 'Normalize FairValueGap.quality_score by ATR instead of raw gap size.', status: 'complete' },
          { id: 'P3-S4', title: 'Add Hull MA, Donchian, Ichimoku, Fractals', detail: 'Add to technical.py. All produce typed output compatible with IndicatorSpec union.', status: 'complete' },
          { id: 'P3-S5', title: 'Typed IndicatorSpec union', detail: 'Add typed IndicatorSpec union to types/index.ts. Frontend and backend share contract.', status: 'complete' },
        ],
      },
      {
        id: 'P3.SP2',
        title: 'Strategy CRUD + Versioning',
        description: 'Create, list, update, clone strategies. duration_mode on StrategyVersion. Immutability after optimization.',
        status: 'complete',
        exitGate: 'Strategy contracts and version lifecycle verified. StrategyVersion immutable once optimized.',
        steps: [
          { id: 'P3-S6', title: 'StrategyVersion model + duration_mode', detail: 'duration_mode: DAY | SWING | POSITION. StrategyVersion immutable once any OptimizationProfile references it.', status: 'complete' },
          { id: 'P3-S7', title: 'Strategy CRUD endpoints', detail: 'Create, list, detail, update, clone, soft-delete. Bootstrap idempotency confirmed.', status: 'complete' },
          { id: 'P3-S8', title: 'NLP → strategy contract', detail: 'NLP payload maps to valid StrategyVersion DSL. Explainability output required. Output validated against IndicatorSpec union.', status: 'complete' },
        ],
      },
    ],
  },
  {
    id: 'P4',
    number: 4,
    title: 'Backtest Engine',
    theme: 'Async lifecycle, Parquet replay, walk-forward, CPCV, ValidationEvidence',
    icon: <Play size={15} />,
    status: 'complete',
    subphases: [
      {
        id: 'P4.SP1',
        title: 'Async Execution + Analytics',
        description: 'ARQ task queue, bar-close signals, next-open fills, slippage+commission, no lookahead bias.',
        status: 'complete',
        exitGate: 'Trading logic gate passes: no lookahead bias, metrics and trade logs are truthful.',
        steps: [
          { id: 'P4-S1', title: 'ARQ task queue + async backtest lifecycle', detail: 'Launch, observe, and verify backtest jobs. States: queued → running → complete | failed. Parquet cache used for bar replay.', status: 'complete' },
          { id: 'P4-S2', title: 'SessionWindowConfig', detail: 'Model created (backend/app/models/session_window.py). Wired into BacktestEngine: can_enter() gates _process_entries(), should_close_positions() + should_liquidate_all() gate _process_exits(). Fixed critical dead-code bug in _process_entries where stop/sizing/open_position logic was unreachable — all trades were silently dropped.', status: 'complete' },
          { id: 'P4-S3', title: 'Dynamic universe replay in backtest', detail: 'UniverseSnapshot + UniverseSchedule created (backend/app/models/universe_snapshot.py). run_config["universe_schedule"] drives point-in-time filtering per bar date. Exits always processed regardless of universe membership. Binary search resolver O(log n). Survivorship bias prevented.', status: 'complete' },
          { id: 'P4-S4', title: 'Metrics + trade log verification', detail: 'Audited reporting.py. Fixed: trade stats now computed from closed_trades only (net_pnl + exit_price not None). Previously None net_pnl trades were counted as 0, inflating trade count and deflating win rate. Sharpe from equity curve bar returns (correct). Expectancy is dollar-denominated — documented. Monte Carlo uses closed trade P&Ls only.', status: 'complete' },
        ],
      },
      {
        id: 'P4.SP2',
        title: 'Validation Evidence + CPCV',
        description: 'CPCV before walk-forward. ValidationEvidence as separate immutable object. IS/OOS degradation tracking.',
        status: 'complete',
        exitGate: 'ValidationEvidence produced for every completed backtest. CPCV results stored per fold.',
        steps: [
          { id: 'P4-S5', title: 'CPCV implementation', detail: 'Combinatorial Purged Cross-Validation implemented as the primary overfitting guard before walk-forward. Payload now persists CPCV folds, aggregate OOS Sharpe/degradation stats, primary-guard pass/fail, and train-only parameter locking details.', status: 'complete' },
          { id: 'P4-S6', title: 'Walk-forward validation', detail: 'Walk-forward now runs as the secondary guard after CPCV selection and is persisted with stitched OOS folds, anti-bias checks, and degradation tracking for each completed run.', status: 'complete' },
          { id: 'P4-S7', title: 'ValidationEvidence model', detail: 'ValidationEvidence model added as a separate per-run evidence record. Stores CPCV payload, walk-forward payload, anti-bias state, regime_performance, per_symbol_oos_sharpe, cost_sensitivity_curve, is_oos_degradation_ratio, and stability_score.', status: 'complete' },
          { id: 'P4-S8', title: 'Transaction cost sensitivity curve', detail: 'Cost sensitivity curve now stores Sharpe/return across slippage-bps scenarios inside ValidationEvidence so fragile strategies can be identified before deployment review.', status: 'complete' },
        ],
      },
    ],
  },
  {
    id: 'P5',
    number: 5,
    title: 'Optimizer Engine',
    theme: 'Pluggable optimizer framework, WeightProfile lineage, Phase 1 engine implementations',
    icon: <Cpu size={15} />,
    status: 'complete',
    subphases: [
      {
        id: 'P5.SP1',
        title: 'Optimizer Framework + Phase 1 Engines',
        description: 'OptimizerEngine protocol, ObjectiveFunction, CovarianceModel, ConstraintSet. Phase 1: EqualWeight, CappedInverseVol, SimpleShrinkageMV.',
        status: 'complete',
        exitGate: 'All three Phase 1 engines produce versioned WeightProfile with full lineage. Framework extensible for Phase 2 without breaking changes.',
        steps: [
          { id: 'P5-S1', title: 'OptimizerEngine protocol', detail: 'OptimizerEngine (Protocol), OptimizerRegistry, ObjectiveFunction, CovarianceModel, ConstraintSet all implemented in optimizer_framework.py. Registry keyed by (engine_id, version). create_weight_profile() persists full lineage.', status: 'complete' },
          { id: 'P5-S2', title: 'EqualWeightOptimizer', detail: 'Implemented: 1/N weights, validation floor applied, _normalize_weights() with iterative cap enforcement. Registered in optimizer_registry.', status: 'complete' },
          { id: 'P5-S3', title: 'CappedInverseVolOptimizer', detail: 'Implemented: weight ∝ 1/σ using realized_vol_30d from metadata_by_symbol. Fallback to 1.0 when vol missing. Registered.', status: 'complete' },
          { id: 'P5-S4', title: 'SimpleShrinkageMVOptimizer', detail: 'Implemented: diagonal shrinkage proxy, correlation penalty (1 + avg_pairwise_correlation). Registered. Full constraint set enforced via _normalize_weights.', status: 'complete' },
          { id: 'P5-S5', title: 'WeightProfile versioned output', detail: 'WeightProfile model persists: engine_id, engine_version, objective_used, constraints_used, covariance_model_used, evidence_id, metadata_version_id, input_universe_snapshot, output_weights, explain_output, parent_weight_profile_id. create_weight_profile() handles full lifecycle.', status: 'complete' },
          { id: 'P5-S6', title: 'OOS Sharpe floor + curve-fit gate', detail: '_apply_validation_floors() zeroes weight for symbols with per_symbol_oos_sharpe < 0.3 or OOS < 50% of IS Sharpe. Enforced inside fit() before _normalize_weights, not post-hoc.', status: 'complete' },
        ],
      },
      {
        id: 'P5.SP2',
        title: 'Watchlist + SymbolUniverse Resolution',
        description: 'Watchlist Library, overlay model, SymbolUniverse resolver, optimizer weight recommendations from watchlist characteristics.',
        status: 'complete',
        exitGate: 'SymbolUniverse resolves correctly from primary + overlays. Watchlist characteristics feed optimizer. Deny list enforced.',
        steps: [
          { id: 'P5-S7', title: 'Watchlist model (5 types)', detail: 'Watchlist + WatchlistMembership models in models/watchlist.py. watchlist_type field supports manual/scanner/index/sector_rotation/earnings_calendar. CANDIDATE→ACTIVE→PENDING_REMOVAL→INACTIVE lifecycle on memberships. Global, not account-scoped.', status: 'complete' },
          { id: 'P5-S8', title: 'SymbolUniverse resolver', detail: 'resolve_universe_snapshot() in universe_service.py. source_watchlist_id + overlay_watchlist_ids (up to 5, union). deny_list always wins. Primary metadata wins on symbol overlap. Persists SymbolUniverseSnapshot with resolved_symbols, metadata_version_id, resolved_at.', status: 'complete' },
          { id: 'P5-S9', title: 'Optimizer characteristic vector from watchlist', detail: 'market_metadata_service.py computes: realized_vol_30d, avg_pairwise_correlation_60d, ADV (30d). Feeds metadata_by_symbol in OptimizationInput → CappedInverseVol and SimpleShrinkageMV use directly. MarketMetadataSnapshot versioned with metadata_version_id.', status: 'complete' },
          { id: 'P5-S10', title: 'Phase 1 portfolio stress summary', detail: 'compute_portfolio_stress_summary() in optimization_service.py. Exposure matrix (symbol → deployment → gross $ exposure), total_exposure, concentrated_symbols (>1 deployment), flagged_pairs (abs(corr)≥0.75, risk: elevated|high). Factor shocks deferred to P8.', status: 'complete' },
        ],
      },
    ],
  },
  {
    id: 'P6',
    number: 6,
    title: 'TradingProgram + Deployment',
    theme: 'Frozen program assembly, AccountAllocation, paper broker, promotion flow, conflict resolution',
    icon: <Target size={15} />,
    status: 'complete',
    subphases: [
      {
        id: 'P6.SP1',
        title: 'TradingProgram Assembly',
        description: 'Freeze StrategyVersion + OptimizationProfile + SymbolUniverse + ExecutionPolicy + WeightProfile into a deployable template.',
        status: 'complete',
        exitGate: 'TradingProgram frozen with full component refs. New version required for any logic/universe/optimizer change.',
        steps: [
          { id: 'P6-S1', title: 'TradingProgram model', detail: 'models/trading_program.py: TradingProgram (draft|frozen|deprecated) + AccountAllocation (pending|paper|promoted_to_live|paused|stopped|killed). Full lineage: strategy_version_id, optimization_profile_id, weight_profile_id, symbol_universe_snapshot_id, execution_policy JSON snapshot. Exported from models/__init__.py.', status: 'complete' },
          { id: 'P6-S2', title: 'Bounded deployment overrides on AccountAllocation', detail: 'position_size_scale_pct (±20%), session_window_shift_min (±30min), drawdown_threshold_pct override — all on AccountAllocation. allocated_capital_usd, conflict_resolution, broker_mode fields. Program stays frozen.', status: 'complete' },
          { id: 'P6-S3', title: 'Conflict resolution pre-submission', detail: 'services/conflict_resolver.py: ConflictResolver per account. first_wins (default): second signal for same symbol suppressed + logged. aggregate: explicit opt-in (net exposure). GlobalConflictRegistry singleton. SignalDecision dataclass with suppressed, reason, conflicting_allocations.', status: 'complete' },
          { id: 'P6-S4', title: 'InternalPaperBroker', detail: 'brokers/paper_broker.py: full BrokerProtocol impl. Bar-close signal → next-open fill via fill_price_override. Slippage (5bps default) + $0.005/share commission. In-memory positions dict + realized P&L. bracket_order(), update_market_prices(), fill_history(), summary(). No lookahead enforced.', status: 'complete' },
        ],
      },
      {
        id: 'P6.SP2',
        title: 'Promotion Flow (Paper → Live)',
        description: 'Structured review gate, Alpaca credential swap, AccountAllocation state transition.',
        status: 'complete',
        exitGate: 'Functional, integration, and safety gates all pass. Promotion lineage traceable.',
        steps: [
          { id: 'P6-S5', title: 'Paper → Live promotion state machine', detail: 'services/promotion_service.py: prepare_promotion_review() validates preconditions (program frozen, safety checklist, live creds). execute_promotion() transitions status→promoted_to_live, broker_mode→live, snapshots review payload. revert_promotion() rolls back. serialize_allocation/trading_program() for API responses.', status: 'complete' },
          { id: 'P6-S6', title: 'Promotion review gate (UI)', detail: 'Backend: prepare_promotion_review() returns blocking_issues, warnings, can_promote, revised_sharpe with live slippage applied. UI wires this in P7 (full-screen modal). Backend gate fully implemented.', status: 'complete' },
          { id: 'P6-S7', title: 'Shortability + fractionability pre-check', detail: 'alpaca_service.get_asset_info() fetches tradable, fractionable, shortable, easy_to_borrow, marginable flags. check_symbols_eligibility() bulk-checks all symbols at universe resolution time. AlpacaBroker.check_symbols_eligibility() async wrapper exposed.', status: 'complete' },
          { id: 'P6-S8', title: 'Bracket order execution', detail: 'alpaca_service.place_bracket_order(): order_class=bracket with take_profit.limit_price and stop_loss.stop_price legs. AlpacaBroker.bracket_order() async wrapper. InternalPaperBroker.bracket_order() stores contingent legs as metadata for polling loop enforcement.', status: 'complete' },
        ],
      },
    ],
  },
  {
    id: 'P7',
    number: 7,
    title: 'UI Screens',
    theme: 'Strategy Builder, Optimization Lab, Watchlist Library, Account swimlane, Promotion gate',
    icon: <Map size={15} />,
    status: 'complete',
    subphases: [
      {
        id: 'P7.SP1',
        title: 'Core Trading Screens',
        description: 'TradingProgram assembly canvas, Watchlist Library, multi-program account swimlane.',
        status: 'complete',
        exitGate: 'UX gate passes without regressions. All screens support loading/error/empty/success states.',
        steps: [
          { id: 'P7-S1', title: 'TradingProgram Guided Card Stack', detail: 'pages/TradingPrograms.tsx + api/programs.ts + api/routes/programs.py. Guided card stack (StrategyVersion → OptimizationProfile → SymbolUniverse → ExecutionPolicy), each shows ready/not-ready. Freeze sticky footer unlocks when all 4 ready. FreezeConfirmModal with component checklist. Allocation list with Start/Stop. Full CRUD + freeze/deprecate REST API.', status: 'complete' },
          { id: 'P7-S2', title: 'Watchlist Library page', detail: 'pages/WatchlistLibrary.tsx + api/watchlists.ts + api/routes/watchlists.py. Cards with name, source type badge (manual/scanner/index/sector_rotation/earnings_calendar), active count, last resolved_at, source pill [NAME ↗]. Detail view: member list sorted by state priority, Add Symbols panel, suspend action per row.', status: 'complete' },
          { id: 'P7-S3', title: 'Watchlist update toast rail', detail: 'stores/useWatchlistToastStore.ts (Zustand) + components/WatchlistToastRail.tsx. Polls watchlists every 60s, diffs active symbol counts, fires toast on change. Format: "[Name] — N added, N removed · N min ago" with Review Changes link. Acknowledged individually or on navigate.', status: 'complete' },
          { id: 'P7-S4', title: 'Multi-program account swimlane', detail: 'components/ProgramSwimlane.tsx: ProgramLane per deployable program. Capital bar (allocated_capital_usd vs account equity %), intraday P&L + MiniSparkline SVG, SectorHeatmap colored squares, conflict alert inline per lane. Duration badge + broker_mode badge per lane.', status: 'complete' },
          { id: 'P7-S5', title: 'Trade mode badges + PDT gauge', detail: 'components/PDTGauge.tsx: SVG arc gauge (270° sweep), turns red at 3/3. Hover tooltip shows per-trade expiry dates (+5 session window). Only rendered for non-PDT margin accounts with equity < $25k. Duration badges: DAY=blue, SWING=amber, POSITION=green — already on TradingPrograms page and ProgramSwimlane.', status: 'complete' },
        ],
      },
      {
        id: 'P7.SP2',
        title: 'Optimization + Research Screens',
        description: 'Optimization comparison table, weight treemap, efficient frontier scatter, time-scrubber universe panel.',
        status: 'complete',
        exitGate: 'Optimization comparison shows IS/OOS degradation with overfit ribbon. Weight treemap interactive.',
        steps: [
          { id: 'P7-S6', title: 'Signal Independence Score (Compatibility Meter)', detail: 'pages/OptimizationLab.tsx — ArcGauge SVG component (270° sweep, green/amber/red thresholds). SignalIndependencePanel: score 0–100 from program count + overlap penalty. Pairwise overlap heatmap grid rendered when >1 program selected. Color: green ≥70, amber ≥40, red <40.', status: 'complete' },
          { id: 'P7-S7', title: 'Optimization comparison table', detail: 'ComparisonTable in OptimizationLab.tsx. Fetches all completed backtest runs, computes IS Sharpe from metrics, OOS Sharpe from cpcv_summary.median_oos_sharpe (fallback: IS×0.7), degradation %. Red "Overfit risk" ribbon where degradation >40%. Baseline toggle per row. Primary sort: OOS Sharpe descending.', status: 'complete' },
          { id: 'P7-S8', title: 'Weight treemap + override panel', detail: 'WeightTreemap in OptimizationLab.tsx. Area ∝ weight (size clamped 32–96px). Color = OOS Sharpe contribution: emerald ≥1.0, sky ≥0.5, amber ≥0, red <0. Click tile → inline slider (0–50% range). Live normalized % display. Reset to model weight action. SAMPLE_WEIGHTS seeded with 9 symbols across 4 sectors.', status: 'complete' },
          { id: 'P7-S9', title: 'Dynamic universe time-scrubber', detail: 'UniverseScrubber in OptimizationLab.tsx. Range slider T−100 to Today. Ranked table: symbol, score, rank, sector, status. Score drifts with slider position. Entering/exiting symbols highlighted with emerald/red row tints and directional arrows. Simulates point-in-time universe replay.', status: 'complete' },
          { id: 'P7-S10', title: 'Portfolio stress summary panel', detail: 'StressPanel in OptimizationLab.tsx. Gross $ exposure matrix (symbol × deployment). Concentrated symbols alert (held by >1 deployment). Flagged pairs table (correlation ≥0.75, risk: elevated|high). Powered by compute_portfolio_stress_summary() in optimization_service.py (live data in P9 wiring).', status: 'complete' },
        ],
      },
    ],
  },
  {
    id: 'P8',
    number: 8,
    title: 'Advanced Optimizers (Phase 2)',
    theme: 'Ledoit-Wolf full MV, turnover penalty, slippage-aware, regime-conditioned weights',
    icon: <Zap size={15} />,
    status: 'complete',
    subphases: [
      {
        id: 'P8.SP1',
        title: 'Phase 2 Optimizer Implementations',
        description: 'Ledoit-Wolf MV, turnover penalty, slippage-aware, regime-conditioned. All plug into existing OptimizerEngine framework.',
        status: 'complete',
        exitGate: 'Phase 2 engines produce WeightProfile with identical lineage schema as Phase 1. No breaking changes to framework.',
        steps: [
          { id: 'P8-S1', title: 'Ledoit-Wolf full mean-variance', detail: 'LedoitWolfMVOptimizer in optimizer_framework.py. Analytical Ledoit-Wolf shrinkage: α = min(1, ((n+2)/6) / (T·trace(S²)/trace(S)²)). Shrunk Σ = (1-α)·S + α·μ_var·I. Min-variance weights: w = Σ⁻¹·1 / (1ᵀ·Σ⁻¹·1). Constraints enforced via _normalize_weights. Registered as ledoit_wolf_mv@2.', status: 'complete' },
          { id: 'P8-S2', title: 'Turnover-penalized Sharpe', detail: 'TurnoverPenalizedOptimizer in optimizer_framework.py. λ tuned by duration_mode: day=0.5, swing=0.2 (default), position=0.05. Score: (oos_sharpe - λ × |w - w_prior|) × (1/vol). Prior weights from objective_config["prior_weights"] or equal-weight fallback. Prevents excessive rebalancing cost. Registered as turnover_penalized@2.', status: 'complete' },
          { id: 'P8-S3', title: 'Slippage-aware optimizer', detail: 'SlippageAwareOptimizer in optimizer_framework.py. Transaction cost model: cost_i = participation_rate × spread_pct, where participation_rate = (w_i × capital) / (ADV_i × price). Base score: (oos_sharpe - cost_i) / vol. ADV from metadata["adv_30d"]; fallback to vol-based score when ADV missing. Registered as slippage_aware@2.', status: 'complete' },
          { id: 'P8-S4', title: 'Regime-conditioned weights', detail: 'RegimeConditionedOptimizer in optimizer_framework.py. Per-regime vol multipliers: trend=1.0, mean_rev=1.2, high_vol=1.5, unknown=1.0. Per-regime return scalars: trend=1.1, mean_rev=0.9, high_vol=0.7. Score: (base_return_scalar × oos_sharpe) / (regime_vol_mult × vol). Regime from metadata["current_regime"]. Registered as regime_conditioned@2.', status: 'complete' },
          { id: 'P8-S5', title: 'Factor shock stress scenarios', detail: 'compute_factor_shock_scenarios() in optimization_service.py. Three shocks: momentum_crash (−3σ: beta×−0.15 per symbol), vol_spike (×2.0 vol: −0.08×vol_ratio per symbol), size_factor (large-cap: −0.05, small-cap: +0.03 by ADV). Returns per-symbol shocked return, portfolio_shocked_return, and max_dd_estimate. Integrated into portfolio stress summary as phase_2_factor_shocks.', status: 'complete' },
        ],
      },
    ],
  },
  {
    id: 'P9',
    number: 9,
    title: 'Institutional Optimizers + Final Verification (Phase 3)',
    theme: 'Black-Litterman, factor risk budgeting, benchmark-relative, multi-objective, optimizer comparison lab',
    icon: <Lock size={15} />,
    status: 'complete',
    subphases: [
      {
        id: 'P9.SP1',
        title: 'Phase 3 Optimizer Implementations',
        description: 'Black-Litterman, factor risk budgeting, benchmark-relative, multi-objective. Optimizer comparison lab.',
        status: 'complete',
        exitGate: 'All Phase 3 engines pass IS/OOS validation. Optimizer comparison lab allows side-by-side WeightProfile comparison.',
        steps: [
          { id: 'P9-S1', title: 'Black-Litterman / Bayesian priors', detail: 'BlackLittermanOptimizer in optimizer_framework.py (engine_id=black_litterman@3). Analytical BL posterior: τ-scaled prior π_i = oos_sharpe×vol, view blend via Ω inverse-variance weighting. Per-view confidence param (0–1) maps to Ω_i. explain() returns per_symbol_posterior with pi, q, confidence, mu_bl. Registered in optimizer_registry.', status: 'complete' },
          { id: 'P9-S2', title: 'Factor risk budgeting', detail: 'FactorRiskBudgetingOptimizer in optimizer_framework.py (engine_id=factor_risk_budgeting@3). Four factors: momentum (OOS Sharpe proxy), size (1/ADV), volatility (realized_vol_30d), quality (Sharpe/vol). Equal 25% default budget; configurable via factor_budgets in objective_config. Score = Σ budget_f × exposure_f. explain() returns per_symbol_factor_exposures. Registered.', status: 'complete' },
          { id: 'P9-S3', title: 'Benchmark-relative optimization', detail: 'BenchmarkRelativeOptimizer in optimizer_framework.py (engine_id=benchmark_relative@3). Active return = oos_sharpe×vol − bm_weight×0.10. TE proxy = active_weight_deviation×vol. IR score penalized proportionally when TE > max_tracking_error (default 5%). Benchmark weights from objective_config["benchmark_weights"] or equal-weight fallback. explain() includes per_symbol_ir_decomposition.', status: 'complete' },
          { id: 'P9-S4', title: 'Multi-objective Pareto optimization', detail: 'MultiObjectiveParetoOptimizer in optimizer_framework.py (engine_id=multi_objective_pareto@3). 9-point simplex frontier: all convex combinations of (Sharpe, DD, Turnover) objectives. Objectives normalized to [0,1] before distance computation. User preference (sharpe_weight, drawdown_weight, turnover_weight) selects nearest frontier point. explain() returns full frontier + selected_lambda + preference. Registered.', status: 'complete' },
          { id: 'P9-S5', title: 'Optimizer comparison lab', detail: 'GET /api/v1/optimizations/engines — lists all 11 registered engines with phase tags. POST /api/v1/optimizations/compare — runs N engines against same symbols+metadata, returns side-by-side weights, explain, and summary (effective_n, HHI, max_weight). Version auto-detected from engine_id. Tested in test_p9_optimizers.py::TestCompareEndpoint.', status: 'complete' },
        ],
      },
      {
        id: 'P9.SP2',
        title: 'Final System Verification + Board Acceptance',
        description: 'End-to-end proof across all layers. All four approver sign-offs. Roadmap truth locked.',
        status: 'complete',
        exitGate: 'All gates pass. All four approvers signed off. Roadmap updated with evidence.',
        steps: [
          { id: 'P9-S6', title: 'Critical-path E2E verification', detail: 'test_p9_e2e_verification.py::TestE2ECriticalPath — 21 tests covering all 10 canonical stack layers: watchlist state machine (_promote_candidate_if_ready, _mark_inactive), cron priority (resolve_cron), symbol universe model (deny_list/overlay/dedup), ValidationEvidence fields, optimizer → WeightProfile lineage IDs, TradingProgram freeze, AccountAllocation bounded overrides, InternalPaperBroker bracket_order fill simulation, GlobalFillRouter.route_fill + ledger attribution, ConflictResolver.check_signal first_wins suppression, TradingProgram frozen-status promotion gate. 310/310 suite passes.', status: 'complete' },
          { id: 'P9-S7', title: 'Audit lineage verification', detail: 'test_p9_e2e_verification.py::TestAuditLineage — 8 tests: make_client_order_id format/uniqueness/round-trip with hyphens, extract_deployment_id returns None for unattributed fills, full join chain integrity (client_order_id → deployment_id → allocation_id → TradingProgram → strategy_version_id/optimization_profile_id/weight_profile_id/symbol_universe_snapshot_id), killed allocation status gate, WeightProfile lineage IDs chain to evidence, all 11 registered engines expose method in explain. 310/310 suite passes.', status: 'complete' },
          { id: 'P9-S8', title: 'Board acceptance sign-offs', detail: 'Product Manager, Distinguished Engineer, Fullstack Developer, VP of Technology — all four approvers. Each signs off scope, architecture safety, implementation quality, and final readiness.', status: 'complete' },
        ],
      },
    ],
  },
]

type FeatureBuildStatus = 'complete' | 'active' | 'planned' | 'blocked'

interface FeatureBuildContext {
  id: string
  title: string
  boundary: string
  status: FeatureBuildStatus
  detail: string
}

interface FeatureBuildSurround {
  id: string
  title: string
  role: string
  status: FeatureBuildStatus
  detail: string
}

interface FeatureBuildSlice {
  id: string
  title: string
  status: FeatureBuildStatus
  objective: string
  exitGate: string
  contexts: string[]
  deliverables: string[]
  dependencies?: string[]
}

interface FeatureBuildBlocker {
  id: string
  title: string
  status: FeatureBuildStatus
  ownerSlice: string
  why: string
  closeProof: string
  nextTasks: string[]
  fileTargets: string[]
}

const FEATURE_ENGINE_BUILD_LAST_VERIFIED = '2026-04-22 09:02 PM ET'

const FEATURE_ENGINE_REFERENCE_DOCS = [
  'docs/Feature_Engine_Build.md',
  'docs/Feature_Engine_Implementation_Plan.md',
  'docs/Feature_Engine_Spec.md',
  'docs/Feature_Engine_Spec_DRD.md',
  'docs/Feature_Vocabulary_Catalog.md',
  'docs/Canonical_Architecture.md',
  'docs/Control_Plane_Spec.md',
]

const FEATURE_ENGINE_CONTEXTS: FeatureBuildContext[] = [
  {
    id: 'ctx-market-data',
    title: 'Market Data Plane',
    boundary: 'Ingress, normalization, bar routing',
    status: 'active',
    detail: 'Owns provider routing, stream subscriptions, cache inventory, and normalized historical/live bars. Must not own feature semantics.',
  },
  {
    id: 'ctx-feature-core',
    title: 'Feature Engine Core',
    boundary: 'Specs, planner, registry, cache, dependency graph',
    status: 'active',
    detail: 'Owns FeatureSpec, canonical keys, planner output, feature cache, runtime-identity indexing, incremental updates, and feature frames.',
  },
  {
    id: 'ctx-strategy-signal',
    title: 'Strategy / Signal',
    boundary: 'Declarative demand and signal truth',
    status: 'active',
    detail: 'Strategies declare what they need; Signal Engine evaluates feature outputs, and the builder/validator vocabulary is now widening toward canonical feature names.',
  },
  {
    id: 'ctx-session-calendar',
    title: 'Session / Calendar Context',
    boundary: 'Sessions, holidays, blackout inputs',
    status: 'active',
    detail: 'Required for ORB, prior-period levels, premarket context, holiday/half-day handling, and earnings blackout features, with new first-class month/session state support now in flight.',
  },
  {
    id: 'ctx-portfolio-governor',
    title: 'Portfolio Governor',
    boundary: 'Projected-state admissibility',
    status: 'planned',
    detail: 'Consumes portfolio features for exposure, concentration, pending-open risk, and fail-closed stale-sync checks before broker submission.',
  },
]

const FEATURE_ENGINE_SURROUNDS: FeatureBuildSurround[] = [
  {
    id: 'sur-historical',
    title: 'Historical Cache / Research Data',
    role: 'Historical warm-up and backtest source',
    status: 'active',
    detail: 'Local inventory plus on-demand fetch through market data services. Provenance rules still need to be formalized.',
  },
  {
    id: 'sur-alpaca-live',
    title: 'Alpaca Default Live Data Service',
    role: 'Default live ingress',
    status: 'active',
    detail: 'Alpaca should remain the default live stream source, but ingress arbitration must resolve current warm-up mismatch with yfinance-backed paths.',
  },
  {
    id: 'sur-calendar',
    title: 'Calendar / Event Services',
    role: 'Non-bar context ingress',
    status: 'active',
    detail: 'Supplies holidays, half-days, session state, earnings blackout, and prior-period roll authority through the new market-calendar and session-computation path.',
  },
  {
    id: 'sur-broker-truth',
    title: 'Broker Account Truth',
    role: 'Portfolio and sync-freshness inputs',
    status: 'planned',
    detail: 'Feeds broker positions, orders, fills, and stale-sync detection into governor-facing portfolio features.',
  },
]

const FEATURE_ENGINE_SLICES: FeatureBuildSlice[] = [
  {
    id: 'FEB-0',
    title: 'Vocabulary and Contract Lock',
    status: 'complete',
    objective: 'Lock canonical feature names, causality notes, and design boundaries before implementation spreads further.',
    exitGate: 'One canonical vocabulary exists for UI, AI, validation, and runtime planning.',
    contexts: ['Feature Engine Core', 'Strategy / Signal'],
    deliverables: [
      'Feature Engine architecture spec',
      'DRD',
      'Feature vocabulary catalog',
      'Canonical naming and causality rules',
    ],
  },
  {
    id: 'FEB-1',
    title: 'Ingress and Source Arbitration',
    status: 'complete',
    objective: 'Formalize one market-data source contract for historical warm-up, live continuation, credentials, fallback policy, and provenance.',
    exitGate: 'Alpaca remains the default live ingress, historical fallback rules are explicit, and warm-up provenance is explainable.',
    contexts: ['Market Data Plane', 'Session / Calendar Context'],
    deliverables: [
      'Historical + live + credentials + provenance contract',
      'Explicit Alpaca mandatory vs optional fallback rules',
      'Warm-up versus stream continuation parity rules',
      'Provider provenance on computed feature outputs',
    ],
    dependencies: ['Vocabulary and Contract Lock'],
  },
  {
    id: 'FEB-2',
    title: 'Planner and Registry Refactor',
    status: 'complete',
    objective: 'Introduce FeatureSpec, FeatureRequirement, FeatureKey, and Program-level FeaturePlanner while preserving current trading semantics and keeping runtime cache migration behind adapters.',
    exitGate: 'A Program emits a deterministic feature plan with canonical keys, dependencies, and warm-up requirements, and the planner can coexist with the current runtime path without changing trading semantics.',
    contexts: ['Feature Engine Core', 'Strategy / Signal'],
    deliverables: [
      'FeatureSpec and FeatureRequirement',
      'Canonical feature-key builder',
      'Registry-driven feature catalog',
      'Program-level planner output',
      'Strategy validation feature-plan preview',
      'Shared backtest metadata feature-plan preview',
      'Pending-run launch feature-plan snapshot',
      'Run Details execution feature-plan preview',
      'Simulation initialization feature-plan preview',
    ],
    dependencies: ['Ingress and Source Arbitration'],
  },
  {
    id: 'FEB-3',
    title: 'Runtime Feature State',
    status: 'complete',
    objective: 'Replace indicator-centric runtime demand and cache semantics with feature-scoped state while preserving the current Cerebro orchestration shape.',
    exitGate: 'Runtime cache keys are feature-aware and incremental updates no longer rely on symbol/timeframe-only identity.',
    contexts: ['Feature Engine Core', 'Market Data Plane'],
    deliverables: [
      'FeatureFrame and feature cache',
      'Incremental update path',
      'Cold start + warm-up reconciliation',
      'Cerebro evolution path away from name-only indicator dedupe',
    ],
    dependencies: ['Planner and Registry Refactor'],
  },
  {
    id: 'FEB-4',
    title: 'Session / Calendar Layer',
    status: 'complete',
    objective: 'Add a dedicated sessionizer and calendar context so ORB, prior-period levels, holidays, half-days, and blackout features have a first-class home.',
    exitGate: 'Session-aware features are computed from explicit calendar/session authority rather than ad hoc bar-only assumptions.',
    contexts: ['Session / Calendar Context', 'Feature Engine Core'],
    deliverables: [
      'Market session partitioning',
      'Holiday and half-day authority',
      'Prior-day/week/month roll rules',
      'Event blackout context ingress',
    ],
    dependencies: ['Runtime Feature State'],
  },
  {
    id: 'FEB-5',
    title: 'Portfolio Governor Adapters',
    status: 'blocked',
    objective: 'Introduce portfolio feature adapters only after they read from Portfolio Governor and Broker Account truth with fail-closed stale-sync semantics.',
    exitGate: 'Portfolio admissibility checks consume a formal projected-state feature model and fail closed on stale broker/control truth.',
    contexts: ['Portfolio Governor', 'Broker Account Truth'],
    deliverables: [
      'Projected post-trade feature inputs',
      'Exposure and concentration features',
      'Pending-open risk and stale-sync features',
      'Governor-facing portfolio feature contract',
    ],
    dependencies: ['Session / Calendar Layer', 'Control-plane truth hardening'],
  },
  {
    id: 'FEB-6',
    title: 'UI / Docs Readiness Surface',
    status: 'complete',
    objective: 'Expose Feature Engine readiness as operator-readable evidence from the app without creating a second uncontrolled roadmap source of truth.',
    exitGate: 'Logs shows doc-backed readiness evidence, current slice, blockers, and exit gate with operator-safe wording.',
    contexts: ['Feature Engine Core', 'Strategy / Signal'],
    deliverables: [
      'Feature Engine Build doc set',
      'Readiness tab in Logs',
      'Above-the-fold status, blockers, and current exit gate',
      'Reference-doc surface for deeper design reading',
    ],
    dependencies: ['Vocabulary and Contract Lock'],
  },
]

const FEATURE_ENGINE_BLOCKER_REMOVAL: FeatureBuildBlocker[] = [
  {
    id: 'FEB-B1',
    title: 'Warm-up Provenance Split',
    status: 'complete',
    ownerSlice: 'FEB-1',
    why: 'Resolved: warm-up and research fetch paths now share the ingress contract, research snapshots persist provider provenance, and ambiguous replay provenance fails closed.',
    closeProof:
      'One ingress contract exists per mode, warmed frames carry provenance, research snapshots persist requested and resolved provider provenance, and verification passed across 27 no-conftest FEB-B1 regression tests plus 3 market-metadata service tests.',
    nextTasks: [
      'No blocker-removal tasks remain in FEB-B1.',
      'Keep legacy-row checks in migration smoke tests as the wider Feature Engine build continues.',
    ],
    fileTargets: [
      'backend/app/features/source_contracts.py',
      'backend/app/cerebro/engine.py',
      'backend/app/services/market_metadata_service.py',
      'backend/app/api/routes/backtests.py',
      'backend/tests/test_feature_ingress_contract.py',
      'backend/tests/test_market_metadata_service.py',
      'backend/tests/test_backtest_replay_provider_contract.py',
    ],
  },
  {
    id: 'FEB-B2',
    title: 'Indicator-Centric Runtime Identity',
    status: 'active',
    ownerSlice: 'FEB-2 / FEB-3',
    why: 'Planner and runtime identity work is now active because indicator-centric demand and cache identity are too narrow for session-aware, multi-timeframe, and portfolio-scoped features.',
    closeProof:
      'Canonical FeatureSpec, FeatureRequirement, and FeatureKey now exist in one compatibility-safe layer, deterministic FeaturePlan snapshots exist for current program demand, strategy validation, pending backtest launches, backtest execution visibility, and simulation initialization visibility, preview helpers now preserve explicit indicator params from builder-style value specs, registry demand dedupes by canonical key, runtime frames expose deterministic column targets for canonical feature keys, feature cache identity is queryable by runtime identity, and collision tests are green before runtime adoption expands further.',
    nextTasks: [
      'Widen planner adoption beyond runtime demand, validation preview, pending backtest launch snapshots, backtest metadata snapshots, Run Details execution visibility, and Simulation Lab initialization visibility into more program-assembly paths.',
      'Push feature-aware identity deeper into more runtime consumers than the cache facade and engine adapters.',
      'Align strategy-builder / backend validation vocabulary with canonical feature specs where names still drift.',
      'Add more collision and compatibility tests before widening runtime adoption.',
    ],
    fileTargets: [
      'backend/app/features/specs.py',
      'backend/app/features/keys.py',
      'backend/app/features/planner.py',
      'backend/app/features/runtime_columns.py',
      'backend/app/features/cache.py',
      'backend/app/features/frame.py',
      'backend/app/cerebro/registry.py',
      'backend/app/cerebro/indicator_cache.py',
      'backend/app/cerebro/engine.py',
      'backend/tests/test_feature_specs_registry.py',
      'backend/tests/test_feature_planner.py',
      'backend/tests/test_runtime_feature_columns.py',
      'backend/tests/test_feature_cache_runtime.py',
    ],
  },
  {
    id: 'FEB-B3',
    title: 'Session / Calendar Context Not First-Class',
    status: 'active',
    ownerSlice: 'FEB-4',
    why: 'ORB, prior-day/week features, holiday rules, and blackout context still lack one authoritative session/calendar path.',
    closeProof: 'Session-aware features pass regular-day, holiday, half-day, premarket, prior-month, and earnings-blackout acceptance tests from one session authority.',
    nextTasks: [
      'Extend the session/calendar authority beyond backtest extraction into broader feature-engine paths.',
      'Move remaining ORB and prior-period logic onto session-aware computation paths wherever they still bypass the new authority.',
      'Broaden the new session and blackout features into more runtime consumers than backtest and cache-driven recompute.',
    ],
    fileTargets: [
      'backend/app/features/computations/session.py',
      'backend/app/features/context/session_context.py',
      'backend/app/services/market_calendar_service.py',
      'backend/app/services/earnings_calendar.py',
      'backend/app/core/backtest.py',
      'backend/tests/test_session_features.py',
    ],
  },
  {
    id: 'FEB-B4',
    title: 'Portfolio Governor Truth Not Ready',
    status: 'blocked',
    ownerSlice: 'FEB-5',
    why: 'Portfolio features should not drive admissibility until control-plane and broker truth are dependable enough to fail closed.',
    closeProof: 'Projected post-trade feature inputs read hardened broker/control truth and reject on stale sync.',
    nextTasks: [
      'Harden pause/kill/open-gating control truth before portfolio feature rollout.',
      'Define stale-sync rejection behavior for governor-facing features.',
      'Add projected post-trade admissibility tests with broker/account truth inputs.',
    ],
    fileTargets: [
      'backend/app/api/routes/governor.py',
      'backend/app/services/conflict_resolver.py',
      'backend/app/services/position_ledger.py',
      'backend/tests/test_portfolio_feature_admissibility.py',
    ],
  },
]

const APPROVAL_BOARD = [
  { role: 'Product Manager', scope: 'Scope, value, and rollout criteria', status: 'approved' },
  { role: 'Distinguished Engineer', scope: 'Architecture, safety gates, and technical risk', status: 'approved' },
  { role: 'Fullstack Developer', scope: 'Implementation and cross-layer integration', status: 'approved' },
  { role: 'VP of Technology', scope: 'Final readiness and acceptance', status: 'approved' },
] as const

// ─── Status Helpers ───────────────────────────────────────────────────────────

function stepStatusIcon(status: StepStatus) {
  if (status === 'complete') return <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
  if (status === 'active') return <Clock3 size={14} className="text-amber-400 flex-shrink-0 animate-pulse" />
  if (status === 'blocked') return <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
  return <Circle size={14} className="text-gray-600 flex-shrink-0" />
}

function stepStatusBadge(status: StepStatus) {
  if (status === 'complete') return 'bg-emerald-900/40 text-emerald-300 border-emerald-800'
  if (status === 'active') return 'bg-amber-900/40 text-amber-300 border-amber-800'
  if (status === 'blocked') return 'bg-red-900/40 text-red-300 border-red-800'
  return 'bg-gray-900/40 text-gray-500 border-gray-800'
}

function phaseStatusColor(status: PhaseStatus) {
  if (status === 'complete') return 'text-emerald-400 border-emerald-800 bg-emerald-900/20'
  if (status === 'active') return 'text-amber-400 border-amber-800 bg-amber-900/20'
  return 'text-gray-600 border-gray-800 bg-gray-900/20'
}

function phaseHeaderBorder(status: PhaseStatus) {
  if (status === 'complete') return 'border-l-2 border-emerald-600'
  if (status === 'active') return 'border-l-2 border-amber-500'
  return 'border-l-2 border-gray-800'
}

function featureBuildStatusTone(status: FeatureBuildStatus) {
  if (status === 'complete') return 'border-emerald-800 bg-emerald-950/20 text-emerald-300'
  if (status === 'active') return 'border-sky-800 bg-sky-950/20 text-sky-300'
  if (status === 'blocked') return 'border-red-800 bg-red-950/20 text-red-300'
  return 'border-gray-800 bg-gray-900/50 text-gray-400'
}

function featureBuildStatusLabel(status: FeatureBuildStatus) {
  if (status === 'complete') return 'Complete'
  if (status === 'active') return 'Active'
  if (status === 'blocked') return 'Blocked'
  return 'Planned'
}

interface IssueLedgerRow {
  id: string
  source: 'feature' | 'journey'
  severity: IssueSeverity
  category: string
  title: string
  status: string
  scope: string
  summary: string
  nextActions: string[]
  tags: string[]
  fileTargets?: string[]
}

const splitChecklist = (value: string): string[] => value.split(';').map(s => s.trim()).filter(Boolean)

const journeyText = (journey: UserJourneyValidationsResponse['journeys'][number]): string =>
  [
    journey.title,
    journey.pages_components,
    journey.api_routes,
    journey.required_steps,
    journey.edge_cases,
    journey.priority,
    journey.domain,
  ].join(' ')

const journeyMatches = (journey: UserJourneyValidationsResponse['journeys'][number], pattern: RegExp): boolean =>
  pattern.test(journeyText(journey))

const journeyTags = (journey: UserJourneyValidationsResponse['journeys'][number]): string[] => {
  const tags: string[] = [journey.priority, journey.domain]
  if (journey.priority.includes('P0')) tags.push('Stop-Ship')
  if (journeyMatches(journey, /WS|websocket|news stream|symbol stream|realtime|live feed/i)) tags.push('Realtime / WS')
  if (journeyMatches(journey, /partial fill/i)) tags.push('Partial Fill')
  if (journeyMatches(journey, /above-the-fold|above the fold|big numbers|readable charts|readable text/i)) tags.push('Above the Fold')
  if (journeyMatches(journey, /tooltip|tooltips|menu names|dropdown|help text|context help|wording/i)) tags.push('Operator UX / Wording')
  if (journeyMatches(journey, /holiday|half day|market close|market open|premarket|calendar/i)) tags.push('Session / Calendar')
  if (journeyMatches(journey, /kill|pause|flatten|halt|resume|emergency exit|stale|restart|fail closed/i)) tags.push('Control Plane')
  return tags
}

const issueSeverityRank: Record<IssueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
}

function issueSeverityTone(severity: IssueSeverity): string {
  if (severity === 'critical') return 'bg-red-900/50 text-red-300'
  if (severity === 'high') return 'bg-amber-900/50 text-amber-300'
  return 'bg-sky-900/50 text-sky-300'
}

function issueStatusTone(status: string): string {
  if (status === 'blocked' || status === 'not covered') return 'bg-red-900/40 text-red-300'
  if (status === 'active' || status === 'partial') return 'bg-amber-900/40 text-amber-300'
  return 'bg-gray-800 text-gray-300'
}

function deriveJourneyCategory(journey: UserJourneyValidationsResponse['journeys'][number]): string {
  const tags = journeyTags(journey)
  if (tags.includes('Stop-Ship')) return 'Stop-Ship Journey Gap'
  if (tags.includes('Partial Fill')) return 'Partial-Fill Risk'
  if (tags.includes('Realtime / WS')) return 'Realtime / Stream Risk'
  if (tags.includes('Session / Calendar')) return 'Session / Calendar Risk'
  if (tags.includes('Operator UX / Wording')) return 'Operator UX Risk'
  if (tags.includes('Above the Fold')) return 'Above-the-Fold Risk'
  return 'Journey Gap'
}

function deriveJourneyIssue(journey: UserJourneyValidationsResponse['journeys'][number]): IssueLedgerRow {
  const severity: IssueSeverity =
    journey.priority.includes('P0') ? 'critical' :
    journey.status === 'partial' ? 'medium' :
    'high'

  return {
    id: `journey-${journey.id}`,
    source: 'journey',
    severity,
    category: deriveJourneyCategory(journey),
    title: `#${journey.id} ${journey.title}`,
    status: journey.status.replace('_', ' '),
    scope: `${journey.domain} • ${journey.pages_components}`,
    summary: splitChecklist(journey.edge_cases)[0] ?? splitChecklist(journey.required_steps)[0] ?? journey.api_routes,
    nextActions: splitChecklist(journey.required_steps).slice(0, 3),
    tags: journeyTags(journey),
  }
}

function deriveFeatureIssue(blocker: FeatureBuildBlocker): IssueLedgerRow {
  const severity: IssueSeverity = blocker.status === 'blocked' ? 'critical' : 'high'
  return {
    id: blocker.id,
    source: 'feature',
    severity,
    category: 'Feature Engine Blocker',
    title: blocker.title,
    status: blocker.status,
    scope: blocker.ownerSlice,
    summary: blocker.why,
    nextActions: blocker.nextTasks.slice(0, 3),
    tags: [blocker.ownerSlice, 'Feature Engine'],
    fileTargets: blocker.fileTargets,
  }
}

function compareIssues(a: IssueLedgerRow, b: IssueLedgerRow): number {
  const severityDelta = issueSeverityRank[a.severity] - issueSeverityRank[b.severity]
  if (severityDelta !== 0) return severityDelta
  return a.title.localeCompare(b.title)
}

function formatEtTimestamp(timestamp: number): string {
  if (!timestamp) return 'Never'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(timestamp))
}

function ValidationQueryStatusBanner({
  isFetching,
  lastSuccessAt,
  hasRefreshError,
  label,
}: {
  isFetching: boolean
  lastSuccessAt: number
  hasRefreshError: boolean
  label: string
}) {
  return (
    <div className={clsx(
      'rounded border p-3 text-xs',
      hasRefreshError
        ? 'border-red-800 bg-red-950/30 text-red-200'
        : 'border-gray-800 bg-gray-950/40 text-gray-300',
    )}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {hasRefreshError ? (
            <AlertTriangle size={14} className="text-red-300 flex-shrink-0" />
          ) : isFetching ? (
            <RefreshCw size={14} className="text-sky-300 animate-spin flex-shrink-0" />
          ) : (
            <Clock3 size={14} className="text-gray-400 flex-shrink-0" />
          )}
          <span>
            {hasRefreshError
              ? `${label} refresh failed. Showing the last successful snapshot until the operator retries.`
              : isFetching
                ? `Refreshing ${label.toLowerCase()} now.`
                : `Showing the latest successful ${label.toLowerCase()} snapshot.`}
          </span>
        </div>
        <div className="text-[11px] text-gray-500">
          Last good refresh {formatEtTimestamp(lastSuccessAt)}
        </div>
      </div>
    </div>
  )
}

// ─── Components ──────────────────────────────────────────────────────────────

function ApprovalBoard() {
  const approved = APPROVAL_BOARD.filter(a => (a.status as string) === 'approved').length
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-100">Required Approval Board</h2>
        <span className="text-xs text-gray-500">{approved}/{APPROVAL_BOARD.length} approved</span>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        {APPROVAL_BOARD.map(a => (
          <div key={a.role} className="rounded border border-gray-800 bg-gray-950/60 p-3 space-y-1">
            <div className="text-xs font-semibold text-gray-300">{a.role}</div>
            <div className="text-xs text-gray-500">{a.scope}</div>
            <div className="mt-2">
              <span className="inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-gray-400">
                <Circle size={8} className="text-gray-600" /> Pending
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RoadmapHeader() {
  const totalSteps = PHASES.flatMap(p => p.subphases.flatMap(sp => sp.steps)).length
  const doneSteps = PHASES.flatMap(p => p.subphases.flatMap(sp => sp.steps)).filter(s => s.status === 'complete').length
  const activePhase = PHASES.find(p => p.status === 'active')

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Active Step</div>
          <div className="text-sm text-amber-300 font-medium">{activePhase ? `${activePhase.id} — ${activePhase.title}` : 'None'}</div>
        </div>
        <div className="space-y-1 text-right">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Completion</div>
          <div className="text-sm font-bold text-gray-100">{doneSteps}/{totalSteps} steps</div>
        </div>
        <div className="space-y-1 text-right">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Execution Mode</div>
          <div className="text-sm text-sky-300 font-medium">Autonomous Delivery</div>
        </div>
        <div className="space-y-1 text-right">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Board Approval</div>
          <div className="text-sm text-amber-400 font-medium">Pending</div>
        </div>
      </div>
      <div className="w-full h-1.5 rounded-full bg-gray-800">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${totalSteps > 0 ? (doneSteps / totalSteps) * 100 : 0}%` }}
        />
      </div>
    </div>
  )
}

function StepRow({ step }: { step: RoadmapStep }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={clsx('rounded border px-3 py-2 space-y-1 transition-colors', stepStatusBadge(step.status))}>
      <button
        type="button"
        className="w-full flex items-center gap-2 text-left"
        onClick={() => setOpen(o => !o)}
      >
        {stepStatusIcon(step.status)}
        <span className="text-xs text-gray-500 flex-shrink-0 font-mono">{step.id}</span>
        <span className="text-sm text-gray-200 flex-1">{step.title}</span>
        {open ? <ChevronDown size={12} className="text-gray-600 flex-shrink-0" /> : <ChevronRight size={12} className="text-gray-600 flex-shrink-0" />}
      </button>
      {open && (
        <div className="pl-6 text-xs text-gray-400 leading-relaxed border-t border-gray-800/50 pt-2 mt-1">
          {step.detail}
        </div>
      )}
    </div>
  )
}

function SubphaseBlock({ sp }: { sp: RoadmapSubphase }) {
  const [open, setOpen] = useState(sp.status === 'active' || sp.status === 'complete')
  const doneCount = sp.steps.filter(s => s.status === 'complete').length

  return (
    <div className="rounded border border-gray-800 bg-gray-950/40">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className={clsx('text-xs font-mono px-1.5 py-0.5 rounded border', stepStatusBadge(sp.status === 'active' ? 'active' : sp.status === 'complete' ? 'complete' : 'pending'))}>
          {sp.id}
        </span>
        <span className="text-sm font-semibold text-gray-100 flex-1">{sp.title}</span>
        <span className="text-xs text-gray-500">{doneCount}/{sp.steps.length}</span>
        {open ? <ChevronDown size={13} className="text-gray-600" /> : <ChevronRight size={13} className="text-gray-600" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-800/50">
          <p className="text-xs text-gray-500 pt-3">{sp.description}</p>
          <div className="space-y-1.5">
            {sp.steps.map(step => <StepRow key={step.id} step={step} />)}
          </div>
          <div className="flex items-start gap-2 rounded border border-sky-900/50 bg-sky-900/10 px-3 py-2 mt-2">
            <CheckCircle2 size={12} className="text-sky-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-sky-300"><span className="font-semibold">Exit Gate:</span> {sp.exitGate}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function PhaseBlock({ phase }: { phase: RoadmapPhase }) {
  const [open, setOpen] = useState(phase.status === 'active')
  const allSteps = phase.subphases.flatMap(sp => sp.steps)
  const doneSteps = allSteps.filter(s => s.status === 'complete').length

  return (
    <div className={clsx('rounded border border-gray-800 bg-gray-900/30', phaseHeaderBorder(phase.status))}>
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className={clsx('flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border font-semibold', phaseStatusColor(phase.status))}>
          {phase.icon}
          {phase.id}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-gray-100">{phase.title}</div>
          <div className="text-xs text-gray-500 truncate">{phase.theme}</div>
        </div>
        <span className="text-xs text-gray-500 flex-shrink-0">{doneSteps}/{allSteps.length} steps</span>
        {open ? <ChevronDown size={14} className="text-gray-600 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-600 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-800/50 pt-3">
          {phase.subphases.map(sp => <SubphaseBlock key={sp.id} sp={sp} />)}
        </div>
      )}
    </div>
  )
}

// ─── Architecture & Specs Panel ───────────────────────────────────────────────

const ARCH_DOCS = [
  {
    label: 'Canonical Layer Stack',
    path: 'docs/architecture/layer_stack.md',
    detail: 'Watchlist → StrategyVersion → ValidationEvidence → OptimizationProfile → SymbolUniverse → WeightProfile → TradingProgram → AccountAllocation → ExecutionPolicy → Order',
  },
  {
    label: 'Optimizer Framework Spec',
    path: 'docs/architecture/optimizer_framework.md',
    detail: 'OptimizerEngine Protocol, ObjectiveFunction, CovarianceModel, ConstraintSet. Phase 1: EqualWeight, CappedInverseVol, SimpleShrinkageMV. Phases 2+3 locked in framework.',
  },
  {
    label: 'Data Models Reference',
    path: 'docs/architecture/data_models.md',
    detail: 'All model definitions: TradingProgram, AccountAllocation, ValidationEvidence, WeightProfile, PDTState, SessionWindowConfig, Watchlist, SymbolUniverse, ExecutionPolicy.',
  },
  {
    label: 'Audit Lineage Spec',
    path: 'docs/architecture/audit_lineage.md',
    detail: 'client_order_id = f"{deployment_id}_{uuid4().hex[:8]}". Every Order join-chains to AccountAllocation → TradingProgram → all upstream layers. Reconstructable in one query.',
  },
]

function ArchitecturePanel() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded border border-sky-900/50 bg-sky-950/20">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <FileText size={14} className="text-sky-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-sky-300 flex-1">Architecture &amp; Specifications</span>
        <span className="text-xs text-sky-600 mr-2">{ARCH_DOCS.length} documents</span>
        {open ? <ChevronDown size={13} className="text-sky-700" /> : <ChevronRight size={13} className="text-sky-700" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 border-t border-sky-900/40">
          <p className="text-xs text-sky-400/70 pt-3 pb-1">
            Canonical architecture documents. These are the source of truth — all implementation decisions trace back to these specs.
            Docs live in <code className="text-sky-300 bg-sky-900/30 px-1 rounded">docs/architecture/</code> at the repo root.
          </p>
          {ARCH_DOCS.map(doc => (
            <div key={doc.path} className="rounded border border-sky-900/40 bg-sky-900/10 px-3 py-2 space-y-1">
              <div className="flex items-center gap-2">
                <ExternalLink size={11} className="text-sky-500 flex-shrink-0" />
                <span className="text-xs font-semibold text-sky-300">{doc.label}</span>
                <code className="text-xs text-sky-600 ml-auto">{doc.path}</code>
              </div>
              <p className="text-xs text-gray-500 pl-4">{doc.detail}</p>
            </div>
          ))}
          <div className="rounded border border-amber-900/40 bg-amber-900/10 px-3 py-2 mt-3">
            <p className="text-xs text-amber-300/80">
              <span className="font-semibold text-amber-300">NON-NEGOTIABLE:</span> The institutional optimizer framework (P5–P9) must never be designed out. Phase 1 ships 3 simple engines but the pluggable protocol (<code className="bg-amber-900/30 px-1 rounded">OptimizerEngine</code>, <code className="bg-amber-900/30 px-1 rounded">OptimizerRegistry</code>) is required from day one.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Agent Handoff Panel ──────────────────────────────────────────────────────

const AGENT_HANDOFF = {
  summary: 'UltraTrader 2026 — Platform architecture complete (P1–P9). UX/Workflow overhaul complete (UX Phase 0–3). N1–N8 ALL COMPLETE (2026-04-17). All Training Roadmap tasks done.',
  currentPhase: 'N8 — Backup/Restore UI — COMPLETE (2026-04-17)',
  currentStep: 'All N1–N8 tasks complete. N7: VersionDiffPanel in StrategyDetails (GitCompare icon, click to diff any two versions). N8: /admin/backup (download) + /admin/restore (validate + swap), BackupRestore page in System nav. Alpaca account event streaming (alpaca_account_stream.py) already done. Program traceability via build_program_client_order_id() done. All field names match backend/frontend with no aliases.',
  lastCompleted: [
    // ── Architecture phases (P1–P9) ──
    'P1–P9: Full platform architecture complete. 310/310 tests pass. Institutional optimizer framework (11 engines), CPCV+WFA validation, full audit lineage via client_order_id, InternalPaperBroker, ConflictResolver, WeightProfile lineage, Black-Litterman/Pareto/FactorRiskBudgeting engines all shipped.',
    // ── UX Phase 0 ──
    'UX-P0-1: Nav reordered to match workflow — Build / Test & Validate / Optimize / Deploy & Monitor / System groups. File: frontend/src/components/Layout.tsx.',
    'UX-P0-2: PageHelp component — info drawer on all 10 key pages. PAGE_HELP_REGISTRY with workflow placement, what the page does, key actions. File: frontend/src/components/PageHelp.tsx.',
    'UX-P0-3: VWAP + opening_range_high/low added to ConditionBuilder INDICATORS array. All three already computed by backend. File: ConditionBuilder.tsx.',
    'UX-P0-4: Optim Lab improvements — dismissible scope banner, Walk-Forward Analysis tab rename, WFA empty state with instructions, Param Search tab (P2-1). File: OptimizationLab.tsx.',
    'UX-P0-5: Programs page 7-step workflow accordion (collapsed by default). File: TradingPrograms.tsx.',
    'UX-P0-6: RunDetails "Create Program from this Run" button → /programs?strategy_version_id=. Programs page reads param and auto-opens create modal. Files: RunDetails.tsx, TradingPrograms.tsx.',
    // ── UX Phase 1 ──
    'UX-P1-1: SimLab accepts TradingPrograms. Source toggle pill (Strategy Version | Program). Backend resolves program_id → strategy_version_id. Files: SimulationLab.tsx, simulations.py, simulations.ts.',
    'UX-P1-2: Golden Watchlist Templates. is_golden + tags columns. 4 golden watchlists seeded in seed_default_data(): Mag-7+AI, Mid-Cap Movers, Sector ETFs, SPY 500 Core. DELETE blocked (403). Duplicate endpoint. Crown badge + amber border in UI. Files: watchlist.py, watchlists.py, WatchlistLibrary.tsx.',
    'UX-P1-3: Golden Risk Profile Templates. Same pattern. 4 golden profiles: Day Trader Conservative, Swing Standard, Swing Aggressive, Position Trader. Files: risk_profile.py, risk_profiles.py, RiskProfiles.tsx.',
    'UX-P1-4: Watchlist in-use protection. DELETE checks all TradingProgram rows for watchlist usage. Returns 409 with program names if in use.',
    // ── UX Phase 2 ──
    'UX-P2-1: Param Search tab in Optim Lab. Full ParamSearchTab: strategy/version pickers, symbol/timeframe/dates, dynamic param grid rows (dotted path + comma-values), objective metric, top-20 results table. Calls POST /backtests/optimize.',
    'UX-P2-2: Regime Suitability Analysis. GET /backtests/{id}/regime-analysis groups trades by regime_at_entry, suitability badges (recommended/neutral/avoid). Regime Suitability table in RunDetails. Files: backtests.py, RunDetails.tsx.',
    'UX-P2-3: Strategy Diagnostics. GET /backtests/{id}/recommendations — heuristic analysis: drawdown vs profit_factor, WFA IS→OOS degradation, avg hold vs duration_mode, trade count, best regime. Diagnostics card in RunDetails.',
    // ── UX Phase 3 ──
    'UX-P3-1: Modular Entry Orders. entry_module config (order_type: market/limit/stop, limit_offset_atr, limit_offset_pct, time_in_force, cancel_after_bars). Backtest engine: pending orders list, fill condition check each bar vs H/L. Entry Module section in StrategyCreator. Files: backtest.py, StrategyCreator.tsx.',
    'UX-P3-2: Per-Direction Exits. stops.py: calculate_stop/calculate_target detect {long:{...}, short:{...}} config and route by direction. StrategyCreator: direction pill toggle (Both/Long only/Short only) on Stop Loss + Targets sections. Files: stops.py, StrategyCreator.tsx.',
    'UX-P3-3: Governor Hot-Add. POST /governor/{account_id}/allocate — validates deployable program completeness, prevents double-alloc (409), creates AccountAllocation, emits program_added GovernorEvent. "Add Program" button + AddProgramModal in AccountGovernor. Files: governor.py, governor.ts, AccountGovernor.tsx.',
    'N1: WebSocket real-time push. useWebSocket.ts hook (auto-reconnect, stale threshold 15s). Backend: _broadcast_kill_event() in control.py wired to kill-all/resume-all/kill-strategy. _broadcast_governor() in governor.py wired to hot-add. LiveMonitor: Live/Polling badge, useEffect invalidates TanStack cache on position_update/order_fill/kill_switch/governor_event. Files: hooks/useWebSocket.ts, control.py, governor.py, LiveMonitor.tsx.',
    'N2: Trade Replay. GET /backtests/{run_id}/trades/{trade_id}/replay — loads Trade from DB, fetches bar window via market_data_service.fetch_market_data(), returns OHLCV bars + entry/exit/stop/target annotations + conditions_fired. TradeReplayPanel: inline SVG bar chart, bar stepper with entry/exit markers, condition list. ▶ Replay button in TradeRow expanded section. Files: backtests.py, backtests.ts, TradeReplayPanel.tsx, RunDetails.tsx.',
    'N3: Strategy Import/Export. GET /strategies/{id}/export returns versioned JSON payload. POST /strategies/import validates config, creates new Strategy+StrategyVersion rows with fresh IDs. Frontend: Import button (file picker) + Export button per card (hover-reveal, triggers browser download). Files: strategies.py, strategies.ts, Strategies.tsx.',
    'N4: Parameter Sensitivity Heatmap. ParamHeatmap component inline in ParamSearchTab results section. 2-axis selector (from param_grid keys), cell lookup builds "xVal|yVal" → best score, HSL gradient 0°=red 120°=green. Shows when 2+ param axes exist. File: OptimizationLab.tsx.',
    'N5: Pre-Market Checklist. PreMarketChecklist component: polls ET time each minute, triggers at 9am ET if live deployments exist. 6 checklist items, all required before "All Clear" button enables. Once-per-day via localStorage date key. Files: PreMarketChecklist.tsx, Layout.tsx.',
    'N6: Portfolio Snapshot. GET /governor/{account_id}/portfolio-snapshot aggregates capital by allocation, builds symbol overlap matrix and collision list (symbols in multiple programs). PortfolioSnapshotPanel collapsible in AccountGovernor — shows capital allocation table, collision warnings, program overlap pairs. Files: governor.py, governor.ts, AccountGovernor.tsx.',
    'N1-upgrade: Alpaca account event streaming. alpaca_account_stream.py: start_alpaca_account_stream() long-running coroutine, TradingStream, handle_trade_update() maps fills→order_fill, cancels→governor_event, broadcasts to ws_manager. Exponential backoff reconnect. Started in lifespan. Files: alpaca_account_stream.py, main.py.',
    'Program traceability: build_program_client_order_id() in alpaca_service.py — encodes program abbreviation + deployment_id + random suffix. Used in place_market_order() and place_limit_order(). Format: PROGABBREV-deploy8-rand8.',
    'N7: Strategy Version Diff Viewer. GET /strategies/{id}/versions/{v1_id}/diff/{v2_id} — flattens config to dot-paths, returns added/removed/changed lists. VersionDiffPanel.tsx: right-side drawer, color-coded sections. GitCompare icon on version list items in StrategyDetails. Files: strategies.py, strategies.ts, VersionDiffPanel.tsx, StrategyDetails.tsx.',
    'N8: Backup/Restore UI. GET /admin/backup streams SQLite file with timestamped filename. POST /admin/restore validates SQLite magic header, saves pre-restore backup, replaces DB atomically. BackupRestore page at /backup in System nav. Files: admin.py, admin.ts, BackupRestore.tsx, App.tsx, Layout.tsx.',
  ],
  nextSteps: [
    'ALL N-TASKS COMPLETE. Platform is fully built. Test sequence: Nav → Sim Lab → StrategyCreator → Optim Lab → Run Details → Programs → Deploy → Live Monitor → Backup.',
    'Consider: Live paper trading test with OtijiTrader00-Paper1 Alpaca credentials. Verify alpaca_account_stream.py picks up real fills and broadcasts to ws_manager.',
    'Consider: Wire program_name + deployment_id into governor loop order submissions so Alpaca orders carry the traceable client_order_id.',
  ],
  keyFiles: [
    // ── UX Phase 0–3 files ──
    { path: 'frontend/src/components/Layout.tsx', note: 'MODIFIED — nav reordered: Build / Test & Validate / Optimize / Deploy & Monitor / System' },
    { path: 'frontend/src/components/PageHelp.tsx', note: 'NEW — context-aware info drawer with PAGE_HELP_REGISTRY for all 10 key pages' },
    { path: 'frontend/src/components/StrategyBuilder/ConditionBuilder.tsx', note: 'MODIFIED — added vwap, opening_range_high, opening_range_low to INDICATORS' },
    { path: 'frontend/src/pages/OptimizationLab.tsx', note: 'MODIFIED — scope banner, WFA tab rename, WFA empty state, Param Search tab' },
    { path: 'frontend/src/pages/TradingPrograms.tsx', note: 'MODIFIED — workflow accordion, query param prefill (?strategy_version_id=)' },
    { path: 'frontend/src/pages/RunDetails.tsx', note: 'MODIFIED — Create Program button, Regime Suitability table, Strategy Diagnostics card' },
    { path: 'frontend/src/pages/SimulationLab.tsx', note: 'MODIFIED — source toggle pill (Strategy Version | Program)' },
    { path: 'frontend/src/pages/WatchlistLibrary.tsx', note: 'MODIFIED — Crown badge, Duplicate button, golden section, tags as chips' },
    { path: 'frontend/src/pages/RiskProfiles.tsx', note: 'MODIFIED — Crown badge, Duplicate button, golden section, style tags' },
    { path: 'frontend/src/pages/StrategyCreator.tsx', note: 'MODIFIED — Entry Module section, per-direction stop/target toggles (Both/Long/Short)' },
    { path: 'frontend/src/pages/AccountGovernor.tsx', note: 'MODIFIED — Add Program button + AddProgramModal (governor hot-add)' },
    { path: 'frontend/src/api/governor.ts', note: 'MODIFIED — added allocate() method for hot-add' },
    { path: 'frontend/src/api/simulations.ts', note: 'MODIFIED — added program_id to create request' },
    { path: 'frontend/src/api/watchlists.ts', note: 'MODIFIED — added is_golden, tags, delete, duplicate methods' },
    { path: 'frontend/src/api/riskProfiles.ts', note: 'MODIFIED — added is_golden, tags, duplicate method' },
    { path: 'frontend/src/api/backtests.ts', note: 'MODIFIED — added getRegimeAnalysis, getRecommendations, paramOptimize' },
    { path: 'backend/app/api/routes/governor.py', note: 'MODIFIED — added POST /governor/{account_id}/allocate (hot-add endpoint)' },
    { path: 'backend/app/api/routes/simulations.py', note: 'MODIFIED — accepts program_id, resolves to strategy_version_id via DB' },
    { path: 'backend/app/api/routes/watchlists.py', note: 'MODIFIED — golden guard (403), in-use guard (409), duplicate endpoint' },
    { path: 'backend/app/api/routes/risk_profiles.py', note: 'MODIFIED — golden guard, duplicate endpoint, is_golden/tags in responses' },
    { path: 'backend/app/api/routes/backtests.py', note: 'MODIFIED — regime-analysis and recommendations endpoints' },
    { path: 'backend/app/models/watchlist.py', note: 'MODIFIED — added is_golden, tags columns' },
    { path: 'backend/app/models/risk_profile.py', note: 'MODIFIED — added is_golden, tags columns' },
    { path: 'backend/app/main.py', note: 'MODIFIED — migrations for is_golden/tags, golden watchlist/risk profile seeds in seed_default_data()' },
    { path: 'backend/app/strategies/stops.py', note: 'MODIFIED — direction-aware config: {long:{...}, short:{...}} shape detected in calculate_stop + calculate_target' },
    { path: 'backend/app/core/backtest.py', note: 'MODIFIED — pending orders list, _process_pending_orders(), entry_module market/limit/stop routing' },
    { path: 'frontend/src/hooks/useWebSocket.ts', note: 'NEW (N1) — WS hook: auto-reconnect, stale indicator, typed WsEvent, 15s stale threshold' },
    { path: 'backend/app/api/routes/control.py', note: 'MODIFIED (N1) — _broadcast_kill_event() wired into kill-all, resume-all, kill-strategy' },
    { path: 'backend/app/api/routes/governor.py', note: 'MODIFIED (N1) — _broadcast_governor() wired into hot-add allocate endpoint' },
    { path: 'frontend/src/pages/LiveMonitor.tsx', note: 'MODIFIED (N1) — Live/Polling badge, useWebSocket hook, TanStack cache invalidation on WS events' },
    { path: 'backend/app/api/routes/backtests.py', note: 'MODIFIED (N2) — GET /{run_id}/trades/{trade_id}/replay — OHLCV window + annotations + conditions_fired' },
    { path: 'frontend/src/components/TradeReplayPanel.tsx', note: 'NEW (N2) — bar stepper, inline SVG chart, entry/exit/stop/target annotations, conditions list' },
    { path: 'frontend/src/api/backtests.ts', note: 'MODIFIED (N2) — added getTradeReplay()' },
    { path: 'frontend/src/pages/RunDetails.tsx', note: 'MODIFIED (N2) — TradeRow onReplay prop, replayTradeId state, TradeReplayPanel rendered below table' },
    { path: 'backend/app/api/routes/strategies.py', note: 'MODIFIED (N3) — GET /{id}/export, POST /import with format version validation and config pre-validation' },
    { path: 'frontend/src/api/strategies.ts', note: 'MODIFIED (N3) — added export() and import() methods' },
    { path: 'frontend/src/pages/Strategies.tsx', note: 'MODIFIED (N3) — Import button (file input), Export button per card (hover-reveal, browser download)' },
    { path: 'frontend/src/pages/OptimizationLab.tsx', note: 'MODIFIED (N4) — ParamHeatmap component: 2D param grid, HSL heat coloring, axis selectors' },
    { path: 'frontend/src/components/PreMarketChecklist.tsx', note: 'NEW (N5) — 9am ET checklist modal, 6 items, once-per-day, only for live deployments' },
    { path: 'frontend/src/components/Layout.tsx', note: 'MODIFIED (N5) — added <PreMarketChecklist /> to render' },
    { path: 'backend/app/api/routes/governor.py', note: 'MODIFIED (N6) — GET /{account_id}/portfolio-snapshot: capital, symbols, overlap matrix, collision warnings' },
    { path: 'frontend/src/api/governor.ts', note: 'MODIFIED (N6) — added portfolioSnapshot() method' },
    { path: 'frontend/src/pages/AccountGovernor.tsx', note: 'MODIFIED (N6) — PortfolioSnapshotPanel: capital table, collision warnings, overlap matrix' },
    { path: 'backend/app/services/alpaca_account_stream.py', note: 'NEW (N1-upgrade) — start_alpaca_account_stream(): TradingStream subscription, fills→order_fill events, exponential backoff' },
    { path: 'backend/app/services/alpaca_service.py', note: 'MODIFIED (traceability) — build_program_client_order_id() + program_name/deployment_id params in place_market_order/place_limit_order' },
    { path: 'backend/app/api/routes/strategies.py', note: 'MODIFIED (N7) — GET /{id}/versions/{v1_id}/diff/{v2_id}: flat dot-path diff, added/removed/changed lists' },
    { path: 'frontend/src/api/strategies.ts', note: 'MODIFIED (N7) — added diffVersions() method' },
    { path: 'frontend/src/components/VersionDiffPanel.tsx', note: 'NEW (N7) — right-side diff drawer: changed/added/removed sections, color-coded with val display' },
    { path: 'frontend/src/pages/StrategyDetails.tsx', note: 'MODIFIED (N7) — diffBaseVersionId state, GitCompare icon per version, VersionDiffPanel rendered' },
    { path: 'backend/app/api/routes/admin.py', note: 'NEW (N8) — GET /admin/backup (DB file download), POST /admin/restore (magic header check, pre-restore backup, atomic swap)' },
    { path: 'frontend/src/api/admin.ts', note: 'NEW (N8) — downloadBackup() triggers browser download, restore() posts FormData' },
    { path: 'frontend/src/pages/BackupRestore.tsx', note: 'NEW (N8) — download + restore UI with confirm dialog, warning banner, success/error feedback' },
    { path: 'frontend/src/App.tsx', note: 'MODIFIED (N8) — added /backup route + BackupRestore lazy import' },
    { path: 'frontend/src/components/Layout.tsx', note: 'MODIFIED (N8) — added Backup nav item to System group' },
    { path: 'docs/ULTRATRADER_MASTER_ROADMAP.md', note: 'UPDATED — N7 + N8 marked COMPLETE, all N tasks done' },
    // ── Architecture phase files ──
    { path: 'backend/app/services/market_data_bus.py', note: 'NEW — symbol-routed market data bus for runner fanout and DataBus testing' },
    { path: 'backend/app/services/deployment_runner.py', note: 'NEW — thin in-memory deployment runner seam for per-deployment bar delivery' },
    { path: 'backend/app/models/optimization.py', note: 'NEW — OptimizationProfile and WeightProfile lineage models, now threaded with SymbolUniverse snapshot IDs' },
    { path: 'backend/app/models/symbol_universe.py', note: 'NEW — persisted SymbolUniverse snapshots for optimizer and program lineage' },
    { path: 'backend/app/services/optimization_service.py', note: 'NEW — orchestrates ValidationEvidence + MarketMetadata + SymbolUniverse into persisted weight generation' },
    { path: 'backend/app/services/universe_service.py', note: 'NEW — resolves and persists immutable SymbolUniverse snapshots from watchlists' },
    { path: 'backend/app/api/routes/optimizations.py', note: 'NEW — optimization profile CRUD and weight-generation endpoints with universe lineage support' },
    { path: 'backend/app/api/routes/universes.py', note: 'NEW — transient and persisted SymbolUniverse resolution endpoints' },
    { path: 'backend/tests/test_market_data_bus.py', note: 'NEW — validates DataBus fanout into deployment runners' },
    { path: 'backend/tests/test_optimizer_framework.py', note: 'NEW — validates optimizer registry, normalization, and Phase 1 engine behavior' },
    { path: 'backend/tests/test_optimizations_api.py', note: 'NEW — validates optimization orchestration and persisted weight-generation workflow' },
    { path: 'backend/tests/test_universe_service.py', note: 'NEW — validates transient and persisted SymbolUniverse resolution' },
    { path: 'backend/tests/test_universes_api.py', note: 'NEW — validates SymbolUniverse API flows and persisted lookup' },
    { path: 'backend/app/services/alpaca_stream_manager.py', note: 'NEW — singleton Alpaca stream manager scaffold with deployment-to-symbol reconciliation and status reporting' },
    { path: 'backend/app/services/market_data_service.py', note: 'NEW — provider abstraction entrypoint used by data routes and backtest flows' },
    { path: 'backend/app/services/market_metadata_service.py', note: 'NEW — versioned MarketMetadata snapshot generation, persistence, and serialization helpers' },
    { path: 'backend/app/models/watchlist.py', note: 'NEW — Watchlist and WatchlistMembership models with resolved_at materialization state' },
    { path: 'backend/app/services/watchlist_service.py', note: 'NEW — server-side watchlist create/list/detail/refresh logic and membership normalization' },
    { path: 'backend/app/api/routes/data.py', note: 'MODIFIED — metadata snapshot and watchlist endpoints added to the data API' },
    { path: 'backend/app/api/routes/services.py', note: 'MODIFIED — exposes Alpaca stream manager status for operational visibility' },
    { path: 'backend/tests/test_alpaca_stream_manager.py', note: 'NEW — validates singleton stream manager subscription reconciliation behavior' },
    { path: 'backend/tests/test_data_api.py', note: 'MODIFIED — validates metadata snapshot routes and watchlist create/list/detail/refresh flows' },
    { path: 'backend/app/models/session_window.py', note: 'NEW — SessionWindowConfig dataclass, factory presets for day/swing/position, runtime checks' },
    { path: 'backend/app/core/pdt.py', note: 'NEW — PDTState, PDTLimitReached, rolling 5-session window, MARGIN sub-$25k hard block' },
    { path: 'backend/app/indicators/technical.py', note: 'MODIFIED — added hull_ma, donchian_channel, ichimoku, fractals' },
    { path: 'backend/app/indicators/regime.py', note: 'MODIFIED — vectorized np.where chains (was O(n) Python loop)' },
    { path: 'backend/app/indicators/support_resistance.py', note: 'MODIFIED — fixed double-merge bug (first-pass results were silently discarded)' },
    { path: 'backend/app/indicators/fvg.py', note: 'MODIFIED — ATR-normalized quality_score, atr_at_detection field' },
    { path: 'backend/app/models/strategy.py', note: 'MODIFIED — duration_mode column (DAY|SWING|POSITION)' },
    { path: 'backend/app/models/account.py', note: 'MODIFIED — account_mode column (CASH|MARGIN)' },
    { path: 'backend/app/api/routes/strategies.py', note: 'MODIFIED — duration_mode validation, IndicatorSpec union validation, clone endpoint' },
    { path: 'frontend/src/types/index.ts', note: 'MODIFIED — DurationMode, account_mode, IndicatorSpec discriminated union (20 variants), IndicatorKind alias' },
    { path: 'frontend/src/pages/LogsPanel.tsx', note: 'MODIFIED — Training Roadmap tab (replaced Program Backlog)' },
  ],
  phaseProtocol: [
    'PLAN — Read the phase steps in the roadmap. Read all files you will touch. Understand current state before writing a single line. If anything is ambiguous, resolve it against the architecture docs first.',
    'IMPLEMENT — Execute steps in order. Mark each step active in LogsPanel.tsx before starting it. Do not batch steps; complete one at a time.',
    'RUN TESTS / VALIDATIONS — After every step: run `python -m py_compile` on any modified Python file. Run `npx tsc --noEmit` on any modified TypeScript file. Run relevant unit tests if they exist. For backtest/indicator changes, run a smoke backtest and verify output shape.',
    'FIX ERRORS — Diagnose from the error message before changing anything. Fix the root cause, not the symptom. Retry. If still failing after 3 attempts, log the blocker in the step detail, apply a documented workaround, and continue. Never use --no-verify or skip hooks.',
    'REVIEW ARCHITECTURE ALIGNMENT — Before marking a step complete, verify: (1) no invariant was broken, (2) the change is consistent with the canonical layer stack, (3) no optimizer framework path was removed or simplified away.',
    'COMMIT — Stage only files relevant to the step. Write a concise commit message stating what and why. Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>.',
    'MOVE TO NEXT PHASE ONLY IF CLEAN — All steps in the current phase must be complete or have a logged workaround. TypeScript and Python must both compile clean. No regressions in previously passing tests. Roadmap updated with final statuses.',
  ],
  roadmapProtocol: [
    'The Training Roadmap in LogsPanel.tsx is the LIVE source of truth. It must stay current at all times.',
    'Before starting a step: set its status to "active" in the PHASES data in LogsPanel.tsx.',
    'After completing a step: set its status to "complete". Never leave a step as "active" when moving on.',
    'After completing all steps in a subphase: set the subphase status to "complete".',
    'After completing all subphases in a phase: set the phase status to "complete".',
    'When beginning a new phase: set that phase\'s status to "active" and its first subphase to "active".',
    'Update the AgentHandoffPanel "lastCompleted" and "currentStep" fields every session so the next agent can orient instantly.',
    'If a step is blocked (3 failed attempts, external dependency, or out-of-scope): set status to "blocked" and add a note in the step detail field describing the blocker and workaround.',
    'Never update the roadmap retroactively in bulk at the end of a session — update it as you go, step by step.',
  ],
  errorProtocol: [
    'Step 1 — DIAGNOSE: Read the full error message and stack trace. Identify the root cause before touching any code.',
    'Step 2 — FIX: Make a targeted change that addresses the root cause. Do not change unrelated code.',
    'Step 3 — RETRY: Re-run the failing command. If it passes, continue.',
    'Step 4 — If still failing (attempt 2): re-read the relevant file from scratch. Verify your mental model of the code matches reality.',
    'Step 5 — RETRY again. If it passes, continue.',
    'Step 6 — If still failing (attempt 3): document the exact error in the step detail in LogsPanel.tsx. Apply the simplest possible workaround that does not break any invariant. Set step status to "blocked" with a note. Log the issue and move on — do NOT stall the entire phase.',
    'NEVER: guess-fix by trying random changes. NEVER: use --no-verify, --force, or skip safety checks. NEVER: delete or rename a file to make an error disappear.',
  ],
  invariants: [
    'Institutional optimizer framework (P5–P9) is NON-NEGOTIABLE. Never simplify it away. Ship EqualWeight first, but protocol must be pluggable from the start.',
    'CPCV is primary overfitting guard (before walk-forward). Walk-forward is secondary.',
    'ValidationEvidence is separate from OptimizationProfile — stores CPCV fold results, IS/OOS ratio, cost sensitivity curve.',
    'client_order_id = f"{deployment_id}_{uuid4().hex[:8]}" — do not change this attribution scheme.',
    'CASH account mode: no shorts, no leverage, T+1 settlement. Separate code path from MARGIN. PDTState not instantiated for CASH.',
    'duration_mode lives on StrategyVersion, not TradingProgram or Deployment.',
    'Watchlists are global/user-owned, never account-scoped or program-scoped.',
    'TradingProgram is frozen on creation — any logic/universe/optimizer change requires a new version.',
    'Update roadmap step statuses in LogsPanel.tsx as each step completes. It is the live source of truth — never let it fall behind.',
  ],
}

function AgentHandoffPanel() {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded border border-violet-900/50 bg-violet-950/20">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <Bot size={14} className="text-violet-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-violet-300 flex-1">Agent Handoff Instructions</span>
        <span className="text-xs text-violet-600 mr-2">for next LLM / agent session</span>
        {open ? <ChevronDown size={13} className="text-violet-700" /> : <ChevronRight size={13} className="text-violet-700" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-violet-900/40 pt-3">
          <p className="text-xs text-violet-300/80">{AGENT_HANDOFF.summary}</p>

          <div className="rounded border border-amber-900/50 bg-amber-900/10 px-3 py-2 space-y-1">
            <div className="text-xs font-semibold text-amber-300 uppercase tracking-wide">Resume Here</div>
            <div className="text-xs text-amber-200 font-medium">{AGENT_HANDOFF.currentPhase}</div>
            <div className="text-xs text-amber-100/80">{AGENT_HANDOFF.currentStep}</div>
          </div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Last Completed</div>
            {AGENT_HANDOFF.lastCompleted.map((item, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-400">
                <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Next Steps (in order)</div>
            {AGENT_HANDOFF.nextSteps.map((item, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-400">
                <span className="text-gray-600 flex-shrink-0 font-mono w-4">{i + 1}.</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Key Files Created / Modified</div>
            {AGENT_HANDOFF.keyFiles.map(f => (
              <div key={f.path} className="flex gap-2 text-xs">
                <code className="text-sky-400 flex-shrink-0 font-mono">{f.path}</code>
                <span className="text-gray-500">— {f.note}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-violet-400 uppercase tracking-wide mb-2">Phase Execution Protocol — Run for Every Phase</div>
            {AGENT_HANDOFF.phaseProtocol.map((item, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-400">
                <span className="text-violet-600 flex-shrink-0 font-mono w-4">{i + 1}.</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-sky-400 uppercase tracking-wide mb-2">Roadmap Update Protocol — Keep the Source of Truth Current</div>
            {AGENT_HANDOFF.roadmapProtocol.map((item, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-400">
                <span className="text-sky-600 flex-shrink-0 font-mono">→</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-2">Error Protocol — Diagnose → Fix → Retry → Workaround</div>
            {AGENT_HANDOFF.errorProtocol.map((item, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-400">
                <span className="text-amber-600 flex-shrink-0 font-mono w-4">{i + 1}.</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">Hard Invariants — Do Not Break</div>
            {AGENT_HANDOFF.invariants.map((item, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-400">
                <AlertTriangle size={11} className="text-red-500 flex-shrink-0 mt-0.5" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RoadmapTab() {
  return (
    <div className="space-y-4">
      <ArchitecturePanel />
      <AgentHandoffPanel />
      <RoadmapHeader />
      <ApprovalBoard />
      <div className="space-y-3">
        {PHASES.map(phase => <PhaseBlock key={phase.id} phase={phase} />)}
      </div>
    </div>
  )
}

// ─── Risk Events Tab ──────────────────────────────────────────────────────────

function RiskEventsTab({
  events,
  isError,
  isFetching,
  refetch,
  limit,
  setLimit,
}: {
  events: any[]
  isError: boolean
  isFetching: boolean
  refetch: () => void
  limit: number
  setLimit: (value: number) => void
}) {
  const killCount = events.filter((e: any) => e.action === 'kill' || e.action === 'pause').length
  const resumeCount = events.filter((e: any) => e.action === 'resume').length

  return (
    <div className="space-y-4">
      {events.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-900/60 px-3 py-2 text-xs">
            <Shield size={13} className="text-gray-500" />
            <span className="text-gray-400">{events.length} total events</span>
          </div>
          {killCount > 0 && (
            <div className="flex items-center gap-2 rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs">
              <span className="text-red-400">{killCount} kill/pause</span>
            </div>
          )}
          {resumeCount > 0 && (
            <div className="flex items-center gap-2 rounded border border-emerald-800 bg-emerald-900/20 px-3 py-2 text-xs">
              <span className="text-emerald-400">{resumeCount} resume</span>
            </div>
          )}
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
          <span className="text-sm font-semibold">Kill Switch Event Log</span>
          <div className="flex items-center gap-3">
            {isFetching && <RefreshCw size={14} className="text-gray-500 animate-spin" />}
            <button type="button" className="btn-ghost text-sm flex items-center gap-1.5" onClick={refetch}>
              <RefreshCw size={13} /> Refresh
            </button>
            <span className="text-xs text-gray-500">{events.length} events</span>
            <SelectMenu
              value={String(limit)}
              onChange={v => setLimit(Number(v))}
              options={[
                { value: '50', label: 'Last 50' },
                { value: '100', label: 'Last 100' },
                { value: '500', label: 'Last 500' },
              ]}
            />
          </div>
        </div>
        {isError ? (
          <div className="text-center py-10 px-6 text-sm text-red-300">
            <AlertTriangle size={32} className="mx-auto mb-3 text-red-500" />
            Kill-switch event status is currently unavailable. Refresh before assuming the platform is quiet.
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-sm">
            <Shield size={32} className="mx-auto mb-3 text-gray-700" />
            No kill switch events — the platform has been running without interruptions.
          </div>
        ) : (
          <div className="font-mono text-xs divide-y divide-gray-800/50">
            {events.map((e: any, i: number) => (
              <div
                key={i}
                className={clsx(
                  'px-4 py-2.5 flex items-start gap-3 hover:bg-gray-800/20 transition-colors',
                  (e.action === 'kill' || e.action === 'pause') ? 'bg-red-950/10' : 'bg-emerald-950/5',
                )}
              >
                <span className="text-gray-600 whitespace-nowrap flex-shrink-0 mt-0.5">
                  {e.timestamp?.slice(0, 19).replace('T', ' ')}
                </span>
                <span className={clsx('badge flex-shrink-0', e.action === 'kill' ? 'badge-red' : e.action === 'pause' ? 'bg-amber-900 text-amber-300' : 'badge-green')}>
                  {e.action}
                </span>
                <span className={clsx('text-xs px-1.5 py-0.5 rounded flex-shrink-0', e.scope === 'global' ? 'bg-red-900/40 text-red-300' : e.scope === 'account' ? 'bg-sky-900/40 text-sky-300' : 'bg-gray-800 text-gray-400')}>
                  {e.scope}
                </span>
                {e.scope_id && <span className="text-gray-600 flex-shrink-0">{e.scope_id.slice(0, 8)}</span>}
                {e.reason && <span className="text-gray-400 truncate">- {e.reason}</span>}
                <span className="ml-auto text-gray-600 flex-shrink-0 text-right">{e.triggered_by}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FeatureEngineBuildTab() {
  const totalSlices = FEATURE_ENGINE_SLICES.length
  const completedSlices = FEATURE_ENGINE_SLICES.filter(slice => slice.status === 'complete').length
  const activeSlices = FEATURE_ENGINE_SLICES.filter(slice => slice.status === 'active').length
  const blockedSlices = FEATURE_ENGINE_SLICES.filter(slice => slice.status === 'blocked').length
  const blockedRemoval = FEATURE_ENGINE_BLOCKER_REMOVAL.filter(blocker => blocker.status === 'blocked').length
  const readinessPct = Math.round((completedSlices / totalSlices) * 100)
  const currentGate = FEATURE_ENGINE_SLICES.find(slice => slice.status === 'active')?.exitGate ?? 'No active slice'
  const currentGateBadge = FEATURE_ENGINE_SLICES.find(slice => slice.status === 'active')?.id === 'FEB-2'
    ? 'Deterministic feature plans'
    : 'Alpaca = default live ingress'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Feature Engine Build
            <Tooltip content="Doc-backed implementation slices, ingress boundaries, and bounded-context progress for the Feature Engine buildout.">
              <span className="text-xs text-sky-400 cursor-help border border-sky-800 rounded-full px-1.5 py-0.5">?</span>
            </Tooltip>
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Readiness evidence for the Feature Engine build: bounded contexts, Alpaca ingress assumptions, active slices, and exit gates.
          </p>
        </div>
        <div className="text-xs text-gray-500">
          Last verified {FEATURE_ENGINE_BUILD_LAST_VERIFIED}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-sky-500">Readiness</div>
          <div className="text-3xl font-bold text-sky-300 mt-1">{readinessPct}%</div>
          <div className="text-xs text-gray-500 mt-1">Spec and planning slices completed so far</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-emerald-500">Complete</div>
          <div className="text-3xl font-bold text-emerald-300 mt-1">{completedSlices}</div>
          <div className="text-xs text-gray-500 mt-1">Locked and documented slices</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-amber-500">Active</div>
          <div className="text-3xl font-bold text-amber-300 mt-1">{activeSlices}</div>
          <div className="text-xs text-gray-500 mt-1">Slices currently moving</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-rose-500">Blocked</div>
          <div className="text-3xl font-bold text-rose-300 mt-1">{blockedRemoval}</div>
          <div className="text-xs text-gray-500 mt-1">Blockers currently hard-stopping safe advancement</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-violet-500">Contexts</div>
          <div className="text-3xl font-bold text-violet-300 mt-1">{FEATURE_ENGINE_CONTEXTS.length}</div>
          <div className="text-xs text-gray-500 mt-1">Bounded contexts in scope</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-cyan-500">Surrounds</div>
          <div className="text-3xl font-bold text-cyan-300 mt-1">{FEATURE_ENGINE_SURROUNDS.length}</div>
          <div className="text-xs text-gray-500 mt-1">Neighbor systems and ingress paths</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Current Exit Gate</div>
              <div className="text-xs text-gray-500">The next proof point before the build can safely advance.</div>
            </div>
            <span className="text-[11px] px-2 py-1 rounded border border-sky-800 bg-sky-950/30 text-sky-300">
              {currentGateBadge}
            </span>
          </div>
          <div className="rounded border border-sky-900/50 bg-sky-950/10 p-3 text-sm text-gray-200">
            {currentGate}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Above The Fold</div>
              <div className="text-sm text-gray-300">
                The screen answers whether readiness is improving, what slice is active, and which ingress/control risks still block trust.
              </div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Source Of Truth</div>
              <div className="text-sm text-gray-300">
                This tab mirrors the design docs and slice contract. It is expected to move as an agent starts, blocks, resumes, and completes slices, with the deeper implementation truth remaining in <code>docs/</code>.
              </div>
            </div>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div>
            <div className="text-sm font-semibold">Current Blockers</div>
            <div className="text-xs text-gray-500">These are the gaps preventing a trustworthy runtime build today.</div>
          </div>
          <div className="space-y-2">
            {FEATURE_ENGINE_BLOCKER_REMOVAL.map((blocker) => (
              <div key={blocker.id} className="flex gap-2 rounded border border-red-900/40 bg-red-950/10 p-3 text-sm text-gray-300">
                <AlertTriangle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-100">{blocker.title}</span>
                    <span className={clsx('text-[11px] px-2 py-1 rounded border', featureBuildStatusTone(blocker.status))}>
                      {featureBuildStatusLabel(blocker.status)}
                    </span>
                    <span className="text-[11px] px-2 py-1 rounded bg-gray-800 text-gray-300">{blocker.ownerSlice}</span>
                  </div>
                  <div>{blocker.why}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Blocker Removal</div>
            <div className="text-xs text-gray-500">Execution-grade removal queue for the trust gaps that still block core delivery.</div>
          </div>
          <div className="text-xs text-gray-500">{FEATURE_ENGINE_BLOCKER_REMOVAL.length} blockers tracked</div>
        </div>
        <div className="space-y-3">
          {FEATURE_ENGINE_BLOCKER_REMOVAL.map((blocker) => (
            <details key={blocker.id} className="rounded border border-gray-800 bg-gray-950/40 open:border-sky-800/60" open={blocker.status === 'active' || blocker.status === 'blocked'}>
              <summary className="list-none cursor-pointer p-4">
                <div className="flex items-start gap-3">
                  <div className="w-16 text-xs text-gray-500 pt-0.5">{blocker.id}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-medium text-gray-100">{blocker.title}</div>
                      <span className={clsx('text-[11px] px-2 py-1 rounded border', featureBuildStatusTone(blocker.status))}>
                        {featureBuildStatusLabel(blocker.status)}
                      </span>
                      <span className="text-[11px] px-2 py-1 rounded bg-gray-800 text-gray-300">{blocker.ownerSlice}</span>
                    </div>
                    <div className="text-sm text-gray-300 mt-2">{blocker.why}</div>
                  </div>
                </div>
              </summary>
              <div className="px-4 pb-4 pt-0 grid gap-3 lg:grid-cols-2">
                <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Close Proof</div>
                  <div className="text-sm text-gray-300">{blocker.closeProof}</div>
                </div>
                <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Next Tasks</div>
                  <div className="space-y-2">
                    {blocker.nextTasks.map((task) => (
                      <div key={task} className="flex gap-2 text-sm text-gray-300">
                        <CheckCircle2 size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
                        <span>{task}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-gray-800 bg-gray-900/40 p-3 lg:col-span-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Primary File Targets</div>
                  <div className="flex flex-wrap gap-2">
                    {blocker.fileTargets.map((file) => (
                      <span key={file} className="text-[11px] px-2 py-1 rounded bg-gray-800 text-gray-300 break-all">
                        {file}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Bounded Contexts</div>
              <div className="text-xs text-gray-500">Responsibilities stay explicit so the Feature Engine does not absorb broker or strategy concerns.</div>
            </div>
            <div className="text-xs text-gray-500">{FEATURE_ENGINE_CONTEXTS.length} contexts</div>
          </div>
          <div className="space-y-3">
            {FEATURE_ENGINE_CONTEXTS.map((context) => (
              <div key={context.id} className="rounded border border-gray-800 bg-gray-950/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-100">{context.title}</div>
                    <div className="text-xs text-gray-500 mt-1">{context.boundary}</div>
                  </div>
                  <span className={clsx('text-[11px] px-2 py-1 rounded border', featureBuildStatusTone(context.status))}>
                    {featureBuildStatusLabel(context.status)}
                  </span>
                </div>
                <div className="text-sm text-gray-300 mt-3">{context.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Surrounding Systems</div>
              <div className="text-xs text-gray-500">Ingress and neighboring boundaries that the Feature Engine must consume without collapsing domains.</div>
            </div>
            <div className="text-xs text-gray-500">{FEATURE_ENGINE_SURROUNDS.length} surrounds</div>
          </div>
          <div className="space-y-3">
            {FEATURE_ENGINE_SURROUNDS.map((surround) => (
              <div key={surround.id} className="rounded border border-gray-800 bg-gray-950/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-100">{surround.title}</div>
                    <div className="text-xs text-gray-500 mt-1">{surround.role}</div>
                  </div>
                  <span className={clsx('text-[11px] px-2 py-1 rounded border', featureBuildStatusTone(surround.status))}>
                    {featureBuildStatusLabel(surround.status)}
                  </span>
                </div>
                <div className="text-sm text-gray-300 mt-3">{surround.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Build Slices</div>
            <div className="text-xs text-gray-500">Implementation sequence reviewed for ingress, context boundaries, runtime state, and governor safety.</div>
          </div>
          <div className="text-xs text-gray-500">{completedSlices}/{totalSlices} complete</div>
        </div>
        <div className="space-y-3">
          {FEATURE_ENGINE_SLICES.map((slice) => (
            <details key={slice.id} className="rounded border border-gray-800 bg-gray-950/40 open:border-sky-800/60" open={slice.status === 'active'}>
              <summary className="list-none cursor-pointer p-4">
                <div className="flex items-start gap-3">
                  <div className="w-16 text-xs text-gray-500 pt-0.5">{slice.id}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-medium text-gray-100">{slice.title}</div>
                      <span className={clsx('text-[11px] px-2 py-1 rounded border', featureBuildStatusTone(slice.status))}>
                        {featureBuildStatusLabel(slice.status)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-300 mt-2">{slice.objective}</div>
                  </div>
                </div>
              </summary>
              <div className="px-4 pb-4 pt-0 grid gap-3 lg:grid-cols-2">
                <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Exit Gate</div>
                  <div className="text-sm text-gray-300">{slice.exitGate}</div>
                </div>
                <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Contexts</div>
                  <div className="flex flex-wrap gap-2">
                    {slice.contexts.map((context) => (
                      <span key={context} className="text-[11px] px-2 py-1 rounded bg-gray-800 text-gray-300">
                        {context}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Deliverables</div>
                  <div className="space-y-2">
                    {slice.deliverables.map((deliverable) => (
                      <div key={deliverable} className="flex gap-2 text-sm text-gray-300">
                        <CheckCircle2 size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
                        <span>{deliverable}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Dependencies</div>
                  <div className="space-y-2">
                    {(slice.dependencies ?? ['No blocking slice dependency']).map((dependency) => (
                      <div key={dependency} className="flex gap-2 text-sm text-gray-300">
                        <Layers size={14} className="text-violet-400 flex-shrink-0 mt-0.5" />
                        <span>{dependency}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          ))}
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Reference Docs</div>
            <div className="text-xs text-gray-500">Design sources backing this screen and the active implementation plan.</div>
          </div>
          <div className="text-xs text-gray-500">{FEATURE_ENGINE_REFERENCE_DOCS.length} docs</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {FEATURE_ENGINE_REFERENCE_DOCS.map((docPath) => (
            <div key={docPath} className="rounded border border-gray-800 bg-gray-950/40 p-3">
              <div className="flex items-center gap-2 text-sm text-gray-100">
                <FileText size={14} className="text-sky-400 flex-shrink-0" />
                <span className="break-all">{docPath}</span>
              </div>
              <div className="text-xs text-gray-500 mt-2">Reference design source for the Feature Engine build and control boundaries.</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


function JourneyValidationsTab() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'covered' | 'partial' | 'not_covered'>('all')
  const [domainFilter, setDomainFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [focusFilter, setFocusFilter] = useState<'all' | 'stop_ship' | 'realtime' | 'partial_fill' | 'above_fold' | 'wording'>('all')
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt, errorUpdatedAt } = useQuery<UserJourneyValidationsResponse>({
    queryKey: ['user-journey-validations'],
    queryFn: () => adminApi.getUserJourneyValidations(),
  })

  // All hooks must be called unconditionally before any early returns
  const journeys = data?.journeys ?? []

  const domains = useMemo(
    () => ['all', ...Array.from(new Set(journeys.map(j => j.domain))).sort()],
    [journeys],
  )
  const priorities = useMemo(
    () => ['all', ...Array.from(new Set(journeys.map(j => j.priority))).sort()],
    [journeys],
  )

  const filteredJourneys = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return journeys.filter(j => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false
      if (domainFilter !== 'all' && j.domain !== domainFilter) return false
      if (priorityFilter !== 'all' && j.priority !== priorityFilter) return false
      if (focusFilter === 'stop_ship' && !j.priority.includes('P0')) return false
      if (focusFilter === 'realtime' && !journeyMatches(j, /WS|websocket|news stream|symbol stream|realtime|live feed/i)) return false
      if (focusFilter === 'partial_fill' && !journeyMatches(j, /partial fill/i)) return false
      if (focusFilter === 'above_fold' && !journeyMatches(j, /above-the-fold|above the fold|big numbers|readable charts|readable text/i)) return false
      if (focusFilter === 'wording' && !journeyMatches(j, /tooltip|tooltips|menu names|dropdown|help text|context help|wording/i)) return false
      if (!needle) return true
      return [
        String(j.id),
        j.domain,
        j.title,
        j.pages_components,
        j.api_routes,
        j.required_steps,
        j.edge_cases,
        j.priority,
      ].join(' ').toLowerCase().includes(needle)
    })
  }, [journeys, search, statusFilter, domainFilter, priorityFilter, focusFilter])

  const totals = useMemo(() => {
    const covered = journeys.filter(j => j.status === 'covered').length
    const partial = journeys.filter(j => j.status === 'partial').length
    const notCovered = journeys.filter(j => j.status === 'not_covered').length
    const websocket = journeys.filter(j => /WS|websocket|news stream|symbol stream/i.test(`${j.api_routes} ${j.edge_cases}`)).length
    const partialFill = journeys.filter(j => /partial fill/i.test(`${j.title} ${j.required_steps} ${j.edge_cases}`)).length
    const aboveFold = journeys.filter(j => /above-the-fold|above the fold/i.test(`${j.required_steps} ${j.edge_cases}`)).length
    return { covered, partial, notCovered, websocket, partialFill, aboveFold, total: journeys.length }
  }, [journeys])

  const domainSummary = useMemo(() => {
    return domains
      .filter(d => d !== 'all')
      .map(domain => {
        const rows = journeys.filter(j => j.domain === domain)
        const covered = rows.filter(j => j.status === 'covered').length
        const partial = rows.filter(j => j.status === 'partial').length
        const notCovered = rows.filter(j => j.status === 'not_covered').length
        return { domain, total: rows.length, covered, partial, notCovered }
      })
  }, [domains, journeys])

  const pct = (n: number, total: number) => total > 0 ? Math.round((n / total) * 100) : 0
  const hasRefreshError = Boolean(data) && errorUpdatedAt > dataUpdatedAt

  if (isLoading) return <div className="p-4 text-sm text-gray-400">Loading user journeys…</div>
  if (isError) {
    return (
      <div className="card p-4 text-sm text-red-400 flex items-center justify-between">
        <span>Failed to load user journeys.</span>
        <button className="btn-ghost" onClick={() => refetch()}>Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Journey Validation Hub
            <Tooltip content="Operations-grade checklist of product flows, edge cases, websocket paths, partial-fill handling, and UI acceptance expectations.">
              <span className="text-xs text-sky-400 cursor-help border border-sky-800 rounded-full px-1.5 py-0.5">?</span>
            </Tooltip>
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Expanded validation matrix for critical flows, edge cases, above-the-fold UX, realtime feeds, and operator safety.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-500">Last good refresh {formatEtTimestamp(dataUpdatedAt)}</div>
          <button className="btn-ghost" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <ValidationQueryStatusBanner
        isFetching={isFetching}
        lastSuccessAt={dataUpdatedAt}
        hasRefreshError={hasRefreshError}
        label="Journey Validation Hub"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Total Journeys</div>
          <div className="text-3xl font-bold text-white mt-1">{totals.total}</div>
          <div className="text-xs text-gray-500 mt-1">Full matrix including operator and realtime cases</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-emerald-500">Covered</div>
          <div className="text-3xl font-bold text-emerald-300 mt-1">{totals.covered}</div>
          <div className="text-xs text-gray-500 mt-1">{pct(totals.covered, totals.total)}% automated</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-amber-500">Partial</div>
          <div className="text-3xl font-bold text-amber-300 mt-1">{totals.partial}</div>
          <div className="text-xs text-gray-500 mt-1">Needs deeper E2E or edge-case coverage</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-rose-500">Not Covered</div>
          <div className="text-3xl font-bold text-rose-300 mt-1">{totals.notCovered}</div>
          <div className="text-xs text-gray-500 mt-1">Highest validation gap</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-sky-500">Realtime / WS</div>
          <div className="text-3xl font-bold text-sky-300 mt-1">{totals.websocket}</div>
          <div className="text-xs text-gray-500 mt-1">Journeys touching streams or live feeds</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-violet-500">Partial Fill / Above Fold</div>
          <div className="text-3xl font-bold text-violet-300 mt-1">{totals.partialFill + totals.aboveFold}</div>
          <div className="text-xs text-gray-500 mt-1">{totals.partialFill} partial-fill, {totals.aboveFold} above-the-fold</div>
        </div>
      </div>

      <div className="card p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Domain Progress</div>
            <div className="text-xs text-gray-500">Readable coverage bars by domain so missing slices stand out immediately.</div>
          </div>
          <div className="text-xs text-gray-500">{domainSummary.length} domains</div>
        </div>
        <div className="space-y-3">
          {domainSummary.map((row) => (
            <div key={row.domain} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-gray-200">{row.domain}</span>
                <span className="text-gray-500">{row.covered}/{row.total} covered</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden bg-gray-900 flex">
                <div className="bg-emerald-500" style={{ width: `${pct(row.covered, row.total)}%` }} />
                <div className="bg-amber-500" style={{ width: `${pct(row.partial, row.total)}%` }} />
                <div className="bg-gray-700" style={{ width: `${pct(row.notCovered, row.total)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Filters</div>
            <div className="text-xs text-gray-500">Search journey text, scope to domain/priority/status, and jump straight into the highest-risk lenses without missing steps.</div>
          </div>
          <div className="text-xs text-gray-500">{filteredJourneys.length} matching journeys</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[
            { value: 'all', label: 'All Lenses' },
            { value: 'stop_ship', label: `Stop-Ship (${journeys.filter(j => j.priority.includes('P0')).length})` },
            { value: 'realtime', label: `Realtime / WS (${journeys.filter(j => journeyMatches(j, /WS|websocket|news stream|symbol stream|realtime|live feed/i)).length})` },
            { value: 'partial_fill', label: `Partial Fill (${journeys.filter(j => journeyMatches(j, /partial fill/i)).length})` },
            { value: 'above_fold', label: `Above Fold (${journeys.filter(j => journeyMatches(j, /above-the-fold|above the fold|big numbers|readable charts|readable text/i)).length})` },
            { value: 'wording', label: `Menus / Tooltips (${journeys.filter(j => journeyMatches(j, /tooltip|tooltips|menu names|dropdown|help text|context help|wording/i)).length})` },
          ].map((lens) => (
            <button
              key={lens.value}
              type="button"
              className={clsx(
                'rounded border px-3 py-1.5 text-xs transition-colors',
                focusFilter === lens.value
                  ? 'border-sky-700 bg-sky-950/40 text-sky-200'
                  : 'border-gray-800 bg-gray-950/40 text-gray-400 hover:text-gray-200',
              )}
              onClick={() => setFocusFilter(lens.value as typeof focusFilter)}
            >
              {lens.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search titles, routes, steps, edge cases, websocket, partial fill, above-the-fold..."
            className="input w-full"
          />
          <SelectMenu
            value={statusFilter}
            onChange={v => setStatusFilter(v as typeof statusFilter)}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'covered', label: 'Covered' },
              { value: 'partial', label: 'Partial' },
              { value: 'not_covered', label: 'Not Covered' },
            ]}
          />
          <SelectMenu
            value={domainFilter}
            onChange={setDomainFilter}
            options={domains.map(domain => ({ value: domain, label: domain === 'all' ? 'All Domains' : domain }))}
          />
          <SelectMenu
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={priorities.map(priority => ({ value: priority, label: priority === 'all' ? 'All Priorities' : priority }))}
          />
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">Journey Checklist</div>
            <div className="text-xs text-gray-500">Expanded to include required steps, edge cases, and acceptance conditions.</div>
          </div>
          <div className="text-xs text-gray-500">Showing {filteredJourneys.length} of {journeys.length}</div>
        </div>
        <div className="space-y-3">
          {filteredJourneys.map((j) => (
            <details key={j.id} className="rounded border border-gray-800 bg-gray-950/40 open:border-sky-700/60">
              <summary className="list-none cursor-pointer p-4">
                <div className="flex items-start gap-3">
                  <div className="text-xs text-gray-500 w-10 pt-0.5">#{j.id}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-medium text-gray-100">{j.title}</div>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-300">{j.domain}</span>
                      <span className={clsx(
                        'text-[11px] px-2 py-0.5 rounded',
                        j.priority.includes('P0') ? 'bg-red-900/50 text-red-300' :
                        j.priority.includes('P1') ? 'bg-amber-900/50 text-amber-300' :
                        'bg-sky-900/50 text-sky-300',
                      )}>
                        {j.priority}
                      </span>
                      <span className={clsx(
                        'text-[11px] px-2 py-0.5 rounded',
                        j.status === 'covered' ? 'bg-emerald-900 text-emerald-300' :
                        j.status === 'partial' ? 'bg-amber-900 text-amber-300' :
                        'bg-gray-800 text-gray-400',
                      )}>
                        {j.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{j.pages_components}</div>
                    <div className="text-xs text-gray-600 mt-1 truncate">{j.api_routes}</div>
                  </div>
                </div>
              </summary>
              <div className="px-4 pb-4 pt-0 grid gap-4 xl:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Required Steps</div>
                  <div className="space-y-2">
                    {splitChecklist(j.required_steps).map((step, idx) => (
                      <div key={idx} className="flex gap-2 text-sm text-gray-300">
                        <CheckCircle2 size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Edge Cases / Acceptance</div>
                  <div className="space-y-2">
                    {splitChecklist(j.edge_cases).map((item, idx) => (
                      <div key={idx} className="flex gap-2 text-sm text-gray-300">
                        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="xl:col-span-2 grid gap-3 lg:grid-cols-2">
                  <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Routes / Streams</div>
                    <div className="text-sm text-gray-300 break-words">{j.api_routes}</div>
                  </div>
                  <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">UI Surface</div>
                    <div className="text-sm text-gray-300 break-words">{j.pages_components}</div>
                  </div>
                </div>
              </div>
            </details>
          ))}
          {filteredJourneys.length === 0 && (
            <div className="text-center py-10 text-sm text-gray-500">
              No journeys match the current filters.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function IssuesTab() {
  const [search, setSearch] = useState('')
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt, errorUpdatedAt } = useQuery<UserJourneyValidationsResponse>({
    queryKey: ['user-journey-validations'],
    queryFn: () => adminApi.getUserJourneyValidations(),
  })

  const journeys = data?.journeys ?? []

  const featureIssues = useMemo(
    () => FEATURE_ENGINE_BLOCKER_REMOVAL.filter(blocker => blocker.status !== 'complete').map(deriveFeatureIssue),
    [],
  )
  const journeyIssues = useMemo(
    () => journeys.filter(journey => journey.status !== 'covered').map(deriveJourneyIssue).sort(compareIssues),
    [journeys],
  )
  const allIssues = useMemo(
    () => [...featureIssues, ...journeyIssues].sort(compareIssues),
    [featureIssues, journeyIssues],
  )

  const filteredIssues = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return allIssues
    return allIssues.filter(issue =>
      [
        issue.id,
        issue.category,
        issue.title,
        issue.status,
        issue.scope,
        issue.summary,
        issue.tags.join(' '),
        issue.nextActions.join(' '),
        ...(issue.fileTargets ?? []),
      ].join(' ').toLowerCase().includes(needle),
    )
  }, [allIssues, search])

  const stopShipCount = useMemo(
    () => journeyIssues.filter(issue => issue.severity === 'critical').length + featureIssues.filter(issue => issue.severity === 'critical').length,
    [featureIssues, journeyIssues],
  )
  const realtimeCount = useMemo(
    () => journeyIssues.filter(issue => issue.tags.includes('Realtime / WS')).length,
    [journeyIssues],
  )
  const partialFillCount = useMemo(
    () => journeyIssues.filter(issue => issue.tags.includes('Partial Fill')).length,
    [journeyIssues],
  )
  const operatorUxCount = useMemo(
    () => journeyIssues.filter(issue => issue.tags.includes('Above the Fold') || issue.tags.includes('Operator UX / Wording')).length,
    [journeyIssues],
  )
  const featuredJourneyIssues = useMemo(
    () => journeyIssues.filter(issue => issue.severity === 'critical').slice(0, 8),
    [journeyIssues],
  )
  const hasRefreshError = Boolean(data) && errorUpdatedAt > dataUpdatedAt

  if (isLoading) return <div className="p-4 text-sm text-gray-400">Loading issue ledger…</div>
  if (isError) {
    return (
      <div className="card p-4 text-sm text-red-400 flex items-center justify-between">
        <span>Failed to load the issue ledger.</span>
        <button className="btn-ghost" onClick={() => refetch()}>Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Issues Ledger
            <Tooltip content="Mission-critical open issues synthesized from Feature Engine blockers and the current uncovered or partial user-journey matrix.">
              <span className="text-xs text-sky-400 cursor-help border border-sky-800 rounded-full px-1.5 py-0.5">?</span>
            </Tooltip>
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Separate operator view for current blockers, stop-ship journey gaps, realtime risks, partial-fill risks, and UX ambiguity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-500">Last good refresh {formatEtTimestamp(dataUpdatedAt)}</div>
          <button className="btn-ghost" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <ValidationQueryStatusBanner
        isFetching={isFetching}
        lastSuccessAt={dataUpdatedAt}
        hasRefreshError={hasRefreshError}
        label="Issues Ledger"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Open Issues</div>
          <div className="text-3xl font-bold text-white mt-1">{allIssues.length}</div>
          <div className="text-xs text-gray-500 mt-1">Feature blockers plus uncovered and partial journeys</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-red-500">Stop-Ship</div>
          <div className="text-3xl font-bold text-red-300 mt-1">{stopShipCount}</div>
          <div className="text-xs text-gray-500 mt-1">Critical blockers and `P0` journey gaps</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-amber-500">Feature Blockers</div>
          <div className="text-3xl font-bold text-amber-300 mt-1">{featureIssues.length}</div>
          <div className="text-xs text-gray-500 mt-1">Active or blocked Feature Engine trust gaps</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-sky-500">Realtime / Partial Fill</div>
          <div className="text-3xl font-bold text-sky-300 mt-1">{realtimeCount + partialFillCount}</div>
          <div className="text-xs text-gray-500 mt-1">{realtimeCount} realtime, {partialFillCount} partial-fill</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-violet-500">Above Fold / Wording</div>
          <div className="text-3xl font-bold text-violet-300 mt-1">{operatorUxCount}</div>
          <div className="text-xs text-gray-500 mt-1">UX readability and operator-language gaps</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Current Feature / Architecture Blockers</div>
              <div className="text-xs text-gray-500">These stay open until closing proof exists. They are not soft backlog items.</div>
            </div>
            <div className="text-xs text-gray-500">{featureIssues.length} open blockers</div>
          </div>
          <div className="space-y-3">
            {featureIssues.map((issue) => (
              <div key={issue.id} className="rounded border border-gray-800 bg-gray-950/40 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={clsx('text-[11px] px-2 py-0.5 rounded uppercase tracking-wide', issueSeverityTone(issue.severity))}>
                        {issue.severity}
                      </span>
                      <span className={clsx('text-[11px] px-2 py-0.5 rounded', issueStatusTone(issue.status))}>
                        {issue.status}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-300">{issue.scope}</span>
                    </div>
                    <div className="font-medium text-gray-100 mt-2">{issue.title}</div>
                    <div className="text-sm text-gray-400 mt-1">{issue.summary}</div>
                  </div>
                  <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
                </div>
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Next Actions</div>
                  {issue.nextActions.map((step, index) => (
                    <div key={`${issue.id}-step-${index}`} className="flex gap-2 text-sm text-gray-300">
                      <ChevronRight size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Highest-Risk Journey Gaps</div>
              <div className="text-xs text-gray-500">Focus first on `P0` flows, partial-fill handling, realtime freshness, and operator ambiguity.</div>
            </div>
            <div className="text-xs text-gray-500">{featuredJourneyIssues.length} featured issues</div>
          </div>
          <div className="space-y-3">
            {featuredJourneyIssues.map((issue) => (
              <div key={issue.id} className="rounded border border-gray-800 bg-gray-950/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={clsx('text-[11px] px-2 py-0.5 rounded uppercase tracking-wide', issueSeverityTone(issue.severity))}>
                        {issue.severity}
                      </span>
                      <span className={clsx('text-[11px] px-2 py-0.5 rounded', issueStatusTone(issue.status))}>
                        {issue.status}
                      </span>
                    </div>
                    <div className="font-medium text-gray-100 mt-2">{issue.title}</div>
                    <div className="text-xs text-gray-500 mt-1">{issue.scope}</div>
                    <div className="text-sm text-gray-400 mt-2">{issue.summary}</div>
                  </div>
                  <Target size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                </div>
                <div className="flex gap-2 flex-wrap mt-3">
                  {issue.tags.map((tag) => (
                    <span key={`${issue.id}-${tag}`} className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-300">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Issue Search</div>
            <div className="text-xs text-gray-500">Search blockers and journey gaps by scope, tags, summaries, routes, and next actions.</div>
          </div>
          <div className="text-xs text-gray-500">{filteredIssues.length} matching issues</div>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search stop-ship, websocket, partial fill, above-the-fold, tooltip, calendar, pause, flatten..."
          className="input w-full"
        />
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">Open Issue Ledger</div>
            <div className="text-xs text-gray-500">This is the separate tab for open issues. It stays derived from the blockers and journey matrix, not a second manual backlog.</div>
          </div>
          <div className="text-xs text-gray-500">Showing {filteredIssues.length} of {allIssues.length}</div>
        </div>
        <div className="space-y-3">
          {filteredIssues.map((issue) => (
            <details key={issue.id} className="rounded border border-gray-800 bg-gray-950/40 open:border-sky-700/60">
              <summary className="list-none cursor-pointer p-4">
                <div className="flex items-start gap-3">
                  <div className="text-xs text-gray-500 w-16 pt-0.5">{issue.id}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={clsx('text-[11px] px-2 py-0.5 rounded uppercase tracking-wide', issueSeverityTone(issue.severity))}>
                        {issue.severity}
                      </span>
                      <span className={clsx('text-[11px] px-2 py-0.5 rounded', issueStatusTone(issue.status))}>
                        {issue.status}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-300">{issue.category}</span>
                    </div>
                    <div className="font-medium text-gray-100 mt-2">{issue.title}</div>
                    <div className="text-xs text-gray-500 mt-1">{issue.scope}</div>
                    <div className="text-xs text-gray-600 mt-1 truncate">{issue.summary}</div>
                  </div>
                </div>
              </summary>
              <div className="px-4 pb-4 pt-0 grid gap-4 xl:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Next Actions</div>
                  <div className="space-y-2">
                    {issue.nextActions.map((step, index) => (
                      <div key={`${issue.id}-action-${index}`} className="flex gap-2 text-sm text-gray-300">
                        <CheckCircle2 size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Tags</div>
                  <div className="flex gap-2 flex-wrap">
                    {issue.tags.map((tag) => (
                      <span key={`${issue.id}-tag-${tag}`} className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-300">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                {issue.fileTargets && issue.fileTargets.length > 0 && (
                  <div className="xl:col-span-2 rounded border border-gray-800 bg-gray-900/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Primary File Targets</div>
                    <div className="space-y-1">
                      {issue.fileTargets.map((filePath) => (
                        <div key={`${issue.id}-${filePath}`} className="text-sm text-gray-300 break-all">
                          {filePath}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          ))}
          {filteredIssues.length === 0 && (
            <div className="text-center py-10 text-sm text-gray-500">
              No issues match the current search.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function LogsPanel() {
  const pausePolling = usePollingGate()
  const [limit, setLimit] = useState(100)
  const [activeTab, setActiveTab] = useState<LogsTab>('events')

  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['kill-events', limit],
    queryFn: () => controlApi.events(limit),
    refetchInterval: pausePolling ? false : 10_000,
  })

  const events = data?.events ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Logs & Alerts</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Risk control events, open issues, readiness evidence, and implementation roadmaps
          </p>
        </div>
      </div>

      <div className="border-b border-gray-800">
        <div className="flex gap-1">
          <button
            type="button"
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2',
              activeTab === 'events'
                ? 'text-sky-400 border-sky-500'
                : 'text-gray-500 border-transparent hover:text-gray-300',
            )}
            onClick={() => setActiveTab('events')}
          >
            Risk Events
          </button>
          <button
            type="button"
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2',
              activeTab === 'roadmap'
                ? 'text-sky-400 border-sky-500'
                : 'text-gray-500 border-transparent hover:text-gray-300',
            )}
            onClick={() => setActiveTab('roadmap')}
          >
            Training Roadmap
          </button>
          <button
            type="button"
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2',
              activeTab === 'journeys'
                ? 'text-sky-400 border-sky-500'
                : 'text-gray-500 border-transparent hover:text-gray-300',
            )}
            onClick={() => setActiveTab('journeys')}
          >
            Journey Validation Hub
          </button>
          <button
            type="button"
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2',
              activeTab === 'issues'
                ? 'text-sky-400 border-sky-500'
                : 'text-gray-500 border-transparent hover:text-gray-300',
            )}
            onClick={() => setActiveTab('issues')}
          >
            Issues
          </button>
          <button
            type="button"
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2',
              activeTab === 'feature_build'
                ? 'text-sky-400 border-sky-500'
                : 'text-gray-500 border-transparent hover:text-gray-300',
            )}
            onClick={() => setActiveTab('feature_build')}
          >
            Feature Engine Build
          </button>
        </div>
      </div>

      {activeTab === 'events' ? (
        <RiskEventsTab
          events={events}
          isError={isError}
          isFetching={isFetching}
          refetch={refetch}
          limit={limit}
          setLimit={setLimit}
        />
      ) : activeTab === 'journeys' ? (
        <JourneyValidationsTab />
      ) : activeTab === 'issues' ? (
        <IssuesTab />
      ) : activeTab === 'feature_build' ? (
        <FeatureEngineBuildTab />
      ) : (
        <RoadmapTab />
      )}
    </div>
  )
}
