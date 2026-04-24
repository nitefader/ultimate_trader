import React, { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { backtestsApi } from '../api/backtests'
import { ModeIndicator } from '../components/ModeIndicator'
import { usePollingGate } from '../hooks/usePollingGate'
import { TrendingUp, AlertCircle, ChevronUp, ChevronDown, Trash2, Search, GitCompareArrows, X } from 'lucide-react'
import { PageHelp } from '../components/PageHelp'
import { SelectMenu } from '../components/SelectMenu'
import { Tooltip } from '../components/Tooltip'
import clsx from 'clsx'

type SortKey = 'date' | 'return' | 'sharpe' | 'drawdown' | 'win_rate' | 'trades' | 'oos_return' | 'strategy'
type SortDir = 'asc' | 'desc'
type StatusFilter = 'all' | 'completed' | 'failed' | 'running' | 'pending'

function fmtDate(value?: string, withTime = false): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, withTime ? 16 : 10)
  return withTime
    ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function fmtRunName(symbols: string[] | undefined, timeframe: string, startDate?: string, endDate?: string): string {
  const symbolLabel = symbols && symbols.length > 0 ? symbols.join(', ') : 'Market'
  const periodLabel = `${fmtDate(startDate)} to ${fmtDate(endDate)}`
  return `${symbolLabel} ${timeframe} Backtest (${periodLabel})`
}

export function RunHistory() {
  const pausePolling = usePollingGate()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: runs = [], isLoading, isFetching } = useQuery({
    queryKey: ['backtests'],
    queryFn: () => backtestsApi.list(undefined, 100),
    refetchInterval: pausePolling ? false : 10_000,
  })

  // strategy_name is now returned directly by the runs API
  const strategyNameByVersionId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const run of runs) {
      const name = (run as any).strategy_name
      if (name && run.strategy_version_id) {
        map[run.strategy_version_id] = name
      }
    }
    return map
  }, [runs])

  const deleteRunMutation = useMutation({
    mutationFn: (runId: string) => backtestsApi.delete(runId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['backtests'] })
    },
  })

  const deleteSelectedMutation = useMutation({
    mutationFn: async (runIds: string[]) => {
      await Promise.all(runIds.map(id => backtestsApi.delete(id)))
    },
    onSuccess: async () => {
      setSelectedRunIds([])
      await queryClient.invalidateQueries({ queryKey: ['backtests'] })
    },
  })

  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [symbolSearch, setSymbolSearch] = useState('')
  const [strategySearch, setStrategySearch] = useState('')

  const toggleRunSelection = (runId: string) => {
    setSelectedRunIds((prev) =>
      prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId]
    )
  }

  const selectAll = () => {
    const allIds = filteredRuns.map(r => r.id)
    setSelectedRunIds(allIds)
  }

  const clearSelection = () => setSelectedRunIds([])

  const openCompare = () => {
    if (selectedRunIds.length !== 2) return
    const [left, right] = selectedRunIds
    navigate(`/runs/${left}?compare=${right}`)
  }

  const handleDeleteSelected = async () => {
    const deletable = selectedRunIds.filter(id => {
      const run = runs.find(r => r.id === id)
      return run && run.status !== 'running'
    })
    if (deletable.length === 0) return
    const ok = window.confirm(
      `Delete ${deletable.length} backtest run${deletable.length !== 1 ? 's' : ''}? This cannot be undone.`
    )
    if (!ok) return
    await deleteSelectedMutation.mutateAsync(deletable)
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortedRuns = useMemo(() => {
    const getValue = (run: typeof runs[0]): number | string => {
      const m = run.metrics
      const wf = m?.walk_forward
      switch (sortKey) {
        case 'date': return run.created_at ?? ''
        case 'return': return m?.total_return_pct ?? -Infinity
        case 'sharpe': return m?.sharpe_ratio ?? -Infinity
        case 'drawdown': return m?.max_drawdown_pct ?? Infinity
        case 'win_rate': return m?.win_rate_pct ?? -Infinity
        case 'trades': return m?.total_trades ?? -Infinity
        case 'oos_return': return wf?.aggregate_oos?.oos_total_return_pct ?? -Infinity
        case 'strategy': return strategyNameByVersionId[run.strategy_version_id ?? ''] ?? ''
        default: return ''
      }
    }
    return [...runs].sort((a, b) => {
      const av = getValue(a)
      const bv = getValue(b)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [runs, sortKey, sortDir])

  const filteredRuns = useMemo(() => {
    return sortedRuns.filter(run => {
      if (statusFilter !== 'all' && run.status !== statusFilter) return false
      if (symbolSearch.trim()) {
        const needle = symbolSearch.trim().toLowerCase()
        if (!run.symbols?.join(',').toLowerCase().includes(needle)) return false
      }
      if (strategySearch.trim()) {
        const needle = strategySearch.trim().toLowerCase()
        const stratName = strategyNameByVersionId[run.strategy_version_id ?? ''] ?? ''
        if (!stratName.toLowerCase().includes(needle)) return false
      }
      return true
    })
  }, [sortedRuns, statusFilter, symbolSearch, strategySearch, strategyNameByVersionId])

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col
      ? (sortDir === 'asc' ? <ChevronUp size={11} className="inline ml-0.5" /> : <ChevronDown size={11} className="inline ml-0.5" />)
      : <ChevronDown size={11} className="inline ml-0.5 opacity-30" />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center">Run History<PageHelp page="runhistory" /></h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {runs.length} backtest run{runs.length !== 1 ? 's' : ''}
            {!isLoading && isFetching && (
              <span className="ml-2 text-gray-600">Refreshing…</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/backtest" className="btn-primary text-sm">+ New Backtest</Link>
        </div>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="card text-center py-12">
          <TrendingUp size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm mb-4">No backtest runs yet.</p>
          <Link to="/backtest" className="btn-primary text-sm inline-block">Launch your first backtest</Link>
        </div>
      ) : (
        <>
          {/* Selection action bar — only visible when rows are selected */}
          {selectedRunIds.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-sky-800 bg-sky-950/40 px-4 py-2">
              <span className="text-sm font-medium text-sky-300">
                {selectedRunIds.length} run{selectedRunIds.length !== 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2 ml-auto">
                {selectedRunIds.length === 2 && (
                  <button
                    className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium bg-sky-700 hover:bg-sky-600 text-white transition-colors"
                    onClick={openCompare}
                  >
                    <GitCompareArrows size={13} />
                    Compare
                  </button>
                )}
                <button
                  className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium bg-red-900/60 hover:bg-red-800/70 text-red-200 transition-colors disabled:opacity-40"
                  disabled={deleteSelectedMutation.isPending}
                  onClick={handleDeleteSelected}
                >
                  <Trash2 size={13} />
                  Delete {selectedRunIds.length}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                  onClick={clearSelection}
                >
                  <X size={13} />
                  Clear
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <SelectMenu
              value={statusFilter}
              onChange={v => setStatusFilter(v as StatusFilter)}
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'completed', label: 'Completed' },
                { value: 'failed', label: 'Failed' },
                { value: 'running', label: 'Running' },
                { value: 'pending', label: 'Pending' },
              ]}
            />
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Search symbols…"
                value={symbolSearch}
                onChange={e => setSymbolSearch(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded pl-7 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-sky-600 w-44"
              />
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Search strategy…"
                value={strategySearch}
                onChange={e => setStrategySearch(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded pl-7 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-sky-600 w-40"
              />
            </div>
            {(statusFilter !== 'all' || symbolSearch.trim() || strategySearch.trim()) && (
              <span className="text-xs text-gray-500">{filteredRuns.length} shown</span>
            )}
            {filteredRuns.length > 0 && (
              <button
                className="ml-auto text-xs text-gray-500 hover:text-gray-300 transition-colors"
                onClick={selectedRunIds.length === filteredRuns.length ? clearSelection : selectAll}
              >
                {selectedRunIds.length === filteredRuns.length ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>

          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900/50">
                    <th
                      className="text-left px-3 py-2.5 text-xs text-gray-500 uppercase tracking-wide"
                    />
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-300" onClick={() => handleSort('strategy')}>Strategy <SortIcon col="strategy" /></th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide">Symbols</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide">Mode</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide">TF</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide">Period</th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide">Capital</th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-300" onClick={() => handleSort('oos_return')}>OOS Return <SortIcon col="oos_return" /></th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-300" onClick={() => handleSort('return')}>Return <SortIcon col="return" /></th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-300" onClick={() => handleSort('sharpe')}>Sharpe <SortIcon col="sharpe" /></th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-300" onClick={() => handleSort('drawdown')}>Max DD <SortIcon col="drawdown" /></th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-300" onClick={() => handleSort('win_rate')}>Win% <SortIcon col="win_rate" /></th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-300" onClick={() => handleSort('trades')}>Trades <SortIcon col="trades" /></th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide">Anti-Bias</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-300" onClick={() => handleSort('date')}>Date <SortIcon col="date" /></th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.map(run => {
                    const m = run.metrics
                    const wf = m?.walk_forward
                    const oosReturn = wf?.aggregate_oos?.oos_total_return_pct
                    const antiBiasPassed = Boolean(
                      wf?.anti_bias?.leakage_checks_passed &&
                      wf?.anti_bias?.parameter_locking_passed &&
                      wf?.anti_bias?.causal_indicator_checks_passed,
                    )
                    const isFailed = run.status === 'failed'
                    const isSelected = selectedRunIds.includes(run.id)
                    const sharpe = m?.sharpe_ratio
                    const sharpeClass =
                      sharpe == null ? 'text-gray-500' :
                      sharpe >= 1.0 ? 'text-emerald-400' :
                      sharpe >= 0   ? 'text-amber-400' :
                                      'text-red-400'
                    const handleRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
                      // Don't navigate if clicking on checkbox or buttons within the row
                      const target = e.target as HTMLElement
                      if (target.closest('input') || target.closest('button')) return
                      navigate(`/runs/${run.id}`)
                    }
                    return (
                      <tr
                        key={run.id}
                        onClick={handleRowClick}
                        className={clsx(
                          'border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer',
                          isFailed && 'bg-red-950/10',
                          isSelected && 'bg-sky-950/20 border-l-2 border-sky-700',
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRunSelection(run.id)}
                            className="accent-sky-500"
                          />
                        </td>
                        <td className="px-4 py-2.5 max-w-[140px]">
                          {run.strategy_version_id && strategyNameByVersionId[run.strategy_version_id] ? (
                            <span className="text-gray-300 text-xs truncate block" title={strategyNameByVersionId[run.strategy_version_id]}>
                              {strategyNameByVersionId[run.strategy_version_id]}
                            </span>
                          ) : (
                            <span className="text-gray-600 text-xs font-mono truncate block" title={run.strategy_version_id ?? ''}>
                              {run.strategy_version_id ? run.strategy_version_id.slice(0, 8) + '…' : '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <Link to={`/runs/${run.id}`} className="text-sky-400 hover:text-sky-300 font-mono text-sm font-medium">
                            {run.symbols?.join(', ') || '—'}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <ModeIndicator mode={run.mode} />
                        </td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs font-mono">{run.timeframe}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                          {fmtDate(run.start_date)} → {fmtDate(run.end_date)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-400 text-xs">
                          ${(run.initial_capital / 1000).toFixed(0)}k
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm">
                          {oosReturn != null ? (
                            <span className={oosReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                              {oosReturn >= 0 ? '+' : ''}{oosReturn.toFixed(1)}%
                            </span>
                          ) : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm">
                          {m?.total_return_pct != null ? (
                            <span className={m.total_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                              {m.total_return_pct >= 0 ? '+' : ''}{m.total_return_pct.toFixed(1)}%
                            </span>
                          ) : <span className="text-gray-600">—</span>}
                        </td>
                        <td className={clsx('px-4 py-2.5 text-right text-xs font-mono', sharpeClass)}>
                          {sharpe != null ? sharpe.toFixed(2) : '—'}
                        </td>
                        <td className={clsx('px-4 py-2.5 text-right text-xs font-mono', m?.max_drawdown_pct != null ? 'text-red-400' : 'text-gray-500')}>
                          {m?.max_drawdown_pct != null ? `-${m.max_drawdown_pct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-400 text-xs font-mono">
                          {m?.win_rate_pct != null ? `${m.win_rate_pct.toFixed(0)}%` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-400 text-xs">
                          {m?.total_trades ?? '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          {wf ? (
                            <span className={clsx('badge text-xs', antiBiasPassed ? 'badge-green' : 'bg-amber-900/60 text-amber-300')}>
                              {antiBiasPassed ? 'PASS' : 'WARN'}
                            </span>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <Tooltip content={isFailed && run.error_message ? run.error_message : undefined}>
                            <span
                              className={clsx('badge text-xs', {
                                'badge-green':  run.status === 'completed',
                                'badge-red':    run.status === 'failed',
                                'badge-gray':   run.status === 'pending',
                                'bg-sky-900/60 text-sky-300': run.status === 'running',
                              })}
                            >
                              {run.status === 'running' && (
                                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping inline-block mr-1" />
                              )}
                              {isFailed && <AlertCircle size={10} className="inline mr-1" />}
                              {fmtStatus(run.status)}
                            </span>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                          {fmtDate(run.created_at, true)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Tooltip content="Delete run">
                          <button
                            type="button"
                            className="inline-flex items-center justify-center p-1 rounded text-red-500 hover:text-red-300 hover:bg-red-950/40 disabled:text-gray-600 disabled:hover:bg-transparent transition-colors"
                            disabled={run.status === 'running' || deleteRunMutation.isPending}
                            onClick={async () => {
                              const ok = window.confirm('Delete this backtest run? This cannot be undone.')
                              if (!ok) return
                              await deleteRunMutation.mutateAsync(run.id)
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                          </Tooltip>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
