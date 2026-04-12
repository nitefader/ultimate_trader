Setup instructions

# 1. Backend
cd backend
python -m venv .venv
.venv\Scripts\activate           # Windows
# source .venv/bin/activate      # Mac/Linux
pip install -r requirements.txt

# 2. Start backend
uvicorn app.main:app --reload --port 8000

# 3. Seed sample strategies (new terminal, same venv)
python ../scripts/seed_strategies.py

# 4. Frontend (new terminal)
cd frontend
npm install
npm run dev
Open http://localhost:5173 — full platform UI.

Or with Docker: cp .env.example .env && docker-compose up --build

Run tests

cd backend && pytest tests/ -v

# Iteration 3 (QA Automation)
- `scripts/qa.ps1`: repo-level QA runner (backend tests + frontend build)
- `.github/workflows/ci.yml`: CI runs backend tests + frontend build on push/PR

What's in the vertical slice (all runnable now)
Layer	What's real
Backtest engine	Full bar-by-bar replay, intrabar stop/target, gap handling, scale-in/out, trailing stops
Condition engine	all_of, any_of, N-of-M (2-of-3, 4-of-5, 6-of-7), not, crosses_above/below, regime filter
Stop/target calc	12 methods: fixed%, ATR, swing low, FVG low/mid, S/R, chandelier, combined(farthest/nearest)
Indicators	SMA, EMA, ATR, RSI, MACD, Bollinger, ADX, Stochastic, Pivots, OBV, FVG detection, S/R engine, regime classifier
Market structure	Swing high/low detection, BOS, HH/HL/LH/LL state, trend bias
Position sizing	Fixed shares, fixed $, % equity, % risk, ATR risk, Kelly
Cooldown	Time-based, bar-based, session-reset, consecutive-loss trigger
Risk engine	Position size cap, daily loss lockout, drawdown lockout, heat cap, symbol allow/block
Kill switch	Global, per-account, per-strategy — with event log
Promotion workflow	Backtest → Paper → Live with safety checklist enforcement
Reporting	Total return, CAGR, Sharpe, Sortino, Calmar, max DD, win rate, expectancy, PF, monthly heatmap, exit reason breakdown, regime breakdown, Monte Carlo (500 paths)
Data layer	yfinance download + parquet cache, incremental updates, inventory API
API	40+ endpoints across 7 routers
UI	11 pages: Dashboard, Strategy Creator with N-of-M builder, Backtest Launcher, Run Details (6 tabs), Run History, Account Monitor, Deploy Manager, Data Manager, Event Calendar, Logs
Tests	50+ unit tests across portfolio math, conditions, risk, cooldown, kill switch, stops/targets
Sample strategies	momentum.yaml (4-of-5 entry, swing stop, chandelier trail, scale-out) and mean_reversion.yaml (FVG stop, S/R target, event blackout)
Docker	Dockerfile (backend + frontend), docker-compose.yml, nginx reverse proxy

