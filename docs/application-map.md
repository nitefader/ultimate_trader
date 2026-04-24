# UltraTrader 2026 — Use Case Reference

**Version**: 1.0 | **Date**: April 2026  
**Timestamp (ET):** 2026-04-22 11:02:07 AM ET  
**Stack**: React 18 + FastAPI + SQLAlchemy + Alpaca Markets API + yahooquery

---

## 1. Application Overview

UltraTrader 2026 is a full-stack algorithmic trading platform supporting the complete lifecycle:

**Backtest → Paper → Live**

All strategy logic is defined declaratively in JSON/YAML configs stored in the database, then executed by a no-lookahead backtest engine (signals fire at bar close; fills execute at next bar open + slippage + commission).

---

## 2. User Workflow Map

```
[Create Strategy] → [Define Config] → [Backtest] → [Review Results]
                                                          ↓
                                         [Promote to Paper Trading]
                                                          ↓
                                         [Monitor Paper Deployment]
                                                          ↓
                                         [Promote to Live Trading]
                                                          ↓
                                         [Monitor Live Deployment]
                                                          ↓
                                         [Kill Switch / Stop / Pause]
```

---

## 3. Use Cases by Module

---

### UC-01: Dashboard (`/`)

**Purpose**: Single-pane-of-glass overview of the entire platform state.

| Use Case | Description |
|----------|-------------|
| UC-01.1 | View total equity across all paper + live accounts |
| UC-01.2 | See count of active deployments (paper + live) |
| UC-01.3 | Check global kill switch status (armed/safe) |
| UC-01.4 | View recent backtest runs with return/status |
| UC-01.5 | See account equity distribution (pie chart) |
| UC-01.6 | Navigate to any module via quick-access stat cards |
| UC-01.7 | Monitor platform connectivity (backend online status) |
| UC-01.8 | View active deployment strategy mode indicators |

**Actors**: Trader, Risk Manager  
**Frequency**: High (default landing page, auto-refreshes every 20s)

---

### UC-02: Strategy Management (`/strategies`, `/strategies/new`, `/strategies/:id`)

**Purpose**: Create, version, and manage trading strategy configurations.

| Use Case | Description |
|----------|-------------|
| UC-02.1 | View all strategies with category, status, version count |
| UC-02.2 | Create a new strategy with name, description, category, tags |
| UC-02.3 | Define entry conditions (EMA crossovers, RSI levels, price comparisons, etc.) |
| UC-02.4 | Configure stop-loss (fixed %, ATR, previous swing, bracket) |
| UC-02.5 | Set profit targets (fixed %, ATR multiple, R-multiple) |
| UC-02.6 | Choose position sizing method (risk_pct, fixed_shares, fixed_dollar, kelly, ATR-risk) |
| UC-02.7 | Apply regime filter (only trade in trending_up, trending_down, ranging, etc.) |
| UC-02.8 | Configure scale-in / scale-out levels |
| UC-02.9 | Set trailing stop (chandelier, ATR, fixed) |
| UC-02.10 | Add cooldown rules (pause after loss streak, after event, etc.) |
| UC-02.11 | Configure event filters (pause before FOMC, CPI, NFP announcements) |
| UC-02.12 | Define risk limits (max position size %, max drawdown lockout %, max open positions) |
| UC-02.13 | Set leverage and indicator parameters (EMA/SMA/RSI periods) |
| UC-02.14 | View strategy version history |
| UC-02.15 | Promote a strategy version (draft → paper → live) |

**Actors**: Quant, Strategy Developer  
**Frequency**: Medium (strategy creation/editing)

**Entry Condition Logic Supported**:
- `single`: Compare indicator/price vs value or another indicator  
- `all_of`: Logical AND of sub-conditions  
- `any_of`: Logical OR of sub-conditions  
- `n_of_m`: At least N of M conditions must be true  
- `regime_filter`: Market regime must be in allowed set  
- `not`: Negate a sub-condition  

---

### UC-03: Backtesting (`/backtest`, `/runs`, `/runs/:runId`)

**Purpose**: Test a strategy version against historical data with detailed performance analytics.

| Use Case | Description |
|----------|-------------|
| UC-03.1 | Select a strategy and version to backtest |
| UC-03.2 | Choose data provider (Yahoo Finance free, or Alpaca with credentials) |
| UC-03.3 | Configure symbols (single or multi-asset, e.g. SPY, QQQ, AAPL) |
| UC-03.4 | Select timeframe (1m, 5m, 15m, 30m, 1h, 1d, 1wk) |
| UC-03.5 | Set date range (start/end dates; default: 3 years history) |
| UC-03.6 | Set initial capital, commission per share, slippage ticks |
| UC-03.7 | Launch backtest (returns immediately; runs in background) |
| UC-03.8 | View run history table (sorted by date; shows return, Sharpe, drawdown, win rate, trades) |
| UC-03.9 | Filter runs by status (pending/running/completed/failed) |
| UC-03.10 | Click a run to see detailed results |
| UC-03.11 | View performance metrics: total return, CAGR, Sharpe, Sortino, Calmar, max drawdown, recovery factor |
| UC-03.12 | View equity curve chart over time |
| UC-03.13 | View drawdown chart |
| UC-03.14 | Inspect trade-by-trade log (entry/exit, P&L, R-multiple, regime at entry, exit reason) |
| UC-03.15 | View monthly returns heatmap |
| UC-03.16 | Review Monte Carlo simulation (median, p5, p95 return and drawdown, probability of profit) |
| UC-03.17 | Promote successful backtest result to paper trading |
| UC-03.18 | See intraday data limits warning (1m=7d, 5–30m=60d, 1h=2yr) |

**Actors**: Quant, Trader  
**Frequency**: High (iterative strategy testing)

**Key Metrics Computed**:
- Return %, CAGR, Sharpe Ratio, Sortino, Calmar, Max Drawdown %, Recovery Factor  
- Win Rate, Average Win/Loss %, Expectancy, Profit Factor  
- Avg Hold Days, Long/Short trade split, Exit reason breakdown  
- Regime-specific performance, Monthly returns grid  
- Monte Carlo simulation (500 resampled equity curves)

---

### UC-04: Account Management (`/accounts`)

**Purpose**: Create and manage paper/live trading accounts with risk controls.

| Use Case | Description |
|----------|-------------|
| UC-04.1 | Create a new paper or live trading account with initial balance |
| UC-04.2 | View all accounts with equity, P&L, mode indicator |
| UC-04.3 | Edit account risk parameters (leverage, max position size, max daily loss, max positions) |
| UC-04.4 | Kill an account (halts all trading for that account immediately) |
| UC-04.5 | Resume a killed account |
| UC-04.6 | View running deployments tab-per-deployment with live position monitoring |
| UC-04.7 | Stop an active deployment from the account monitor |

**Actors**: Risk Manager, Trader  
**Frequency**: Low-Medium (account setup + occasional risk limit adjustments)

---

### UC-05: Credential Management (`/security`)

**Purpose**: Securely store and manage Alpaca API keys for paper and live trading.

| Use Case | Description |
|----------|-------------|
| UC-05.1 | Select an account to configure credentials |
| UC-05.2 | Enter/update Alpaca paper trading API key + secret |
| UC-05.3 | Enter/update Alpaca live trading API key + secret |
| UC-05.4 | Toggle between paper and live key sets |
| UC-05.5 | Show/hide key values (password masking with toggle) |
| UC-05.6 | Test broker connection (validates credentials against Alpaca, returns account equity) |
| UC-05.7 | Save keys (AES-256 encrypted at rest) |
| UC-05.8 | Set custom base URL (for institutional/sandbox endpoints) |

**Actors**: Trader, Admin  
**Frequency**: Low (one-time setup + key rotation)

---

### UC-06: Deployment Manager (`/deployments`)

**Purpose**: Manage the lifecycle of strategy deployments from paper to live, with safety checklists.

| Use Case | Description |
|----------|-------------|
| UC-06.1 | View all active and historical deployments |
| UC-06.2 | See deployment mode (paper/live), status, creation date |
| UC-06.3 | Pause a running deployment |
| UC-06.4 | Stop a running or paused deployment (with reason) |
| UC-06.5 | Promote a paper deployment to live trading |
| UC-06.6 | Complete live promotion safety checklist (5 required confirmations) |
| UC-06.7 | Select source paper deployment and target live account for promotion |
| UC-06.8 | Add promotion notes for audit trail |

**Safety Checklist for Live Promotion**:
1. Paper performance reviewed (min 30 days)  
2. Risk limits confirmed  
3. Live account verified and funded  
4. Broker connection tested  
5. Compliance acknowledged (real orders will execute)

**Actors**: Trader, Risk Manager, Compliance  
**Frequency**: Low (major workflow transition events)

---

### UC-07: Live Monitor (`/monitor`)

**Purpose**: Real-time monitoring of all active paper and live runs, with position management.

| Use Case | Description |
|----------|-------------|
| UC-07.1 | View all active paper and live runs as cards (equity, unrealized P&L, status) |
| UC-07.2 | Click a run card to open it in a detail tab |
| UC-07.3 | View multiple runs simultaneously via tabbed interface |
| UC-07.4 | See live account stats: equity, cash, portfolio value, open P&L, market exposure |
| UC-07.5 | View all open positions (symbol, side, qty, avg entry, current price, market value, unrealized P&L, today's change) |
| UC-07.6 | Close an individual position manually |
| UC-07.7 | Close ALL positions for a run in one action (with confirmation) |
| UC-07.8 | View all open orders (symbol, side, type, qty, fill status, limit price) |
| UC-07.9 | Close a detail tab when done |
| UC-07.10 | Refresh runs manually |

**Actors**: Trader  
**Frequency**: High during market hours (auto-refresh every 8–15s)

---

### UC-08: Data Manager (`/data`)

**Purpose**: Download, manage, and cache historical OHLCV price data.

| Use Case | Description |
|----------|-------------|
| UC-08.1 | Choose data provider: Yahoo Finance (free) or Alpaca (requires credentials) |
| UC-08.2 | Enter one or multiple ticker symbols |
| UC-08.3 | Select timeframe and date range |
| UC-08.4 | Preview data limits before download (yFinance intraday caps) |
| UC-08.5 | Review download configuration before executing |
| UC-08.6 | Download and cache data as Parquet files |
| UC-08.7 | View cached data inventory (symbol, timeframe, date range, rows, file size) |
| UC-08.8 | Delete cached data for a specific symbol/timeframe |
| UC-08.9 | Re-download data to refresh cache |
| UC-08.10 | Search cached data by symbol |

**Actors**: Quant, Trader  
**Frequency**: Medium (before new backtests on new symbols)

---

### UC-09: Event Calendar (`/events`)

**Purpose**: Track market events (FOMC, CPI, NFP, earnings) that strategies can filter around.

| Use Case | Description |
|----------|-------------|
| UC-09.1 | View upcoming and past market events |
| UC-09.2 | See event name, category, symbol, date/time, impact level, source |
| UC-09.3 | Filter events by impact level (high/medium/low) |
| UC-09.4 | Seed sample events (FOMC, CPI, NFP) for testing |
| UC-09.5 | Per-strategy event filters configured in Strategy Creator |

**Event Impact Levels**: High (red), Medium (amber), Low (gray)  
**Actors**: Quant, Trader  
**Frequency**: Low (reference before market hours)

---

### UC-10: Logs & Alerts (`/logs`)

**Purpose**: Audit trail of risk control events (kill switches, pauses, resumes).

| Use Case | Description |
|----------|-------------|
| UC-10.1 | View chronological log of all kill switch events |
| UC-10.2 | See event action (kill/pause/resume), scope (global/account/strategy), reason |
| UC-10.3 | Identify who triggered each event (triggered_by field) |
| UC-10.4 | See timestamp and scope ID for each event |

**Actors**: Risk Manager, Compliance, Trader  
**Frequency**: Low (after incidents, for audit)

---

### UC-11: Kill Switch (Global Header)

**Purpose**: Emergency stop control accessible from every page in the application.

| Use Case | Description |
|----------|-------------|
| UC-11.1 | Arm global kill switch (halts ALL trading across ALL accounts and deployments) |
| UC-11.2 | Disarm global kill switch (resume trading platform-wide) |
| UC-11.3 | Kill switch status is visible in header at all times |
| UC-11.4 | Kill events are logged automatically to Logs & Alerts |

**Actors**: Any user (emergency access)  
**Frequency**: Low (emergency use only)

---

## 4. End-to-End User Journeys

### Journey A: First-Time Setup
1. Create an account (UC-04.1) — set to "paper" mode
2. Enter Alpaca paper API credentials (UC-05.1 → 05.7)
3. Test connection (UC-05.6)
4. Download historical data (UC-08.1 → 08.6)

### Journey B: Strategy Development Cycle
1. Create strategy (UC-02.2) → configure all sections
2. Launch backtest (UC-03.1 → 03.7) → wait for completion
3. Review results (UC-03.11 → 03.16) — check Sharpe, drawdown, Monte Carlo
4. Tweak strategy config → re-backtest (iterate)
5. When satisfied: Promote to paper trading (UC-03.17)

### Journey C: Paper → Live Promotion
1. Monitor paper deployment for 30+ days (UC-07.1 → 07.5)
2. Navigate to Deployment Manager (UC-06.1)
3. Complete safety checklist (UC-06.6)
4. Promote to live (UC-06.5)
5. Monitor live positions (UC-07.5 → 07.9)

### Journey D: Emergency Risk Management
1. Notice abnormal drawdown in Live Monitor or Dashboard
2. Activate kill switch from header (UC-11.1) — immediate platform halt
3. Review logs (UC-10.1) for audit trail
4. Close specific positions manually in Live Monitor (UC-07.6)
5. Disarm kill switch after situation resolved (UC-11.2)

---

## 5. Identified Gaps & Fixes Applied (April 2026)

| ID | Gap | Severity | Status |
|----|-----|----------|--------|
| GAP-01 | AccountMonitor positions table: "Current" and "Market Value" columns showed wrong data (both displayed `unrealized_pl` instead of `current_price` and `market_value`) | High | **Fixed** |
| GAP-02 | AccountMonitor DeploymentMonitor had hardcoded mock metrics ($100k equity, 68% win rate, 24 trades) instead of real account data | High | **Fixed** |
| GAP-03 | AccountMonitor "Start Deployment" button had no navigation action | Medium | **Fixed** |
| GAP-04 | DeploymentManager showed raw truncated UUIDs instead of strategy name and account name | Medium | **Fixed** |
| GAP-05 | EventCalendar had no filtering — all events shown unfiltered | Medium | **Fixed** |
| GAP-06 | LogsPanel title was "Logs & Alerts" but content was limited to kill switch events only | Low | **Improved** |

---

## 6. API Route Summary

| Route | Method | Description |
|-------|--------|-------------|
| `/strategies` | GET | List all strategies |
| `/strategies` | POST | Create strategy |
| `/strategies/:id` | GET | Get strategy with versions |
| `/strategies/:id/versions` | POST | Add strategy version |
| `/backtests/launch` | POST | Launch backtest (async) |
| `/backtests` | GET | List backtest runs |
| `/backtests/:id` | GET | Get run details |
| `/backtests/:id/equity-curve` | GET | Equity curve data |
| `/backtests/:id/trades` | GET | Trade list |
| `/backtests/:id/compare` | POST | Compare two runs |
| `/accounts` | GET/POST | List/create accounts |
| `/accounts/:id` | PUT | Update account |
| `/accounts/:id/kill` | POST | Kill account |
| `/accounts/:id/resume` | POST | Resume account |
| `/accounts/:id/credentials` | GET/PUT | Get/set API keys |
| `/accounts/:id/validate-credentials` | POST | Test Alpaca connection |
| `/deployments` | GET/POST | List/create deployments |
| `/deployments/:id/pause` | POST | Pause deployment |
| `/deployments/:id/stop` | POST | Stop deployment |
| `/deployments/promote-to-live` | POST | Paper → Live promotion |
| `/monitor/runs` | GET | Active run summaries |
| `/monitor/runs/:id` | GET | Run detail (orders, account) |
| `/monitor/runs/:id/positions` | GET | Open positions |
| `/monitor/runs/:id/close-position` | POST | Close one position |
| `/monitor/runs/:id/close-all` | POST | Close all positions |
| `/data/fetch` | POST | Download OHLCV data |
| `/data/cached` | GET | List cached data |
| `/data/cached/:id` | DELETE | Remove cached data |
| `/events` | GET | List market events |
| `/events/seed-sample` | POST | Add sample events |
| `/control/status` | GET | Kill switch status |
| `/control/kill` | POST | Arm kill switch |
| `/control/resume` | POST | Disarm kill switch |
| `/control/events` | GET | Kill switch event log |

---

## 7. Technical Architecture Notes

**Backend**: Python 3.11, FastAPI, SQLAlchemy async, Alembic, SQLite (dev) / PostgreSQL (prod)  
**Frontend**: React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Recharts, Zustand  
**Data**: yahooquery (free, cached Parquet), Alpaca Markets API (paper/live)  
**Backtest Engine**: No-lookahead, end-of-bar signals, next-bar open fills, commission + slippage  
**Regime Classifier**: EMA-based trend detection (trending_up, trending_down, ranging, high_volatility, low_volatility)
