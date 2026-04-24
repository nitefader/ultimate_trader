# AGENTS.md — Codex Agent Reference

This file is the authoritative reference for Codex agents operating in this repository.
Read it in full before generating any code. Architecture violations here cause broken
backtests, rejected PRs, and potentially incorrect live order submission.

---

## Project Summary

**Ultimate Trading Software 2026** is an Alpaca-first algorithmic trading platform.
- Backend: FastAPI + SQLAlchemy 2.0 + aiosqlite (Python 3.11)
- Frontend: React + TypeScript + Vite + Tailwind CSS
- Broker: Alpaca Markets (paper + live)
- Test suite: pytest with pytest-asyncio, 317 tests baseline — never drop below.

---

## Architecture — Canonical Component Model (STRICT)

Every piece of logic belongs in exactly one component. When writing or reviewing code,
verify placement before proceeding. Misplaced logic is a hard failure.

```
Program
  ├── Strategy           (what to trade and why)
  ├── Strategy Controls  (when strategy is allowed to act)
  ├── Risk Profile       (how much risk is allowed)
  ├── Execution Style    (how orders are expressed)
  └── Watchlist          (where the strategy can hunt)

Portfolio Governor      (final authority before broker execution)
Broker Account          (real Alpaca endpoint and broker truth)
Deployment              (runtime instance of a Program on a Broker Account)
```

### What Goes Where — Quick Reference

| Concern | Component |
|---------|-----------|
| Entry signal conditions | Strategy |
| Stop price calculation (informational) | Strategy |
| Logical exit conditions | Strategy |
| Position sizing (shares/dollars/risk%) | Risk Profile |
| Daily loss limit | Risk Profile |
| Max drawdown lockout | Risk Profile |
| Max concurrent positions cap | Risk Profile |
| Session window (9:30–16:00 ET) | Strategy Controls |
| Timeframe (1m, 5m, daily) | Strategy Controls |
| Regime filter (VIX, trend state) | Strategy Controls |
| Cooldown between trades | Strategy Controls |
| PDT rule enforcement | Strategy Controls |
| Gap risk filter | Strategy Controls |
| Order type selection | Execution Style |
| Limit pullback distance | Execution Style |
| Scale-out rules | Execution Style |
| Fill retry logic | Execution Style |
| Bracket order structure | Execution Style |
| Symbol list | Watchlist |
| Cross-program conflict resolution | Portfolio Governor |
| Kill / pause of new opens | Portfolio Governor |
| Position tracking (client_order_id attribution) | Portfolio Governor |
| Broker balances / broker positions / fills / restrictions | Broker Account |
| Runtime lifecycle of an active program | Deployment |

---

## Hard Rules — Enforced by All Skills

1. **NO sizing in Strategy.** Risk Profile owns all sizing.
2. **NO regime filter in Strategy.** Strategy Controls owns regime.
3. **NO direct broker calls bypassing Portfolio Governor.**
   Only `backend/app/services/alpaca_service.py` calls Alpaca, and only when Account
   Portfolio Governor approves.
4. **NO conflicting long/short per symbol per account.** Portfolio Governor must
   resolve before any order is submitted.
5. **NO `execution_policy` field on Strategy model.** Belongs in Execution Style.
6. **NO silent failures.** All errors must surface — log and propagate.
7. **NO test deletion or skipping to make CI pass.**
8. **NO weakening of assertions.**
9. **NO hardcoded API keys or credentials.**
10. **NO sync SQLAlchemy calls in async contexts.**

---

## Alpaca Constraints (Non-Negotiable)

- **No conflicting positions:** Alpaca does not allow long and short simultaneously
  in the same symbol on the same account. Portfolio Governor must check and reject.
- **Native brackets only:** Bracket orders must use Alpaca's native bracket format —
  one order object with `take_profit` and `stop_loss` legs. Never simulate with
  separate orders.
- **`client_order_id` on every order:** Required for Portfolio Governor attribution and tracking.
- **Paper vs live URLs:** Never hardcode. Read from environment variables.
- **Rate limits:** Use exponential backoff. Do not hammer Alpaca's API.
- **Order routing:** All orders go through `alpaca_service.submit_order()`. No exceptions.
- **Global kill semantics:** Global kill stops new position-opening orders platform-wide and cancels resting opening orders that are not backing an existing open position. It does not flatten positions.
- **Program pause semantics:** Program pause stops new position-opening orders for that program and cancels resting opening orders attributed to that program that are not backing an existing open position.
- **Broker account pause semantics:** Account/portfolio pause stops new position-opening orders for that broker-account scope and cancels resting opening orders in that scope that are not backing an existing open position.
- **Flatten semantics:** Flatten is explicit liquidation only. It is separate from kill/pause behavior.

---

## Commands Agents Must Know

### Backend Validation
```bash
# Run full test suite (must show 317+ passing, 0 failing)
cd backend && python -m pytest tests/ -x -q --tb=short

# Run a specific test module
cd backend && python -m pytest tests/test_backtests.py -x -q --tb=short

# Verify imports are clean
cd backend && python -c "from app.main import app; print('Import OK')"

# Start backend
cd backend && uvicorn app.main:app --reload --port 8000
```

### Frontend Validation
```bash
# Type check (must be 0 errors)
cd frontend && npx tsc --noEmit

# Production build (must succeed)
cd frontend && npx vite build

# Lint check
cd frontend && npx eslint src/ --ext .ts,.tsx

# Start frontend
cd frontend && npx vite --port 5173
```

### Pre-PR Checklist (Always Run Both)
```bash
cd backend && python -m pytest tests/ -x -q --tb=short
cd frontend && npx tsc --noEmit
```

---

## File Structure

```
backend/
  app/
    api/
      routes/
        backtests.py        # backtest CRUD and launch endpoints
        control.py          # account governor + kill switch endpoints
        ml.py               # ML model endpoints
        services.py         # broker service status endpoints
        simulations.py      # simulation CRUD and launch endpoints
        strategies.py       # strategy CRUD endpoints
        watchlists.py       # watchlist CRUD endpoints
    core/
      backtest.py           # backtest engine
      constants.py          # shared constants (no magic numbers inline)
    models/
      __init__.py
      account.py            # Account, AccountGovernor ORM models
      data_service.py       # DataService ORM model
      deployment.py         # Deployment ORM model
      trading_program.py    # Program, Strategy, Governor, ExecStyle, RiskProfile ORM models
      watchlist.py          # Watchlist, WatchlistSymbol ORM models
    services/
      alpaca_service.py     # ONLY file that calls Alpaca API
      deployment_service.py # Manages program deployment lifecycle
      paper_broker.py       # Paper trading simulation
      watchlist_service.py  # Watchlist business logic
    strategies/
      stops.py              # Stop price calculation utilities (no sizing)
  tests/
    conftest.py
    test_backtests.py
    test_control.py
    test_strategies.py
    ... (mirror app module structure)

frontend/
  src/
    api/
      backtests.ts
      services.ts
      simulations.ts
      strategies.ts
      watchlists.ts
    components/
      Layout.tsx
      StrategyBuilder/
        ConditionBuilder.tsx
    pages/
      BacktestLauncher.tsx
      ChartLab.tsx
      LiveMonitor.tsx
      LogsPanel.tsx
      OptimizationLab.tsx
      RunDetails.tsx
      RunHistory.tsx
      Services.tsx
      SimulationLab.tsx
      Strategies.tsx
      StrategyCreator.tsx
      StrategyDetails.tsx
      TradingPrograms.tsx
      WatchlistLibrary.tsx
    types/
      index.ts              # canonical shared types — single source of truth
```

---

## Skills Available

Skills live in `.codex/skills/`. Each skill is a structured workflow.

| Skill | Trigger |
|-------|---------|
| `test-fix-loop` | Tests failing. Run first, every time. |
| `end-to-end-delivery` | Implementing a complete feature from spec. |
| `account-governor-review` | Any change touching order submission, conflict resolution, position tracking. |
| `program-composition-check` | Any change touching Strategy, Governor, Execution Style, Risk Profile, Program models. |
| `backtest-validation` | Any change touching the backtest engine or backtest results schema. |
| `frontend-ux-validation` | Any change to frontend pages, components, or types. |

Multi-agent orchestration rules are in `.codex/skills/orchestration.md`.

---

## Multi-Agent Roles

### Tester Agent
- Runs the full test suite.
- Captures all failures with full tracebacks.
- Reports failures to Fixer Agent. Never fixes failures itself.
- After Fixer completes, re-runs tests to verify.

### Fixer Agent
- Receives failure report from Tester Agent.
- Diagnoses root cause before touching any file.
- Makes the minimal change to fix the failure.
- Does not introduce new logic unrelated to the fix.
- Reports fix to Reviewer Agent.

### Reviewer Agent
- Reviews every fix before it is accepted.
- Checks for architecture violations (the 10 hard rules above).
- Checks that the fix does not break other tests.
- Approves or rejects. Rejections go back to Fixer Agent.

---

## Code Quality Standards

### Python
- All functions typed. Return type annotations required.
- `async def` for all route handlers and service methods.
- SQLAlchemy 2.0 `async with AsyncSession(...)` pattern.
- Pydantic v2 — use `model_validator`, not deprecated `validator`.
- No `print()` in production code. Use `logging.getLogger(__name__)`.
- Specific exception types only. No bare `except:`.

### TypeScript
- `"strict": true` enforced.
- No `any`. Use proper generics or `unknown` + type guards.
- Functional components only.
- All API calls in `src/api/` modules — never inline `fetch()`.
- Shared types in `src/types/index.ts`.

---

## Environment Variables

```bash
ALPACA_API_KEY_PAPER=...
ALPACA_API_SECRET_PAPER=...
ALPACA_API_KEY_LIVE=...
ALPACA_API_SECRET_LIVE=...
ALPACA_BASE_URL_PAPER=https://paper-api.alpaca.markets
ALPACA_BASE_URL_LIVE=https://api.alpaca.markets
DATABASE_URL=sqlite+aiosqlite:///./ultratrader.db
SECRET_KEY=...
ENVIRONMENT=development
```

Never commit `.env`. Never hardcode credentials in any file.

---

## Escalation Protocol

When an agent cannot resolve a conflict without potentially violating architecture:
1. STOP immediately.
2. Output the specific conflict and the options being considered.
3. Request human clarification.
4. Do not default to a guess that might violate a hard rule.

When tests drop below 317:
1. Run `test-fix-loop` skill immediately.
2. Do not merge or deploy until all tests pass.
3. Log root cause in `memory.md` of the relevant skill.
