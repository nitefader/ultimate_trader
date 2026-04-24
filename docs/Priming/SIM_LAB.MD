Feature Engine Completion Specification
Status: Final convergence specification
Purpose: Define the exact conditions under which the Feature Engine may be considered complete
Scope: Canonical feature computation across research, simulation, paper, live, and approved control-plane consumers

1. Purpose
This document defines the final convergence target for the Feature Engine.

The Feature Engine is only complete when the platform has one canonical feature system that serves all required runtime consumers, preserves bounded contexts, supports both replay and streaming execution, and eliminates semantic drift across research and runtime paths.

This document is not a brainstorming note. It is the completion contract.

2. Completion Bar
The Feature Engine is only complete when one canonical feature system, with two execution modes and explicit historical/live ingress contracts, serves these five runtime consumers:

backtest
Sim Lab historical replay
Sim Lab live stream
paper runtime
live runtime
All five must use the same:

FeatureSpec
FeatureKey
planner
registry
cache model
session/calendar semantics
multi-timeframe alignment rules
provenance model
Completion also requires convergence for these non-runtime but feature-critical surfaces:

strategy validation preview
program demand / execution preview
governor-facing feature consumers where allowed
A surface does not count as converged if it reads canonical planning metadata but still computes feature values through a legacy side path.

3. Hard Rules
3.1 Canonical Feature Rule
All active feature computation must resolve through the canonical feature system.

No active consumer may:

compute features independently
introduce a parallel feature engine
define separate feature semantics
bypass canonical planner, registry, cache, or session rules
3.2 Sim Lab Rule
Sim Lab must be a first-class consumer of the canonical feature system.

It may run in:

Historical Replay mode
Live Stream mode
It must not:

compute features independently
define separate semantics
bypass canonical planner/registry/cache/session rules
3.3 Bounded Context Rule
Feature convergence must preserve architecture boundaries.

The Feature Engine must not absorb:

broker authority
signal truth ownership
portfolio admissibility ownership
UI-only logic
3.4 Fail-Closed Rule
If provenance, session context, broker truth, or control-plane truth is ambiguous or stale in a context that requires trust, the system must fail closed rather than silently infer or degrade semantics.

3.5 Legacy Path Rule
No production consumer may remain on a legacy feature-computation path after transitional compatibility code is declared removable.

4. Required Execution Modes
The canonical Feature Engine must support exactly two execution modes.

4.1 Batch / Replay Execution Mode
Used by:

backtest
Sim Lab historical replay
Characteristics:

deterministic execution over historical or cached bars
deterministic warm-up
deterministic stepping and replay inspection
canonical feature identity
canonical session/calendar semantics
canonical multi-timeframe alignment
canonical provenance
4.2 Incremental / Stream Execution Mode
Used by:

Sim Lab live stream
paper runtime
live runtime
Characteristics:

warm-up plus streaming continuation
incremental updates
selective recompute
runtime identity continuity
canonical session/calendar semantics
canonical provenance
no silent semantic substitution during stream interruption or reconnect
Consumers may differ in orchestration, side effects, and operator controls, but not in feature semantics.

5. Required Runtime Consumers
5.1 Backtest
Backtest must consume canonical feature planning and canonical batch/replay feature computation.

It must not use a separate semantic layer for indicators or derived features.

5.2 Sim Lab Historical Replay
Sim Lab historical replay must consume canonical batch/replay feature computation and expose deterministic inspection.

It is a validation consumer for:

strategy logic
feature correctness
program composition
multi-timeframe alignment
session-sensitive behavior
5.3 Sim Lab Live Stream
Sim Lab live stream must consume canonical incremental/stream feature computation.

It is a validation consumer for:

runtime feature updates
warm-up handoff
controls behavior
risk behavior
execution-path inputs
governor/admissibility behavior where allowed
5.4 Paper Runtime
Paper runtime must consume canonical incremental/stream computation.

It must not rely on feature semantics that differ from live runtime.

5.5 Live Runtime
Live runtime must consume canonical incremental/stream computation with full provenance, session, and trust enforcement.

It must be semantically equivalent to paper and Sim Lab live stream at the feature layer.

6. Required Convergence Surfaces
These are not counted as runtime consumers, but convergence is incomplete unless they use the same canonical feature identity and planning model.

6.1 Strategy Validation Preview
Must read canonical feature identity, supported feature semantics, and planning outputs.

It must not preview unsupported or semantically drifting feature requirements.

6.2 Program Demand / Execution Preview
Must read canonical planner and registry outputs for:

required features
canonical keys
warm-up requirements
alignment semantics
provenance expectations
6.3 Governor-Facing Feature Consumers
Where allowed, governor-facing feature consumers must read canonical feature outputs and hardened truth inputs only.

No governor-facing feature usage is complete until stale broker/control truth fails closed.

7. Canonical Runtime Interfaces
The engine boundary must be standardized for:

batch/replay execution
incremental/stream execution
feature frame inspection
warm-up behavior
session/calendar context
provenance/source metadata
higher-timeframe alignment onto execution bars
runtime identity lookup
invalidation and refresh behavior
These interfaces must preserve bounded contexts rather than collapsing the system into one oversized runtime module.

8. Canonical Data and Identity Model
8.1 FeatureSpec
FeatureSpec is the canonical description of what feature is required.

It must be the authoritative identity input for supported features.

8.2 FeatureKey
FeatureKey is the canonical identity key for caching, planning, registry dedupe, and runtime lookup.

It must be:

deterministic
collision-safe
stable under param ordering
independent of UI-only naming
8.3 Planner
The planner must emit deterministic feature plans for all converged consumers and surfaces.

The plan must include:

canonical feature specs
canonical keys
dependencies
warm-up requirements
timeframe requirements
provenance expectations where relevant
8.4 Registry
The registry must dedupe demand by canonical key, not by loose indicator names.

The registry must be the authoritative demand layer for active feature consumers.

8.5 Cache Model
The cache must be canonical and feature-native.

It must support:

feature-native frames
warm state
identity lookup
collision-safe reuse
invalidation
runtime identity queries
8.6 Provenance Model
The provenance model must remain explicit across warm-up and live continuation.

It must capture enough source truth to answer:

where the warm-up came from
where live continuation came from
whether handoff occurred correctly
whether semantics can be trusted
9. Session and Calendar Authority
Session and calendar context must be mandatory across all consumers for session-sensitive and prior-period features.

No ad hoc session logic may remain scattered across:

backtest
replay
streaming
Sim Lab
paper
live
This includes, where applicable:

holidays
half-days
regular session state
premarket context
prior-day/week/month roll rules
blackout context
session-aware derived features
Completion is blocked if session-sensitive features still rely on inconsistent local logic.

10. Multi-Timeframe Alignment
Multi-timeframe alignment rules must be canonical.

The same Program and effective bar sequence must produce the same higher-timeframe alignment behavior across:

backtest
Sim Lab replay
Sim Lab live stream
paper
live
Differences in orchestration are allowed.
Differences in alignment semantics are not.

11. Historical and Live Ingress Contracts
The Feature Engine is not complete without explicit ingress contracts.

11.1 Historical Ingress Contract
Must define:

accepted historical sources
cache expectations
deterministic replay completeness requirements
provenance requirements
failure behavior for ambiguous or incomplete history
11.2 Live Ingress Contract
Must define:

warm-up source
streaming continuation source
reconnect behavior
backfill behavior
provenance continuity
failure behavior when live truth becomes ambiguous
No consumer may silently switch semantic meaning because ingress changed.

12. Migration and Cutover Rules
12.1 Safe Migration Rule
Legacy compute paths must be retired behind rollback-safe adapters until parity is proven.

This is a convergence migration, not a reckless rewrite.

12.2 Transitional Compatibility Rule
Compatibility facades are allowed only while active consumers are being cut over safely.

They must not become permanent architecture.

12.3 Cutover Order
Consumers must be cut over in this order:

strategy validation preview
program demand / feature preview
backtest
Sim Lab historical replay
Sim Lab live stream
paper runtime
live runtime
governor-adjacent feature consumers where allowed
This order reduces blast radius and preserves observability during convergence.

13. Required Implementation Outcomes
The Feature Engine is not complete unless all of the following are true.

13.1 Legacy Compute Bridge Removed Safely
The dependency where runtime feature computation flows through legacy backtest indicator logic must be retired from active paths.

13.2 Canonical Feature Cache Is Real
The cache must no longer be merely a compatibility wrapper over indicator-era runtime storage.

13.3 Batch/Replay Mode Is Canonical
Backtest and Sim Lab historical replay must share one feature-semantic path.

13.4 Incremental/Stream Mode Is Canonical
Sim Lab live stream, paper runtime, and live runtime must share one feature-semantic path.

13.5 Session/Calendar Layer Is First-Class Everywhere
All required consumers must use one authoritative session/calendar model.

13.6 Registry-Backed Resolution Is Complete
All supported features must resolve through canonical spec/planner/registry layers.

13.7 Governor Truth Is Hardened Before Feature Dependence
Governor-facing feature consumers must only use hardened broker/control truth with fail-closed stale rejection.

14. Parity Requirement
For the same Program and same effective bar sequence, feature-semantic parity must be proven across:

backtest
Sim Lab historical replay
Sim Lab live stream
paper runtime
live runtime
Parity applies to:

feature values
feature identity
signal inputs
session/calendar behavior
alignment semantics
provenance handoff semantics where applicable
Parity does not require identical broker outcomes, because broker execution side effects are outside the feature-semantic layer.

15. Acceptance Tests and Proof Gates
Completion requires hard proof, not informal confidence.

Required proof includes:

deterministic replay outputs
incremental update correctness
warm-up correctness
multi-timeframe alignment correctness
session/calendar correctness
provenance correctness
ingress handoff correctness from warm-up to streaming continuation
no feature-semantic drift between consumers
collision-safe canonical identity behavior
cache reuse correctness
invalidation correctness
stale-governor rejection behavior
fail-closed behavior when provenance is ambiguous
fail-closed behavior when session context is ambiguous
fail-closed behavior when broker/control truth is stale in governor-facing contexts
A slice is not complete because a UI renders.
A slice is complete only when its proof gates pass.

16. Completion Disqualifiers
The Feature Engine must not be called complete if any of the following remain true:

any active consumer computes features outside the canonical feature system
Sim Lab has feature semantics separate from the canonical engine
runtime consumers still depend on legacy indicator-name shortcuts for active paths
session-sensitive features still depend on ad hoc local logic
provenance is not explicit through warm-up and continuation
multi-timeframe alignment differs across consumers
governor-facing feature usage can read stale truth without fail-closed rejection
the canonical cache is still only a thin facade while active consumers rely on legacy computation beneath it
validation preview or program preview uses canonical planning metadata but not canonical feature identity semantics
compatibility bridges remain because parity has not actually been proven
17. Final Removal Rule
Transitional compatibility code may be removed only when:

parity is proven
rollback boundaries are no longer needed
the canonical path is the only active feature-computation path
no production consumer still depends on the legacy path
Only then may wrapper/facade compatibility layers be deleted.

18. Final Sim Lab Rule
Sim Lab must orchestrate and inspect the canonical feature system.

It may operate in:

Historical Replay mode
Live Stream mode
It must not:

compute features independently
define separate feature semantics
bypass canonical planner, registry, cache, session, calendar, alignment, or provenance rules
Sim Lab is a proving surface for the canonical engine, not an exception to it.

19. One-Sentence Completion Standard
The Feature Engine is complete only when one canonical feature system, with replay and streaming execution modes plus explicit ingress contracts, serves backtest, Sim Lab replay, Sim Lab live stream, paper, and live with the same feature identity, cache semantics, session/calendar authority, alignment behavior, and provenance model, while all approved preview and governor-facing surfaces converge on that same canonical planning and identity layer.