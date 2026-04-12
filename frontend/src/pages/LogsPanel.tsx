import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { controlApi } from '../api/accounts'
import { backlogApi, type ProgramSlice, type ReviewStatus, type SliceStatus } from '../api/backlog'
import clsx from 'clsx'
import { Shield, RefreshCw, ClipboardList, CheckCircle2, Clock3, AlertTriangle, PencilLine, Plus, Save } from 'lucide-react'

type LogsTab = 'events' | 'program_backlog'

const CORE_DEPENDENCIES = [
  {
    lane: 'Foundation',
    dependency: 'Data + strategy definitions',
    supports: 'Backtests and repeatable paper/live deployment inputs.',
    releaseRule: 'Ship only after strategy creation, validation, and sample data work together.',
  },
  {
    lane: 'Evidence',
    dependency: 'Backtest analytics + run review',
    supports: 'Promotion decisions based on metrics, Monte Carlo, and trade review.',
    releaseRule: 'No promotion slice advances without visible evidence and verification.',
  },
  {
    lane: 'Access',
    dependency: 'Accounts + encrypted credentials + broker validation',
    supports: 'Paper/live account readiness and safe operational controls.',
    releaseRule: 'Treat account and credential readiness as prerequisites, not cleanup work.',
  },
  {
    lane: 'Execution',
    dependency: 'Deployments + promotion approvals + safety gates',
    supports: 'Controlled backtest to paper to live progression.',
    releaseRule: 'Ship lifecycle steps incrementally with review at each promotion boundary.',
  },
  {
    lane: 'Control',
    dependency: 'Kill switch + audit log + monitoring',
    supports: 'Safe intervention, oversight, and confidence in live behavior.',
    releaseRule: 'Any live-facing slice must prove control-state visibility and enforcement.',
  },
]

const RELEASE_TRAINS = [
  {
    release: 'R1',
    theme: 'Trust the paper path',
    slices: 'Strategy creation, backtest evidence, paper promotion, paper monitoring.',
    gate: 'Users can complete the paper workflow end-to-end with review evidence.',
  },
  {
    release: 'R2',
    theme: 'Control the live path',
    slices: 'Credential readiness, live promotion gates, kill-switch enforcement, auditability.',
    gate: 'Live workflow is gated by verified controls rather than UI intent alone.',
  },
  {
    release: 'R3',
    theme: 'Increase operational intelligence',
    slices: 'Real-time monitoring, event sync, pre-market checks, richer BI views.',
    gate: 'Operational decisions are supported by current, trustworthy platform signals.',
  },
]

const EMPTY_SLICE: Omit<ProgramSlice, 'id' | 'created_at' | 'updated_at'> = {
  title: '',
  objective: '',
  scope: '',
  business_impact: '',
  order_index: 0,
  blocked_by_ids: [],
  status: 'queued',
  review: 'not_started',
  verification: '',
  next_gate: '',
}

function statusClass(status: SliceStatus) {
  if (status === 'completed') return 'badge-green'
  if (status === 'in_progress') return 'bg-amber-900 text-amber-300'
  return 'badge-gray'
}

function reviewClass(review: ReviewStatus) {
  if (review === 'passed') return 'text-emerald-300'
  if (review === 'in_review') return 'text-amber-300'
  if (review === 'failed') return 'text-red-300'
  return 'text-gray-500'
}

function buildNextSliceId(slices: ProgramSlice[]) {
  const next = slices.length + 1
  return `slice-${String(next).padStart(2, '0')}`
}

function BacklogEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  saveLabel,
  saveDisabled,
  saveHint,
}: {
  draft: Omit<ProgramSlice, 'id' | 'created_at' | 'updated_at'>
  onChange: (draft: Omit<ProgramSlice, 'id' | 'created_at' | 'updated_at'>) => void
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  saveDisabled?: boolean
  saveHint?: string
}) {
  return (
    <div className="card space-y-4 border-sky-800">
      <div className="text-sm font-semibold text-gray-100">Backlog Slice Editor</div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">Title</label>
          <input className="input w-full" value={draft.title} onChange={e => onChange({ ...draft, title: e.target.value })} />
        </div>
        <div>
          <label className="label">Objective</label>
          <input className="input w-full" value={draft.objective} onChange={e => onChange({ ...draft, objective: e.target.value })} />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input w-full" value={draft.status} onChange={e => onChange({ ...draft, status: e.target.value as SliceStatus })}>
            <option value="queued">Queued</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div>
          <label className="label">Review</label>
          <select className="input w-full" value={draft.review} onChange={e => onChange({ ...draft, review: e.target.value as ReviewStatus })}>
            <option value="not_started">Not Started</option>
            <option value="in_review">In Review</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label className="label">Order Index</label>
          <input
            type="number"
            className="input w-full"
            value={draft.order_index}
            onChange={e => onChange({ ...draft, order_index: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="label">Blocked By IDs</label>
          <input
            className="input w-full"
            value={draft.blocked_by_ids.join(', ')}
            onChange={e => onChange({
              ...draft,
              blocked_by_ids: e.target.value.split(',').map(v => v.trim()).filter(Boolean),
            })}
            placeholder="slice-01, slice-02"
          />
        </div>
      </div>
      <div>
        <label className="label">Scope</label>
        <textarea className="input w-full resize-none" rows={2} value={draft.scope} onChange={e => onChange({ ...draft, scope: e.target.value })} />
      </div>
      <div>
        <label className="label">Business Impact</label>
        <textarea className="input w-full resize-none" rows={2} value={draft.business_impact} onChange={e => onChange({ ...draft, business_impact: e.target.value })} />
      </div>
      <div>
        <label className="label">Verification</label>
        <textarea className="input w-full resize-none" rows={2} value={draft.verification} onChange={e => onChange({ ...draft, verification: e.target.value })} />
      </div>
      <div>
        <label className="label">Next Gate</label>
        <textarea className="input w-full resize-none" rows={2} value={draft.next_gate} onChange={e => onChange({ ...draft, next_gate: e.target.value })} />
      </div>
      <div className="flex gap-2 justify-end">
        {saveHint && <div className="mr-auto self-center text-xs text-amber-300">{saveHint}</div>}
        <button type="button" className="btn-ghost text-sm" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="btn-primary text-sm flex items-center gap-1.5"
          onClick={onSave}
          disabled={!draft.title.trim() || !draft.objective.trim() || saveDisabled}
        >
          <Save size={14} /> {saveLabel}
        </button>
      </div>
    </div>
  )
}

function RiskEventsTab({
  events,
  isFetching,
  refetch,
  limit,
  setLimit,
}: {
  events: any[]
  isFetching: boolean
  refetch: () => void
  limit: number
  setLimit: (value: number) => void
}) {
  const killCount = events.filter((e: any) => e.action === 'kill' || e.action === 'pause').length
  const resumeCount = events.filter((e: any) => e.action === 'resume').length

  return (
    <div className="space-y-4">
      {events.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-900/60 px-3 py-2 text-xs">
            <Shield size={13} className="text-gray-500" />
            <span className="text-gray-400">{events.length} total events</span>
          </div>
          {killCount > 0 && (
            <div className="flex items-center gap-2 rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs">
              <span className="text-red-400">{killCount} kill/pause</span>
            </div>
          )}
          {resumeCount > 0 && (
            <div className="flex items-center gap-2 rounded border border-emerald-800 bg-emerald-900/20 px-3 py-2 text-xs">
              <span className="text-emerald-400">{resumeCount} resume</span>
            </div>
          )}
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
          <span className="text-sm font-semibold">Kill Switch Event Log</span>
          <div className="flex items-center gap-3">
            {isFetching && <RefreshCw size={14} className="text-gray-500 animate-spin" />}
            <button type="button" className="btn-ghost text-sm flex items-center gap-1.5" onClick={refetch}>
              <RefreshCw size={13} /> Refresh
            </button>
            <span className="text-xs text-gray-500">{events.length} events</span>
            <select className="input text-xs py-0.5 px-2" value={limit} onChange={e => setLimit(Number(e.target.value))}>
              <option value={50}>Last 50</option>
              <option value={100}>Last 100</option>
              <option value={500}>Last 500</option>
            </select>
          </div>
        </div>
        {events.length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-sm">
            <Shield size={32} className="mx-auto mb-3 text-gray-700" />
            No kill switch events - the platform has been running without interruptions.
          </div>
        ) : (
          <div className="font-mono text-xs divide-y divide-gray-800/50">
            {events.map((e: any, i: number) => (
              <div
                key={i}
                className={clsx(
                  'px-4 py-2.5 flex items-start gap-3 hover:bg-gray-800/20 transition-colors',
                  (e.action === 'kill' || e.action === 'pause') ? 'bg-red-950/10' : 'bg-emerald-950/5',
                )}
              >
                <span className="text-gray-600 whitespace-nowrap flex-shrink-0 mt-0.5">
                  {e.timestamp?.slice(0, 19).replace('T', ' ')}
                </span>
                <span className={clsx('badge flex-shrink-0', e.action === 'kill' ? 'badge-red' : e.action === 'pause' ? 'bg-amber-900 text-amber-300' : 'badge-green')}>
                  {e.action}
                </span>
                <span className={clsx('text-xs px-1.5 py-0.5 rounded flex-shrink-0', e.scope === 'global' ? 'bg-red-900/40 text-red-300' : e.scope === 'account' ? 'bg-sky-900/40 text-sky-300' : 'bg-gray-800 text-gray-400')}>
                  {e.scope}
                </span>
                {e.scope_id && <span className="text-gray-600 flex-shrink-0">{e.scope_id.slice(0, 8)}</span>}
                {e.reason && <span className="text-gray-400 truncate">- {e.reason}</span>}
                <span className="ml-auto text-gray-600 flex-shrink-0 text-right">{e.triggered_by}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProgramBacklogTab() {
  const qc = useQueryClient()
  const [editingSliceId, setEditingSliceId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Omit<ProgramSlice, 'id' | 'created_at' | 'updated_at'>>(EMPTY_SLICE)
  const [persistenceMessage, setPersistenceMessage] = useState('Shared persistence enabled via backend API')

  const { data: programSlices = [], isFetching } = useQuery({
    queryKey: ['program-backlog'],
    queryFn: backlogApi.list,
  })

  const createMutation = useMutation({
    mutationFn: backlogApi.create,
    onSuccess: async (item) => {
      setPersistenceMessage(`Added ${item.id} to shared backlog`)
      await qc.invalidateQueries({ queryKey: ['program-backlog'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<ProgramSlice, 'id' | 'created_at' | 'updated_at'>> }) =>
      backlogApi.update(id, data),
    onSuccess: async (item) => {
      setPersistenceMessage(`Updated ${item.id} in shared backlog`)
      await qc.invalidateQueries({ queryKey: ['program-backlog'] })
    },
  })

  const completedSlices = useMemo(() => programSlices.filter(slice => slice.status === 'completed').length, [programSlices])
  const reviewPassed = useMemo(() => programSlices.filter(slice => slice.review === 'passed').length, [programSlices])
  const inReview = useMemo(() => programSlices.filter(slice => slice.review === 'in_review').length, [programSlices])
  const readyToStart = useMemo(
    () => programSlices.filter(slice =>
      slice.status !== 'completed' &&
      slice.blocked_by_ids.every(depId => programSlices.find(item => item.id === depId)?.status === 'completed'),
    ).length,
    [programSlices],
  )
  const draftBlockedDeps = useMemo(
    () => draft.blocked_by_ids
      .map(depId => programSlices.find(item => item.id === depId))
      .filter(Boolean) as ProgramSlice[],
    [draft.blocked_by_ids, programSlices],
  )
  const draftHasIncompleteDeps = useMemo(
    () => draftBlockedDeps.some(item => item.status !== 'completed'),
    [draftBlockedDeps],
  )
  const saveBlockedByDeps = draftHasIncompleteDeps && ['in_progress', 'completed'].includes(draft.status)

  const beginNewSlice = () => {
    setEditingSliceId(null)
    setDraft(EMPTY_SLICE)
  }

  const beginEditSlice = (slice: ProgramSlice) => {
    setEditingSliceId(slice.id)
    setDraft({
      title: slice.title,
      objective: slice.objective,
      scope: slice.scope,
      business_impact: slice.business_impact,
      order_index: slice.order_index,
      blocked_by_ids: slice.blocked_by_ids,
      status: slice.status,
      review: slice.review,
      verification: slice.verification,
      next_gate: slice.next_gate,
    })
  }

  const handleSave = () => {
    if (editingSliceId) {
      updateMutation.mutate({ id: editingSliceId, data: draft })
    } else {
      createMutation.mutate(draft)
    }
    setEditingSliceId(null)
    setDraft(EMPTY_SLICE)
  }

  const handleReset = () => {
    setEditingSliceId(null)
    setDraft(EMPTY_SLICE)
    qc.invalidateQueries({ queryKey: ['program-backlog'] })
    setPersistenceMessage('Reloaded shared backlog from backend')
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-gray-800 bg-gray-900/60 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <ClipboardList size={13} />
            Program Slices
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-100">{programSlices.length}</div>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900/60 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <CheckCircle2 size={13} />
            Completed
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-300">{completedSlices}</div>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900/60 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Clock3 size={13} />
            In Review
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-300">{inReview}</div>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900/60 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <AlertTriangle size={13} />
            Review Passed
          </div>
          <div className="mt-2 text-2xl font-bold text-sky-300">{reviewPassed}</div>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900/60 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Plus size={13} />
            Ready To Start
          </div>
          <div className="mt-2 text-2xl font-bold text-indigo-300">{readyToStart}</div>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">Oversight Methodology</h2>
            <p className="mt-1 text-xs text-gray-500">
              Execute only one thin vertical slice at a time, capture the review result, and record independent verification before starting the next slice.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost text-sm flex items-center gap-1.5" onClick={beginNewSlice}>
              <Plus size={14} /> New Slice
            </button>
            <button type="button" className="btn-ghost text-sm" onClick={handleReset}>
              Reset Defaults
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-500">
          {persistenceMessage}{isFetching ? ' - syncing...' : ''}
        </div>
        <div className="grid gap-2 text-xs text-gray-400 md:grid-cols-3">
          <div className="rounded border border-gray-800 bg-gray-950/60 p-3">1. Define the smallest user-visible slice with real business value.</div>
          <div className="rounded border border-gray-800 bg-gray-950/60 p-3">2. Implement the slice end-to-end across backend, frontend, and tests.</div>
          <div className="rounded border border-gray-800 bg-gray-950/60 p-3">3. Record review outcome and verification evidence here before moving forward.</div>
        </div>
      </div>

      <BacklogEditor
        draft={draft}
        onChange={setDraft}
        onSave={handleSave}
        onCancel={() => {
          setEditingSliceId(null)
          setDraft(EMPTY_SLICE)
        }}
        saveLabel={editingSliceId ? `Save ${editingSliceId}` : 'Add Slice'}
        saveDisabled={saveBlockedByDeps}
        saveHint={saveBlockedByDeps ? `Dependencies must be completed first: ${draftBlockedDeps.filter(item => item.status !== 'completed').map(item => item.id).join(', ')}` : ''}
      />

      <div className="card space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">Core Dependencies</h2>
          <p className="mt-1 text-xs text-gray-500">
            Release slices should follow dependency order so each increment lands on usable foundations instead of relying on a big-bang finish.
          </p>
        </div>
        <div className="space-y-2">
          {CORE_DEPENDENCIES.map(item => (
            <div key={item.lane} className="rounded border border-gray-800 bg-gray-950/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-gray-100">{item.lane}</div>
                <div className="text-xs text-sky-300">{item.dependency}</div>
              </div>
              <div className="mt-2 text-sm text-gray-300">{item.supports}</div>
              <div className="mt-2 text-xs text-gray-500">Release rule: {item.releaseRule}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">Incremental Release Trains</h2>
          <p className="mt-1 text-xs text-gray-500">
            Plan releases as dependency-aware trains with explicit gates, rather than bundling all workflows into one launch.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {RELEASE_TRAINS.map(train => (
            <div key={train.release} className="rounded border border-gray-800 bg-gray-950/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-100">{train.release}</div>
                <div className="text-xs text-amber-300">{train.theme}</div>
              </div>
              <div className="text-sm text-gray-300">{train.slices}</div>
              <div className="text-xs text-gray-500">Gate: {train.gate}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {programSlices.map(slice => {
          const blockedBy = slice.blocked_by_ids
            .map(depId => programSlices.find(item => item.id === depId))
            .filter(Boolean) as ProgramSlice[]
          const isBlocked = blockedBy.some(item => item.status !== 'completed')
          const isReady = !isBlocked && slice.status !== 'completed'

          return (
          <div key={slice.id} className="card space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs text-gray-600">{slice.id} · order {slice.order_index}</div>
                <h3 className="text-base font-semibold text-gray-100">{slice.title}</h3>
                <p className="mt-1 text-sm text-gray-400">{slice.objective}</p>
              </div>
              <div className="flex gap-2 items-center">
                <span className={clsx('badge', statusClass(slice.status))}>{slice.status.replace('_', ' ')}</span>
                <span className={clsx('text-xs font-semibold self-center', reviewClass(slice.review))}>
                  Review: {slice.review.replace('_', ' ')}
                </span>
                <span className={clsx('text-xs font-semibold self-center', isBlocked ? 'text-red-300' : isReady ? 'text-indigo-300' : 'text-gray-500')}>
                  {isBlocked ? 'Blocked' : isReady ? 'Ready' : 'Done'}
                </span>
                <button type="button" className="btn-ghost text-xs flex items-center gap-1" onClick={() => beginEditSlice(slice)}>
                  <PencilLine size={12} /> Edit
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded border border-gray-800 bg-gray-950/50 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Scope</div>
                <div className="mt-1 text-sm text-gray-300">{slice.scope}</div>
              </div>
              <div className="rounded border border-gray-800 bg-gray-950/50 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Business Impact</div>
                <div className="mt-1 text-sm text-gray-300">{slice.business_impact}</div>
              </div>
              <div className="rounded border border-gray-800 bg-gray-950/50 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Verification</div>
                <div className="mt-1 text-sm text-gray-300">{slice.verification}</div>
              </div>
              <div className="rounded border border-gray-800 bg-gray-950/50 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Next Gate</div>
                <div className="mt-1 text-sm text-gray-300">{slice.next_gate}</div>
              </div>
              <div className="rounded border border-gray-800 bg-gray-950/50 p-3 md:col-span-2">
                <div className="text-xs uppercase tracking-wide text-gray-500">Dependencies</div>
                <div className="mt-1 text-sm text-gray-300">
                  {blockedBy.length === 0
                    ? 'No predecessor slices. This slice can be scheduled independently.'
                    : blockedBy.map(item => `${item.id} (${item.status})`).join(', ')}
                </div>
              </div>
            </div>
          </div>
        )})}
      </div>
    </div>
  )
}

export function LogsPanel() {
  const [limit, setLimit] = useState(100)
  const [activeTab, setActiveTab] = useState<LogsTab>('events')

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['kill-events', limit],
    queryFn: () => controlApi.events(limit),
    refetchInterval: 10_000,
  })

  const events = data?.events ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Logs & Alerts</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Risk control events and program-level execution oversight
          </p>
        </div>
      </div>

      <div className="border-b border-gray-800">
        <div className="flex gap-1">
          <button
            type="button"
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2',
              activeTab === 'events'
                ? 'text-sky-400 border-sky-500'
                : 'text-gray-500 border-transparent hover:text-gray-300',
            )}
            onClick={() => setActiveTab('events')}
          >
            Risk Events
          </button>
          <button
            type="button"
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2',
              activeTab === 'program_backlog'
                ? 'text-sky-400 border-sky-500'
                : 'text-gray-500 border-transparent hover:text-gray-300',
            )}
            onClick={() => setActiveTab('program_backlog')}
          >
            Program Backlog
          </button>
        </div>
      </div>

      {activeTab === 'events' ? (
        <RiskEventsTab
          events={events}
          isFetching={isFetching}
          refetch={refetch}
          limit={limit}
          setLimit={setLimit}
        />
      ) : (
        <ProgramBacklogTab />
      )}
    </div>
  )
}
