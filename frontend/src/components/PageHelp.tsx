import React, { useState } from 'react'
import { Info, X, ArrowRight } from 'lucide-react'
import clsx from 'clsx'

// ─── Registry ─────────────────────────────────────────────────────────────────

interface PageHelpEntry {
  title: string
  what: string
  flow: string[]          // breadcrumb steps; current page is bolded by convention
  actions: string[]       // key things you can do here
}

const REGISTRY: Record<string, PageHelpEntry> = {
  strategies: {
    title: 'Strategies',
    what: 'Define the logic for entering and exiting trades. A strategy captures indicators, conditions, stop-loss rules, profit targets, and position sizing. Each save creates a new version — older versions are never deleted.',
    flow: ['Build', '→ Strategies', '→ Sim Lab', '→ Backtest', '→ Optim Lab'],
    actions: [
      'Create a new strategy with entry & exit rules',
      'Version strategies — edit without losing history',
      'Run directly to Sim Lab or Backtest from here',
      'Tag strategies by style (day / swing / position)',
    ],
  },
  simlab: {
    title: 'Sim Lab',
    what: 'Step through a strategy bar-by-bar using the same engine as Backtest. Use this to verify that your indicators are computing correctly — compare VWAP, RSI, fractals, and opening range levels against ThinkOrSwim before running a full backtest.',
    flow: ['Strategies', '→ Sim Lab', '→ Backtest', '→ Optim Lab'],
    actions: [
      'Validate indicator values match external charting tools',
      'Watch entries and exits fire in real time',
      'Inspect open positions, stop levels, and regime classification',
      'Run from a Strategy version OR a saved Program',
    ],
  },
  backtest: {
    title: 'Backtest',
    what: 'Run a strategy across a full symbol universe and date range. Produces a complete performance report: returns, Sharpe, drawdown, trade log, regime breakdown, and walk-forward fold analysis. This is the core research engine.',
    flow: ['Sim Lab', '→ Backtest', '→ Run History', '→ Optim Lab'],
    actions: [
      'Select symbols, timeframe, and date range',
      'Enable Walk-Forward Analysis for out-of-sample validation',
      'Run Param Search to find optimal indicator settings',
      'Results flow automatically into Optim Lab',
    ],
  },
  runhistory: {
    title: 'Run History',
    what: 'All completed backtest runs. Each run stores full metrics, trade log, equity curve, monthly returns, and regime breakdown. Click any run to see the full analysis and generate a Risk Profile or create a Program.',
    flow: ['Backtest', '→ Run History', '→ Optim Lab', '→ Programs'],
    actions: [
      'Browse and filter completed runs by strategy and metrics',
      'View trade log, equity curve, and regime suitability',
      'Generate a Risk Profile from backtest statistics',
      'Navigate directly to "Create Program" from a good run',
    ],
  },
  optimlab: {
    title: 'Optim Lab',
    what: 'Curate and compare backtest results. The Results tab ranks runs by risk-adjusted metrics. Walk-Forward Analysis shows out-of-sample consistency. Param Search tunes strategy parameters. Paper → Live promotes winners to a live account.',
    flow: ['Run History', '→ Optim Lab', '→ Programs', '→ Deploy'],
    actions: [
      'Results: compare runs, hide overfit, multi-select to deploy to paper',
      'Walk-Forward Analysis: review OOS Sharpe per fold and consistency score',
      'Param Search: grid-search over ATR multipliers, RSI periods, R targets',
      'Paper → Live: promote paper deployments after completing safety checklist',
    ],
  },
  programs: {
    title: 'Programs',
    what: 'A Program packages a strategy version, watchlist, risk profile, and execution policy into a deployable trading package. It stays editable while undeployed, then locks automatically while it is allocated to an account.',
    flow: ['Optim Lab', '→ Programs', '→ Deploy'],
    actions: [
      'Create a Program linking strategy version + watchlist + risk profile',
      'Set execution policy: order type, fill model, time-in-force',
      'Freeze the program before allocating to a Governor account',
      'Clone a program to create a new version with changes',
    ],
  },
  deploy: {
    title: 'Portfolio Governor',
    what: 'The Portfolio Governor is the final internal authority before broker execution. It runs every 60 seconds: refreshes universes, evaluates signals, checks symbol conflicts and correlations, enforces the Risk Profile, and submits approved orders. Add Programs to a running governor without stopping it.',
    flow: ['Programs', '→ Deployments', '→ Live Monitor'],
    actions: [
      'View governor status: active / halted / paused',
      'Add a deployable Program to a running governor (hot-add)',
      'Halt All — instantly stops all trading on this account',
      'View governor event log: collisions, risk blocks, universe updates',
    ],
  },
  monitor: {
    title: 'Live Monitor',
    what: 'Real-time view of all active Alpaca deployments (paper and live). Shows current positions, open orders, and unrealized P&L for each running program. Data refreshes every 5 seconds direct from the Alpaca broker API.',
    flow: ['Deploy', '→ Live Monitor'],
    actions: [
      'Watch positions open and close in real time',
      'See current prices and unrealized P&L per symbol',
      'View open orders and fill status',
      'For trade history: go to Run History. For governor events: go to Deploy.',
    ],
  },
  watchlists: {
    title: 'Watchlists',
    what: 'Watchlists define the symbol universe a Program trades. Golden templates are pre-configured industry-standard lists — duplicate them to create your own. Programs subscribe to one or more watchlists; the Governor resolves the live universe on each tick.',
    flow: ['Build', '→ Watchlists', '→ Programs', '→ Deploy'],
    actions: [
      'Create manual watchlists or use golden templates',
      'Duplicate a golden template to customize it',
      'Programs can subscribe to multiple watchlists (union / intersection)',
      'Watchlists in use by Programs are protected from deletion',
    ],
  },
  riskprofiles: {
    title: 'Risk Profiles',
    what: 'Risk Profiles define account-level trading ceilings: max open positions (long/short), portfolio heat, daily loss limit, drawdown lockout, and max leverage. Attach a profile to an Account or Governor. Golden templates are tagged by trading style.',
    flow: ['Build', '→ Risk Profiles', '→ Programs / Governor', '→ Deploy'],
    actions: [
      'Choose a golden template (Day Trader / Swing / Position) as your starting point',
      'Duplicate and customize — originals are read-only',
      'Attach to an Account so the Governor inherits it automatically',
      'Generate a Risk Profile from backtest statistics in Run History',
    ],
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PageHelpProps {
  page: keyof typeof REGISTRY
}

export function PageHelp({ page }: PageHelpProps) {
  const [open, setOpen] = useState(false)
  const entry = REGISTRY[page]
  if (!entry) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="ml-2 text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0"
        title="Page help"
        aria-label="Open page help"
      >
        <Info size={15} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* Drawer */}
          <div className={clsx(
            'fixed right-0 top-0 h-full z-50 w-[380px] bg-gray-950 border-l border-gray-800',
            'flex flex-col shadow-2xl',
          )}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div className="flex items-center gap-2 text-gray-200 font-semibold">
                <Info size={15} className="text-sky-400" />
                {entry.title}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-300"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-sm">

              {/* What it does */}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-semibold">What this page does</div>
                <p className="text-gray-300 leading-relaxed">{entry.what}</p>
              </div>

              {/* Workflow position */}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-semibold">Where it fits</div>
                <div className="flex items-center flex-wrap gap-1 text-xs">
                  {entry.flow.map((step, i) => (
                    <span
                      key={i}
                      className={clsx(
                        'px-2 py-0.5 rounded',
                        step.startsWith('→') ? 'text-gray-600 font-mono text-[11px]' :
                        i === 1 ? 'bg-sky-900/60 text-sky-300 ring-1 ring-sky-700 font-medium' :
                        'text-gray-500',
                      )}
                    >
                      {step}
                    </span>
                  ))}
                </div>
              </div>

              {/* Key actions */}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 font-semibold">Key actions</div>
                <ul className="space-y-1.5">
                  {entry.actions.map((action, i) => (
                    <li key={i} className="flex items-start gap-2 text-gray-400">
                      <ArrowRight size={12} className="text-sky-600 mt-0.5 flex-shrink-0" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
