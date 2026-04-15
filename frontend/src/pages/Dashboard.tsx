import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, Shield, Zap, AlertTriangle,
  Activity, Database, BarChart2, ArrowRight, CheckCircle2,
  XCircle, Clock, DollarSign, Layers, Radio, Key,
} from 'lucide-react'
import {
  ResponsiveContainer, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Cell, ReferenceLine,
} from 'recharts'
import { accountsApi, controlApi } from '../api/accounts'
import { backtestsApi } from '../api/backtests'
import { strategiesApi } from '../api/strategies'
import { useKillSwitchStore } from '../stores/useKillSwitchStore'
import { usePollingGate } from '../hooks/usePollingGate'
import { ModeIndicator } from '../components/ModeIndicator'
import { deploymentsApi } from '../api/accounts'
import clsx from 'clsx'
import type { Account } from '../types'

// ── Theming helpers ───────────────────────────────────────────────────────────

const V = (name: string) => `var(${name})`

// ── Stat card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = 'default',
  to,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  accent?: 'default' | 'green' | 'red' | 'amber' | 'sky' | 'indigo' | 'live'
  to?: string
}) {
  const accentColor: Record<string, string> = {
    default: V('--color-text-primary'),
    green:   V('--color-success'),
    red:     V('--color-danger'),
    amber:   V('--color-warning'),
    sky:     V('--color-accent'),
    indigo:  '#818cf8',
    live:    V('--color-mode-live'),
  }
  const iconColor = accentColor[accent] ?? accentColor.default

  const inner = (
    <div
      className={clsx('card flex items-start gap-3 transition-all', to && 'hover:brightness-110 cursor-pointer group')}
      style={to ? { borderColor: 'var(--color-border)' } : undefined}
    >
      <div className="mt-0.5 flex-shrink-0" style={{ color: iconColor }}><Icon size={18} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide mb-1" style={{ color: V('--color-text-faint') }}>{label}</div>
        <div className="text-2xl font-bold leading-none" style={{ color: accentColor[accent] }}>{value}</div>
        {sub && <div className="text-xs mt-1" style={{ color: V('--color-text-muted') }}>{sub}</div>}
      </div>
      {to && <ArrowRight size={14} className="mt-1 flex-shrink-0 transition-colors" style={{ color: V('--color-text-faint') }} />}
    </div>
  )
  return to ? <Link to={to}>{inner}</Link> : inner
}

function SectionHeader({ title, to, linkLabel = 'View all' }: { title: string; to?: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold" style={{ color: V('--color-text-primary') }}>{title}</h2>
      {to && (
        <Link to={to} className="text-xs flex items-center gap-1 transition-colors hover:opacity-80" style={{ color: V('--color-accent') }}>
          {linkLabel} <ArrowRight size={12} />
        </Link>
      )}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function Dashboard() {
  const { status: ksStatus, platformMode } = useKillSwitchStore()
  const pausePolling = usePollingGate()

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(true),
    refetchInterval: pausePolling ? false : 20_000,
  })

  const { data: recentRuns = [], isLoading: runsLoading } = useQuery({
    queryKey: ['backtests-recent'],
    queryFn: () => backtestsApi.list(undefined, 8),
    refetchInterval: pausePolling ? false : 30_000,
  })

  const { data: deployments = [], isLoading: deploymentsLoading } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => deploymentsApi.list(),
    refetchInterval: pausePolling ? false : 15_000,
  })

  const { data: strategies = [] } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
    staleTime: 60_000,
  })

  // Strategy name lookup for runs table
  const strategyNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    strategies.forEach((s: any) => {
      for (const v of (s.versions ?? [])) {
        map[v.id] = s.name
      }
    })
    return map
  }, [strategies])

  // Derived
  const paperAccounts  = accounts.filter((a: Account) => a.mode === 'paper')
  const liveAccounts   = accounts.filter((a: Account) => a.mode === 'live')
  const accountEquity  = (a: Account) => a.equity ?? a.current_balance ?? 0
  const paperEquity    = paperAccounts.reduce((s: number, a: Account) => s + accountEquity(a), 0)
  const liveEquity     = liveAccounts.reduce((s: number, a: Account) => s + accountEquity(a), 0)
  const paperUnreal    = paperAccounts.reduce((s: number, a: Account) => s + (a.unrealized_pnl ?? 0), 0)
  const liveUnreal     = liveAccounts.reduce((s: number, a: Account) => s + (a.unrealized_pnl ?? 0), 0)
  const activeDeployments = deployments.filter((d: any) => d.status === 'running' || d.status === 'paused')

  const completedRuns = recentRuns.filter((r: any) => r.status === 'completed')
  const runsWithTrades = completedRuns.filter((r: any) => (r.metrics?.total_trades ?? 0) > 0)
  const avgReturn = runsWithTrades.length
    ? runsWithTrades.reduce((s: number, r: any) => s + (r.metrics?.total_return_pct ?? 0), 0) / runsWithTrades.length
    : null

  // Bar chart: only runs with trades, most recent 8
  const returnChartData = runsWithTrades.slice(0, 8).map((r: any, i: number) => ({
    name: (r.symbols ?? []).join(',').slice(0, 10) || `Run ${i + 1}`,
    return: Number((r.metrics?.total_return_pct ?? 0).toFixed(2)),
  }))

  const isNewUser = !accountsLoading && accounts.length === 0 && strategies.length === 0 && recentRuns.length === 0

  return (
    <div className="space-y-6 max-w-6xl">

      {/* Kill switch banner */}
      {ksStatus?.global_killed && (
        <div
          className="rounded-lg p-4 flex items-center gap-3 animate-pulse"
          style={{ background: 'color-mix(in srgb, var(--color-danger) 15%, transparent)', border: '1px solid var(--color-danger)' }}
        >
          <AlertTriangle style={{ color: V('--color-danger') }} size={20} className="flex-shrink-0" />
          <div>
            <div className="font-bold text-sm tracking-wide" style={{ color: V('--color-danger') }}>ALL TRADING STOPPED</div>
            <div className="text-xs mt-0.5" style={{ color: V('--color-text-muted') }}>{ksStatus.global_kill_reason}</div>
          </div>
          <Link to="/accounts" className="ml-auto text-xs underline hover:opacity-80" style={{ color: V('--color-danger') }}>
            Manage →
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: V('--color-text-primary') }}>Dashboard</h1>
          <p className="text-xs mt-1" style={{ color: V('--color-text-faint') }}>
            UltraTrader 2026 · {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <ModeIndicator mode={platformMode} animated />
      </div>

      {/* Getting Started */}
      {isNewUser && (
        <div className="rounded-xl p-4 space-y-4" style={{ border: '1px solid var(--color-accent-dim)', background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: V('--color-accent') }}>Getting Started with UltraTrader</h2>
            <p className="text-xs mt-1" style={{ color: V('--color-text-muted') }}>Follow these steps to run your first backtest and paper trade.</p>
          </div>
          <div className="grid md:grid-cols-4 gap-3">
            {[
              { step: 1, label: 'Add Credentials', desc: 'Connect Alpaca paper account.', to: '/security', icon: Key, done: false },
              { step: 2, label: 'Create Strategy',  desc: 'Define entry/exit/risk rules.', to: '/strategies/new', icon: Layers, done: strategies.length > 0 },
              { step: 3, label: 'Run Backtest',     desc: 'Validate against history.',     to: '/backtest', icon: TrendingUp, done: recentRuns.length > 0 },
              { step: 4, label: 'Deploy to Paper',  desc: 'Go live on paper account.',     to: '/deployments', icon: Zap, done: deployments.length > 0 },
            ].map(({ step, label, desc, to, icon: Icon, done }) => (
              <Link
                key={step}
                to={to}
                className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-all hover:brightness-110"
                style={{
                  border: `1px solid ${done ? 'var(--color-success)' : 'var(--color-border)'}`,
                  background: done ? 'color-mix(in srgb, var(--color-success) 8%, transparent)' : 'var(--color-bg-hover)',
                }}
              >
                <span
                  className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                  style={{
                    background: done ? V('--color-success') : V('--color-bg-card'),
                    color: done ? '#fff' : V('--color-text-faint'),
                    border: `1px solid ${done ? 'var(--color-success)' : 'var(--color-border)'}`,
                  }}
                >
                  {done ? '✓' : step}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold" style={{ color: done ? V('--color-success') : V('--color-text-primary') }}>{label}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: V('--color-text-faint') }}>{desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* KPI row */}
      {(accountsLoading || deploymentsLoading) ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[0,1,2,3,4].map(i => (
            <div key={i} className="card animate-pulse" style={{ height: 88 }}>
              <div className="h-2.5 rounded w-1/2 mb-3" style={{ background: V('--color-bg-hover') }} />
              <div className="h-7 rounded w-3/4 mb-2" style={{ background: V('--color-border') }} />
              <div className="h-2 rounded w-1/3" style={{ background: V('--color-bg-hover') }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {/* Paper equity */}
          <Link
            to="/accounts"
            className="card flex items-start gap-3 transition-all hover:brightness-110 cursor-pointer group"
            style={{ opacity: paperAccounts.length === 0 ? 0.5 : 1 }}
          >
            <div className="mt-0.5 flex-shrink-0" style={{ color: V('--color-accent') }}><DollarSign size={18} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wide mb-1" style={{ color: V('--color-text-faint') }}>Paper Equity</div>
              <div className="text-2xl font-bold leading-none" style={{ color: V('--color-accent') }}>
                ${paperEquity.toLocaleString('en', { maximumFractionDigits: 0 })}
              </div>
              <div className="text-xs mt-1 font-mono" style={{ color: paperUnreal >= 0 ? V('--color-success') : V('--color-danger') }}>
                {paperAccounts.length === 0
                  ? <span style={{ color: V('--color-text-faint') }}>no paper accounts</span>
                  : paperUnreal !== 0
                    ? `${paperUnreal >= 0 ? '+' : ''}$${Math.abs(paperUnreal).toLocaleString('en', { maximumFractionDigits: 0 })} open P&L`
                    : <span style={{ color: V('--color-text-faint') }}>{paperAccounts.length} account{paperAccounts.length !== 1 ? 's' : ''}</span>}
              </div>
            </div>
            <ArrowRight size={14} className="mt-1 flex-shrink-0" style={{ color: V('--color-text-faint') }} />
          </Link>

          {/* Live equity */}
          <Link
            to="/accounts"
            className="card flex items-start gap-3 transition-all hover:brightness-110 cursor-pointer group"
            style={{ opacity: liveAccounts.length === 0 ? 0.5 : 1 }}
          >
            <div className="mt-0.5 flex-shrink-0" style={{ color: V('--color-mode-live') }}><DollarSign size={18} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wide mb-1" style={{ color: V('--color-text-faint') }}>Live Equity</div>
              <div className="text-2xl font-bold leading-none" style={{ color: V('--color-mode-live') }}>
                {liveAccounts.length === 0 ? '—' : `$${liveEquity.toLocaleString('en', { maximumFractionDigits: 0 })}`}
              </div>
              <div className="text-xs mt-1 font-mono" style={{ color: liveUnreal >= 0 ? V('--color-success') : V('--color-danger') }}>
                {liveAccounts.length === 0
                  ? <span style={{ color: V('--color-text-faint') }}>no live accounts</span>
                  : liveUnreal !== 0
                    ? `${liveUnreal >= 0 ? '+' : ''}$${Math.abs(liveUnreal).toLocaleString('en', { maximumFractionDigits: 0 })} open P&L`
                    : <span style={{ color: V('--color-text-faint') }}>{liveAccounts.length} account{liveAccounts.length !== 1 ? 's' : ''}</span>}
              </div>
            </div>
            <ArrowRight size={14} className="mt-1 flex-shrink-0" style={{ color: V('--color-text-faint') }} />
          </Link>

          <KpiCard
            icon={Radio}
            label="Active Deployments"
            value={activeDeployments.length}
            sub={`${paperAccounts.length} paper · ${liveAccounts.length} live acct${liveAccounts.length !== 1 ? 's' : ''}`}
            accent={activeDeployments.length > 0 ? 'green' : 'default'}
            to="/monitor"
          />
          <KpiCard
            icon={BarChart2}
            label="Backtest Runs"
            value={recentRuns.length}
            sub={avgReturn != null ? `avg ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(1)}%` : `${completedRuns.length} completed`}
            accent={avgReturn != null && avgReturn > 0 ? 'green' : avgReturn != null && avgReturn < 0 ? 'red' : 'default'}
            to="/runs"
          />
          <KpiCard
            icon={Shield}
            label="Kill Switch"
            value={ksStatus?.global_killed ? 'ACTIVE' : 'Safe'}
            sub={ksStatus?.killed_strategies?.length ? `${ksStatus.killed_strategies.length} strategies killed` : 'All systems go'}
            accent={ksStatus?.global_killed ? 'red' : 'green'}
          />
        </div>
      )}

      {/* Charts row */}
      <div className="grid md:grid-cols-5 gap-4">

        {/* Return bar chart */}
        <div className="card md:col-span-3">
          <SectionHeader title="Recent Backtest Returns" to="/runs" linkLabel="All runs" />
          {runsLoading ? (
            <div className="h-44 flex items-end gap-1 px-2">
              {[40,70,55,85,45,90,60,75].map((h, i) => (
                <div key={i} className="flex-1 rounded-t animate-pulse" style={{ height: `${h}%`, background: V('--color-bg-hover') }} />
              ))}
            </div>
          ) : returnChartData.length === 0 ? (
            <div className="h-44 flex flex-col items-center justify-center gap-2" style={{ color: V('--color-text-faint') }}>
              <TrendingUp size={28} />
              <p className="text-sm">No completed runs with trades yet</p>
              <Link to="/backtest" className="text-xs hover:underline" style={{ color: V('--color-accent') }}>
                Launch your first backtest →
              </Link>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={176}>
              <BarChart data={returnChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-text-faint)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-faint)' }} unit="%" />
                <ReferenceLine y={0} stroke="var(--color-border)" strokeWidth={1.5} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    fontSize: 12,
                    color: 'var(--color-text-primary)',
                  }}
                  formatter={(v: number) => [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, 'Return']}
                />
                <Bar dataKey="return" radius={[3, 3, 0, 0]}>
                  {returnChartData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.return >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}
                      fillOpacity={0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Accounts summary */}
        <div className="card md:col-span-2 flex flex-col gap-3">
          <SectionHeader title="Equity Allocation" to="/accounts" linkLabel="Manage" />
          {accounts.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 py-6" style={{ color: V('--color-text-faint') }}>
              <Shield size={28} />
              <p className="text-sm">No accounts yet</p>
              <Link to="/accounts" className="text-xs hover:underline" style={{ color: V('--color-accent') }}>Add account →</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.slice(0, 5).map((a: Account, i: number) => {
                const eq = accountEquity(a)
                const totalEq = accounts.reduce((s: number, acc: Account) => s + accountEquity(acc), 0)
                const pct = totalEq > 0 ? (eq / totalEq) * 100 : 0
                const colors = ['var(--color-accent)', 'var(--color-success)', 'var(--color-warning)', '#8b5cf6', '#ec4899']
                const color = colors[i % colors.length]
                return (
                  <div key={a.id}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium truncate max-w-[120px]" style={{ color: V('--color-text-primary') }}>{a.name}</span>
                      <div className="flex items-center gap-2">
                        <span style={{ color: V('--color-text-muted') }}>${eq.toLocaleString('en', { maximumFractionDigits: 0 })}</span>
                        <span className="tabular-nums" style={{ color: V('--color-text-faint') }}>{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: V('--color-bg-hover') }}>
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                )
              })}
              {accounts.length > 5 && (
                <p className="text-xs text-center pt-1" style={{ color: V('--color-text-faint') }}>
                  +{accounts.length - 5} more accounts
                </p>
              )}
              <div className="pt-2 mt-1 flex justify-between text-xs font-mono" style={{ borderTop: '1px solid var(--color-border)', color: V('--color-text-muted') }}>
                <span>Total</span>
                <span style={{ color: V('--color-text-primary') }}>
                  ${accounts.reduce((s: number, a: Account) => s + accountEquity(a), 0).toLocaleString('en', { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent backtest runs table */}
      <div>
        <SectionHeader title="Recent Backtest Runs" to="/runs" />
        {recentRuns.length === 0 ? (
          <div className="card text-center py-8">
            <TrendingUp size={28} className="mx-auto mb-2" style={{ color: V('--color-text-faint') }} />
            <p className="text-sm mb-3" style={{ color: V('--color-text-muted') }}>No backtest runs yet</p>
            <Link to="/backtest" className="btn-primary text-xs inline-block">Launch First Backtest →</Link>
          </div>
        ) : (
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-hover)' }}>
                  {['Symbols', 'Strategy', 'TF', 'Period', 'Return', 'Sharpe', 'Trades', 'Status'].map(h => (
                    <th
                      key={h}
                      className={clsx('px-4 py-2.5 text-xs font-medium uppercase tracking-wide', h === 'Return' || h === 'Sharpe' || h === 'Trades' ? 'text-right' : 'text-left')}
                      style={{ color: V('--color-text-faint') }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run: any) => {
                  const ret = run.metrics?.total_return_pct
                  const sharpe = run.metrics?.sharpe_ratio
                  const trades = run.metrics?.total_trades ?? 0
                  const noTrades = run.status === 'completed' && trades === 0
                  const stratName = strategyNameMap[run.strategy_version_id ?? '']
                  return (
                    <tr
                      key={run.id}
                      style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 60%, transparent)' }}
                      className="transition-colors hover:brightness-110"
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td className="px-4 py-2.5">
                        <Link to={`/runs/${run.id}`} className="font-medium hover:underline" style={{ color: V('--color-accent') }}>
                          {(run.symbols ?? []).join(', ') || '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-xs max-w-[120px] truncate" style={{ color: V('--color-text-muted') }}>
                        {stratName ?? <span style={{ color: V('--color-text-faint') }}>—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono" style={{ color: V('--color-text-muted') }}>{run.timeframe}</td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: V('--color-text-faint') }}>
                        {run.start_date?.slice(0, 7)} → {run.end_date?.slice(0, 7)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">
                        {noTrades
                          ? <span style={{ color: V('--color-text-faint') }}>no trades</span>
                          : ret != null
                            ? <span style={{ color: ret >= 0 ? V('--color-success') : V('--color-danger') }}>{ret >= 0 ? '+' : ''}{ret.toFixed(1)}%</span>
                            : <span style={{ color: V('--color-text-faint') }}>—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs" style={{ color: V('--color-text-muted') }}>
                        {!noTrades && sharpe != null ? sharpe.toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs" style={{ color: V('--color-text-muted') }}>
                        {run.status === 'completed' ? trades : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <RunStatusBadge status={run.status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: '/strategies/new', icon: Layers,    label: 'New Strategy', sub: 'Build entry/exit rules' },
          { to: '/backtest',       icon: TrendingUp, label: 'Run Backtest', sub: 'Test against history' },
          { to: '/data',           icon: Database,   label: 'Manage Data',  sub: 'Download historical bars' },
          { to: '/deployments',    icon: Zap,        label: 'Deploy',       sub: 'Go paper or live' },
        ].map(({ to, icon: Icon, label, sub }) => (
          <Link
            key={to}
            to={to}
            className="card flex items-center gap-3 transition-all cursor-pointer hover:brightness-110"
          >
            <Icon size={18} style={{ color: V('--color-accent'), flexShrink: 0 }} />
            <div>
              <div className="text-sm font-semibold" style={{ color: V('--color-text-primary') }}>{label}</div>
              <div className="text-xs" style={{ color: V('--color-text-faint') }}>{sub}</div>
            </div>
          </Link>
        ))}
      </div>

    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    completed: { bg: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)',    label: 'completed' },
    failed:    { bg: 'color-mix(in srgb, var(--color-danger)  15%, transparent)', color: 'var(--color-danger)',     label: 'failed'    },
    running:   { bg: 'color-mix(in srgb, var(--color-accent)  15%, transparent)', color: 'var(--color-accent)',     label: 'running'   },
    pending:   { bg: 'color-mix(in srgb, var(--color-text-faint) 15%, transparent)', color: 'var(--color-text-muted)', label: 'pending' },
    cancelled: { bg: 'color-mix(in srgb, var(--color-text-faint) 10%, transparent)', color: 'var(--color-text-faint)', label: 'cancelled' },
  }
  const s = styles[status] ?? styles.pending
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      {status === 'running' && (
        <span className="w-1.5 h-1.5 rounded-full animate-ping inline-block" style={{ background: s.color }} />
      )}
      {s.label}
    </span>
  )
}
