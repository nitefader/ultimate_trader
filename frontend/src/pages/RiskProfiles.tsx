import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { riskProfilesApi } from '../api/riskProfiles'
import type { RiskProfileAnalysis } from '../api/riskProfiles'
import { usePollingGate } from '../hooks/usePollingGate'
import type { RiskProfile } from '../types'
import clsx from 'clsx'
import {
  Plus, RefreshCw, ChevronRight, X, Trash2, Pencil,
  ShieldCheck, Link as LinkIcon, Unlink, Crown, Copy,
  Sparkles, Loader2, Info,
} from 'lucide-react'
import { PageHelp } from '../components/PageHelp'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  manual: 'bg-gray-800 text-gray-400 ring-1 ring-gray-700',
  backtest: 'bg-sky-900/60 text-sky-300 ring-1 ring-sky-700',
  optimizer: 'bg-amber-900/60 text-amber-300 ring-1 ring-amber-700',
}

function SourceBadge({ type }: { type: string }) {
  return (
    <span className={clsx('text-xs px-1.5 py-0.5 rounded', SOURCE_COLORS[type] ?? SOURCE_COLORS.manual)}>
      {type}
    </span>
  )
}

function fmt1(v: number): string {
  return v.toFixed(1)
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`
}

// ─── Default form values ───────────────────────────────────────────────────────

const DEFAULT_FORM: Partial<RiskProfile> = {
  name: '',
  description: '',
  max_open_positions_long: 5,
  max_portfolio_heat_long: 6.0,
  max_correlated_exposure_long: 20.0,
  max_position_size_pct_long: 5.0,
  max_open_positions_short: 3,
  max_portfolio_heat_short: 4.0,
  max_correlated_exposure_short: 15.0,
  max_position_size_pct_short: 3.0,
  max_daily_loss_pct: 2.0,
  max_drawdown_lockout_pct: 5.0,
  max_leverage: 1.0,
  source_type: 'manual',
}

// ─── Validation Info Slideout ─────────────────────────────────────────────────

const VALIDATION_RULES = [
  {
    group: 'Long Side',
    color: 'text-sky-400',
    rules: [
      {
        condition: 'Positions × Size > Heat %',
        field: 'Heat %',
        level: 'warn' as const,
        explain: 'If you fill your full book, total exposure = positions × size per trade. Your heat limit should be at least that high, or you\'ll hit the ceiling before all slots are used.',
        example: '5 positions × 2% each = 10% exposure. If Heat % is only 6%, you can\'t fully deploy.',
      },
      {
        condition: 'Position Size > Heat %',
        field: 'Position Size %',
        level: 'danger' as const,
        explain: 'A single trade would immediately exceed your total heat allowance. This makes the heat limit meaningless.',
        example: 'Position Size 8%, Heat 6% — the first trade blows the limit.',
      },
      {
        condition: 'Corr. Exposure > 1.5× Heat',
        field: 'Corr. Exposure %',
        level: 'warn' as const,
        explain: 'Correlated exposure caps how much you can have in stocks that move together (e.g., two tech names). If it\'s much larger than total heat, concentrated bets can accumulate unchecked.',
        example: 'Heat 6%, Corr. Exposure 30% — a sector crash could hit 5× your daily heat.',
      },
    ],
  },
  {
    group: 'Short Side',
    color: 'text-red-400',
    rules: [
      {
        condition: 'Short Heat > Long Heat',
        field: 'Short Heat %',
        level: 'warn' as const,
        explain: 'Short positions carry theoretically unlimited downside (a stock can rise infinitely). Most risk frameworks apply tighter limits to shorts than longs.',
        example: 'Long heat 6%, Short heat 8% — shorts are less constrained than longs, which is unusual.',
      },
      {
        condition: 'Short Position Size > Short Heat',
        field: 'Short Position Size %',
        level: 'danger' as const,
        explain: 'Same as the long side — one trade exceeds the total short heat allowance.',
        example: 'Short position 5%, Short heat 4% — the first short trade maxes out the book.',
      },
    ],
  },
  {
    group: 'Account-Wide',
    color: 'text-gray-400',
    rules: [
      {
        condition: 'Drawdown < Daily Loss',
        field: 'Drawdown %',
        level: 'danger' as const,
        explain: 'If drawdown lockout is below daily loss limit, the account locks out after the very first bad day. The lockout would never give daily loss a chance to trigger first.',
        example: 'Daily loss 3%, Drawdown 2% — you lock out permanently on the first losing day.',
      },
      {
        condition: 'Drawdown < 1.5× Daily Loss',
        field: 'Drawdown %',
        level: 'warn' as const,
        explain: 'With a tight drawdown-to-daily-loss ratio, a brief rough patch locks the account before you can recover. The recommended ratio is 2–3× daily loss to allow normal variance.',
        example: 'Daily loss 2%, Drawdown 2.5% — one bad day (2%) plus a partial bad day locks you out.',
      },
      {
        condition: 'Leverage > 2×',
        field: 'Leverage ×',
        level: 'warn' as const,
        explain: 'Margin above 2:1 amplifies both gains and losses. Losses on a leveraged position can exceed your initial capital if not managed carefully.',
        example: '3× leverage on a 5% adverse move = 15% account loss.',
      },
      {
        condition: 'Leverage > 4×',
        field: 'Leverage ×',
        level: 'danger' as const,
        explain: 'Very high leverage. A single bad position can cause severe account damage. Alpaca enforces Reg T margin (2× for day trades), so effective limits may be lower than configured.',
        example: '5× leverage on a 10% gap = 50% account wipeout.',
      },
    ],
  },
]

function ValidationInfoPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="rounded border border-indigo-800/40 bg-gray-950 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Info size={12} className="text-indigo-400" />
          <span className="text-xs font-semibold text-gray-200">Validation Rules Reference</span>
        </div>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-400"><X size={13} /></button>
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed">
        These checks run live as you edit. Amber = warning, Red = conflict that should be fixed before saving.
      </p>
      {VALIDATION_RULES.map(group => (
        <div key={group.group} className="space-y-2">
          <div className={clsx('text-[10px] font-semibold uppercase tracking-wide', group.color)}>{group.group}</div>
          {group.rules.map(rule => (
            <div key={rule.condition} className="rounded border border-gray-800 bg-gray-900/40 p-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className={clsx('text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded', rule.level === 'danger' ? 'bg-red-950/60 text-red-400' : 'bg-amber-950/60 text-amber-400')}>
                  {rule.level}
                </span>
                <span className="text-xs font-medium text-gray-200">{rule.condition}</span>
                <span className="text-[10px] text-gray-600 ml-auto">on {rule.field}</span>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">{rule.explain}</p>
              <p className="text-[10px] text-gray-600 italic">e.g. {rule.example}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Profile Form ─────────────────────────────────────────────────────────────

const TONE_STYLES: Record<string, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  danger: 'text-red-400',
}

const HEALTH_STYLES: Record<string, string> = {
  good: 'border-emerald-700/50 bg-emerald-950/20 text-emerald-300',
  caution: 'border-amber-700/50 bg-amber-950/20 text-amber-300',
  risky: 'border-red-700/50 bg-red-950/20 text-red-300',
}

function ProfileForm({
  initial,
  onSave,
  onCancel,
  isPending,
  error,
}: {
  initial: Partial<RiskProfile>
  onSave: (data: Partial<RiskProfile>) => void
  onCancel: () => void
  isPending: boolean
  error?: string
}) {
  const [form, setForm] = useState<Partial<RiskProfile>>(initial)
  const [analysis, setAnalysis] = useState<RiskProfileAnalysis | null>(null)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [showInfo, setShowInfo] = useState(false)

  const analyzeMutation = useMutation({
    mutationFn: () => riskProfilesApi.analyze({
      max_open_positions_long: form.max_open_positions_long ?? 5,
      max_portfolio_heat_long: form.max_portfolio_heat_long ?? 6,
      max_correlated_exposure_long: form.max_correlated_exposure_long ?? 20,
      max_position_size_pct_long: form.max_position_size_pct_long ?? 5,
      max_open_positions_short: form.max_open_positions_short ?? 3,
      max_portfolio_heat_short: form.max_portfolio_heat_short ?? 4,
      max_correlated_exposure_short: form.max_correlated_exposure_short ?? 15,
      max_position_size_pct_short: form.max_position_size_pct_short ?? 3,
      max_daily_loss_pct: form.max_daily_loss_pct ?? 2,
      max_drawdown_lockout_pct: form.max_drawdown_lockout_pct ?? 5,
      max_leverage: form.max_leverage ?? 1,
    }),
    onSuccess: result => {
      setAnalysis(result)
      setShowAnalysis(true)
      if (result.suggested_name) setForm(f => ({ ...f, name: result.suggested_name }))
      if (result.suggested_description) setForm(f => ({ ...f, description: result.suggested_description }))
    },
  })

  // ── Inline field-level validation ────────────────────────────────────────────
  const lp = form.max_open_positions_long ?? 0
  const lh = form.max_portfolio_heat_long ?? 0
  const ls = form.max_position_size_pct_long ?? 0
  const lc = form.max_correlated_exposure_long ?? 0
  const sp = form.max_open_positions_short ?? 0
  const sh = form.max_portfolio_heat_short ?? 0
  const ss = form.max_position_size_pct_short ?? 0
  const sc = form.max_correlated_exposure_short ?? 0
  const dl = form.max_daily_loss_pct ?? 0
  const dd = form.max_drawdown_lockout_pct ?? 0
  const lev = form.max_leverage ?? 1

  const fieldHints: Partial<Record<keyof RiskProfile, { text: string; level: 'warn' | 'danger' }>> = {}

  // Long heat vs positions × size
  if (lp > 0 && ls > 0 && lh > 0 && lp * ls > lh * 1.05)
    fieldHints.max_portfolio_heat_long = { text: `${lp} positions × ${ls}% = ${(lp * ls).toFixed(1)}% exposure — heat limit may be hit with full book`, level: 'warn' }
  if (ls > 0 && lh > 0 && ls > lh)
    fieldHints.max_position_size_pct_long = { text: 'Single position exceeds total heat limit', level: 'danger' }
  if (lc > 0 && lh > 0 && lc > lh * 1.5)
    fieldHints.max_correlated_exposure_long = { text: 'Correlated exposure allows concentrated cluster risk', level: 'warn' }

  // Short heat vs positions × size
  if (sp > 0 && ss > 0 && sh > 0 && sp * ss > sh * 1.05)
    fieldHints.max_portfolio_heat_short = { text: `${sp} positions × ${ss}% = ${(sp * ss).toFixed(1)}% exposure — heat limit may be hit with full book`, level: 'warn' }
  if (ss > 0 && sh > 0 && ss > sh)
    fieldHints.max_position_size_pct_short = { text: 'Single short position exceeds total short heat limit', level: 'danger' }
  if (sc > 0 && sh > 0 && sc > sh * 1.5)
    fieldHints.max_correlated_exposure_short = { text: 'Correlated short exposure allows concentrated cluster risk', level: 'warn' }

  // Short heat > long heat (unusual)
  if (sh > 0 && lh > 0 && sh > lh)
    fieldHints.max_portfolio_heat_short = fieldHints.max_portfolio_heat_short ?? { text: 'Short heat higher than long — unusual unless intentionally asymmetric', level: 'warn' }

  // Drawdown vs daily loss
  if (dd > 0 && dl > 0 && dd < dl * 1.5)
    fieldHints.max_drawdown_lockout_pct = { text: `Lockout at ${dd}% triggers after just ${Math.floor(dd / dl)} bad day(s) — consider 2–3× daily loss (${(dl * 2.5).toFixed(1)}%)`, level: 'warn' }
  if (dd > 0 && dl > 0 && dd < dl)
    fieldHints.max_drawdown_lockout_pct = { text: 'Drawdown lockout is below daily loss limit — account would lock on first losing day', level: 'danger' }

  // Leverage
  if (lev > 4)
    fieldHints.max_leverage = { text: 'Very high leverage — amplifies losses significantly', level: 'danger' }
  else if (lev > 2)
    fieldHints.max_leverage = { text: 'Leverage above 2× is aggressive — suitable for professionals only', level: 'warn' }

  function field(key: keyof RiskProfile, label: string, type: 'text' | 'number' = 'number') {
    const hint = fieldHints[key]
    return (
      <div>
        <label className={clsx('label', hint?.level === 'danger' ? 'text-red-400' : hint?.level === 'warn' ? 'text-amber-400' : '')}>{label}</label>
        <input
          className={clsx('input w-full', hint?.level === 'danger' ? 'border-red-700/60' : hint?.level === 'warn' ? 'border-amber-700/60' : '')}
          type={type}
          step={type === 'number' ? '0.1' : undefined}
          value={(form[key] as string | number | undefined) ?? ''}
          onChange={e =>
            setForm(f => ({
              ...f,
              [key]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value,
            }))
          }
        />
        {hint && (
          <p className={clsx('text-[10px] mt-0.5 leading-tight', hint.level === 'danger' ? 'text-red-400' : 'text-amber-400')}>
            {hint.text}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Name + description row */}
      <div className="grid grid-cols-2 gap-2">
        <div>{field('name', 'Name', 'text')}</div>
        <div>
          <label className="label">Description</label>
          <input className="input w-full" type="text"
            value={form.description ?? ''}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Optional"
          />
        </div>
      </div>

      {/* Validation info toggle */}
      <div className="flex items-center justify-end -mb-1">
        <button
          type="button"
          onClick={() => setShowInfo(v => !v)}
          className={clsx(
            'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors',
            showInfo ? 'text-indigo-300 bg-indigo-950/40' : 'text-gray-600 hover:text-indigo-400'
          )}
        >
          <Info size={10} /> {showInfo ? 'Hide validation guide' : 'Validation rules'}
        </button>
      </div>
      {showInfo && <ValidationInfoPanel onClose={() => setShowInfo(false)} />}

      {/* Long + Short side by side */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-gray-800 bg-gray-900/40 p-2 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-400">Long</div>
          <div className="grid grid-cols-2 gap-2">
            {field('max_open_positions_long', 'Max Positions')}
            {field('max_portfolio_heat_long', 'Heat %')}
            {field('max_correlated_exposure_long', 'Corr. Exposure %')}
            {field('max_position_size_pct_long', 'Position Size %')}
          </div>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900/40 p-2 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-red-400">Short</div>
          <div className="grid grid-cols-2 gap-2">
            {field('max_open_positions_short', 'Max Positions')}
            {field('max_portfolio_heat_short', 'Heat %')}
            {field('max_correlated_exposure_short', 'Corr. Exposure %')}
            {field('max_position_size_pct_short', 'Position Size %')}
          </div>
        </div>
      </div>

      {/* Account-wide + source type row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-gray-800 bg-gray-900/40 p-2 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Account-Wide</div>
          <div className="grid grid-cols-3 gap-2">
            {field('max_daily_loss_pct', 'Daily Loss %')}
            {field('max_drawdown_lockout_pct', 'Drawdown %')}
            {field('max_leverage', 'Leverage ×')}
          </div>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900/40 p-2 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Source</div>
          <select className="input w-full text-xs"
            value={form.source_type ?? 'manual'}
            onChange={e => setForm(f => ({ ...f, source_type: e.target.value as RiskProfile['source_type'] }))}
          >
            <option value="manual">Manual</option>
            <option value="backtest">Backtest</option>
            <option value="optimizer">Optimizer</option>
          </select>
        </div>
      </div>

      {/* AI Advisor */}
      <div className="rounded border border-gray-800 bg-gray-900/30 p-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">AI Advisor</span>
          <button
            type="button"
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all hover:opacity-80"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)',
              color: 'var(--color-accent)',
            }}
          >
            {analyzeMutation.isPending
              ? <><Loader2 size={11} className="animate-spin" /> Analyzing…</>
              : <><Sparkles size={11} /> Analyze Profile</>}
          </button>
        </div>

        {analyzeMutation.isError && (
          <p className="text-xs text-red-400 mt-1">Analysis failed — is the AI service running?</p>
        )}

        {showAnalysis && analysis && (
          <div className="mt-2 space-y-2">
            {/* Health + summary */}
            <div className={clsx('rounded px-2 py-1.5 border text-xs font-medium flex items-center justify-between', HEALTH_STYLES[analysis.health])}>
              <span>{analysis.summary}</span>
              <span className="uppercase tracking-wide text-[10px] font-bold ml-3 shrink-0">{analysis.health}</span>
            </div>

            {/* Suggested name + description — auto-applied, shown as confirmation */}
            {(analysis.suggested_name || analysis.suggested_description) && (
              <div className="rounded border border-indigo-800/40 bg-indigo-950/20 p-2 space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-indigo-400 font-semibold flex items-center gap-1">
                  <span>✓</span> Name &amp; description updated
                </div>
                {analysis.suggested_name && (
                  <p className="text-xs text-gray-300 font-medium">{analysis.suggested_name}</p>
                )}
                {analysis.suggested_description && (
                  <p className="text-[11px] text-gray-500 leading-relaxed">{analysis.suggested_description}</p>
                )}
              </div>
            )}

            {/* Insights */}
            {analysis.insights.length > 0 && (
              <div className="space-y-1">
                {analysis.insights.map((ins, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className={clsx('font-medium shrink-0', TONE_STYLES[ins.tone] ?? 'text-gray-400')}>{ins.label}</span>
                    <span className="text-gray-400">{ins.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Suggestions */}
            {analysis.suggestions.length > 0 && (
              <div className="space-y-0.5">
                <div className="text-[10px] uppercase tracking-wide text-gray-600 font-semibold">Suggestions</div>
                {analysis.suggestions.map((s, i) => (
                  <div key={i} className="flex gap-1.5 text-xs text-gray-400">
                    <span className="text-indigo-400 shrink-0">→</span> {s}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowAnalysis(false)}
              className="text-[10px] text-gray-600 hover:text-gray-400"
            >
              dismiss
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost text-xs">Cancel</button>
        <button onClick={() => onSave(form)} disabled={!form.name?.trim() || isPending} className="btn-primary text-xs">
          {isPending ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </div>
  )
}

// ─── Create Panel (inline) ────────────────────────────────────────────────────

function CreatePanel({ onClose, onCreated }: { onClose: () => void; onCreated: (p: RiskProfile) => void }) {
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: (data: Partial<RiskProfile>) => riskProfilesApi.create(data),
    onSuccess: onCreated,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="rounded border border-indigo-800/50 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-gray-200 uppercase tracking-wide">New Risk Profile</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={14} /></button>
      </div>
      <ProfileForm
        initial={DEFAULT_FORM}
        onSave={data => mutation.mutate(data)}
        onCancel={onClose}
        isPending={mutation.isPending}
        error={error}
      />
    </div>
  )
}

// ─── Profile Detail ───────────────────────────────────────────────────────────

function ProfileDetail({ profile, onBack }: { profile: RiskProfile; onBack: () => void }) {
  const qc = useQueryClient()
  const pausePolling = usePollingGate()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editError, setEditError] = useState('')

  const { data: liveProfile = profile } = useQuery({
    queryKey: ['risk-profiles', profile.id],
    queryFn: () => riskProfilesApi.get(profile.id),
    refetchInterval: pausePolling ? false : 30_000,
    initialData: profile,
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<RiskProfile>) => riskProfilesApi.update(liveProfile.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['risk-profiles'] })
      qc.invalidateQueries({ queryKey: ['risk-profiles', liveProfile.id] })
      setEditing(false)
      setEditError('')
    },
    onError: (e: Error) => setEditError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => riskProfilesApi.delete(liveProfile.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['risk-profiles'] })
      onBack()
    },
  })

  const detachMutation = useMutation({
    mutationFn: (accountId: string) => riskProfilesApi.detachFromAccount(accountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['risk-profiles'] })
      qc.invalidateQueries({ queryKey: ['risk-profiles', liveProfile.id] })
    },
  })

  const p = liveProfile

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-300 mt-0.5">
          <ChevronRight size={14} className="rotate-180" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-200">{p.name}</span>
            <SourceBadge type={p.source_type} />
          </div>
          {p.description && (
            <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
          )}
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-600">
            <span>{p.linked_accounts.length} linked account{p.linked_accounts.length !== 1 ? 's' : ''}</span>
            <span>Max leverage {p.max_leverage}×</span>
            <span>Updated {new Date(p.updated_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {p.is_golden && <span title="Golden template — read-only"><Crown size={13} className="text-amber-400" /></span>}
          {!editing && !p.is_golden && (
            <button
              onClick={() => setEditing(true)}
              className="text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-gray-800/50"
            >
              <Pencil size={13} />
            </button>
          )}
          {!p.is_golden && !confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-gray-600 hover:text-red-400 p-1 rounded hover:bg-red-950/30"
            >
              <Trash2 size={13} />
            </button>
          ) : !p.is_golden ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="text-xs text-red-400 px-2 py-0.5 rounded bg-red-950/40 hover:bg-red-900/50"
              >
                {deleteMutation.isPending ? '...' : 'Delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="rounded border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Edit Profile</div>
          <ProfileForm
            initial={p}
            onSave={data => updateMutation.mutate(data)}
            onCancel={() => { setEditing(false); setEditError('') }}
            isPending={updateMutation.isPending}
            error={editError}
          />
        </div>
      ) : (
        <>
          {/* Long / Short side-by-side */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-sky-400">Long Limits</div>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-gray-800/60">
                  {[
                    ['Max Open Positions', p.max_open_positions_long],
                    ['Max Portfolio Heat', fmtPct(p.max_portfolio_heat_long)],
                    ['Max Corr. Exposure', fmtPct(p.max_correlated_exposure_long)],
                    ['Max Position Size', fmtPct(p.max_position_size_pct_long)],
                  ].map(([label, val]) => (
                    <tr key={label as string}>
                      <td className="py-1 text-gray-500 pr-3">{label}</td>
                      <td className="py-1 text-gray-200 text-right font-mono">{val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-red-400">Short Limits</div>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-gray-800/60">
                  {[
                    ['Max Open Positions', p.max_open_positions_short],
                    ['Max Portfolio Heat', fmtPct(p.max_portfolio_heat_short)],
                    ['Max Corr. Exposure', fmtPct(p.max_correlated_exposure_short)],
                    ['Max Position Size', fmtPct(p.max_position_size_pct_short)],
                  ].map(([label, val]) => (
                    <tr key={label as string}>
                      <td className="py-1 text-gray-500 pr-3">{label}</td>
                      <td className="py-1 text-gray-200 text-right font-mono">{val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Account-wide limits */}
          <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Account-Wide Limits</div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-800/60">
                {[
                  ['Max Daily Loss', fmtPct(p.max_daily_loss_pct)],
                  ['Max Drawdown Lockout', fmtPct(p.max_drawdown_lockout_pct)],
                  ['Max Leverage', `${fmt1(p.max_leverage)}×`],
                ].map(([label, val]) => (
                  <tr key={label as string}>
                    <td className="py-1.5 text-gray-500">{label}</td>
                    <td className="py-1.5 text-gray-200 text-right font-mono">{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Provenance */}
          {(p.source_run_id || p.source_optimization_id) && (
            <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-1 text-xs">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Provenance</div>
              {p.source_run_id && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Run ID</span>
                  <span className="font-mono text-gray-300">{p.source_run_id.slice(0, 12)}…</span>
                </div>
              )}
              {p.source_optimization_id && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Optimization ID</span>
                  <span className="font-mono text-gray-300">{p.source_optimization_id.slice(0, 12)}…</span>
                </div>
              )}
            </div>
          )}

          {/* Linked accounts */}
          <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <LinkIcon size={12} className="text-gray-500" />
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Linked Accounts</span>
            </div>
            {p.linked_accounts.length === 0 ? (
              <p className="text-xs text-gray-600">No accounts linked to this profile.</p>
            ) : (
              <div className="divide-y divide-gray-800/60">
                {p.linked_accounts.map(acct => (
                  <div key={acct.id} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={12} className="text-emerald-500" />
                      <span className="text-xs text-gray-200">{acct.name}</span>
                      <span className="font-mono text-[10px] text-gray-600">{acct.id.slice(0, 8)}…</span>
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm(`Detach this profile from ${acct.name}?`)) {
                          detachMutation.mutate(acct.id)
                        }
                      }}
                      disabled={detachMutation.isPending}
                      className="text-gray-600 hover:text-red-400 p-0.5 rounded hover:bg-red-950/30 flex items-center gap-1 text-xs"
                    >
                      <Unlink size={11} />
                      detach
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Profile Card ─────────────────────────────────────────────────────────────

function ProfileCard({ profile, onClick, onDelete, onDuplicate }: {
  profile: RiskProfile
  onClick: () => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  return (
    <div className={clsx(
      'rounded border px-4 py-3 transition-colors space-y-1.5',
      profile.is_golden ? 'border-amber-800/60 bg-amber-950/10 hover:border-amber-700' : 'border-gray-800 bg-gray-900/50 hover:border-gray-700 hover:bg-gray-900'
    )}>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onClick} className="flex items-center gap-2 flex-1 text-left min-w-0">
          {profile.is_golden && <Crown size={12} className="text-amber-400 flex-shrink-0" />}
          <span className="text-sm font-medium text-gray-200">{profile.name}</span>
          <SourceBadge type={profile.source_type} />
          {profile.tags?.map(tag => (
            <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{tag}</span>
          ))}
          {profile.linked_accounts.length > 0 && (
            <span className="text-xs text-emerald-400/80 border border-emerald-800/50 px-1.5 py-0.5 rounded">
              {profile.linked_accounts.length} acct{profile.linked_accounts.length !== 1 ? 's' : ''}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate() }}
            className="p-1 rounded text-gray-600 hover:text-sky-400 hover:bg-sky-950/30 transition-colors"
            title="Duplicate"
          >
            <Copy size={12} />
          </button>
          {!profile.is_golden && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-950/30 transition-colors"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>Leverage {profile.max_leverage}×</span>
        <span>Daily loss {fmtPct(profile.max_daily_loss_pct)}</span>
        <span>Drawdown lockout {fmtPct(profile.max_drawdown_lockout_pct)}</span>
        {profile.is_golden && <span className="text-amber-500/80">Golden template — read-only</span>}
        <span className="text-gray-700 ml-auto">{new Date(profile.created_at).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function RiskProfiles() {
  const pausePolling = usePollingGate()
  const [selected, setSelected] = useState<RiskProfile | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const qc = useQueryClient()

  const { data: profiles = [], isLoading, error } = useQuery({
    queryKey: ['risk-profiles'],
    queryFn: () => riskProfilesApi.list(),
    refetchInterval: pausePolling ? false : 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => riskProfilesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['risk-profiles'] }),
    onError: (e: Error) => alert(e.message),
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => riskProfilesApi.duplicate(id),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['risk-profiles'] }); setSelected(p) },
  })

  const handleCreated = (p: RiskProfile) => {
    qc.invalidateQueries({ queryKey: ['risk-profiles'] })
    setShowCreate(false)
    setSelected(p)
  }

  if (selected) {
    return (
      <div className="max-w-2xl mx-auto">
        <ProfileDetail
          profile={selected}
          onBack={() => setSelected(null)}
        />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {showCreate && (
        <CreatePanel onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-gray-200 flex items-center">Risk Profiles<PageHelp page="riskprofiles" /></h1>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary text-xs flex items-center gap-1.5"
        >
          <Plus size={13} />
          New Profile
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-gray-500 py-8 justify-center">
          <RefreshCw size={13} className="animate-spin" /> Loading...
        </div>
      )}

      {error && (
        <div className="rounded border border-red-800 bg-red-950/20 px-3 py-2 text-xs text-red-400">
          {(error as Error).message}
        </div>
      )}

      {!isLoading && profiles.length === 0 && (
        <div className="rounded border border-gray-800 bg-gray-900/40 px-4 py-8 text-center space-y-2">
          <ShieldCheck size={24} className="mx-auto text-gray-700" />
          <p className="text-sm text-gray-400">No risk profiles yet</p>
          <p className="text-xs text-gray-600">
            Risk profiles define directional and account-wide limits enforced by the Portfolio Governor.
            Create a manual profile or promote limits from a backtest result.
          </p>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs mt-2">
            Create First Profile
          </button>
        </div>
      )}

      {profiles.some(p => p.is_golden) && (
        <div className="text-xs font-semibold text-amber-600/80 uppercase tracking-wide flex items-center gap-1.5">
          <Crown size={11} /> Golden Templates
        </div>
      )}
      <div className="space-y-2">
        {profiles.filter(p => p.is_golden).map(p => (
          <ProfileCard
            key={p.id} profile={p} onClick={() => setSelected(p)}
            onDelete={() => { if (confirm(`Delete "${p.name}"?`)) deleteMutation.mutate(p.id) }}
            onDuplicate={() => duplicateMutation.mutate(p.id)}
          />
        ))}
        {profiles.some(p => p.is_golden) && profiles.some(p => !p.is_golden) && (
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide pt-1">Your Profiles</div>
        )}
        {profiles.filter(p => !p.is_golden).map(p => (
          <ProfileCard
            key={p.id} profile={p} onClick={() => setSelected(p)}
            onDelete={() => { if (confirm(`Delete "${p.name}"?`)) deleteMutation.mutate(p.id) }}
            onDuplicate={() => duplicateMutation.mutate(p.id)}
          />
        ))}
      </div>
    </div>
  )
}
