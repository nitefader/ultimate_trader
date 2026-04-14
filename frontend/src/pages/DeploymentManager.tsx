import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { deploymentsApi, accountsApi } from '../api/accounts'
import type { DeploymentTradeRow } from '../api/accounts'
import { mlApi } from '../api/ml'
import { strategiesApi } from '../api/strategies'
import { ModeIndicator } from '../components/ModeIndicator'
import { usePollingGate } from '../hooks/usePollingGate'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { SelectMenu } from '../components/SelectMenu'
import { Tooltip } from '../components/Tooltip'
import type { Deployment, Account, Strategy } from '../types'
import clsx from 'clsx'

function fmt2(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toFixed(2)
}

function fmtPnl(v: number | null | undefined): React.ReactNode {
  if (v == null) return <span className="text-gray-600">—</span>
  return <span className={v >= 0 ? 'text-emerald-400' : 'text-red-400'}>{v >= 0 ? '+' : ''}{v.toFixed(2)}</span>
}

const LIVE_SAFETY_CHECKS = [
  { key: 'paper_performance_reviewed', label: 'Paper performance reviewed (min 30 days)' },
  { key: 'risk_limits_confirmed', label: 'Risk limits confirmed and appropriate' },
  { key: 'live_account_verified', label: 'Live account verified and funded' },
  { key: 'broker_connection_tested', label: 'Broker connection tested successfully' },
  { key: 'compliance_acknowledged', label: 'I understand this will execute real orders' },
  { key: 'market_conditions_assessed', label: 'Market conditions assessed for current strategy' },
]

function DeploymentRow({ dep, onStart, onPause, onStop, onViewTrades, strategyName, accountName, isSelected }: {
  dep: Deployment
  onStart: (id: string) => void
  onPause: (id: string) => void
  onStop: (id: string) => void
  onViewTrades: (id: string) => void
  strategyName?: string
  accountName?: string
  isSelected?: boolean
}) {
  return (
    <tr className={clsx('border-b border-gray-800/50 hover:bg-gray-800/20', isSelected && 'bg-sky-950/20')}>
      <td className="px-4 py-2">
        <ModeIndicator mode={dep.mode} />
      </td>
      <td className="px-4 py-2">
        <div className="text-sm text-gray-200 font-medium">{strategyName ?? <span className="text-gray-600 font-mono text-xs">{dep.strategy_version_id.slice(0, 8)}…</span>}</div>
      </td>
      <td className="px-4 py-2">
        <div className="text-sm text-gray-300">{accountName ?? <span className="text-gray-600 font-mono text-xs">{dep.account_id.slice(0, 8)}…</span>}</div>
      </td>
      <td className="px-4 py-2">
        <span className={clsx('badge', {
          'badge-green': dep.status === 'running',
          'bg-amber-900 text-amber-300': dep.status === 'paused',
          'badge-red': dep.status === 'stopped' || dep.status === 'failed',
          'badge-gray': dep.status === 'pending',
        })}>
          {dep.status}
        </span>
      </td>
      <td className="px-4 py-2 text-xs text-gray-500">{dep.created_at?.slice(0, 10)}</td>
      <td className="px-4 py-2">
        <div className="flex gap-2">
          {dep.status === 'pending' && (
            <button className="btn-primary text-xs py-0.5 px-2" onClick={() => onStart(dep.id)}>
              Start
            </button>
          )}
          {dep.status === 'running' && (
            <button className="btn-warning text-xs py-0.5 px-2" onClick={() => onPause(dep.id)}>
              Pause
            </button>
          )}
          {dep.status === 'paused' && (
            <button className="btn-primary text-xs py-0.5 px-2" onClick={() => onStart(dep.id)}>
              Resume
            </button>
          )}
          {(dep.status === 'running' || dep.status === 'paused') && (
            <button className="btn-danger text-xs py-0.5 px-2" onClick={() => onStop(dep.id)}>
              Stop
            </button>
          )}
          <Tooltip content="View paper trades for this deployment">
          <button
            className={clsx('text-xs py-0.5 px-2 border rounded transition-colors', isSelected ? 'border-sky-600 text-sky-400 bg-sky-900/20' : 'border-gray-700 text-gray-400 hover:border-gray-500')}
            onClick={() => onViewTrades(dep.id)}
          >
            {isSelected ? <ChevronDown size={12} className="inline" /> : <ChevronRight size={12} className="inline" />} Trades
          </button>
          </Tooltip>
        </div>
      </td>
    </tr>
  )
}

export function DeploymentManager() {
  const pausePolling = usePollingGate()
  const qc = useQueryClient()
  const [showLivePromotion, setShowLivePromotion] = useState(false)
  const [selectedPaperDepId, setSelectedPaperDepId] = useState('')
  const [tradesDepId, setTradesDepId] = useState<string | null>(null)
  const [selectedLiveAccountId, setSelectedLiveAccountId] = useState('')
  const [safetyChecks, setSafetyChecks] = useState<Record<string, boolean>>({})
  const [promoteNotes, setPromoteNotes] = useState('')
  const [promoteResult, setPromoteResult] = useState<{ success: boolean; message: string } | null>(null)
  const [advice, setAdvice] = useState<any | null>(null)
  const [adviceLoading, setAdviceLoading] = useState(false)

  const { data: deployments = [] } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => deploymentsApi.list(),
    refetchInterval: pausePolling ? false : 15_000,
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  const { data: strategies = [] } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
  })

  const { data: selectedPaperDeployment } = useQuery({
    queryKey: ['deployment', selectedPaperDepId],
    queryFn: () => deploymentsApi.get(selectedPaperDepId),
    enabled: !!selectedPaperDepId,
  })

  const { data: tradesData } = useQuery({
    queryKey: ['deployment-trades', tradesDepId],
    queryFn: () => deploymentsApi.getTrades(tradesDepId!),
    enabled: !!tradesDepId,
    refetchInterval: pausePolling ? false : 60_000,
  })

  const pauseMutation = useMutation({
    mutationFn: deploymentsApi.pause,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments'] }),
  })

  const startMutation = useMutation({
    mutationFn: deploymentsApi.start,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments'] }),
  })

  const stopMutation = useMutation({
    mutationFn: (id: string) => deploymentsApi.stop(id, 'Manual stop from UI'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments'] }),
  })

  const liveAccounts = accounts.filter(a => a.mode === 'live')
  const paperDeployments = deployments.filter(d => d.mode === 'paper' && (d.status === 'pending' || d.status === 'running' || d.status === 'paused'))
  const allChecked = LIVE_SAFETY_CHECKS.every(c => safetyChecks[c.key])

  const handlePromoteToLive = async () => {
    if (!selectedPaperDepId || !selectedLiveAccountId || !allChecked) return
    if (!window.confirm('Promote this paper deployment to LIVE trading? This will enable real-money execution.')) return
    try {
      await deploymentsApi.promoteToLive({
        paper_deployment_id: selectedPaperDepId,
        live_account_id: selectedLiveAccountId,
        notes: promoteNotes,
        safety_checklist: safetyChecks,
      })
      setPromoteResult({ success: true, message: 'Successfully promoted to live trading!' })
      qc.invalidateQueries({ queryKey: ['deployments'] })
    } catch (e) {
      setPromoteResult({ success: false, message: (e as Error).message })
    }
  }

  const handleGetAdvice = async () => {
    if (!selectedPaperDepId) {
      setAdvice({ recommend: false, reasons: ['Select a paper deployment first'], checks: {} })
      return
    }
    setAdviceLoading(true)
    try {
      const res = await mlApi.promoteAdvice({ paper_deployment_id: selectedPaperDepId })
      setAdvice(res)
    } catch (e) {
      setAdvice({ recommend: false, reasons: [(e as Error).message], checks: {} })
    } finally {
      setAdviceLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Deployment Manager</h1>
        <button
          className="btn-danger text-sm flex items-center gap-1.5"
          onClick={() => setShowLivePromotion(s => !s)}
        >
          ⚡ Promote to Live
        </button>
      </div>

      {/* Deployments table */}
      <div className="card overflow-hidden p-0">
        <div className="px-4 py-2 border-b border-gray-800">
          <span className="text-sm font-semibold">Active Deployments</span>
        </div>
        {deployments.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No deployments yet. Promote a backtest result to paper trading first.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500">
                <th className="text-left px-4 py-2">Mode</th>
                <th className="text-left px-4 py-2">Strategy</th>
                <th className="text-left px-4 py-2">Account</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Created</th>
                <th className="text-left px-4 py-2">Controls</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map(dep => (
                <DeploymentRow
                  key={dep.id}
                  dep={dep}
                  onStart={startMutation.mutate}
                  onPause={pauseMutation.mutate}
                  onStop={stopMutation.mutate}
                  onViewTrades={(id) => setTradesDepId(prev => prev === id ? null : id)}
                  isSelected={tradesDepId === dep.id}
                  strategyName={strategies.find(s => s.id === dep.strategy_id)?.name}
                  accountName={accounts.find(a => a.id === dep.account_id)?.name}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Deployment trades panel */}
      {tradesDepId && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              Paper Trades — <span className="font-mono text-sky-400 text-xs">{tradesDepId.slice(0, 8)}…</span>
            </span>
            <button className="text-xs text-gray-500 hover:text-gray-300" onClick={() => setTradesDepId(null)}>✕ Close</button>
          </div>

          {tradesData?.summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              {[
                { label: 'Open', value: tradesData.summary.open_count },
                { label: 'Closed', value: tradesData.summary.closed_count },
                { label: 'Realized P&L', value: <span className={tradesData.summary.total_realized_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>${tradesData.summary.total_realized_pnl.toFixed(2)}</span> },
                { label: 'Unrealized', value: <span className={tradesData.summary.total_unrealized_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>${tradesData.summary.total_unrealized_pnl.toFixed(2)}</span> },
                { label: 'Win Rate', value: tradesData.summary.win_rate_pct != null ? `${tradesData.summary.win_rate_pct.toFixed(1)}%` : '—' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-900 rounded px-2 py-1.5">
                  <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-0.5">{label}</div>
                  <div className="font-medium">{value}</div>
                </div>
              ))}
            </div>
          )}

          {!tradesData || tradesData.trades.length === 0 ? (
            <div className="text-xs text-gray-500 py-4 text-center">
              No trades yet. The paper broker evaluates conditions once per minute against the latest cached bar.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-2 py-1.5">Symbol</th>
                    <th className="text-left px-2 py-1.5">Dir</th>
                    <th className="text-left px-2 py-1.5">Entry</th>
                    <th className="text-right px-2 py-1.5">Entry $</th>
                    <th className="text-right px-2 py-1.5">Qty</th>
                    <th className="text-right px-2 py-1.5">Stop</th>
                    <th className="text-right px-2 py-1.5">Current $</th>
                    <th className="text-right px-2 py-1.5">Unr. P&L</th>
                    <th className="text-right px-2 py-1.5">Net P&L</th>
                    <th className="text-right px-2 py-1.5">R</th>
                    <th className="text-left px-2 py-1.5">Exit Reason</th>
                    <th className="text-left px-2 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tradesData.trades.map((t: DeploymentTradeRow) => (
                    <tr key={t.id} className={clsx('border-b border-gray-800/40', t.is_open ? 'bg-sky-950/10' : '')}>
                      <td className="px-2 py-1.5 font-mono font-bold text-gray-200">{t.symbol}</td>
                      <td className="px-2 py-1.5">
                        <span className={t.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}>{t.direction}</span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-400">{t.entry_time?.slice(0, 10) ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{t.entry_price.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{t.quantity.toFixed(1)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-amber-400">{t.current_stop != null ? t.current_stop.toFixed(2) : '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{t.current_price != null ? t.current_price.toFixed(2) : '—'}</td>
                      <td className="px-2 py-1.5 text-right">{fmtPnl(t.unrealized_pnl)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtPnl(t.net_pnl)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-400">{t.r_multiple != null ? t.r_multiple.toFixed(2) + 'R' : '—'}</td>
                      <td className="px-2 py-1.5 text-gray-400">{t.exit_reason ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        <span className={clsx('badge text-[10px]', t.is_open ? 'badge-green' : 'badge-gray')}>
                          {t.is_open ? 'open' : 'closed'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Live promotion panel */}
      {showLivePromotion && (
        <div className="card border-red-800 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-red-400 font-bold">⚡ LIVE TRADING PROMOTION</span>
          </div>
          <div className="bg-red-900/30 border border-red-700 rounded p-3 text-xs text-red-300">
            WARNING: Promoting to live trading will cause real orders to be submitted to your broker.
            Ensure all safety checks are completed before proceeding.
          </div>

          {promoteResult && (
            <div className={clsx('rounded p-3 text-sm border', promoteResult.success
              ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300'
              : 'bg-red-900/50 border-red-700 text-red-300'
            )}>
              {promoteResult.message}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Paper Deployment Source</label>
              <SelectMenu
                value={selectedPaperDepId}
                onChange={setSelectedPaperDepId}
                placeholder="— Select paper deployment —"
                options={[
                  { value: '', label: '— Select paper deployment —' },
                  ...paperDeployments.map(d => ({
                    value: d.id,
                    label: `${d.id.slice(0, 8)} (status: ${d.status})`,
                  })),
                ]}
              />
            </div>
            <div>
              <label className="label">Live Account</label>
              <SelectMenu
                value={selectedLiveAccountId}
                onChange={setSelectedLiveAccountId}
                placeholder="— Select live account —"
                options={[
                  { value: '', label: '— Select live account —' },
                  ...liveAccounts.map(a => ({ value: a.id, label: a.name })),
                ]}
              />
              {liveAccounts.length === 0 && (
                <div className="text-xs text-gray-500 mt-1">No live accounts configured</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn-secondary text-sm"
              onClick={handleGetAdvice}
              disabled={!selectedPaperDepId || adviceLoading}
            >
              {adviceLoading ? 'Checking...' : 'Get Promotion Advice'}
            </button>
            {advice && (
              <div className={`text-sm ml-3 ${advice.recommend ? 'text-emerald-300' : 'text-amber-300'}`}>
                {advice.recommend ? 'Recommend: YES' : 'Recommend: NO'} — {advice.reasons?.[0]}
              </div>
            )}
          </div>

          {(advice || selectedPaperDeployment) && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded border border-gray-800 bg-gray-950/70 p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Promotion Readiness</div>
                {advice ? (
                  <>
                    <div className={clsx('text-sm font-semibold', advice.recommend ? 'text-emerald-300' : 'text-amber-300')}>
                      {advice.recommend ? 'Ready for live review' : 'More evidence needed before live promotion'}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded border border-gray-800 p-2">
                        <div className="text-gray-500">Status</div>
                        <div className="text-gray-200">{advice.checks?.deployment_status ?? '—'}</div>
                      </div>
                      <div className="rounded border border-gray-800 p-2">
                        <div className="text-gray-500">Days Running</div>
                        <div className="text-gray-200">{advice.checks?.days_running ?? '—'}</div>
                      </div>
                      <div className="rounded border border-gray-800 p-2">
                        <div className="text-gray-500">Checklist</div>
                        <div className="text-gray-200">{advice.checks?.live_checklist_completed ?? 0}/{advice.checks?.live_checklist_total ?? LIVE_SAFETY_CHECKS.length}</div>
                      </div>
                      <div className="rounded border border-gray-800 p-2">
                        <div className="text-gray-500">Approvals</div>
                        <div className="text-gray-200">{advice.checks?.approval_count ?? 0}</div>
                      </div>
                    </div>
                    <div className="space-y-1 text-xs text-gray-400">
                      {(advice.reasons ?? []).map((reason: string) => (
                        <div key={reason}>- {reason}</div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-gray-500">Select a paper deployment and fetch promotion advice.</div>
                )}
              </div>

              <div className="rounded border border-gray-800 bg-gray-950/70 p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Approval Trail</div>
                {selectedPaperDeployment?.approvals?.length ? (
                  <div className="space-y-2">
                    {selectedPaperDeployment.approvals.map(approval => (
                      <div key={approval.id} className="rounded border border-gray-800 p-3 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-gray-200">{approval.from_mode} → {approval.to_mode}</div>
                          <div className="text-gray-500">{approval.approved_at?.slice(0, 10)}</div>
                        </div>
                        <div className="mt-1 text-gray-500">Approved by {approval.approved_by}</div>
                        {approval.notes && <div className="mt-2 text-gray-400">{approval.notes}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">No approval records found yet for this deployment.</div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="label">Safety Checklist (all required)</label>
            <div className="space-y-2">
              {LIVE_SAFETY_CHECKS.map(check => (
                <label key={check.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-red-500"
                    checked={safetyChecks[check.key] ?? false}
                    onChange={e => setSafetyChecks(s => ({ ...s, [check.key]: e.target.checked }))}
                  />
                  <span className="text-sm text-gray-300">{check.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full resize-none" rows={2} value={promoteNotes} onChange={e => setPromoteNotes(e.target.value)} />
          </div>

          <button
            className="btn-danger w-full py-3 font-bold"
            onClick={handlePromoteToLive}
            disabled={!selectedPaperDepId || !selectedLiveAccountId || !allChecked}
          >
            ⚡ PROMOTE TO LIVE TRADING
          </button>
        </div>
      )}
    </div>
  )
}
