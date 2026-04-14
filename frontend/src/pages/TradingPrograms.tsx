import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { programsApi, TradingProgram, AccountAllocation } from '../api/programs'
import { usePollingGate } from '../hooks/usePollingGate'
import { SelectMenu } from '../components/SelectMenu'
import clsx from 'clsx'
import {
  Plus, Layers, Lock, ChevronDown, ChevronRight, CheckCircle2,
  Circle, AlertTriangle, Play, Square, Zap, RefreshCw, X,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type CardId = 'strategy' | 'optimizer' | 'universe' | 'execution'

interface CardState {
  id: CardId
  label: string
  description: string
  field: keyof TradingProgram
  icon: React.ReactNode
}

const CARDS: CardState[] = [
  {
    id: 'strategy',
    label: 'Strategy Version',
    description: 'Backtest-approved StrategyVersion with duration mode, entry/exit conditions, and stop rules.',
    field: 'strategy_version_id',
    icon: <Layers size={14} />,
  },
  {
    id: 'optimizer',
    label: 'Optimization Profile',
    description: 'Optimizer engine + objective configuration for weight generation.',
    field: 'optimization_profile_id',
    icon: <Zap size={14} />,
  },
  {
    id: 'universe',
    label: 'Symbol Universe',
    description: 'Resolved symbol universe snapshot with deny list enforced.',
    field: 'symbol_universe_snapshot_id',
    icon: <Layers size={14} />,
  },
  {
    id: 'execution',
    label: 'Execution Policy',
    description: 'Order type, fill model, slippage assumptions, commission model.',
    field: 'execution_policy',
    icon: <Play size={14} />,
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: TradingProgram['status']) {
  const map: Record<string, string> = {
    draft: 'bg-gray-800 text-gray-400 ring-1 ring-gray-700',
    frozen: 'bg-sky-900/60 text-sky-300 ring-1 ring-sky-700',
    deprecated: 'bg-red-950/60 text-red-400 ring-1 ring-red-800',
  }
  return (
    <span className={clsx('text-xs px-1.5 py-0.5 rounded font-medium', map[status] ?? map.draft)}>
      {status}
    </span>
  )
}

function allocationStatusBadge(status: AccountAllocation['status']) {
  const map: Record<string, string> = {
    pending: 'bg-gray-800 text-gray-400',
    paper: 'bg-indigo-900/60 text-indigo-300',
    promoted_to_live: 'bg-emerald-900/60 text-emerald-300',
    paused: 'bg-amber-900/60 text-amber-300',
    stopped: 'bg-gray-800 text-gray-500',
    killed: 'bg-red-950/60 text-red-400',
  }
  return (
    <span className={clsx('text-xs px-1.5 py-0.5 rounded', map[status] ?? 'bg-gray-800 text-gray-400')}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function durationBadge(mode: string) {
  const map: Record<string, string> = {
    day: 'bg-blue-900/60 text-blue-300 ring-1 ring-blue-700',
    swing: 'bg-amber-900/60 text-amber-300 ring-1 ring-amber-700',
    position: 'bg-emerald-900/60 text-emerald-300 ring-1 ring-emerald-700',
  }
  return (
    <span className={clsx('text-xs px-1.5 py-0.5 rounded font-medium uppercase tracking-wide', map[mode] ?? 'bg-gray-800 text-gray-400')}>
      {mode}
    </span>
  )
}

// ─── Card readiness check ─────────────────────────────────────────────────────

function isCardReady(card: CardState, program: TradingProgram): boolean {
  const val = program[card.field]
  if (card.field === 'execution_policy') {
    return typeof val === 'object' && val !== null && Object.keys(val as object).length > 0
  }
  return typeof val === 'string' && val.length > 0
}

// ─── Guided Card ─────────────────────────────────────────────────────────────

function GuidedCard({
  card,
  program,
  expanded,
  onToggle,
}: {
  card: CardState
  program: TradingProgram
  expanded: boolean
  onToggle: () => void
}) {
  const ready = isCardReady(card, program)
  const frozen = program.status === 'frozen'

  return (
    <div
      className={clsx(
        'rounded border transition-all',
        ready ? 'border-sky-800/60 bg-sky-950/20' : 'border-gray-800 bg-gray-900/50',
        frozen && 'opacity-70',
      )}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <span className={clsx('flex-shrink-0', ready ? 'text-sky-400' : 'text-gray-600')}>
          {ready ? <CheckCircle2 size={14} /> : <Circle size={14} />}
        </span>
        <span className="flex-shrink-0 text-gray-500">{card.icon}</span>
        <span className={clsx('text-sm font-medium flex-1', ready ? 'text-gray-200' : 'text-gray-400')}>
          {card.label}
        </span>
        {ready && (
          <span className="text-xs text-sky-400 font-medium">Ready</span>
        )}
        <span className="text-gray-600 flex-shrink-0">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-xs text-gray-500">{card.description}</p>
          <div className="text-xs text-gray-400 font-mono bg-gray-900 px-2 py-1.5 rounded">
            {card.field === 'execution_policy'
              ? JSON.stringify(program[card.field] || {}, null, 2)
              : (program[card.field] as string | null) || <span className="text-gray-600 italic">Not set</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Create Program Modal ─────────────────────────────────────────────────────

function CreateProgramModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: TradingProgram) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [durationMode, setDurationMode] = useState('swing')
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => programsApi.create({ name: name.trim(), description: description.trim() || undefined, duration_mode: durationMode }),
    onSuccess: (p) => { onCreated(p) },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="card w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">New Trading Program</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={14} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input
              className="input w-full"
              placeholder="e.g. Momentum Swing v1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <textarea
              className="input w-full resize-none"
              rows={2}
              placeholder="Brief description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Duration Mode</label>
            <SelectMenu
              value={durationMode}
              onChange={setDurationMode}
              options={[
                { value: 'day', label: 'Day — intraday, PDT rules apply' },
                { value: 'swing', label: 'Swing — 2–10 days, overnight risk' },
                { value: 'position', label: 'Position — weeks to months' },
              ]}
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending ? 'Creating...' : 'Create Program'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Freeze Confirmation ──────────────────────────────────────────────────────

function FreezeConfirmModal({ program, onClose, onFrozen }: {
  program: TradingProgram
  onClose: () => void
  onFrozen: () => void
}) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => programsApi.freeze(program.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['programs'] }); onFrozen() },
  })

  const ready = CARDS.filter(c => isCardReady(c, program))
  const notReady = CARDS.filter(c => !isCardReady(c, program))

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="card w-full max-w-md space-y-4">
        <h2 className="text-sm font-semibold text-gray-200">Freeze Program</h2>
        <p className="text-xs text-gray-400">
          Freezing locks all component references. Any future change requires a new program version.
        </p>

        {notReady.length > 0 && (
          <div className="rounded border border-amber-800/60 bg-amber-950/20 px-3 py-2 space-y-1">
            <p className="text-xs font-medium text-amber-300 flex items-center gap-1.5">
              <AlertTriangle size={12} /> {notReady.length} card{notReady.length > 1 ? 's' : ''} not ready
            </p>
            {notReady.map(c => (
              <p key={c.id} className="text-xs text-amber-200/70 pl-4">• {c.label}</p>
            ))}
            <p className="text-xs text-amber-300/60 pt-1">You can still freeze — missing components can be set later if needed, but the program is locked to these component IDs.</p>
          </div>
        )}

        {ready.length > 0 && (
          <div className="space-y-1">
            {ready.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-xs text-sky-300">
                <CheckCircle2 size={11} />
                <span>{c.label}</span>
                <span className="text-gray-600 font-mono truncate flex-1">{String(program[c.field]).slice(0, 20)}...</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="btn-primary bg-sky-700 hover:bg-sky-600"
          >
            {mutation.isPending ? 'Freezing...' : 'Freeze Program'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Program Detail Panel ─────────────────────────────────────────────────────

function ProgramDetail({ program, onBack }: { program: TradingProgram; onBack: () => void }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<CardId | null>(null)
  const [showFreeze, setShowFreeze] = useState(false)

  const { data: allocations = [], isLoading: allocLoading } = useQuery({
    queryKey: ['programs', program.id, 'allocations'],
    queryFn: () => programsApi.listAllocations(program.id),
  })

  const stopMutation = useMutation({
    mutationFn: (allocId: string) => programsApi.stopAllocation(program.id, allocId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['programs', program.id, 'allocations'] }),
  })

  const startMutation = useMutation({
    mutationFn: (allocId: string) => programsApi.startAllocation(program.id, allocId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['programs', program.id, 'allocations'] }),
  })

  const allReady = CARDS.every(c => isCardReady(c, program))
  const frozen = program.status === 'frozen'

  return (
    <div className="space-y-4">
      {showFreeze && (
        <FreezeConfirmModal
          program={program}
          onClose={() => setShowFreeze(false)}
          onFrozen={() => { setShowFreeze(false); qc.invalidateQueries({ queryKey: ['programs'] }) }}
        />
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-300 mt-0.5">
          <ChevronRight size={14} className="rotate-180" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-200">{program.name}</span>
            <span className="text-xs text-gray-600">v{program.version}</span>
            {statusBadge(program.status)}
            {durationBadge(program.duration_mode)}
          </div>
          {program.description && (
            <p className="text-xs text-gray-500 mt-0.5">{program.description}</p>
          )}
          {program.frozen_at && (
            <p className="text-xs text-gray-600 mt-0.5">
              Frozen {new Date(program.frozen_at).toLocaleDateString()} by {program.frozen_by}
            </p>
          )}
        </div>
      </div>

      {/* Guided Card Stack */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Components</div>
        {CARDS.map((card) => (
          <GuidedCard
            key={card.id}
            card={card}
            program={program}
            expanded={expanded === card.id}
            onToggle={() => setExpanded(expanded === card.id ? null : card.id)}
          />
        ))}
      </div>

      {/* Freeze footer — shown when all 4 ready and not yet frozen */}
      {!frozen && allReady && (
        <div className="rounded border border-sky-700 bg-sky-900/20 px-4 py-3 flex items-center justify-between sticky bottom-0">
          <div>
            <p className="text-xs font-semibold text-sky-300">All components ready</p>
            <p className="text-xs text-sky-300/60">Freeze to make this program deployable.</p>
          </div>
          <button
            onClick={() => setShowFreeze(true)}
            className="btn-primary bg-sky-700 hover:bg-sky-600 text-xs flex items-center gap-1.5"
          >
            <Lock size={12} />
            Freeze Program
          </button>
        </div>
      )}

      {!frozen && !allReady && (
        <div className="rounded border border-gray-800 bg-gray-900/40 px-4 py-2.5 flex items-center gap-2">
          <Circle size={12} className="text-gray-600" />
          <span className="text-xs text-gray-500">
            {CARDS.filter(c => isCardReady(c, program)).length}/4 components ready — set all to unlock Freeze
          </span>
        </div>
      )}

      {/* Allocations */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Account Allocations</div>
        {allocLoading ? (
          <div className="text-xs text-gray-600">Loading...</div>
        ) : allocations.length === 0 ? (
          <div className="rounded border border-gray-800 bg-gray-900/40 px-3 py-2.5 text-xs text-gray-600">
            No allocations yet. Freeze the program first, then add an allocation.
          </div>
        ) : (
          allocations.map((alloc) => (
            <div key={alloc.id} className="rounded border border-gray-800 bg-gray-900/40 px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {allocationStatusBadge(alloc.status)}
                  <span className="text-xs text-gray-400 font-mono truncate">{alloc.account_id.slice(0, 12)}...</span>
                  <span className={clsx('text-xs', alloc.broker_mode === 'live' ? 'text-red-400' : 'text-indigo-400')}>
                    {alloc.broker_mode}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {alloc.status === 'paper' || alloc.status === 'promoted_to_live' ? (
                    <button
                      onClick={() => stopMutation.mutate(alloc.id)}
                      disabled={stopMutation.isPending}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 px-2 py-1 rounded border border-gray-700 hover:border-red-800 transition-colors"
                    >
                      <Square size={10} />
                      Stop
                    </button>
                  ) : alloc.status === 'pending' || alloc.status === 'paused' ? (
                    <button
                      onClick={() => startMutation.mutate(alloc.id)}
                      disabled={startMutation.isPending}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-sky-400 px-2 py-1 rounded border border-gray-700 hover:border-sky-800 transition-colors"
                    >
                      <Play size={10} />
                      Start
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>${alloc.allocated_capital_usd.toLocaleString()} allocated</span>
                <span>{alloc.conflict_resolution.replace(/_/g, ' ')}</span>
                {alloc.position_size_scale_pct && (
                  <span>size ×{alloc.position_size_scale_pct.toFixed(2)}</span>
                )}
                {alloc.session_window_shift_min !== null && alloc.session_window_shift_min !== 0 && (
                  <span>window {alloc.session_window_shift_min > 0 ? '+' : ''}{alloc.session_window_shift_min}min</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Program List ─────────────────────────────────────────────────────────────

function ProgramList({ onSelect }: { onSelect: (p: TradingProgram) => void }) {
  const [showCreate, setShowCreate] = useState(false)
  const qc = useQueryClient()
  const pausePolling = usePollingGate()

  const { data: programs = [], isLoading, error } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
    refetchInterval: pausePolling ? false : 30_000,
  })

  const handleCreated = (p: TradingProgram) => {
    qc.invalidateQueries({ queryKey: ['programs'] })
    setShowCreate(false)
    onSelect(p)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-xs text-gray-500">
        <RefreshCw size={13} className="animate-spin mr-2" /> Loading programs...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showCreate && (
        <CreateProgramModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-gray-200">Trading Programs</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary text-xs flex items-center gap-1.5"
        >
          <Plus size={13} />
          New Program
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-800 bg-red-950/20 px-3 py-2 text-xs text-red-400">
          {(error as Error).message}
        </div>
      )}

      {programs.length === 0 ? (
        <div className="rounded border border-gray-800 bg-gray-900/40 px-4 py-8 text-center space-y-2">
          <p className="text-sm text-gray-400">No trading programs yet</p>
          <p className="text-xs text-gray-600">
            A TradingProgram bundles a strategy version, optimizer, symbol universe, and execution policy into a frozen deployable template.
          </p>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs mt-2">
            Create First Program
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {programs.map((program) => {
            const readyCount = CARDS.filter(c => isCardReady(c, program)).length
            return (
              <button
                key={program.id}
                onClick={() => onSelect(program)}
                className="w-full text-left rounded border border-gray-800 bg-gray-900/50 hover:border-gray-700 hover:bg-gray-900 px-4 py-3 transition-colors space-y-1.5"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-200">{program.name}</span>
                  <span className="text-xs text-gray-600">v{program.version}</span>
                  {statusBadge(program.status)}
                  {durationBadge(program.duration_mode)}
                </div>
                {program.description && (
                  <p className="text-xs text-gray-500 line-clamp-1">{program.description}</p>
                )}
                <div className="flex items-center gap-3 text-xs text-gray-600">
                  <span>{readyCount}/4 components ready</span>
                  {program.frozen_at && (
                    <span>frozen {new Date(program.frozen_at).toLocaleDateString()}</span>
                  )}
                  {program.created_at && (
                    <span>created {new Date(program.created_at).toLocaleDateString()}</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function TradingPrograms() {
  const [selected, setSelected] = useState<TradingProgram | null>(null)
  const pausePolling = usePollingGate()

  // Re-fetch program on selection to get latest state
  const { data: liveProgram } = useQuery({
    queryKey: ['programs', selected?.id],
    queryFn: () => programsApi.get(selected!.id),
    enabled: !!selected,
    refetchInterval: pausePolling ? false : 10_000,
  })

  const activeProgram = liveProgram ?? selected

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {activeProgram ? (
        <ProgramDetail program={activeProgram} onBack={() => setSelected(null)} />
      ) : (
        <ProgramList onSelect={setSelected} />
      )}
    </div>
  )
}
