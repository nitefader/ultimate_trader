# CLAUDE.md — Claude Code Agent Reference

This file is the authoritative reference for Claude Code operating in this repository.
Read it fully before touching any file. Violating the architecture rules here will cause
rejected PRs and broken backtests.

---

## Project Overview

**Ultimate Trading Software 2026** is an Alpaca-first algorithmic trading platform.
It supports strategy authoring, backtesting, simulation, live deployment, and multi-program
account governance. The backend is FastAPI + SQLAlchemy 2.0 + aiosqlite. The frontend is
React + TypeScript + Vite + Tailwind CSS.

---

## Repository Layout

```
backend/
  app/
    api/routes/          # FastAPI route handlers (one file per domain)
    core/                # backtest engine, event loop, scheduling
    models/              # SQLAlchemy ORM models
    services/            # business logic, broker adapters, governors
    strategies/          # signal logic ONLY — no sizing, no session rules
  tests/                 # pytest test suite (317 baseline tests)

frontend/
  src/
    api/                 # typed API client modules
    components/          # reusable React components
    pages/               # route-level page components
    types/               # shared TypeScript types (index.ts is canonical)

.claude/
  skills/                # Claude Code skill definitions
    test-fix-loop/
    end-to-end-delivery/
    account-governor-review/
    program-composition-check/
    backtest-validation/
    frontend-ux-validation/
    orchestration.md

.codex/
  skills/                # Identical copies of .claude/skills/ for Codex agents

.github/
  copilot-instructions.md
```

---

## Architecture — The Six Components (ENFORCE STRICTLY)

Every piece of logic must live in exactly one component. Misplacement is an
architecture violation and must be caught by `account-governor-review` and
`program-composition-check` skills before merge.

### 1. Strategy
Signal logic only.
- Defines entry conditions (indicator crossovers, breakouts, mean-reversion triggers).
- May suggest stop candidates (ATR-based stop price calculation) as informational output.
- May define logical exits (opposite signal, time-based exit condition).
- **MUST NOT** contain: position sizing, session windows, regime filters, order type
  selection, cooldown timers, PDT checks, or gap risk logic.
- **MUST NOT** contain: any field named `execution_policy`, `risk_pct`, `max_drawdown`,
  `session_start`, `session_end`, `regime`, `cooldown`.

### 2. Strategy Governor
Timing and regime control.
- Owns: timeframe selection, session windows, regime filters, cooldown periods,
  PDT rule enforcement, gap risk filters.
- Wraps strategy signal output with a gate: "is now a valid time/regime to act?"
- **MUST NOT** contain: sizing logic, order mechanics.

### 3. Execution Style
Order mechanics.
- Owns: order type (market/limit/bracket/OCO/trailing), limit pullback distance,
  scale-out rules, fill retry logic.
- For bracket orders: must use Alpaca's native bracket format
  (`take_profit` + `stop_loss` legs in a single order object).
- **MUST NOT** contain: sizing, session rules, signal logic.

### 4. Risk Profile
Sizing and account-level limits.
- Owns: risk % per trade, max position size (shares/dollars), daily loss limit,
  max drawdown lockout threshold, max concurrent positions.
- **MUST NOT** contain: signal logic, order mechanics, session rules.

### 5. Watchlist
Symbol universe only.
- A list of symbols. May include metadata (sector, liquidity tier) for filtering.
- **MUST NOT** contain: any logic, sizing, or timing rules.

### 6. Program
Composition of all five components above.
- Binds one Strategy + one Strategy Governor + one Execution Style + one Risk Profile
  + one Watchlist into a deployable unit.
- What gets backtested, simulated, and deployed.
- **MUST NOT** inline logic that belongs to any component — always reference by ID.

### Account Governor (Cross-Program Authority)
- Final authority over ALL programs running on a single Alpaca account.
- Responsibilities:
  - Conflict resolution: two programs want opposing positions in the same symbol.
  - Kill switch: emergency halt of all programs.
  - Position tracking: tracks every open position by Alpaca `client_order_id`.
  - Symbol arbitration: enforces that only one program holds a position in a symbol
    at a time (Alpaca's long/short restriction).
  - Daily loss limit enforcement across all programs combined.
- **No program may send a broker API call without Account Governor approval.**
- Account Governor is the only component that calls `alpaca_service.submit_order()`.

---

## Alpaca Constraints (Non-Negotiable)

1. Alpaca does NOT support conflicting long and short positions in the same symbol
   on the same account. Account Governor must reject any order that would create a conflict.
2. Bracket orders must use Alpaca's native bracket: one order with `take_profit` and
   `stop_loss` legs. Do not simulate brackets with separate orders.
3. All order submission must go through `backend/app/services/alpaca_service.py`.
4. `client_order_id` must be set on every order for tracking purposes.
5. Paper trading and live trading use different Alpaca base URLs. Never hardcode.
6. Rate limits: respect Alpaca's order rate limits; use exponential backoff in the service.

---

## Commands

### Backend

```bash
# Run all backend tests (never drop below 317 passing)
cd backend && python -m pytest tests/ -x -q --tb=short

# Run a single test file
cd backend && python -m pytest tests/test_backtests.py -x -q --tb=short

# Run with verbose output for debugging
cd backend && python -m pytest tests/ -v --tb=long

# Start backend dev server
cd backend && uvicorn app.main:app --reload --port 8000

# Check for import errors
cd backend && python -c "from app.main import app; print('OK')"
```

### Frontend

```bash
# TypeScript type check (must pass with 0 errors)
cd frontend && npx tsc --noEmit

# Production build (must succeed)
cd frontend && npx vite build

# Start frontend dev server
cd frontend && npx vite --port 5173

# Run frontend linting
cd frontend && npx eslint src/ --ext .ts,.tsx
```

### Full Validation

```bash
# Backend tests + frontend type check (run both before any PR)
cd backend && python -m pytest tests/ -x -q --tb=short && cd ../frontend && npx tsc --noEmit
```

---

## Test Baseline

- **317 tests must pass at all times.**
- Never delete tests to make CI pass.
- Never skip tests with `pytest.mark.skip` without a documented reason in the PR.
- Never weaken assertions (change `==` to `in`, tighten expected values, etc.).
- When adding new features, add tests. Test count should only go up.
- Test files live in `backend/tests/`. Mirror the module structure.

---

## Skills Reference

Skills are invocable workflows defined in `.claude/skills/`. Use them by name.

| Skill | When to Use |
|-------|-------------|
| `test-fix-loop` | Any time tests are failing. Run before opening a PR. |
| `end-to-end-delivery` | Delivering a complete feature from spec to passing tests. |
| `account-governor-review` | Before merging any code that touches order submission, position tracking, or conflict resolution. |
| `program-composition-check` | Before merging any code that touches Strategy, Governor, Execution Style, Risk Profile, or Program models. |
| `backtest-validation` | Before merging any code that touches the backtest engine or backtest results. |
| `frontend-ux-validation` | Before merging any frontend changes. |

---

## Code Style

### Python (Backend)
- Python 3.11+. Use `async def` for all route handlers and service methods.
- SQLAlchemy 2.0 style: `async with AsyncSession` context managers.
- Pydantic v2 for request/response models. Use `model_validator` not `validator`.
- Type annotations on every function signature.
- No bare `except:`. Always catch specific exceptions and log them.
- Use `structlog` or `logging.getLogger(__name__)` — never `print()` in production code.
- Constants in `app/core/constants.py`. Never hardcode magic numbers inline.

### TypeScript (Frontend)
- Strict mode TypeScript. `"strict": true` in tsconfig.
- No `any` types. Use proper generics or `unknown` with type guards.
- React functional components only. No class components.
- `useCallback` and `useMemo` for referential stability in effects.
- API calls in `src/api/` modules only — never `fetch()` inline in components.
- Types in `src/types/index.ts` — single source of truth for shared types.

### Git
- Branch from `main`. Name branches `feature/<slug>`, `fix/<slug>`, `refactor/<slug>`.
- Commit messages: imperative mood, present tense. "Add account governor conflict check."
- One logical change per commit.
- Never force-push to `main`.

---

## Common Mistakes to Avoid

1. **Putting sizing in Strategy** — Risk Profile owns all sizing. Strategy returns signals only.
2. **Putting session windows in Strategy** — Strategy Governor owns session rules.
3. **Direct broker calls in strategies or programs** — only `alpaca_service.py` calls Alpaca,
   and only after Account Governor approval.
4. **Using `execution_policy` on Strategy** — this is an Execution Style concern.
5. **Simulated brackets** — always use Alpaca native bracket orders.
6. **Hardcoded API keys** — keys come from environment variables only.
7. **Sync SQLAlchemy calls in async routes** — always `await` database calls.
8. **`select *` style ORM queries** — always specify columns or use explicit models.
9. **Missing `client_order_id`** — every Alpaca order must have one for tracking.
10. **Test count regression** — if tests drop below 317, stop and diagnose immediately.

---

## Environment Variables

```
# Backend (set in .env or environment)
ALPACA_API_KEY_PAPER=...
ALPACA_API_SECRET_PAPER=...
ALPACA_API_KEY_LIVE=...
ALPACA_API_SECRET_LIVE=...
ALPACA_BASE_URL_PAPER=https://paper-api.alpaca.markets
ALPACA_BASE_URL_LIVE=https://api.alpaca.markets
DATABASE_URL=sqlite+aiosqlite:///./ultratrader.db
SECRET_KEY=...
ENVIRONMENT=development|production
```

Never commit `.env` files. Never hardcode credentials.

---

## Escalation

If you encounter an ambiguity that could result in an architecture violation:
1. Stop. Do not guess.
2. Surface the ambiguity as a question with specific options.
3. Wait for resolution before writing code.

If tests drop below 317:
1. Run `test-fix-loop` skill immediately.
2. Do not open a PR until all tests pass.
3. Document the root cause in the skill's `memory.md`.
