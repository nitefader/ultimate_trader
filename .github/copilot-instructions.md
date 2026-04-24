# GitHub Copilot Instructions

## Project: Ultimate Trading Software 2026

This file configures GitHub Copilot's behavior for this repository.
Follow all instructions strictly. They exist to prevent architecture violations
that would break live trading, corrupt backtests, or violate Alpaca's API contracts.

---

## Architecture — Six-Component Model

Before suggesting or completing any code, classify the logic you are writing:

```
Program
├── Strategy          → signal logic ONLY (entries, logical exits, stop candidates)
├── Strategy Governor → timing (sessions, regime, PDT, cooldowns, gap risk)
├── Execution Style   → order mechanics (type, pullback, scale-out, fill retry)
├── Risk Profile      → sizing (risk%, position caps, daily loss limit, drawdown lock)
└── Watchlist         → symbol list ONLY

Account Governor      → cross-program authority (conflicts, kill switch, position tracking)
```

**If logic does not clearly belong to one component, do not add it. Ask first.**

---

## Forbidden Patterns — Never Suggest These

### In Strategy files (`backend/app/strategies/`, Strategy ORM model):
```python
# FORBIDDEN — sizing belongs in Risk Profile
"risk_pct": 0.01
"position_size": 100
"max_shares": 500

# FORBIDDEN — session rules belong in Strategy Governor
"session_start": "09:30"
"session_end": "16:00"

# FORBIDDEN — regime filter belongs in Strategy Governor
"regime_filter": "uptrend_only"
"vix_threshold": 25

# FORBIDDEN — order mechanics belong in Execution Style
"execution_policy": {...}
"order_type": "limit"
"limit_pullback": 0.02

# FORBIDDEN — cooldown belongs in Strategy Governor
"cooldown_bars": 3
"trade_cooldown_minutes": 30
```

### Direct broker calls (all files except `alpaca_service.py`):
```python
# FORBIDDEN — only alpaca_service.py may call Alpaca
import alpaca_trade_api
client.submit_order(...)
requests.post("https://api.alpaca.markets/v2/orders", ...)
alpaca.submit_order(...)
```

### Simulated brackets:
```python
# FORBIDDEN — use Alpaca native bracket, not two separate orders
# Placing a stop order separately after entry is NOT a bracket
alpaca.submit_order(symbol="AAPL", qty=100, side="buy", type="market")
alpaca.submit_order(symbol="AAPL", qty=100, side="sell", type="stop", stop_price=148)
```

### Correct bracket pattern:
```python
# CORRECT — native Alpaca bracket in alpaca_service.py only
order = {
    "symbol": symbol,
    "qty": qty,
    "side": "buy",
    "type": "market",
    "time_in_force": "gtc",
    "order_class": "bracket",
    "take_profit": {"limit_price": str(take_profit_price)},
    "stop_loss": {"stop_price": str(stop_loss_price)},
    "client_order_id": client_order_id,  # ALWAYS set this
}
```

---

## Required Patterns

### Every Alpaca order must have `client_order_id`:
```python
import uuid

client_order_id = f"prog_{program_id}_sym_{symbol}_{uuid.uuid4().hex[:8]}"
```

### Async SQLAlchemy (2.0 style):
```python
from sqlalchemy.ext.asyncio import AsyncSession

async def get_strategy(db: AsyncSession, strategy_id: int):
    result = await db.execute(select(Strategy).where(Strategy.id == strategy_id))
    return result.scalar_one_or_none()
```

### Pydantic v2 validators:
```python
from pydantic import BaseModel, model_validator

class StrategyCreate(BaseModel):
    name: str
    conditions: list[dict]

    @model_validator(mode="after")
    def validate_no_sizing_fields(self) -> "StrategyCreate":
        forbidden = {"risk_pct", "position_size", "execution_policy", "regime_filter"}
        for field in self.conditions:
            if any(k in forbidden for k in field):
                raise ValueError(f"Strategy conditions contain forbidden fields: {forbidden}")
        return self
```

### FastAPI async routes:
```python
@router.get("/strategies/{strategy_id}", response_model=StrategyResponse)
async def get_strategy(
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
) -> StrategyResponse:
    strategy = await strategy_service.get_by_id(db, strategy_id)
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return StrategyResponse.model_validate(strategy)
```

### TypeScript API client:
```typescript
// All API calls in src/api/ modules — never inline fetch() in components
export async function fetchStrategy(id: number): Promise<Strategy> {
  const res = await fetch(`/api/strategies/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch strategy ${id}: ${res.status}`);
  return res.json() as Promise<Strategy>;
}
```

### TypeScript strict — no `any`:
```typescript
// FORBIDDEN
const data: any = await fetchStrategy(id);

// CORRECT
const data: Strategy = await fetchStrategy(id);

// When type is unknown, use type guard
function isStrategy(obj: unknown): obj is Strategy {
  return typeof obj === "object" && obj !== null && "id" in obj && "name" in obj;
}
```

---

## Alpaca Constraints (Enforce on Every Suggestion)

1. **Conflict check before order:** Account Governor must verify no conflicting position
   exists in the same symbol before `alpaca_service.submit_order()` is called.
2. **Native brackets only:** See bracket pattern above.
3. **Paper vs live URLs from environment:** Never hardcode `api.alpaca.markets`.
4. **`client_order_id` on every order:** See pattern above.
5. **Rate limiting:** Add exponential backoff in `alpaca_service.py`. Never loop without delay.

---

## Test Requirements

- Test baseline: **317 tests must pass at all times.**
- Location: `backend/tests/`
- Command: `cd backend && python -m pytest tests/ -x -q --tb=short`
- Never suggest deleting tests.
- Never suggest skipping tests without a clear documented reason.
- For every new public function or endpoint, suggest a corresponding test.

---

## File-Specific Context

| File | Key Constraint |
|------|---------------|
| `backend/app/strategies/*.py` | Signal logic only. No sizing, no session, no order type. |
| `backend/app/services/alpaca_service.py` | Only file that calls Alpaca API. Requires client_order_id. |
| `backend/app/services/deployment_service.py` | Must go through Account Governor before any order. |
| `backend/app/core/backtest.py` | No live API calls. Uses historical data only. |
| `backend/app/models/trading_program.py` | Program composes 5 components by ID. No inlined logic. |
| `frontend/src/types/index.ts` | Canonical types. Reflect the 6-component architecture. |
| `frontend/src/api/*.ts` | All fetch calls here. No inline fetch in pages or components. |

---

## Quick Architecture Checklist for Every Suggestion

Before completing a code suggestion, mentally verify:

- [ ] Signal conditions → Strategy? (not Governor, not Risk, not ExecStyle)
- [ ] Sizing → Risk Profile? (not Strategy, not Program)
- [ ] Session/regime/PDT → Governor? (not Strategy)
- [ ] Order type/pullback → Execution Style? (not Strategy, not Program)
- [ ] Broker call → only via alpaca_service.py, after Account Governor approval?
- [ ] Bracket order → native Alpaca format with take_profit + stop_loss legs?
- [ ] client_order_id set on every order?
- [ ] Async/await correct for all DB and broker calls?
- [ ] No `any` types in TypeScript?
- [ ] New public function has a test?

If any box cannot be checked, do not complete the suggestion. Flag it instead.
