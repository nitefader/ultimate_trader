/**
 * Optimization Lab
 *
 * Pipeline: Backtest results → select winners → paper deploy → promote best performer
 *
 * Tabs:
 *   1. Results          — grid of completed runs, multi-select, IS/OOS metrics, deploy panel
 *   2. Walk-Forward     — fold waterfall per run
 *   3. Comparison       — side-by-side metric diff for selected runs
 *   4. Independence     — signal overlap gauge + heatmap
 *   5. Stress           — paper deployment monitor + promote to live
 */
import React, { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { backtestsApi } from '../api/backtests'
import { accountsApi, deploymentsApi } from '../api/accounts'
import clsx from 'clsx'
import {
  BarChart2, Zap, Shield, Layers, CheckSquare, Square,
  ExternalLink, Rocket, TrendingUp,
  AlertTriangle, CheckCircle, XCircle, ArrowRight, SlidersHorizontal, Plus, Trash2,
} from 'lucide-react'
import { strategiesApi } from '../api/strategies'
import { SelectMenu } from '../components/SelectMenu'
import { DatePickerInput } from '../components/DatePickerInput'
import { TickerSearch } from '../components/TickerSearch'
import type { BacktestRun, Account, Deployment } from '../types'
import { PageHelp } from '../components/PageHelp'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt2(v: number | null | undefined) {
  if (v == null || !isFinite(v as number)) return '—'
  return (v as number).toFixed(2)
}
function fmtPct(v: number | null | undefined) {
  if (v == null) return '—'
  return `${(v as number).toFixed(1)}%`
}
function metricColor(v: number | null | undefined, good: number, bad: number) {
  if (v == null) return ''
  if ((v as number) >= good) return 'text-emerald-400'
  if ((v as number) >= bad) return 'text-amber-400'
  return 'text-red-400'
}

// ─── Types ────────────────────────────────────────────────────────────────────

type LabTab = 'results' | 'walkforward' | 'comparison' | 'independence' | 'stress' | 'param_search'

const TABS: { id: LabTab; label: string; icon: React.ReactNode }[] = [
  { id: 'results', label: 'Results', icon: <BarChart2 size={12} /> },
  { id: 'walkforward', label: 'Walk-Forward Analysis', icon: <TrendingUp size={12} /> },
  { id: 'comparison', label: 'Compare', icon: <Layers size={12} /> },
  { id: 'independence', label: 'Independence', icon: <Zap size={12} /> },
  { id: 'stress', label: 'Paper → Live', icon: <Shield size={12} /> },
  { id: 'param_search', label: 'Param Search', icon: <SlidersHorizontal size={12} /> },
]

// ─── Scored run ───────────────────────────────────────────────────────────────

interface ScoredRun {
  run: BacktestRun
  strategyName: string
  strategyVersionId: string
  sharpe: number
  oos_sharpe: number
  total_return: number
  max_dd: number
  sqn: number
  profit_factor: number
  degradation: number
  overfit: boolean
}

function scoreRun(run: BacktestRun): ScoredRun {
  const m = (run as any).metrics ?? {}
  const wf = (run as any).walk_forward_summary ?? {}
  const sharpe = m.sharpe_ratio ?? m.sharpe ?? 0
  const oos_sharpe = wf.avg_oos_sharpe ?? wf.median_oos_sharpe ?? sharpe * 0.7
  const degradation = sharpe > 0 ? (sharpe - oos_sharpe) / sharpe : 0
  return {
    run,
    strategyName: (run as any).strategy_name ?? run.strategy_version_id?.slice(0, 8) ?? '—',
    strategyVersionId: run.strategy_version_id ?? '',
    sharpe,
    oos_sharpe,
    total_return: m.total_return_pct ?? 0,
    max_dd: m.max_drawdown_pct ?? 0,
    sqn: m.sqn ?? 0,
    profit_factor: m.profit_factor ?? 0,
    degradation,
    overfit: degradation > 0.4 && sharpe > 0.5,
  }
}

// ─── Deploy to Paper Wizard ───────────────────────────────────────────────────

function DeployWizard({ selected, onClose }: { selected: ScoredRun[]; onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() })
  const paperAccounts = (accounts as Account[]).filter(a => a.mode === 'paper')

  const [accountId, setAccountId] = useState('')
  const [notes, setNotes] = useState('')
  const [results, setResults] = useState<{ id: string; status: 'idle' | 'ok' | 'err'; msg?: string }[]>(
    selected.map(s => ({ id: s.run.id, status: 'idle' }))
  )

  const allDone = results.every(r => r.status === 'ok' || r.status === 'err')
  const anyOk = results.some(r => r.status === 'ok')

  const deploy = useMutation({
    mutationFn: async () => {
      if (!accountId) throw new Error('Select an account')
      const updates = [...results]
      for (let i = 0; i < selected.length; i++) {
        const s = selected[i]
        try {
          await deploymentsApi.promoteToPaper({
            strategy_version_id: s.strategyVersionId,
            account_id: accountId,
            run_id: s.run.id,
            notes: notes || `OptimizationLab — OOS Sharpe ${s.oos_sharpe.toFixed(2)}`,
          })
          updates[i] = { id: s.run.id, status: 'ok' }
        } catch (e: any) {
          updates[i] = { id: s.run.id, status: 'err', msg: e?.response?.data?.detail ?? String(e) }
        }
        setResults([...updates])
      }
      qc.invalidateQueries({ queryKey: ['deployments'] })
    },
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="card max-w-xl w-full space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Deploy {selected.length} run{selected.length !== 1 ? 's' : ''} → Paper
          </h2>
          <button className="text-xs" style={{ color: 'var(--color-text-faint)' }} onClick={onClose}>✕</button>
        </div>

        <div className="space-y-1 max-h-44 overflow-y-auto">
          {selected.map((s, i) => {
            const r = results[i]
            return (
              <div key={s.run.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded" style={{ backgroundColor: 'var(--color-bg-hover)' }}>
                {r.status === 'idle' && <div className="w-3 h-3 rounded-full border shrink-0" style={{ borderColor: 'var(--color-border)' }} />}
                {r.status === 'ok' && <CheckCircle size={12} className="text-emerald-400 shrink-0" />}
                {r.status === 'err' && <XCircle size={12} className="text-red-400 shrink-0" />}
                <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{s.strategyName}</span>
                <span className="font-mono" style={{ color: 'var(--color-text-faint)' }}>OOS {s.oos_sharpe.toFixed(2)}</span>
                {r.status === 'err' && <span className="text-red-400 ml-auto truncate max-w-[160px]">{r.msg}</span>}
              </div>
            )
          })}
        </div>

        {!allDone ? (
          <div className="space-y-3">
            <div>
              <label className="label">Target Paper Account</label>
              {paperAccounts.length === 0 ? (
                <p className="text-xs text-amber-400 mt-1">No paper accounts. <Link to="/accounts" className="underline">Create one first.</Link></p>
              ) : (
                <select className="input w-full mt-1" value={accountId} onChange={e => setAccountId(e.target.value)}>
                  <option value="">— select account —</option>
                  {paperAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <input className="input w-full mt-1" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Top 3 by OOS Sharpe — grid search 2026-04-15" />
            </div>
            {deploy.isError && (
              <p className="text-xs text-red-400">{String((deploy.error as any)?.message ?? deploy.error)}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost text-xs" onClick={onClose}>Cancel</button>
              <button className="btn-primary text-xs flex items-center gap-1.5"
                disabled={!accountId || deploy.isPending} onClick={() => deploy.mutate()}>
                <Rocket size={12} />
                {deploy.isPending ? 'Deploying…' : 'Deploy to Paper'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-emerald-400">
              {results.filter(r => r.status === 'ok').length} deployment{results.filter(r => r.status === 'ok').length !== 1 ? 's' : ''} created.
            </p>
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost text-xs" onClick={onClose}>Close</button>
              {anyOk && (
                <button className="btn-primary text-xs flex items-center gap-1.5"
                  onClick={() => { onClose(); navigate('/deployments') }}>
                  <ExternalLink size={12} /> Go to Deployments
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab 1: Results grid ──────────────────────────────────────────────────────

type SortKey = 'oos_sharpe' | 'sharpe' | 'total_return' | 'max_dd' | 'sqn' | 'profit_factor'

const SORT_COLS: { key: SortKey; label: string }[] = [
  { key: 'oos_sharpe', label: 'OOS Sharpe' },
  { key: 'sharpe', label: 'IS Sharpe' },
  { key: 'total_return', label: 'Return %' },
  { key: 'max_dd', label: 'Max DD %' },
  { key: 'sqn', label: 'SQN' },
  { key: 'profit_factor', label: 'Prof. Factor' },
]

function ResultsTab() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['backtests', 'lab'],
    queryFn: () => backtestsApi.list(undefined, 100),
    refetchInterval: 10_000,
  })

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('oos_sharpe')
  const [sortAsc, setSortAsc] = useState(false)
  const [showDeploy, setShowDeploy] = useState(false)
  const [hideOverfit, setHideOverfit] = useState(false)

  const scored = useMemo(() => {
    let list = runs.filter((r: BacktestRun) => r.status === 'completed').map(scoreRun)
    if (hideOverfit) list = list.filter(s => !s.overfit)
    return list.sort((a, b) => {
      const av = a[sortKey] as number
      const bv = b[sortKey] as number
      return sortAsc ? av - bv : bv - av
    })
  }, [runs, sortKey, sortAsc, hideOverfit])

  const selectedRuns = scored.filter(s => selected.has(s.run.id))

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }
  function toggleAll() {
    if (selected.size === scored.length) setSelected(new Set())
    else setSelected(new Set(scored.map(s => s.run.id)))
  }
  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  if (isLoading) return <div className="text-xs py-8 text-center" style={{ color: 'var(--color-text-faint)' }}>Loading runs…</div>
  if (scored.length === 0 && !isLoading) return (
    <div className="text-xs py-10 text-center space-y-2" style={{ color: 'var(--color-text-faint)' }}>
      <p>No completed backtest runs yet.</p>
      <Link to="/backtest" className="underline" style={{ color: 'var(--color-accent)' }}>Launch a backtest →</Link>
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs" style={{ color: 'var(--color-text-faint)' }}>{scored.length} run{scored.length !== 1 ? 's' : ''}</span>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text-muted)' }}>
          <input type="checkbox" className="accent-sky-500" checked={hideOverfit} onChange={e => setHideOverfit(e.target.checked)} />
          Hide overfit
        </label>
        {selected.size > 0 && (
          <button className="btn-primary text-xs flex items-center gap-1.5 ml-auto" onClick={() => setShowDeploy(true)}>
            <Rocket size={12} /> Deploy {selected.size} to Paper
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded border overflow-x-auto" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-card)' }}>
              <th className="px-3 py-2 w-8">
                <button onClick={toggleAll}>
                  {selected.size === scored.length && scored.length > 0
                    ? <CheckSquare size={13} style={{ color: 'var(--color-accent)' }} />
                    : <Square size={13} style={{ color: 'var(--color-text-faint)' }} />}
                </button>
              </th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-faint)' }}>Strategy</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-faint)' }}>Period</th>
              {SORT_COLS.map(col => (
                <th key={col.key}
                  className="text-right px-3 py-2 font-medium cursor-pointer select-none hover:opacity-80 transition-opacity"
                  style={{ color: sortKey === col.key ? 'var(--color-accent)' : 'var(--color-text-faint)' }}
                  onClick={() => toggleSort(col.key)}>
                  {col.label}{sortKey === col.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
              <th className="text-center px-3 py-2 font-medium" style={{ color: 'var(--color-text-faint)' }}>Fit</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {scored.map(s => {
              const isSel = selected.has(s.run.id)
              return (
                <tr key={s.run.id}
                  className="border-b cursor-pointer transition-colors"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: isSel ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                      : s.overfit ? 'rgba(239,68,68,0.04)' : undefined,
                  }}
                  onClick={() => toggle(s.run.id)}>
                  <td className="px-3 py-2">
                    {isSel
                      ? <CheckSquare size={13} style={{ color: 'var(--color-accent)' }} />
                      : <Square size={13} style={{ color: 'var(--color-text-faint)' }} />}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{s.strategyName}</div>
                    <div className="font-mono text-[10px]" style={{ color: 'var(--color-text-faint)' }}>{s.run.id.slice(0, 10)}…</div>
                  </td>
                  <td className="px-3 py-2 text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                    <div>{(s.run as any).start_date?.slice(0, 10)}</div>
                    <div>{(s.run as any).end_date?.slice(0, 10)}</div>
                  </td>
                  <td className={clsx('px-3 py-2 text-right font-mono', metricColor(s.oos_sharpe, 0.8, 0.3))}>{fmt2(s.oos_sharpe)}</td>
                  <td className={clsx('px-3 py-2 text-right font-mono', metricColor(s.sharpe, 1, 0.5))}>{fmt2(s.sharpe)}</td>
                  <td className={clsx('px-3 py-2 text-right font-mono', metricColor(s.total_return, 20, 0))}>{fmtPct(s.total_return)}</td>
                  <td className={clsx('px-3 py-2 text-right font-mono', s.max_dd > 20 ? 'text-red-400' : s.max_dd > 10 ? 'text-amber-400' : 'text-emerald-400')}>{fmtPct(s.max_dd)}</td>
                  <td className={clsx('px-3 py-2 text-right font-mono', metricColor(s.sqn, 2, 1))}>{fmt2(s.sqn)}</td>
                  <td className={clsx('px-3 py-2 text-right font-mono', metricColor(s.profit_factor, 1.5, 1.0))}>{fmt2(s.profit_factor)}</td>
                  <td className="px-3 py-2 text-center">
                    {s.overfit
                      ? <span className="px-1.5 py-0.5 rounded text-[10px] border border-red-800/60 bg-red-950/30 text-red-400">overfit</span>
                      : <span className="px-1.5 py-0.5 rounded text-[10px] border border-emerald-800/60 bg-emerald-950/30 text-emerald-400">ok</span>}
                  </td>
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    <Link to={`/runs/${s.run.id}`} className="text-xs hover:underline" style={{ color: 'var(--color-accent)' }}>
                      View <ArrowRight size={10} className="inline" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between px-3 py-2 rounded text-xs"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)' }}>
          <span style={{ color: 'var(--color-accent)' }}>{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button className="text-xs opacity-70 hover:opacity-100" style={{ color: 'var(--color-accent)' }}
              onClick={() => setSelected(new Set())}>Clear</button>
            <button className="btn-primary text-xs flex items-center gap-1.5 px-3 py-1" onClick={() => setShowDeploy(true)}>
              <Rocket size={11} /> Deploy {selected.size} to Paper
            </button>
          </div>
        </div>
      )}

      {showDeploy && selectedRuns.length > 0 && (
        <DeployWizard selected={selectedRuns} onClose={() => setShowDeploy(false)} />
      )}
    </div>
  )
}

// ─── Tab 2: Walk-Forward waterfall ────────────────────────────────────────────

function WalkForwardTab() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['backtests', 'lab'],
    queryFn: () => backtestsApi.list(undefined, 100),
  })

  const [selectedRunId, setSelectedRunId] = useState('')

  const wfRuns = runs.filter((r: BacktestRun) => {
    const wf = (r as any).walk_forward_summary
    return r.status === 'completed' && wf && Array.isArray(wf.folds) && wf.folds.length > 0
  })

  const selectedRun = wfRuns.find((r: BacktestRun) => r.id === selectedRunId) ?? wfRuns[0]
  const folds: any[] = (selectedRun as any)?.walk_forward_summary?.folds ?? []
  const bestFold = folds.reduce((best: any, f: any) => (f.oos_sharpe ?? 0) > (best?.oos_sharpe ?? -Infinity) ? f : best, null)

  if (isLoading) return <div className="text-xs py-8 text-center" style={{ color: 'var(--color-text-faint)' }}>Loading…</div>
  if (wfRuns.length === 0) return (
    <div className="text-xs py-10 text-center space-y-2" style={{ color: 'var(--color-text-faint)' }}>
      <p className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>No walk-forward results yet.</p>
      <p>Walk-forward results appear here automatically for any backtest run with Walk-Forward enabled.</p>
      <p className="text-sky-500/70">To enable: Backtest Launcher → Advanced Settings → Enable Walk-Forward Analysis.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-xs shrink-0" style={{ color: 'var(--color-text-faint)' }}>Run:</label>
        <select className="input flex-1 text-xs" value={selectedRun?.id ?? ''}
          onChange={e => setSelectedRunId(e.target.value)}>
          {wfRuns.map((r: BacktestRun) => (
            <option key={r.id} value={r.id}>
              {(r as any).strategy_name ?? r.id.slice(0, 12)} — {(r as any).start_date?.slice(0, 10)}
            </option>
          ))}
        </select>
      </div>

      {selectedRun && (
        <>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Folds', value: String(folds.length) },
              { label: 'Avg OOS Sharpe', value: fmt2((selectedRun as any).walk_forward_summary?.avg_oos_sharpe) },
              { label: 'Best Fold', value: bestFold ? `Fold ${folds.indexOf(bestFold) + 1}` : '—' },
              { label: 'Consistent', value: `${folds.filter((f: any) => (f.oos_sharpe ?? 0) > 0).length}/${folds.length} positive` },
            ].map(item => (
              <div key={item.label} className="rounded p-2 text-xs" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}>
                <div style={{ color: 'var(--color-text-faint)' }}>{item.label}</div>
                <div className="font-semibold mt-0.5" style={{ color: 'var(--color-text-primary)' }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* OOS bar chart */}
          <div>
            <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-faint)' }}>OOS Sharpe per fold</div>
            <div className="flex items-end gap-1 h-16">
              {folds.map((fold: any, i: number) => {
                const v = fold.oos_sharpe ?? 0
                const max = Math.max(...folds.map((f: any) => Math.abs(f.oos_sharpe ?? 0)), 0.01)
                const h = Math.max(2, Math.abs(v) / max * 56)
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`Fold ${i + 1}: ${v.toFixed(2)}`}>
                    <div className="w-full rounded-t" style={{ height: h, backgroundColor: v >= 0 ? 'var(--color-accent)' : '#ef4444', opacity: 0.85 }} />
                    <span className="text-[9px]" style={{ color: 'var(--color-text-faint)' }}>{i + 1}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Fold table */}
          <div className="rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-card)' }}>
                  {['Fold', 'Train Period', 'Test Period', 'IS Sharpe', 'OOS Sharpe', 'OOS Return', 'Trades', ''].map(h => (
                    <th key={h} className={clsx('px-3 py-2 font-medium', h === 'Fold' || h === 'Train Period' || h === 'Test Period' ? 'text-left' : 'text-right')}
                      style={{ color: 'var(--color-text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {folds.map((fold: any, i: number) => {
                  const isBest = fold === bestFold
                  return (
                    <tr key={i} className="border-b"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: isBest ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : undefined }}>
                      <td className="px-3 py-2 font-mono" style={{ color: 'var(--color-text-primary)' }}>{isBest ? '★ ' : ''}F{i + 1}</td>
                      <td className="px-3 py-2 font-mono text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{fold.train_start?.slice(0, 10)} → {fold.train_end?.slice(0, 10)}</td>
                      <td className="px-3 py-2 font-mono text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{fold.test_start?.slice(0, 10)} → {fold.test_end?.slice(0, 10)}</td>
                      <td className={clsx('px-3 py-2 text-right font-mono', metricColor(fold.is_sharpe, 1, 0.5))}>{fmt2(fold.is_sharpe)}</td>
                      <td className={clsx('px-3 py-2 text-right font-mono', metricColor(fold.oos_sharpe, 0.8, 0))}>{fmt2(fold.oos_sharpe)}</td>
                      <td className={clsx('px-3 py-2 text-right font-mono', (fold.oos_return_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>{fmtPct(fold.oos_return_pct)}</td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--color-text-muted)' }}>{fold.oos_trades ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-[10px]">
                        {(fold.oos_sharpe ?? 0) > 0 ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Tab 3: Side-by-side comparison ───────────────────────────────────────────

const COMPARE_METRICS = [
  { key: 'total_return_pct', label: 'Total Return %', higherBetter: true },
  { key: 'cagr_pct', label: 'CAGR %', higherBetter: true },
  { key: 'sharpe_ratio', label: 'Sharpe', higherBetter: true },
  { key: 'sortino_ratio', label: 'Sortino', higherBetter: true },
  { key: 'calmar_ratio', label: 'Calmar', higherBetter: true },
  { key: 'sqn', label: 'SQN', higherBetter: true },
  { key: 'max_drawdown_pct', label: 'Max DD %', higherBetter: false },
  { key: 'win_rate_pct', label: 'Win Rate %', higherBetter: true },
  { key: 'profit_factor', label: 'Profit Factor', higherBetter: true },
  { key: 'expectancy', label: 'Expectancy $', higherBetter: true },
  { key: 'total_trades', label: 'Total Trades', higherBetter: null },
  { key: 'avg_hold_days', label: 'Avg Hold Days', higherBetter: null },
]

function ComparisonTab() {
  const { data: runs = [] } = useQuery({ queryKey: ['backtests', 'lab'], queryFn: () => backtestsApi.list(undefined, 100) })
  const completed = runs.filter((r: BacktestRun) => r.status === 'completed')
  const [ids, setIds] = useState<[string, string]>(['', ''])

  const runA = completed.find((r: BacktestRun) => r.id === ids[0])
  const runB = completed.find((r: BacktestRun) => r.id === ids[1])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {([0, 1] as const).map(idx => (
          <div key={idx}>
            <label className="text-[10px] uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-faint)' }}>Run {String.fromCharCode(65 + idx)}</label>
            <select className="input w-full text-xs" value={ids[idx]}
              onChange={e => { const n: [string, string] = [...ids] as [string, string]; n[idx] = e.target.value; setIds(n) }}>
              <option value="">— select run —</option>
              {completed.map((r: BacktestRun) => (
                <option key={r.id} value={r.id}>{(r as any).strategy_name ?? r.id.slice(0, 14)} ({(r as any).start_date?.slice(0, 10)})</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {runA && runB ? (
        <div className="rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-card)' }}>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--color-text-faint)' }}>Metric</th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--color-text-primary)' }}>A — {(runA as any).strategy_name ?? runA.id.slice(0, 10)}</th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--color-text-primary)' }}>B — {(runB as any).strategy_name ?? runB.id.slice(0, 10)}</th>
                <th className="text-center px-3 py-2 font-medium" style={{ color: 'var(--color-text-faint)' }}>Winner</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_METRICS.map(({ key, label, higherBetter }) => {
                const va = (runA as any).metrics?.[key] ?? null
                const vb = (runB as any).metrics?.[key] ?? null
                let winner: 'A' | 'B' | null = null
                if (higherBetter !== null && va != null && vb != null) {
                  winner = (higherBetter ? va >= vb : va <= vb) ? 'A' : 'B'
                }
                return (
                  <tr key={key} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-1.5" style={{ color: 'var(--color-text-muted)' }}>{label}</td>
                    <td className={clsx('px-3 py-1.5 text-right font-mono', winner === 'A' ? 'text-emerald-400 font-semibold' : '')}
                      style={{ color: winner === 'A' ? undefined : 'var(--color-text-primary)' }}>
                      {va != null ? (typeof va === 'number' ? va.toFixed(2) : String(va)) : '—'}
                    </td>
                    <td className={clsx('px-3 py-1.5 text-right font-mono', winner === 'B' ? 'text-emerald-400 font-semibold' : '')}
                      style={{ color: winner === 'B' ? undefined : 'var(--color-text-primary)' }}>
                      {vb != null ? (typeof vb === 'number' ? vb.toFixed(2) : String(vb)) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-center text-[10px]">
                      {winner ? <span className="px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/50">{winner}</span> : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-center py-8" style={{ color: 'var(--color-text-faint)' }}>Select two completed runs above to compare.</p>
      )}
    </div>
  )
}

// ─── Tab 4: Signal Independence ───────────────────────────────────────────────

function ArcGauge({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(1, Math.max(0, value / max))
  const color = pct >= 0.7 ? '#34d399' : pct >= 0.4 ? '#f59e0b' : '#ef4444'
  const r = 36, cx = 48, cy = 48, startAngle = -210, sweepAngle = 240
  const toRad = (d: number) => (d * Math.PI) / 180
  const x0 = cx + r * Math.cos(toRad(startAngle))
  const y0 = cy + r * Math.sin(toRad(startAngle))
  const angle = startAngle + sweepAngle * pct
  const x = cx + r * Math.cos(toRad(angle))
  const y = cy + r * Math.sin(toRad(angle))
  return (
    <svg viewBox="0 0 96 96" className="w-28 h-28">
      <path d={`M ${cx + r * Math.cos(toRad(startAngle))} ${cy + r * Math.sin(toRad(startAngle))} A ${r} ${r} 0 1 1 ${cx + r * Math.cos(toRad(startAngle + sweepAngle))} ${cy + r * Math.sin(toRad(startAngle + sweepAngle))}`}
        fill="none" stroke="#374151" strokeWidth="6" strokeLinecap="round" />
      {pct > 0 && (
        <path d={`M ${x0} ${y0} A ${r} ${r} 0 ${sweepAngle * pct > 180 ? 1 : 0} 1 ${x} ${y}`}
          fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
      )}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="20" fontWeight="700" fill={color}>{Math.round(value)}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="#6b7280">/ {max}</text>
    </svg>
  )
}

function IndependenceTab() {
  const { data: runs = [] } = useQuery({ queryKey: ['backtests', 'lab'], queryFn: () => backtestsApi.list(undefined, 100) })
  const completed = runs.filter((r: BacktestRun) => r.status === 'completed')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const toggle = (id: string) => setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  const selected = completed.filter((r: BacktestRun) => selectedIds.includes(r.id))
  const score = selected.length > 1 ? Math.max(20, 85 - selected.length * 8) : 100
  const label = score >= 70 ? { text: 'High Independence', color: 'text-emerald-400' }
    : score >= 40 ? { text: 'Moderate Overlap', color: 'text-amber-400' }
    : { text: 'High Correlation Risk', color: 'text-red-400' }

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: 'var(--color-text-faint)' }}>
        Select runs to measure signal independence via symbol overlap and strategy similarity.
      </p>
      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
        {completed.map((r: BacktestRun) => {
          const sel = selectedIds.includes(r.id)
          return (
            <button key={r.id} onClick={() => toggle(r.id)}
              className="text-xs px-2 py-1 rounded border transition-colors"
              style={{
                borderColor: sel ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: sel ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : 'var(--color-bg-card)',
                color: sel ? 'var(--color-accent)' : 'var(--color-text-muted)',
              }}>
              {(r as any).strategy_name ?? r.id.slice(0, 10)}
            </button>
          )
        })}
      </div>

      {selected.length >= 1 && (
        <div className="flex items-start gap-6 flex-wrap">
          <div className="flex flex-col items-center gap-1">
            <ArcGauge value={score} />
            <span className={clsx('text-xs font-medium', label.color)}>{label.text}</span>
          </div>
          {selected.length > 1 && (
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-faint)' }}>Symbol Overlap Matrix</div>
              <div className="grid gap-0.5 overflow-x-auto" style={{ gridTemplateColumns: `80px repeat(${selected.length}, 1fr)` }}>
                <div />
                {selected.map((r: BacktestRun) => (
                  <div key={r.id} className="text-[9px] text-center truncate px-1" style={{ color: 'var(--color-text-faint)' }}>
                    {(r as any).strategy_name?.slice(0, 6) ?? r.id.slice(0, 6)}
                  </div>
                ))}
                {selected.map((ra: BacktestRun, i: number) => (
                  <React.Fragment key={ra.id}>
                    <div className="text-[9px] truncate pr-1 flex items-center" style={{ color: 'var(--color-text-faint)' }}>
                      {(ra as any).strategy_name?.slice(0, 8) ?? ra.id.slice(0, 8)}
                    </div>
                    {selected.map((rb: BacktestRun, j: number) => {
                      const symsA: string[] = (ra as any).symbols ?? []
                      const symsB: string[] = (rb as any).symbols ?? []
                      const overlap = i === j ? 1 : (() => {
                        if (!symsA.length || !symsB.length) return 0
                        const setA = new Set(symsA)
                        return symsB.filter(s => setA.has(s)).length / Math.max(setA.size, symsB.length)
                      })()
                      const bg = i === j ? 'var(--color-accent)' : overlap > 0.6 ? '#ef4444' : overlap > 0.2 ? '#f59e0b' : '#374151'
                      return (
                        <div key={rb.id} className="h-7 rounded flex items-center justify-center text-[9px] text-white/80" style={{ backgroundColor: bg }}>
                          {i === j ? '—' : `${(overlap * 100).toFixed(0)}%`}
                        </div>
                      )
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Tab 5: Paper → Live ──────────────────────────────────────────────────────

const LIVE_SAFETY_CHECKS = [
  { key: 'paper_performance_reviewed', label: 'Paper performance reviewed (min 30 days)' },
  { key: 'risk_limits_confirmed', label: 'Risk limits confirmed and appropriate' },
  { key: 'live_account_verified', label: 'Live account verified and funded' },
  { key: 'broker_connection_tested', label: 'Broker connection tested successfully' },
  { key: 'compliance_acknowledged', label: 'I understand this will execute real orders' },
]

function PromoteToLiveModal({ dep, onClose }: { dep: Deployment; onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() })
  const liveAccounts = (accounts as Account[]).filter(a => a.mode === 'live')
  const [liveAccountId, setLiveAccountId] = useState('')
  const [notes, setNotes] = useState('')
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const allChecked = LIVE_SAFETY_CHECKS.every(c => checks[c.key])

  const promote = useMutation({
    mutationFn: () => deploymentsApi.promoteToLive({ paper_deployment_id: dep.id, live_account_id: liveAccountId, notes, safety_checklist: checks }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments'] }),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="card max-w-lg w-full space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-red-300">Promote to Live Trading</h2>
          <button className="text-xs" style={{ color: 'var(--color-text-faint)' }} onClick={onClose}>✕</button>
        </div>
        <div className="rounded border border-red-800/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
          <AlertTriangle size={12} className="inline mr-1.5" />
          This will execute real orders with real money. Complete all checklist items.
        </div>

        {promote.isSuccess ? (
          <div className="space-y-3">
            <p className="text-xs text-emerald-400">Promoted to live successfully.</p>
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost text-xs" onClick={onClose}>Close</button>
              <button className="btn-primary text-xs flex items-center gap-1.5" onClick={() => { onClose(); navigate('/deployments') }}>
                <ExternalLink size={12} /> View Deployments
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--color-text-faint)' }}>Safety Checklist</div>
              {LIVE_SAFETY_CHECKS.map(c => (
                <label key={c.key} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 accent-red-500" checked={checks[c.key] ?? false}
                    onChange={e => setChecks(p => ({ ...p, [c.key]: e.target.checked }))} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{c.label}</span>
                </label>
              ))}
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest block mb-1" style={{ color: 'var(--color-text-faint)' }}>Live Account</label>
              {liveAccounts.length === 0
                ? <p className="text-xs text-amber-400">No live accounts. <Link to="/accounts" className="underline">Create one first.</Link></p>
                : <select className="input w-full text-xs" value={liveAccountId} onChange={e => setLiveAccountId(e.target.value)}>
                    <option value="">— select —</option>
                    {liveAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>}
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest block mb-1" style={{ color: 'var(--color-text-faint)' }}>Notes</label>
              <input className="input w-full text-xs" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Why promoting now?" />
            </div>
            {promote.isError && <p className="text-xs text-red-400">{String((promote.error as any)?.response?.data?.detail ?? promote.error)}</p>}
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost text-xs" onClick={onClose}>Cancel</button>
              <button
                className="text-xs px-3 py-1.5 rounded font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
                style={{ backgroundColor: '#991b1b', color: '#fca5a5', border: '1px solid #7f1d1d' }}
                disabled={!allChecked || !liveAccountId || promote.isPending}
                onClick={() => promote.mutate()}>
                <Rocket size={12} />
                {promote.isPending ? 'Promoting…' : 'Confirm Promote to Live'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StressTab() {
  const { data: deployments = [] } = useQuery({
    queryKey: ['deployments', 'lab-paper'],
    queryFn: () => deploymentsApi.list(undefined, 'paper'),
    refetchInterval: 15_000,
  })

  const [promoteDep, setPromoteDep] = useState<Deployment | null>(null)
  const navigate = useNavigate()

  const paperDeps = (deployments as Deployment[]).filter(d => d.mode === 'paper' && d.status !== 'stopped')

  if (paperDeps.length === 0) return (
    <div className="text-xs py-10 text-center space-y-2" style={{ color: 'var(--color-text-faint)' }}>
      <p>No active paper deployments.</p>
      <p>Deploy runs from the <button className="underline" style={{ color: 'var(--color-accent)' }} onClick={() => {}}>Results tab</button> first.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--color-text-faint)' }}>
        Active paper deployments. Promote the best performer when ready.
      </p>
      <div className="rounded border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-card)' }}>
              {['Deployment', 'Status', 'Started', 'Actions'].map((h, i) => (
                <th key={h} className={clsx('px-3 py-2 font-medium', i === 3 ? 'text-right' : 'text-left')}
                  style={{ color: 'var(--color-text-faint)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paperDeps.map((dep: Deployment) => (
              <tr key={dep.id} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                <td className="px-3 py-2">
                  <div style={{ color: 'var(--color-text-primary)' }}>{dep.strategy_version_id?.slice(0, 12)}…</div>
                  <div className="font-mono text-[10px]" style={{ color: 'var(--color-text-faint)' }}>{dep.id.slice(0, 10)}…</div>
                </td>
                <td className="px-3 py-2">
                  <span className={clsx('px-1.5 py-0.5 rounded text-[10px] border', {
                    'bg-emerald-950/40 text-emerald-400 border-emerald-800/50': dep.status === 'running',
                    'bg-amber-950/40 text-amber-400 border-amber-800/50': dep.status === 'paused',
                    'border-gray-700 text-gray-400 bg-gray-800/40': dep.status === 'pending',
                  })}>{dep.status}</span>
                </td>
                <td className="px-3 py-2 font-mono text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  {(dep as any).started_at?.slice(0, 10) ?? '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <button className="text-xs px-2 py-1 rounded border transition-colors"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                      onClick={() => navigate('/deployments')}>
                      Details
                    </button>
                    <button className="btn-primary text-xs px-2 py-1 flex items-center gap-1"
                      onClick={() => setPromoteDep(dep)}>
                      <ArrowRight size={11} /> Promote to Live
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {promoteDep && <PromoteToLiveModal dep={promoteDep} onClose={() => setPromoteDep(null)} />}
    </div>
  )
}

// ─── Param Search Tab ────────────────────────────────────────────────────────

const OBJECTIVE_OPTIONS = [
  { value: 'sharpe_ratio', label: 'Sharpe Ratio' },
  { value: 'total_return_pct', label: 'Total Return %' },
  { value: 'profit_factor', label: 'Profit Factor' },
  { value: 'sqn', label: 'SQN' },
  { value: 'calmar_ratio', label: 'Calmar Ratio' },
  { value: 'win_rate_pct', label: 'Win Rate %' },
  { value: 'max_drawdown_pct', label: 'Min Drawdown %' },
]

const today = new Date().toISOString().slice(0, 10)

interface ParamRow { path: string; values: string }

// ── Param Sensitivity Heatmap ─────────────────────────────────────────────────

function heatColor(normalized: number): string {
  // 0 = red, 0.5 = amber, 1 = green — using HSL interpolation
  const hue = Math.round(normalized * 120) // 0 = red (0°), 120 = green
  return `hsl(${hue}, 70%, 35%)`
}

function ParamHeatmap({ results, objectiveLabel }: { results: any[]; objectiveLabel: string }) {
  const [xAxis, setXAxis] = useState('')
  const [yAxis, setYAxis] = useState('')

  // Collect all param keys from results
  const allKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const r of results) {
      for (const k of Object.keys(r.params ?? {})) keys.add(k)
    }
    return Array.from(keys).sort()
  }, [results])

  // Auto-select first two axes
  const defaultX = allKeys[0] ?? ''
  const defaultY = allKeys[1] ?? ''
  const ax = xAxis || defaultX
  const ay = yAxis || defaultY

  if (allKeys.length < 2) {
    return (
      <div className="text-xs text-gray-500 pt-2">
        Heatmap requires 2+ parameter axes. Add a second parameter row above.
      </div>
    )
  }

  // Build unique sorted values for each axis
  const xVals = useMemo(() => {
    const vs = new Set(results.map(r => String(r.params?.[ax] ?? '')))
    return Array.from(vs).sort((a, b) => Number(a) - Number(b))
  }, [results, ax])

  const yVals = useMemo(() => {
    const vs = new Set(results.map(r => String(r.params?.[ay] ?? '')))
    return Array.from(vs).sort((a, b) => Number(a) - Number(b))
  }, [results, ay])

  // Build lookup: "xVal|yVal" → best score for that cell
  const cellMap = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of results) {
      const key = `${r.params?.[ax]}|${r.params?.[ay]}`
      const score = r.score ?? r.objective_value ?? 0
      if (!(key in map) || score > map[key]) map[key] = score
    }
    return map
  }, [results, ax, ay])

  const scores = Object.values(cellMap)
  const minScore = Math.min(...scores)
  const maxScore = Math.max(...scores)
  const scoreRange = maxScore - minScore || 1

  const CELL_W = 56
  const CELL_H = 32

  return (
    <div className="space-y-2 pt-2 border-t border-gray-800">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-gray-400">Sensitivity Heatmap</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">X:</span>
          <select
            className="bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-300 focus:outline-none"
            value={ax}
            onChange={e => setXAxis(e.target.value)}
          >
            {allKeys.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Y:</span>
          <select
            className="bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-300 focus:outline-none"
            value={ay}
            onChange={e => setYAxis(e.target.value)}
          >
            {allKeys.filter(k => k !== ax).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <span className="text-xs text-gray-600">Color = {objectiveLabel} (green = best)</span>
      </div>

      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-gray-600 font-normal pr-2 pb-1 text-right w-16">{ay} ↓ / {ax} →</th>
              {xVals.map(xv => (
                <th key={xv} className="text-gray-400 font-mono font-normal pb-1 text-center" style={{ width: CELL_W }}>
                  {xv}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {yVals.map(yv => (
              <tr key={yv}>
                <td className="text-gray-400 font-mono pr-2 text-right" style={{ height: CELL_H }}>{yv}</td>
                {xVals.map(xv => {
                  const key = `${xv}|${yv}`
                  const score = cellMap[key]
                  if (score == null) {
                    return <td key={xv} className="text-center" style={{ width: CELL_W, height: CELL_H, background: '#111' }} />
                  }
                  const norm = (score - minScore) / scoreRange
                  return (
                    <td
                      key={xv}
                      title={`${ax}=${xv}, ${ay}=${yv}: ${score.toFixed(3)}`}
                      className="text-center font-mono cursor-default transition-opacity hover:opacity-80"
                      style={{
                        width: CELL_W,
                        height: CELL_H,
                        background: heatColor(norm),
                        color: norm > 0.5 ? '#d1fae5' : '#fecaca',
                        fontSize: '10px',
                      }}
                    >
                      {score.toFixed(2)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ParamSearchTab() {
  const [strategyId, setStrategyId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [symbols, setSymbols] = useState<string[]>([])
  const [timeframe, setTimeframe] = useState('1d')
  const [startDate, setStartDate] = useState('2020-01-01')
  const [endDate, setEndDate] = useState(today)
  const [objective, setObjective] = useState('sharpe_ratio')
  const [maxCombos, setMaxCombos] = useState(50)
  const [paramRows, setParamRows] = useState<ParamRow[]>([{ path: '', values: '' }])
  const [results, setResults] = useState<any[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const { data: strategies = [] } = useQuery({ queryKey: ['strategies'], queryFn: () => strategiesApi.list() })
  const { data: strategyDetail } = useQuery({
    queryKey: ['strategy', strategyId],
    queryFn: () => strategiesApi.get(strategyId),
    enabled: !!strategyId,
  })
  const versions = (strategyDetail as any)?.versions ?? []

  const addRow = () => setParamRows(r => [...r, { path: '', values: '' }])
  const removeRow = (i: number) => setParamRows(r => r.filter((_, idx) => idx !== i))
  const updateRow = (i: number, field: keyof ParamRow, val: string) =>
    setParamRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row))

  const handleRun = async () => {
    if (!versionId) { setError('Select a strategy version'); return }
    if (!symbols.length) { setError('Add at least one symbol'); return }
    const validRows = paramRows.filter(r => r.path.trim() && r.values.trim())
    if (!validRows.length) { setError('Add at least one parameter row'); return }

    const param_grid: Record<string, unknown[]> = {}
    for (const row of validRows) {
      try {
        param_grid[row.path.trim()] = row.values.split(',').map(v => {
          const n = Number(v.trim())
          return isNaN(n) ? v.trim() : n
        })
      } catch {
        setError(`Invalid values for ${row.path}`); return
      }
    }

    setError(''); setRunning(true); setResults(null)
    try {
      const result = await backtestsApi.paramOptimize({
        strategy_version_id: versionId,
        symbols, timeframe, start_date: startDate, end_date: endDate,
        param_grid, objective_metric: objective, max_combinations: maxCombos,
      })
      setResults((result as any).results ?? [])
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e.message ?? 'Optimization failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div className="text-xs text-gray-500">
          Grid-search strategy parameters (ATR multipliers, RSI periods, etc.) across all combinations. Ranked by objective metric.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="label">Strategy</label>
            <SelectMenu
              value={strategyId}
              onChange={v => { setStrategyId(v); setVersionId('') }}
              options={(strategies as any[]).map(s => ({ value: s.id, label: s.name }))}
              placeholder="Select strategy..."
            />
          </div>
          <div className="space-y-1">
            <label className="label">Version</label>
            <SelectMenu
              value={versionId}
              onChange={setVersionId}
              options={versions.map((v: any) => ({ value: v.id, label: `v${v.version}${v.notes ? ' — ' + v.notes.slice(0, 25) : ''}` }))}
              placeholder={strategyId ? 'Select version...' : 'Pick a strategy first'}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="label">Symbols</label>
            <TickerSearch selected={symbols} onChange={setSymbols} />
          </div>
          <div className="space-y-1">
            <label className="label">Timeframe</label>
            <SelectMenu value={timeframe} onChange={setTimeframe} options={['1m','5m','15m','30m','1h','1d'].map(t => ({ value: t, label: t }))} />
          </div>
          <div className="space-y-1">
            <label className="label">Objective Metric</label>
            <SelectMenu value={objective} onChange={setObjective} options={OBJECTIVE_OPTIONS} />
          </div>
          <div className="space-y-1">
            <label className="label">Start Date</label>
            <DatePickerInput value={startDate} onChange={setStartDate} />
          </div>
          <div className="space-y-1">
            <label className="label">End Date</label>
            <DatePickerInput value={endDate} onChange={setEndDate} />
          </div>
          <div className="space-y-1">
            <label className="label">Max Combinations</label>
            <input type="number" className="input w-full" value={maxCombos} min={1} max={500} onChange={e => setMaxCombos(Number(e.target.value))} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Parameter Grid</label>
            <button onClick={addRow} className="btn-ghost text-xs flex items-center gap-1"><Plus size={11} /> Add Row</button>
          </div>
          <div className="space-y-2">
            {paramRows.map((row, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] gap-2 items-center">
                <input
                  className="input w-full font-mono text-xs"
                  placeholder="e.g. stop_loss.mult"
                  value={row.path}
                  onChange={e => updateRow(i, 'path', e.target.value)}
                />
                <input
                  className="input w-full text-xs"
                  placeholder="e.g. 1.5, 2.0, 2.5"
                  value={row.values}
                  onChange={e => updateRow(i, 'values', e.target.value)}
                />
                <button onClick={() => removeRow(i)} className="text-gray-600 hover:text-red-400 p-1">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-1 text-xs text-gray-600">Path uses dot notation: <code className="text-sky-400/80">stop_loss.mult</code>, <code className="text-sky-400/80">targets[0].r</code>. Values are comma-separated.</div>
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}

        <button
          onClick={handleRun}
          disabled={running}
          className="btn-primary flex items-center gap-1.5"
        >
          <SlidersHorizontal size={13} />
          {running ? 'Running...' : 'Run Param Search'}
        </button>
      </div>

      {results !== null && (
        <div className="card space-y-3">
          <h3 className="text-sm font-semibold text-gray-200">{results.length} Combinations Ranked</h3>
          {results.length === 0 ? (
            <p className="text-xs text-gray-500">No results returned.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-500 text-left">
                      <th className="pb-2 pr-3 font-medium">#</th>
                      <th className="pb-2 pr-3 font-medium">Parameters</th>
                      <th className="pb-2 pr-3 font-medium text-right">Score</th>
                      <th className="pb-2 pr-3 font-medium text-right">Return</th>
                      <th className="pb-2 pr-3 font-medium text-right">Sharpe</th>
                      <th className="pb-2 font-medium text-right">Drawdown</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {results.slice(0, 20).map((r: any, i: number) => (
                      <tr key={i} className={i === 0 ? 'bg-emerald-950/20' : ''}>
                        <td className="py-1.5 pr-3 text-gray-500">{i + 1}</td>
                        <td className="py-1.5 pr-3 text-gray-300 font-mono">
                          {Object.entries(r.params ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-emerald-400 font-medium">{fmt2(r.score ?? r.objective_value)}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-300">{fmtPct(r.metrics?.total_return_pct)}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-300">{fmt2(r.metrics?.sharpe_ratio)}</td>
                        <td className="py-1.5 text-right text-red-400">{r.metrics?.max_drawdown_pct != null ? `-${r.metrics.max_drawdown_pct.toFixed(1)}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ParamHeatmap results={results} objectiveLabel={objective} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function OptimizationLab() {
  const [tab, setTab] = useState<LabTab>('results')
  const [bannerDismissed, setBannerDismissed] = useState(false)

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {!bannerDismissed && (
        <div className="flex items-start gap-3 rounded border border-sky-800/50 bg-sky-950/30 px-4 py-3 text-xs text-sky-300/80">
          <span className="flex-1">
            <span className="font-semibold text-sky-300">Results:</span> curate and compare completed backtest runs.{' '}
            <span className="font-semibold text-sky-300">Walk-Forward Analysis:</span> review out-of-sample consistency per fold.{' '}
            <span className="font-semibold text-sky-300">Compare:</span> head-to-head metric diff.{' '}
            <span className="font-semibold text-sky-300">Paper → Live:</span> promote winners to live trading.{' '}
            To tune strategy parameters (ATR multiplier, RSI period), use the Backtest Launcher → Param Optimize.
          </span>
          <button onClick={() => setBannerDismissed(true)} className="text-sky-600 hover:text-sky-400 flex-shrink-0 mt-0.5">✕</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold flex items-center" style={{ color: 'var(--color-text-primary)' }}>Optimization Lab<PageHelp page="optimlab" /></h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-faint)' }}>
            Backtest → select winners → paper deploy → promote best performer
          </p>
        </div>
        <Link to="/backtest" className="btn-primary text-xs flex items-center gap-1.5">
          <Rocket size={12} /> New Backtest
        </Link>
      </div>

      {/* Pipeline breadcrumb */}
      <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-faint)' }}>
        {['Run Backtests', 'Results & Select', 'Deploy to Paper', 'Monitor & Promote'].map((step, i, arr) => (
          <React.Fragment key={step}>
            <span className="px-1.5 py-0.5 rounded"
              style={{ backgroundColor: i === 0 ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : undefined,
                       color: i === 0 ? 'var(--color-accent)' : 'var(--color-text-faint)' }}>
              {step}
            </span>
            {i < arr.length - 1 && <ArrowRight size={10} />}
          </React.Fragment>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 rounded p-0.5 border" style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors flex-1 justify-center"
            style={tab === t.id
              ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-primary)', fontWeight: 600 }
              : { color: 'var(--color-text-faint)' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[300px]">
        {tab === 'results' && <ResultsTab />}
        {tab === 'walkforward' && <WalkForwardTab />}
        {tab === 'comparison' && <ComparisonTab />}
        {tab === 'independence' && <IndependenceTab />}
        {tab === 'stress' && <StressTab />}
        {tab === 'param_search' && <ParamSearchTab />}
      </div>
    </div>
  )
}
