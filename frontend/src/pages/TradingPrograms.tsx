import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  FlaskConical,
  Layers,
  List,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react'
import { programsApi, type AccountAllocation, type ProgramValidation, type TradingProgram } from '../api/programs'
import { strategiesApi } from '../api/strategies'
import { strategyControlsApi } from '../api/strategyGovernors'
import { executionStylesApi } from '../api/executionStyles'
import { riskProfilesApi } from '../api/riskProfiles'
import { watchlistsApi } from '../api/watchlists'
import { usePollingGate } from '../hooks/usePollingGate'
import { SelectMenu } from '../components/SelectMenu'
import { PageHelp } from '../components/PageHelp'
import type { ExecutionStyle, RiskProfile, Strategy, StrategyControls, StrategyVersion } from '../types'

type CardId = 'strategy' | 'governor' | 'risk_profile' | 'execution_style' | 'watchlist'

interface CardState {
  id: CardId
  label: string
  description: string
  field: keyof TradingProgram
  icon: React.ReactNode
  browseHref: string
  browseLabel: string
}

interface StrategyDetail extends Strategy {
  versions: StrategyVersion[]
}

const CARDS: CardState[] = [
  {
    id: 'strategy',
    label: 'Strategy',
    description: 'Signal logic, entries, logical exits, and stop candidates.',
    field: 'strategy_version_id',
    icon: <Layers size={14} />,
    browseHref: '/strategies',
    browseLabel: 'Create or Manage Strategies',
  },
  {
    id: 'governor',
    label: 'Strategy Controls',
    description: 'Timeframe, session windows, cooldowns, regime filters, and trade gates.',
    field: 'strategy_governor_id',
    icon: <Clock size={14} />,
    browseHref: '/strategy-controls',
    browseLabel: 'Create or Manage Controls',
  },
  {
    id: 'risk_profile',
    label: 'Risk Profile',
    description: 'Sizing, leverage, drawdown protection, and exposure limits.',
    field: 'risk_profile_id',
    icon: <ShieldCheck size={14} />,
    browseHref: '/risk-profiles',
    browseLabel: 'Create or Manage Risk Profiles',
  },
  {
    id: 'execution_style',
    label: 'Execution Style',
    description: 'Broker order expression, scale-out structure, and trailing behavior.',
    field: 'execution_style_id',
    icon: <Play size={14} />,
    browseHref: '/execution-styles',
    browseLabel: 'Create or Manage Styles',
  },
  {
    id: 'watchlist',
    label: 'Watchlists',
    description: 'Universe source and the rule for combining multiple watchlists.',
    field: 'watchlist_subscriptions',
    icon: <List size={14} />,
    browseHref: '/watchlists',
    browseLabel: 'Create or Manage Watchlists',
  },
]

const WORKFLOW_STEPS = [
  { step: '1', text: 'Strategy' },
  { step: '2', text: 'Controls' },
  { step: '3', text: 'Risk' },
  { step: '4', text: 'Execution' },
  { step: '5', text: 'Watchlist' },
]

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

function isCardReady(card: CardState, program: TradingProgram): boolean {
  const value = program[card.field]
  if (card.field === 'watchlist_subscriptions') {
    return Array.isArray(value) && value.length > 0
  }
  return typeof value === 'string' && value.length > 0
}

function ProgramProgressBar({ program }: { program: TradingProgram }) {
  const readyCount = CARDS.filter((card) => isCardReady(card, program)).length

  return (
    <div className="rounded border border-gray-800 bg-gray-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">Programs</h2>
          <p className="text-xs text-gray-500">Combine a strategy, controls, risk profile, execution style, and watchlist into a deployable unit.</p>
        </div>
        <span className="text-xs text-gray-500">{readyCount}/5 complete</span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {WORKFLOW_STEPS.map((step, index) => {
          const ready = isCardReady(CARDS[index], program)
          return (
            <div key={step.step} className="space-y-1">
              <div className={clsx('h-1.5 rounded-full', ready ? 'bg-sky-500' : 'bg-gray-800')} />
              <p className={clsx('text-[11px]', ready ? 'text-sky-300' : 'text-gray-500')}>
                {step.step}. {step.text}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GuidedCard({
  card,
  program,
  expanded,
  summary,
  valueDisplay,
  onToggle,
  children,
}: {
  card: CardState
  program: TradingProgram
  expanded: boolean
  summary: string
  valueDisplay: React.ReactNode
  onToggle: () => void
  children: React.ReactNode
}) {
  const ready = isCardReady(card, program)

  return (
    <div className={clsx('rounded border transition-colors', ready ? 'border-sky-800/60 bg-sky-950/20' : 'border-gray-800 bg-gray-900/50')}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-3 py-3 text-left">
        <span className={clsx('flex-shrink-0', ready ? 'text-sky-400' : 'text-gray-600')}>
          {ready ? <CheckCircle2 size={14} /> : <Circle size={14} />}
        </span>
        <span className="text-gray-500 flex-shrink-0">{card.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={clsx('text-sm font-medium', ready ? 'text-gray-200' : 'text-gray-400')}>{card.label}</span>
            <span className={clsx('text-[11px] uppercase tracking-wide', ready ? 'text-sky-400' : 'text-amber-400')}>
              {ready ? 'Complete' : 'Missing'}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">{summary}</p>
        </div>
        <span className="text-gray-600">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-xs text-gray-500">{card.description}</p>
          <div className="rounded bg-gray-900 px-2 py-1.5 text-xs text-gray-300">{valueDisplay}</div>
          <div className="flex justify-end">
            <Link to={card.browseHref} className="text-xs text-sky-400 hover:text-sky-300">
              {card.browseLabel}
            </Link>
          </div>
          {children}
        </div>
      )}
    </div>
  )
}

function CreateProgramModal({
  onClose,
  onCreated,
  prefillStrategyVersionId,
}: {
  onClose: () => void
  onCreated: (program: TradingProgram) => void
  prefillStrategyVersionId?: string
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [durationMode, setDurationMode] = useState('swing')
  const [strategyVersionId, setStrategyVersionId] = useState(prefillStrategyVersionId ?? '')
  const [error, setError] = useState('')

  const { data: strategies = [] } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => strategiesApi.list(),
  })

  const strategyQueries = useQueries({
    queries: strategies.map((strategy) => ({
      queryKey: ['strategies', strategy.id],
      queryFn: () => strategiesApi.get(strategy.id),
    })),
  })

  const strategyOptions = strategyQueries
    .map((query) => query.data as StrategyDetail | undefined)
    .filter((value): value is StrategyDetail => !!value)
    .flatMap((strategy) =>
      strategy.versions
        .slice()
        .sort((a, b) => b.version - a.version)
        .map((version) => ({
          value: version.id,
          label: `${strategy.name} v${version.version}`,
        })),
    )

  const createMutation = useMutation({
    mutationFn: () => programsApi.create({
      name: name.trim(),
      description: description.trim() || undefined,
      notes: notes.trim() || undefined,
      duration_mode: durationMode,
      ...(strategyVersionId ? { strategy_version_id: strategyVersionId } : {}),
    }),
    onSuccess: (created) => onCreated(created),
    onError: (err: Error) => setError(err.message),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="card w-full max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">Create Program</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={14} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Program Name</label>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input w-full" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="label">Duration Mode</label>
            <SelectMenu
              value={durationMode}
              onChange={setDurationMode}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'swing', label: 'Swing' },
                { value: 'position', label: 'Position' },
              ]}
            />
          </div>
          <div>
            <label className="label">Program Notes</label>
            <textarea
              className="input w-full min-h-[96px] resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context for how this program should be deployed or monitored."
            />
          </div>
          <div>
            <label className="label">Starting Strategy Version</label>
            <SelectMenu
              value={strategyVersionId}
              onChange={setStrategyVersionId}
              options={[{ value: '', label: '— Add later —' }, ...strategyOptions]}
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending} className="btn-primary">
            {createMutation.isPending ? 'Creating...' : 'Create Program'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProgramDetail({ program, onBack }: { program: TradingProgram; onBack: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<CardId | null>('strategy')
  const [nameDraft, setNameDraft] = useState(program.name)
  const [descriptionDraft, setDescriptionDraft] = useState(program.description ?? '')
  const [notesDraft, setNotesDraft] = useState(program.notes ?? '')
  const [validationResult, setValidationResult] = useState<ProgramValidation | null>(null)

  useEffect(() => {
    setNameDraft(program.name)
    setDescriptionDraft(program.description ?? '')
    setNotesDraft(program.notes ?? '')
  }, [program.id, program.name, program.description, program.notes])

  const { data: strategies = [] } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => strategiesApi.list(),
  })

  const strategyQueries = useQueries({
    queries: strategies.map((strategy) => ({
      queryKey: ['strategies', strategy.id],
      queryFn: () => strategiesApi.get(strategy.id),
    })),
  })

  const { data: controls = [] } = useQuery({
    queryKey: ['strategy-controls'],
    queryFn: () => strategyControlsApi.list(),
  })

  const { data: executionStyles = [] } = useQuery({
    queryKey: ['execution-styles'],
    queryFn: () => executionStylesApi.list(),
  })

  const { data: riskProfiles = [] } = useQuery({
    queryKey: ['risk-profiles'],
    queryFn: () => riskProfilesApi.list(),
  })

  const { data: watchlists = [] } = useQuery({
    queryKey: ['watchlists'],
    queryFn: () => watchlistsApi.list(),
  })

  const { data: allocations = [], isLoading: allocLoading } = useQuery({
    queryKey: ['programs', program.id, 'allocations'],
    queryFn: () => programsApi.listAllocations(program.id),
  })

  const strategyDetails = strategyQueries
    .map((query) => query.data as StrategyDetail | undefined)
    .filter((value): value is StrategyDetail => !!value)

  const strategyVersionOptions = strategyDetails.flatMap((strategy) =>
    strategy.versions
      .slice()
      .sort((a, b) => b.version - a.version)
      .map((version) => ({
        value: version.id,
        label: `${strategy.name} v${version.version}`,
      })),
  )

  const strategyOptions = [{ value: '', label: '— No strategy linked —' }, ...strategyVersionOptions]
  const controlOptions = [{ value: '', label: '— No controls linked —' }, ...controls.map((control: StrategyControls) => ({ value: control.id, label: control.is_golden ? `★ ${control.name}` : control.name }))]
  const riskOptions = [{ value: '', label: '— No risk profile linked —' }, ...riskProfiles.map((profile: RiskProfile) => ({ value: profile.id, label: profile.is_golden ? `★ ${profile.name}` : profile.name }))]
  const executionOptions = [{ value: '', label: '— No execution style linked —' }, ...executionStyles.map((style: ExecutionStyle) => ({ value: style.id, label: style.is_golden ? `★ ${style.name}` : style.name }))]

  const selectedWatchlists = watchlists.filter((watchlist) => program.watchlist_subscriptions.includes(watchlist.id))
  const allReady = CARDS.every((card) => isCardReady(card, program))
  const locked = program.status === 'frozen'
  const detailsDirty =
    nameDraft.trim() !== program.name ||
    descriptionDraft !== (program.description ?? '') ||
    notesDraft !== (program.notes ?? '')

  const updateProgramMutation = useMutation({
    mutationFn: (updates: Partial<TradingProgram>) => programsApi.update(program.id, updates),
    onSuccess: (updated) => {
      qc.setQueryData(['programs', program.id], updated)
      qc.invalidateQueries({ queryKey: ['programs'] })
      setValidationResult(null)
    },
  })

  const saveDetailsMutation = useMutation({
    mutationFn: () => programsApi.update(program.id, {
      name: nameDraft.trim(),
      description: descriptionDraft.trim() || null,
      notes: notesDraft.trim() || null,
    }),
    onSuccess: (updated) => {
      qc.setQueryData(['programs', program.id], updated)
      qc.invalidateQueries({ queryKey: ['programs'] })
      setValidationResult(null)
    },
  })

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (detailsDirty) {
        const updated = await programsApi.update(program.id, {
          name: nameDraft.trim(),
          description: descriptionDraft.trim() || null,
          notes: notesDraft.trim() || null,
        })
        qc.setQueryData(['programs', program.id], updated)
        qc.invalidateQueries({ queryKey: ['programs'] })
      }
      return programsApi.validate(program.id)
    },
    onSuccess: (result) => setValidationResult(result),
  })

  const stopMutation = useMutation({
    mutationFn: (allocationId: string) => programsApi.stopAllocation(program.id, allocationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['programs', program.id, 'allocations'] }),
  })

  const startMutation = useMutation({
    mutationFn: (allocationId: string) => programsApi.startAllocation(program.id, allocationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['programs', program.id, 'allocations'] }),
  })

  const validation = validationResult ?? {
    can_deploy: allReady && program.status !== 'deprecated',
    missing_components: CARDS.filter((card) => !isCardReady(card, program)).map((card) => card.label),
    warnings: locked ? ['Program is locked while it has active account allocations. Stop or remove them to edit this program again.'] : [],
    expected_behavior: [
      program.strategy_version_id ? 'Signals will come from the linked strategy version.' : 'Attach a strategy to define entries and exits.',
      program.strategy_governor_id ? 'Strategy Controls will gate when entries are allowed.' : 'Attach controls to govern sessions, timing, and cooldowns.',
      program.risk_profile_id ? 'Risk Profile will drive sizing and exposure limits.' : 'Attach a risk profile to govern sizing and drawdown protection.',
      program.execution_style_id ? 'Execution Style will define broker order behavior and exits.' : 'Attach an execution style to define order expression and trailing logic.',
      selectedWatchlists.length > 0 ? `Watchlists will resolve symbols using the ${(program.watchlist_combination_rule || 'union')} rule.` : 'Attach at least one watchlist to define the trading universe.',
    ],
    attached_components: {
      strategy: !!program.strategy_version_id,
      strategy_controls: !!program.strategy_governor_id,
      risk_profile: !!program.risk_profile_id,
      execution_style: !!program.execution_style_id,
      watchlists: selectedWatchlists.length > 0,
    },
  } satisfies ProgramValidation

  const cardSummaryById: Record<CardId, string> = {
    strategy: program.strategy_version_id
      ? (() => {
          const selected = strategyDetails.find((strategy) => strategy.versions.some((version) => version.id === program.strategy_version_id))
          return selected ? `${selected.name} · ${program.duration_mode} mode` : 'Strategy version attached'
        })()
      : 'Missing strategy definition',
    governor: program.strategy_governor_id
      ? (() => {
          const selected = controls.find((control) => control.id === program.strategy_governor_id)
          return selected ? `${selected.timeframe} · ${selected.duration_mode}` : 'Controls attached'
        })()
      : 'Missing timing and gate controls',
    risk_profile: program.risk_profile_id
      ? (() => {
          const selected = riskProfiles.find((profile) => profile.id === program.risk_profile_id)
          return selected ? `${selected.max_leverage}x leverage · ${selected.max_drawdown_lockout_pct}% DD lock` : 'Risk profile attached'
        })()
      : 'Missing sizing and drawdown controls',
    execution_style: program.execution_style_id
      ? (() => {
          const selected = executionStyles.find((style) => style.id === program.execution_style_id)
          return selected ? `${selected.entry_order_type} entry · ${selected.bracket_mode} exits` : 'Execution style attached'
        })()
      : 'Missing order expression and exit rules',
    watchlist: selectedWatchlists.length > 0
      ? `${selectedWatchlists.length} watchlist${selectedWatchlists.length > 1 ? 's' : ''} · ${(program.watchlist_combination_rule || 'union')} rule`
      : 'Missing symbol universe',
  }

  const valueDisplayByCard: Record<CardId, React.ReactNode> = {
    strategy: strategyVersionOptions.find((option) => option.value === program.strategy_version_id)?.label ?? <span className="text-gray-500 italic">No strategy linked</span>,
    governor: controls.find((control) => control.id === program.strategy_governor_id)?.name ?? <span className="text-gray-500 italic">No controls linked</span>,
    risk_profile: riskProfiles.find((profile) => profile.id === program.risk_profile_id)?.name ?? <span className="text-gray-500 italic">No risk profile linked</span>,
    execution_style: executionStyles.find((style) => style.id === program.execution_style_id)?.name ?? <span className="text-gray-500 italic">No execution style linked</span>,
    watchlist: selectedWatchlists.length > 0 ? selectedWatchlists.map((watchlist) => watchlist.name).join(', ') : <span className="text-gray-500 italic">No watchlists linked</span>,
  }

  const updateLinkedField = (
    field: 'strategy_version_id' | 'strategy_governor_id' | 'risk_profile_id' | 'execution_style_id',
    value: string,
  ) => {
    updateProgramMutation.mutate({ [field]: value || null } as Partial<TradingProgram>)
  }

  const toggleWatchlist = (watchlistId: string) => {
    const nextSubscriptions = program.watchlist_subscriptions.includes(watchlistId)
      ? program.watchlist_subscriptions.filter((id) => id !== watchlistId)
      : [...program.watchlist_subscriptions, watchlistId]

    updateProgramMutation.mutate({ watchlist_subscriptions: nextSubscriptions })
  }

  return (
    <div className="space-y-4">
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
          {locked && program.frozen_at && (
            <p className="text-xs text-gray-600 mt-0.5">
              Locked by active allocation since {new Date(program.frozen_at).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      <ProgramProgressBar program={program} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="rounded border border-gray-800 bg-gray-900/40 p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="label">Program Name</label>
                <input className="input w-full" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} disabled={locked || saveDetailsMutation.isPending} />
              </div>
              <div>
                <label className="label">Description</label>
                <input className="input w-full" value={descriptionDraft} onChange={(e) => setDescriptionDraft(e.target.value)} disabled={locked || saveDetailsMutation.isPending} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <div>
                <label className="label">Program Notes</label>
                <textarea
                  className="input w-full min-h-[104px] resize-y"
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  disabled={locked || saveDetailsMutation.isPending}
                  placeholder="Capture deployment notes, assumptions, or operator guidance."
                />
              </div>
              <div className="rounded border border-gray-800 bg-gray-950/40 p-3 space-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Mode</p>
                  <div className="mt-1">{durationBadge(program.duration_mode)}</div>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Watchlist Rule</p>
                  <p className="text-xs text-gray-300 mt-1">{program.watchlist_combination_rule || 'union'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Status</p>
                  <div className="mt-1">{statusBadge(program.status)}</div>
                </div>
              </div>
            </div>

            {saveDetailsMutation.error && <p className="text-xs text-red-400">{(saveDetailsMutation.error as Error).message}</p>}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Composition Cards</div>
            {CARDS.map((card) => (
              <GuidedCard
                key={card.id}
                card={card}
                program={program}
                expanded={expanded === card.id}
                summary={cardSummaryById[card.id]}
                valueDisplay={valueDisplayByCard[card.id]}
                onToggle={() => setExpanded(expanded === card.id ? null : card.id)}
              >
                {card.id === 'strategy' && (
                  <div className="space-y-2">
                    <label className="label">Swap Strategy</label>
                    <SelectMenu
                      value={program.strategy_version_id ?? ''}
                      onChange={(value) => updateLinkedField('strategy_version_id', value)}
                      options={strategyOptions}
                      disabled={locked || updateProgramMutation.isPending}
                    />
                  </div>
                )}

                {card.id === 'governor' && (
                  <div className="space-y-2">
                    <label className="label">Swap Strategy Controls</label>
                    <SelectMenu
                      value={program.strategy_governor_id ?? ''}
                      onChange={(value) => updateLinkedField('strategy_governor_id', value)}
                      options={controlOptions}
                      disabled={locked || updateProgramMutation.isPending}
                    />
                  </div>
                )}

                {card.id === 'risk_profile' && (
                  <div className="space-y-2">
                    <label className="label">Swap Risk Profile</label>
                    <SelectMenu
                      value={program.risk_profile_id ?? ''}
                      onChange={(value) => updateLinkedField('risk_profile_id', value)}
                      options={riskOptions}
                      disabled={locked || updateProgramMutation.isPending}
                    />
                  </div>
                )}

                {card.id === 'execution_style' && (
                  <div className="space-y-2">
                    <label className="label">Swap Execution Style</label>
                    <SelectMenu
                      value={program.execution_style_id ?? ''}
                      onChange={(value) => updateLinkedField('execution_style_id', value)}
                      options={executionOptions}
                      disabled={locked || updateProgramMutation.isPending}
                    />
                  </div>
                )}

                {card.id === 'watchlist' && (
                  <div className="space-y-3">
                    <div>
                      <label className="label">Combination Rule</label>
                      <SelectMenu
                        value={program.watchlist_combination_rule || 'union'}
                        onChange={(value) => updateProgramMutation.mutate({ watchlist_combination_rule: value })}
                        options={[
                          { value: 'union', label: 'Union — include any symbol from selected watchlists' },
                          { value: 'intersection', label: 'Intersection — only symbols shared across selected watchlists' },
                        ]}
                        disabled={locked || updateProgramMutation.isPending}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <p className="label">Select Watchlists</p>
                      {watchlists.length === 0 ? (
                        <p className="text-xs text-gray-600">No watchlists available yet.</p>
                      ) : (
                        watchlists.map((watchlist) => {
                          const checked = program.watchlist_subscriptions.includes(watchlist.id)
                          return (
                            <label
                              key={watchlist.id}
                              className={clsx(
                                'flex items-center gap-2 rounded border px-2.5 py-2 text-xs transition-colors',
                                checked ? 'border-sky-800 bg-sky-950/20 text-sky-200' : 'border-gray-800 bg-gray-900/40 text-gray-400',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={locked || updateProgramMutation.isPending}
                                onChange={() => toggleWatchlist(watchlist.id)}
                                className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-900 text-sky-500 focus:ring-sky-500"
                              />
                              <span className="flex-1 min-w-0 truncate">{watchlist.is_golden ? `★ ${watchlist.name}` : watchlist.name}</span>
                              <span className="text-[11px] text-gray-600 uppercase">{watchlist.watchlist_type}</span>
                            </label>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}

                {updateProgramMutation.error && <p className="text-xs text-red-400">{(updateProgramMutation.error as Error).message}</p>}
                {updateProgramMutation.isPending && <p className="text-xs text-sky-400">Saving component link...</p>}
              </GuidedCard>
            ))}
          </div>

          <div className="rounded border border-gray-800 bg-gray-900/40 px-4 py-2.5 flex items-center gap-2">
            <Circle size={12} className="text-gray-600" />
            <span className="text-xs text-gray-500">
              {CARDS.filter((card) => isCardReady(card, program)).length}/5 components ready - set all 5 to make this program deployable
            </span>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Account Allocations</div>
            {allocLoading ? (
              <div className="text-xs text-gray-600">Loading...</div>
            ) : allocations.length === 0 ? (
              <div className="rounded border border-gray-800 bg-gray-900/40 px-3 py-2.5 text-xs text-gray-600">
                No allocations yet. Save and validate the program, then add it from the Governor page.
              </div>
            ) : (
              allocations.map((allocation) => (
                <div key={allocation.id} className="rounded border border-gray-800 bg-gray-900/40 px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {allocationStatusBadge(allocation.status)}
                      <span className="text-xs text-gray-400 font-mono truncate">{allocation.account_id.slice(0, 12)}...</span>
                      <span className={clsx('text-xs', allocation.broker_mode === 'live' ? 'text-red-400' : 'text-indigo-400')}>
                        {allocation.broker_mode}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {allocation.status === 'paper' || allocation.status === 'promoted_to_live' ? (
                        <button
                          onClick={() => stopMutation.mutate(allocation.id)}
                          disabled={stopMutation.isPending}
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 px-2 py-1 rounded border border-gray-700 hover:border-red-800 transition-colors"
                        >
                          <Square size={10} />
                          Stop
                        </button>
                      ) : allocation.status === 'pending' || allocation.status === 'paused' ? (
                        <button
                          onClick={() => startMutation.mutate(allocation.id)}
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
                    <span>${allocation.allocated_capital_usd.toLocaleString()} allocated</span>
                    <span>{allocation.conflict_resolution.replace(/_/g, ' ')}</span>
                    {allocation.position_size_scale_pct && <span>size ×{allocation.position_size_scale_pct.toFixed(2)}</span>}
                    {allocation.session_window_shift_min !== null && allocation.session_window_shift_min !== 0 && (
                      <span>window {allocation.session_window_shift_min > 0 ? '+' : ''}{allocation.session_window_shift_min}min</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 self-start">
          <div className="rounded border border-gray-800 bg-gray-900/40 p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-200">Program Readiness Panel</p>
                <p className="text-xs text-gray-500">Validate the package before deployment.</p>
              </div>
              <span className={clsx('text-xs px-2 py-1 rounded-full', validation.can_deploy ? 'bg-emerald-950/40 text-emerald-300' : 'bg-amber-950/40 text-amber-300')}>
                {validation.can_deploy ? 'Deployable' : 'Needs work'}
              </span>
            </div>

            <div className="space-y-1.5">
              {CARDS.map((card) => (
                <div key={card.id} className="flex items-center gap-2 text-xs">
                  {isCardReady(card, program) ? <CheckCircle2 size={12} className="text-sky-400" /> : <AlertTriangle size={12} className="text-amber-400" />}
                  <span className={isCardReady(card, program) ? 'text-gray-300' : 'text-gray-500'}>{card.label}</span>
                </div>
              ))}
            </div>

            {validation.missing_components.length > 0 && (
              <div className="rounded border border-amber-800/60 bg-amber-950/20 px-3 py-2">
                <p className="text-xs font-medium text-amber-300">Missing Components</p>
                <p className="text-xs text-amber-200/80 mt-1">{validation.missing_components.join(', ')}</p>
              </div>
            )}

            {validation.warnings.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Warnings</p>
                {validation.warnings.map((warning) => (
                  <div key={warning} className="rounded border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/80">
                    {warning}
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Expected Behavior</p>
              {validation.expected_behavior.map((item) => (
                <div key={item} className="text-xs text-gray-400">{item}</div>
              ))}
            </div>

            <div className="space-y-2">
              <button onClick={() => navigate(`/simulation?program_id=${program.id}`)} className="btn-ghost w-full justify-center text-xs flex items-center gap-1.5">
                <FlaskConical size={12} />
                Run In Sim Lab
              </button>
              <button onClick={() => navigate(`/backtest?program_id=${program.id}`)} className="btn-ghost w-full justify-center text-xs flex items-center gap-1.5">
                <Rocket size={12} />
                Launch Backtest
              </button>
              <button onClick={() => navigate('/deployments')} disabled={!validation.can_deploy || detailsDirty} className="btn-primary w-full text-xs flex items-center justify-center gap-1.5">
                <Play size={12} />
                Deploy In Governor
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 rounded border border-gray-800 bg-gray-950/95 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-gray-500">
          {detailsDirty ? 'You have unsaved program detail changes.' : 'Program details are saved.'}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => saveDetailsMutation.mutate()}
            disabled={locked || !detailsDirty || saveDetailsMutation.isPending || !nameDraft.trim()}
            className="btn-ghost text-xs flex items-center gap-1.5"
          >
            <Save size={12} />
            {saveDetailsMutation.isPending ? 'Saving...' : 'Save Program'}
          </button>
          <button
            onClick={() => validateMutation.mutate()}
            disabled={validateMutation.isPending || saveDetailsMutation.isPending || !nameDraft.trim()}
            className="btn-ghost text-xs flex items-center gap-1.5"
          >
            <CheckSquare size={12} />
            {validateMutation.isPending ? 'Validating...' : 'Validate Program'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProgramWorkflowAccordion() {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded border border-gray-800 bg-gray-900/30 text-xs">
      <button onClick={() => setOpen((value) => !value)} className="w-full flex items-center justify-between px-3 py-2 text-gray-400 hover:text-gray-200">
        <span className="font-medium">How to set up a Program</span>
        <ChevronRight size={13} className={open ? 'rotate-90 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-800/60 space-y-1.5">
          <p className="text-gray-400">1. Backtest a strategy version and choose one to package.</p>
          <p className="text-gray-400">2. Link Strategy Controls, Risk Profile, Execution Style, and Watchlists.</p>
          <p className="text-gray-400">3. Validate the Program until all five composition cards are complete.</p>
          <p className="text-gray-400">4. Save the Program and validate that all five components are attached.</p>
          <p className="text-gray-400">5. Save it, validate it, and deploy it. The program locks automatically while it is allocated.</p>
        </div>
      )}
    </div>
  )
}

function ProgramList({ onSelect, prefillStrategyVersionId }: { onSelect: (program: TradingProgram) => void; prefillStrategyVersionId?: string }) {
  const [showCreate, setShowCreate] = useState(false)
  const qc = useQueryClient()
  const pausePolling = usePollingGate()

  useEffect(() => {
    if (prefillStrategyVersionId) setShowCreate(true)
  }, [prefillStrategyVersionId])

  const { data: programs = [], isLoading, error } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
    refetchInterval: pausePolling ? false : 30_000,
  })

  const handleCreated = (program: TradingProgram) => {
    qc.invalidateQueries({ queryKey: ['programs'] })
    setShowCreate(false)
    onSelect(program)
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
        <CreateProgramModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
          prefillStrategyVersionId={prefillStrategyVersionId}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-gray-200 flex items-center">Programs<PageHelp page="programs" /></h1>
          <p className="text-xs text-gray-500 mt-0.5">Create a deployable trading package from reusable components.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-xs flex items-center gap-1.5">
          <Plus size={13} />
          Create Program
        </button>
      </div>

      <ProgramWorkflowAccordion />

      {error && (
        <div className="rounded border border-red-800 bg-red-950/20 px-3 py-2 text-xs text-red-400">
          {(error as Error).message}
        </div>
      )}

      {programs.length === 0 ? (
        <div className="rounded border border-gray-800 bg-gray-900/40 px-4 py-8 text-center space-y-2">
          <p className="text-sm text-gray-400">No programs yet</p>
          <p className="text-xs text-gray-600">Create your first deployable package by linking all five components.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs mt-2">
            Create First Program
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {programs.map((program) => {
            const readyCount = CARDS.filter((card) => isCardReady(card, program)).length
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
                {program.description && <p className="text-xs text-gray-500 line-clamp-1">{program.description}</p>}
                <div className="flex items-center gap-3 text-xs text-gray-600">
                  <span>{readyCount}/5 components ready</span>
                  {program.status === 'frozen' && program.frozen_at && <span>locked {new Date(program.frozen_at).toLocaleDateString()}</span>}
                  {program.created_at && <span>created {new Date(program.created_at).toLocaleDateString()}</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function TradingPrograms() {
  const [selected, setSelected] = useState<TradingProgram | null>(null)
  const [searchParams] = useSearchParams()
  const prefillStrategyVersionId = searchParams.get('strategy_version_id') ?? undefined

  const { data: liveProgram } = useQuery({
    queryKey: ['programs', selected?.id],
    queryFn: () => programsApi.get(selected!.id),
    enabled: !!selected,
  })

  const activeProgram = liveProgram ?? selected

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {activeProgram ? (
        <ProgramDetail program={activeProgram} onBack={() => setSelected(null)} />
      ) : (
        <ProgramList onSelect={setSelected} prefillStrategyVersionId={prefillStrategyVersionId} />
      )}
    </div>
  )
}

export default TradingPrograms
