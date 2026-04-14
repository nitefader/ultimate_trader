import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Power, RotateCcw, Activity, TrendingUp, DollarSign, Target, RefreshCw, Wifi, WifiOff, Trash2, ChevronDown, ChevronUp, Zap, MoreHorizontal, AlertTriangle, Layers } from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import { accountsApi, deploymentsApi } from '../api/accounts'
import { servicesApi } from '../api/services'
import { ModeIndicator } from '../components/ModeIndicator'
import { ConfirmationModal } from '../components/ConfirmationModal'
import { CreateAccountModal } from '../components/CreateAccountModal'
import { usePollingGate } from '../hooks/usePollingGate'
import { SelectMenu } from '../components/SelectMenu'
import { Tooltip } from '../components/Tooltip'
import clsx from 'clsx'
import type { Account, AccountActivity, Deployment } from '../types'

interface Position {
  symbol: string
  qty: number
  side: string
  avg_entry_price: number
  current_price: number
  market_value: number
  cost_basis: number
  unrealized_pl: number
  unrealized_plpc: number
  unrealized_intraday_pl: number | null
  change_today: number | null
}

interface BrokerAccountData {
  equity: number
  cash: number
  buying_power: number
  last_equity: number
  day_trade_count: number
  pattern_day_trader: boolean
  status: string
  simulated?: boolean
  error?: string
}

interface BrokerStatus {
  account?: BrokerAccountData
  positions?: Position[]
  error?: string
  connected?: boolean
  broker?: string
}

interface Order {
  id: string
  symbol: string
  side: string
  type: string
  qty: number | null
  filled_qty: number
  limit_price: number | null
  stop_price: number | null
  status: string
  created_at: string | null
}

// ── Account Positions Panel ───────────────────────────────────────────────────

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

function AccountPositionsPanel({ accountId }: { accountId: string }) {
  const pausePolling = usePollingGate()
  const { data, isLoading, error, isFetching } = useQuery<BrokerStatus>({
    queryKey: ['account-broker-status', accountId],
    queryFn: () => accountsApi.getBrokerStatus(accountId),
    refetchInterval: pausePolling ? false : 30_000,
    staleTime: 20_000,
  })

  const { data: orders = [], isFetching: ordersFetching } = useQuery<Order[]>({
    queryKey: ['account-broker-orders', accountId],
    queryFn: () => accountsApi.getBrokerOrders(accountId, 'open'),
    refetchInterval: pausePolling ? false : 30_000,
    staleTime: 20_000,
  })

  if (isLoading) {
    return (
      <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500 text-center py-4">
        Loading live data...
      </div>
    )
  }

  if (error || data?.error) {
    return (
      <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-amber-500">
        Could not load live data: {(error as Error)?.message ?? data?.error}
      </div>
    )
  }

  const acct = data?.account
  const positions: Position[] = data?.positions ?? []
  const dayPnl = acct ? (acct.equity - acct.last_equity) : null
  const dayPnlPct = acct && acct.last_equity > 0 ? (dayPnl! / acct.last_equity) : null
  const totalIntraday = positions.reduce((s, p) => s + (p.unrealized_intraday_pl ?? 0), 0)

  return (
    <div className="mt-2 pt-2 border-t border-gray-800 space-y-2">
      {/* Stats row */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="text-gray-600">
          Eq <span className="text-gray-200 font-mono">{fmt$(acct?.equity, 0)}</span>
        </span>
        <span className="text-gray-600">
          Cash <span className="text-gray-200 font-mono">{fmt$(acct?.cash, 0)}</span>
        </span>
        <span className="text-gray-600">
          BP <span className="text-gray-200 font-mono">{fmt$(acct?.buying_power, 0)}</span>
        </span>
        <span className="text-gray-600">
          Day <span className={clsx('font-mono font-medium', pnlClass(dayPnl))}>{fmt$(dayPnl)}</span>
          {dayPnlPct != null && <span className={clsx('ml-1', pnlClass(dayPnlPct))}>{fmtPct(dayPnlPct, 1)}</span>}
        </span>
        {totalIntraday !== 0 && (
          <span className="text-gray-600">
            Intraday <span className={clsx('font-mono', pnlClass(totalIntraday))}>{fmt$(totalIntraday)}</span>
          </span>
        )}
        {isFetching && <RefreshCw size={10} className="text-gray-700 animate-spin ml-auto" />}
        {data?.broker === 'paper_simulated' && <span className="text-[10px] text-blue-500">sim</span>}
        {acct?.pattern_day_trader && <span className="text-[10px] text-amber-500">PDT</span>}
      </div>

      {/* Positions */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Open Positions</span>
        <span className="flex-1 h-px bg-gray-800" />
        <span className="text-[10px] text-gray-600">{positions.length}</span>
      </div>
      {positions.length === 0 ? (
        <div className="text-[11px] text-gray-600 pb-1">No open positions</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: '11px' }}>
            <thead>
              <tr className="border-b border-gray-800/80 text-gray-600">
                <th className="text-left pb-1 pr-2">Symbol</th>
                <th className="text-right pb-1 pr-2">Side</th>
                <th className="text-right pb-1 pr-2">Qty</th>
                <th className="text-right pb-1 pr-2">Entry</th>
                <th className="text-right pb-1 pr-2">Price</th>
                <th className="text-right pb-1 pr-2">Value</th>
                <th className="text-right pb-1 pr-2">P&L</th>
                <th className="text-right pb-1 pr-2">P&L%</th>
                <th className="text-right pb-1">Today</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.symbol} className="border-b border-gray-900 hover:bg-gray-900/20">
                  <td className="py-0.5 pr-2 font-mono font-semibold text-gray-100">{p.symbol}</td>
                  <td className={clsx('text-right pr-2', p.side === 'long' ? 'text-green-400' : 'text-red-400')}>{p.side}</td>
                  <td className="text-right pr-2 font-mono text-gray-300">{p.qty?.toFixed(2) ?? '—'}</td>
                  <td className="text-right pr-2 font-mono text-gray-500">{fmt$(p.avg_entry_price)}</td>
                  <td className="text-right pr-2 font-mono text-gray-200">{fmt$(p.current_price)}</td>
                  <td className="text-right pr-2 font-mono text-gray-400">{fmt$(p.market_value, 0)}</td>
                  <td className={clsx('text-right pr-2 font-mono font-medium', pnlClass(p.unrealized_pl))}>{fmt$(p.unrealized_pl)}</td>
                  <td className={clsx('text-right pr-2 font-mono', pnlClass(p.unrealized_plpc))}>{fmtPct(p.unrealized_plpc)}</td>
                  <td className={clsx('text-right font-mono', pnlClass(p.change_today))}>{p.change_today != null ? fmtPct(p.change_today) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Orders */}
      <div className="flex items-center gap-2 mt-3 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Open Orders</span>
        <span className="flex-1 h-px bg-gray-800" />
        <span className="text-[10px] text-gray-600">{orders.length}</span>
      </div>
      <div>
        {orders.length === 0 ? (
          <div className="text-[11px] text-gray-600">No open orders</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: '11px' }}>
              <thead>
                <tr className="border-b border-gray-800/80 text-gray-600">
                  <th className="text-left pb-1 pr-2">Symbol</th>
                  <th className="text-right pb-1 pr-2">Side</th>
                  <th className="text-right pb-1 pr-2">Type</th>
                  <th className="text-right pb-1 pr-2">Qty</th>
                  <th className="text-right pb-1 pr-2">Filled</th>
                  <th className="text-right pb-1 pr-2">Limit</th>
                  <th className="text-right pb-1 pr-2">Stop</th>
                  <th className="text-right pb-1 pr-2">Status</th>
                  <th className="text-right pb-1">Time</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-b border-gray-900 hover:bg-gray-900/20">
                    <td className="py-0.5 pr-2 font-mono font-semibold text-gray-100">{o.symbol}</td>
                    <td className={clsx('text-right pr-2', o.side.includes('buy') ? 'text-green-400' : 'text-red-400')}>{o.side}</td>
                    <td className="text-right pr-2 text-gray-500">{o.type}</td>
                    <td className="text-right pr-2 font-mono text-gray-300">{o.qty?.toFixed(2) ?? '—'}</td>
                    <td className="text-right pr-2 font-mono text-gray-500">{o.filled_qty.toFixed(2)}</td>
                    <td className="text-right pr-2 font-mono text-gray-400">{fmt$(o.limit_price)}</td>
                    <td className="text-right pr-2 font-mono text-gray-400">{fmt$(o.stop_price)}</td>
                    <td className="text-right pr-2">
                      <span className={clsx('px-1 rounded',
                        o.status === 'filled' ? 'bg-green-900/50 text-green-300' :
                        o.status === 'partially_filled' ? 'bg-yellow-900/50 text-yellow-300' :
                        o.status === 'new' || o.status === 'accepted' ? 'bg-sky-900/50 text-sky-300' :
                        'bg-gray-800 text-gray-500',
                      )}>{o.status}</span>
                    </td>
                    <td className="text-right text-gray-600">{o.created_at ? new Date(o.created_at).toLocaleTimeString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function getDeleteBlockers(activity?: AccountActivity) {
  return activity?.delete_blockers ?? []
}

function getDeleteSummary(activity?: AccountActivity) {
  const blockers = getDeleteBlockers(activity)
  return blockers.length > 0 ? blockers.join(', ') : 'No active deployments, positions, or orders'
}

function isAccountDeleteReady(account: Account) {
  return account.activity?.can_delete ?? true
}

function formatAccountNames(accounts: Account[]) {
  const quotedNames = accounts.map((account) => `"${account.name}"`)
  if (quotedNames.length <= 3) {
    return quotedNames.join(', ')
  }
  return `${quotedNames.slice(0, 3).join(', ')} and ${quotedNames.length - 3} more`
}

function getStalenessDisplay(updatedAt?: string) {
  if (!updatedAt) {
    return { label: 'Last updated: unknown', className: 'text-red-400' }
  }

  const updatedMs = new Date(updatedAt).getTime()
  if (Number.isNaN(updatedMs)) {
    return { label: 'Last updated: unknown', className: 'text-red-400' }
  }

  const ageSec = Math.max(0, Math.floor((Date.now() - updatedMs) / 1000))

  if (ageSec < 30) {
    return { label: `Last updated: ${ageSec}s ago`, className: 'text-emerald-400' }
  }
  if (ageSec < 60) {
    return { label: `Last updated: ${ageSec}s ago`, className: 'text-amber-400' }
  }
  return { label: `Last updated: ${ageSec}s ago`, className: 'text-red-400' }
}

function AccountCard({ account, onHalt, onResume, onEdit, onRefresh, onDelete, onFlatten, onEmergencyExit, onSelectionChange, isSelected, isRefreshing, isDeleting, deleteError, isExpanded, onToggleExpand, hasActiveDeployment }: {
  account: Account
  onHalt: () => void
  onResume: (id: string) => void
  onEdit: (id: string) => void
  onRefresh: (id: string) => void
  onDelete: (account: Account) => void
  onFlatten: () => void
  onEmergencyExit: () => void
  onSelectionChange: (account: Account, selected: boolean) => void
  isSelected: boolean
  isRefreshing?: boolean
  isDeleting?: boolean
  deleteError?: string
  isExpanded: boolean
  onToggleExpand: () => void
  hasActiveDeployment: boolean
}) {
  const [, setAgeTick] = React.useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const pausePolling = usePollingGate()

  React.useEffect(() => {
    if (pausePolling) return
    const interval = setInterval(() => {
      setAgeTick((v) => v + 1)
    }, 1_000)
    return () => clearInterval(interval)
  }, [pausePolling])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const accountEquity = account.equity ?? account.current_balance
  const unrealizedPnl = account.unrealized_pnl ?? 0
  const baselinePnl = accountEquity - account.initial_balance
  const baselinePnlPct = account.initial_balance > 0 ? (baselinePnl / account.initial_balance) * 100 : 0
  // Show open position P&L when it differs meaningfully from baseline (i.e. baseline was recently reset)
  const showUnrealized = Math.abs(baselinePnl) < 1 && Math.abs(unrealizedPnl) > 0
  const pnl = showUnrealized ? unrealizedPnl : baselinePnl
  const pnlPct = showUnrealized
    ? (accountEquity > 0 ? (unrealizedPnl / accountEquity) * 100 : 0)
    : baselinePnlPct
  const staleness = getStalenessDisplay(account.updated_at)
  const activity = account.activity
  const deleteBlockers = getDeleteBlockers(activity)
  const canDelete = isAccountDeleteReady(account)
  return (
    <div className={clsx('card border', account.is_killed ? 'border-l-4 border-l-red-600 border-red-800' : 'border-gray-800')}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-gray-700 bg-gray-900 text-sky-500 focus:ring-sky-500"
            checked={isSelected}
            onChange={(e) => onSelectionChange(account, e.target.checked)}
            aria-label={canDelete ? `Select ${account.name}` : `Select ${account.name} (delete blocked: ${getDeleteSummary(activity)})`}
          />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-200">{account.name}</span>
              {account.is_connected
                ? <Tooltip content="Connected to Alpaca — click to manage keys"><Link to={`/security?account=${account.id}`} className="flex items-center gap-1 text-green-400 hover:text-green-300 transition-colors"><Wifi size={12} /><span className="text-[10px] underline">Keys</span></Link></Tooltip>
                : <Tooltip content="Not connected — click to configure API keys"><Link to={`/security?account=${account.id}`} className="flex items-center gap-1 text-amber-500 hover:text-amber-400 transition-colors"><WifiOff size={12} /><span className="text-[10px] underline">Setup keys</span></Link></Tooltip>}
              {hasActiveDeployment && (
                <Tooltip content="UltraTrader has an active deployment on this account">
                  <span className="flex items-center gap-1 text-[10px] text-emerald-300 border border-emerald-800 bg-emerald-950/40 rounded px-1.5 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <Zap size={9} />
                    UltraTrader Active
                  </span>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <ModeIndicator mode={account.mode} />
              {account.is_killed && <Tooltip content="Trading halted — no new orders will be placed. Click Resume Trading to re-enable."><span className="badge-red">HALTED</span></Tooltip>}
              {!account.is_killed && account.is_enabled && <Tooltip content="Account is active and eligible for trading"><span className="badge-green">Active</span></Tooltip>}
              {!account.is_killed && !account.is_enabled && <Tooltip content="Account is disabled — will not execute any trades"><span className="badge-gray">Disabled</span></Tooltip>}
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap justify-end">
          <Tooltip content="Refresh equity from Alpaca">
          <button
            className="btn-ghost text-xs flex items-center gap-1 py-1"
            onClick={() => onRefresh(account.id)}
            disabled={isRefreshing}
          >
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          </Tooltip>
          <button className="btn-ghost text-xs py-1" onClick={() => onEdit(account.id)}>
            Edit
          </button>
          {account.is_killed ? (
            <Tooltip content="Resume trading — re-enable order placement">
              <button className="btn-ghost text-xs flex items-center gap-1 py-1 text-green-400 border border-green-800 hover:border-green-600" onClick={() => onResume(account.id)}>
                <RotateCcw size={12} /> Resume Trading
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="Halt — block all new orders without closing positions">
              <button className="btn-ghost text-xs flex items-center gap-1 py-1 text-amber-400 border border-amber-800 hover:border-amber-600" onClick={() => onHalt()}>
                <Power size={12} /> Halt
              </button>
            </Tooltip>
          )}
          <button
            className={clsx(
              'btn-danger text-xs flex items-center gap-1 py-1',
              (!canDelete || isDeleting) && 'opacity-60 cursor-not-allowed',
            )}
            onClick={() => onDelete(account)}
            disabled={!canDelete || isDeleting}
          >
            <Trash2 size={12} /> {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
          <button
            className="btn-ghost text-xs flex items-center gap-1 py-1 border border-gray-700"
            onClick={onToggleExpand}
          >
            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {isExpanded ? 'Hide' : 'Positions'}
          </button>
          {/* Overflow menu */}
          <div className="relative" ref={menuRef}>
            <Tooltip content="More actions">
            <button
              className="btn-ghost text-xs flex items-center py-1 px-1.5 border border-gray-700"
              onClick={() => setMenuOpen(v => !v)}
            >
              <MoreHorizontal size={14} />
            </button>
            </Tooltip>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded border border-gray-700 bg-gray-900 shadow-xl py-1">
                <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider">Danger Zone</div>
                <button
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 text-amber-400 hover:bg-gray-800 transition-colors"
                  onClick={() => { setMenuOpen(false); onFlatten() }}
                >
                  <Layers size={12} /> Flatten Account
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 text-red-400 hover:bg-gray-800 transition-colors"
                  onClick={() => { setMenuOpen(false); onEmergencyExit() }}
                >
                  <AlertTriangle size={12} /> Emergency Exit
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-gray-500 flex items-center gap-1">
            Equity
            {account.is_connected && <Tooltip content="Live data from Alpaca"><span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" /></Tooltip>}
          </div>
          <div className="font-mono font-bold">${accountEquity.toLocaleString('en', { maximumFractionDigits: 0 })}</div>
        </div>
        <div>
          <Tooltip content={showUnrealized ? 'Unrealized P&L from open positions' : `vs baseline $${account.initial_balance.toLocaleString('en', { maximumFractionDigits: 0 })}`} className="block">
            <div className="text-xs text-gray-500">
              {showUnrealized ? 'Unrealized P&L' : 'P&L'}
            </div>
          </Tooltip>
          <div className={clsx('font-mono font-bold', pnl >= 0 ? 'positive' : 'negative')}>
            {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toLocaleString('en', { maximumFractionDigits: 0 })} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Cash</div>
          <div className="font-mono">${(account.current_balance ?? 0).toLocaleString('en', { maximumFractionDigits: 0 })}</div>
          <div className={clsx('text-xs mt-0.5', staleness.className)}>{staleness.label}</div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-800 grid grid-cols-4 gap-2 text-xs text-gray-500">
        <div>Max Pos: {(account.max_position_size_pct * 100).toFixed(0)}%</div>
        <div>Max DD: {(account.max_drawdown_lockout_pct * 100).toFixed(0)}%</div>
        <div>Max Open: {account.max_open_positions}</div>
        <Tooltip content="Margin multiplier synced from Alpaca" className="block">
          <div>Margin: <span className={account.leverage >= 2 ? 'text-amber-400' : 'text-gray-400'}>{account.leverage}x</span></div>
        </Tooltip>
      </div>

      {activity && (
        <div className="mt-3 pt-3 border-t border-gray-800 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <div className="rounded border border-gray-800 bg-gray-950/60 p-2">
              <div className="text-gray-500">Deployments</div>
              <div className="font-mono text-gray-200">
                {activity.active_deployments} active / {activity.deployment_count} total
              </div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/60 p-2">
              <div className="text-gray-500">Open Trades</div>
              <div className="font-mono text-gray-200">{activity.open_trades}</div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/60 p-2">
              <div className="text-gray-500">Open Positions</div>
              <div className="font-mono text-gray-200">{activity.open_positions}</div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/60 p-2">
              <div className="text-gray-500">Open Orders</div>
              <div className="font-mono text-gray-200">{activity.open_orders}</div>
            </div>
          </div>

          {activity.position_symbols.length > 0 && (
            <div className="text-xs text-gray-400">
              Open symbols: {activity.position_symbols.join(', ')}
            </div>
          )}

          <div className={clsx('text-xs', canDelete ? 'text-gray-500' : 'text-amber-400')}>
            {canDelete ? 'Delete ready: no active deployments, positions, or orders found.' : `Delete blocked: ${deleteBlockers.join(', ')}`}
          </div>

          {activity.broker_error && (
            <div className="text-xs text-amber-500">
              Broker status warning: {activity.broker_error}
            </div>
          )}
        </div>
      )}

      {account.kill_reason && (
        <div className="mt-2 text-xs text-red-400">Halt reason: {account.kill_reason}</div>
      )}

      {deleteError && (
        <div className="mt-2 text-xs text-red-400">{deleteError}</div>
      )}

      {isExpanded && <AccountPositionsPanel accountId={account.id} />}
    </div>
  )
}

function DeploymentTab({ deployment, isActive, onClick }: {
  deployment: Deployment
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
        isActive
          ? 'border-sky-400 text-sky-400'
          : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600'
      )}
    >
      <div className="flex items-center gap-2">
        <ModeIndicator mode={deployment.mode} />
        <span>{deployment.strategy_id.slice(0, 8)}...</span>
        {deployment.status === 'running' && <Activity size={12} className="text-green-400" />}
      </div>
    </button>
  )
}

function DeploymentMonitor({ deployment, account, onStop }: {
  deployment: Deployment
  account?: Account
  onStop: (id: string) => void
}) {
  const pausePolling = usePollingGate()
  const { data: positionsData = { positions: [] }, isLoading: positionsLoading, error: positionsError } = useQuery({
    queryKey: ['deployment-positions', deployment.id],
    queryFn: () => deploymentsApi.getPositions(deployment.id),
    refetchInterval: pausePolling ? false : 5_000,
  })

  const positions: Position[] = positionsData?.positions ?? []
  const totalUnrPnl = positions.reduce((s, p) => s + (p.unrealized_pl ?? 0), 0)
  const equity = account?.equity ?? account?.current_balance ?? 0
  const initialBalance = account?.initial_balance ?? 0
  const pnl = equity - initialBalance
  const pnlPct = initialBalance > 0 ? (pnl / initialBalance) * 100 : 0

  return (
    <div className="space-y-6">
      {positionsError && (
        <div className="card border-red-800 bg-red-900/20">
          <div className="text-red-400 text-sm">
            Positions error: {(positionsError as Error).message}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold font-mono">{deployment.strategy_version_id.slice(0, 8)}...</h2>
          <div className="flex items-center gap-2 mt-1">
            <ModeIndicator mode={deployment.mode} />
            <span className="text-sm text-gray-400">Status: {deployment.status}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {deployment.status === 'running' && (
            <button className="btn-danger text-xs flex items-center gap-1 py-1" onClick={() => onStop(deployment.id)}>
              <Power size={12} /> Stop
            </button>
          )}
        </div>
      </div>

      {/* Key Metrics - real account data */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={16} className="text-green-400" />
            <span className="text-xs text-gray-500">Equity</span>
          </div>
          <div className="text-xl font-bold font-mono">
            {equity > 0 ? `$${equity.toLocaleString('en', { maximumFractionDigits: 0 })}` : '--'}
          </div>
          <div className={clsx('text-xs mt-0.5', pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}% from initial
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-blue-400" />
            <span className="text-xs text-gray-500">Unrealized P&L</span>
          </div>
          <div className={clsx('text-xl font-bold font-mono', totalUnrPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {totalUnrPnl >= 0 ? '+' : ''}${totalUnrPnl.toFixed(2)}
          </div>
          <div className="text-xs text-gray-500">{positions.length} open position{positions.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <Target size={16} className="text-purple-400" />
            <span className="text-xs text-gray-500">Max DD Lockout</span>
          </div>
          <div className="text-xl font-bold font-mono">
            {account?.max_drawdown_lockout_pct != null
              ? `${(account.max_drawdown_lockout_pct * 100).toFixed(0)}%`
              : '--'}
          </div>
          <div className="text-xs text-gray-500">threshold</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={16} className="text-orange-400" />
            <span className="text-xs text-gray-500">Open Positions</span>
          </div>
          <div className="text-xl font-bold font-mono">{positionsLoading ? '...' : positions.length}</div>
          <div className="text-xs text-gray-500">
            Max: {account?.max_open_positions ?? '--'}
          </div>
        </div>
      </div>

      {/* Positions Table */}
      <div className="card">
        <h3 className="text-sm font-semibold mb-4">Open Positions</h3>
        {positions.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            {positionsLoading ? 'Loading...' : 'No open positions'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500">
                  <th className="text-left py-2 pr-4">Symbol</th>
                  <th className="text-right py-2 pr-4">Qty</th>
                  <th className="text-right py-2 pr-4">Avg Entry</th>
                  <th className="text-right py-2 pr-4">Current</th>
                  <th className="text-right py-2 pr-4">Mkt Value</th>
                  <th className="text-right py-2 pr-4">Unr. P&L</th>
                  <th className="text-right py-2">P&L %</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-900/30">
                    <td className="py-2 pr-4 font-mono font-semibold">{pos.symbol}</td>
                    <td className="text-right py-2 pr-4 font-mono">{pos.qty}</td>
                    <td className="text-right py-2 pr-4 font-mono text-gray-300">
                      ${pos.avg_entry_price?.toFixed(2) ?? '--'}
                    </td>
                    <td className="text-right py-2 pr-4 font-mono text-gray-200">
                      ${pos.current_price?.toFixed(2) ?? '--'}
                    </td>
                    <td className="text-right py-2 pr-4 font-mono text-gray-200">
                      ${pos.market_value?.toFixed(2) ?? '--'}
                    </td>
                    <td className={clsx('text-right py-2 pr-4 font-mono', (pos.unrealized_pl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {(pos.unrealized_pl ?? 0) >= 0 ? '+' : ''}${pos.unrealized_pl?.toFixed(2) ?? '--'}
                    </td>
                    <td className={clsx('text-right py-2 font-mono', (pos.unrealized_plpc ?? 0) >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {(pos.unrealized_plpc ?? 0) >= 0 ? '+' : ''}{((pos.unrealized_plpc ?? 0) * 100).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const EditAccountModal = React.memo(function EditAccountModal({ account, onClose, onUpdated }: { account: Account | null; onClose: () => void; onUpdated: () => void }) {
  const [name, setName] = useState(account?.name || '')
  const [maxPositionSizePct, setMaxPositionSizePct] = useState((account?.max_position_size_pct || 0.1) * 100)
  const [maxDailyLossPct, setMaxDailyLossPct] = useState((account?.max_daily_loss_pct || 0.03) * 100)
  const [maxOpenPositions, setMaxOpenPositions] = useState(account?.max_open_positions || 10)
  const [isEnabled, setIsEnabled] = useState(account?.is_enabled !== false)
  const [dataServiceId, setDataServiceId] = useState<string>(account?.data_service_id || '')

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: servicesApi.list,
  })

  const { mutate, isPending, error } = useMutation({
    mutationFn: () =>
      accountsApi.update(account!.id, {
        name,
        max_position_size_pct: maxPositionSizePct / 100,
        max_daily_loss_pct: maxDailyLossPct / 100,
        max_open_positions: maxOpenPositions,
        is_enabled: isEnabled,
        data_service_id: dataServiceId || null,
      }),
    onSuccess: () => { onUpdated(); onClose() },
  })

  if (!account) return null

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card w-96 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-sm font-semibold">Edit Account</h3>
        <div>
          <label className="label">Name</label>
          <input className="input w-full" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Max Position Size (%)</label>
          <input type="number" step="0.1" className="input w-full" value={maxPositionSizePct} onChange={e => setMaxPositionSizePct(parseFloat(e.target.value))} />
        </div>
        <div>
          <label className="label">Max Daily Loss (%)</label>
          <input type="number" step="0.1" className="input w-full" value={maxDailyLossPct} onChange={e => setMaxDailyLossPct(parseFloat(e.target.value))} />
        </div>
        <div>
          <label className="label">Max Open Positions</label>
          <input type="number" className="input w-full" value={maxOpenPositions} onChange={e => setMaxOpenPositions(parseInt(e.target.value))} />
        </div>
        <div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isEnabled} onChange={e => setIsEnabled(e.target.checked)} />
            <span className="text-sm">Enabled</span>
          </label>
        </div>
        <div>
          <label className="label">Data Service</label>
          <SelectMenu
            value={dataServiceId}
            onChange={setDataServiceId}
            placeholder="Self (use own credentials)"
            options={[
              { value: '', label: 'Self (use own credentials)' },
              ...services.filter(s => s.is_active).map(s => ({
                value: s.id,
                label: `${s.name} (${s.provider} / ${s.environment})${s.is_default ? ' ★' : ''}`,
              })),
            ]}
          />
          <div className="mt-1 text-xs text-gray-500">
            Choose a shared data service or use this account's own Alpaca keys.
          </div>
        </div>
        {error && <div className="text-red-400 text-xs">{(error as Error).message}</div>}
        <div className="flex gap-2 justify-end">
          <button className="btn-ghost text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={() => mutate()} disabled={!name || isPending}>
            Update
          </button>
        </div>
      </div>
    </div>
  )
})

export function AccountMonitor() {
  const pausePolling = usePollingGate()
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set())
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState<string | null>(null)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)
  const [lastAccountsFetch, setLastAccountsFetch] = useState<Date | null>(null)
  const [now, setNow] = useState(Date.now())
  const [haltTarget, setHaltTarget] = useState<Account | null>(null)
  const [flattenTarget, setFlattenTarget] = useState<Account | null>(null)
  const [flattenConfirmText, setFlattenConfirmText] = useState('')
  const [emergencyTarget, setEmergencyTarget] = useState<Account | null>(null)
  const [emergencyConfirmText, setEmergencyConfirmText] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [expandedAccountIds, setExpandedAccountIds] = useState<Set<string>>(new Set())
  const navigate = useNavigate()

  // Tick every second to drive the staleness indicator
  React.useEffect(() => {
    if (pausePolling) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [pausePolling])

  const qc = useQueryClient()

  const {
    data: deployments = [],
    isLoading: deploymentsLoading,
    error: deploymentsError,
  } = useQuery({
    queryKey: ['deployments', 'running'],
    queryFn: async () => {
      const results = await Promise.allSettled([
        deploymentsApi.list(undefined, 'paper'),
        deploymentsApi.list(undefined, 'live'),
      ])

      return results.flatMap((result) => (
        result.status === 'fulfilled' ? result.value : []
      ))
    },
    refetchInterval: pausePolling ? false : 5000, // More frequent updates for live monitoring
  })

  const {
    data: accounts = [],
    isLoading: accountsLoading,
    error: accountsError,
  } = useQuery({
    queryKey: ['accounts', 'activity'],
    queryFn: async () => {
      const result = await accountsApi.list(false, true)
      setLastAccountsFetch(new Date())
      return result
    },
    refetchInterval: pausePolling ? false : 15_000,
  })

  // Auto-sync leverage/margin from Alpaca on mount and whenever the account list changes
  const syncedAccountIds = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    const newIds = accounts
      .filter(a => a.is_connected && !syncedAccountIds.current.has(a.id))
    if (newIds.length === 0) return
    newIds.forEach(a => syncedAccountIds.current.add(a.id))
    Promise.allSettled(newIds.map(a => accountsApi.syncFromBroker(a.id))).then(() => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
    })
  }, [accounts])

  const runningDeployments = deployments.filter(d => d.status === 'running')
  const activeDeploymentAccountIds = new Set(runningDeployments.map(d => d.account_id).filter(Boolean))

  function toggleExpand(accountId: string) {
    setExpandedAccountIds(prev => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  // Set first tab as active if none selected
  React.useEffect(() => {
    if (runningDeployments.length === 0) {
      if (activeTab !== null) setActiveTab(null)
      return
    }

    const hasActiveTab = activeTab != null && runningDeployments.some(d => d.id === activeTab)
    if (!hasActiveTab) {
      setActiveTab(runningDeployments[0].id)
    }
  }, [runningDeployments, activeTab])

  React.useEffect(() => {
    const validIds = new Set(accounts.map((account) => account.id))
    setSelectedAccountIds((prev) => {
      const next = new Set([...prev].filter((id) => validIds.has(id)))
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) {
        return prev
      }
      return next
    })
  }, [accounts])

  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set())

  const invalidateAccountViews = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['accounts'] }),
      qc.invalidateQueries({ queryKey: ['deployments'] }),
    ])
  }

  const haltMutation = useMutation({
    mutationFn: (id: string) => accountsApi.halt(id, 'Manual halt from UI'),
    onSuccess: () => { setHaltTarget(null); qc.invalidateQueries({ queryKey: ['accounts'] }) },
    onError: () => { /* keep modal open */ },
  })

  const flattenMutation = useMutation({
    mutationFn: (id: string) => accountsApi.flatten(id),
    onSuccess: () => { setFlattenTarget(null); setFlattenConfirmText(''); qc.invalidateQueries({ queryKey: ['accounts'] }) },
    onError: () => { /* keep modal open */ },
  })

  const emergencyMutation = useMutation({
    mutationFn: (id: string) => accountsApi.emergencyExit(id, 'Emergency exit from UI'),
    onSuccess: () => { setEmergencyTarget(null); setEmergencyConfirmText(''); qc.invalidateQueries({ queryKey: ['accounts'] }) },
    onError: () => { /* keep modal open */ },
  })

  const [resumeError, setResumeError] = useState<string | null>(null)
  const resumeMutation = useMutation({
    mutationFn: (id: string) => accountsApi.resume(id),
    onSuccess: () => { setResumeError(null); qc.invalidateQueries({ queryKey: ['accounts'] }) },
    onError: (e: any) => setResumeError(e?.response?.data?.detail ?? e?.message ?? 'Failed to resume trading'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => accountsApi.delete(id),
    onSuccess: async (_, accountId) => {
      setEditingAccountId(null)
      setSelectedAccountIds((prev) => {
        const next = new Set(prev)
        next.delete(accountId)
        return next
      })
      setBulkDeleteNotice(null)
      setBulkDeleteError(null)
      await invalidateAccountViews()
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async (accountsToDelete: Account[]) => {
      const results = await Promise.allSettled(
        accountsToDelete.map(async (account) => {
          await accountsApi.delete(account.id)
          return account
        }),
      )

      const deleted: Account[] = []
      const failed: { account: Account; message: string }[] = []

      results.forEach((result, index) => {
        const account = accountsToDelete[index]
        if (result.status === 'fulfilled') {
          deleted.push(result.value)
          return
        }

        const message = result.reason instanceof Error
          ? result.reason.message
          : 'Delete failed'
        failed.push({ account, message })
      })

      return { deleted, failed }
    },
    onSuccess: async ({ deleted, failed }) => {
      const deletedIds = new Set(deleted.map((account) => account.id))
      setSelectedAccountIds((prev) => new Set([...prev].filter((id) => !deletedIds.has(id))))

      if (failed.length > 0) {
        const failedSummary = failed.map(({ account, message }) => `${account.name}: ${message}`).join(' | ')
        const deletedSummary = deleted.length > 0 ? `Deleted ${deleted.length} account${deleted.length === 1 ? '' : 's'}. ` : ''
        setBulkDeleteNotice(deleted.length > 0 ? deletedSummary.trim() : null)
        setBulkDeleteError(`${deletedSummary}Failed: ${failedSummary}`.trim())
      } else {
        setBulkDeleteNotice(`Deleted ${deleted.length} selected account${deleted.length === 1 ? '' : 's'}.`)
        setBulkDeleteError(null)
      }

      await invalidateAccountViews()
    },
  })

  const handleRefreshAccount = async (id: string) => {
    setRefreshingIds(prev => new Set(prev).add(id))
    try {
      await accountsApi.refresh(id)
      await qc.invalidateQueries({ queryKey: ['accounts'] })
    } finally {
      setRefreshingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  const handleDeleteAccount = (account: Account) => {
    setBulkDeleteNotice(null)
    setBulkDeleteError(null)
    setDeleteTarget(account)
  }

  const confirmDeleteAccount = () => {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    })
  }

  const handleSelectionChange = (account: Account, selected: boolean) => {
    setBulkDeleteNotice(null)
    setBulkDeleteError(null)
    setSelectedAccountIds((prev) => {
      const next = new Set(prev)
      if (selected) {
        next.add(account.id)
      } else {
        next.delete(account.id)
      }
      return next
    })
  }

  const handleSelectAllAccounts = () => {
    setBulkDeleteNotice(null)
    setBulkDeleteError(null)
    setSelectedAccountIds(new Set(accounts.map((account) => account.id)))
  }

  const handleSelectReadyAccounts = () => {
    setBulkDeleteNotice(null)
    setBulkDeleteError(null)
    setSelectedAccountIds(new Set(
      accounts
        .filter((account) => isAccountDeleteReady(account))
        .map((account) => account.id),
    ))
  }

  const clearSelectedAccounts = () => {
    setSelectedAccountIds(new Set())
    setBulkDeleteNotice(null)
    setBulkDeleteError(null)
  }

  const selectedAccounts = accounts.filter((account) => selectedAccountIds.has(account.id))
  const readyToDeleteAccounts = selectedAccounts.filter((account) => isAccountDeleteReady(account))
  const blockedSelectedAccounts = selectedAccounts.filter((account) => !isAccountDeleteReady(account))

  const handleBulkDeleteAccounts = () => {
    setBulkDeleteNotice(null)
    setBulkDeleteError(null)

    if (readyToDeleteAccounts.length === 0) {
      setBulkDeleteError('Select at least one account that is ready to delete.')
      return
    }

    setBulkDeleteConfirm(true)
  }

  const confirmBulkDelete = () => {
    setBulkDeleteConfirm(false)
    bulkDeleteMutation.mutate(readyToDeleteAccounts)
  }

  const stopDeploymentMutation = useMutation({
    mutationFn: (id: string) => deploymentsApi.stop(id, 'Manual stop from UI'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Accounts</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage paper and live accounts, then monitor any active deployments below.
          </p>
        </div>
        <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> Add Account
        </button>
      </div>

      {/* Account Management Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Account Management</h2>
          {lastAccountsFetch && (() => {
            const ageSec = Math.floor((now - lastAccountsFetch.getTime()) / 1000)
            const color = ageSec >= 60 ? 'text-red-400' : ageSec >= 30 ? 'text-amber-400' : 'text-gray-500'
            const label = ageSec < 60 ? `${ageSec}s ago` : `${Math.floor(ageSec / 60)}m ${ageSec % 60}s ago`
            return <span className={`text-xs ${color}`}>Updated {label}</span>
          })()}
        </div>
        {accountsLoading ? (
          <div className="card text-sm text-gray-500">Loading accounts...</div>
        ) : accountsError ? (
          <div className="card border-red-800 bg-red-900/20">
            <div className="text-red-400 text-sm">
              Error loading accounts: {(accountsError as Error).message}
            </div>
          </div>
        ) : accounts.length === 0 ? (
          <div className="card text-center py-10">
            <Plus size={36} className="mx-auto text-gray-600 mb-4" />
            <h3 className="text-lg font-semibold text-gray-300 mb-2">No Accounts Yet</h3>
            <p className="text-gray-500 text-sm">
              Add a paper or live account to track open exposure and manage deployments.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="card border-gray-800 bg-gray-950/60">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn-ghost text-xs py-1" onClick={handleSelectAllAccounts}>
                    Select All
                  </button>
                  <button className="btn-ghost text-xs py-1" onClick={handleSelectReadyAccounts}>
                    Select Ready
                  </button>
                  <button
                    className="btn-ghost text-xs py-1"
                    onClick={clearSelectedAccounts}
                    disabled={selectedAccountIds.size === 0}
                  >
                    Clear Selection
                  </button>
                </div>

                <div className="text-xs text-gray-500">
                  {selectedAccounts.length} selected | {readyToDeleteAccounts.length} ready to delete | {blockedSelectedAccounts.length} blocked
                </div>

                <button
                  className={clsx(
                    'btn-danger text-xs flex items-center gap-1 py-1',
                    (readyToDeleteAccounts.length === 0 || bulkDeleteMutation.isPending) && 'opacity-60 cursor-not-allowed',
                  )}
                  onClick={handleBulkDeleteAccounts}
                  disabled={readyToDeleteAccounts.length === 0 || bulkDeleteMutation.isPending}
                >
                  <Trash2 size={12} /> {bulkDeleteMutation.isPending ? 'Deleting Selected...' : `Delete Selected (${readyToDeleteAccounts.length})`}
                </button>
              </div>

              {blockedSelectedAccounts.length > 0 && (
                <div className="mt-3 text-xs text-amber-400">
                  Blocked selections: {blockedSelectedAccounts.map((account) => `${account.name} (${getDeleteSummary(account.activity)})`).join(' | ')}
                </div>
              )}

              {bulkDeleteNotice && (
                <div className="mt-3 text-xs text-green-400">{bulkDeleteNotice}</div>
              )}

              {bulkDeleteError && (
                <div className="mt-3 text-xs text-red-400">{bulkDeleteError}</div>
              )}

              {resumeError && (
                <div className="mt-3 text-xs text-red-400">Resume failed: {resumeError}</div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {accounts.map(a => (
                <AccountCard key={a.id} account={a}
                  onHalt={() => setHaltTarget(a)}
                  onResume={resumeMutation.mutate}
                  onEdit={setEditingAccountId}
                  onRefresh={handleRefreshAccount}
                  onDelete={handleDeleteAccount}
                  onFlatten={() => setFlattenTarget(a)}
                  onEmergencyExit={() => setEmergencyTarget(a)}
                  onSelectionChange={handleSelectionChange}
                  isSelected={selectedAccountIds.has(a.id)}
                  isRefreshing={refreshingIds.has(a.id)}
                  isDeleting={deleteMutation.isPending && deleteMutation.variables === a.id}
                  deleteError={deleteMutation.variables === a.id ? (deleteMutation.error as Error | null)?.message : undefined}
                  isExpanded={expandedAccountIds.has(a.id)}
                  onToggleExpand={() => toggleExpand(a.id)}
                  hasActiveDeployment={activeDeploymentAccountIds.has(a.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {deploymentsError && (
        <div className="card border-red-800 bg-red-900/20">
          <div className="text-red-400 text-sm">
            Error loading deployments: {(deploymentsError as Error).message}
          </div>
        </div>
      )}

      <div className="border-t border-gray-800 pt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Active Deployments</h2>
          {runningDeployments.length === 0 && (
            <button className="btn-primary text-sm" onClick={() => navigate('/deployments')}>
              Start Deployment
            </button>
          )}
        </div>

        {deploymentsLoading && deployments.length === 0 ? (
          <div className="card text-center py-10 text-gray-500">
            Loading deployments...
          </div>
        ) : runningDeployments.length === 0 ? (
          <div className="card text-center py-10">
            <Activity size={40} className="mx-auto text-gray-600 mb-4" />
            <h3 className="text-lg font-semibold text-gray-400 mb-2">No Active Deployments</h3>
            <p className="text-gray-500 text-sm">
              Start a deployment to monitor positions and account activity here.
            </p>
          </div>
        ) : (
          <>
            <div className="border-b border-gray-800">
              <div className="flex overflow-x-auto">
                {runningDeployments.map((deployment) => (
                  <DeploymentTab
                    key={deployment.id}
                    deployment={deployment}
                    isActive={activeTab === deployment.id}
                    onClick={() => setActiveTab(deployment.id)}
                  />
                ))}
              </div>
            </div>

            {activeTab && (() => {
              const dep = runningDeployments.find(d => d.id === activeTab)
              if (!dep) return null
              const acc = accounts.find(a => a.id === dep.account_id)
              return (
                <DeploymentMonitor
                  deployment={dep}
                  account={acc}
                  onStop={stopDeploymentMutation.mutate}
                />
              )
            })()}
          </>
        )}
      </div>

      {showCreate && (
        <CreateAccountModal
          onClose={() => setShowCreate(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['accounts'] })}
        />
      )}

      {editingAccountId && (
        <EditAccountModal
          account={accounts.find(a => a.id === editingAccountId) || null}
          onClose={() => setEditingAccountId(null)}
          onUpdated={() => qc.invalidateQueries({ queryKey: ['accounts'] })}
        />
      )}

      {haltTarget && (
        <ConfirmationModal
          title={`Halt Trading — "${haltTarget.name}"?`}
          variant="warning"
          confirmLabel="Halt Trading"
          isPending={haltMutation.isPending}
          onConfirm={() => haltMutation.mutate(haltTarget.id)}
          onCancel={() => { setHaltTarget(null); haltMutation.reset() }}
          message={
            <div className="space-y-2">
              <p>Blocks all new orders on this {haltTarget.mode.toUpperCase()} account. Open positions are <strong>not</strong> closed.</p>
              {haltTarget.activity && haltTarget.activity.active_deployments > 0 && (
                <p className="text-amber-400">{haltTarget.activity.active_deployments} active deployment(s) will stop placing orders.</p>
              )}
              <p className="text-xs text-gray-500">Click Resume Trading to re-enable at any time.</p>
            </div>
          }
        />
      )}

      {flattenTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) { setFlattenTarget(null); setFlattenConfirmText('') }}}>
          <div className="card w-full max-w-md space-y-4 p-6">
            <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2"><Layers size={14} /> Flatten Account — "{flattenTarget.name}"</h3>
            <div className="text-sm text-gray-300 space-y-2">
              <p>Sends market sell orders for <strong>all {flattenTarget.activity?.open_positions ?? 0} open position(s)</strong> immediately.</p>
              {(flattenTarget.activity?.position_symbols?.length ?? 0) > 0 && (
                <p className="font-mono text-xs text-gray-400">Symbols: {flattenTarget.activity?.position_symbols?.join(', ')}</p>
              )}
              <p className="text-xs text-gray-500">Trading remains active after flatten — this only exits current positions.</p>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Type <span className="font-mono text-amber-300">flatten</span> to confirm</label>
              <input
                className="input w-full"
                value={flattenConfirmText}
                onChange={e => setFlattenConfirmText(e.target.value)}
                placeholder="flatten"
                autoFocus
              />
            </div>
            {flattenMutation.error && <div className="text-xs text-red-400">{(flattenMutation.error as Error).message}</div>}
            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-ghost text-sm" onClick={() => { setFlattenTarget(null); setFlattenConfirmText('') }} disabled={flattenMutation.isPending}>Cancel</button>
              <button
                className="bg-amber-700 hover:bg-amber-600 text-white text-sm px-4 py-2 rounded font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => flattenMutation.mutate(flattenTarget.id)}
                disabled={flattenConfirmText !== 'flatten' || flattenMutation.isPending}
              >
                {flattenMutation.isPending ? 'Flattening…' : 'Flatten All Positions'}
              </button>
            </div>
          </div>
        </div>
      )}

      {emergencyTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) { setEmergencyTarget(null); setEmergencyConfirmText('') }}}>
          <div className="card w-full max-w-md space-y-4 p-6 border-red-800">
            <h3 className="text-sm font-semibold text-red-400 flex items-center gap-2"><AlertTriangle size={14} /> Emergency Exit — "{emergencyTarget.name}"</h3>
            <div className="text-sm text-gray-300 space-y-2">
              <p><strong>Halts trading AND closes all positions immediately.</strong></p>
              {(emergencyTarget.activity?.open_positions ?? 0) > 0 && (
                <p className="text-red-300">Will market-sell <strong>{emergencyTarget.activity?.open_positions} position(s)</strong>: {emergencyTarget.activity?.position_symbols?.join(', ')}</p>
              )}
              {(emergencyTarget.activity?.active_deployments ?? 0) > 0 && (
                <p className="text-amber-400">{emergencyTarget.activity?.active_deployments} active deployment(s) will stop.</p>
              )}
              {emergencyTarget.mode === 'live' && (
                <p className="text-red-400 font-semibold">This is a LIVE account — orders will execute at market price.</p>
              )}
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Type <span className="font-mono text-red-300">exit</span> to confirm</label>
              <input
                className="input w-full border-red-800 focus:border-red-600"
                value={emergencyConfirmText}
                onChange={e => setEmergencyConfirmText(e.target.value)}
                placeholder="exit"
                autoFocus
              />
            </div>
            {emergencyMutation.error && <div className="text-xs text-red-400">{(emergencyMutation.error as Error).message}</div>}
            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-ghost text-sm" onClick={() => { setEmergencyTarget(null); setEmergencyConfirmText('') }} disabled={emergencyMutation.isPending}>Cancel</button>
              <button
                className="btn-danger text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => emergencyMutation.mutate(emergencyTarget.id)}
                disabled={emergencyConfirmText !== 'exit' || emergencyMutation.isPending}
              >
                {emergencyMutation.isPending ? 'Executing…' : 'Emergency Exit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmationModal
          title={`Delete Account "${deleteTarget.name}"?`}
          variant="danger"
          confirmLabel="Delete Permanently"
          isPending={deleteMutation.isPending}
          onConfirm={confirmDeleteAccount}
          onCancel={() => { setDeleteTarget(null); deleteMutation.reset() }}
          message={
            <div className="space-y-2">
              <p>This will permanently remove the <strong>{deleteTarget.mode.toUpperCase()}</strong> account and all its data.</p>
              {(deleteTarget.activity?.deployment_count ?? 0) > 0 && (
                <p className="text-amber-400">{deleteTarget.activity!.deployment_count} historical deployment(s) will also be removed.</p>
              )}
              <p className="text-xs text-gray-500">This action cannot be undone.</p>
            </div>
          }
        />
      )}

      {bulkDeleteConfirm && (
        <ConfirmationModal
          title={`Delete ${readyToDeleteAccounts.length} Account${readyToDeleteAccounts.length === 1 ? '' : 's'}?`}
          variant="danger"
          confirmLabel={`Delete ${readyToDeleteAccounts.length} Account${readyToDeleteAccounts.length === 1 ? '' : 's'}`}
          isPending={bulkDeleteMutation.isPending}
          onConfirm={confirmBulkDelete}
          onCancel={() => setBulkDeleteConfirm(false)}
          message={
            <div className="space-y-2">
              <p>Deleting: {formatAccountNames(readyToDeleteAccounts)}</p>
              {blockedSelectedAccounts.length > 0 && (
                <p className="text-amber-400">{blockedSelectedAccounts.length} blocked account(s) will be skipped.</p>
              )}
              <p className="text-xs text-gray-500">This action cannot be undone.</p>
            </div>
          }
        />
      )}
    </div>
  )
}
