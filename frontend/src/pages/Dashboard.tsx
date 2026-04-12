import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, Shield, Zap, AlertTriangle,
  Activity, Database, BarChart2, ArrowRight, CheckCircle2,
  XCircle, Clock, DollarSign, Layers, Radio,
} from 'lucide-react'
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts'
import { accountsApi, controlApi } from '../api/accounts'
import { backtestsApi } from '../api/backtests'
import { useKillSwitchStore } from '../stores/useKillSwitchStore'
import { ModeIndicator } from '../components/ModeIndicator'
import { deploymentsApi } from '../api/accounts'
import clsx from 'clsx'
import type { Account } from '../types'

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'default',
  to,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color?: 'default' | 'green' | 'red' | 'amber' | 'sky' | 'indigo'
  to?: string
}) {
  const colors = {
    default: 'text-gray-100',
    green:   'text-emerald-400',
    red:     'text-red-400',
    amber:   'text-amber-400',
    sky:     'text-sky-400',
    indigo:  'text-indigo-400',
  }
  const iconColors = {
    default: 'text-gray-500',
    green:   'text-emerald-500',
    red:     'text-red-500',
    amber:   'text-amber-500',
    sky:     'text-sky-500',
    indigo:  'text-indigo-500',
  }
  const content = (
    <div className={clsx(
      'card flex items-start gap-3 transition-all',
      to && 'hover:border-gray-600 cursor-pointer group'
    )}>
      <div className={clsx('mt-0.5 flex-shrink-0', iconColors[color])}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</div>
        <div className={clsx('text-2xl font-bold leading-none', colors[color])}>{value}</div>
        {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
      </div>
      {to && <ArrowRight size={14} className="text-gray-700 group-hover:text-gray-400 mt-1 flex-shrink-0 transition-colors" />}
    </div>
  )
  return to ? <Link to={to}>{content}</Link> : content
}

function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', active ? 'bg-emerald-400' : 'bg-gray-600')} />
      <span className={active ? 'text-gray-300' : 'text-gray-600'}>{label}</span>
    </span>
  )
}

const EQUITY_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function Dashboard() {
  const { status: ksStatus, platformMode } = useKillSwitchStore()

  const { data: accounts = [], isFetching: accountsFetching, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(true),
    refetchInterval: 20_000,
  })

  const { data: recentRuns = [], isLoading: runsLoading } = useQuery({
    queryKey: ['backtests-recent'],
    queryFn: () => backtestsApi.list(undefined, 8),
    refetchInterval: 30_000,
  })

  const { data: deployments = [], isLoading: deploymentsLoading } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => deploymentsApi.list(),
    refetchInterval: 15_000,
  })

  // Derived stats
  const paperAccounts = accounts.filter(a => a.mode === 'paper')
  const liveAccounts  = accounts.filter(a => a.mode === 'live')
  const accountEquity = (a: Account) => a.equity ?? a.current_balance ?? 0
  const totalEquity   = accounts.reduce((s, a) => s + accountEquity(a), 0)
  const activeDeployments = deployments.filter((d: any) =>
    d.status === 'running' || d.status === 'paused'
  )

  const completedRuns = recentRuns.filter(r => r.status === 'completed')
  const avgReturn = completedRuns.length
    ? completedRuns.reduce((s, r) => s + (r.metrics?.total_return_pct ?? 0), 0) / completedRuns.length
    : null

  // Chart data: returns bar chart
  const returnChartData = completedRuns.slice(0, 8).map((r, i) => ({
    name: (r.symbols ?? []).join(',').slice(0, 8) || `Run ${i + 1}`,
    return: Number((r.metrics?.total_return_pct ?? 0).toFixed(2)),
    sharpe: Number((r.metrics?.sharpe_ratio ?? 0).toFixed(2)),
  }))

  // Equity pie
  const equityPieData = accounts
    .filter(a => accountEquity(a) > 0)
    .map((a, i) => ({ name: a.name, value: accountEquity(a), color: EQUITY_COLORS[i % EQUITY_COLORS.length] }))

  return (
    <div className="space-y-6">
      {/* Kill switch banner */}
      {ksStatus?.global_killed && (
        <div className="bg-red-950 border border-red-700 rounded-lg p-4 flex items-center gap-3 animate-pulse">
          <AlertTriangle className="text-red-400 flex-shrink-0" size={20} />
          <div>
            <div className="font-bold text-red-300 text-sm tracking-wide">ALL TRADING STOPPED</div>
            <div className="text-xs text-red-500 mt-0.5">{ksStatus.global_kill_reason}</div>
          </div>
          <div className="ml-auto">
            <Link to="/accounts" className="text-xs text-red-400 hover:text-red-300 underline">
              Manage →
            </Link>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 tracking-tight">Dashboard</h1>
          <p className="text-xs text-gray-500 mt-1">
            UltraTrader 2026 · {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ModeIndicator mode={platformMode} animated />
        </div>
      </div>

      {/* Top KPI row */}
      {(accountsLoading || deploymentsLoading) ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card animate-pulse">
              <div className="h-3 bg-gray-700 rounded w-1/2 mb-3" />
              <div className="h-7 bg-gray-600 rounded w-3/4 mb-2" />
              <div className="h-2 bg-gray-700 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={DollarSign}
          label="Total Equity"
          value={`$${totalEquity.toLocaleString('en', { maximumFractionDigits: 0 })}`}
          sub={accountsFetching ? '⟳ refreshing…' : `${accounts.length} account${accounts.length !== 1 ? 's' : ''}`}
          color="sky"
          to="/accounts"
        />
        <StatCard
          icon={Radio}
          label="Active Deployments"
          value={activeDeployments.length}
          sub={`${paperAccounts.length} paper · ${liveAccounts.length} live`}
          color={activeDeployments.length > 0 ? 'green' : 'default'}
          to="/monitor"
        />
        <StatCard
          icon={BarChart2}
          label="Backtest Runs"
          value={recentRuns.length}
          sub={avgReturn != null ? `avg ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(1)}% return` : 'No completed runs'}
          color={avgReturn != null && avgReturn > 0 ? 'green' : avgReturn != null ? 'red' : 'default'}
          to="/runs"
        />
        <StatCard
          icon={Layers}
          label="Kill Switch"
          value={ksStatus?.global_killed ? 'ACTIVE' : 'Safe'}
          sub={ksStatus?.killed_strategies?.length ? `${ksStatus.killed_strategies.length} strategies killed` : 'All strategies running'}
          color={ksStatus?.global_killed ? 'red' : 'green'}
        />
      </div>
      )}

      {/* Middle row: charts */}
      <div className="grid md:grid-cols-5 gap-4">
        {/* Return chart */}
        <div className="card md:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-200">Recent Backtest Returns</h2>
            <Link to="/runs" className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
              All runs <ArrowRight size={12} />
            </Link>
          </div>
          {runsLoading ? (
            <div className="h-40 animate-pulse space-y-2">
              <div className="flex items-end gap-1 h-32">
                {[40, 70, 55, 85, 45, 90, 60, 75].map((h, i) => (
                  <div key={i} className="flex-1 bg-gray-700 rounded-t" style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="h-2 bg-gray-700 rounded w-full" />
            </div>
          ) : returnChartData.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-gray-600">
              <TrendingUp size={28} className="mb-2" />
              <p className="text-sm">No completed backtests yet</p>
              <Link to="/backtest" className="text-xs text-sky-400 mt-2 hover:underline">
                Launch your first backtest →
              </Link>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={returnChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} unit="%" />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                  formatter={(v: number) => [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, 'Return']}
                />
                <Bar
                  dataKey="return"
                  radius={[3, 3, 0, 0]}
                  fill="#10b981"
                  // Color bars by positive/negative
                >
                  {returnChartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.return >= 0 ? '#10b981' : '#ef4444'}
                      fillOpacity={0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Equity allocation pie */}
        <div className="card md:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-200">Equity Allocation</h2>
            <Link to="/accounts" className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
              Manage <ArrowRight size={12} />
            </Link>
          </div>
          {equityPieData.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-gray-600">
              <Shield size={28} className="mb-2" />
              <p className="text-sm">No accounts</p>
              <Link to="/accounts" className="text-xs text-sky-400 mt-2 hover:underline">
                Add account →
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={130}>
                <PieChart>
                  <Pie
                    data={equityPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={32}
                    outerRadius={56}
                    paddingAngle={3}
                  >
                    {equityPieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                    formatter={(v: number) => [`$${v.toLocaleString()}`, 'Equity']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
                {equityPieData.map(d => (
                  <span key={d.name} className="flex items-center gap-1 text-xs text-gray-400">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    {d.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Accounts table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-300">Accounts</h2>
          <Link to="/accounts" className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {accounts.length === 0 ? (
          <div className="card text-center py-8">
            <Shield size={28} className="text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 mb-3">No accounts configured yet</p>
            <Link to="/accounts" className="btn-primary text-xs inline-block">
              Add Account →
            </Link>
          </div>
        ) : (
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Account</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Mode</th>
                  <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Equity</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Broker</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map(a => (
                  <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-200">{a.name}</td>
                    <td className="px-4 py-3">
                      <ModeIndicator mode={a.mode} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-200">
                      ${accountEquity(a).toLocaleString('en', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{a.broker ?? 'Paper'}</td>
                    <td className="px-4 py-3">
                      {a.is_killed ? (
                        <span className="badge badge-red flex items-center gap-1 w-fit">
                          <XCircle size={10} /> Killed
                        </span>
                      ) : a.is_enabled ? (
                        <span className="badge badge-green flex items-center gap-1 w-fit">
                          <CheckCircle2 size={10} /> Active
                        </span>
                      ) : (
                        <span className="badge badge-gray flex items-center gap-1 w-fit">
                          <Clock size={10} /> Disabled
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent backtest runs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-300">Recent Backtest Runs</h2>
          <Link to="/runs" className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
            View all <ArrowRight size={12} />
          </Link>
        </div>

        {recentRuns.length === 0 ? (
          <div className="card text-center py-8">
            <TrendingUp size={28} className="text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 mb-3">No backtest runs yet</p>
            <Link to="/backtest" className="btn-primary text-xs inline-block">
              Launch First Backtest →
            </Link>
          </div>
        ) : (
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Symbols</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Timeframe</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Period</th>
                  <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Return</th>
                  <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Sharpe</th>
                  <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Win%</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map(run => {
                  const ret = run.metrics?.total_return_pct
                  const sharpe = run.metrics?.sharpe_ratio
                  const winRate = run.metrics?.win_rate_pct
                  return (
                    <tr key={run.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/runs/${run.id}`} className="text-sky-400 hover:text-sky-300 font-medium">
                          {(run.symbols ?? []).join(', ') || '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs font-mono">{run.timeframe}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {run.start_date} → {run.end_date}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {ret != null ? (
                          <span className={ret >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
                          </span>
                        ) : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-400 text-xs">
                        {sharpe != null ? sharpe.toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-400 text-xs">
                        {winRate != null ? `${winRate.toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('badge', {
                          'badge-green':  run.status === 'completed',
                          'badge-red':    run.status === 'failed',
                          'badge-gray':   run.status === 'pending',
                          'bg-sky-900/60 text-sky-300': run.status === 'running',
                        })}>
                          {run.status === 'running' && (
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping inline-block mr-1" />
                          )}
                          {run.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick actions footer */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: '/strategies/new', icon: Layers,    label: 'New Strategy',   sub: 'Build a trading strategy' },
          { to: '/backtest',       icon: TrendingUp, label: 'Run Backtest',   sub: 'Test against history' },
          { to: '/data',           icon: Database,   label: 'Manage Data',    sub: 'Download historical data' },
          { to: '/deployments',    icon: Zap,        label: 'Deploy',         sub: 'Go paper or live' },
        ].map(({ to, icon: Icon, label, sub }) => (
          <Link
            key={to}
            to={to}
            className="card flex items-center gap-3 hover:border-gray-600 hover:bg-gray-800/50 transition-all group"
          >
            <div className="text-sky-500 group-hover:text-sky-400 transition-colors">
              <Icon size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-200">{label}</div>
              <div className="text-xs text-gray-500">{sub}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
