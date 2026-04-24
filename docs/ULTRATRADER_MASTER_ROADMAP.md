# UltraTrader 2026 — Master Roadmap & Handoff Document

**Last updated:** 2026-04-17  
**Author:** nitefader + Claude Sonnet 4.6  
**Purpose:** Single source of truth. If this agent dies, the next agent reads this first. It contains the vision, the architecture, everything built, and exactly what to do next. No other doc supersedes this one.

---

## THE VISION (from the owner)

UltraTrader 2026 is a **professional-grade, self-hosted algorithmic trading platform** built for a serious solo operator who thinks like an institution but trades their own capital. The goal is not to build another Quantconnect clone — it is to build a system that:

1. **Enforces discipline through the software itself.** The platform should make it hard to deploy an untested strategy, easy to see when something is going wrong, and impossible to accidentally blow up an account through careless clicks.

2. **Matches the mental model of someone who trades ThinkorSwim.** VWAP, opening range, ATR-based stops, regime filters — these are not optional indicators, they are the vocabulary the operator thinks in. The platform must speak that language.

3. **Has a coherent workflow.** Not a collection of pages — a pipeline: Build → Validate → Optimize → Package → Deploy → Monitor. Every screen should know where it sits in that pipeline and tell the user what comes next.

4. **Is extensible without being unstable.** New order types, new indicators, new risk rules — these should slot in without breaking existing backtests. The architecture must be config-driven and version-aware.

5. **Golden templates are first-class citizens.** The platform ships with curated watchlists and risk profiles that represent real-world trading styles. Users customize from templates, never from scratch.

6. **The governor is the last line of defense.** Every live order passes through the AccountGovernor. It checks collisions, correlation limits, risk profile rules, and daily loss locks before anything touches the broker. Hot-adding programs without restarts is a requirement.

---

## TECHNICAL ARCHITECTURE (what the next agent must know)

### Stack
- **Frontend:** React 18 + TanStack Query + React Router 6 + Tailwind CSS + Vite (port 5173)
- **Backend:** FastAPI + SQLAlchemy async + SQLite/aiosqlite (port 8000)
- **Python:** 3.11+, all async routes
- **DB migrations:** Handled by `_run_schema_migrations()` in `backend/app/main.py` — safe ALTER TABLE tuples, idempotent
- **Seed data:** `seed_default_data()` in `backend/app/main.py` — runs on every startup, idempotent by name-existence checks. **Never use a separate seed script — put all default data here.**

### Key architectural facts
- `StrategyVersion.config` is a JSON blob — the entire strategy (entry conditions, stop_loss, targets, position_sizing, risk, indicators, entry_module) lives in this dict
- `TradingProgram` is a **frozen** deployment template — once frozen, it cannot be edited. Changes require a new program version
- `AccountAllocation` binds a frozen program to an account with bounded overrides (±20% sizing, ±30min session shift)
- `Deployment` is the governor record — `governor_status` field distinguishes it from regular deployments
- The governor loop re-queries `AccountAllocation` on every tick — hot-add is DB-level supported already
- `BacktestRun` metrics live in `RunMetrics.walk_forward` (NOT `BacktestRun.walk_forward_summary`)
- `Trade.regime_at_entry` exists on every trade record — regime analysis groups by this field
- Golden templates use `is_golden=True` flag — DELETE is blocked (403), duplicate creates a mutable copy
- `bool()` cast required when serializing SQLite booleans — SQLite stores 0/1, not true/false
- `calculate_stop()` and `calculate_target()` in `stops.py` now support per-direction config: `{"long": {...}, "short": {...}}`
- Backtest engine now supports pending orders: `entry_module.order_type` = market/limit/stop; pending orders stored in `_pending_orders` list, checked each bar via `_process_pending_orders()`

### File map (critical files only)
```
backend/
  app/
    main.py                          ← startup: migrations + seed_default_data()
    api/routes/
      backtests.py                   ← launch, regime-analysis, recommendations, optimize
      governor.py                    ← halt, resume, allocate (hot-add), events
      simulations.py                 ← create simulation (accepts program_id OR strategy_version_id)
      watchlists.py                  ← CRUD + golden guard + duplicate + delete with in-use check
      risk_profiles.py               ← CRUD + golden guard + duplicate
      programs.py                    ← program CRUD, freeze, allocations
    core/
      backtest.py                    ← BacktestEngine: market/limit/stop orders, pending order queue
      portfolio.py                   ← Portfolio + Position dataclasses
    strategies/
      stops.py                       ← calculate_stop, calculate_target, update_trailing_stop (direction-aware)
      conditions.py                  ← EvalContext, evaluate_conditions
      sizing.py                      ← calculate_position_size
    models/
      trading_program.py             ← TradingProgram + AccountAllocation
      deployment.py                  ← Deployment (also governor record)
      watchlist.py                   ← Watchlist (is_golden, tags)
      risk_profile.py                ← RiskProfile (is_golden, tags)
      governor_event.py              ← GovernorEvent audit log
    services/
      governor_service.py            ← create_governor, halt, resume, serialize
      watchlist_service.py           ← serialize_watchlist (includes is_golden, tags)

frontend/
  src/
    api/
      backtests.ts                   ← launch, getEquityCurve, getTrades, compare, getRegimeAnalysis, getRecommendations, paramOptimize
      governor.ts                    ← list, get, halt, resume, getEvents, allocate
      programs.ts                    ← TradingProgram type, programsApi (list, create, freeze, allocations)
      simulations.ts                 ← create (accepts program_id OR strategy_version_id)
      watchlists.ts                  ← Watchlist type (is_golden, tags), delete, duplicate
      riskProfiles.ts                ← RiskProfile type (is_golden, tags), duplicate
    components/
      Layout.tsx                     ← nav groups: Build / Test & Validate / Optimize / Deploy & Monitor / System
      PageHelp.tsx                   ← context-aware info drawer, PAGE_HELP_REGISTRY for all 10 key pages
      StrategyBuilder/ConditionBuilder.tsx  ← VWAP, opening_range_high/low in INDICATORS
    pages/
      StrategyCreator.tsx            ← Entry Module section (market/limit/stop), per-direction stop/target toggles
      SimulationLab.tsx              ← source toggle: Strategy Version | Program
      BacktestLauncher.tsx           ← full launch form
      OptimizationLab.tsx            ← Results/Walk-Forward/Param Search/Paper→Live tabs
      RunDetails.tsx                 ← trade log, equity curve, regime suitability, diagnostics, "Create Program" button
      TradingPrograms.tsx            ← workflow accordion, query param prefill (?strategy_version_id=)
      AccountGovernor.tsx            ← halt/resume, events, "Add Program" hot-add modal
      WatchlistLibrary.tsx           ← golden Crown badge, Duplicate button, tags
      RiskProfiles.tsx               ← golden Crown badge, Duplicate button, tags
      RunHistory.tsx                 ← list of completed backtest runs
```

---

## WHAT HAS BEEN BUILT (as of 2026-04-17)

### Phase 0 — Monday-Ready UX (COMPLETE)

**P0-1 — Navigation reorder** ✅  
Nav is now grouped: Build / Test & Validate / Optimize / Deploy & Monitor / System. Matches the actual workflow order. File: [Layout.tsx](../frontend/src/components/Layout.tsx)

**P0-2 — PageHelp context-aware drawer** ✅  
`<PageHelp page="..." />` button on every key page. Slides open a right-side drawer with workflow placement, what the page does, key actions. 10 pages covered. File: [PageHelp.tsx](../frontend/src/components/PageHelp.tsx)

**P0-3 — VWAP + opening range in ConditionBuilder** ✅  
`vwap`, `opening_range_high`, `opening_range_low` added to INDICATORS array. All three are computed by the backend already. File: [ConditionBuilder.tsx](../frontend/src/components/StrategyBuilder/ConditionBuilder.tsx)

**P0-4 — Optim Lab improvements** ✅  
- Dismissible scope banner above tabs
- Walk-Forward tab renamed to "Walk-Forward Analysis"
- WFA empty state now explains how to enable walk-forward
- Param Search tab added (see P2-1)
File: [OptimizationLab.tsx](../frontend/src/pages/OptimizationLab.tsx)

**P0-5 — Programs workflow accordion** ✅  
7-step "How to use Programs" accordion at top of Programs page (collapsed by default, expands to show full pipeline). File: [TradingPrograms.tsx](../frontend/src/pages/TradingPrograms.tsx)

**P0-6 — RunDetails "Create Program from this Run" button** ✅  
Button in run header navigates to `/programs?strategy_version_id=<id>&run_id=<id>`. Programs page reads query params and auto-opens create modal with strategy version pre-selected. Files: [RunDetails.tsx](../frontend/src/pages/RunDetails.tsx), [TradingPrograms.tsx](../frontend/src/pages/TradingPrograms.tsx)

---

### Phase 1 — Core Workflow Improvements (COMPLETE)

**P1-1 — SimLab accepts TradingPrograms** ✅  
- Source toggle pill: "Strategy Version" | "Program"
- When Program mode: SelectMenu of frozen programs, context chips showing duration_mode
- Backend: `program_id` resolves to `strategy_version_id` via DB lookup
- Files: [SimulationLab.tsx](../frontend/src/pages/SimulationLab.tsx), [simulations.py](../backend/app/api/routes/simulations.py), [simulations.ts](../frontend/src/api/simulations.ts)

**P1-2 — Golden Watchlist Templates** ✅  
- `is_golden`, `tags` columns on Watchlist model (migrations auto-run on startup)
- 4 golden watchlists seeded in `seed_default_data()`:
  - "Mag-7 + AI Leaders" (AAPL/MSFT/NVDA/GOOGL/META/AMZN/TSLA/PLTR/ARM/AVGO) — momentum
  - "Liquid Mid-Cap Movers" (COIN/MARA/RIOT/SMCI/HOOD/RBLX/SOFI/UPST/AFRM/IONQ) — day_trading/volatile
  - "Sector ETFs" (XLK/XLF/XLE/XLV/XLU/XLI/XLRE/XLC/XLP/XLY) — swing/diversified
  - "SPY 500 Core" (SPY/QQQ/IWM/DIA/VTI/GLD/SLV/TLT/HYG/USO) — position/macro
- DELETE blocked with 403 for golden; in-use check blocks delete if used by programs (409)
- `POST /watchlists/{id}/duplicate` creates mutable copy
- Crown badge, amber border, tags as chips in UI
- Files: [watchlist.py](../backend/app/models/watchlist.py), [watchlists.py](../backend/app/api/routes/watchlists.py), [WatchlistLibrary.tsx](../frontend/src/pages/WatchlistLibrary.tsx)

**P1-3 — Golden Risk Profile Templates** ✅  
- `is_golden`, `tags` columns on RiskProfile model
- 4 golden profiles seeded:
  - "Day Trader — Conservative" — max 3 long, 2% daily loss, 5% drawdown lockout, 1x leverage
  - "Swing Trader — Standard" — max 5 long / 2 short, 3% daily loss, 10% drawdown lockout
  - "Swing Trader — Aggressive" — max 8 long / 3 short, 5% daily loss, 15% drawdown lockout, 1.5x leverage
  - "Position Trader" — max 10 long / 3 short, 8% daily loss, 20% drawdown lockout
- Same protections as watchlists (DELETE blocked, duplicate endpoint)
- Files: [risk_profile.py](../backend/app/models/risk_profile.py), [risk_profiles.py](../backend/app/api/routes/risk_profiles.py), [RiskProfiles.tsx](../frontend/src/pages/RiskProfiles.tsx)

**P1-4 — Watchlist in-use protection** ✅  
DELETE endpoint checks all TradingProgram rows for watchlist usage before deleting. Returns 409 with program names if in use. Included in P1-2 implementation.

---

### Phase 2 — Param Optimizer + Regime Analysis (COMPLETE)

**P2-1 — Param Search tab in Optim Lab** ✅  
Full `ParamSearchTab` component: strategy/version pickers, symbol/timeframe/dates, dynamic param grid rows (dotted path + comma-separated values), objective metric, max combos, results table with top 20 ranked combos. Calls `POST /backtests/optimize`. File: [OptimizationLab.tsx](../frontend/src/pages/OptimizationLab.tsx)

**P2-2 — Regime Suitability Analysis** ✅  
- `GET /backtests/{run_id}/regime-analysis` — groups trades by `regime_at_entry`, computes win_rate/avg_pnl/trade_count, suitability: recommended (≥5 trades, win_rate>0.55) / avoid (≥5 trades, win_rate<0.35) / neutral
- Regime Suitability table in RunDetails overview tab (emerald/gray/red badges)
- Files: [backtests.py](../backend/app/api/routes/backtests.py), [RunDetails.tsx](../frontend/src/pages/RunDetails.tsx)

**P2-3 — Strategy Diagnostics** ✅  
- `GET /backtests/{run_id}/recommendations` — pure heuristic analysis: drawdown vs profit_factor, WFA degradation (IS→OOS Sharpe), avg hold vs duration_mode, trade count sufficiency, best regime suggestion
- "Strategy Diagnostics" card in RunDetails with severity-colored list (sky/amber/red)
- Files: [backtests.py](../backend/app/api/routes/backtests.py), [RunDetails.tsx](../frontend/src/pages/RunDetails.tsx)

---

### Phase 3 — Modular Entry Orders + Per-Direction Exits + Governor Hot-Add (COMPLETE)

**P3-1 — Modular Entry Order Types** ✅  
- `entry_module` config added to strategy JSON: `{order_type, limit_offset_atr, limit_offset_pct, time_in_force, cancel_after_bars}`
- Backtest engine: market orders → existing next-bar-open fill. Limit/stop orders → queued in `_pending_orders` list, checked each bar against bar H/L for fill condition
- Cancel logic: `cancel_after_bars` counter + day TIF defaults to 78 bars (~1 session of 5m bars)
- Entry Module section in StrategyCreator: Order Type / ATR Offset / % Offset / Time-in-Force / Cancel After N Bars
- Files: [backtest.py](../backend/app/core/backtest.py), [StrategyCreator.tsx](../frontend/src/pages/StrategyCreator.tsx)

**P3-2 — Per-Direction Exit Rules** ✅  
- `stops.py`: both `calculate_stop()` and `calculate_target()` detect `{long: {...}, short: {...}}` config shape and route by direction
- StrategyCreator: direction pill toggle (Both / Long only / Short only) on Stop Loss and Profit Targets sections. Split mode serializes as `{long: {...}, short: {...}}`
- Files: [stops.py](../backend/app/strategies/stops.py), [StrategyCreator.tsx](../frontend/src/pages/StrategyCreator.tsx)

**P3-3 — Governor Hot-Add** ✅  
- `POST /governor/{account_id}/allocate` — validates frozen program, prevents double-allocation (409), creates AccountAllocation row, emits `program_added` GovernorEvent. No restart needed.
- "Add Program" button next to Governor section header → `AddProgramModal`: shows frozen programs, capital input, broker mode toggle (paper/live), calls allocate endpoint
- Files: [governor.py](../backend/app/api/routes/governor.py), [governor.ts](../frontend/src/api/governor.ts), [AccountGovernor.tsx](../frontend/src/pages/AccountGovernor.tsx)

---

## KNOWN PRE-EXISTING TS ERRORS (not introduced by Phase 3 work)

These existed before Phase 3 and should be fixed separately:

1. `ChartLab.tsx:213` — `number | null` not assignable to `string | number | undefined` (chart tooltip type)
2. `SimulationLab.tsx:363` — `provider` and `date_clamped` properties missing from `SimulationMetadata` type — **the backend returns these fields; the type just needs updating in `types/index.ts`**

---

## NEXT STEPS (what to build next, in priority order)

### N1 — WebSocket Real-Time Push (HIGH — needed for live ops)
**Why:** The live monitor currently polls every 5-15s. For a live account, a fill that goes wrong needs to be visible in <2s. This is the biggest gap between the current UX and a production-quality operator experience.

**What:**
- Backend: emit events on position open/close, fill, kill switch trigger via WebSocket
- Frontend: WebSocket client that merges events into TanStack Query cache
- Graceful degradation: falls back to polling when stream is interrupted, shows "live" vs "stale" indicator

**Files to touch:** new `backend/app/api/routes/ws.py`, `frontend/src/hooks/useWebSocket.ts`, `LiveMonitor.tsx`

---

### N2 — Trade Replay Mode (HIGH — core learning tool)
**Why:** The owner wants to understand *why* a strategy entered and exited. Right now RunDetails shows the trade table but not the signal trace. Replay mode lets you step through each bar of a trade and see which conditions fired.

**What:**
- Backend: `GET /backtests/{run_id}/trades/{trade_id}/replay` — returns bar-by-bar OHLCV + indicator values + condition evaluation results for the trade window
- Frontend: `TradeReplayPanel` in RunDetails — bar stepper, mini chart, condition truth table per bar

**Files to touch:** `backtests.py` (new endpoint), `backtest.py` (store condition fire logs per trade), `RunDetails.tsx`

---

### N3 — Strategy Import/Export (MEDIUM — portability)
**Why:** The owner should be able to save a working strategy config as a file, move it between environments, or share it. Right now everything is locked in the DB.

**What:**
- `GET /strategies/{id}/export` — returns strategy + all versions as JSON/YAML
- `POST /strategies/import` — validates and creates strategy from file
- Export/Import buttons in Strategies page

---

### N4 — Parameter Sensitivity Heatmap (MEDIUM — optimizer visualization)
**Why:** The Param Search tab now runs parameter optimization and shows a results table. The next step is visualizing the sensitivity surface — which parameter values are robust vs fragile.

**What:**
- Results from `paramOptimize` already have all combos
- Render 2D heatmap (param A × param B → Sharpe) using a lightweight charting lib
- Add to Param Search tab in Optim Lab

---

### N5 — Pre-Market Checklist (MEDIUM — operator discipline)
**Why:** A live account operator needs a daily checklist before the market opens. The platform should enforce this — show a modal at 9:00am ET if there's a live deployment active and the checklist hasn't been signed off.

**What:**
- Frontend: timed modal (checks time at mount) with checklist items: news check, gap check, risk limits reviewed, governor active
- Checklist state persisted per day in localStorage or backend
- Skip not allowed for live-mode accounts

---

### N6 — Multi-Strategy Portfolio View (MEDIUM — risk management)
**Why:** As the number of active programs grows, the operator needs to see net exposure across strategies and symbols — not just per-deployment metrics.

**What:**
- `GET /governor/{account_id}/portfolio-snapshot` — aggregates all active allocations: net long/short exposure by symbol, by sector, correlation matrix
- Portfolio exposure matrix in AccountGovernor page

---

### N7 — Strategy Version Diff Viewer — COMPLETE (2026-04-17)
**Why:** When iterating on a strategy, it's useful to see exactly what changed between version 1 and version 2 without manually comparing JSON.

**What (delivered):**
- `GET /strategies/{id}/versions/{v1}/diff/{v2}` — flat dot-path diff of config keys: added/removed/changed
- `VersionDiffPanel.tsx` — right-side drawer with changed (amber), added (green), removed (red) sections
- GitCompare icon on version list items; click to compare against selected version

---

### N8 — Backup/Restore UI — COMPLETE (2026-04-17)
**Why:** The entire platform state is in a SQLite file. The operator should be able to export a backup and restore it without touching the filesystem.

**What (delivered):**
- `GET /admin/backup` — streams DB file with timestamped filename
- `POST /admin/restore` — validates SQLite magic header, saves pre-restore snapshot, replaces DB atomically
- `/backup` page in System nav with download button and guarded restore flow (confirm dialog)

---

## THINGS NOT TO DO (lessons learned)

1. **Never put seed data in a separate script.** Always in `seed_default_data()` in `main.py`. The owner explicitly asked for this — it runs on every startup and is idempotent.

2. **Never use lazy relationships in async FastAPI routes.** SQLAlchemy async requires explicit `await db.execute(select(...))` for related models. Accessing `run.strategy_version` without a prior explicit load will raise `MissingGreenlet` errors.

3. **Never touch `main` branch directly with risky changes.** The current working branch is `architecture`. All Phase 0-3 work was done here.

4. **The backtest engine fills at next bar OPEN for market orders** — this is intentional to avoid lookahead bias. Do not change this.

5. **`Halt All` not `Halt Trading`** — the halt button text is always "Halt All". This is a deliberate terminology choice by the owner.

6. **`bool()` cast for SQLite booleans** — when serializing model fields in route responses, always wrap: `"is_golden": bool(getattr(obj, "is_golden", False))`. SQLite returns 0/1 integers which JSON-encode as numbers not booleans.

7. **Golden templates are read-only at the model level** — never allow DELETE or direct edit of is_golden=True records. Always offer "Duplicate" as the escape hatch.

---

## HOW TO RESUME WORK (cold start instructions for next agent)

1. Read this document fully before touching any code.
2. Run `git log --oneline -10` to see what's been committed recently.
3. Run `git status` to see what's staged/unstaged.
4. Check `backend/app/main.py` → `seed_default_data()` for the current state of DB defaults.
5. Check `backend/app/main.py` → `_run_schema_migrations()` for the current migration state.
6. The frontend dev server runs at `http://localhost:5173` — start it with `cd frontend && npm run dev`.
7. The backend runs at `http://localhost:8000` — start with `cd backend && uvicorn app.main:app --reload`.
8. TypeScript check: `cd frontend && npx tsc --noEmit`. Two pre-existing errors in ChartLab.tsx and SimulationLab.tsx are known — do not be alarmed.
9. Python syntax check: `python -c "import ast; ast.parse(open('backend/app/core/backtest.py').read())"` etc.

**Current branch:** `architecture`  
**Current state:** All of Phase 0 + Phase 1 + Phase 2 + Phase 3 complete. TypeScript clean (2 pre-existing errors in non-Phase-3 files). Python syntax clean.

**Pick up from:** N1 (WebSocket) or N2 (Trade Replay) depending on what the owner prioritizes next.
