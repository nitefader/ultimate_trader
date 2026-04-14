import React, { useMemo, useState, useCallback } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { backtestsApi } from '../api/backtests'
import { deploymentsApi, accountsApi } from '../api/accounts'
import { EquityCurve } from '../components/Charts/EquityCurve'
import { DrawdownChart } from '../components/Charts/DrawdownChart'
import { MonthlyHeatmap } from '../components/Charts/MonthlyHeatmap'
import { TradeEntryExitChart } from '../components/Charts/TradeEntryExitChart'
import { ModeIndicator } from '../components/ModeIndicator'
import { SelectMenu } from '../components/SelectMenu'
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

/** Format ISO datetime string to "YYYY-MM-DD HH:MM" — preserves intraday time */
function fmtDT(iso: string | undefined | null): string {
  if (!iso) return '—'
  // Replace T separator with space, strip seconds and timezone
  return iso.replace('T', ' ').slice(0, 16)
}

const EXIT_REASON_COLOR: Record<string, string> = {
  stop_loss:      'text-red-400',
  trailing_stop:  'text-orange-400',
  target_1:       'text-emerald-400',
  target_2:       'text-emerald-300',
  target_3:       'text-emerald-200',
  time_exit:      'text-sky-400',
  max_hold:       'text-sky-400',
  force_flat:     'text-amber-400',
  kill_switch:    'text-red-500',
  manual:         'text-gray-400',
  reversal:       'text-purple-400',
}

/** Expandable trade row — click to see MAE/MFE, initial stop/target, conditions fired, scale events */
function TradeRow({ t }: { t: Trade }) {
  const [open, setOpen] = useState(false)
  const exitColor = EXIT_REASON_COLOR[t.exit_reason ?? ''] ?? 'text-gray-400'
  const pnlColor = (t.net_pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
  const rColor = (t.r_multiple ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'

  return (
    <>
      <tr
        key={t.id}
        className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
        title="Click to expand trade detail"
      >
        <td className="px-4 py-1.5 text-gray-500 text-[10px]">{open ? '▲' : '▼'}</td>
        <td className="px-4 py-1.5 font-mono text-gray-200">{t.symbol}</td>
        <td className="px-4 py-1.5">
          <span className={t.direction === 'long' ? 'text-emerald-400' : 'text-red-400 font-semibold'}>
            {t.direction === 'long' ? '▲ L' : '▼ S'}
          </span>
        </td>
        <td className="px-4 py-1.5 text-gray-400 font-mono text-[11px]">{fmtDT(t.entry_time)}</td>
        <td className="px-4 py-1.5 text-gray-400 font-mono text-[11px]">{fmtDT(t.exit_time)}</td>
        <td className="px-4 py-1.5 text-right font-mono">${t.entry_price?.toFixed(2) ?? '—'}</td>
        <td className="px-4 py-1.5 text-right font-mono">{t.exit_price != null ? `$${t.exit_price.toFixed(2)}` : '—'}</td>
        <td className={clsx('px-4 py-1.5 text-right font-mono', pnlColor)}>
          {t.net_pnl != null ? `${t.net_pnl >= 0 ? '+' : ''}$${t.net_pnl.toFixed(0)}` : '—'}
        </td>
        <td className={clsx('px-4 py-1.5 text-right font-mono', pnlColor)}>
          {t.return_pct != null ? `${t.return_pct >= 0 ? '+' : ''}${t.return_pct.toFixed(2)}%` : '—'}
        </td>
        <td className={clsx('px-4 py-1.5 text-right font-mono', rColor)}>
          {t.r_multiple != null ? `${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple.toFixed(2)}R` : '—'}
        </td>
        <td className={clsx('px-4 py-1.5 text-xs', exitColor)}>
          {t.exit_reason ?? (t.is_open ? '● open' : '—')}
        </td>
        <td className="px-4 py-1.5 text-gray-500 text-xs">{t.regime_at_entry ?? '—'}</td>
      </tr>

      {open && (
        <tr className="border-b border-gray-800 bg-gray-900/60">
          <td colSpan={12} className="px-6 py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              {/* Risk parameters */}
              <div className="space-y-1">
                <div className="text-gray-500 font-semibold uppercase tracking-wide text-[10px]">Risk Parameters</div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">Initial stop</span>
                  <span className="font-mono text-gray-300">{t.initial_stop != null ? `$${t.initial_stop.toFixed(2)}` : '—'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">Initial target</span>
                  <span className="font-mono text-gray-300">{t.initial_target != null ? `$${t.initial_target.toFixed(2)}` : '—'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">Qty entered</span>
                  <span className="font-mono text-gray-300">{t.initial_quantity?.toFixed(0) ?? '—'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">Order type</span>
                  <span className="font-mono text-gray-300">{t.entry_order_type ?? '—'}</span>
                </div>
              </div>

              {/* Excursion (MAE/MFE) */}
              <div className="space-y-1">
                <div className="text-gray-500 font-semibold uppercase tracking-wide text-[10px]">Excursion (MAE / MFE)</div>
                <div className="flex justify-between gap-2">
                  <span className="text-red-400">MAE (worst)</span>
                  <span className="font-mono text-red-400">
                    {t.max_adverse_excursion != null ? `${t.max_adverse_excursion.toFixed(2)}%` : '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-emerald-400">MFE (best)</span>
                  <span className="font-mono text-emerald-400">
                    {t.max_favorable_excursion != null ? `+${t.max_favorable_excursion.toFixed(2)}%` : '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">Commission</span>
                  <span className="font-mono text-gray-400">${(t.commission ?? 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">Slippage</span>
                  <span className="font-mono text-gray-400">${(t.slippage ?? 0).toFixed(2)}</span>
                </div>
              </div>

              {/* Entry conditions */}
              <div className="space-y-1">
                <div className="text-gray-500 font-semibold uppercase tracking-wide text-[10px]">Conditions Fired</div>
                {(t.entry_conditions_fired ?? []).length > 0 ? (
                  (t.entry_conditions_fired ?? []).map((c, i) => (
                    <div key={i} className="flex items-start gap-1">
                      <span className="text-emerald-500 mt-px">✓</span>
                      <span className="text-gray-300 font-mono break-all">{c}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-gray-600 italic">Not recorded</span>
                )}
              </div>

              {/* Scale events */}
              <div className="space-y-1">
                <div className="text-gray-500 font-semibold uppercase tracking-wide text-[10px]">Scale Events</div>
                {(t.scale_events ?? []).length > 0 ? (
                  (t.scale_events ?? []).map((se, i) => (
                    <div key={i} className="text-[11px] rounded bg-gray-800/60 px-2 py-1">
                      <div className="flex items-center justify-between">
                        <span className={se.event_type === 'scale_in' ? 'text-sky-400' : 'text-amber-400'}>
                          {se.event_type === 'scale_in' ? '↑ Scale in' : '↓ Scale out'} {se.quantity_pct.toFixed(0)}%
                        </span>
                        <span className="text-gray-500 font-mono">${se.price.toFixed(2)}</span>
                      </div>
                      <div className="text-gray-600 text-[10px]">{fmtDT(se.time)} {se.reason && `— ${se.reason}`}</div>
                    </div>
                  ))
                ) : (
                  <span className="text-gray-600 italic">No scale events</span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
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
  const ve = run.validation_evidence
  const wf = ve?.walk_forward ?? m?.walk_forward
  const antiBias = ve?.anti_bias ?? wf?.anti_bias
  const cpcv = ve?.cpcv ?? wf?.cpcv
  const eqCurve = equityCurveData?.equity_curve ?? []
  const compareEqCurve = compareEquityCurveData?.equity_curve ?? []
  const paperAccounts = accounts.filter(a => a.mode === 'paper')
  const canPromote = run.status === 'completed'
  const antiBiasPassed = Boolean(
    antiBias?.leakage_checks_passed &&
    antiBias?.parameter_locking_passed &&
    antiBias?.causal_indicator_checks_passed &&
    (antiBias?.cpcv_primary_guard_passed ?? true),
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

      {antiBias && (
        <div className={clsx('card text-xs', antiBiasPassed ? 'border-emerald-900 text-emerald-300' : 'border-amber-800 bg-amber-900/20 text-amber-200')}>
          <div className="font-semibold mb-1">Anti-Bias Validation</div>
          {'cpcv_primary_guard_passed' in antiBias && (
            <div>CPCV primary guard: {antiBias.cpcv_primary_guard_passed ? 'PASS' : 'FAIL'}</div>
          )}
          <div>Leakage check: {antiBias.leakage_checks_passed ? 'PASS' : 'FAIL'}</div>
          <div>Parameter locking: {antiBias.parameter_locking_passed ? 'PASS' : 'FAIL'}</div>
          <div>Causal indicators: {antiBias.causal_indicator_checks_passed ? 'PASS' : 'FAIL'}</div>
          {antiBias.non_causal_indicator_refs && antiBias.non_causal_indicator_refs.length > 0 && (
            <div className="mt-1">Non-causal refs: {antiBias.non_causal_indicator_refs.join(', ')}</div>
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

          {/* Walk-forward summary banner — only shown when WF was run */}
          {wf && (
            <div className="card border-sky-900/60 bg-sky-950/20 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-sky-300">Walk-Forward Results</h3>
                <span className="text-xs text-gray-500">Out-of-sample performance only — the honest benchmark</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric label="OOS Total Return" value={wf?.aggregate_oos?.oos_total_return_pct != null ? `${wf.aggregate_oos.oos_total_return_pct >= 0 ? '+' : ''}${wf.aggregate_oos.oos_total_return_pct.toFixed(2)}%` : '—'} color={(wf?.aggregate_oos?.oos_total_return_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
                <Metric label="Avg OOS Fold Return" value={wf?.aggregate_oos?.avg_oos_return_pct != null ? `${wf.aggregate_oos.avg_oos_return_pct >= 0 ? '+' : ''}${wf.aggregate_oos.avg_oos_return_pct.toFixed(2)}%` : '—'} color={(wf?.aggregate_oos?.avg_oos_return_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
                <Metric label="Positive OOS Folds" value={wf?.aggregate_oos?.positive_oos_fold_rate_pct != null ? `${wf.aggregate_oos.positive_oos_fold_rate_pct.toFixed(1)}%` : '—'} />
                <Metric label="Fold Count" value={wf?.aggregate_oos?.fold_count ?? '—'} />
              </div>

              {/* Per-fold visual grid */}
              {Array.isArray(wf?.folds) && wf.folds.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Per-Fold OOS Results</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(wf.folds as any[]).map((fold: any, i: number) => {
                      const ret = fold.oos_return_pct ?? fold.oos_metrics?.total_return_pct
                      const isPos = (ret ?? 0) >= 0
                      return (
                        <div
                          key={i}
                          title={`Fold ${i + 1}: OOS ${ret != null ? `${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%` : '—'}${fold.test_start ? ` | ${fold.test_start?.slice(0, 10)} → ${fold.test_end?.slice(0, 10)}` : ''}`}
                          className={clsx(
                            'flex flex-col items-center justify-center rounded px-2 py-1 min-w-[56px] text-[10px] font-mono border',
                            isPos
                              ? 'bg-emerald-900/40 border-emerald-700/60 text-emerald-300'
                              : 'bg-red-900/40 border-red-700/60 text-red-300',
                          )}
                        >
                          <span className="text-gray-500">F{i + 1}</span>
                          <span className="font-semibold">{ret != null ? `${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%` : '—'}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {ve && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1 border-t border-sky-900/40">
                  <Metric label="Stability Score" value={ve.stability_score != null ? ve.stability_score.toFixed(3) : '—'} color={(ve.stability_score ?? 0) >= 0.7 ? 'positive' : (ve.stability_score ?? 0) >= 0.4 ? 'neutral' : 'negative'} />
                  <Metric label="IS/OOS Degradation" value={ve.is_oos_degradation_ratio != null ? ve.is_oos_degradation_ratio.toFixed(2) : '—'} color={(ve.is_oos_degradation_ratio ?? 99) < 2 ? 'positive' : 'negative'} />
                  <Metric label="CPCV Median Sharpe" value={cpcv?.aggregate?.median_oos_sharpe != null ? cpcv.aggregate.median_oos_sharpe.toFixed(2) : '—'} color={(cpcv?.aggregate?.median_oos_sharpe ?? 0) >= 0 ? 'positive' : 'negative'} />
                  <Metric label="CPCV Pass" value={cpcv?.aggregate?.pass_primary_guard == null ? '—' : cpcv.aggregate.pass_primary_guard ? 'YES' : 'NO'} color={cpcv?.aggregate?.pass_primary_guard ? 'positive' : 'negative'} />
                </div>
              )}
            </div>
          )}

          {/* Divider note for runs without WF */}
          {!wf && run.status === 'completed' && (
            <div className="text-xs text-gray-600 bg-gray-900/60 border border-gray-800 rounded p-2">
              Walk-forward not run — metrics below are in-sample only. Enable walk-forward in the backtest launcher for an honest out-of-sample benchmark.
            </div>
          )}

          {wf && (
            <div className="text-xs text-amber-300 bg-amber-900/20 border border-amber-800 rounded px-3 py-2">
              <strong>Note:</strong> Full-period metrics below include the in-sample training windows. OOS return above is the unbiased estimate.
            </div>
          )}

          <div>
            <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-2">Full-Period Backtest Metrics</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric label="Total Return" value={fmtPct(m?.total_return_pct)}
                color={(m?.total_return_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
              <Metric label="CAGR" value={fmtPct(m?.cagr_pct)}
                color={(m?.cagr_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
              <Metric label="Sharpe" value={fmt(m?.sharpe_ratio, 2)}
                color={(m?.sharpe_ratio ?? 0) >= 1 ? 'positive' : (m?.sharpe_ratio ?? 0) >= 0 ? 'neutral' : 'negative'} />
              <Metric label="Max Drawdown" value={m?.max_drawdown_pct != null ? `-${fmt(m.max_drawdown_pct)}%` : '—'} color="negative" />
            </div>
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
                <SelectMenu
                  value={tradeChartSymbol}
                  onChange={setTradeChartSymbol}
                  options={tradeSymbols.map(symbol => ({ value: symbol, label: symbol }))}
                />
              </label>
            </div>
            <TradeEntryExitChart trades={trades} symbol={tradeChartSymbol} />
          </div>

          {trades.length > 0 && (() => {
            const exitReasons = trades.reduce((acc: Record<string, number>, t: Trade) => {
              const r = t.exit_reason ?? (t.is_open ? 'open' : 'unknown')
              acc[r] = (acc[r] ?? 0) + 1
              return acc
            }, {})
            const winners = trades.filter((t: Trade) => (t.net_pnl ?? 0) > 0).length
            const losers = trades.filter((t: Trade) => (t.net_pnl ?? 0) < 0).length
            const avgR = trades.filter((t: Trade) => t.r_multiple != null).reduce((s: number, t: Trade) => s + (t.r_multiple ?? 0), 0) / (trades.filter((t: Trade) => t.r_multiple != null).length || 1)
            return (
              <div className="card">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-gray-300">Exit Reason Breakdown</h3>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span><span className="text-emerald-400 font-semibold">{winners}W</span> / <span className="text-red-400 font-semibold">{losers}L</span></span>
                    <span>Avg R: <span className={avgR >= 0 ? 'text-emerald-400' : 'text-red-400'}>{avgR >= 0 ? '+' : ''}{avgR.toFixed(2)}R</span></span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(exitReasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
                    <div key={reason} className={clsx('px-2 py-0.5 rounded text-xs font-mono border', EXIT_REASON_COLOR[reason] ? `${EXIT_REASON_COLOR[reason]} border-current/30` : 'text-gray-400 border-gray-700')}>
                      {reason} <span className="opacity-60">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          <div className="card overflow-hidden p-0">
            <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold">Trade Journal</span>
                <span className="text-gray-500 text-xs ml-2">({trades.length} trades)</span>
              </div>
              <span className="text-xs text-gray-600">Click any row to expand details</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500 text-[11px]">
                    <th className="px-4 py-2 w-6"></th>
                    <th className="text-left px-4 py-2">Symbol</th>
                    <th className="text-left px-4 py-2">Dir</th>
                    <th className="text-left px-4 py-2">Entry Time</th>
                    <th className="text-left px-4 py-2">Exit Time</th>
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
                    <TradeRow key={t.id} t={t} />
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
          {!m?.monte_carlo && !wf && !ve && (
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

          {wf && (
            <div className="card">
              <h3 className="text-sm font-semibold mb-3">Forward Test (Out-of-Sample)</h3>
              <div className="text-xs text-gray-500 mb-3">
                Method: {wf.method ?? 'n/a'}
              </div>

              {wf.settings && (
                <div className="text-xs text-gray-500 mb-3">
                  Windows: {wf.settings.train_window_months ?? '—'}m train → {wf.settings.test_window_months ?? '—'}m test
                </div>
              )}

              {wf.aggregate_oos && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  <Metric
                    label="OOS Total Return"
                    value={wf.aggregate_oos.oos_total_return_pct != null ? `${wf.aggregate_oos.oos_total_return_pct >= 0 ? '+' : ''}${wf.aggregate_oos.oos_total_return_pct.toFixed(2)}%` : '—'}
                    color={(wf.aggregate_oos.oos_total_return_pct ?? 0) >= 0 ? 'positive' : 'negative'}
                  />
                  <Metric
                    label="Avg OOS Fold Return"
                    value={wf.aggregate_oos.avg_oos_return_pct != null ? `${wf.aggregate_oos.avg_oos_return_pct >= 0 ? '+' : ''}${wf.aggregate_oos.avg_oos_return_pct.toFixed(2)}%` : '—'}
                    color={(wf.aggregate_oos.avg_oos_return_pct ?? 0) >= 0 ? 'positive' : 'negative'}
                  />
                  <Metric
                    label="Positive OOS Folds"
                    value={wf.aggregate_oos.positive_oos_fold_rate_pct != null ? `${wf.aggregate_oos.positive_oos_fold_rate_pct.toFixed(1)}%` : '—'}
                  />
                </div>
              )}

              {wf.naive_full_period && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <Metric label="Naive Return" value={wf.naive_full_period.total_return_pct != null ? `${wf.naive_full_period.total_return_pct >= 0 ? '+' : ''}${wf.naive_full_period.total_return_pct.toFixed(2)}%` : '—'} color={(wf.naive_full_period.total_return_pct ?? 0) >= 0 ? 'positive' : 'negative'} />
                  <Metric label="Naive Sharpe" value={wf.naive_full_period.sharpe_ratio != null ? wf.naive_full_period.sharpe_ratio.toFixed(2) : '—'} />
                  <Metric label="Naive Max DD" value={wf.naive_full_period.max_drawdown_pct != null ? `${wf.naive_full_period.max_drawdown_pct.toFixed(2)}%` : '—'} color="negative" />
                  <Metric label="Naive Trades" value={wf.naive_full_period.total_trades ?? '—'} />
                </div>
              )}

              {wf.warnings && wf.warnings.length > 0 && (
                <div className="mb-4 rounded border border-amber-800 bg-amber-900/20 p-2 text-xs text-amber-200 space-y-1">
                  <div className="font-semibold">Walk-forward Warnings</div>
                  {wf.warnings.map((w, i) => (
                    <div key={i}>• {w}</div>
                  ))}
                </div>
              )}

              {wf.folds && wf.folds.length > 0 ? (
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
                      {wf.folds.map((fold) => (
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

          {ve && (
            <div className="card">
              <h3 className="text-sm font-semibold mb-3">Validation Evidence</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <Metric label="CPCV Fold Count" value={cpcv?.aggregate?.fold_count ?? '—'} />
                <Metric label="Positive CPCV Folds" value={cpcv?.aggregate?.pct_positive_oos_folds != null ? `${cpcv.aggregate.pct_positive_oos_folds.toFixed(1)}%` : '—'} />
                <Metric label="Evidence Created" value={ve.created_at ? ve.created_at.slice(0, 10) : '—'} />
              </div>
              {ve.cost_sensitivity_curve && ve.cost_sensitivity_curve.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-gray-300 mb-2">Cost Sensitivity Curve</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-800 text-gray-500">
                          <th className="text-left px-2 py-2">Slippage</th>
                          <th className="text-right px-2 py-2">Sharpe</th>
                          <th className="text-right px-2 py-2">Return</th>
                          <th className="text-right px-2 py-2">Trades</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ve.cost_sensitivity_curve.map((point) => (
                          <tr key={point.slippage_bps} className="border-b border-gray-800/40">
                            <td className="px-2 py-2 text-gray-300">{point.slippage_bps.toFixed(2)} bps</td>
                            <td className="px-2 py-2 text-right text-gray-300">{point.sharpe_ratio != null ? point.sharpe_ratio.toFixed(2) : point.error ? 'ERR' : '—'}</td>
                            <td className="px-2 py-2 text-right text-gray-300">{point.total_return_pct != null ? `${point.total_return_pct >= 0 ? '+' : ''}${point.total_return_pct.toFixed(2)}%` : point.error ? 'ERR' : '—'}</td>
                            <td className="px-2 py-2 text-right text-gray-400">{point.trade_count ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {ve.per_symbol_oos_sharpe && Object.keys(ve.per_symbol_oos_sharpe).length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-gray-300 mb-2">Per-Symbol OOS Sharpe</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {Object.entries(ve.per_symbol_oos_sharpe).map(([symbol, sharpe]) => (
                      <div key={symbol} className="rounded border border-gray-800 bg-gray-900/40 px-3 py-2 flex items-center justify-between">
                        <span className="text-gray-400">{symbol}</span>
                        <span className={(sharpe ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{sharpe != null ? sharpe.toFixed(2) : '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ve.regime_performance && Object.keys(ve.regime_performance).length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-300 mb-2">Regime Performance</div>
                  <div className="space-y-1">
                    {Object.entries(ve.regime_performance).map(([regime, pnl]) => (
                      <div key={regime} className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">{regime}</span>
                        <span className={pnl >= 0 ? 'positive' : 'negative'}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Promote tab */}
      {tab === 'promote' && canPromote && (
        <div className="space-y-4 max-w-xl">
          <div className="card space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-indigo-300">Promote to Paper Trading</h3>
              <p className="text-xs text-gray-500 mt-1">
                Run this strategy on a paper account with live Alpaca data before committing real capital.
              </p>
            </div>

            {/* Step-by-step checklist */}
            <div className="space-y-2">
              {[
                ...promotionChecklist,
                { label: 'Anti-bias validation passed', ok: antiBiasPassed },
              ].map((item, i) => (
                <div key={item.label} className={clsx(
                  'flex items-center gap-3 rounded px-3 py-2 text-xs border',
                  item.ok
                    ? 'border-emerald-800/60 bg-emerald-900/20 text-emerald-300'
                    : 'border-gray-700 bg-gray-900/40 text-gray-500',
                )}>
                  <span className={clsx(
                    'flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
                    item.ok ? 'bg-emerald-700 text-white' : 'bg-gray-700 text-gray-400',
                  )}>
                    {item.ok ? '✓' : (i + 1)}
                  </span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>

            {promoteSuccess ? (
              <div className="bg-emerald-900/50 border border-emerald-700 rounded p-3 text-emerald-300 text-sm">
                {promoteSuccess}{' '}
                <Link to="/deployments" className="underline underline-offset-2 font-semibold">Open Deployments →</Link>
              </div>
            ) : (
              <div className="space-y-3 pt-1 border-t border-gray-800">
                {promoteError && (
                  <div className="bg-red-900/50 border border-red-700 rounded p-3 text-red-300 text-sm">
                    {promoteError}
                  </div>
                )}

                <div>
                  <label className="label">Paper Account</label>
                  {paperAccounts.length === 0 ? (
                    <div className="text-xs text-amber-300 bg-amber-900/20 border border-amber-800 rounded p-2">
                      No paper accounts found.{' '}
                      <Link to="/accounts" className="underline">Create one in Accounts</Link> first.
                    </div>
                  ) : (
                    <SelectMenu
                      value={selectedAccountId}
                      onChange={setSelectedAccountId}
                      placeholder="— Select paper account —"
                      options={[
                        { value: '', label: '— Select paper account —' },
                        ...paperAccounts.map(a => ({
                          value: a.id,
                          label: `${a.name} ($${(a.equity ?? a.current_balance ?? 0).toLocaleString()})`,
                        })),
                      ]}
                    />
                  )}
                </div>
                <div>
                  <label className="label">Notes (optional)</label>
                  <textarea
                    className="input w-full resize-none text-xs"
                    rows={2}
                    placeholder="Reason for promotion, parameter changes since last run…"
                    value={promoteNotes}
                    onChange={e => setPromoteNotes(e.target.value)}
                  />
                </div>
                <button
                  className="btn-primary w-full"
                  onClick={handlePromoteToPaper}
                  disabled={!selectedAccountId || promotingToPaper || !antiBiasPassed}
                >
                  {promotingToPaper ? 'Promoting…' : 'Deploy to Paper Trading'}
                </button>
                {!antiBiasPassed && (
                  <div className="text-xs text-amber-300 bg-amber-900/20 border border-amber-800 rounded px-3 py-2">
                    Anti-bias validation must pass before promotion. Run with walk-forward enabled to generate validation evidence.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="text-xs text-gray-600 px-1">
            Paper → Live promotion is handled separately from the{' '}
            <Link to="/deployments" className="text-sky-500 hover:text-sky-400">Deployments</Link> page once paper results accumulate.
          </div>
        </div>
      )}
    </div>
  )
}
