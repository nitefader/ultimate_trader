import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { deploymentsApi, accountsApi, controlApi } from '../api/accounts'
import type { DeploymentTradeRow, DeploymentPauseResponse, SweepResult } from '../api/accounts'
import { governorApi } from '../api/governor'
import { mlApi } from '../api/ml'
import { strategiesApi } from '../api/strategies'
import { programsApi } from '../api/programs'
import { ModeIndicator } from '../components/ModeIndicator'
import { usePollingGate } from '../hooks/usePollingGate'
import { ChevronDown, ChevronRight, ShieldCheck, ShieldAlert, ShieldOff, Shield, ChevronUp, Plus, PieChart, AlertTriangle, XOctagon, CheckCircle2, Eye } from 'lucide-react'
import { SelectMenu } from '../components/SelectMenu'
import { Tooltip } from '../components/Tooltip'
import type { Deployment, Account, Strategy, PortfolioGovernor, GovernorEvent } from '../types'
import type { TradingProgram } from '../api/programs'
import clsx from 'clsx'
import { PageHelp } from '../components/PageHelp'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt2(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toFixed(2)
}

function fmtPnl(v: number | null | undefined): React.ReactNode {
  if (v == null) return <span className="text-gray-600">—</span>
  return <span className={v >= 0 ? 'text-emerald-400' : 'text-red-400'}>{v >= 0 ? '+' : ''}{v.toFixed(2)}</span>
}

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString()
}

function isDeployableProgram(program: TradingProgram): boolean {
  return program.status !== 'deprecated'
    && !!program.strategy_version_id
    && !!program.strategy_governor_id
    && !!program.risk_profile_id
    && !!program.execution_style_id
    && Array.isArray(program.watchlist_subscriptions)
    && program.watchlist_subscriptions.length > 0
}

// ─── Governor Status Badge ────────────────────────────────────────────────────

const GOV_STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-900/60 text-emerald-300 ring-1 ring-emerald-700',
  halted: 'bg-red-900/60 text-red-300 ring-1 ring-red-700',
  paused: 'bg-amber-900/60 text-amber-300 ring-1 ring-amber-700',
  initializing: 'bg-gray-800 text-gray-400 ring-1 ring-gray-700',
}

const GOV_STATUS_ICONS: Record<string, React.ReactNode> = {
  active: <ShieldCheck size={13} />,
  halted: <ShieldAlert size={13} />,
  paused: <ShieldOff size={13} />,
  initializing: <Shield size={13} />,
}

function GovernorStatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('flex items-center gap-1.5 text-xs px-2 py-0.5 rounded font-medium', GOV_STATUS_STYLES[status] ?? GOV_STATUS_STYLES.initializing)}>
      {GOV_STATUS_ICONS[status] ?? <Shield size={13} />}
      {status}
    </span>
  )
}

// ─── Governor Event Colors ────────────────────────────────────────────────────

const EVENT_TYPE_STYLES: Record<string, string> = {
  collision_suppressed: 'text-amber-400',
  correlation_blocked: 'text-orange-400',
  risk_blocked: 'text-red-400',
  universe_updated: 'text-sky-400',
  halt_triggered: 'text-red-400',
  daily_loss_lockout: 'text-red-400',
  drawdown_lockout: 'text-red-400',
  resume: 'text-emerald-400',
  position_allowed: 'text-emerald-400',
}

function eventStyle(type: string): string {
  return EVENT_TYPE_STYLES[type] ?? 'text-gray-400'
}

// ─── Sweep Result Panel ───────────────────────────────────────────────────────

function SweepResultPanel({ result, onClose }: { result: DeploymentPauseResponse | SweepResult; onClose: () => void }) {
  const canceled = 'orders_canceled' in result ? result.orders_canceled : []
  const protective = 'orders_skipped_protective' in result ? result.orders_skipped_protective : []
  const unknown = 'orders_skipped_unknown' in result ? result.orders_skipped_unknown : []
  const errors = 'errors' in result ? result.errors : []
  const failed = 'kill_state_fetch_failed' in result && result.kill_state_fetch_failed

  return (
    <div className="rounded border border-gray-700 bg-gray-950/80 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-300">Order Sweep Result</span>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-400">✕</button>
      </div>

      {failed && (
        <div className="rounded border border-red-700 bg-red-950/40 px-2 py-1.5 text-red-300 flex items-center gap-1.5">
          <AlertTriangle size={11} /> Kill state fetch failed — broker config unavailable
        </div>
      )}

      {canceled.length > 0 && (
        <div>
          <div className="text-amber-400 font-medium mb-1 flex items-center gap-1">
            <XOctagon size={11} /> {canceled.length} order{canceled.length !== 1 ? 's' : ''} canceled
          </div>
          {canceled.map(o => (
            <div key={o.order_id} className="text-gray-400 flex gap-2 pl-3">
              <span className="font-mono text-gray-300">{o.symbol}</span>
              <span className="text-gray-600">{o.side} {o.qty} — {o.reason}</span>
            </div>
          ))}
        </div>
      )}

      {protective.length > 0 && (
        <div>
          <div className="text-emerald-400 font-medium mb-1 flex items-center gap-1">
            <CheckCircle2 size={11} /> {protective.length} protective order{protective.length !== 1 ? 's' : ''} kept
          </div>
          {protective.map(o => (
            <div key={o.order_id} className="text-gray-500 flex gap-2 pl-3">
              <span className="font-mono">{o.symbol}</span>
              <span className="text-gray-600">intent={o.intent}</span>
            </div>
          ))}
        </div>
      )}

      {unknown.length > 0 && (
        <div>
          <div className="text-gray-400 font-medium mb-1 flex items-center gap-1">
            <Eye size={11} /> {unknown.length} unattributed order{unknown.length !== 1 ? 's' : ''} — review needed
          </div>
          {unknown.map(o => (
            <div key={o.order_id} className="text-gray-600 pl-3 font-mono">{o.symbol} coid={o.client_order_id ?? 'null'}</div>
          ))}
        </div>
      )}

      {canceled.length === 0 && protective.length === 0 && unknown.length === 0 && !failed && (
        <div className="text-gray-600">No resting open-intent orders found — nothing to cancel.</div>
      )}

      {errors.length > 0 && (
        <div className="space-y-0.5">
          {errors.map((e, i) => (
            <div key={i} className="text-red-400">{e}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Global Kill Strip ────────────────────────────────────────────────────────

function GlobalKillStrip() {
  const qc = useQueryClient()
  const [killReason, setKillReason] = useState('')
  const [showKillInput, setShowKillInput] = useState(false)
  const [sweepResult, setSweepResult] = useState<any | null>(null)

  const { data: status } = useQuery({
    queryKey: ['control-status'],
    queryFn: () => controlApi.status(),
    refetchInterval: 10_000,
  })

  const isKilled = status?.kill_switch?.global_killed ?? false

  const killMutation = useMutation({
    mutationFn: () => controlApi.killAll(killReason || 'manual_kill'),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['control-status'] })
      qc.invalidateQueries({ queryKey: ['deployments'] })
      setShowKillInput(false)
      setKillReason('')
      setSweepResult(data)
    },
  })

  const resumeMutation = useMutation({
    mutationFn: () => controlApi.resumeAll(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['control-status'] })
      setSweepResult(null)
    },
  })

  return (
    <div className={clsx(
      'rounded border px-4 py-3 space-y-2',
      isKilled
        ? 'border-red-700 bg-red-950/30'
        : 'border-gray-800 bg-gray-900/40',
    )}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {isKilled
            ? <ShieldAlert size={14} className="text-red-400" />
            : <ShieldCheck size={14} className="text-emerald-400" />}
          <span className={clsx('text-xs font-semibold', isKilled ? 'text-red-300' : 'text-emerald-400')}>
            {isKilled ? `GLOBAL KILL ACTIVE — ${status?.kill_switch?.global_kill_reason ?? ''}` : 'All trading active'}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isKilled ? (
            <button
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
              className="btn-primary text-xs py-1 px-3"
            >
              {resumeMutation.isPending ? 'Resuming…' : 'Resume All Trading'}
            </button>
          ) : (
            !showKillInput && (
              <button
                onClick={() => setShowKillInput(true)}
                className="btn-danger text-xs py-1 px-3"
              >
                Stop New Opens (Global)
              </button>
            )
          )}
        </div>
      </div>

      {showKillInput && !isKilled && (
        <div className="flex items-center gap-2">
          <input
            className="input flex-1 text-xs"
            placeholder="Reason (optional)"
            value={killReason}
            onChange={e => setKillReason(e.target.value)}
            autoFocus
          />
          <button
            onClick={() => killMutation.mutate()}
            disabled={killMutation.isPending}
            className="btn-danger text-xs py-1 px-3 whitespace-nowrap"
          >
            {killMutation.isPending ? 'Stopping…' : 'Confirm Stop All'}
          </button>
          <button onClick={() => setShowKillInput(false)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
        </div>
      )}

      {sweepResult && sweepResult.sweep?.length > 0 && (
        <div className="space-y-1">
          {sweepResult.sweep.map((s: any, i: number) => (
            <SweepResultPanel key={i} result={s} onClose={() => setSweepResult(null)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Add Program Modal ────────────────────────────────────────────────────────

function AddProgramModal({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [programId, setProgramId] = useState('')
  const [capitalUsd, setCapitalUsd] = useState('')
  const [brokerMode, setBrokerMode] = useState<'paper' | 'live'>('paper')
  const [error, setError] = useState('')

  const { data: programs = [] } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  })

  const deployablePrograms = programs.filter((p: TradingProgram) => isDeployableProgram(p))

  const allocateMutation = useMutation({
    mutationFn: () => governorApi.allocate(accountId, {
      program_id: programId,
      allocated_capital_usd: parseFloat(capitalUsd) || 0,
      broker_mode: brokerMode,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['governor', accountId] })
      qc.invalidateQueries({ queryKey: ['governor-events', accountId] })
      onClose()
    },
    onError: (e: any) => {
      setError(e?.response?.data?.detail ?? e.message ?? 'Failed to allocate')
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 w-full max-w-md space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Add Program to Governor</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
        </div>

        {deployablePrograms.length === 0 ? (
          <div className="text-xs text-gray-500 py-4 text-center">
            No deployable programs available. Save and complete a program in the Programs page first.
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Program</label>
                <SelectMenu
                  value={programId}
                  onChange={setProgramId}
                  options={[
                    { value: '', label: 'Select a deployable program…' },
                    ...deployablePrograms.map((p: TradingProgram) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Allocated Capital (USD)</label>
                <input
                  type="number"
                  className="input w-full text-sm"
                  placeholder="e.g. 10000"
                  value={capitalUsd}
                  onChange={e => setCapitalUsd(e.target.value)}
                  min={0}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Broker Mode</label>
                <div className="flex gap-1 rounded border border-gray-700 bg-gray-900/60 p-0.5 w-fit">
                  {(['paper', 'live'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setBrokerMode(mode)}
                      className={clsx('px-3 py-1 rounded text-xs font-medium transition-colors',
                        brokerMode === mode ? 'bg-sky-700 text-white' : 'text-gray-400 hover:text-gray-200'
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                {brokerMode === 'live' && (
                  <p className="text-[11px] text-amber-400 mt-1">Live mode will execute real orders.</p>
                )}
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={onClose} className="btn-ghost text-xs">Cancel</button>
              <button
                onClick={() => allocateMutation.mutate()}
                disabled={!programId || allocateMutation.isPending}
                className="btn-primary text-xs"
              >
                {allocateMutation.isPending ? 'Adding…' : 'Add Program'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Governor Panel ───────────────────────────────────────────────────────────

function GovernorPanel({
  accountId,
  accountName,
}: {
  accountId: string
  accountName?: string
}) {
  const pausePolling = usePollingGate()
  const qc = useQueryClient()
  const [showEvents, setShowEvents] = useState(false)
  const [haltReason, setHaltReason] = useState('')
  const [showHaltInput, setShowHaltInput] = useState(false)

  const { data: governor, isLoading } = useQuery({
    queryKey: ['governor', accountId],
    queryFn: () => governorApi.get(accountId),
    refetchInterval: pausePolling ? false : 15_000,
  })

  const { data: events = [] } = useQuery({
    queryKey: ['governor-events', accountId],
    queryFn: () => governorApi.getEvents(accountId, { limit: 20 }),
    refetchInterval: pausePolling ? false : 15_000,
    enabled: showEvents,
  })

  const haltMutation = useMutation({
    mutationFn: () => governorApi.halt(accountId, haltReason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['governor', accountId] })
      qc.invalidateQueries({ queryKey: ['governor-events', accountId] })
      setShowHaltInput(false)
      setHaltReason('')
    },
  })

  const resumeMutation = useMutation({
    mutationFn: () => governorApi.resume(accountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['governor', accountId] })
      qc.invalidateQueries({ queryKey: ['governor-events', accountId] })
    },
  })

  const bootstrapMutation = useMutation({
    mutationFn: () => governorApi.bootstrap(accountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['governor', accountId] })
      qc.invalidateQueries({ queryKey: ['governors'] })
      qc.invalidateQueries({ queryKey: ['governor-events', accountId] })
    },
  })

  if (isLoading) {
    return (
      <div className="card py-4 text-center text-xs text-gray-500">
        Loading governor for {accountName ?? accountId.slice(0, 8)}…
      </div>
    )
  }

  if (!governor) {
    return (
      <div className="card py-4 text-center text-xs text-gray-600 space-y-3">
        <div>No governor found for {accountName ?? accountId.slice(0, 8)}</div>
        <button
          onClick={() => bootstrapMutation.mutate()}
          disabled={bootstrapMutation.isPending}
          className="btn-primary text-xs py-1 px-3"
        >
          {bootstrapMutation.isPending ? 'Initializing…' : 'Initialize Governor'}
        </button>
      </div>
    )
  }

  const g = governor

  return (
    <div className="card space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <GovernorStatusBadge status={g.governor_status} />
        {g.governor_label && (
          <span className="text-xs text-gray-400 font-medium">{g.governor_label}</span>
        )}
        <span className="text-xs text-gray-600">{accountName ?? accountId.slice(0, 8)}</span>
        <div className="ml-auto flex items-center gap-2">
          {(g.governor_status === 'active' || g.governor_status === 'paused') && !showHaltInput && (
            <button
              onClick={() => setShowHaltInput(true)}
              className="btn-danger text-xs py-0.5 px-2"
            >
              Halt All
            </button>
          )}
          {g.governor_status === 'halted' && (
            <button
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
              className="btn-primary text-xs py-0.5 px-2"
            >
              {resumeMutation.isPending ? 'Resuming...' : 'Resume'}
            </button>
          )}
        </div>
      </div>

      {/* Halt input */}
      {showHaltInput && (
        <div className="flex items-center gap-2">
          <input
            className="input flex-1 text-xs"
            placeholder="Halt reason (optional)"
            value={haltReason}
            onChange={e => setHaltReason(e.target.value)}
          />
          <button
            onClick={() => haltMutation.mutate()}
            disabled={haltMutation.isPending}
            className="btn-danger text-xs py-0.5 px-3"
          >
            {haltMutation.isPending ? 'Halting...' : 'Confirm Halt All'}
          </button>
          <button onClick={() => setShowHaltInput(false)} className="text-xs text-gray-500 hover:text-gray-300">
            Cancel
          </button>
        </div>
      )}

      {/* Metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="rounded border border-gray-800 bg-gray-900/60 px-2 py-1.5">
          <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-0.5">Risk Profile</div>
          <div className="font-medium text-gray-200 truncate">
            {g.risk_profile_id ? (
              <span className="text-sky-400 font-mono text-[11px]">{g.risk_profile_id.slice(0, 8)}…</span>
            ) : (
              <span className="text-gray-600 italic">No profile — using account limits</span>
            )}
          </div>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900/60 px-2 py-1.5">
          <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-0.5">Session P&amp;L</div>
          <div className="font-medium">{fmtPnl(g.session_realized_pnl)}</div>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900/60 px-2 py-1.5">
          <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-0.5">Daily Lockout</div>
          <div className={clsx('font-medium', g.daily_loss_lockout_triggered ? 'text-red-400' : 'text-emerald-400')}>
            {g.daily_loss_lockout_triggered ? 'TRIGGERED' : 'Clear'}
          </div>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900/60 px-2 py-1.5">
          <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-0.5">Last Tick</div>
          <div className="font-medium text-gray-300">{fmtTs(g.last_governor_tick_at)}</div>
        </div>
      </div>

      {/* Halt info */}
      {g.governor_status === 'halted' && g.halt_trigger && (
        <div className="rounded border border-red-800 bg-red-950/20 px-3 py-2 text-xs text-red-300">
          Halt trigger: <span className="font-medium">{g.halt_trigger}</span>
          {g.halt_at && <span className="ml-2 text-red-400/60">at {new Date(g.halt_at).toLocaleString()}</span>}
        </div>
      )}

      {/* Governor Events collapsible */}
      <div className="border-t border-gray-800/60 pt-2">
        <button
          onClick={() => setShowEvents(v => !v)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300"
        >
          {showEvents ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Governor Events
          {events.length > 0 && <span className="ml-1 text-gray-600">({events.length})</span>}
        </button>

        {showEvents && (
          <div className="mt-2 space-y-1">
            {events.length === 0 ? (
              <div className="text-xs text-gray-600 py-2 text-center">No events recorded yet.</div>
            ) : (
              <div className="rounded border border-gray-800 divide-y divide-gray-800/60">
                {events.map(ev => (
                  <GovernorEventRow key={ev.id} event={ev} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function GovernorEventRow({ event }: { event: GovernorEvent }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = Object.keys(event.detail ?? {}).length > 0

  return (
    <div className="px-3 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className={clsx('font-medium', eventStyle(event.event_type))}>
          {event.event_type.replace(/_/g, ' ')}
        </span>
        {event.symbol && (
          <span className="font-mono text-gray-300">{event.symbol}</span>
        )}
        <span className="text-gray-600 ml-auto">{new Date(event.emitted_at).toLocaleTimeString()}</span>
        {hasDetail && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-gray-600 hover:text-gray-400"
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>
      {expanded && hasDetail && (
        <pre className="mt-1 text-[10px] text-gray-500 font-mono bg-gray-950/60 rounded p-1.5 overflow-x-auto">
          {JSON.stringify(event.detail, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ─── Deployment Row ───────────────────────────────────────────────────────────

const LIVE_SAFETY_CHECKS = [
  { key: 'backtest_reviewed', label: 'Backtest results reviewed and performance is acceptable' },
  { key: 'risk_limits_confirmed', label: 'Risk limits confirmed and appropriate' },
  { key: 'live_account_verified', label: 'Live account verified and funded' },
  { key: 'broker_connection_tested', label: 'Broker connection tested successfully' },
  { key: 'compliance_acknowledged', label: 'I understand this will execute real orders' },
  { key: 'market_conditions_assessed', label: 'Market conditions assessed for current strategy' },
]

function DeploymentRow({ dep, onStart, onPause, onResume, onStop, onViewTrades, strategyName, accountName, isSelected }: {
  dep: Deployment
  onStart: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onStop: (id: string) => void
  onViewTrades: (id: string) => void
  strategyName?: string
  accountName?: string
  isSelected?: boolean
}) {
  const [sweepResult, setSweepResult] = useState<DeploymentPauseResponse | null>(null)

  const pauseMutation = useMutation({
    mutationFn: () => controlApi.pauseDeployment(dep.id),
    onSuccess: (data) => {
      onPause(dep.id)
      setSweepResult(data)
    },
  })

  const resumeMutation = useMutation({
    mutationFn: () => controlApi.resumeDeployment(dep.id),
    onSuccess: () => {
      onResume(dep.id)
      setSweepResult(null)
    },
  })

  return (
    <>
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
              <button
                className="btn-warning text-xs py-0.5 px-2"
                disabled={pauseMutation.isPending}
                onClick={() => pauseMutation.mutate()}
              >
                {pauseMutation.isPending ? 'Pausing…' : 'Pause Program'}
              </button>
            )}
            {dep.status === 'paused' && (
              <button
                className="btn-primary text-xs py-0.5 px-2"
                disabled={resumeMutation.isPending}
                onClick={() => resumeMutation.mutate()}
              >
                {resumeMutation.isPending ? 'Resuming…' : 'Resume'}
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
      {sweepResult && (
        <tr>
          <td colSpan={6} className="px-4 py-2">
            <SweepResultPanel result={sweepResult} onClose={() => setSweepResult(null)} />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Portfolio Snapshot Panel ─────────────────────────────────────────────────

function PortfolioSnapshotPanel({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false)
  const pausePolling = usePollingGate()

  const { data, isLoading } = useQuery({
    queryKey: ['portfolio-snapshot', accountId],
    queryFn: () => governorApi.portfolioSnapshot(accountId),
    enabled: open,
    refetchInterval: pausePolling ? false : 30_000,
  })

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-200 hover:text-sky-300 transition-colors"
      >
        <span className="flex items-center gap-2">
          <PieChart size={13} />
          Portfolio Snapshot
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {isLoading && <div className="text-xs text-gray-500 animate-pulse">Loading snapshot…</div>}

          {data && (
            <>
              {/* Summary row */}
              <div className="flex flex-wrap gap-3">
                <div className="rounded border border-gray-800 bg-gray-900/60 px-3 py-2 min-w-[130px]">
                  <div className="text-xs text-gray-500 mb-0.5">Total Allocated</div>
                  <div className="text-sm font-mono font-bold text-gray-100">
                    ${data.total_allocated_capital_usd.toLocaleString()}
                  </div>
                </div>
                <div className="rounded border border-gray-800 bg-gray-900/60 px-3 py-2 min-w-[130px]">
                  <div className="text-xs text-gray-500 mb-0.5">Active Programs</div>
                  <div className="text-sm font-mono font-bold text-gray-100">{data.program_count}</div>
                </div>
                {data.collision_risk_symbols.length > 0 && (
                  <div className="rounded border border-amber-800/60 bg-amber-950/20 px-3 py-2 flex items-center gap-1.5 text-xs text-amber-300">
                    <AlertTriangle size={12} />
                    {data.collision_risk_symbols.length} symbol collision{data.collision_risk_symbols.length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              {/* Programs table */}
              {data.programs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-500 text-left">
                        <th className="pb-1.5 pr-3">Program</th>
                        <th className="pb-1.5 pr-3 text-right">Capital</th>
                        <th className="pb-1.5 pr-3 text-right">%</th>
                        <th className="pb-1.5 pr-3">Mode</th>
                        <th className="pb-1.5">Symbols</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {data.programs.map(p => (
                        <tr key={p.allocation_id}>
                          <td className="py-1.5 pr-3 text-gray-200 font-medium truncate max-w-[180px]">{p.program_name}</td>
                          <td className="py-1.5 pr-3 text-right font-mono text-gray-300">${p.allocated_capital_usd.toLocaleString()}</td>
                          <td className="py-1.5 pr-3 text-right font-mono text-sky-400">{p.capital_pct}%</td>
                          <td className="py-1.5 pr-3">
                            <span className={clsx(
                              'text-[10px] px-1.5 py-0.5 rounded',
                              p.broker_mode === 'live' ? 'bg-orange-900/50 text-orange-300' : 'bg-blue-900/50 text-blue-300',
                            )}>
                              {p.broker_mode}
                            </span>
                          </td>
                          <td className="py-1.5 text-gray-500 text-[10px] font-mono">
                            {p.symbols.slice(0, 6).join(', ')}{p.symbol_count > 6 ? ` +${p.symbol_count - 6}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Overlap warnings */}
              {data.collision_risk_symbols.length > 0 && (
                <div className="rounded border border-amber-800/50 bg-amber-950/20 p-3 space-y-1">
                  <div className="text-xs font-semibold text-amber-300 mb-1">Symbol Collisions — Multiple programs trading the same symbol</div>
                  {data.collision_risk_symbols.map(c => (
                    <div key={c.symbol} className="text-xs flex items-center gap-2">
                      <code className="text-amber-200 font-mono">{c.symbol}</code>
                      <span className="text-gray-500">→</span>
                      <span className="text-gray-400">{c.programs.join(', ')}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Overlap matrix */}
              {data.symbol_overlap.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 font-semibold">Program Overlap</div>
                  {data.symbol_overlap.map((o, i) => (
                    <div key={i} className="text-xs text-gray-400 flex items-center gap-2">
                      <span className="text-gray-300">{o.program_a}</span>
                      <span className="text-gray-600">↔</span>
                      <span className="text-gray-300">{o.program_b}</span>
                      <span className="text-gray-600">— {o.overlap_count} shared: {o.shared_symbols.slice(0, 5).join(', ')}</span>
                    </div>
                  ))}
                </div>
              )}

              {data.programs.length === 0 && (
                <div className="text-xs text-gray-600">No active programs with capital allocation.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AccountGovernor() {
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
  const [selectedGovernorAccountId, setSelectedGovernorAccountId] = useState<string>('')
  const [showAddProgram, setShowAddProgram] = useState(false)

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

  const { data: governors = [] } = useQuery({
    queryKey: ['governors'],
    queryFn: () => governorApi.list(),
    refetchInterval: pausePolling ? false : 15_000,
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

  const startMutation = useMutation({
    mutationFn: deploymentsApi.start,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments'] }),
  })

  const stopMutation = useMutation({
    mutationFn: (id: string) => deploymentsApi.stop(id, 'Manual stop from UI'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments'] }),
  })

  const liveAccounts = accounts.filter(a => a.mode === 'live')
  const paperDeployments = deployments.filter(d => d.mode === 'paper')
  const allChecked = LIVE_SAFETY_CHECKS.every(c => safetyChecks[c.key])

  // Determine which account to show governor for — prefer one with an active governor,
  // but fall back to any available account so the user can bootstrap a governor.
  const activeGovernorAccountId = selectedGovernorAccountId
    || governors.find(g => g.governor_status === 'active')?.account_id
    || governors[0]?.account_id
    || accounts[0]?.id
    || ''

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
        <h1 className="text-xl font-bold flex items-center">Portfolio Governor<PageHelp page="deploy" /></h1>
        <button
          className="btn-danger text-sm flex items-center gap-1.5"
          onClick={() => setShowLivePromotion(s => !s)}
        >
          ⚡ Promote to Live
        </button>
      </div>

      {/* Global kill strip — always visible */}
      <GlobalKillStrip />

      {/* Governor section */}
      {accounts.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Portfolio Governor</span>
            <SelectMenu
              value={activeGovernorAccountId}
              onChange={setSelectedGovernorAccountId}
              options={accounts.map(a => ({
                value: a.id,
                label: `${a.name} (${a.mode})`,
              }))}
            />
            <button
              onClick={() => setShowAddProgram(true)}
              className="btn-primary text-xs py-0.5 px-2 flex items-center gap-1"
              disabled={!activeGovernorAccountId}
            >
              <Plus size={11} /> Add Program
            </button>
          </div>
          {governors.length === 0 && (
            <div className="card py-3 text-center text-xs text-gray-500">
              No Portfolio Governors are active yet. Choose an account below and initialize one to start real broker-account testing.
            </div>
          )}
          {activeGovernorAccountId && (
            <GovernorPanel
              key={activeGovernorAccountId}
              accountId={activeGovernorAccountId}
              accountName={accounts.find(a => a.id === activeGovernorAccountId)?.name}
            />
          )}
          {activeGovernorAccountId && (
            <PortfolioSnapshotPanel accountId={activeGovernorAccountId} />
          )}
        </div>
      ) : (
        <div className="card py-4 text-center text-xs text-gray-600 flex items-center justify-center gap-2">
          <Shield size={14} />
          No broker accounts configured yet. Create an account first, then initialize its governor for testing.
        </div>
      )}

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
          <div className="overflow-x-auto">
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
                  onPause={() => qc.invalidateQueries({ queryKey: ['deployments'] })}
                  onResume={() => {
                    startMutation.mutate(dep.id)
                    qc.invalidateQueries({ queryKey: ['deployments'] })
                  }}
                  onStop={stopMutation.mutate}
                  onViewTrades={(id) => setTradesDepId(prev => prev === id ? null : id)}
                  isSelected={tradesDepId === dep.id}
                  strategyName={strategies.find(s => s.id === dep.strategy_id)?.name}
                  accountName={accounts.find(a => a.id === dep.account_id)?.name}
                />
              ))}
            </tbody>
          </table>
          </div>
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
                { label: 'Realized P&L', value: fmtPnl(tradesData.summary.total_realized_pnl) },
                { label: 'Unrealized', value: fmtPnl(tradesData.summary.total_unrealized_pnl) },
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
                    <th className="text-right px-2 py-1.5">Unr. P&amp;L</th>
                    <th className="text-right px-2 py-1.5">Net P&amp;L</th>
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
                      <td className="px-2 py-1.5 text-right font-mono">{fmt2(t.entry_price)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{t.quantity != null ? t.quantity.toFixed(1) : '—'}</td>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Deployment to Promote</label>
              <SelectMenu
                value={selectedPaperDepId}
                onChange={setSelectedPaperDepId}
                placeholder="— Select paper deployment —"
                options={[
                  { value: '', label: '— Select deployment —' },
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

      {showAddProgram && activeGovernorAccountId && (
        <AddProgramModal
          accountId={activeGovernorAccountId}
          onClose={() => setShowAddProgram(false)}
        />
      )}
    </div>
  )
}
