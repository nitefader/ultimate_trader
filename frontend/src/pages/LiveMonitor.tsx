import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { monitorApi, type LiveRun, type RunDetail, type LivePosition, type LiveOrder } from '../api/monitor'
import clsx from 'clsx'
import { RefreshCw, X, AlertTriangle, TrendingUp, TrendingDown, Minus } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  const sign = n >= 0 ? '+' : ''
  return sign + (n * 100).toFixed(decimals) + '%'
}

function pnlClass(n: number | null | undefined): string {
  if (n == null) return 'text-gray-400'
  return n >= 0 ? 'text-green-400' : 'text-red-400'
}

function PnlArrow({ value }: { value: number | null | undefined }) {
  if (value == null) return <Minus size={12} className="text-gray-500" />
  if (value > 0) return <TrendingUp size={12} className="text-green-400" />
  if (value < 0) return <TrendingDown size={12} className="text-red-400" />
  return <Minus size={12} className="text-gray-500" />
}

// ── Tab: Run stat card ────────────────────────────────────────────────────────

function RunTab({
  run,
  active,
  onClick,
  onClose,
}: {
  run: LiveRun
  active: boolean
  onClick: () => void
  onClose: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex items-center gap-2 px-3 py-2 rounded-t border-b-2 text-sm transition-colors whitespace-nowrap group',
        active
          ? 'border-sky-500 bg-gray-900 text-sky-200'
          : 'border-transparent bg-gray-950 text-gray-400 hover:text-gray-200 hover:bg-gray-900',
      )}
    >
      <span className={clsx(
        'w-2 h-2 rounded-full flex-shrink-0',
        run.status === 'running' ? 'bg-green-400 animate-pulse' : 'bg-yellow-400',
      )} />
      <span className="font-medium">{run.strategy_name ?? run.id.slice(0, 8)}</span>
      <span className={clsx(
        'text-xs px-1 rounded',
        run.mode === 'live' ? 'bg-orange-900/60 text-orange-300' : 'bg-blue-900/60 text-blue-300',
      )}>
        {run.mode}
      </span>
      <X
        size={13}
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 flex-shrink-0"
        onClick={e => { e.stopPropagation(); onClose() }}
      />
    </button>
  )
}

// ── Positions table ───────────────────────────────────────────────────────────

function PositionsTable({
  positions,
  deploymentId,
  onClosePosition,
}: {
  positions: LivePosition[]
  deploymentId: string
  onClosePosition: (symbol: string) => void
}) {
  if (positions.length === 0) {
    return <div className="text-sm text-gray-500 py-4 text-center">No open positions</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-gray-500 text-xs">
            <th className="text-left py-2 pr-4">Symbol</th>
            <th className="text-right py-2 pr-4">Side</th>
            <th className="text-right py-2 pr-4">Qty</th>
            <th className="text-right py-2 pr-4">Avg Entry</th>
            <th className="text-right py-2 pr-4">Current</th>
            <th className="text-right py-2 pr-4">Mkt Value</th>
            <th className="text-right py-2 pr-4">Unr. P&L</th>
            <th className="text-right py-2 pr-4">Unr. %</th>
            <th className="text-right py-2">Today</th>
            <th className="py-2 pl-4" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-900">
          {positions.map(p => (
            <tr key={p.symbol} className="hover:bg-gray-900/40 transition-colors">
              <td className="py-2 pr-4 font-mono font-semibold text-gray-100">{p.symbol}</td>
              <td className={clsx('text-right py-2 pr-4 font-medium', p.side === 'long' ? 'text-green-400' : 'text-red-400')}>
                {p.side}
              </td>
              <td className="text-right py-2 pr-4 font-mono text-gray-200">{p.qty?.toFixed(2) ?? '—'}</td>
              <td className="text-right py-2 pr-4 font-mono text-gray-300">{fmt$(p.avg_entry_price)}</td>
              <td className="text-right py-2 pr-4 font-mono text-gray-200">{fmt$(p.current_price)}</td>
              <td className="text-right py-2 pr-4 font-mono text-gray-200">{fmt$(p.market_value)}</td>
              <td className={clsx('text-right py-2 pr-4 font-mono font-medium', pnlClass(p.unrealized_pl))}>
                <span className="flex items-center justify-end gap-1">
                  <PnlArrow value={p.unrealized_pl} />
                  {fmt$(p.unrealized_pl)}
                </span>
              </td>
              <td className={clsx('text-right py-2 pr-4 font-mono', pnlClass(p.unrealized_plpc))}>
                {fmtPct(p.unrealized_plpc)}
              </td>
              <td className={clsx('text-right py-2 font-mono', pnlClass(p.change_today))}>
                {fmtPct(p.change_today)}
              </td>
              <td className="py-2 pl-4">
                <button
                  type="button"
                  onClick={() => onClosePosition(p.symbol)}
                  className="text-xs text-red-400 hover:text-red-200 border border-red-800 hover:border-red-500 rounded px-2 py-0.5 transition"
                >
                  Close
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Orders table ─────────────────────────────────────────────────────────────

function OrdersTable({ orders }: { orders: LiveOrder[] }) {
  if (orders.length === 0) {
    return <div className="text-sm text-gray-500 py-4 text-center">No open orders</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-gray-500 text-xs">
            <th className="text-left py-2 pr-4">Symbol</th>
            <th className="text-right py-2 pr-4">Side</th>
            <th className="text-right py-2 pr-4">Type</th>
            <th className="text-right py-2 pr-4">Qty</th>
            <th className="text-right py-2 pr-4">Filled</th>
            <th className="text-right py-2 pr-4">Limit</th>
            <th className="text-right py-2 pr-4">Status</th>
            <th className="text-left py-2">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-900">
          {orders.map(o => (
            <tr key={o.id} className="hover:bg-gray-900/40 transition-colors">
              <td className="py-2 pr-4 font-mono font-semibold text-gray-100">{o.symbol}</td>
              <td className={clsx('text-right py-2 pr-4 font-medium', o.side.includes('buy') ? 'text-green-400' : 'text-red-400')}>
                {o.side}
              </td>
              <td className="text-right py-2 pr-4 text-gray-400">{o.type}</td>
              <td className="text-right py-2 pr-4 font-mono text-gray-200">{o.qty?.toFixed(2) ?? '—'}</td>
              <td className="text-right py-2 pr-4 font-mono text-gray-300">{o.filled_qty.toFixed(2)}</td>
              <td className="text-right py-2 pr-4 font-mono text-gray-300">{fmt$(o.limit_price)}</td>
              <td className="text-right py-2 pr-4">
                <span className={clsx(
                  'text-xs px-1.5 py-0.5 rounded',
                  o.status === 'filled' ? 'bg-green-900/50 text-green-300' :
                  o.status === 'partially_filled' ? 'bg-yellow-900/50 text-yellow-300' :
                  'bg-gray-800 text-gray-400',
                )}>
                  {o.status}
                </span>
              </td>
              <td className="py-2 text-gray-500 text-xs">{o.created_at ? new Date(o.created_at).toLocaleTimeString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Account stat pill ─────────────────────────────────────────────────────────

function StatPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-900/60 px-4 py-3 min-w-[130px]">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-base font-mono font-bold text-gray-100">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Run panel (content for one tab) ──────────────────────────────────────────

function RunPanel({ run }: { run: LiveRun }) {
  const qc = useQueryClient()

  const detailQuery = useQuery({
    queryKey: ['monitor-detail', run.id],
    queryFn: () => monitorApi.getRunDetail(run.id),
    refetchInterval: 10_000,
  })

  const positionsQuery = useQuery({
    queryKey: ['monitor-positions', run.id],
    queryFn: () => monitorApi.getPositions(run.id),
    refetchInterval: 8_000,
  })

  const closePositionMutation = useMutation({
    mutationFn: (symbol: string) => monitorApi.closePosition(run.id, symbol),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['monitor-positions', run.id] })
      qc.invalidateQueries({ queryKey: ['monitor-detail', run.id] })
    },
  })

  const closeAllMutation = useMutation({
    mutationFn: () => monitorApi.closeAll(run.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['monitor-positions', run.id] })
      qc.invalidateQueries({ queryKey: ['monitor-detail', run.id] })
    },
  })

  const detail: RunDetail | undefined = detailQuery.data
  const positions = positionsQuery.data ?? []
  const orders = detail?.open_orders ?? []
  const acct = detail?.live_account

  const totalUnrPnl = positions.reduce((sum, p) => sum + (p.unrealized_pl ?? 0), 0)
  const totalMktValue = positions.reduce((sum, p) => sum + (p.market_value ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Account stats row */}
      <div className="flex flex-wrap gap-3">
        <StatPill label="Equity" value={fmt$(acct?.equity)} />
        <StatPill label="Cash" value={fmt$(acct?.cash)} />
        <StatPill label="Portfolio Value" value={fmt$(acct?.portfolio_value)} />
        <StatPill
          label="Open P&L"
          value={fmt$(totalUnrPnl)}
          sub={`${positions.length} position${positions.length !== 1 ? 's' : ''}`}
        />
        <StatPill label="Mkt Exposure" value={fmt$(totalMktValue)} />
        {acct?.simulated && (
          <div className="flex items-center gap-1 text-xs text-blue-400 border border-blue-800 rounded px-3 py-2 self-start">
            Simulated paper account
          </div>
        )}
      </div>

      {/* Positions */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-200 text-sm">Open Positions</h3>
          <div className="flex items-center gap-2">
            {positionsQuery.isFetching && (
              <RefreshCw size={13} className="text-gray-500 animate-spin" />
            )}
            {positions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Close ALL positions for this run?')) {
                    closeAllMutation.mutate()
                  }
                }}
                disabled={closeAllMutation.isPending}
                className="text-xs text-red-400 hover:text-red-200 border border-red-800 hover:border-red-500 rounded px-2 py-1 transition"
              >
                {closeAllMutation.isPending ? 'Closing...' : 'Close All'}
              </button>
            )}
          </div>
        </div>
        <PositionsTable
          positions={positions}
          deploymentId={run.id}
          onClosePosition={(sym) => {
            if (window.confirm(`Close position in ${sym}?`)) {
              closePositionMutation.mutate(sym)
            }
          }}
        />
      </div>

      {/* Open orders */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-200 text-sm">Open Orders</h3>
          {detailQuery.isFetching && <RefreshCw size={13} className="text-gray-500 animate-spin" />}
        </div>
        <OrdersTable orders={orders} />
      </div>

      {/* Errors */}
      {acct?.error && (
        <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
          Broker error: {acct.error}
        </div>
      )}
    </div>
  )
}

// ── Page root ─────────────────────────────────────────────────────────────────

export function LiveMonitor() {
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)

  const runsQuery = useQuery({
    queryKey: ['monitor-runs'],
    queryFn: monitorApi.listRuns,
    refetchInterval: 15_000,
  })

  const runs = runsQuery.data ?? []

  function openRun(run: LiveRun) {
    if (!openTabs.includes(run.id)) {
      setOpenTabs(prev => [...prev, run.id])
    }
    setActiveTab(run.id)
  }

  function closeTab(id: string) {
    setOpenTabs(prev => {
      const next = prev.filter(t => t !== id)
      if (activeTab === id) setActiveTab(next[next.length - 1] ?? null)
      return next
    })
  }

  const activeRun = runs.find(r => r.id === activeTab)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Live Monitor</h1>
          <p className="text-sm text-gray-500">
            Track all active paper and live runs simultaneously.
          </p>
        </div>
        <button
          type="button"
          onClick={() => runsQuery.refetch()}
          className="btn-secondary flex items-center gap-1.5 text-sm"
        >
          <RefreshCw size={14} className={runsQuery.isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Active runs grid (always visible) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {runs.length === 0 && !runsQuery.isFetching && (
          <div className="col-span-full text-sm text-gray-500 py-6 text-center card p-6">
            No active paper or live runs found. Deploy a strategy first.
          </div>
        )}
        {runs.map(run => (
          <button
            key={run.id}
            type="button"
            onClick={() => openRun(run)}
            className={clsx(
              'card p-4 text-left transition hover:border-sky-700 group',
              activeTab === run.id && 'border-sky-600',
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-gray-100 text-sm truncate pr-2">
                {run.strategy_name ?? 'Unnamed'}
              </span>
              <span className={clsx(
                'text-xs px-1.5 py-0.5 rounded flex-shrink-0',
                run.mode === 'live' ? 'bg-orange-900/60 text-orange-300' : 'bg-blue-900/60 text-blue-300',
              )}>
                {run.mode}
              </span>
            </div>
            <div className="text-xs text-gray-500 mb-3 truncate">{run.account_name}</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-gray-600">Equity</div>
                <div className="text-sm font-mono text-gray-200">{fmt$(run.account_equity)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600">Unr. P&L</div>
                <div className={clsx('text-sm font-mono font-medium', pnlClass(run.account_unrealized_pnl))}>
                  {fmt$(run.account_unrealized_pnl)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-3">
              <span className={clsx(
                'w-1.5 h-1.5 rounded-full',
                run.status === 'running' ? 'bg-green-400 animate-pulse' : 'bg-yellow-400',
              )} />
              <span className="text-xs text-gray-500">{run.status}</span>
              <span className="text-xs text-sky-500 ml-auto opacity-0 group-hover:opacity-100 transition">
                Open →
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Tab bar + panel (only when tabs are open) */}
      {openTabs.length > 0 && (
        <div className="card overflow-hidden">
          {/* Tab bar */}
          <div className="flex overflow-x-auto border-b border-gray-800 bg-gray-950 px-2 pt-2 gap-1">
            {openTabs.map(tabId => {
              const run = runs.find(r => r.id === tabId)
              if (!run) return null
              return (
                <RunTab
                  key={tabId}
                  run={run}
                  active={activeTab === tabId}
                  onClick={() => setActiveTab(tabId)}
                  onClose={() => closeTab(tabId)}
                />
              )
            })}
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeRun ? (
              <RunPanel run={activeRun} />
            ) : (
              <div className="text-sm text-gray-500 py-4 text-center">
                This run is no longer active.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
