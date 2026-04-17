# ULTRATRADER 2026 — STATE.md
## Last Updated: 2026-04-15

---

## CURRENT STATUS

**Platform Mode:** paper  
**Active Accounts:** 4 (all Alpaca paper)  
**Active Deployments:** 0  
**Strategies:** 10+  
**Data Service:** Data_Service_OtijiTrader-Paper (Alpaca)  
**Bug Fixes Applied (This Session):** 9  
**Test Data Issues:** 2 (duplicate strategies; duplicate watchlists)  

---

## SESSION LOG — 2026-04-15

### Completed
- ✅ Fixed 9 bugs across frontend and backend
- ✅ Completed full UAT/UX review of all 20+ pages
- ✅ Changed PLATFORM_MODE from "backtest" → "paper"
- ✅ Verified promote-to-paper flow works correctly
- ✅ Generated comprehensive UAT_UX_REPORT.md

### In Progress
- ⏳ Strategy creation pending (Bollinger Band Mean Reversion)

### Next Actions
1. Create and backtest Bollinger Band Mean Reversion strategy
2. Promote to paper deployment on Alpaca account
3. Begin Phase 1 implementation (Watchlist→Deployment wiring)
4. Prioritize Phase 8 infrastructure alongside Phase 7

---

## PHASE STATUS & GAP ANALYSIS

### PHASE 1 — Watchlist-Driven Symbol Engine
**STATUS:** 🟡 **PARTIALLY EXISTS**

**EXISTING:**
- ✅ Watchlist model and CRUD operations (backend/app/models/watchlist.py)
- ✅ Watchlist Library UI with manual and scanner types
- ✅ 7+ watchlists configured (day trading, position universes, momentum, etc.)
- ✅ Scanner watchlists with cron-like refresh schedules
- ✅ Symbol count and refresh metadata displayed

**GAPS:**
- ❌ Deployment model lacks `symbol_source` field to reference watchlist
- ❌ No watchlist→deployment wiring in execution loop
- ❌ No snapshot vs live mode toggle (static vs dynamic symbols)
- ❌ No mid-run symbol refresh safety mechanism
- ❌ Strategy execution doesn't automatically pull symbols from assigned watchlist

**PRIORITY:** High — Required for dynamic symbol management  
**EFFORT:** 2–3 sprints (model update + execution wiring + safety layer)

---

### PHASE 2 — Optimization System
**STATUS:** 🟡 **PARTIALLY EXISTS**

**EXISTING:**
- ✅ Optim. Lab page with 5 analysis tabs:
  - Comparison (parameter combinations ranked by IS/OOS Sharpe)
  - Weights (feature importance)
  - Independence (correlation analysis)
  - Universe (symbol exposure)
  - Stress (drawdown scenarios)
- ✅ Walk-forward analysis infrastructure
- ✅ CPCV (Combinatorially Purged Cross-Validation) implemented
- ✅ Parameter combination tracking in backtest results

**GAPS:**
- ❌ No dedicated OptimizationRun model
- ❌ Optimization results not persistently stored per parameter combination
- ❌ No API endpoints for optimization management (create, list, detail, delete)
- ❌ No direct "deploy selected optimization result" flow from Lab UI
- ❌ No parameter grid search automation
- ❌ No sensitivity analysis (tornado diagrams, 2D heatmaps)

**PRIORITY:** Medium — Valuable for production strategy refinement  
**EFFORT:** 2–3 sprints (model + API + UI deployment flow)

---

### PHASE 3 — Multi-Strategy Account Support
**STATUS:** 🟡 **PARTIALLY EXISTS**

**EXISTING:**
- ✅ Multiple accounts already configured (4 Alpaca paper accounts)
- ✅ Deployment model links strategy_version to account
- ✅ Account-level risk controls:
  - max_position_size_pct
  - max_daily_loss_pct
  - max_leverage
  - etc.
- ✅ Accounts page displays all accounts with live equity, P&L, positions

**GAPS:**
- ❌ No capital allocation percentage per deployment
- ❌ No enforcement of total allocation <= 100% per account
- ❌ No conflict resolution for same-symbol trades across strategies
- ❌ No aggregate position tracking (sum of all deployment positions)
- ❌ No rebalancing logic for capital shifts

**PRIORITY:** Medium — Required for portfolio-level strategies  
**EFFORT:** 2 sprints (allocation model + validation + conflict resolution)

---

### PHASE 4 — Portfolio Layer (TradingProgram)
**STATUS:** 🟡 **PARTIALLY EXISTS**

**EXISTING:**
- ✅ TradingProgram model exists
- ✅ Programs page with "Momentumm Swing" program
- ✅ 4-component readiness tracking (0/4 currently ready)
- ✅ "+ New Program" button functional

**GAPS:**
- ❌ Capital allocation enforcement not implemented (Phase 3 dependency)
- ❌ No per-program drawdown limits
- ❌ No kill switch integration at program level
- ❌ No scaling logic (reduce allocation if hitting limits)
- ❌ No per-strategy performance tracking within program context
- ❌ No program-level reporting dashboard

**PRIORITY:** Medium-Low — Architecture layer; Phase 3 dependency  
**EFFORT:** 2–3 sprints (enforcement + monitoring + kill switch)

---

### PHASE 5 — Config-Driven Strategy Engine
**STATUS:** ✅ **LARGELY COMPLETE**

**EXISTING:**
- ✅ Full YAML/JSON config format with:
  - Indicators (moving averages, bands, oscillators, etc.)
  - Entry/exit conditions (AND/OR/n-of-m logic)
  - Stops and targets
  - Position sizing rules
- ✅ Condition evaluation engine (conditions.py) with comprehensive logic support
- ✅ 12+ starter strategy configs in `backend/configs/strategies/`
- ✅ Indicator registry with 40+ supported indicators
- ✅ Rule engine evaluates conditions per bar
- ✅ Works identically across backtest/paper/live (same BacktestEngine)
- ✅ Config validation on load

**GAPS:**
- ⚠️ Some edge cases in condition evaluation may need testing (e.g., n-of-m with missing indicators)
- ⚠️ Not all indicator kinds fully wired in live mode (may have gaps in real-time calculation)

**PRIORITY:** Low — Core functionality complete  
**EFFORT:** 0.5 sprint (edge case testing + live mode verification)

---

### PHASE 6 — UI Strategy Builder
**STATUS:** ✅ **LARGELY COMPLETE**

**EXISTING:**
- ✅ StrategyCreator.tsx — full-featured strategy builder UI
- ✅ ConditionBuilder component for composing entry rules
- ✅ Indicator selector with 40+ indicators
- ✅ Risk configuration panel (stops, targets, position size)
- ✅ Live validation
- ✅ Draft auto-save functionality
- ✅ Structured inputs only (no free-text code entry)

**GAPS:**
- ⚠️ Watchlist selector not integrated into builder
- ⚠️ Optimization configuration not exposed in builder
- ⚠️ Could use visual preview/chart overlay of conditions (e.g., entry/exit signals on historical chart)
- ⚠️ No template/preset library for quick strategy creation

**PRIORITY:** Low — Nice-to-have enhancements  
**EFFORT:** 1–2 sprints (watchlist integration + chart preview)

---

### PHASE 7 — Execution Orchestrator
**STATUS:** 🟡 **PARTIALLY EXISTS**

**EXISTING:**
- ✅ Deployment state machine:
  - pending → running → paused → stopped
- ✅ Start/Pause/Stop API endpoints
- ✅ Kill switch per account and strategy
- ✅ AlpacaBroker async wrapper for order execution
- ✅ Order placement logic for entry/exit signals
- ✅ Position tracking per deployment

**GAPS:**
- ❌ No centralized orchestrator loop (main execution controller)
- ❌ No automatic symbol refresh from watchlists
- ❌ No signal evaluation trigger system (bar-by-bar iteration)
- ❌ No restart recovery (deployments don't resume after server restart)
- ❌ No order routing abstraction (single broker; needs abstraction for multi-broker)
- ❌ No order queuing or retry logic
- ❌ No slippage/commission simulation in live mode
- ❌ No automated order cancellation on strategy stop

**PRIORITY:** High — Critical for production deployments  
**EFFORT:** 3–4 sprints (orchestrator + watchlist wiring + recovery + multi-broker)

---

### PHASE 8 — Infrastructure Upgrade
**STATUS:** 🔴 **NOT STARTED**

**EXISTING:**
- ⚠️ SQLite database (dev mode only)
- ⚠️ Docker Compose with PostgreSQL option (commented out)
- ✅ asyncio-based execution (async-ready)

**GAPS:**
- ❌ **Production database:** SQLite lacks concurrent write safety; must migrate to PostgreSQL
- ❌ **Worker queue:** No Celery, RQ, or equivalent for background jobs
- ❌ **Persistent job tracking:** Backtest runs and deployments lost on restart
- ❌ **Retry logic:** No built-in retry for failed orders, API calls, or data fetches
- ❌ **Job resumption:** Backtests and deployments don't survive server restarts
- ❌ **Concurrent run isolation:** Multiple backtest runs may interfere with shared state
- ❌ **Monitoring/alerting:** No structured logging, metrics, or alerting infrastructure
- ❌ **Secrets management:** Credentials stored in .env; needs vault (HashiCorp, AWS Secrets Manager)
- ❌ **Rate limiting:** No API throttling for broker calls

**PRIORITY:** **CRITICAL** — Required before any live trading  
**EFFORT:** 4–6 sprints (PostgreSQL + Celery + recovery + monitoring)

**RECOMMENDATION:** Run Phase 8 in parallel with Phase 7 to ensure stability before live deployment.

---

## ARCHITECTURE OVERVIEW

### Current Stack
- **Backend:** FastAPI (async)
- **Frontend:** React (TypeScript)
- **Database:** SQLite (dev), PostgreSQL (production-ready, not yet deployed)
- **Broker API:** Alpaca (via alpaca-trade-api)
- **Strategy Engine:** Config-driven (YAML/JSON)
- **Execution:** asyncio event loop

### Key Components
1. **Strategy Config Engine** (Phase 5) — Fully implemented
2. **Backtest Engine** — Reuses BacktestEngine for consistency
3. **Strategy Builder UI** (Phase 6) — Fully implemented
4. **Deployment State Machine** (Phase 7) — Partially implemented
5. **Account & Risk Layer** (Phase 3) — Partially implemented
6. **Watchlist Library** (Phase 1) — Partially implemented
7. **Orchestrator Loop** (Phase 7) — Missing
8. **Infrastructure** (Phase 8) — Not started

---

## Data Quality Issues Identified

### Test Data Pollution
1. **Duplicate Strategies:**
   - Promo Strategy (x2)
   - Live Promo Strategy (x2)
   - Positions Strategy (x2)

2. **Duplicate Watchlists:**
   - MOmentum scanner watchlist (x5, all with 0 symbols)
   - Capitalization inconsistency: "MOmentum" vs. "Momentum"

3. **Typos:**
   - Programs page: "Momentumm" (double m) instead of "Momentum"

**Action:** Clean test data before production launch.

---

## Known UX Issues

### High Priority
1. Sidebar non-responsive (no hamburger menu on mobile)
2. Content clipped at bottom of some pages
3. EXPECTANCY label truncated on Overview tab

### Medium Priority
4. "→ Promote" tab label confusing (arrow implies navigation, not a tab)
5. "Walk-Forward Results" shows dashes without explanation
6. No "New Strategy" button on Strategies page

### Low Priority
7. No global search / keyboard shortcuts
8. No first-time user onboarding wizard

---

## Production Readiness Checklist

### Ready for Paper Trading
- ✅ Strategy creation and backtesting
- ✅ Multi-account support
- ✅ Config-driven execution
- ✅ Risk controls (per-account)
- ✅ UI fully functional (bugs fixed)

### Ready for Live Trading
- ❌ Infrastructure upgrade (Phase 8) — **BLOCKING**
- ❌ Execution orchestrator (Phase 7) — Complete Phase 7 gaps
- ❌ Manual safeguards (operator overrides, kill switches) — Phase 7
- ❌ Monitoring and alerting — Phase 8

### NOT Ready for Live Trading
- ❌ Phase 8 infrastructure must be completed first

---

## Recommended Roadmap

### Sprint 1–2 (Next 4 Weeks)
1. Create and backtest Bollinger Band Mean Reversion strategy
2. Promote first strategy to paper trading on Alpaca
3. Clean test data (deduplicate strategies, watchlists)
4. Fix UX bugs (sidebar responsiveness, label truncation)

### Sprint 3–4 (Weeks 5–8)
5. **Phase 1:** Implement watchlist→deployment wiring
6. **Phase 7 (Partial):** Build centralized orchestrator loop
7. Begin Phase 8 parallel track (PostgreSQL migration, Celery setup)

### Sprint 5–7 (Weeks 9–16)
8. **Phase 8 (Full):** Complete infrastructure (Celery, recovery, monitoring)
9. **Phase 7 (Complete):** Add restart recovery, multi-broker abstraction
10. **Phase 3 (Medium):** Implement capital allocation and conflict resolution

### Sprint 8+ (Live Trading Prep)
11. **Phase 2:** Optimization system persistence and API
12. **Phase 4:** Portfolio-level controls (drawdown limits, scaling)
13. Operator safeguards and manual overrides
14. Load testing and stress testing
15. Go-live checklist and operational runbook

---

## Critical Dependencies

- **Phase 1 → Phase 7:** Watchlist wiring requires orchestrator
- **Phase 3 → Phase 4:** Portfolio layer depends on multi-strategy support
- **Phase 7 → Phase 8:** Orchestrator needs persistent infrastructure
- **All → Phase 8:** Production stability blocks live trading

---

## Performance & Stability Notes

### Current Limitations
- Backtests don't persist across restarts
- SQLite concurrent writes unsafe
- No background job queue (all work synchronous)
- No order retry logic

### After Phase 8
- Persistent backtest runs (PostgreSQL)
- Concurrent backtest isolation (Celery workers)
- Order retry with exponential backoff
- Deployment resumption after restarts

---

## Next Review Date
**2026-05-15** (monthly update recommended after each major phase completion)

---

## Summary

UltraTrader 2026 is **production-ready for paper trading** but **NOT ready for live trading** until Phase 8 infrastructure is complete. The 8-phase roadmap provides clear gaps and priorities. Begin with Phase 1 (watchlist integration) after first paper deployment, running Phase 8 in parallel to ensure stability before going live.

**Recommended:** Allocate 1–2 sprints to Phase 8 infrastructure before expanding beyond paper trading.
