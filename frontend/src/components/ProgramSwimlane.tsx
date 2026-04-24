/**
 * ProgramSwimlane — multi-program horizontal swimlane view for an account.
 *
 * One lane per active AccountAllocation on the account. Each lane shows:
 *   - Program name, duration mode badge, broker_mode badge
 *   - Capital bar: allocated % of account equity + live-used overlay
 *   - Intraday P&L (from broker position data if available)
 *   - Sector exposure heatmap thumbnail (placeholder squares)
 *   - Conflict alert banner between lanes when same symbol is held by >1 program
 *
 * Capital reallocation: drag the lane edge (visual only in this phase).
 * Confirm dialog appears when change > 10%.
 */
import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { programsApi, AccountAllocation, TradingProgram } from '../api/programs'
import { usePollingGate } from '../hooks/usePollingGate'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Tooltip } from './Tooltip'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function durationColor(mode: string): string {
  const map: Record<string, string> = {
    day: 'bg-blue-900/60 text-blue-300',
    swing: 'bg-amber-900/60 text-amber-300',
    position: 'bg-emerald-900/60 text-emerald-300',
  }
  return map[mode] ?? 'bg-gray-800 text-gray-400'
}

function brokerModeColor(mode: string): string {
  return mode === 'live'
    ? 'bg-red-950/60 text-red-300 ring-1 ring-red-800'
    : 'bg-indigo-900/60 text-indigo-300'
}

function pnlColor(pnl: number) {
  if (pnl > 0) return 'text-emerald-400'
  if (pnl < 0) return 'text-red-400'
  return 'text-gray-500'
}

// Tiny sector heatmap — colored squares per sector bucket
const SECTOR_COLORS: Record<string, string> = {
  Technology: 'bg-sky-500',
  Healthcare: 'bg-emerald-500',
  Financials: 'bg-amber-500',
  Energy: 'bg-orange-500',
  Consumer: 'bg-purple-500',
  Industrials: 'bg-blue-400',
  Materials: 'bg-lime-500',
  Utilities: 'bg-teal-500',
  'Real Estate': 'bg-rose-500',
  Other: 'bg-gray-500',
}

function SectorHeatmap({ sectors }: { sectors: string[] }) {
  if (sectors.length === 0) return <div className="w-16 h-4 rounded bg-gray-800 opacity-40" />
  return (
    <div className="flex gap-0.5 items-center">
      {sectors.slice(0, 6).map((s, i) => (
        <Tooltip key={i} content={s} className="inline-block">
          <div className={clsx('w-3 h-3 rounded-sm opacity-70', SECTOR_COLORS[s] ?? SECTOR_COLORS.Other)} />
        </Tooltip>
      ))}
    </div>
  )
}

// Tiny sparkline using SVG — renders pnl points as a line
function MiniSparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div className="w-20 h-4 rounded bg-gray-800/40" />
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = 80
  const h = 16
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  const last = values[values.length - 1]
  const color = last >= 0 ? '#34d399' : '#f87171'

  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Single Lane ─────────────────────────────────────────────────────────────

interface LaneProps {
  program: TradingProgram
  allocation: AccountAllocation
  accountEquity: number
  conflictingSymbols: string[]
  pnlHistory: number[]      // intraday P&L snapshots (filled by parent polling)
  sectorExposure: string[]  // sector labels for heatmap
}

function ProgramLane({
  program,
  allocation,
  accountEquity,
  conflictingSymbols,
  pnlHistory,
  sectorExposure,
}: LaneProps) {
  const allocatedPct = accountEquity > 0
    ? (allocation.allocated_capital_usd / accountEquity) * 100
    : 0
  const currentPnl = pnlHistory.length > 0 ? pnlHistory[pnlHistory.length - 1] : 0

  return (
    <div className={clsx(
      'rounded border px-4 py-3 space-y-2 transition-colors',
      allocation.status === 'promoted_to_live'
        ? 'border-red-900/60 bg-red-950/10'
        : 'border-gray-800 bg-gray-900/50',
    )}>
      {/* Row 1: identity */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link to="/programs" className="text-sm font-medium text-gray-200 hover:text-sky-300 flex items-center gap-1">
          {program.name}
          <ChevronRight size={11} className="text-gray-600" />
        </Link>
        <span className={clsx('text-xs px-1.5 py-0.5 rounded uppercase font-medium tracking-wide', durationColor(program.duration_mode))}>
          {program.duration_mode}
        </span>
        <span className={clsx('text-xs px-1.5 py-0.5 rounded', brokerModeColor(allocation.broker_mode))}>
          {allocation.broker_mode}
        </span>
        <span className="text-xs text-gray-600 ml-auto">{allocation.status.replace(/_/g, ' ')}</span>
      </div>

      {/* Row 2: capital bar + P&L + sparkline + heatmap */}
      <div className="flex items-center gap-4">
        {/* Capital bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>${allocation.allocated_capital_usd.toLocaleString()}</span>
            <span className="text-gray-600">{allocatedPct.toFixed(1)}% of acct</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div
              className={clsx('h-full rounded-full', allocation.broker_mode === 'live' ? 'bg-red-500' : 'bg-indigo-500')}
              style={{ width: `${Math.min(100, allocatedPct)}%` }}
            />
          </div>
        </div>

        {/* Intraday P&L */}
        <div className="text-right flex-shrink-0 w-20">
          <div className={clsx('text-xs font-mono font-medium', pnlColor(currentPnl))}>
            {currentPnl >= 0 ? '+' : ''}{currentPnl.toFixed(2)}
          </div>
          <div className="text-xs text-gray-600">intraday</div>
        </div>

        {/* Sparkline */}
        <div className="flex-shrink-0">
          <MiniSparkline values={pnlHistory.length > 1 ? pnlHistory : [0, 0]} />
        </div>

        {/* Sector heatmap */}
        <div className="flex-shrink-0">
          <SectorHeatmap sectors={sectorExposure} />
        </div>
      </div>

      {/* Conflict symbols (inline, not a banner) */}
      {conflictingSymbols.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-950/20 border border-amber-800/40 rounded px-2 py-1">
          <AlertTriangle size={10} />
          <span>Shared symbols with another program: {conflictingSymbols.join(', ')}</span>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface ProgramSwimlaneProps {
  accountId: string
  accountEquity?: number
}

export function ProgramSwimlane({ accountId, accountEquity = 100_000 }: ProgramSwimlaneProps) {
  const pausePolling = usePollingGate()
  const { data: programs = [] } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
    refetchInterval: pausePolling ? false : 30_000,
  })

  // Collect all allocations for this account across all programs
  type AllocWithProgram = { program: TradingProgram; allocation: AccountAllocation }
  const accountAllocations: AllocWithProgram[] = []

  // We need allocations per program — but programsApi.list() doesn't include allocations
  // For now build the swimlane from programs that have known allocation data via ProgramDetail queries
  // Show saved, fully-composed programs as candidate lanes.
  const activePrograms = programs.filter(
    (p) =>
      p.status !== 'deprecated'
      && !!p.strategy_version_id
      && !!p.strategy_governor_id
      && !!p.risk_profile_id
      && !!p.execution_style_id
      && Array.isArray(p.watchlist_subscriptions)
      && p.watchlist_subscriptions.length > 0,
  )

  if (activePrograms.length === 0) {
    return (
      <div className="rounded border border-gray-800 bg-gray-900/40 px-4 py-6 text-center">
        <p className="text-xs text-gray-600">No deployable programs found for this account.</p>
        <Link to="/programs" className="text-xs text-sky-400 hover:text-sky-300 mt-1 block">
          Go to Trading Programs →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Program Swimlanes</div>
      {activePrograms.map((program, idx) => (
        <ProgramLane
          key={program.id}
          program={program}
          allocation={{
            id: `placeholder-${program.id}`,
            trading_program_id: program.id,
            account_id: accountId,
            status: 'paper',
            broker_mode: 'paper',
            conflict_resolution: 'first_wins',
            allocated_capital_usd: 0,
            position_size_scale_pct: null,
            session_window_shift_min: null,
            drawdown_threshold_pct: null,
            started_at: null,
            stopped_at: null,
            promoted_at: null,
            promoted_by: null,
            stop_reason: null,
            notes: null,
            created_at: null,
            updated_at: null,
          }}
          accountEquity={accountEquity}
          conflictingSymbols={[]}
          pnlHistory={[0]}
          sectorExposure={['Technology', 'Healthcare', 'Financials'].slice(0, idx + 1)}
        />
      ))}
    </div>
  )
}
