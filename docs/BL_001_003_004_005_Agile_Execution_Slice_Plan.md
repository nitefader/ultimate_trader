# Agile Execution Slice Plan: BL-001 / BL-003 / BL-004 / BL-005

Date: 2026-04-10
Scope: Safety-critical UX and platform guardrails

## Slice Model (with parallel workstreams)

### Slice 1 (Week 1): BL-001 + BL-004 in parallel
Goal: Prevent blank-screen lockout and wrong-backend startup issues first.

Workstream A (Frontend Safety): BL-001 Global Error Boundary
- Add app-level Error Boundary around root render path.
- Build recovery UI with reload action, dashboard escape route, and visible kill-switch status snippet.
- Add component/integration test for render-crash fallback and recovery actions.

Workstream B (Dev Platform Safety): BL-004 Port Conflict Detection
- Add frontend preflight command to validate backend identity via `/api/v1/platform/info`.
- Fail fast in local startup when service mismatch is detected.
- Document startup workflow and troubleshooting path in README/runbook.

Workstream C (QA/Release, parallel to A+B)
- Add failure-mode tests for React crash flow and backend mismatch flow.
- Run smoke in local + docker-compose.
- Track defects and enforce same-day fix policy for P0 regressions.

Mini-retro 1 occurs immediately after Slice 1 acceptance.

### Slice 2 (Week 2): BL-003 + BL-005 in parallel
Goal: Prevent false confidence in trading state and make data freshness explicit.

Workstream A (State Safety UX): BL-003 Kill Switch Persistence Warning
- Persist kill-switch state metadata in local storage.
- On reload, present warning modal when previous session ended with active kill switch.
- Ensure modal copy and actions route user to explicit status verification.

Workstream B (Data Trust UX): BL-005 Balance Staleness Indicator
- Add "last updated" age indicator for account balances.
- Implement freshness color thresholds: green <30s, amber <60s, red >60s.
- Add manual refresh action and loading/error states.

Workstream C (QA/Release, parallel to A+B)
- Add tests for persistence edge cases (reload, clear storage, stale state).
- Add tests for staleness thresholds and visual status transitions.
- Validate behavior under delayed backend responses.

Mini-retro 2 occurs immediately after Slice 2 acceptance.

### Slice 3 (Week 3): Hardening + Cross-slice validation
Goal: Remove integration risk and prepare stable handoff.

Workstream A (Integration Hardening)
- Validate BL-001 fallback behavior while BL-003 modal logic is active.
- Validate BL-004 preflight behavior does not break local onboarding.
- Validate BL-005 timing logic under tab sleep/background resume.

Workstream B (Operational Readiness)
- Update docs: startup path, known failure states, operator response steps.
- Add release note entries for all four backlog items.
- Capture telemetry hooks/logging for incident triage.

Workstream C (QA Signoff)
- Run targeted regression pack + full smoke.
- Validate pass criteria in local and docker-compose.
- Publish final QA signoff summary.

Mini-retro 3 occurs immediately after Slice 3 acceptance.

## Definition of Done (per slice)

### DoD: Slice 1
- BL-001 fallback UI renders on forced component crash and provides a working recovery path.
- BL-004 startup preflight fails with clear messaging on backend mismatch.
- Unit/integration tests for both items are green in CI/local.
- README/runbook startup instructions are updated and verified by a second person.
- No open P0/P1 defects for slice scope.

### DoD: Slice 2
- BL-003 warning modal appears only under correct persisted-state conditions.
- BL-005 freshness indicator updates continuously with correct threshold colors.
- Manual refresh and failure state behavior are user-test validated.
- All new tests pass in local and docker-compose.
- No open P0/P1 defects for slice scope.

### DoD: Slice 3
- Cross-slice interaction tests pass (BL-001/003/004/005 together).
- Runbook and release documentation complete and reviewed.
- Regression suite and smoke suite pass without critical flakiness.
- Product and QA signoff recorded.
- Deployment recommendation is explicit: go, conditional-go, or hold.

## Mini-retrospective checklist (after each slice)

Use this checklist after Slice 1, Slice 2, and Slice 3.

- What was planned vs what was shipped?
- Which blockers repeated from prior slice?
- Which defects escaped to late QA, and why?
- Did parallel workstreams cause merge or dependency contention?
- Were acceptance criteria ambiguous at implementation start?
- Which tests were missing when bugs appeared?
- What should be stopped, started, and continued next slice?
- Which one process change is mandatory for next slice?
- Who owns each action item and by what date?

## If no gates are enforced: what to proceed with

If formal quality gates are not enforced, proceed in strict risk order and timeboxes:

1. Continue with Slice 1 first (BL-001 + BL-004) and do not defer these safety items.
2. Move directly to Slice 2 (BL-003 + BL-005) once core paths are manually smoke-tested.
3. Run a lightweight 30-minute retro between slices, capture top 3 defects, and immediately convert to backlog tasks.
4. Use "conditional proceed" criteria instead of hard gates:
- No known data-loss/security bug.
- No unbounded crash loop.
- Workaround exists for any remaining high-severity issue.
5. Reserve Slice 3 as debt burn-down and stabilization buffer even if feature pressure increases.

Operational rule without gates:
- Never skip retros.
- Never skip smoke tests for startup, kill-switch state, and account freshness.
- Always log unresolved risks in release notes before proceeding.

## Suggested owner matrix

- Product Manager: scope, acceptance clarity, risk acceptance log
- FullStackDeveloperAgent: BL implementation + integration hardening
- TesterAgent: test design, failure-mode coverage, signoff report
- QuantAgent: validate user-facing risk semantics for kill switch and staleness thresholds
- AlpacaAPIExpert: verify account freshness behavior against broker API response timing
