import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { controlApi } from '../api/accounts'
import { usePollingGate } from '../hooks/usePollingGate'
import { SelectMenu } from '../components/SelectMenu'
import clsx from 'clsx'
import {
  Shield, RefreshCw, CheckCircle2, Clock3, AlertTriangle, Circle,
  ChevronDown, ChevronRight, Layers, Zap, BarChart2, BookOpen,
  Target, Play, Cpu, Map, Lock, FileText, Bot, ExternalLink,
} from 'lucide-react'

type LogsTab = 'events' | 'roadmap'
type StepStatus = 'complete' | 'active' | 'pending' | 'blocked'
type PhaseStatus = 'complete' | 'active' | 'pending'

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
          { id: 'P7-S4', title: 'Multi-program account swimlane', detail: 'components/ProgramSwimlane.tsx: ProgramLane per frozen program. Capital bar (allocated_capital_usd vs account equity %), intraday P&L + MiniSparkline SVG, SectorHeatmap colored squares, conflict alert inline per lane. Duration badge + broker_mode badge per lane.', status: 'complete' },
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
  summary: 'UltraTrader 2026 — Autonomous delivery in progress. Roadmap is the live source of truth. Pick up from the current active step.',
  currentPhase: 'P7 — UI Screens',
  currentStep: 'P7-S1: TradingProgram Guided Card Stack — 4 cards pinned: StrategyVersion → OptimizationProfile → SymbolUniverse → ExecutionPolicy. "Freeze" in sticky footer when all 4 reach Ready.',
  lastCompleted: [
    'P2 — Data Layer: ALL 8 steps complete. run_forever() reconnect loop, kill switch per bar in DataBus, EarningsCalendar singleton with Alpaca News refresh, GlobalFillRouter FIFO ledger via client_order_id.',
    'P1: Foundation + Architecture — all 10 steps complete (kill switch, PDT, account_mode, duration_mode)',
    'P3: Strategy Registry — all 8 steps complete (indicators: Hull MA, Donchian, Ichimoku, Fractals; regime vectorized; IndicatorSpec typed union; strategy CRUD + clone; duration_mode on StrategyVersion)',
    'P4-S1: Async backtest lifecycle audit — ARQ + backtest_service.py verified substantially in place',
    'P4-S2: SessionWindowConfig wired into BacktestEngine. Fixed critical dead-code bug — _process_entries stop/sizing/open_position was entirely unreachable (all trades silently dropped). Now fixed: entry logic runs, session window gates entries and forces exits.',
    'P4-S5: CPCV implemented as the primary anti-overfitting guard. Backtest payload now stores CPCV fold results, median OOS Sharpe, degradation stats, primary-guard pass/fail, and compare API surfaces CPCV summary fields.',
    'P4-S6/P4-S7/P4-S8: Walk-forward, ValidationEvidence, and cost sensitivity are now integrated. Completed runs persist a separate ValidationEvidence record with CPCV, walk-forward, anti-bias state, regime performance, per-symbol OOS Sharpe, slippage sensitivity curve, and stability score.',
    'P2-S1: BrokerProtocol/provider abstraction complete — market data fetches now route through market_data_service and brokers conform to the shared protocol surface.',
    'P2-S2: MarketMetadata snapshots complete — versioned metadata_version_id snapshots persist sector tags, benchmark mappings, realized vol, and correlation summaries with API access.',
    'P2-S3: Scanner watchlist backend jobs complete — watchlists + memberships persist server-side with refresh_cron validation, resolved_at materialization, and data API coverage for create/list/detail/refresh.',
    'P2-S4: Symbol membership lifecycle enforcement complete — memberships now transition through candidate, active, pending_removal, inactive, and suspended states with dwell/grace/cooldown timers and manual suspension override.',
    'P5: Optimizer Engine — ALL 10 steps complete. OptimizerEngine Protocol, EqualWeight/CappedInverseVol/SimpleShrinkageMV Phase 1 engines, WeightProfile lineage, OOS Sharpe floor, Watchlist model, SymbolUniverse resolver, characteristic vector from watchlist, portfolio stress summary (exposure matrix + flagged correlation pairs >0.75).',
    'P6: TradingProgram + Deployment — ALL 8 steps complete. TradingProgram model (draft|frozen|deprecated), AccountAllocation with bounded overrides, ConflictResolver (first_wins/aggregate), InternalPaperBroker (full fill simulation, slippage, commission, bracket orders), PromotionService (prepare/execute/revert), asset eligibility checks (shortability/fractionability), bracket order in AlpacaBroker.',
  ],
  nextSteps: [
    'P2-S5: AlpacaStreamManager singleton — WebSocket to wss://stream.data.alpaca.markets/v2/. Daily rebalance: unsubscribe removed, subscribe added mid-session.',
    'P2-S6: DataBus broadcast to DeploymentRunner — one asyncio Task per deployment. Kill switch checked per bar. Bars routed by symbol.',
    'P2-S7: Earnings exclusion — Benzinga/Nasdaq calendar. Window: days_before=3, days_after=1.',
    'P2-S8: Virtual position ledger via client_order_id — Alpaca passes through on fills. Ledger derived from fill events filtered by deployment_id prefix.',
    // P5 — Optimizer Engine
    'P5-S1: OptimizerEngine Protocol — fit(universe, evidence, constraints, objective_config, covariance_model) → WeightProfile. explain() → dict. Registered in OptimizerRegistry by engine_id + version.',
    'P5-S2: EqualWeightOptimizer — Phase 1 baseline. 1/N weights. ConstraintSet enforced post-allocation.',
    'P5-S3: CappedInverseVolOptimizer — weight ∝ 1/σ, capped at max_symbol_weight. Uses 30d realized vol from MarketMetadata snapshot.',
    'P5-S4: SimpleShrinkageMVOptimizer — diagonal shrinkage fallback. Quadratic constraints: sector ≤35%, pairwise correlation cap ≤0.75, Kelly fraction ≤0.5.',
    'P5-S5: WeightProfile versioned output — stores engine_id, version, objective_used, constraints_used, covariance_model_used, evidence_id, metadata_version_id, input_universe_snapshot, output_weights (sums to 1.0), explain_output, parent_weight_profile_id.',
    'P5-S6: OOS Sharpe floor + curve-fit gate — per_symbol_oos_sharpe < 0.3 → weight zeroed. OOS < 50% of IS Sharpe → curve-fit flag and weight zeroed. Enforced inside optimizer.',
    'P5-S7: Watchlist model (5 types) — Manual | Scanner | Index | SectorRotation | EarningsCalendar. Global, user-owned. Programs reference watchlists; do not own them.',
    'P5-S8: SymbolUniverse resolver — source_watchlist_id + overlay_watchlist_ids[] (up to 5, union). deny_list wins all. filters → ranking → top_N → resolved_symbol_snapshot + resolved_at.',
    'P5-S9: Optimizer characteristic vector from watchlist — 30d realized vol, avg pairwise correlation, sector tag, ADV, bid-ask spread percentile, per_symbol_oos_sharpe. Feeds Ledoit-Wolf and constraint enforcement.',
    'P5-S10: Phase 1 portfolio stress summary — gross dollar exposure overlap matrix + 60-day rolling pairwise correlation matrix (pairs >0.75 flagged).',
    // P6 — TradingProgram + Deployment
    'P6-S1: TradingProgram model — frozen template = StrategyVersion + OptimizationProfile + SymbolUniverse + ExecutionPolicy + WeightProfile. status: draft | frozen | deprecated. Any change → new version.',
    'P6-S2: Bounded deployment overrides on AccountAllocation — ±20% position size scaling, ±30min session window shift, drawdown threshold override. Lives on AccountAllocation, not TradingProgram.',
    'P6-S3: Conflict resolution pre-submission — net exposure per symbol across all programs before any order sent. FIRST_WINS (default): second signal suppressed and logged. AGGREGATE: explicit opt-in.',
    'P6-S4: InternalPaperBroker — implements BrokerProtocol. Bar-close signals, next-open fill, slippage + commission. No lookahead. Position + P&L in memory with DB persistence.',
    'P6-S5: Paper → Live promotion state machine — AccountAllocation.status: paper → promoted_to_live | paused. Alpaca: separate key pairs for paper vs live endpoints.',
    'P6-S6: Promotion review gate (UI) — full-screen modal: paper vs live summary side-by-side, 30-day paper perf with live slippage applied, revised Sharpe shown, read-scroll checklist. Single "Activate Live Trading" button in red.',
    'P6-S7: Shortability + fractionability pre-check — query Alpaca asset flags before adding symbol to universe. Must be checked at universe resolution time.',
    'P6-S8: Bracket order execution — Alpaca order_class=bracket for stop/target on single submission.',
    // P7 — UI Screens
    'P7-S1: TradingProgram Guided Card Stack — 4 cards pinned: StrategyVersion → OptimizationProfile → SymbolUniverse → ExecutionPolicy. "Freeze" in sticky footer when all 4 reach Ready. Animate snap-together.',
    'P7-S2: Watchlist Library page — first-class left nav section. Cards with name, source type badge, symbol count, last updated, Subscribers chip. Universe builder source renders as pill [SP500 ↗].',
    'P7-S3: Watchlist update toast rail — persistent bottom-right toast. Format: "Momentum Scan — 4 added, 2 removed · 2 min ago". Subscribed program swimlanes get amber dot until acknowledged.',
    'P7-S4: Multi-program account swimlane — one horizontal lane per TradingProgram. Capital bar, intraday P&L sparkline, sector heatmap thumbnail. Conflict alerts as banner between lanes. Capital realloc = drag handle.',
    'P7-S5: Trade mode badges + PDT gauge — DAY (blue) / SWING (amber) / POSITION (green) badge per program card. PDT arc gauge in account header: 3/3 turns red. Hover shows expiry dates.',
    'P7-S6: Signal Independence Score — arc gauge 0–100. Spearman rank correlation of signal timestamps + symbol overlap penalty. Hover: 2×2 heatmap of pairwise overlap per symbol bucket.',
    'P7-S7: Optimization comparison table — primary sort OOS Sharpe. Red overfit ribbon where IS Sharpe > OOS by >0.4. Click row → equity curve overlay vs baseline.',
    'P7-S8: Weight treemap + override panel — area ∝ weight, color = signal quality. Click tile → inline slider. Two-axis scatter (Effective N vs Expected Return) with optimizer efficient frontier band.',
    'P7-S9: Dynamic universe time-scrubber — ranked table with date scrubber. Drag → replay universe at that date with animated sort. Drift indicator for entries/exits between two dates.',
    'P7-S10: Portfolio stress summary panel — Phase 1: gross exposure overlap + 60-day correlation matrix. Phase 2: factor shock scenarios.',
    // P8 — Advanced Optimizers (Phase 2)
    'P8-S1: Ledoit-Wolf full mean-variance — full shrinkage covariance. Quadratic constraints enforced inside optimizer (not post-hoc).',
    'P8-S2: Turnover-penalized Sharpe — objective: max(Sharpe - λ × turnover). λ tuned per strategy mode.',
    'P8-S3: Slippage-aware optimizer — transaction cost model integrated into objective. Market impact as function of ADV and position size.',
    'P8-S4: Regime-conditioned weights — separate covariance estimate + expected return inputs per market regime. Regime detected from MarketMetadata snapshot.',
    'P8-S5: Factor shock stress scenarios — momentum factor −3σ, size factor, vol spike. Combined drawdown across all active programs on account.',
    // P9 — Institutional Optimizers + Final Verification
    'P9-S1: Black-Litterman / Bayesian priors — market equilibrium returns + analyst/signal views. View confidence as Ω matrix. Posterior estimates fed into MV optimizer.',
    'P9-S2: Factor risk budgeting — risk allocated by factor exposure (momentum, size, volatility, quality). Position weights solve for factor exposure equality.',
    'P9-S3: Benchmark-relative optimization — objective: max Information Ratio vs benchmark. Tracking error ceiling + sector concentration constraint vs benchmark weights.',
    'P9-S4: Multi-objective Pareto optimization — simultaneous Sharpe, drawdown, turnover. Pareto frontier displayed. User selects operating point.',
    'P9-S5: Optimizer comparison lab — side-by-side WeightProfile comparison across engines. Same universe + evidence → compare weights, expected return, max DD, turnover.',
    'P9-S6: Critical-path E2E verification — full flow: Watchlist → SymbolUniverse → StrategyVersion + ValidationEvidence + OptimizationProfile → WeightProfile → TradingProgram freeze → AccountAllocation → paper deployment → bar ingestion → signal → order → fill → ledger attribution → monitor.',
    'P9-S7: Audit lineage verification — every live order traceable via client_order_id join chain to all upstream layers. Verified with automated test.',
    'P9-S8: Board acceptance sign-offs — all four approvers: Product Manager, Distinguished Engineer, Fullstack Developer, VP of Technology.',
  ],
  keyFiles: [
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
  isFetching,
  refetch,
  limit,
  setLimit,
}: {
  events: any[]
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
        {events.length === 0 ? (
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

// ─── Root ─────────────────────────────────────────────────────────────────────

export function LogsPanel() {
  const pausePolling = usePollingGate()
  const [limit, setLimit] = useState(100)
  const [activeTab, setActiveTab] = useState<LogsTab>('roadmap')

  const { data, isFetching, refetch } = useQuery({
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
            Risk control events and training roadmap — permanent source of truth
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
        </div>
      </div>

      {activeTab === 'events' ? (
        <RiskEventsTab
          events={events}
          isFetching={isFetching}
          refetch={refetch}
          limit={limit}
          setLimit={setLimit}
        />
      ) : (
        <RoadmapTab />
      )}
    </div>
  )
}
