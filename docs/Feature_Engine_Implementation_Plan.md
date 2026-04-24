# Feature Engine Build

**Version:** 1.0  
**Status:** Implementation contract draft  
**Timestamp (ET):** 2026-04-22 01:17:10 PM ET  
**Scope:** Stop-ship implementation plan aligned to the executive view in `LogsPanel.tsx`

This document is the implementation contract behind the `Feature Engine Build` executive view.
The screen is the executive summary. This document is the deeper source of truth for delivery,
acceptance gates, rollback boundaries, and file-level rollout.

## Readiness

As of this draft, `Readiness` means **spec and planning slices completed so far**. It does **not**
mean runtime-ready or safe-to-depend-on-in-live-trading.

- `Readiness:` 86% (`6 / 7` slices complete)
- `Complete:` `FEB-0`, `FEB-1`, `FEB-2`, `FEB-3`, `FEB-4`, `FEB-6`
- `Active:` none currently marked
- `Blocked:` `FEB-5`
- `Bounded Contexts:` `5`
- `Surrounding Systems:` `4`

Status definitions are frozen:

- `Complete` = exit gate passed, evidence recorded, rollback boundary understood
- `Active` = engineering work may proceed now, but exit gate not yet cleared
- `Blocked` = trust gap prevents safe advancement; blocker proof is explicitly defined
- `Planned` = sequenced and bounded, but not yet active

Autonomous update rules are frozen:

- an agent must mark a slice `Active` before touching files that belong to that slice
- an agent must update `Current Exit Gate` to the controlling active slice before substantive implementation begins
- an agent must mark a slice `Blocked` immediately when trust cannot advance safely and the closing proof is known
- an agent must mark a slice `Complete` only after its acceptance gates and evidence are recorded
- an agent must never leave a slice in `Active` after stopping work for that slice without either:
  - keeping it as the current active slice for the next session, or
  - changing it to `Blocked`, or
  - changing it to `Complete`
- the executive view must be updated in the same work session as the underlying slice-status change

Autonomous-ready rule:

- the docs and executive view are part of the implementation control plane for this build
- they are not optional reporting artifacts
- if a slice has started, paused, resumed, blocked, or completed, the status surface must reflect that change before the session ends

Executive questions this section must answer quickly:

- Is readiness improving?
- What slice is active right now?
- Is the current readiness planning-only or runtime trust?

## Current Exit Gate

`Deterministic feature plan and canonical identity`

Current exit gate from the active execution slice:

> A Program emits a deterministic feature plan with canonical keys, dependencies, and warm-up requirements.

This gate is cleared only when all of the following are true:

- `FeatureSpec`, `FeatureRequirement`, and canonical `FeatureKey` exist in one compatibility-safe layer
- program demand resolves into deterministic feature identity regardless of param ordering
- registry demand dedupes by canonical key rather than indicator name only
- runtime frame metadata exposes canonical feature identity without changing current callback semantics
- planner, cache, and runtime migration boundaries remain explicit

Current active slices:

- none currently marked

`FEB-5` is now the blocking slice because portfolio feature adapters still depend on hardened control-plane and broker-account truth before they can safely advance.

## Current Blockers

### 1. Indicator-centric runtime identity

- `What is wrong:` Cerebro demand and cache identity are still mostly indicator-centric and keyed too narrowly.
- `Why it blocks runtime trust:` feature collisions and stale reuse become likely once session-aware, multi-timeframe, or portfolio-scoped features arrive.
- `What proof closes it:` canonical `FeatureKey` adopted everywhere runtime state is identified, cached, or reconciled.

### 2. Session and calendar context is not first-class

- `What is wrong:` holidays, half-days, session state, prior-period roll rules, and blackout context do not yet have one authoritative ingress path.
- `Why it blocks runtime trust:` ORB, prior-day/week levels, premarket context, and event-aware controls will drift or fail on special sessions.
- `What proof closes it:` session/calendar layer passes holiday, half-day, premarket, and prior-roll acceptance tests.

### 3. Portfolio governor truth is not ready for feature dependence

- `What is wrong:` portfolio features should not become admissibility inputs until control-plane truth for pause, kill, broker sync, and projected state is dependable enough to fail closed.
- `Why it blocks runtime trust:` portfolio features that look authoritative but read stale or partial control state create dangerous false confidence.
- `What proof closes it:` governor-facing portfolio features read only from hardened control-plane and broker-account truth with stale-sync rejection tests.

## Blocker Removal

This is the mandatory blocker-removal queue for autonomous build. These are not optional improvements.
They are the critical path to a trustworthy Feature Engine core.

### `FEB-B1 Warm-up Provenance Split`

- `Owner slice:` `FEB-1`
- `Status:` Completed
- `Primary file targets:`
  - `backend/app/services/market_data_service.py`
  - `backend/app/services/alpaca_stream_manager.py`
  - `backend/app/cerebro/engine.py`
  - `backend/app/services/market_metadata_service.py`
  - `backend/app/api/routes/backtests.py`
  - `backend/tests/test_feature_ingress_contract.py`
  - `backend/tests/test_market_metadata_service.py`
  - `backend/tests/test_backtest_replay_provider_contract.py`
- `Next tasks:`
  - no blocker-removal tasks remain in `FEB-B1`
  - keep legacy-row checks in migration smoke tests as the wider Feature Engine build continues
- `Close proof:`
  - one ingress contract exists per mode
  - warmed feature frames carry provenance
  - research snapshots persist requested and resolved provider provenance
  - older-run trade replay now fails closed when provider truth is ambiguous
  - ingress and provenance regression tests passed for warm-up, simulation, data routes, optimizer, market metadata, and replay

### `FEB-B2 Indicator-Centric Runtime Identity`

- `Owner slice:` `FEB-2 / FEB-3`
- `Status:` Complete
- `Primary file targets:`
  - `backend/app/features/specs.py`
  - `backend/app/features/keys.py`
  - `backend/app/features/planner.py`
  - `backend/app/features/runtime_columns.py`
  - `backend/app/features/cache.py`
  - `backend/app/features/frame.py`
  - `backend/app/cerebro/registry.py`
  - `backend/app/cerebro/indicator_cache.py`
  - `backend/app/cerebro/engine.py`
  - `backend/tests/test_feature_specs_registry.py`
  - `backend/tests/test_feature_planner.py`
  - `backend/tests/test_runtime_feature_columns.py`
  - `backend/tests/test_feature_cache_runtime.py`
- `Next tasks:`
  - widen planner adoption beyond direct `ProgramDemand` builds, strategy validation preview, pending backtest launch snapshots, backtest metadata snapshots, run-details execution visibility, and simulation initialization visibility into more program-assembly paths
  - push feature-aware identity deeper into more runtime consumers than the cache facade and engine adapters
  - align strategy-builder / backend validation vocabulary with canonical feature specs where names still drift
  - add more collision and compatibility tests before widening runtime adoption
- `Close proof:`
  - canonical `FeatureSpec`, `FeatureRequirement`, and `FeatureKey` exist in one compatibility-safe layer
  - deterministic `FeaturePlan` snapshots exist for current program demand, strategy validation preview, pending backtest launches, run-details execution visibility, and simulation initialization visibility and are available from the registry/runtime boundary
  - registry dedupes demand by canonical key instead of indicator name only
  - runtime frames now expose deterministic column targets for canonical feature keys, carry a feature-aware runtime identity key without changing current callback semantics, and are queryable through a feature-cache facade by runtime identity
  - preview helpers now preserve explicit indicator params from builder-style value specs so canonical feature identity stays stable across validation, launch snapshots, and execution views
  - cache collision tests pass

### `FEB-B3 Session / Calendar Context Not First-Class`

- `Owner slice:` `FEB-4`
- `Status:` Complete
- `Primary file targets:`
  - `backend/app/features/computations/session.py`
  - `backend/app/features/context/session_context.py`
  - `backend/app/services/market_calendar_service.py`
  - `backend/app/services/earnings_calendar.py`
  - `backend/app/api/routes/strategies.py`
  - `backend/tests/test_session_features.py`
- `Next tasks:`
  - extend the session/calendar authority beyond backtest extraction into broader feature-engine paths
  - move ORB and prior-period logic onto session-aware computation wherever they still bypass the new authority
  - broaden the new session-state and blackout features into more runtime consumers than backtest and cache-driven recompute
- `Close proof:`
  - ORB, prior-day, prior-week, prior-month, and earnings-blackout features pass regular-day, holiday, half-day, and premarket tests

### `FEB-B4 Portfolio Governor Truth Not Ready`

- `Owner slice:` `FEB-5`
- `Status:` Blocked
- `Primary file targets:`
  - `backend/app/api/routes/governor.py`
  - `backend/app/services/conflict_resolver.py`
  - `backend/app/services/position_ledger.py`
  - `backend/tests/test_portfolio_feature_admissibility.py`
- `Next tasks:`
  - harden pause, kill, and open-gating truth before portfolio feature rollout
  - define stale-sync rejection behavior for governor-facing features
  - add projected post-trade admissibility tests with broker/account truth inputs
- `Close proof:`
  - projected post-trade feature inputs read hardened broker/control truth
  - stale sync rejects instead of allowing unsafe admissibility decisions

## Bounded Contexts

| Context | Owns | Consumes | Emits | Must Not Own |
|---|---|---|---|---|
| `Market Data Plane` | raw bars, provider routing, stream subscriptions, normalization, replay freshness | Alpaca live data, historical provider fetches, cache inventory | normalized bars, aggregation events, provenance metadata | feature semantics, signal truth, portfolio approval |
| `Feature Engine Core` | `FeatureSpec`, `FeatureKey`, planner, registry, dependency graph, feature cache, incremental update rules | normalized bars, session context, program demand | feature frames, warm-up requirements, cache diagnostics | broker calls, signal logic, UI-only concerns |
| `Strategy / Signal` | declarative demand, condition logic, signal truth | feature frames, authoring schema, canonical supported features | feature requirements, signal outcomes | ad hoc feature computation, portfolio admissibility |
| `Session / Calendar Context` | session state, holidays, half-days, prior-roll rules, blackout context | market calendars, event feeds | session/context features, market-day classifications | strategy logic, broker state, portfolio approval |
| `Portfolio Governor` | projected post-trade admissibility, exposure rules, concentration rules, stale-sync rejection | portfolio features, broker account truth, control-plane truth | approve/reject decisions, risk diagnostics | raw market-data normalization, strategy studies, broker storage |

Context rules are non-negotiable:

- `Market Data Plane` normalizes data but does not create feature semantics.
- `Feature Engine Core` computes reusable features but does not decide trade desirability or broker admissibility.
- `Strategy / Signal` declares demand and evaluates truth, but never computes indicators ad hoc.
- `Portfolio Governor` consumes portfolio features only after control-plane truth is hardened enough to fail closed.

## Surrounding Systems

| Surrounding System | Provider / Service | Inbound Contract | Cadence / SLA | Provenance Required | Failure Behavior | Downstream Consumers |
|---|---|---|---|---|---|---|
| `Historical Cache / Research Data` | local cache + market data service fetch path | OHLCV bars, metadata, fetch source | on demand, replay-grade completeness | provider id, fetch time, cache source, bar range | fail closed for missing bars in deterministic runs | backtest, simulation, warm-up, planner validation |
| `Alpaca Default Live Data Service` | Alpaca stream + account-linked subscriptions | live bars, stream status, symbol subscription set | low latency live stream, reconnect with bounded backfill | stream source, reconnect sequence, continuation source | degrade to reconnect path; never silently substitute semantics | paper/live runtime, market-data plane, governor-adjacent live context |
| `Calendar / Event Services` | market calendar + earnings/macro/holiday feeds | session state, market-day type, blackout events | daily snapshot plus intraday event refresh as needed | calendar source, effective date, event version | fail closed for session-sensitive features | session/context layer, strategy controls, feature engine |
| `Broker Account Truth` | Alpaca broker/account endpoints | open orders, fills, positions, buying power, restriction state | periodic reconciliation + event-driven updates | broker timestamp, sync freshness, account scope | stale sync blocks governor-facing admissibility | portfolio governor, broker account layer |

The executive view shows `4` surrounding systems. This document intentionally uses the same four names to avoid drift.

## Build Slices

### `FEB-0 Vocabulary and Contract Lock`

- `Status:` Complete
- `Objective:` lock canonical feature names, causality notes, and design boundaries before implementation spreads
- `Dependencies:` none
- `No-touch boundaries:` no runtime refactor in this slice
- `Rollback boundary:` documentation only
- `UI evidence:` one complete slice appears in the executive view

Files:

- `create/modify`
  - `docs/Feature_Engine_Spec.md`
  - `docs/Feature_Engine_Spec_DRD.md`
  - `docs/Feature_Vocabulary_Catalog.md`
  - `docs/Canonical_Architecture.md`
  - `docs/Control_Plane_Spec.md`

Acceptance gates:

- one canonical vocabulary exists for UI, AI, validation, and runtime planning
- feature names carry causality notes
- design boundaries are explicit between Strategy, Feature Engine, Portfolio Governor, and Broker Account

Tests / evidence:

- documentation review
- architecture review sign-off

### `FEB-1 Ingress and Source Arbitration`

- `Status:` Complete
- `Objective:` freeze ingress ownership and provenance rules before runtime feature work
- `Dependencies:` `FEB-0`
- `No-touch boundaries:` no feature semantics inside data-service normalization
- `Rollback boundary:` keep current runtime behavior behind adapters until ingress contract is proven
- `UI evidence:` current exit gate, Alpaca default live ingress badge, blocker list

Files:

- `modify`
  - `backend/app/services/market_data_service.py`
  - `backend/app/services/alpaca_stream_manager.py`
  - `backend/app/services/market_data_bus.py`
  - `backend/app/cerebro/engine.py`
  - `backend/app/core/backtest.py`
  - `docs/Feature_Engine_Build.md`
- `create`
  - `backend/app/features/source_contracts.py`
  - `backend/tests/test_feature_ingress_contract.py`
- `adapter/shim`
  - adapter preserving current warm-up paths while provenance stamping is introduced

Ingress matrix by mode:

| Mode | Fetches | Normalizes | Resamples / Aggregates | Stamps Provenance | Forbidden To Compute Semantics |
|---|---|---|---|---|---|
| `Historical / Research` | market data service | market data plane | market data plane | market data service | strategies, broker layer |
| `Simulation` | market data service + local inventory | market data plane | market data plane | simulation warm-up loader | strategies, governor |
| `Paper` | market data service warm-up + Alpaca live continuation | market data plane | market data plane | warm-up loader + live stream boundary | Feature Engine must not infer provider silently |
| `Live` | market data service warm-up + Alpaca live continuation | market data plane | market data plane | warm-up loader + Alpaca live boundary | broker account and portfolio governor |

Acceptance gates:

- Alpaca remains the default live ingress
- fallback policy is explicit, including when yfinance is allowed and when it is forbidden
- every warmed feature frame records provenance
- reconnect backfill rules are deterministic and tested
- live stream drop behavior does not create silent provider substitution

Tests / evidence:

- provider arbitration tests
- reconnect / backfill tests
- provenance field assertions in warm-up artifacts

### `FEB-2 Planner and Registry Refactor`

- `Status:` Complete
- `Objective:` introduce `FeatureSpec`, `FeatureRequirement`, `FeaturePlan`, and canonical keying
- `Dependencies:` `FEB-1`
- `No-touch boundaries:` do not change trading semantics yet
- `Rollback boundary:` keep current indicator-demand path behind planner adapters
- `UI evidence:` slice shows planned with deterministic-plan exit gate and run-time feature-plan visibility from execution artifacts

Files:

- `create`
  - `backend/app/features/specs.py`
  - `backend/app/features/keys.py`
  - `backend/app/features/planner.py`
  - `backend/app/features/registry.py`
  - `backend/tests/test_feature_planner.py`
- `modify`
  - `backend/app/cerebro/registry.py`
  - `backend/app/api/routes/strategies.py`
  - `backend/app/api/routes/backtests.py`
  - `backend/app/services/backtest_service.py`
  - `frontend/src/components/StrategyBuilder/ConditionBuilder.tsx`
  - `frontend/src/api/strategies.ts`
  - `frontend/src/pages/RunDetails.tsx`
  - `frontend/src/types/index.ts`

Acceptance gates:

- a Program emits a deterministic `FeaturePlan`
- `FeatureKey` is canonical and collision-safe
- planner output includes dependencies and warm-up requirements
- builder and backend supported-feature list agree on canonical names

Tests / evidence:

- deterministic planner snapshots
- duplicate-demand dedupe tests
- validator / builder compatibility tests
- strategy validation feature-plan preview tests
- shared feature-preview helper tests
- backtest run serialization tests for execution-side feature-plan visibility
- pending-run launch snapshot tests so planner evidence exists before background execution starts

### `FEB-3 Runtime Feature State`

- `Status:` Active
- `Objective:` move runtime state from indicator-centric caching to feature-aware frames without breaking current orchestration
- `Dependencies:` `FEB-2`
- `No-touch boundaries:` do not bypass current deployment orchestration
- `Rollback boundary:` adapter path back to current indicator cache
- `UI evidence:` slice is active only while runtime cache identity, demand-aware recompute, and feature-frame facade are being proven

Files:

- `create`
  - `backend/app/features/cache.py`
  - `backend/app/features/frame.py`
  - `backend/tests/test_feature_cache_runtime.py`
- `modify`
  - `backend/app/cerebro/indicator_cache.py`
  - `backend/app/cerebro/engine.py`
  - `backend/app/core/backtest.py`
- `deprecate`
  - name-only dedupe assumptions inside runtime cache logic

Acceptance gates:

- runtime cache keys are feature-aware
- incremental updates do not require full-history recomputation
- cold start and warm-up reconciliation are deterministic
- cache invalidation rules are explicit and tested

Tests / evidence:

- incremental update tests
- cold-start reconciliation tests
- cache collision tests
- runtime-identity lookup tests
- feature-frame facade tests

### `FEB-4 Session / Calendar Layer`

- `Status:` Active
- `Objective:` add first-class session and calendar authority for ORB, prior-period levels, holidays, half-days, and blackout context
- `Dependencies:` `FEB-3`
- `No-touch boundaries:` do not bury session logic inside random feature computations
- `Rollback boundary:` feature computation can continue without session-sensitive features enabled
- `UI evidence:` slice is active while session/calendar authority is being extracted from ad hoc backtest logic and proven against holiday, half-day, and premarket tests

Files:

- `create`
  - `backend/app/features/computations/session.py`
  - `backend/app/features/context/session_context.py`
  - `backend/app/services/market_calendar_service.py`
  - `backend/tests/test_session_features.py`
- `modify`
  - `backend/app/features/registry.py`
  - `backend/app/core/backtest.py`
  - `backend/app/api/routes/strategies.py`

Acceptance gates:

- ORB and prior-day / prior-week / prior-month features pass regular-session, holiday, and half-day tests
- prior-roll rules are authoritative and reproducible
- blackout context ingress is versioned and testable
- session state is emitted from one authoritative context path

Tests / evidence:

- holiday / half-day tests
- prior-day and prior-week causality tests
- prior-month causality tests
- premarket / regular-session partition tests
- session-aware opening range tests
- earnings-blackout feature tests

### `FEB-5 Portfolio Governor Adapters`

- `Status:` Blocked
- `Objective:` introduce portfolio feature consumption only after control-plane and broker truth are dependable enough to fail closed
- `Dependencies:` `FEB-4` and hardened control-plane truth
- `No-touch boundaries:` no direct broker calls or governor bypass
- `Rollback boundary:` governor continues using existing hardened checks without feature dependency
- `UI evidence:` slice does not advance until stale-sync rejection and projected-state tests pass

Files:

- `create`
  - `backend/app/features/portfolio.py`
  - `backend/app/services/portfolio_feature_service.py`
  - `backend/tests/test_portfolio_feature_admissibility.py`
- `modify`
  - `backend/app/api/routes/governor.py`
  - `backend/app/services/conflict_resolver.py`
  - `backend/app/services/position_ledger.py`
  - `backend/app/services/alpaca_service.py`

Acceptance gates:

- projected post-trade features are deterministic
- stale broker/control truth fails closed
- exposure, concentration, and pending-open risk features are attributable and tested
- no new feature path bypasses Portfolio Governor authority

Tests / evidence:

- projected-state approval tests
- stale-sync rejection tests
- conflict-resolution compatibility tests

### `FEB-6 UI / Docs Readiness Surface`

- `Status:` Complete
- `Objective:` keep the executive view synchronized to the implementation contract without turning it into a second uncontrolled roadmap
- `Dependencies:` `FEB-0`
- `No-touch boundaries:` do not present runtime trust stronger than the underlying evidence
- `Rollback boundary:` documentation and UI copy only
- `UI evidence:` active tab already live in `LogsPanel.tsx`
- `Operator issue evidence:` separate `Issues` tab synthesizes current Feature Engine blockers and uncovered or partial journey gaps without creating a shadow backlog

Files:

- `modify`
  - `frontend/src/pages/LogsPanel.tsx`
  - `docs/Feature_Engine_Build.md`
- `create`
  - `docs/Feature_Engine_Implementation_Plan.md`

Acceptance gates:

- the executive view mirrors these section labels exactly:
  - `Readiness`
  - `Current Exit Gate`
  - `Current Blockers`
  - `Issues`
  - `Bounded Contexts`
  - `Surrounding Systems`
  - `Build Slices`
  - `Reference Docs`
- the executive view can be explained directly from this document without reinterpretation
- the UI never implies runtime readiness when only planning readiness exists
- refresh failures in docs-backed executive views must surface explicit operator action and last-good snapshot timing instead of looking like healthy current data
- slice status changes are reflected in the docs and executive view during the same work session the change occurs

Tests / evidence:

- UX review
- architecture review
- manual comparison of screen labels to document headings

## Reference Docs

Core references:

- [Feature_Engine_Build.md](./Feature_Engine_Build.md)
- [Feature_Engine_Spec.md](./Feature_Engine_Spec.md)
- [Feature_Engine_Spec_DRD.md](./Feature_Engine_Spec_DRD.md)
- [Feature_Vocabulary_Catalog.md](./Feature_Vocabulary_Catalog.md)
- [Canonical_Architecture.md](./Canonical_Architecture.md)
- [Control_Plane_Spec.md](./Control_Plane_Spec.md)

Progress-to-screen mapping:

| Executive View Label | This Document Section | Update Rule |
|---|---|---|
| `Readiness` | `Readiness` | update only when slice status changes and evidence exists |
| `Current Exit Gate` | `Current Exit Gate` | derived from the first active slice's exit gate |
| `Current Blockers` | `Current Blockers` | update only with trust gaps and closing proof |
| `Issues` | synthesized from `Current Blockers` + `docs/User_Journey_Validations.md` | keep it derived from real blockers and uncovered or partial journey rows; do not create a second manual backlog |
| `Bounded Contexts` | `Bounded Contexts` | update only when architectural ownership changes |
| `Surrounding Systems` | `Surrounding Systems` | update only when ingress neighbors or contracts change |
| `Build Slices` | `Build Slices` | update slice status, files, and acceptance gates together |
| `Reference Docs` | `Reference Docs` | keep the UI doc list identical to this list |

Session update protocol:

1. Before work starts on a slice, mark that slice `Active`.
2. Before editing files in a new slice, ensure the previous slice is left in a valid terminal state for the session: `Active`, `Blocked`, or `Complete`.
3. When work stops because of a trust blocker, add the blocker and the closing proof in the same session.
4. When work stops because the slice is finished, record the evidence and mark the slice `Complete` in the same session.
5. Never batch-update multiple slice states retroactively at the end of a long run.
6. The executive view should always let an operator infer what the current agent is actively building right now.
7. If the active work is blocker removal, the `Blocker Removal` section must be updated in the same work session with status, close proof, and file targets.

Source-of-truth rule:

- this document is the implementation contract
- the executive view is the summary surface for leaders and operators
- if the two drift, this document must be corrected first and the screen updated immediately afterward
