import React, { useMemo, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { backtestsApi } from '../api/backtests'
import { deploymentsApi, accountsApi } from '../api/accounts'
import { EquityCurve } from '../components/Charts/EquityCurve'
import { DrawdownChart } from '../components/Charts/DrawdownChart'
import { MonthlyHeatmap } from '../components/Charts/MonthlyHeatmap'
import { TradeEntryExitChart } from '../components/Charts/TradeEntryExitChart'
import { ModeIndicator } from '../components/ModeIndicator'
import clsx from 'clsx'
import type { Account, BacktestRun, CompareRunsResponse } from '../types'
import type { Trade } from '../types'

function Metric({ label, value, color }: { label: string; value: string | number | undefined; color?: string }) {
  if (value === undefined || value === null) return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value text-gray-600">—</div>
    </div>
  )
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={clsx('metric-value', color ?? 'neutral')}>{value}</div>
    </div>
  )
}

function fmt(v: number | undefined | null, decimals = 1): string {
  if (v === undefined || v === null) return '—'
  return v.toFixed(decimals)
}

function fmtPct(v: number | undefined | null): string {
  if (v === undefined || v === null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

type Tab = 'overview' | 'equity' | 'trades' | 'monthly' | 'monte_carlo' | 'promote'

export function RunDetails() {
  const { runId } = useParams<{ runId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const compareRunId = searchParams.get('compare') || ''
  const [tab, setTab] = useState<Tab>('overview')
  const [promotingToPaper, setPromotingToPaper] = useState(false)
  const [tradeChartSymbol, setTradeChartSymbol] = useState('ALL')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [promoteNotes, setPromoteNotes] = useState('')
  const [promoteSuccess, setPromoteSuccess] = useState<string | null>(null)
  const [promoteError, setPromoteError] = useState<string | null>(null)

  const { data: run, isLoading, error: runError } = useQuery<BacktestRun>({
    queryKey: ['run', runId],
    queryFn: () => backtestsApi.get(runId!),
    enabled: !!runId,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 5000 : false),
  })

  const { data: equityCurveData } = useQuery({
    queryKey: ['equity-curve', runId],
    queryFn: () => backtestsApi.getEquityCurve(runId!),
    enabled: !!runId && run?.status === 'completed',
  })

  const { data: trades = [] } = useQuery({
    queryKey: ['trades', runId],
    queryFn: () => backtestsApi.getTrades(runId!),
    enabled: !!runId && tab === 'trades' && run?.status === 'completed',
  })

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
    enabled: tab === 'promote',
  })

  const sortedTrades = useMemo(
    () => [...trades].sort((a: Trade, b: Trade) => (b.entry_time ?? '').localeCompare(a.entry_time ?? '')),
    [trades],
  )

  const { data: compareData, error: compareError } = useQuery<CompareRunsResponse>({
    queryKey: ['run-compare', runId, compareRunId],
    queryFn: () => backtestsApi.compare(runId!, compareRunId),
    enabled: !!runId && !!compareRunId,
  })

  const { data: compareRun } = useQuery<BacktestRun>({
    queryKey: ['run', compareRunId],
    queryFn: () => backtestsApi.get(compareRunId),
    enabled: !!compareRunId,
  })

  const { data: compareEquityCurveData } = useQuery({
    queryKey: ['equity-curve', compareRunId],
    queryFn: () => backtestsApi.getEquityCurve(compareRunId),
    enabled: !!compareRunId && compareRun?.status === 'completed',
  })

  const tradeSymbols = useMemo(
    () => ['ALL', ...Array.from(new Set(trades.map((t: Trade) => t.symbol))).sort()],
    [trades],
  )

  if (isLoading) return <div className="text-gray-500 text-sm">Loading...</div>
  if (runError) return <div className="text-red-400">Failed to load run: {(runError as Error).message}</div>
  if (!run) return <div className="text-red-400">Run not found</div>

  const m = run.metrics
  const wf = m?.walk_forward
  const eqCurve = equityCurveData?.equity_curve ?? []
  const compareEqCurve = compareEquityCurveData?.equity_curve ?? []
  const paperAccounts = accounts.filter(a => a.mode === 'paper')
  const canPromote = run.status === 'completed'
  const antiBiasPassed = Boolean(
    wf?.anti_bias?.leakage_checks_passed &&
    wf?.anti_bias?.parameter_locking_passed &&
    wf?.anti_bias?.causal_indicator_checks_passed,
  )

  const handlePromoteToPaper = async () => {
    if (!selectedAccountId || !run.strategy_version_id) return
    setPromoteError(null)
    setPromotingToPaper(true)
    try {
      const dep = await deploymentsApi.promoteToPaper({
        strategy_version_id: run.strategy_version_id,
        account_id: selectedAccountId,
        run_id: run.id,
        notes: promoteNotes,
      })
      await deploymentsApi.start(dep.id)
      setPromoteSuccess('Successfully promoted to paper trading!')
    } catch (e) {
      setPromoteError((e as Error).message)
    } finally {
      setPromotingToPaper(false)
    }
  }

  const promotionChecklist = [
    { label: 'Backtest completed', ok: run.status === 'completed' },
    { label: 'Backtest produced trades', ok: (m?.total_trades ?? 0) > 0 },
    { label: 'Risk metrics available', ok: m?.max_drawdown_pct != null && m?.sharpe_ratio != null },
    { label: 'Paper account selected', ok: Boolean(selectedAccountId) },
  ]

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'equity', label: 'Equity & Drawdown' },
    { id: 'trades', label: 'Trade Journal' },
    { id: 'monthly', label: 'Monthly Returns' },
    { id: 'monte_carlo', label: 'Monte Carlo' },
    { id: 'promote', label: '→ Promote' },
  ]

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link to="/runs" className="text-gray-500 hover:text-gray-300 text-sm">← Runs</Link>
          </div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">
            Backtest Run
          </div>
          <h1 className="text-lg font-bold text-gray-100 mt-0.5">
            {run.symbols?.join(', ')} — {run.timeframe}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <ModeIndicator mode={run.mode} />
            <span className={clsx('badge', {
              'badge-green': run.status === 'completed',
              'badge-red': run.status === 'failed',
              'badge-gray': run.status === 'running' || run.status === 'pending',
            })}>
              {run.status}
            </span>
            <span className="text-xs text-gray-500">{run.start_date} → {run.end_date}</span>
            <span className="text-xs text-gray-600">Capital ${run.initial_capital.toLocaleString()}</span>
          </div>
        </div>
        {run.status === 'running' && (
          <div className="badge-gray animate-pulse">Running...</div>
        )}
      </div>

      {run.error_message && (
        <div className="card border-red-800 text-red-400 text-sm">{run.error_message}</div>
      )}

      {run.status === 'completed' && m?.no_trades && (
        <div className="card border-amber-800 bg-amber-900/20 text-amber-300 text-sm space-y-1">
          <div className="font-semibold">No trades were generated for this run.</div>
          <div className="text-xs text-amber-200/90">
            The backtest completed successfully, but entry conditions did not trigger executable positions over the selected period.
          </div>
          <div className="text-xs text-amber-200/80">
            Try widening date range, using a more liquid symbol set, or relaxing strategy entry filters.
          </div>
        </div>
      )}

      {wf?.anti_bias && (
        <div className={clsx('card text-xs', wf.anti_bias.leakage_checks_passed && wf.anti_bias.parameter_locking_passed && wf.anti_bias.causal_indicator_checks_passed ? 'border-emerald-900 text-emerald-300' : 'border-amber-800 bg-amber-900/20 text-amber-200')}>
          <div className="font-semibold mb-1">Anti-Bias Validation</div>
          <div>Leakage check: {wf.anti_bias.leakage_checks_passed ? 'PASS' : 'FAIL'}</div>
          <div>Parameter locking: {wf.anti_bias.parameter_locking_passed ? 'PASS' : 'FAIL'}</div>
          <div>Causal indicators: {wf.anti_bias.causal_indicator_checks_passed ? 'PASS' : 'FAIL'}</div>
          {wf.anti_bias.non_causal_indicator_refs && wf.anti_bias.non_causal_indicator_refs.length > 0 && (
            <div className="mt-1">Non-causal refs: {wf.anti_bias.non_causal_indicator_refs.join(', ')}</div>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map(t => (
          <button
            key={t.id}
            className={clsx('px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2',
              tab === t.id
                ? 'text-sky-400 border-sky-500'
                : 'text-gray-500 border-transparent hover:text-gray-300'
            )}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {compareRunId && (
        <div className="card border-sky-900/60 bg-sky-950/20">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-sky-300">Compare Mode</h3>
              <p className="text-xs text-gray-400 mt-1">
                Primary: {run.symbols?.join(', ')} {run.timeframe} vs Secondary: {compareRun?.symbols?.join(', ') || compareRunId}
              </p>
            </div>
            <button
              className="btn-ghost text-xs"
              onClick={() => {
                const next = new URLSearchParams(searchParams)
                next.delete('compare')
                setSearchParams(next)
              }}
            >
              Exit Compare
            </button>
          </div>
          {compareError && <div className="text-xs text-red-300 mt-2">Compare failed: {(compareError as Error).message}</div>}
          {compareData?.deltas && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 text-xs">
              <Metric label="Δ Return" value={fmtPct(compareData.deltas.total_return_pct ?? null)} color={(compareData.deltas.total_return_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
              <Metric label="Δ Sharpe" value={fmt(compareData.deltas.sharpe_ratio ?? null, 2)} color={(compareData.deltas.sharpe_ratio ?? 0) >= 0 ? 'positive' : 'negative'} />
              <Metric label="Δ OOS Return" value={fmtPct(compareData.deltas.oos_total_return_pct ?? null)} color={(compareData.deltas.oos_total_return_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
            </div>
          )}
        </div>
      )}

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="OOS Total Return" value={wf?.aggregate_oos?.oos_total_return_pct != null ? `${wf.aggregate_oos.oos_total_return_pct >= 0 ? '+' : ''}${wf.aggregate_oos.oos_total_return_pct.toFixed(2)}%` : '—'} color={(wf?.aggregate_oos?.oos_total_return_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
            <Metric label="Avg OOS Fold Return" value={wf?.aggregate_oos?.avg_oos_return_pct != null ? `${wf.aggregate_oos.avg_oos_return_pct >= 0 ? '+' : ''}${wf.aggregate_oos.avg_oos_return_pct.toFixed(2)}%` : '—'} color={(wf?.aggregate_oos?.avg_oos_return_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
            <Metric label="Positive OOS Folds" value={wf?.aggregate_oos?.positive_oos_fold_rate_pct != null ? `${wf.aggregate_oos.positive_oos_fold_rate_pct.toFixed(1)}%` : '—'} />
            <Metric label="OOS Fold Count" value={wf?.aggregate_oos?.fold_count ?? '—'} />
          </div>

          <div className="text-xs text-amber-300 bg-amber-900/20 border border-amber-800 rounded p-2">
            Honest benchmark: prioritize stitched out-of-sample metrics above naive full-period backtest metrics.
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Total Return" value={fmtPct(m?.total_return_pct)}
              color={(m?.total_return_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
            <Metric label="CAGR" value={fmtPct(m?.cagr_pct)}
              color={(m?.cagr_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
            <Metric label="Sharpe" value={fmt(m?.sharpe_ratio, 2)}
              color={(m?.sharpe_ratio ?? 0) >= 1 ? 'positive' : (m?.sharpe_ratio ?? 0) >= 0 ? 'neutral' : 'negative'} />
            <Metric label="Max Drawdown" value={m?.max_drawdown_pct != null ? `-${fmt(m.max_drawdown_pct)}%` : '—'} color="negative" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Win Rate" value={`${fmt(m?.win_rate_pct, 0)}%`} />
            <Metric label="Profit Factor" value={fmt(m?.profit_factor, 2)} />
            <Metric label="Sortino" value={fmt(m?.sortino_ratio, 2)} />
            <Metric label="Calmar" value={fmt(m?.calmar_ratio, 2)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Metric label="Total Trades" value={m?.total_trades} />
            <Metric label="Winners" value={m?.winning_trades} color="positive" />
            <Metric label="Losers" value={m?.losing_trades} color="negative" />
            <Metric label="Avg Hold" value={m?.avg_hold_days != null ? `${fmt(m.avg_hold_days)}d` : '—'} />
            <Metric label="Expectancy" value={m?.expectancy != null ? `$${fmt(m.expectancy, 0)}` : '—'} />
          </div>

          {/* Exit reason breakdown */}
          {m?.exit_reason_breakdown && Object.keys(m.exit_reason_breakdown).length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold mb-3">Exit Reasons</h3>
              <div className="space-y-1">
                {Object.entries(m.exit_reason_breakdown).map(([reason, count]) => (
                  <div key={reason} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 w-32">{reason}</span>
                    <div className="flex-1 bg-gray-800 rounded h-4 overflow-hidden">
                      <div
                        className="h-full bg-sky-700 rounded"
                        style={{ width: `${(count / (m.total_trades ?? 1)) * 100}%` }}
                      />
                    </div>
                    <span className="text-gray-500 w-8 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Regime breakdown */}
          {m?.regime_breakdown && Object.keys(m.regime_breakdown).length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold mb-3">P&L by Regime</h3>
              <div className="space-y-1">
                {Object.entries(m.regime_breakdown).map(([regime, pnl]) => (
                  <div key={regime} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">{regime}</span>
                    <span className={pnl >= 0 ? 'positive' : 'negative'}>
                      {pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Equity tab */}
      {tab === 'equity' && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-sm font-semibold mb-3">Equity Curve</h3>
            <EquityCurve data={eqCurve} initialCapital={run.initial_capital} />
            {compareRunId && compareEqCurve.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-800">
                <h4 className="text-xs font-semibold text-gray-300 mb-2">Secondary Run Equity Curve</h4>
                <EquityCurve data={compareEqCurve} initialCapital={compareRun?.initial_capital ?? run.initial_capital} />
              </div>
            )}
          </div>
          {wf?.stitched_oos_equity && wf.stitched_oos_equity.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold mb-3">Stitched Out-of-Sample Equity</h3>
              <p className="text-xs text-gray-500 mb-3">This curve includes only unseen test-window equity segments from each fold.</p>
              <EquityCurve
                data={wf.stitched_oos_equity.map((p) => ({ date: p.date, equity: p.equity, cash: p.equity, drawdown: 0, regime: 'oos' }))}
                initialCapital={run.initial_capital}
              />
            </div>
          )}
          <div className="card">
            <h3 className="text-sm font-semibold mb-3">Drawdown</h3>
            <DrawdownChart data={eqCurve} />
          </div>
        </div>
      )}

      {/* Trades tab */}
      {tab === 'trades' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-3 gap-3">
              <div>
                <h3 className="text-sm font-semibold">Trade Entries and Exits</h3>
                <p className="text-xs text-gray-500 mt-1">Green dots are entries, red dots are exits.</p>
              </div>
              <label className="text-xs text-gray-400 flex items-center gap-2">
                Symbol
                <select
                  value={tradeChartSymbol}
                  onChange={(e) => setTradeChartSymbol(e.target.value)}
                  className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
                >
                  {tradeSymbols.map(symbol => (
                    <option key={symbol} value={symbol}>{symbol}</option>
                  ))}
                </select>
              </label>
            </div>
            <TradeEntryExitChart trades={trades} symbol={tradeChartSymbol} />
          </div>

          <div className="card overflow-hidden p-0">
            <div className="px-4 py-2 border-b border-gray-800">
              <span className="text-sm font-semibold">Trade Journal</span>
              <span className="text-gray-500 text-xs ml-2">({trades.length} trades)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500">
                    <th className="text-left px-4 py-2">Symbol</th>
                    <th className="text-left px-4 py-2">Dir</th>
                    <th className="text-left px-4 py-2">Entry</th>
                    <th className="text-left px-4 py-2">Exit</th>
                    <th className="text-right px-4 py-2">Entry $</th>
                    <th className="text-right px-4 py-2">Exit $</th>
                    <th className="text-right px-4 py-2">P&L</th>
                    <th className="text-right px-4 py-2">Return</th>
                    <th className="text-right px-4 py-2">R</th>
                    <th className="text-left px-4 py-2">Exit Reason</th>
                    <th className="text-left px-4 py-2">Regime</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTrades.map((t: Trade) => (
                    <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-1.5 font-mono text-gray-200">{t.symbol}</td>
                      <td className="px-4 py-1.5">
                        <span className={t.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}>
                          {t.direction}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-gray-400">{t.entry_time?.slice(0, 10)}</td>
                      <td className="px-4 py-1.5 text-gray-400">{t.exit_time?.slice(0, 10) ?? '—'}</td>
                      <td className="px-4 py-1.5 text-right">{t.entry_price?.toFixed(2)}</td>
                      <td className="px-4 py-1.5 text-right">{t.exit_price?.toFixed(2) ?? '—'}</td>
                      <td className={clsx('px-4 py-1.5 text-right font-mono', (t.net_pnl ?? 0) >= 0 ? 'positive' : 'negative')}>
                        {t.net_pnl != null ? `${t.net_pnl >= 0 ? '+' : ''}$${t.net_pnl.toFixed(0)}` : '—'}
                      </td>
                      <td className={clsx('px-4 py-1.5 text-right font-mono', (t.return_pct ?? 0) >= 0 ? 'positive' : 'negative')}>
                        {t.return_pct != null ? `${t.return_pct >= 0 ? '+' : ''}${t.return_pct.toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-4 py-1.5 text-right text-gray-400">
                        {t.r_multiple != null ? `${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple.toFixed(2)}R` : '—'}
                      </td>
                      <td className="px-4 py-1.5 text-gray-400">{t.exit_reason ?? '—'}</td>
                      <td className="px-4 py-1.5 text-gray-500 text-xs">{t.regime_at_entry ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Monthly tab */}
      {tab === 'monthly' && (
        <div className="card">
          <h3 className="text-sm font-semibold mb-4">Monthly Returns Heatmap</h3>
          <MonthlyHeatmap data={m?.monthly_returns ?? {}} />
        </div>
      )}

      {/* Monte Carlo tab */}
      {tab === 'monte_carlo' && (
        <div className="space-y-4">
          {!m?.monte_carlo && !m?.walk_forward && (
            <div className="card text-xs text-gray-500">
              Monte Carlo and forward-test results are not available for this run yet.
            </div>
          )}
          {m?.monte_carlo && (
            <div className="card">
              <h3 className="text-sm font-semibold mb-3">Monte Carlo Simulation (500 paths)</h3>
              <p className="mb-4 text-xs text-gray-500">
                Use these stress-test ranges to review robustness before promotion, not as a guarantee of live results.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Metric label="Median Return" value={fmtPct(m.monte_carlo.median_return_pct)}
                  color={(m.monte_carlo.median_return_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
                <Metric label="5th Percentile" value={fmtPct(m.monte_carlo.p5_return_pct)} color="negative" />
                <Metric label="95th Percentile" value={fmtPct(m.monte_carlo.p95_return_pct)} color="positive" />
                <Metric label="Median Max DD" value={m.monte_carlo.median_max_drawdown_pct != null ? `-${fmt(m.monte_carlo.median_max_drawdown_pct)}%` : '—'} color="negative" />
                <Metric label="95th Pct Max DD" value={m.monte_carlo.p95_max_drawdown_pct != null ? `-${fmt(m.monte_carlo.p95_max_drawdown_pct)}%` : '—'} color="negative" />
                <Metric label="Prob. Profitable" value={`${fmt(m.monte_carlo.probability_profitable, 0)}%`}
                  color={(m.monte_carlo.probability_profitable ?? 0) >= 60 ? 'positive' : 'neutral'} />
              </div>
            </div>
          )}

          {m?.walk_forward && (
            <div className="card">
              <h3 className="text-sm font-semibold mb-3">Forward Test (Out-of-Sample)</h3>
              <div className="text-xs text-gray-500 mb-3">
                Method: {m.walk_forward.method ?? 'n/a'}
              </div>

              {m.walk_forward.settings && (
                <div className="text-xs text-gray-500 mb-3">
                  Windows: {m.walk_forward.settings.train_window_months ?? '—'}m train → {m.walk_forward.settings.test_window_months ?? '—'}m test
                </div>
              )}

              {m.walk_forward.aggregate_oos && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  <Metric
                    label="OOS Total Return"
                    value={m.walk_forward.aggregate_oos.oos_total_return_pct != null ? `${m.walk_forward.aggregate_oos.oos_total_return_pct >= 0 ? '+' : ''}${m.walk_forward.aggregate_oos.oos_total_return_pct.toFixed(2)}%` : '—'}
                    color={(m.walk_forward.aggregate_oos.oos_total_return_pct ?? 0) >= 0 ? 'positive' : 'negative'}
                  />
                  <Metric
                    label="Avg OOS Fold Return"
                    value={m.walk_forward.aggregate_oos.avg_oos_return_pct != null ? `${m.walk_forward.aggregate_oos.avg_oos_return_pct >= 0 ? '+' : ''}${m.walk_forward.aggregate_oos.avg_oos_return_pct.toFixed(2)}%` : '—'}
                    color={(m.walk_forward.aggregate_oos.avg_oos_return_pct ?? 0) >= 0 ? 'positive' : 'negative'}
                  />
                  <Metric
                    label="Positive OOS Folds"
                    value={m.walk_forward.aggregate_oos.positive_oos_fold_rate_pct != null ? `${m.walk_forward.aggregate_oos.positive_oos_fold_rate_pct.toFixed(1)}%` : '—'}
                  />
                </div>
              )}

              {m.walk_forward.naive_full_period && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <Metric label="Naive Return" value={m.walk_forward.naive_full_period.total_return_pct != null ? `${m.walk_forward.naive_full_period.total_return_pct >= 0 ? '+' : ''}${m.walk_forward.naive_full_period.total_return_pct.toFixed(2)}%` : '—'} color={(m.walk_forward.naive_full_period.total_return_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
                  <Metric label="Naive Sharpe" value={m.walk_forward.naive_full_period.sharpe_ratio != null ? m.walk_forward.naive_full_period.sharpe_ratio.toFixed(2) : '—'} />
                  <Metric label="Naive Max DD" value={m.walk_forward.naive_full_period.max_drawdown_pct != null ? `${m.walk_forward.naive_full_period.max_drawdown_pct.toFixed(2)}%` : '—'} color="negative" />
                  <Metric label="Naive Trades" value={m.walk_forward.naive_full_period.total_trades ?? '—'} />
                </div>
              )}

              {m.walk_forward.warnings && m.walk_forward.warnings.length > 0 && (
                <div className="mb-4 rounded border border-amber-800 bg-amber-900/20 p-2 text-xs text-amber-200 space-y-1">
                  <div className="font-semibold">Walk-forward Warnings</div>
                  {m.walk_forward.warnings.map((w, i) => (
                    <div key={i}>• {w}</div>
                  ))}
                </div>
              )}

              {m.walk_forward.folds && m.walk_forward.folds.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-500">
                        <th className="text-left px-2 py-2">Fold</th>
                        <th className="text-left px-2 py-2">Train</th>
                        <th className="text-left px-2 py-2">Test</th>
                        <th className="text-left px-2 py-2">Params</th>
                        <th className="text-right px-2 py-2">Train Return</th>
                        <th className="text-right px-2 py-2">Test Return</th>
                        <th className="text-right px-2 py-2">Test Sharpe</th>
                        <th className="text-right px-2 py-2">Turnover</th>
                        <th className="text-right px-2 py-2">Costs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.walk_forward.folds.map((fold) => (
                        <tr key={fold.fold_id} className="border-b border-gray-800/40">
                          <td className="px-2 py-2 text-gray-300">{fold.fold_id}</td>
                          <td className="px-2 py-2 text-gray-500">{fold.train_start?.slice(0, 10)} → {fold.train_end?.slice(0, 10)}</td>
                          <td className="px-2 py-2 text-gray-500">{fold.test_start?.slice(0, 10)} → {fold.test_end?.slice(0, 10)}</td>
                          <td className="px-2 py-2 text-gray-500">{fold.selected_parameters ? Object.entries(fold.selected_parameters).map(([k, v]) => `${k}=${v}`).join(', ') : 'locked'}</td>
                          <td className={clsx('px-2 py-2 text-right', (fold.train_metrics?.total_return_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                            {fold.train_metrics?.total_return_pct != null ? `${fold.train_metrics.total_return_pct >= 0 ? '+' : ''}${fold.train_metrics.total_return_pct.toFixed(2)}%` : '—'}
                          </td>
                          <td className={clsx('px-2 py-2 text-right', (fold.test_metrics?.total_return_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                            {fold.test_metrics?.total_return_pct != null ? `${fold.test_metrics.total_return_pct >= 0 ? '+' : ''}${fold.test_metrics.total_return_pct.toFixed(2)}%` : '—'}
                          </td>
                          <td className="px-2 py-2 text-right text-gray-300">
                            {fold.test_metrics?.sharpe_ratio != null ? fold.test_metrics.sharpe_ratio.toFixed(2) : '—'}
                          </td>
                          <td className="px-2 py-2 text-right text-gray-400">{fold.turnover_shares != null ? fold.turnover_shares.toFixed(0) : '—'}</td>
                          <td className="px-2 py-2 text-right text-gray-400">{fold.cost_impact != null ? `$${fold.cost_impact.toFixed(2)}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-xs text-gray-500">No forward-test folds generated.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Promote tab */}
      {tab === 'promote' && canPromote && (
        <div className="space-y-4 max-w-lg">
          <div className="card border-indigo-800">
            <h3 className="text-sm font-semibold mb-1 text-indigo-300">Promote to Paper Trading</h3>
            <p className="text-xs text-gray-500 mb-4">
              Deploy this strategy version to a paper account for live simulation before going live.
            </p>

            {promoteSuccess && (
              <div className="bg-emerald-900/50 border border-emerald-700 rounded p-3 text-emerald-300 text-sm mb-4">
                {promoteSuccess} <Link to="/deployments" className="underline underline-offset-2">Open deployments</Link>
              </div>
            )}
            {promoteError && (
              <div className="bg-red-900/50 border border-red-700 rounded p-3 text-red-300 text-sm mb-4">
                {promoteError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="label">Paper Account</label>
                <select className="input w-full" value={selectedAccountId} onChange={e => setSelectedAccountId(e.target.value)}>
                  <option value="">— Select paper account —</option>
                  {paperAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name} (${(a.equity ?? a.current_balance).toLocaleString()})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full resize-none" rows={2} value={promoteNotes} onChange={e => setPromoteNotes(e.target.value)} />
              </div>
              <button
                className="btn-primary w-full"
                onClick={handlePromoteToPaper}
                disabled={!selectedAccountId || promotingToPaper || !antiBiasPassed}
              >
                {promotingToPaper ? 'Promoting…' : 'Promote to Paper Trading'}
              </button>
              {!antiBiasPassed && (
                <div className="text-xs text-amber-300 bg-amber-900/20 border border-amber-800 rounded p-2">
                  Promotion is blocked until anti-bias checks pass.
                </div>
              )}
            </div>
          </div>

          <div className="card text-xs text-gray-500 space-y-1">
            <div className="font-semibold text-gray-400 mb-2">Promotion Checklist</div>
            {promotionChecklist.map((item) => (
              <div key={item.label}>{item.ok ? '✓' : '✗'} {item.label}</div>
            ))}
            <div>{antiBiasPassed ? '✓' : '✗'} Anti-bias checks passed</div>
            <div className="text-gray-600 mt-2">Paper → Live promotion requires additional safety checklist approval</div>
          </div>
        </div>
      )}
    </div>
  )
}
