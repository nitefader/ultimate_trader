# UltraTrader 2026 — Master Specification Document
### Complete PRD · CSS Design System · Site Diagram · API Spec · UX Backlog · Data Sources

> **Purpose:** One authoritative document for recreating or extending UltraTrader 2026 — its look, feel, capabilities, data model, and roadmap. Written for a design + trading expert pair to execute from scratch.

---

## Table of Contents

1. [Product Overview & PRD](#1-product-overview--prd)
2. [Site Map & Navigation Diagram](#2-site-map--navigation-diagram)
3. [Design System & CSS Specification](#3-design-system--css-specification)
4. [Page-by-Page Specification](#4-page-by-page-specification)
5. [Component Library](#5-component-library)
6. [API Specification](#6-api-specification)
7. [Data Models & Database Schema](#7-data-models--database-schema)
8. [Strategy Configuration Schema](#8-strategy-configuration-schema)
9. [Free Market Data Sources](#9-free-market-data-sources)
10. [UX Backlog — Trading & UX Expert Recommendations](#10-ux-backlog--trading--ux-expert-recommendations)

---

## 1. Product Overview & PRD

### 1.1 Vision

UltraTrader 2026 is a **production-grade algorithmic trading platform** for individual traders and small trading desks. It replaces the fragmented workflow of spreadsheets, brokerage GUIs, and cobbled-together Python notebooks with a single dark-themed web application that covers the full trading lifecycle:

```
Idea → Strategy Definition → Backtesting → Analysis → Paper Trading → Live Trading → Monitoring
```

### 1.2 Core Principles

| Principle | Implementation |
|-----------|---------------|
| **Safety First** | Global kill switch always visible, 2-stage promotion (paper → live), AES-256 credential encryption |
| **Data-Driven Decisions** | Rich backtest metrics (Sharpe, Calmar, Monte Carlo, regime P&L) before any capital deployment |
| **Vertical Slice at Every Stage** | Every iteration ships a runnable feature end-to-end, not architecture shells |
| **Zero Config for Paper Trading** | Boots with a paper account seeded at $100,000, strategies pre-loaded from YAML |
| **Broker Agnostic** | Current: Alpaca (paper + live). Extensible to IBKR, Tradier, Tastytrade |

### 1.3 Target Users

| User | Primary Workflow |
|------|-----------------|
| **Quant Hobbyist** | Define rules → backtest → analyze metrics → paper trade |
| **Active Trader** | Monitor live positions, kill switch on news events, compare strategies |
| **Small Trading Desk** | Multi-account management, credential vault, deployment audit trail |

### 1.4 Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript, Vite 5, Tailwind CSS 3, TanStack Query v5, Zustand, Recharts, React Router v6 |
| Backend | FastAPI (Python 3.12), SQLAlchemy 2.0 (async), SQLite (dev) / PostgreSQL (prod), Alembic |
| Data | yfinance / yahooquery, Alpaca Market Data API, Parquet cache (PyArrow) |
| Broker | Alpaca Trade API (paper + live), extensible broker interface |
| Auth | AES-256-GCM credential encryption at rest, JWT-ready structure |
| Deploy | Docker Compose (backend + nginx + frontend), direct dev mode |

### 1.5 Platform Modes

```
PLATFORM_MODE = backtest | paper | live
```

- Controls what the header **ModeIndicator** displays
- Does NOT restrict account-level capabilities
- Set via `.env`, changeable without code changes

### 1.6 Key Feature Matrix

| Feature | Status |
|---------|--------|
| Strategy Builder (YAML-driven rules engine) | Implemented |
| Multi-symbol backtesting with regime detection | Implemented |
| Equity curve, drawdown, trade journal | Implemented |
| Monte Carlo simulation (500 runs) | Implemented |
| Monthly returns heatmap | Implemented |
| Paper account management | Implemented |
| Alpaca paper/live credential vault | Implemented |
| Deployment lifecycle (backtest→paper→live) | Implemented |
| Live position & order monitoring | Implemented |
| Global + per-account kill switch | Implemented |
| Historical data download & cache (yfinance) | Implemented |
| Ticker search | Implemented |
| Event calendar (FOMC, CPI, earnings) | Implemented |
| Kill switch event audit log | Implemented |
| ML promotion advisor | Implemented |
| Walk-forward optimization | Schema only |
| Options support | Backlog |
| Multi-leg orders | Backlog |
| Notifications (email/SMS) | Backlog |
| Strategy marketplace | Backlog |

---

## 2. Site Map & Navigation Diagram

### 2.1 Application Shell

```
┌─────────────────────────────────────────────────────────────────┐
│ SIDEBAR (w-56, bg-gray-900)         HEADER (h-12, bg-gray-900)  │
│ ┌─────────────────────┐             ┌────────────────────────┐  │
│ │ UltraTrader         │             │ [Mode Badge]  [KILL ALL]│  │
│ │ 2026 Edition        │             └────────────────────────┘  │
│ ├─────────────────────┤                                          │
│ │ ○ Dashboard         │  ◄──────────────────────────────────┐   │
│ │ ○ Strategies        │                                     │   │
│ │ ○ Backtest          │         MAIN CONTENT AREA           │   │
│ │ ○ Run History       │         (flex-1, overflow-y-auto,   │   │
│ │ ○ Live Monitor      │          p-4)                       │   │
│ │ ○ Accounts          │                                     │   │
│ │ ○ Security          │                                     │   │
│ │ ○ Deploy            │                                     │   │
│ │ ○ Data              │                                     │   │
│ │ ○ Events            │                                     │   │
│ │ ○ Logs              │                                     │   │
│ ├─────────────────────┤                                         │
│ │ v1.0.0              │                                         │
│ └─────────────────────┘                                         │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Full Route Map

```
/                           → Dashboard
/strategies                 → Strategy List
/strategies/new             → Strategy Creator
/strategies/:strategyId     → Strategy Details + Version History
/backtest                   → Backtest Launcher
/runs                       → Run History Table
/runs/:runId                → Run Details (6 tabs)
/monitor                    → Live Monitor
/accounts                   → Account Monitor
/security                   → Credential Manager
/deployments                → Deployment Manager
/data                       → Data Manager
/events                     → Event Calendar
/logs                       → Logs & Alerts
```

### 2.3 User Journey Flows

```
STRATEGY CREATION FLOW
──────────────────────
/strategies → [New Strategy] → /strategies/new
  → Fill: name, category, symbols, timeframe
  → Build: entry conditions (ConditionBuilder)
  → Configure: stops, targets, sizing, risk
  → [Validate] → errors/warnings shown inline
  → [Save] → redirect to /strategies/:id

BACKTESTING FLOW
────────────────
/backtest
  → Select strategy + version
  → Set symbols, timeframe, date range, capital
  → [Launch Backtest] → redirects to /runs/:id (polling until complete)
    ├── Tab: Overview (KPIs, regime, exit reasons)
    ├── Tab: Equity & Drawdown (charts)
    ├── Tab: Trade Journal (table)
    ├── Tab: Monthly Returns (heatmap)
    ├── Tab: Monte Carlo (simulation)
    └── Tab: Promote → /deployments (paper)

PAPER → LIVE PROMOTION FLOW
────────────────────────────
/runs/:id → [Promote to Paper]
  → Select account → creates Deployment (mode=paper)
/deployments → [Promote to Live panel]
  → Select paper deployment + live account
  → [Get ML Advice] → recommendation shown
  → Complete safety checklist (6 items)
  → [Promote to Live] → deployment (mode=live)

LIVE MONITORING FLOW
────────────────────
/monitor
  → Cards: all running deployments
  → Click card → tabbed detail panel
    ├── Account stats (equity, cash, P&L)
    ├── Positions table (with close button)
    └── Orders table
  → [Close Position] or [Close All] → confirm dialog
```

---

## 3. Design System & CSS Specification

### 3.1 Color Palette

```
BACKGROUNDS (darkest to lightest)
──────────────────────────────────
gray-950   #030712    Page background (body)
gray-900   #111827    Cards, sidebar, header, modals
gray-800   #1f2937    Hover states, dividers, input backgrounds
gray-700   #374151    Borders on interactive elements

TEXT HIERARCHY
──────────────
gray-100   #f3f4f6    Primary content (headings, values)
gray-300   #d1d5db    Secondary content
gray-400   #9ca3af    Labels, metadata
gray-500   #6b7280    Muted text, placeholders
gray-600   #4b5563    Disabled states

SEMANTIC COLORS
───────────────
sky-600    #0284c7    Primary brand / CTA buttons
sky-500    #0ea5e9    Button hover state
sky-400    #38bdf8    Links, accent text

emerald-400  #34d399  Positive P&L, success, active status
emerald-500  #10b981  Success icons
emerald-900  #064e3b  Positive badge background

red-400    #f87171    Negative P&L, kill switch, errors
red-600    #dc2626    Danger buttons
red-700    #b91c1c    Danger button hover
red-900    #7f1d1d    Error/kill badge background
red-950    #450a0a    Kill switch alert banner

amber-400  #fbbf24    Warnings
amber-600  #d97706    Warning buttons

indigo-300 #a5b4fc    Paper mode text
indigo-900 #312e81    Paper mode badge background

MODE BADGE COLORS
─────────────────
BACKTEST   emerald-300 on emerald-900  (#6ee7b7 / #064e3b)
PAPER      indigo-300 on indigo-900    (#a5b4fc / #312e81)
LIVE       red-300 on red-900          (#fca5a5 / #7f1d1d) + pulse animation

CHART COLORS (in order)
────────────────────────
#10b981  emerald (primary series, positive bars)
#3b82f6  blue
#f59e0b  amber
#8b5cf6  purple
#ef4444  red (negative bars)
#06b6d4  cyan
```

### 3.2 Typography

```css
/* Font Stack */
font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
/* Applied globally via: body { @apply font-mono } */

/* Heading Scale */
.h1 { @apply text-2xl font-bold text-gray-100 tracking-tight; }     /* 24px, page titles */
.h2 { @apply text-sm font-semibold text-gray-200; }                  /* section headers */
.h3 { @apply text-xs font-semibold text-gray-300; }                  /* sub-sections */

/* Body */
base text-sm text-gray-400                                            /* 14px, table content */
label: text-xs text-gray-500 uppercase tracking-wide                 /* ALL CAPS field labels */
value: text-2xl font-bold                                             /* KPI values */
mono number: font-mono text-gray-200                                  /* prices, percentages */

/* Links */
text-sky-400 hover:text-sky-300 (with underline on hover)
```

### 3.3 Spacing System

```
Container padding:    p-4 (16px all sides)
Card internal:        p-4
Section gaps:         space-y-6 (24px) between major sections
Card grid gaps:       gap-3 (12px) or gap-4 (16px)
Inline element gaps:  gap-2 (8px) or gap-2.5 (10px)
Table cell padding:   px-4 py-2.5 (header) / px-4 py-3 (rows)
Sidebar padding:      px-2 py-4
Nav item padding:     px-3 py-2
```

### 3.4 Complete CSS Component Classes

```css
/* ── Layout ─────────────────────────────────────────────────── */

/* Full app shell */
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background-color: #030712; /* gray-950 */
}

/* Sidebar */
.sidebar {
  width: 14rem; /* w-56 */
  flex-shrink: 0;
  border-right: 1px solid #1f2937; /* border-gray-800 */
  display: flex;
  flex-direction: column;
  background-color: #111827; /* bg-gray-900 */
}

/* Header */
.header {
  height: 3rem; /* h-12 */
  border-bottom: 1px solid #1f2937;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1rem;
  background-color: #111827;
  flex-shrink: 0;
}

/* ── Cards ─────────────────────────────────────────────────── */

.card {
  background-color: #111827;      /* bg-gray-900 */
  border: 1px solid #1f2937;      /* border-gray-800 */
  border-radius: 0.5rem;          /* rounded-lg */
  padding: 1rem;                  /* p-4 */
}

.metric-card {
  /* extends .card */
  display: flex;
  flex-direction: column;
  gap: 0.25rem;                   /* gap-1 */
}

.metric-label {
  font-size: 0.75rem;             /* text-xs */
  color: #6b7280;                 /* text-gray-500 */
  text-transform: uppercase;
}

.metric-value {
  font-size: 1.25rem;             /* text-xl */
  font-weight: 700;               /* font-bold */
}

/* ── Buttons ─────────────────────────────────────────────────── */

.btn {
  padding: 0.5rem 1rem;           /* py-2 px-4 */
  border-radius: 0.25rem;         /* rounded */
  font-weight: 600;               /* font-semibold */
  font-size: 0.875rem;            /* text-sm */
  transition: color 0.15s, background-color 0.15s;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  /* extends .btn */
  background-color: #0284c7;      /* bg-sky-600 */
  color: white;
}
.btn-primary:hover:not(:disabled) {
  background-color: #0ea5e9;      /* hover:bg-sky-500 */
}

.btn-danger {
  background-color: #dc2626;      /* bg-red-600 */
  color: white;
}
.btn-danger:hover:not(:disabled) {
  background-color: #ef4444;      /* hover:bg-red-500 */
}

.btn-warning {
  background-color: #d97706;      /* bg-amber-600 */
  color: white;
}
.btn-warning:hover:not(:disabled) {
  background-color: #f59e0b;      /* hover:bg-amber-500 */
}

.btn-ghost {
  background-color: transparent;
  border: 1px solid #374151;      /* border-gray-700 */
  color: #d1d5db;                 /* text-gray-300 */
}
.btn-ghost:hover:not(:disabled) {
  background-color: #1f2937;      /* hover:bg-gray-800 */
}

/* Kill switch button */
.btn-kill {
  /* extends .btn */
  background-color: #7f1d1d;      /* bg-red-900 */
  color: #fecaca;                 /* text-red-200 */
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.btn-kill:hover:not(:disabled) {
  background-color: #b91c1c;      /* hover:bg-red-700 */
}

/* ── Form Inputs ─────────────────────────────────────────────── */

.input {
  background-color: #1f2937;      /* bg-gray-800 */
  border: 1px solid #374151;      /* border-gray-700 */
  border-radius: 0.25rem;         /* rounded */
  padding: 0.5rem 0.75rem;        /* py-2 px-3 */
  font-size: 0.875rem;            /* text-sm */
  color: #f3f4f6;                 /* text-gray-100 */
  outline: none;
}
.input:focus {
  border-color: #0ea5e9;          /* focus:border-sky-500 */
}

.label {
  display: block;
  font-size: 0.75rem;             /* text-xs */
  color: #9ca3af;                 /* text-gray-400 */
  margin-bottom: 0.25rem;         /* mb-1 */
  text-transform: uppercase;
  letter-spacing: 0.05em;         /* tracking-wide */
}

textarea.input {
  resize: vertical;
  min-height: 4rem;
}

select.input {
  appearance: none;
  background-image: url("data:image/svg+xml,..."); /* chevron */
  padding-right: 2rem;
}

/* Checkbox */
input[type="checkbox"] {
  accent-color: #0284c7;          /* sky-600 */
  width: 1rem;
  height: 1rem;
}

/* ── Badges ─────────────────────────────────────────────────── */

.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.5rem;       /* py-0.5 px-2 */
  border-radius: 0.25rem;         /* rounded */
  font-size: 0.75rem;             /* text-xs */
  font-weight: 600;               /* font-semibold */
}

.badge-backtest { background: #064e3b; color: #6ee7b7; }  /* emerald-900/300 */
.badge-paper    { background: #312e81; color: #a5b4fc; }  /* indigo-900/300 */
.badge-live     { background: #7f1d1d; color: #fca5a5; }  /* red-900/300 */
.badge-green    { background: #14532d; color: #86efac; }  /* green-900/300 */
.badge-red      { background: #7f1d1d; color: #fca5a5; }  /* red-900/300 */
.badge-gray     { background: #1f2937; color: #9ca3af; }  /* gray-800/400 */
.badge-amber    { background: #78350f; color: #fcd34d; }  /* amber-900/300 */
.badge-sky      { background: #0c4a6e; color: #7dd3fc; }  /* sky-900/300 */

/* Mode badge with animation */
.badge-live.animated {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
.badge-live.animated::before {
  content: '';
  display: inline-block;
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: #f87171;
  margin-right: 0.375rem;
  animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
}

/* ── Tables ─────────────────────────────────────────────────── */

.data-table {
  width: 100%;
  font-size: 0.875rem;            /* text-sm */
  border-collapse: collapse;
}

.data-table thead tr {
  border-bottom: 1px solid #1f2937;
  background-color: rgba(17, 24, 39, 0.6); /* bg-gray-900/60 */
}

.data-table thead th {
  text-align: left;
  padding: 0.625rem 1rem;         /* py-2.5 px-4 */
  font-size: 0.75rem;             /* text-xs */
  color: #6b7280;                 /* text-gray-500 */
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.data-table tbody tr {
  border-bottom: 1px solid rgba(31, 41, 55, 0.5); /* border-gray-800/50 */
  transition: background-color 0.15s;
}

.data-table tbody tr:hover {
  background-color: rgba(31, 41, 55, 0.3); /* hover:bg-gray-800/30 */
}

.data-table tbody td {
  padding: 0.75rem 1rem;          /* py-3 px-4 */
  color: #d1d5db;                 /* text-gray-300 */
}

/* ── Charts (Recharts overrides) ─────────────────────────────── */

/* Tooltip */
.recharts-tooltip-wrapper .custom-tooltip {
  background-color: #111827;      /* gray-900 */
  border: 1px solid #374151;      /* gray-700 */
  border-radius: 0.375rem;
  font-size: 0.75rem;
  padding: 0.5rem 0.75rem;
}

/* Grid lines */
.recharts-cartesian-grid-horizontal line,
.recharts-cartesian-grid-vertical line {
  stroke: #1f2937;                /* gray-800 */
}

/* Axis ticks */
.recharts-xAxis .recharts-text,
.recharts-yAxis .recharts-text {
  fill: #6b7280;                  /* gray-500 */
  font-size: 10px;
}

/* ── Semantic State Colors ───────────────────────────────────── */

.positive { color: #34d399; }     /* emerald-400 */
.negative { color: #f87171; }     /* red-400 */
.neutral  { color: #d1d5db; }     /* gray-300 */
.warning  { color: #fbbf24; }     /* amber-400 */
.muted    { color: #6b7280; }     /* gray-500 */

/* ── Animations ─────────────────────────────────────────────── */

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
}

@keyframes ping {
  75%, 100% {
    transform: scale(2);
    opacity: 0;
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.animate-pulse { animation: pulse 2s cubic-bezier(0.4,0,0.6,1) infinite; }
.animate-ping  { animation: ping 1s cubic-bezier(0,0,0.2,1) infinite; }
.animate-spin  { animation: spin 1s linear infinite; }
.transition-colors { transition: color 0.15s, background-color 0.15s, border-color 0.15s; }
.transition-all    { transition: all 0.15s; }

/* ── Kill Switch Alert Banner ────────────────────────────────── */

.kill-switch-banner {
  background-color: #450a0a;      /* red-950 */
  border: 1px solid #b91c1c;      /* red-700 */
  border-radius: 0.5rem;
  padding: 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  animation: pulse 2s infinite;
}

/* ── Scrollbar ───────────────────────────────────────────────── */

* {
  scrollbar-width: thin;
  scrollbar-color: #374151 #111827;
}
::-webkit-scrollbar       { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #111827; }
::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
```

### 3.5 Tailwind Config (full)

```js
// tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f9ff', 500: '#0ea5e9', 600: '#0284c7',
          700: '#0369a1', 900: '#0c4a6e',
        },
        danger:   '#ef4444',
        success:  '#22c55e',
        warning:  '#f59e0b',
        paper:    '#818cf8',
        live:     '#f87171',
        backtest: '#34d399',
      },
    },
  },
  plugins: [],
}
```

### 3.6 Iconography

All icons sourced from **lucide-react** (tree-shakable, consistent 2px stroke weight):

| Usage | Icon Name |
|-------|-----------|
| Dashboard | `Monitor` |
| Strategies | `Layers` |
| Backtest | `TrendingUp` |
| Run History | `BarChart2` |
| Live Monitor | `Radio` |
| Accounts | `Shield` |
| Security/Keys | `Key` |
| Deploy | `Zap` |
| Data | `Database` |
| Events | `Calendar` |
| Logs | `Activity` |
| Kill Switch | `Power`, `AlertTriangle` |
| Positive P&L | `TrendingUp` |
| Negative P&L | `TrendingDown` |
| Navigate | `ArrowRight` |
| Refresh | `RotateCcw` |
| Dollar | `DollarSign` |

---

## 4. Page-by-Page Specification

### 4.1 Dashboard (`/`)

**Layout:** `space-y-6` vertical stack

```
[Kill Switch Banner — conditional, animate-pulse red]

[Page Header]
  H1: "Dashboard"
  Subtext: day/date
  Right: ModeIndicator badge

[KPI Grid — 2 cols mobile, 4 cols desktop]
  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
  │ $ Total     │ │ 📡 Active   │ │ 📊 Backtest │ │ ⚡ Kill     │
  │ Equity      │ │ Deployments │ │ Runs        │ │ Switch      │
  │ $100,000    │ │ 2           │ │ 14          │ │ Safe        │
  │ 2 accounts  │ │ 1p · 1l     │ │ avg +3.2%   │ │ All running │
  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
  (each is a <Link> to its section, hover shows ArrowRight)

[Chart Row — 5-col grid]
  [Recent Backtest Returns — col-span-3]           [Equity Allocation — col-span-2]
  BarChart (Recharts):                              PieChart (Recharts):
  - X: symbol/run label                            - Donut: innerRadius=32, outerRadius=56
  - Y: return %                                    - Legend below (dot + account name)
  - Bars color: green if ≥0, red if <0             - Empty state: "No accounts" + link

[Accounts Table]
  header: Account | Mode | Equity | Broker | Status
  rows: linked to /accounts
  Status cells: Active (green) | Disabled (gray) | Killed (red)

[Recent Backtest Runs Table]
  header: Symbols | Timeframe | Period | Return | Sharpe | Win% | Status
  Symbol cells: linked to /runs/:id
  Return: colored (+green / -red)
  Status: badge (running=pulsing blue dot, completed=green, failed=red)

[Quick Actions — 2 cols mobile, 4 cols desktop]
  New Strategy | Run Backtest | Manage Data | Deploy
  (card links with icon + label + sub-description)
```

**Data:** `useQuery` with `refetchInterval` — accounts 20s, deployments 15s, backtests 30s

---

### 4.2 Strategy List (`/strategies`)

```
[Header]
  H1: "Strategies"
  Right: [+ New Strategy] btn-primary → /strategies/new

[Strategy Grid — responsive, gap-3]
  ┌───────────────────────────────────┐
  │ badge-backtest  [Strategy Name]   │
  │ description (truncated, 2 lines)  │
  │ Created: Apr 10 2026              │
  │ [active badge]                    │
  └───────────────────────────────────┘
  Click → /strategies/:id

[Empty State]
  Layers icon
  "No strategies defined yet"
  [Create your first strategy] btn-primary
```

---

### 4.3 Strategy Creator (`/strategies/new`)

```
[Header]
  H1: "New Strategy"

[Form — single column, space-y-6]

  ── STRATEGY INFO ──────────────────
  Name (input, required)
  Category (select: momentum | mean_reversion | breakout | volatility | custom)
  Description (textarea)

  ── UNIVERSE & TIMEFRAME ───────────
  Symbols (input, comma-separated, placeholder: "SPY, QQQ, AAPL")
  Timeframe (select: 1m 5m 15m 30m 1h 2h 4h 1d 1wk 1mo)

  ── ENTRY RULES ────────────────────
  Directions (checkboxes: long | short)
  <ConditionBuilder>  (see Component spec §5.3)

  ── STOP LOSS ──────────────────────
  Method (select):
    fixed_pct       → show: value (%)
    fixed_dollar    → show: value ($)
    atr_multiple    → show: period, mult
    swing_low       → show: lookback bars
    n_bars_low      → show: n
    chandelier      → show: period, mult
    fvg_low         → (no extra fields)
    combined        → shows sub-stop list builder

  ── PROFIT TARGETS ─────────────────
  Table: [method select] [r / value / period / mult] [✕ remove]
  [+ Add Target] button
  Methods: r_multiple, fixed_pct, fixed_dollar, atr_multiple

  ── TRAILING STOP ──────────────────
  Method (select: none | chandelier | atr | percent)
  period / mult inputs (conditional on method)

  ── SCALE IN ───────────────────────
  Toggle: Enable scale-in
  Max adds (number)
  Levels table: level number → % of position
  Entry conditions (nested ConditionBuilder)

  ── SCALE OUT ──────────────────────
  Toggle: Move stop to BE after T1
  Levels table: % to exit per level

  ── POSITION SIZING ────────────────
  Method (select: risk_pct | fixed_shares | fixed_amount | pct_equity)
  risk_pct → Risk % input (default 1.0)
  Leverage (number, default 1.0)

  ── RISK CONTROLS ──────────────────
  Max Position Size (% of equity)
  Max Daily Loss %
  Max Drawdown Lockout %
  Max Open Positions (integer)
  Max Portfolio Heat % (total risk in all open trades)

  ── REGIME FILTER ──────────────────
  Checkboxes: trending_up | trending_down | ranging | low_volatility | high_volatility

  ── COOLDOWN RULES ─────────────────
  Table rows: [trigger select] [duration] [session_reset] [symbol_level] [✕]
  Triggers: stop_out | consecutive_loss | daily_loss_hit | time_of_day
  [+ Add Cooldown]

  ── INDICATORS ─────────────────────
  EMA periods (comma list)
  SMA periods (comma list)
  RSI periods (comma list)

[Action Bar — sticky bottom or end of form]
  [Validate Config] btn-ghost   [Save Strategy] btn-primary

[Validation Results — shown after Validate]
  ✅ Valid config
  ⚠️  Warning: ... (amber)
  ❌  Error: ... (red)
```

---

### 4.4 Strategy Details (`/strategies/:strategyId`)

```
[Header]
  Strategy Name (H1)
  category badge  status badge
  Description text
  Right buttons: [Run Backtest] [New Version]

[Two-column layout]
  LEFT: Version History list
    Each version card:
      "v3 — Apr 10, 2026"
      promotion_status badge
      notes (truncated)
    Selected version: highlighted bg-sky-900/30 border-sky-700

  RIGHT: Version Detail
    Promotion Status badge
    Created date
    Notes
    JSON config preview (syntax-highlighted code block, monospace)

[New Version Modal]
  Notes textarea
  "This creates v{n+1}" hint
  [Cancel] [Create Version] buttons
```

---

### 4.5 Backtest Launcher (`/backtest`)

```
[Header]
  H1: "Launch Backtest"

[Form — card, space-y-4]

  ── STRATEGY ────────────────────────
  Strategy (select from list)
  Version (select — populated from chosen strategy)
  Shows: version notes, promotion_status

  ── DATA ────────────────────────────
  Symbols (input, comma-separated)
  Timeframe (select)
  Start Date (date input)
  End Date (date input)
  ⚠️  Intraday warning (if timeframe < 1d):
    "yfinance intraday data limited to last 60 days.
     Use Alpaca for longer intraday history."

  ── EXECUTION PARAMETERS ────────────
  Initial Capital ($)
  Commission per Share ($0.005 default)
  Slippage Ticks (1 default)

[Error Alert — conditional on launch failure]
  red background card
  "Launch failed: {error_message}"

[Action]
  [Launch Backtest] btn-primary  (full width)
  Spinner shown during request
  On success → navigate to /runs/:runId
```

---

### 4.6 Run History (`/runs`)

```
[Header]
  H1: "Backtest Runs"
  "{n} runs"
  [+ New Backtest] btn-primary → /backtest

[Full-width Table]
  Columns:
  Symbols (link → /runs/:id) | Timeframe | Period | Capital
  Return % | Sharpe | Max DD | Win % | Trades | Status | Date

  Status badges: running (pulsing blue) | completed (green)
                 failed (red) | pending (gray) | cancelled (gray)
  Return: colored text (+green / -red)

[Empty State]
  BarChart2 icon, "No backtest runs yet"
  [Launch First Backtest] btn-primary
```

---

### 4.7 Run Details (`/runs/:runId`)

```
[Header]
  Symbols joined with ", " — H1
  Timeframe badge  Status badge  Period text  Capital text

[6 Tabs]
```

**Tab 1: Overview**
```
  [4 Metric Cards — 2+2 grid]
    Total Return % | CAGR % | Sharpe Ratio | Max Drawdown %

  [Trade Stats — 4-col grid]
    Win Rate | Profit Factor | Sortino | Calmar
    Total Trades | Winners | Losers | Avg Hold Days
    Long Trades | Short Trades | Avg Win % | Avg Loss %
    Expectancy | Recovery Factor | Max DD Duration | —

  [2-col: Exit Reasons | Regime P&L]
    Exit Reasons: bar list (exit_reason_breakdown)
    Regime P&L:   bar list (regime_breakdown)

  [Error — if status=failed]
    red card: error_message
```

**Tab 2: Equity & Drawdown**
```
  [EquityCurve chart — full width, height 280px]
    Area chart, sky-400 fill with 20% opacity gradient
    Reference line: initial capital (dashed gray-700)
    X: date, Y: equity $

  [DrawdownChart — full width, height 160px]
    Area chart, red-500/30 fill
    X: date, Y: drawdown %
    Y-axis inverted (negative = bigger drawdown)
```

**Tab 3: Trade Journal**
```
  [Table — sortable]
    # | Symbol | Dir | Entry Time | Entry $ | Exit Time | Exit $
    P&L | Return % | R-Multiple | Exit Reason | Regime

  Direction: long (emerald) | short (red)
  Return: colored
  Rows clickable (future: trade detail panel)
```

**Tab 4: Monthly Returns**
```
  [MonthlyHeatmap]
    Grid: rows = months (Jan-Dec), cols = years
    Cell color: green intensity (positive) / red intensity (negative)
    Cell text: return % (hidden if too small)
    Legend: gradient bar from -15% to +15%
    Hover tooltip: full precision value
```

**Tab 5: Monte Carlo**
```
  [Description text]
    "500 simulations by randomly shuffling trade order"

  [6 Metric Cards — 2+3 grid]
    Median Return % | P5 Return % | P95 Return %
    Median Max Drawdown | P95 Max Drawdown | Prob. Profitable

  [Distribution hints]
    P5 = worst 5% scenario
    P95 = best 95% scenario
```

**Tab 6: Promote**
```
  [Conditional: only shown if status=completed]

  H2: "Promote to Paper Trading"
  Description text about promotion workflow

  Account selector (select from paper accounts)
  Notes textarea
  [Promote to Paper] btn-primary

  On success: green confirmation card
    "Deployment created. View in Deployments →"
```

---

### 4.8 Live Monitor (`/monitor`)

```
[Header]
  H1: "Live Monitor"
  Subtitle: "{n} active runs"
  [↺ Refresh] btn-ghost

[No Active Runs — empty state]
  Radio icon, "No active deployments"
  [Go to Deployments] link

[Active Runs Grid — 2 cols desktop]
  ┌──────────────────────────────────┐
  │ [paper badge]  Strategy Name     │
  │ Account Name                     │
  │ Equity: $104,250   P&L: +$4,250  │
  │ ● running                        │
  └──────────────────────────────────┘
  (clicking opens the tabbed detail panel below)

[Selected Run — Tabs]
  ── ACCOUNT STATS ──────────────────────
  Pills row: Equity | Cash | Portfolio | Open P&L | Exposure

  ── POSITIONS ──────────────────────────
  Table: Symbol | Side | Qty | Avg Entry | Current | Mkt Value
         Unrealized P&L | % | Today | [Close]
  [Close All] btn-danger (bottom right)

  ── ORDERS ─────────────────────────────
  Table: Symbol | Side | Type | Qty | Filled | Limit | Status | Time
  Status: open (sky) | filled (green) | cancelled (gray) | partial (amber)
```

---

### 4.9 Account Monitor (`/accounts`)

```
[Header]
  H1: "Accounts"  Subtitle: "Manage paper and live accounts"
  [+ Add Account] btn-primary

[Accounts Table]
  Columns: Account | Mode | Equity | Balance | PnL | Max Pos% | Max DD%
           Leverage | Status | Activity | Actions

  Activity column:
    "{n} deployments · {n} positions"

  Status column:
    Killed (red) | Active (green) | Disabled (gray)

  Actions column:
    [⚡ Kill] btn-warning  |  [↺ Resume] btn-ghost  |  [✕ Delete] btn-danger

[Add Account Modal]
  Name (input)
  Mode (radio: paper | live)
  Broker (select: paper_broker | alpaca)
  Initial Balance ($)
  [Cancel] [Create Account]

[Error/Loading States]
  Loading: skeleton rows
  Error: red card "Error loading accounts: {message}"
```

---

### 4.10 Credential Manager (`/security`)

```
[Two-column layout]

  LEFT: Account Sidebar (w-48)
    List of account names
    Selected: bg-sky-900/30 border-l-2 border-sky-500

  RIGHT: Credential Form
    H2: Account name
    Mode toggle: [Paper] [Live] — sky / orange color
    ⚠️  Live warning banner (if live selected)

    API Key (password input + show/hide toggle)
    Secret Key (password input + show/hide toggle)
    Base URL (input, auto-filled based on mode)

    [Test Connection] btn-ghost
      → green/red result card:
        "Connected. Account: PA-XXXXXXX  Equity: $104,234"

    [Save Keys] btn-primary
      → green success confirmation

[Empty — no accounts]
  "No accounts found. Create an account first."
  [Go to Accounts] link
```

---

### 4.11 Deployment Manager (`/deployments`)

```
[Header]
  H1: "Deployments"
  [▲ Promote to Live] toggle btn-ghost — shows/hides promotion panel

[Deployments Table]
  Mode | Strategy | Account | Status | Created | Actions

  Actions:
    pending  → [▶ Start]
    running  → [⏸ Pause] [⏹ Stop]
    paused   → [▶ Resume] [⏹ Stop]
    stopped  → (no actions)
    failed   → (no actions)

[Promotion Panel — collapsible]
  H2: "Promote Paper → Live"

  Source: Select Paper Deployment (dropdown, running paper only)
  Target: Select Live Account (dropdown)

  [Get Promotion Advice] btn-ghost
    → ML recommendation card:
      ✅ Recommend / ❌ Do Not Recommend
      Checks list with scores

  Safety Checklist (all 6 required):
    ☐ Paper performance reviewed (minimum 30 days)
    ☐ Risk limits confirmed and appropriate for live capital
    ☐ Live account balance and buying power verified
    ☐ Broker connection tested and validated
    ☐ Compliance requirements acknowledged
    ☐ Market conditions assessed for current strategy

  Notes (textarea)

  [Promote to Live] btn-danger
    Disabled until all 6 checked
    Requires confirm dialog
```

---

### 4.12 Data Manager (`/data`)

```
[Provider Cards — grid]
  ┌─────────────────┐ ┌─────────────────┐
  │ yfinance        │ │ Alpaca          │
  │ Free · No auth  │ │ Requires keys   │
  │ Daily: 5yr+     │ │ Daily: 5yr+     │
  │ Intraday: 60d   │ │ Intraday: 2yr   │
  │ 1m 5m 1h 1d 1wk │ │ 1m 5m 15m 1h 1d │
  └─────────────────┘ └─────────────────┘

[Data Inventory]
  H2: "Cached Data"
  Table: Symbol | Timeframe | Provider | First Date | Last Date | Bars | Size | [🗑]

[Search Ticker]
  H2: "Search Ticker"
  Input + Provider select + [Search]
  Results: symbol | name | type | exchange | [Fetch] button

[Fetch Data]
  H2: "Fetch New Data"
  Symbol | Timeframe | Start Date | End Date | Provider
  Force refresh toggle
  [Fetch] btn-primary → progress bar → success card

[Batch Fetch]
  H2: "Batch Fetch"
  Symbols textarea (one per line or comma)
  Common settings (timeframe, dates, provider)
  [Fetch All] → progress list per symbol
```

---

### 4.13 Event Calendar (`/events`)

```
[Filter Bar]
  🔍 Search input
  Impact: [All] [High] [Medium] [Low]
  Category: All | FOMC | CPI | NFP | Earnings | ...
  Date range: From | To
  [Clear filters] link
  "Showing {n} of {total} events"

[Events Table]
  Name | Category | Symbol | Date/Time | Impact | Source

  Impact badges:
    high   → badge-red
    medium → badge-amber
    low    → badge-gray

[Empty State]
  Calendar icon
  "No events found"
  [Seed Sample Events] btn-ghost
    → Creates: FOMC, CPI, NFP samples
```

---

### 4.14 Logs & Alerts (`/logs`)

```
[Summary Row]
  Pills: Total Events | Kills+Pauses | Resumes

[Event Log Table]
  Timestamp | Action | Scope | Scope ID | Reason | Triggered By

  Action badges:
    kill   → badge-red
    pause  → badge-amber
    resume → badge-green

  Scope badges:
    global  → badge-red
    account → badge-sky

[Limit selector — top right]
  [50] [100] [500]

[Empty State]
  Activity icon
  "No kill switch events recorded"
```

---

## 5. Component Library

### 5.1 ModeIndicator

```tsx
Props:
  mode: 'backtest' | 'paper' | 'live'
  large?: boolean      // larger text size
  animated?: boolean   // adds pulse ring for 'live'

Render:
  <span class="badge badge-{mode} [animate-pulse if live+animated]">
    [pulsing dot if live]
    {mode.toUpperCase()}
  </span>

Color map:
  backtest → bg-emerald-900/40 text-emerald-400
  paper    → bg-indigo-900/40 text-indigo-300
  live     → bg-red-900/40 text-red-400 (ring-1 ring-red-500 animate-pulse)
```

### 5.2 KillSwitch

```tsx
State: { status: KillSwitchStatus | null, loading }
Behavior:
  isKilled = status?.global_killed ?? false

  if isKilled:
    → Render: "⚠ ALL TRADING STOPPED" + [Resume] button
    → Background: red-950, text: red-400, animate-pulse

  else:
    → Render: [⏻ KILL ALL] red button
    → Click → window.confirm("Stop all trading...?")
    → On confirm → POST /control/kill-all

Kill action: sets pending=true, disables button, calls killAll(reason)
Resume action: sets pending=true, calls resumeAll()
```

### 5.3 ConditionBuilder

```tsx
Props:
  conditions: Condition[]
  onChange: (conditions: Condition[]) => void
  logic: 'all_of' | 'any_of' | `n_of_m:${number}`
  onLogicChange: (logic: string) => void
  label?: string

For each condition (type=single):
  LEFT value selector:
    Type: [field | indicator | prev_bar]
    field    → select: close | open | high | low | volume
    indicator → input (ema_21, rsi_14, atr_14, etc.)
    prev_bar  → select field + n_bars_back number

  OPERATOR select:
    > | >= | < | <= | == | != | crosses_above | crosses_below | between | in

  RIGHT value selector:
    Same types as LEFT, plus:
    literal  → number input

[+ Add Condition] button
Logic selector: [All of] [Any of] [N of M (2-7 dropdowns)]

Summary text below builder:
  "Match ALL of these 3 conditions" or
  "Match ANY of these 4 conditions" or
  "Match at least 3 of these 5 conditions"
```

### 5.4 EquityCurve Chart

```tsx
Props:
  data: EquityPoint[]         // {date, equity, cash, drawdown, regime}
  initialCapital: number
  height?: number             // default 280

Render: Recharts <AreaChart>
  <defs>
    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%"  stopColor="#38bdf8" stopOpacity={0.3} />
      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
    </linearGradient>
  </defs>
  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
  <XAxis dataKey="date" tick={{fontSize:10, fill:'#6b7280'}} />
  <YAxis tick={{fontSize:10, fill:'#6b7280'}} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
  <Tooltip contentStyle={{background:'#111827', border:'1px solid #374151'}} />
  <ReferenceLine y={initialCapital} stroke="#4b5563" strokeDasharray="4 4" />
  <Area dataKey="equity" stroke="#38bdf8" fill="url(#equityGrad)" strokeWidth={2} dot={false} />
```

### 5.5 DrawdownChart

```tsx
Render: Recharts <AreaChart>
  // Negate values for visual (drawdown stored as negative)
  data mapped: {...d, drawdown: d.drawdown}

  <Area dataKey="drawdown"
    stroke="#ef4444"
    fill="#ef4444"
    fillOpacity={0.15}
    strokeWidth={1.5}
    dot={false} />
  YAxis: reversed, tickFormatter={v => `${v.toFixed(1)}%`}
```

### 5.6 MonthlyHeatmap

```tsx
Data: Record<string, number>   // {"2025-01": 3.2, "2025-02": -1.4, ...}
Color scale:
  -15% → rgb(127, 29, 29)   // red-900
  -5%  → rgb(239, 68, 68)   // red-500
  0%   → rgb(31, 41, 55)    // gray-800 (neutral)
  +5%  → rgb(16, 185, 129)  // emerald-500
  +15% → rgb(6, 78, 59)     // emerald-900

Grid: rows = months, cols = years
Cell: min-w-10 h-8, rounded, hover tooltip
```

---

## 6. API Specification

**Base URL:** `http://localhost:8000/api/v1`
**Content-Type:** `application/json`
**Auth:** None (single-user mode; JWT-ready)

---

### 6.1 Strategies

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/strategies` | List all strategies |
| `POST` | `/strategies` | Create strategy + first version |
| `GET` | `/strategies/{id}` | Get strategy with version history |
| `PUT` | `/strategies/{id}` | Update strategy metadata |
| `DELETE` | `/strategies/{id}` | Delete strategy (cascades versions) |
| `POST` | `/strategies/{id}/versions` | Add new version |
| `GET` | `/strategies/{id}/versions/{vid}` | Get specific version |
| `POST` | `/strategies/validate` | Validate config, return errors/warnings |

**GET /strategies response:**
```json
[{
  "id": "uuid",
  "name": "Momentum Trend Following",
  "description": "EMA crossover with regime filter",
  "category": "momentum",
  "status": "active",
  "tags": [],
  "created_at": "2026-04-10T00:00:00",
  "updated_at": "2026-04-10T00:00:00"
}]
```

**POST /strategies body:**
```json
{
  "name": "My Strategy",
  "category": "momentum",
  "description": "...",
  "config": { /* StrategyConfig object */ },
  "notes": "Initial version"
}
```

**POST /strategies/validate response:**
```json
{
  "valid": true,
  "errors": [],
  "warnings": ["No profit targets defined — strategy will hold until stop"]
}
```

---

### 6.2 Backtests

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/backtests/launch` | Launch new backtest |
| `GET` | `/backtests` | List runs (optional: `?strategy_id=&limit=50`) |
| `GET` | `/backtests/{id}` | Get run with metrics |
| `GET` | `/backtests/{id}/equity-curve` | Full equity curve data |
| `GET` | `/backtests/{id}/trades` | All trades for run |
| `DELETE` | `/backtests/{id}` | Delete run + trades + metrics |
| `POST` | `/backtests/{id}/compare` | Compare two runs side-by-side |

**POST /backtests/launch body:**
```json
{
  "strategy_version_id": "uuid",
  "symbols": ["SPY", "QQQ"],
  "timeframe": "1d",
  "start_date": "2022-01-01",
  "end_date": "2024-12-31",
  "initial_capital": 100000,
  "commission_per_share": 0.005,
  "slippage_ticks": 1
}
```

**GET /backtests/{id} response:**
```json
{
  "id": "uuid",
  "strategy_version_id": "uuid",
  "mode": "backtest",
  "status": "completed",
  "symbols": ["SPY"],
  "timeframe": "1d",
  "start_date": "2022-01-01",
  "end_date": "2024-12-31",
  "initial_capital": 100000,
  "created_at": "2026-04-10T00:00:00",
  "completed_at": "2026-04-10T00:01:23",
  "metrics": {
    "total_return_pct": 18.4,
    "cagr_pct": 8.9,
    "sharpe_ratio": 1.23,
    "sortino_ratio": 1.87,
    "calmar_ratio": 0.94,
    "max_drawdown_pct": -9.5,
    "max_drawdown_duration_days": 45,
    "recovery_factor": 1.94,
    "total_trades": 142,
    "winning_trades": 88,
    "losing_trades": 54,
    "win_rate_pct": 61.97,
    "avg_win_pct": 2.14,
    "avg_loss_pct": -1.02,
    "expectancy": 847.3,
    "profit_factor": 2.18,
    "avg_hold_days": 4.2,
    "long_trades": 130,
    "short_trades": 12,
    "exit_reason_breakdown": {"target_1": 68, "stop_loss": 54, "target_2": 20},
    "regime_breakdown": {"trending_up": 12400, "ranging": -1200},
    "monthly_returns": {"2022-01": 2.3, "2022-02": -1.1},
    "monte_carlo": {
      "median_return_pct": 17.2,
      "p5_return_pct": 8.1,
      "p95_return_pct": 28.4,
      "median_max_drawdown_pct": -10.2,
      "p95_max_drawdown_pct": -16.8,
      "probability_profitable": 0.84
    }
  }
}
```

---

### 6.3 Accounts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/accounts` | List accounts (`?refresh=false&include_activity=false`) |
| `POST` | `/accounts` | Create account |
| `GET` | `/accounts/{id}` | Get account with activity |
| `PUT` | `/accounts/{id}` | Update account settings |
| `DELETE` | `/accounts/{id}` | Delete (blocked if active deployments) |
| `POST` | `/accounts/{id}/kill` | Kill account trading |
| `POST` | `/accounts/{id}/resume` | Resume account trading |
| `POST` | `/accounts/{id}/refresh` | Sync balance from broker |
| `GET` | `/accounts/{id}/credentials` | Get masked credentials |
| `PUT` | `/accounts/{id}/credentials` | Save encrypted credentials |
| `POST` | `/accounts/{id}/credentials/validate` | Test broker connection |
| `GET` | `/accounts/{id}/broker/status` | Live account status |
| `GET` | `/accounts/{id}/broker/orders` | Live orders (`?status_filter=open`) |

**Account object:**
```json
{
  "id": "uuid",
  "name": "Default Paper Account",
  "mode": "paper",
  "broker": "paper_broker",
  "initial_balance": 100000.0,
  "current_balance": 104250.0,
  "equity": 104250.0,
  "unrealized_pnl": 1200.0,
  "leverage": 1.0,
  "max_position_size_pct": 0.10,
  "max_daily_loss_pct": 0.03,
  "max_drawdown_lockout_pct": 0.10,
  "max_open_positions": 10,
  "is_connected": true,
  "is_enabled": true,
  "is_killed": false,
  "kill_reason": null,
  "allowed_symbols": [],
  "blocked_symbols": [],
  "created_at": "2026-04-10T00:00:00",
  "activity": {
    "deployment_count": 2,
    "active_deployments": 1,
    "open_trades": 3,
    "open_positions": 3,
    "open_orders": 0,
    "position_symbols": ["SPY", "QQQ", "AAPL"],
    "delete_blockers": ["1 active deployment"],
    "can_delete": false
  }
}
```

---

### 6.4 Deployments

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/deployments` | List (`?account_id=&mode=paper\|live`) |
| `GET` | `/deployments/{id}` | Get deployment detail |
| `POST` | `/deployments/promote-to-paper` | Backtest → Paper |
| `POST` | `/deployments/promote-to-live` | Paper → Live |
| `POST` | `/deployments/{id}/start` | Start pending/paused |
| `POST` | `/deployments/{id}/pause` | Pause running |
| `POST` | `/deployments/{id}/stop` | Stop with reason |
| `GET` | `/deployments/{id}/positions` | Current positions |

---

### 6.5 Monitor

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/monitor/runs` | All active deployments |
| `GET` | `/monitor/runs/{id}` | Run with live account data |
| `GET` | `/monitor/runs/{id}/positions` | Live positions |
| `GET` | `/monitor/runs/{id}/orders` | Live orders |
| `POST` | `/monitor/runs/{id}/close-position` | Close single position |
| `POST` | `/monitor/runs/{id}/close-all` | Flatten entire account |

---

### 6.6 Control / Kill Switch

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/control/status` | Platform mode + kill switch state |
| `POST` | `/control/kill-all` | Kill all trading globally |
| `POST` | `/control/resume-all` | Resume all trading |
| `POST` | `/control/kill-strategy/{id}` | Kill specific strategy |
| `POST` | `/control/pause-strategy/{id}` | Pause specific strategy |
| `POST` | `/control/resume-strategy/{id}` | Resume specific strategy |
| `GET` | `/control/kill-events` | Audit log (`?limit=100`) |

---

### 6.7 Data

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/data/providers` | Provider capabilities |
| `GET` | `/data/inventory` | Cached data list |
| `GET` | `/data/inventory/{symbol}/{tf}` | Specific cache info |
| `GET` | `/data/search` | Ticker search (`?q=&provider=`) |
| `POST` | `/data/fetch` | Fetch single symbol |
| `POST` | `/data/fetch-many` | Batch fetch |
| `DELETE` | `/data/cache/{symbol}/{tf}` | Clear cache |

---

### 6.8 ML

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/ml/promote-advice` | Promotion recommendation |

---

### 6.9 WebSocket

```
ws://localhost:8000/ws

Client sends:  any text (heartbeat)
Server sends:  {"type": "pong", "data": "<echoed>"}

Future events to broadcast:
  {"type": "trade_filled", "data": {...}}
  {"type": "kill_switch_activated", "data": {...}}
  {"type": "position_updated", "data": {...}}
```

---

## 7. Data Models & Database Schema

### 7.1 strategies

```sql
CREATE TABLE strategies (
  id          TEXT PRIMARY KEY,          -- UUID v4
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL DEFAULT 'custom',
  status      TEXT NOT NULL DEFAULT 'active',
  tags        TEXT NOT NULL DEFAULT '[]',-- JSON array
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_strategies_name ON strategies(name);
```

### 7.2 strategy_versions

```sql
CREATE TABLE strategy_versions (
  id                    TEXT PRIMARY KEY,
  strategy_id           TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version               INTEGER NOT NULL DEFAULT 1,
  config                TEXT NOT NULL DEFAULT '{}',   -- JSON StrategyConfig
  notes                 TEXT,
  created_by            TEXT NOT NULL DEFAULT 'system',
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  promoted_from_run_id  TEXT,
  promotion_status      TEXT NOT NULL DEFAULT 'backtest_only'
  -- promotion_status: backtest_only | paper_approved | live_approved
);
CREATE INDEX idx_strategy_versions_strategy_id ON strategy_versions(strategy_id);
```

### 7.3 accounts

```sql
CREATE TABLE accounts (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  mode                    TEXT NOT NULL DEFAULT 'paper',  -- paper | live
  broker                  TEXT NOT NULL DEFAULT 'paper_broker',
  broker_config_encrypted TEXT,               -- AES-256-GCM encrypted JSON
  initial_balance         REAL NOT NULL DEFAULT 100000,
  current_balance         REAL NOT NULL DEFAULT 100000,
  equity                  REAL NOT NULL DEFAULT 100000,
  unrealized_pnl          REAL NOT NULL DEFAULT 0,
  leverage                REAL NOT NULL DEFAULT 1.0,
  max_position_size_pct   REAL NOT NULL DEFAULT 0.10,
  max_daily_loss_pct      REAL NOT NULL DEFAULT 0.03,
  max_drawdown_lockout_pct REAL DEFAULT 0.10,
  max_open_positions      INTEGER NOT NULL DEFAULT 10,
  is_connected            BOOLEAN NOT NULL DEFAULT 0,
  is_enabled              BOOLEAN NOT NULL DEFAULT 1,
  is_killed               BOOLEAN NOT NULL DEFAULT 0,
  kill_reason             TEXT,
  allowed_symbols         TEXT DEFAULT '[]',  -- JSON array
  blocked_symbols         TEXT DEFAULT '[]',  -- JSON array
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 7.4 deployments

```sql
CREATE TABLE deployments (
  id                           TEXT PRIMARY KEY,
  strategy_id                  TEXT NOT NULL REFERENCES strategies(id),
  strategy_version_id          TEXT NOT NULL REFERENCES strategy_versions(id),
  account_id                   TEXT NOT NULL REFERENCES accounts(id),
  mode                         TEXT NOT NULL,       -- backtest | paper | live
  status                       TEXT NOT NULL DEFAULT 'pending',
  -- status: pending | running | paused | stopped | failed
  config_overrides             TEXT NOT NULL DEFAULT '{}',
  started_at                   TIMESTAMP,
  stopped_at                   TIMESTAMP,
  stop_reason                  TEXT,
  promoted_from_deployment_id  TEXT,
  promoted_from_run_id         TEXT,
  created_at                   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 7.5 deployment_approvals

```sql
CREATE TABLE deployment_approvals (
  id               TEXT PRIMARY KEY,
  deployment_id    TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  from_mode        TEXT NOT NULL,   -- backtest | paper
  to_mode          TEXT NOT NULL,   -- paper | live
  approved_by      TEXT NOT NULL DEFAULT 'user',
  approved_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes            TEXT,
  safety_checklist TEXT NOT NULL DEFAULT '{}'  -- JSON {key: bool}
);
```

### 7.6 backtest_runs

```sql
CREATE TABLE backtest_runs (
  id                   TEXT PRIMARY KEY,
  strategy_version_id  TEXT NOT NULL REFERENCES strategy_versions(id),
  mode                 TEXT NOT NULL DEFAULT 'backtest',
  status               TEXT NOT NULL DEFAULT 'pending',
  -- status: pending | running | completed | failed | cancelled
  symbols              TEXT NOT NULL DEFAULT '[]',   -- JSON array
  timeframe            TEXT NOT NULL DEFAULT '1d',
  start_date           TEXT NOT NULL,
  end_date             TEXT NOT NULL,
  initial_capital      REAL NOT NULL DEFAULT 100000,
  commission_per_share REAL NOT NULL DEFAULT 0.005,
  slippage_ticks       INTEGER NOT NULL DEFAULT 1,
  parameters           TEXT NOT NULL DEFAULT '{}',
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at           TIMESTAMP,
  completed_at         TIMESTAMP,
  error_message        TEXT
);
```

### 7.7 run_metrics

```sql
CREATE TABLE run_metrics (
  id                        TEXT PRIMARY KEY,
  run_id                    TEXT NOT NULL UNIQUE REFERENCES backtest_runs(id) ON DELETE CASCADE,
  total_return_pct          REAL,
  cagr_pct                  REAL,
  sharpe_ratio              REAL,
  sortino_ratio             REAL,
  calmar_ratio              REAL,
  max_drawdown_pct          REAL,
  max_drawdown_duration_days INTEGER,
  recovery_factor           REAL,
  total_trades              INTEGER,
  winning_trades            INTEGER,
  losing_trades             INTEGER,
  win_rate_pct              REAL,
  avg_win_pct               REAL,
  avg_loss_pct              REAL,
  expectancy                REAL,
  profit_factor             REAL,
  avg_hold_days             REAL,
  exposure_pct              REAL,
  long_trades               INTEGER,
  short_trades              INTEGER,
  monthly_returns           TEXT DEFAULT '{}',   -- JSON
  equity_curve              TEXT DEFAULT '[]',   -- JSON [{date,equity,cash,drawdown,regime}]
  exit_reason_breakdown     TEXT DEFAULT '{}',   -- JSON
  regime_breakdown          TEXT DEFAULT '{}',   -- JSON
  monte_carlo               TEXT DEFAULT '{}',   -- JSON
  walk_forward              TEXT DEFAULT '{}'    -- JSON
);
```

### 7.8 trades

```sql
CREATE TABLE trades (
  id                       TEXT PRIMARY KEY,
  run_id                   TEXT NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  strategy_version_id      TEXT,
  symbol                   TEXT NOT NULL,
  direction                TEXT NOT NULL,    -- long | short
  entry_time               TIMESTAMP NOT NULL,
  entry_price              REAL NOT NULL,
  entry_order_type         TEXT DEFAULT 'market',
  initial_quantity         REAL NOT NULL,
  initial_stop             REAL,
  initial_target           REAL,
  exit_time                TIMESTAMP,
  exit_price               REAL,
  exit_quantity            REAL,
  exit_reason              TEXT,
  -- exit_reason: stop_loss | target_1 | target_2 | trailing_stop |
  --              time_exit | reversal | kill_switch | manual
  realized_pnl             REAL,
  commission               REAL DEFAULT 0,
  slippage                 REAL DEFAULT 0,
  net_pnl                  REAL,
  return_pct               REAL,
  r_multiple               REAL,
  is_open                  BOOLEAN DEFAULT 0,
  max_adverse_excursion    REAL,
  max_favorable_excursion  REAL,
  regime_at_entry          TEXT,
  entry_conditions_fired   TEXT DEFAULT '[]',  -- JSON
  tags                     TEXT DEFAULT '[]',  -- JSON
  metadata_                TEXT DEFAULT '{}'   -- JSON
);
CREATE INDEX idx_trades_run_id ON trades(run_id);
CREATE INDEX idx_trades_symbol ON trades(symbol);
```

### 7.9 scale_events

```sql
CREATE TABLE scale_events (
  id            TEXT PRIMARY KEY,
  trade_id      TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,    -- scale_in | scale_out
  time          TIMESTAMP NOT NULL,
  price         REAL NOT NULL,
  quantity      REAL NOT NULL,
  quantity_pct  REAL NOT NULL,
  reason        TEXT,
  new_stop      REAL,
  realized_pnl  REAL
);
CREATE INDEX idx_scale_events_trade_id ON scale_events(trade_id);
```

### 7.10 kill_switch_events

```sql
CREATE TABLE kill_switch_events (
  id           TEXT PRIMARY KEY,
  timestamp    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  action       TEXT NOT NULL,    -- kill | pause | resume
  scope        TEXT NOT NULL,    -- global | account | strategy
  scope_id     TEXT,             -- account_id or strategy_id
  reason       TEXT,
  triggered_by TEXT DEFAULT 'user'
);
```

### 7.11 market_events

```sql
CREATE TABLE market_events (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,    -- fomc | cpi | nfp | earnings | other
  symbol     TEXT,             -- e.g., AAPL for earnings
  event_time TIMESTAMP NOT NULL,
  impact     TEXT NOT NULL DEFAULT 'medium',  -- high | medium | low
  source     TEXT DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 8. Strategy Configuration Schema

```yaml
# Full annotated StrategyConfig schema

name: string                    # display name
category: momentum | mean_reversion | breakout | volatility | custom
description: string

# Universe
symbols: [string]               # ["SPY", "QQQ"]
timeframe: 1m|5m|15m|30m|1h|2h|4h|1d|1wk|1mo

# Indicators to compute (must declare before using in conditions)
indicators:
  ema_periods: [int]            # [21, 55, 200] → generates ema_21, ema_55, ema_200
  sma_periods: [int]            # [50, 200]
  rsi_periods: [int]            # [14]
  atr_periods: [int]            # [14] (computed automatically for stops)
  bb_periods: [int]             # [20] → bb_upper, bb_middle, bb_lower
  adx_periods: [int]            # [14]

# Entry logic
entry:
  directions: [long, short]     # which directions allowed
  logic: all_of | any_of | n_of_m:N
  conditions:
    - type: single
      left:
        field: close|open|high|low|volume
        # OR
        indicator: ema_21       # any declared indicator name
        # OR
        prev_bar: close         # previous bar's field
        n_bars_back: 1
        # OR
        literal: 50             # constant value
      op: >|>=|<|<=|==|!=|crosses_above|crosses_below|between|in
      right:                    # same structure as left

    - type: all_of              # nested group
      conditions: [...]

    - type: any_of
      conditions: [...]

    - type: n_of_m
      n: 3
      conditions: [...]

    - type: regime_filter
      allowed: [trending_up, trending_down, ranging, low_volatility, high_volatility]

    - type: not
      condition: {type: single, ...}

# Stop loss
stop_loss:
  method: fixed_pct|fixed_dollar|atr_multiple|swing_low|n_bars_low|chandelier|fvg_low|combined
  value: float                  # % or $ depending on method
  period: int                   # atr/chandelier period
  mult: float                   # multiplier for atr-based stops
  lookback: int                 # bars back for swing_low
  n: int                        # bars back for n_bars_low
  # For combined:
  rule: farthest|closest        # which stop to use
  stops: [StopConfig]           # list of sub-stops

# Profit targets (list, executed in order)
targets:
  - method: r_multiple|fixed_pct|fixed_dollar|atr_multiple
    r: float                    # for r_multiple
    value: float                # for fixed methods
    period: int                 # for atr_multiple
    mult: float                 # for atr_multiple

# Trailing stop (applied after target 1 hit, or immediately)
trailing_stop:
  method: none|chandelier|atr|percent
  period: int
  mult: float
  value: float                  # for percent method

# Scale into position
scale_in:
  max_adds: int                 # maximum number of adds (default: 2)
  conditions: [Condition]       # entry conditions for each add
  levels:                       # position allocation per level
    - level: 0                  # initial entry
      pct: 60                   # 60% of full position
    - level: 1                  # first add
      pct: 25
    - level: 2                  # second add
      pct: 15

# Scale out of position
scale_out:
  move_stop_to_be_after_t1: bool  # move stop to break-even after T1
  levels:
    - pct: 50                   # exit 50% at T1
    - pct: 50                   # exit remaining 50% at T2

# Position sizing
position_sizing:
  method: risk_pct|fixed_shares|fixed_amount|pct_equity
  risk_pct: float               # % of equity to risk per trade (0.01 = 1%)
  shares: int                   # for fixed_shares
  amount: float                 # for fixed_amount ($)
  pct: float                    # for pct_equity

# Leverage
leverage: float                 # 1.0 = no leverage, 2.0 = 2x

# Risk controls (hard limits, enforced pre-entry)
risk:
  max_position_size_pct: float  # max % of portfolio in one position
  max_daily_loss_pct: float     # lockout for the day if hit
  max_drawdown_lockout_pct: float # lockout until next session if hit
  max_open_positions: int       # concurrent positions cap
  max_portfolio_heat: float     # total risk (sum of position risks)

# Regime filter (computed from 200-period SMA + ADX + ATR)
regime_filter:
  allowed: [trending_up, trending_down, ranging, low_volatility, high_volatility]

# Cooldown rules
cooldown_rules:
  - trigger: stop_out|consecutive_loss|daily_loss_hit|time_of_day
    consecutive_count: int      # for consecutive_loss trigger
    duration_minutes: int       # cooldown duration
    duration_bars: int          # alternative: bar-based cooldown
    session_reset: bool         # if true, cooldown resets at session start
    symbol_level: bool          # if true, cooldown is per-symbol not global

# Event filter (avoids trading around high-impact events)
event_filter:
  categories: [fomc, cpi, nfp, earnings]
  impact_levels: [high, medium]
  minutes_before: 30
  minutes_after: 30
  disable_entries: bool         # if true, no new entries in window
```

---

## 9. Free Market Data Sources

### 9.1 Currently Integrated

| Provider | Status | Coverage | Timeframes | History | Cost |
|----------|--------|----------|------------|---------|------|
| **yfinance** | Integrated | US equities, ETFs, indices, crypto, forex | 1m, 5m, 15m, 30m, 60m, 1d, 1wk, 1mo | 5yr+ daily, 60d intraday | Free |
| **yahooquery** | Integrated | Same as yfinance, ticker search | Same | Same | Free |
| **Alpaca** | Integrated | US equities + ETFs | 1m, 5m, 15m, 30m, 1h, 1d | 5yr+ daily, 2yr intraday | Free (paper), Paid (live history) |

### 9.2 Free Sources to Add (Backlog)

| Provider | Data Type | Free Tier | API Docs |
|----------|-----------|-----------|----------|
| **Alpha Vantage** | Stocks, forex, crypto, fundamentals | 25 calls/day, 5/min | `alphavantage.co` |
| **Polygon.io** | US stocks, options, indices | Unlimited delayed (15min), 5 calls/min | `polygon.io` |
| **FRED (St. Louis Fed)** | Macro: GDP, CPI, rates, VIX, yield curve | Unlimited | `fred.stlouisfed.org/docs/api` |
| **Quandl / Nasdaq Data Link** | Futures, commodities, fundamentals | Limited free | `data.nasdaq.com` |
| **Tiingo** | EOD stocks, crypto, news | 500 calls/hr free | `tiingo.com/documentation` |
| **OpenFIGI** | Ticker → FIGI mapping | 250 calls/min | `openfigi.com/api` |
| **IEX Cloud** | US stocks, fundamentals | 50k messages/mo free | `iexcloud.io` |
| **CoinGecko** | Crypto OHLCV, market cap | Unlimited public API | `coingecko.com/api` |
| **CBOE Options Data** | Options chains, VIX term structure | Free delayed | `cboe.com/delayed_quotes` |
| **SEC EDGAR** | 10-K, 10-Q, earnings dates, insider filings | Unlimited | `sec.gov/edgar/sec-api-documentation` |
| **World Bank API** | GDP, inflation, country data | Unlimited | `datahelpdesk.worldbank.org` |
| **TradingEconomics** | 300+ macro indicators | Very limited free | `tradingeconomics.com/api` |
| **Stooq** | Historical OHLCV, global markets | Free unlimited | Via pandas-datareader |

### 9.3 Recommended Integration Priority

```
Priority 1 — High value, easy to add:
  ├── Polygon.io     → delayed real-time quotes in UI, options data
  ├── FRED           → macro overlay on charts (yield curve, VIX)
  └── Alpha Vantage  → fundamentals (P/E, EPS) on strategy cards

Priority 2 — Enhances analysis:
  ├── Tiingo         → extended intraday history (2yr free)
  ├── CoinGecko      → crypto strategy support
  └── SEC EDGAR      → earnings calendar auto-population

Priority 3 — Advanced:
  ├── CBOE           → options overlay, IV charts
  └── World Bank     → macro regime context
```

### 9.4 Data Provider Interface (for implementation)

```python
# backend/app/data/providers/base.py
class DataProvider(ABC):
    name: str
    supported_timeframes: list[str]
    intraday_max_days: int
    max_history_years: int
    requires_credentials: bool

    @abstractmethod
    async def fetch(
        self,
        symbol: str,
        timeframe: str,
        start: date,
        end: date,
        api_key: str | None = None,
        secret_key: str | None = None,
    ) -> pd.DataFrame:   # columns: open, high, low, close, volume; index: datetime
        ...

    @abstractmethod
    async def search(self, query: str) -> list[dict]:
        # returns: [{symbol, name, type, exchange}]
        ...
```

---

## 10. UX Backlog — Trading & UX Expert Recommendations

> Items below are prioritized backlog additions that a UX designer + experienced trader would identify as high-impact gaps. Each item includes the **why** from a trading perspective and **how** from a UX perspective.

---

### 10.1 Critical UX Gaps (P0 — Do First)

#### BL-001: Global Error Boundary with Recovery UI
**Problem:** Any React render error causes a blank page with no recovery path.
**Trading Risk:** Trader stuck on blank screen during live market hours.
**Fix:** Wrap `<App>` in an `<ErrorBoundary>` that renders a safe fallback with:
- Error message + stack trace (expandable)
- [Reload Page] button
- Kill switch status (always visible, even in error state)
- [Go to Dashboard] link

#### BL-002: Real-time WebSocket Push for Live Data
**Problem:** Live Monitor polls every 8-10s. In fast markets, positions move significantly between polls.
**Trading Value:** Missed stop-outs, stale P&L, delayed kill switch events.
**Fix:** Push position updates, order fills, and kill events over WebSocket. Frontend subscribes and merges into TanStack Query cache.

#### BL-003: Persistent Kill Switch State Warning on Reload
**Problem:** If kill switch is active and user navigates away, they may not notice it's still active.
**Trading Risk:** Thinking trading is live when it's killed.
**Fix:** Persist kill switch state in `localStorage`. On page load, show a modal overlay if kill switch was active before reload: "⚠️ Kill switch was active when you last visited. Check status before trading."

#### BL-004: Port Conflict Detection and Documentation
**Problem:** Multiple backends from different projects silently compete for port 8000, causing schema mismatch (wrong field names served to UI).
**Fix:** `npm run dev` script should first `curl http://localhost:8000/api/v1/platform/info` and validate `service === "ultratrader-2026"`. If mismatch, abort with a clear error message. Add `start:backend` npm script that checks and starts the correct backend.

#### BL-005: Account Balance Staleness Indicator
**Problem:** Account balances refresh every 20s but show no age indicator. Trader can't tell if data is fresh.
**Fix:** Show "Last updated: 12s ago" with color coding: <30s green, <60s amber, >60s red with auto-refresh button.

---

### 10.2 High-Impact UX Improvements (P1)

#### BL-006: Strategy Performance Comparison View
**Trading Value:** Traders need to compare strategy variants side-by-side before choosing which to deploy.
**UX:** Side-by-side metric table + overlaid equity curves on same chart. Accessible from Run History with multi-select checkboxes.
**API:** `POST /backtests/{id}/compare` already exists — needs frontend.

#### BL-007: Pre-Market Checklist Modal
**Why:** Professional traders do a pre-market routine. Prompt them to review risk settings, positions, and news before market open.
**UX:** At 9:00 AM ET, if Live deployments exist, show a modal:
```
Pre-Market Check (9:00 AM)
─────────────────────────
☐ Reviewed overnight gaps
☐ Checked economic calendar (3 high-impact events today)
☐ Verified account balances
☐ Confirmed kill switch is OFF
[Start Trading Day]
```

#### BL-008: Position Sizing Calculator (Interactive)
**Trading Value:** Traders want to see how position size changes with different risk % / account size / stop distance before entering.
**UX:** Floating panel accessible from the strategy config page and run details:
- Input: Account equity, Risk %, Stop distance ($ or %)
- Output: Shares, Dollar amount, % of portfolio, R-value
- Updates live as user types

#### BL-009: Equity Curve Drawdown Period Highlighting
**Trading Value:** Seeing WHERE in time drawdowns occurred (around FOMC? March 2020?) gives context to evaluate strategy robustness.
**UX:** Overlay `market_events` from the events table as vertical bands on the equity curve chart. Toggle on/off. Hover shows event name + impact.

#### BL-010: Mobile-Responsive Sidebar (Hamburger Menu)
**Problem:** Sidebar is always visible at w-56 and collapses content on small screens.
**UX:** On screens <768px, sidebar becomes a hamburger menu overlay. Header shows [☰] button. Sidebar slides in from left with backdrop.

#### BL-011: Strategy Config Diff Viewer
**Trading Value:** When creating v2 of a strategy, trader needs to see exactly what changed vs v1.
**UX:** In Strategy Details, selecting two versions shows a side-by-side diff with:
- Added fields (green highlight)
- Removed fields (red strikethrough)
- Changed values (amber)

#### BL-012: One-Click Strategy Duplication
**Problem:** Creating a new strategy always starts from blank. Iterating on an existing strategy is slow.
**UX:** [Duplicate] button on strategy cards and detail page. Creates a copy with name "Copy of {name}" and resets promotion_status to `backtest_only`.

#### BL-013: Backtest Benchmark Comparison
**Trading Value:** Without benchmark comparison, a 10% return could be great (if S&P was -5%) or poor (if S&P was +30%).
**UX:** In Run Details Equity tab, overlay SPY buy-and-hold equity curve in dashed gray. Show alpha metric: `strategy_return - benchmark_return`.
**Backend:** Auto-fetch SPY for same period when backtest completes.

#### BL-014: Intraday Data Warning on Strategy Builder
**Problem:** A strategy defined on `1m` timeframe will fail with yfinance if backtesting data >60 days. User finds out only at launch.
**UX:** In Strategy Creator, if timeframe is intraday (`< 1d`), show persistent amber warning in the Timeframe field:
```
⚠️ Intraday backtest limited to last 60 days with yfinance.
   Use Alpaca provider for up to 2 years of intraday data.
```

#### BL-015: Keyboard Shortcuts
**Trading Value:** Speed matters. Heavy users should navigate without mouse.
**Shortcuts to implement:**
```
K → Toggle Kill Switch (with confirm)
D → Dashboard
S → Strategies
B → Backtest
R → Run History
M → Live Monitor
A → Accounts
? → Show shortcuts modal
```

---

### 10.3 Trading Intelligence Features (P2)

#### BL-016: Risk-of-Ruin Calculator
**Trading Value:** Given win rate, avg win/loss, and account size, shows probability of blowing up account.
**UX:** In Run Details sidebar — shows "Risk of Ruin: 2.3%" with formula explanation. Color: <5% green, 5-20% amber, >20% red.

#### BL-017: Walk-Forward Analysis View
**Trading Value:** In-sample optimization can overfit. Walk-forward shows how strategy performs out-of-sample.
**Backend:** `walk_forward` field exists in `run_metrics` schema — needs engine + UI.
**UX:** Timeline chart: alternating in-sample (gray) / out-of-sample (sky) periods, each with its own return bar.

#### BL-018: Regime Detection Dashboard
**Trading Value:** Strategy performance varies dramatically by market regime (trending vs ranging). Traders need to know current regime.
**UX:** Dedicated section on Dashboard or Monitor page:
- Current regime for each watched symbol
- Regime history chart (color-coded background on price chart)
- Which strategies are regime-appropriate right now
**API:** `GET /api/v1/regime/{symbol}` → `{regime, confidence, adx, sma_slope}`

#### BL-019: Parameter Sensitivity Analysis (Heatmap)
**Trading Value:** Shows how robust a strategy is to small parameter changes (e.g., EMA period 19 vs 21 vs 23).
**UX:** 2D heatmap: X = param1 range, Y = param2 range, color = Sharpe ratio. Highlights "islands" of robustness vs fragile local maxima.

#### BL-020: Live Trade Alerts (Browser Notifications)
**Trading Value:** Trader doesn't need to watch the screen — gets notified of fills, stops, and kill events.
**UX:** Request `Notification` permission on first visit. Push notifications for:
- Order filled (symbol, direction, price)
- Stop loss triggered
- Kill switch activated
- Daily loss limit hit
**Backend:** Emit WebSocket events → frontend shows browser notification.

#### BL-021: Multi-Strategy Portfolio View
**Trading Value:** Running 3 strategies on 4 symbols creates correlated risk. Portfolio-level view shows aggregate exposure.
**UX:** Dashboard card: "Portfolio Heat Map" — grid of symbols × strategies showing position size and P&L.

#### BL-022: Trade Replay Mode
**Trading Value:** After a bad trade, trader wants to replay exactly what signals fired and why the trade was taken.
**UX:** In Trade Journal, click any trade → opens replay panel:
- Price chart for trade period
- Indicator overlays matching strategy config
- Entry/exit markers
- Conditions that fired (green check / red X)
- Regime at entry

#### BL-023: Automatic Event Calendar Population
**Trading Value:** Manually entering FOMC/CPI/NFP dates is tedious and error-prone.
**UX:** [Sync Events] button on Event Calendar page → fetches from free sources:
- FRED for FOMC dates
- BLS for CPI/NFP release calendar
- SEC EDGAR for earnings dates (for any symbols in active strategies)
**Backend:** `POST /api/v1/events/sync` → auto-populates from APIs.

#### BL-024: Drawdown Recovery Time Estimation
**Trading Value:** "If I'm in a 15% drawdown, how long will it realistically take to recover?"
**UX:** In Run Details Overview, below max drawdown card:
- "Historical avg recovery: 32 days"
- "Worst recovery: 87 days"
- Derived from the run's actual equity curve drawdown periods

---

### 10.4 Infrastructure & DevX (P3)

#### BL-025: Single Start Script
**Problem:** Starting the platform requires: start backend (right venv, right port), start frontend (which port?), know the proxy is configured.
**Fix:** `start.sh` / `start.bat` at project root:
```bash
#!/bin/bash
# 1. Check port 8080 is free (kill ultratrader backend if stale)
# 2. Start backend: .venv/Scripts/python -m uvicorn ...
# 3. Wait for health check
# 4. Start frontend: npm run dev
# 5. Open browser to localhost:5176
echo "UltraTrader 2026 started"
echo "  Backend:  http://localhost:8080"
echo "  Frontend: http://localhost:5176"
echo "  API Docs: http://localhost:8080/docs"
```

#### BL-026: FastAPI Swagger/OpenAPI Docs Page
**Problem:** `/docs` returns 404 because Swagger is disabled in production config.
**Fix:** Enable in DEBUG mode: `FastAPI(docs_url="/docs" if settings.DEBUG else None)`. Links to it from the app sidebar footer.

#### BL-027: Database Backup & Restore UI
**Problem:** `ultratrader.db` can be accidentally deleted (it's the only persistence layer in dev mode).
**UX:** In Settings page (new route `/settings`):
- [Download Backup] → downloads `ultratrader_backup_{timestamp}.db`
- [Restore from Backup] → file upload → validates schema → replaces DB
- Auto-backup: configurable, saves to `backend/data/backups/`

#### BL-028: Onboarding Flow for New Users
**Problem:** A new user opening the app sees an empty dashboard with no guidance on where to start.
**UX:** First-run detection (no strategies, no backtests). Show a step-by-step onboarding wizard:
```
Step 1: Create your first strategy  → /strategies/new
Step 2: Download historical data    → /data
Step 3: Run your first backtest     → /backtest
Step 4: Analyze results             → /runs
Step 5: Set up paper trading        → /accounts
```
Persistent progress indicator until all 5 steps done.

#### BL-029: Theme Toggle (Dark/Light)
**UX:** Small moon/sun icon in header. Light theme for users who prefer it (especially outdoor use on bright screens). Save preference in `localStorage`.

#### BL-030: Strategy Export / Import (JSON/YAML)
**Problem:** No way to share strategies between instances or back them up separately from the DB.
**UX:** In Strategy Details:
- [Export YAML] → downloads strategy config as `.yaml`
- In Strategies list: [Import Strategy] → uploads YAML → creates new strategy

---

### 10.5 Summary Backlog Table

| ID | Feature | Priority | Effort | Trading Value |
|----|---------|----------|--------|---------------|
| BL-001 | Error boundary with recovery | P0 | S | Critical safety |
| BL-002 | WebSocket real-time push | P0 | L | Live trading accuracy |
| BL-003 | Kill switch persistence warning | P0 | S | Safety |
| BL-004 | Port conflict detection | P0 | S | Developer safety |
| BL-005 | Balance staleness indicator | P0 | S | Trust/accuracy |
| BL-006 | Strategy comparison view | P1 | M | Research efficiency |
| BL-007 | Pre-market checklist | P1 | M | Discipline |
| BL-008 | Position sizing calculator | P1 | M | Risk management |
| BL-009 | Drawdown period event overlay | P1 | M | Context |
| BL-010 | Mobile sidebar | P1 | M | Accessibility |
| BL-011 | Strategy config diff viewer | P1 | M | Iteration speed |
| BL-012 | One-click strategy duplicate | P1 | S | Workflow |
| BL-013 | Benchmark comparison | P1 | M | Performance context |
| BL-014 | Intraday data warning | P1 | S | Error prevention |
| BL-015 | Keyboard shortcuts | P1 | S | Power user UX |
| BL-016 | Risk-of-ruin calculator | P2 | S | Risk awareness |
| BL-017 | Walk-forward analysis view | P2 | L | Strategy validation |
| BL-018 | Regime detection dashboard | P2 | L | Market context |
| BL-019 | Parameter sensitivity heatmap | P2 | L | Optimization |
| BL-020 | Live trade browser alerts | P2 | M | Monitoring |
| BL-021 | Multi-strategy portfolio view | P2 | L | Portfolio risk |
| BL-022 | Trade replay mode | P2 | L | Post-trade analysis |
| BL-023 | Auto event calendar sync | P2 | M | Workflow |
| BL-024 | Drawdown recovery estimation | P2 | S | Expectation setting |
| BL-025 | Single start script | P3 | S | DevX |
| BL-026 | Swagger docs in DEBUG mode | P3 | S | DevX |
| BL-027 | DB backup/restore UI | P3 | M | Data safety |
| BL-028 | Onboarding wizard | P3 | M | User adoption |
| BL-029 | Light/dark theme toggle | P3 | M | Accessibility |
| BL-030 | Strategy YAML import/export | P3 | S | Portability |

**Effort:** S = 1-4 hrs · M = 1-2 days · L = 3-5 days

---

*Generated: 2026-04-10 · UltraTrader 2026 v1.0.0*
*Document covers: PRD, Site Map, Design System, Page Specs, Component Library, Full API, DB Schema, Strategy Config, 9 Free Data Sources, 30 UX Backlog Items*
