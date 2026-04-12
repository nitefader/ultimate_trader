# UltraTrader 2026 Implementation Roadmap

Generated from the UltraTrader 2026 master specification (v1.0.0) on 2026-04-10.

## 1) Delivery Strategy

This roadmap is organized as a staged, dependency-aware plan:

1. Stabilize and de-risk live operations (P0).
2. Ship high-value UX for daily operator workflow (P1).
3. Add intelligence and portfolio depth (P2).
4. Improve platform ergonomics and adoption (P3).

Release cadence recommendation:

- Sprint length: 2 weeks
- Track model: parallel Product, Frontend, Backend, QA tracks
- Release model: end-of-sprint production candidate

## 2) Milestones

## Milestone M0: Foundations and Safety (Weeks 1-2)

Goal: eliminate high-risk operational blind spots before feature expansion.

Scope:

- BL-001 Error boundary with recovery UI
- BL-003 Persistent kill switch warning after reload
- BL-004 Port conflict detection + startup guardrails
- BL-005 Account balance staleness indicator
- BL-026 Swagger docs in DEBUG mode

Deliverables:

- Global frontend error boundary and safe fallback screen
- Kill switch state persistence + startup modal
- Frontend dev script backend identity verification
- "Last updated" age indicators with freshness coloring
- Debug API documentation endpoint enabled

Exit criteria:

- Fatal render failures do not produce blank app screens
- Users cannot silently connect frontend to wrong backend service
- Balance freshness visible for all account views
- QA checklist for kill switch persistence passes

## Milestone M1: Real-Time Monitoring and Control (Weeks 3-5)

Goal: make live monitoring timely and reliable.

Scope:

- BL-002 WebSocket real-time push
- BL-020 Browser live trade alerts
- BL-015 Keyboard shortcuts

Deliverables:

- Backend event emission layer for positions, fills, kill events
- Frontend WebSocket client with query cache merge strategy
- Notification permission flow and event-to-notification mapping
- Global keyboard shortcut handler and in-app shortcut help modal

Exit criteria:

- Position/order updates arrive in near real-time under active load
- Kill switch events propagate via WebSocket and UI updates immediately
- Alerts can be toggled and tested in staging

## Milestone M2: Research-to-Deployment Workflow UX (Weeks 6-8)

Goal: improve strategy iteration speed and confidence.

Scope:

- BL-006 Strategy performance comparison view
- BL-011 Strategy config diff viewer
- BL-012 One-click strategy duplication
- BL-013 Backtest benchmark comparison
- BL-014 Intraday data warning in strategy builder
- BL-008 Position sizing calculator

Deliverables:

- Multi-run comparison table + overlaid equity visualization
- Version diff UI in strategy details
- Duplicate strategy endpoint/UI action
- Benchmark overlay + alpha metric in run details
- Intraday limitation warning in builder (pre-launch)
- Reusable sizing calculator component

Exit criteria:

- Users can compare at least two runs in one workflow
- Strategy version deltas are visible without manual JSON inspection
- Intraday limitation warnings prevent invalid long-range setup confusion

## Milestone M3: Professional Ops Layer (Weeks 9-11)

Goal: strengthen operator discipline and decision support.

Scope:

- BL-007 Pre-market checklist
- BL-009 Drawdown period event overlay
- BL-024 Drawdown recovery estimation
- BL-018 Regime detection dashboard
- BL-023 Automatic event calendar sync

Deliverables:

- Time-based pre-market checklist modal for live accounts
- Event overlays on equity/drawdown charts
- Recovery-time analytics from equity drawdown segments
- Regime widget/service integration
- Event sync connectors (FRED/BLS/SEC EDGAR where feasible)

Exit criteria:

- Live-mode operator receives daily operational checklist prompts
- Drawdown context features visible in run analysis
- Event calendar can be refreshed from external sources

## Milestone M4: Platform Intelligence and Scale (Weeks 12-15)

Goal: add advanced quant analysis and portfolio-level tooling.

Scope:

- BL-016 Risk-of-ruin calculator
- BL-017 Walk-forward analysis view
- BL-019 Parameter sensitivity heatmap
- BL-021 Multi-strategy portfolio view
- BL-022 Trade replay mode

Deliverables:

- Risk-of-ruin computation model + UI summary
- Walk-forward backend computation and visual timeline
- Parameter grid run orchestration and heatmap rendering
- Portfolio exposure matrix across strategies and symbols
- Trade replay panel with signals and condition traces

Exit criteria:

- Advanced analytics available for at least one complete strategy lifecycle
- Portfolio risk can be interpreted at strategy and symbol aggregation levels

## Milestone M5: Adoption and DevEx Completion (Weeks 16-17)

Goal: simplify onboarding, portability, and operations.

Scope:

- BL-025 Single start script
- BL-027 Backup/restore UI
- BL-028 Onboarding wizard
- BL-029 Theme toggle
- BL-030 Strategy import/export

Deliverables:

- One-command local startup script and verification
- Backup export/restore workflow with schema validation
- Guided first-run onboarding flow
- Theme preference persistence
- Strategy YAML/JSON import/export

Exit criteria:

- New user can reach first backtest through guided flow
- Strategy configs can be moved between environments safely

## 3) Dependency Map

Critical dependencies:

- BL-002 depends on stable event contracts and backend monitor endpoints.
- BL-020 depends on BL-002 (WebSocket/event stream).
- BL-013 depends on benchmark data pipeline in backtest completion.
- BL-017 depends on walk-forward data production (`run_metrics.walk_forward`).
- BL-019 depends on parameterized backtest orchestration and storage.
- BL-022 depends on enriched trade metadata/condition firing logs.
- BL-023 depends on external provider clients and event normalization.
- BL-027 depends on DB lifecycle and lock-safe restore process.

Suggested implementation sequence for dependencies:

1. Define shared event schemas and API contracts.
2. Ship WebSocket transport + frontend subscription integration.
3. Extend analytics persistence (benchmark, recovery, walk-forward).
4. Build visualization features on top of persisted analytics.

## 4) Sprint Breakdown (First 4 Sprints)

Sprint 1 (Weeks 1-2):

- BL-001, BL-003, BL-004, BL-026
- QA: failure-mode tests for render crash and backend mismatch

Sprint 2 (Weeks 3-4):

- BL-005, BL-002 (transport + first event types)
- QA: live monitor latency and reconnect behavior

Sprint 3 (Weeks 5-6):

- BL-020, BL-015, harden BL-002
- QA: browser notification matrix + accessibility checks

Sprint 4 (Weeks 7-8):

- BL-006, BL-012, BL-014
- QA: comparison correctness and strategy duplication integrity

## 5) Definition of Done (Per Backlog Item)

Each item is complete only when all are true:

- Product acceptance criteria mapped to behavior and edge cases
- Backend/Frontend integration tests added or updated
- Observability added (logs/metrics/events where relevant)
- Documentation updated (README/runbooks/API docs)
- QA pass in local + docker-compose workflows

## 6) Risk Register and Mitigations

Risk: real-time event drift between backend and frontend cache.

- Mitigation: schema versioning + fallback polling reconciliation.

Risk: external event/data provider reliability for BL-023.

- Mitigation: provider adapters with retry/backoff and partial sync states.

Risk: compute cost/time of walk-forward and sensitivity analysis.

- Mitigation: queue-based execution, sampling presets, cached results.

Risk: backup/restore corruption in local dev DB.

- Mitigation: pre-restore validation + automatic rollback snapshot.

## 7) KPI Targets by Milestone

M0/M1 targets:

- 0 blank-screen fatal states in QA test suite
- <2s median UI propagation for live fill/position updates
- 100% detection of backend identity mismatch on `npm run dev`

M2/M3 targets:

- 30% reduction in time from strategy idea to backtest comparison
- 25% reduction in failed/invalid intraday backtest launch attempts

M4/M5 targets:

- 50% of active users engage at least one advanced analysis module
- <10 minutes first-run time to complete onboarding steps 1-3

## 8) Recommended Owners (Role-Level)

- Product/PM: scope gating, acceptance criteria, release readiness
- Frontend lead: M0 UX safety, M1 real-time UX, M2/M3 analytical visuals
- Backend lead: event bus, analytics pipelines, provider integrations
- QA lead: regression suites for live monitoring and deployment safety
- DevOps/Platform: startup scripts, environment checks, backup reliability

## 9) Immediate Next Execution Step

Start Sprint 1 with BL-001 and BL-004 in parallel:

- BL-001 creates immediate user safety value in runtime failures.
- BL-004 prevents cross-project backend collisions that can invalidate all testing.

After those two land, complete BL-003 and BL-005 in the same sprint window.
