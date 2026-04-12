# Walk-Forward Upgrade Report

## 1. Requirement Traceability Matrix

| Requirement | Implementation | Status |
|---|---|---|
| Sliding walk-forward folds (12m train / 3m test default) | `backend/app/services/backtest_service.py` calendar fold generation and defaults in launch route | Done |
| Blind OOS evaluation with locked train-to-test handoff | Fold-level train selection then locked strategy for test in `backtest_service.py` | Done |
| Stitched OOS-only equity | `walk_forward.stitched_oos_equity` payload in `backtest_service.py`, rendered in `RunDetails.tsx` | Done |
| Transaction-cost-aware testing | Added `commission_pct_per_trade` + per-share commission in `BacktestEngine` | Done |
| Anti-look-ahead / causality guardrails | Signal start gating (`signal_start_date`), causal swing detection, anti-bias flags | Done |
| UI distinction: naive vs OOS | OOS surfaced in overview + history, naive labeled separately | Done |
| Guided workflow for strategy/backtest research | Walk-forward controls and preflight checks in `BacktestLauncher.tsx` | Done |
| Fold-level outputs (train/test dates, params, metrics, trade count, turnover/cost, segment) | Included in `walk_forward.folds` payload and details table | Done |
| Integration with existing run details/history/promotion flow | Existing endpoints extended, details/history/propose flow updated | Done |

## 2. Slice Status Board

- S1 Walk-forward engine core: Completed
- S2 Strategy adaptation layer (baseline-capable + parameter policy): Completed (locked config + train-only grid selection framework)
- S3 Metrics and persistence: Completed (fold-level payload, stitched OOS, naive comparison, anti-bias flags)
- S4 UI workflow upgrade: Completed (guided launcher, OOS-first details/history, promotion gating)
- S5 Existing-system integration: Completed (launch API, run metrics serialization, run details/history surfaces)
- S6 Verification and anti-bias audit: Completed (tests + Quant/QA/PM review pass)

## 3. Defect / Rework Log

- Fixed: simplistic walk-forward split replaced by calendar sliding folds.
- Fixed: weak anti-bias pass semantics (empty folds no longer vacuously pass).
- Fixed: parameter-locking PASS now validated against applied locked config.
- Fixed: non-causal detector false-positive on swing indicators.
- Fixed: OOS benchmark prominence in run overview/history and promotion gating.
- Fixed: promotion now blocked when anti-bias checks fail.

## 4. Anti-Bias Verification Evidence

- Parameters selected on train only, then locked for test: implemented and fold-validated.
- Test unseen enforcement: `signal_start_date` gates entries in test runs.
- OOS-only stitched benchmark: produced in `walk_forward.stitched_oos_equity`.
- Leakage checks: explicit train_end < test_start validation per fold.
- Causality checks: anti-bias payload + non-causal marker detection + causal swing implementation.
- UI honesty: OOS metrics elevated, naive metrics explicitly separated.

## 5. Test and Regression Evidence

Executed:
- `pytest tests/test_walk_forward_framework.py tests/test_backtests_launch_api.py tests/test_backtest_indicator_support.py tests/test_reporting_metrics.py -q`
- Result: `17 passed`

Executed:
- `npm run build` (frontend)
- Result: successful production build

## 6. UI/Workflow Upgrade Summary

- Backtest launcher now includes guided walk-forward settings:
  - enable/disable walk-forward
  - train/test windows
  - warmup bars
  - max folds
  - transaction cost controls (`commission_per_share` + `% per trade`)
- Run details now emphasize OOS benchmark first and show:
  - anti-bias pass/fail banner
  - stitched OOS equity chart
  - naive vs OOS comparison cards
  - fold-level params, turnover, and cost impact
- Run history now surfaces OOS return and anti-bias badge at list level.
- Promotion flow now includes anti-bias checklist item and hard blocking on failed checks.

## 7. Final PM Sign-Off Summary

Decision: Approved (PM review pass after OOS prominence and promotion governance fixes).

Rationale: The workflow now clearly prioritizes honest OOS evidence, enforces anti-bias gating before promotion, and remains integrated with existing strategy/backtest run lifecycle and visibility surfaces.
