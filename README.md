# UltraTrader 2026

Production-grade algorithmic trading platform with full backtest → paper → live promotion workflow.

## Architecture

```
backend/                 Python 3.11 + FastAPI + SQLAlchemy + asyncio
  app/
    api/routes/          REST endpoints (strategies, backtests, accounts, deployments, control, data, events)
    core/                Trading engines (backtest, portfolio, risk, kill_switch)
    strategies/          Strategy engine (conditions, stops, targets, sizing, cooldown)
    indicators/          Technical indicators, FVG, market structure, S/R, regime
    data/providers/      Data providers (yfinance, parquet cache)
    models/              SQLAlchemy ORM (SQLite local / PostgreSQL cloud)
    services/            Business logic (backtest service, deployment service, reporting)

frontend/                React 18 + TypeScript + Vite + Tailwind + Recharts
  src/
    pages/               Dashboard, StrategyCreator, BacktestLauncher, RunDetails, etc.
    components/          Layout, ModeIndicator, KillSwitch, ConditionBuilder, Charts
    api/                 API client (axios + react-query)
    stores/              Zustand state (kill switch)
    types/               Full TypeScript types

scripts/                 Setup, seeding
docker-compose.yml       Full containerized deployment
```

## Quick Start (Local)

### Option 1: Manual

```bash
# Backend
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example ../.env
uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
# Manual backend identity preflight (BL-004)
node ./scripts/verify-backend.mjs
npm run dev
```

If your backend is on a non-default host/port, set `ULTRATRADER_BACKEND_URL` before running the check.

```bash
ULTRATRADER_BACKEND_URL=http://localhost:8080 node ./scripts/verify-backend.mjs
```

Open **http://localhost:5173**

### Option 2: Docker

```bash
cp .env.example .env
docker-compose up --build
```

Open **http://localhost**

---

## Seeding Sample Strategies

```bash
cd backend
source .venv/bin/activate
python ../scripts/seed_strategies.py
```

This loads the Momentum and Mean Reversion YAML strategies into the database.

---

## Running Tests

```bash
cd backend
source .venv/bin/activate
pytest tests/ -v
```

---

## Workflow

### 1. Create a Strategy
- Go to **Strategies → New Strategy**
- Define entry conditions with N-of-M logic (e.g., "4 of 5 conditions must be true")
- Configure stop loss (ATR, swing low, FVG, S/R, combined)
- Set profit targets (R-multiple, S/R, ATR)
- Configure position sizing (% risk, fixed, Kelly)
- Add cooldown rules, regime filter, event blackouts

### 2. Backtest
- Go to **Backtest**
- Select strategy version, symbols, timeframe, date range
- Click **Launch Backtest** (data auto-downloaded and cached)
- View results: equity curve, drawdown, monthly heatmap, trade journal, Monte Carlo

### 3. Promote to Paper
- In Run Details → **Promote** tab
- Select a paper account
- Confirm promotion → creates a Deployment record

### 4. Promote to Live
- Go to **Deploy**
- Click "Promote to Live"
- Complete the **5-item safety checklist** (all required)
- System creates live deployment

### 5. Kill Switch
- Header always shows current mode: **BACKTEST** / **PAPER** / **LIVE**
- **KILL ALL** button stops all trading immediately
- Per-account and per-strategy kill controls in Account Monitor

---

## Execution Assumptions (Backtest)

| Assumption | Implementation |
|---|---|
| Signal timing | Bar close |
| Fill timing | Next bar open |
| Slippage | N ticks added/subtracted at fill |
| Commission | $per_share applied to each fill |
| Stop/target hits | Checked against intrabar high/low |
| Gap through stop | Filled at open price |
| Stop vs target | If both hit same bar, stop wins (conservative) |
| No lookahead | All indicators use only past data (`shift(1)` where needed) |

---

## Strategy Config Reference

Strategy definitions are JSON/YAML. Key fields:

```yaml
symbols: [SPY, QQQ]
timeframe: 1d

entry:
  directions: [long, short]
  logic: "n_of_m:4"      # all_of | any_of | n_of_m:N
  conditions: [...]

stop_loss:
  method: combined        # fixed_pct | fixed_dollar | atr_multiple | swing_low | fvg_low | sr_support | chandelier | combined
  rule: farthest
  stops: [...]

targets:
  - method: r_multiple    # r_multiple | fixed_pct | atr_multiple | sr_resistance | swing_high
    r: 1.0
  - method: r_multiple
    r: 3.0

trailing_stop:
  method: chandelier
  period: 22
  mult: 3.0

scale_in:
  max_adds: 2
  levels: [{level: 0, pct: 60}, {level: 1, pct: 25}, {level: 2, pct: 15}]

scale_out:
  move_stop_to_be_after_t1: true
  levels: [{pct: 50}, {pct: 50}]

position_sizing:
  method: risk_pct        # fixed_shares | fixed_dollar | fixed_pct_equity | risk_pct | atr_risk | kelly
  risk_pct: 1.0

regime_filter:
  allowed: [trending_up]  # trending_up | trending_down | ranging | high_volatility | low_volatility

cooldown_rules:
  - trigger: stop_out
    duration_minutes: 60
  - trigger: consecutive_loss
    consecutive_count: 2
    session_reset: true

event_filter:
  categories: [fomc, cpi, nfp]
  impact_levels: [high]
  minutes_before: 30
  minutes_after: 30
  disable_entries: true

risk:
  max_position_size_pct: 0.10
  max_daily_loss_pct: 0.03
  max_drawdown_lockout_pct: 0.10
  max_open_positions: 10
  max_portfolio_heat: 0.06
```

---

## Condition Builder

Conditions support rich logical composition:

```json
{ "type": "all_of", "conditions": [...] }
{ "type": "any_of", "conditions": [...] }
{ "type": "n_of_m", "n": 4, "conditions": [...] }
{ "type": "not", "condition": {...} }
{ "type": "regime_filter", "allowed": ["trending_up"] }

{ "type": "single",
  "left": {"field": "close"},
  "op": ">",
  "right": {"indicator": "ema_21"}
}
```

Supported operators: `>`, `>=`, `<`, `<=`, `==`, `!=`, `crosses_above`, `crosses_below`, `between`, `in`

Value sources: `field`, `indicator`, `prev_bar`, `n_bars_back`, `account`, `nearest_sr_support`, `nearest_sr_resistance`, `nearest_fvg_low`, `nearest_fvg_high`

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/v1/strategies | List strategies |
| POST | /api/v1/strategies | Create strategy |
| POST | /api/v1/strategies/validate | Validate config |
| POST | /api/v1/backtests/launch | Launch backtest |
| GET | /api/v1/backtests/{id} | Get run + metrics |
| GET | /api/v1/backtests/{id}/equity-curve | Equity curve data |
| GET | /api/v1/backtests/{id}/trades | Trade journal |
| POST | /api/v1/deployments/promote-to-paper | Promote to paper |
| POST | /api/v1/deployments/promote-to-live | Promote to live |
| POST | /api/v1/control/kill-all | **GLOBAL KILL SWITCH** |
| POST | /api/v1/control/resume-all | Resume all trading |
| POST | /api/v1/data/fetch | Download & cache data |
| GET | /api/v1/data/inventory | List cached data |
| GET | /api/v1/events | Event calendar |

Full OpenAPI docs: **http://localhost:8000/docs**

---

## Cloud Deployment

For AWS/GCP/Azure:

1. Set `DATABASE_URL` to a PostgreSQL connection string
2. Push backend to ECR/GCR, frontend to S3+CloudFront or a container
3. Use RDS PostgreSQL (`postgresql+asyncpg://...`)
4. Mount persistent volumes for data cache
5. Set `SECRET_KEY` to a secure random value

```bash
# Switch to PostgreSQL
DATABASE_URL=postgresql+asyncpg://user:pass@rds-endpoint:5432/ultratrader
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, uvicorn |
| ORM | SQLAlchemy 2.0 (async) |
| Database | SQLite (local) / PostgreSQL (cloud) |
| Data | pandas, numpy, yfinance, pyarrow (parquet) |
| Indicators | ta, custom implementations |
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS |
| Charts | Recharts |
| State | Zustand, React Query |
| Containers | Docker, docker-compose |
| Testing | pytest, pytest-asyncio |
| Logging | structlog (JSON) |
