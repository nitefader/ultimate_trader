import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { strategyControlsApi } from '../api/strategyGovernors'
import type { ControlsSummary } from '../api/strategyGovernors'
import { usePollingGate } from '../hooks/usePollingGate'
import type { StrategyControls } from '../types'
import clsx from 'clsx'
import {
  Plus, RefreshCw, ChevronRight, X, Trash2, Pencil, Crown, Copy, Clock,
  ChevronDown, ChevronUp, Sparkles, Loader2, Info,
} from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DURATION_MODE_COLOR: Record<string, string> = {
  day:      'bg-sky-900/60 text-sky-300 ring-1 ring-sky-700',
  swing:    'bg-emerald-900/60 text-emerald-300 ring-1 ring-emerald-700',
  position: 'bg-amber-900/60 text-amber-300 ring-1 ring-amber-700',
}

function ModeBadge({ mode }: { mode: string }) {
  return (
    <span className={clsx('text-xs px-1.5 py-0.5 rounded capitalize', DURATION_MODE_COLOR[mode] ?? DURATION_MODE_COLOR.swing)}>
      {mode}
    </span>
  )
}

// ─── Default form values ───────────────────────────────────────────────────────

const DEFAULT_FORM: Partial<StrategyControls> = {
  name: '',
  description: '',
  timeframe: '1d',
  duration_mode: 'swing',
  market_hours: {},
  pdt: {},
  gap_risk: {},
  regime_filter: { allowed: [] },
  cooldown_rules: [],
  max_trades_per_session: null as unknown as undefined,
  max_trades_per_day: null as unknown as undefined,
  min_time_between_entries_min: null as unknown as undefined,
  earnings_blackout_enabled: false,
  tags: [],
  source_type: 'manual',
}

// ─── Validation Info Panel ────────────────────────────────────────────────────

const GOVERNOR_VALIDATION_RULES = [
  {
    group: 'Session Windows',
    color: 'text-sky-400',
    rules: [
      {
        condition: 'Window overlap',
        level: 'warn' as const,
        explain: 'Overlapping entry windows mean some bars are counted twice, leading to unexpected signal duplication.',
      },
      {
        condition: 'Force flat before window end',
        level: 'danger' as const,
        explain: 'The force-flat time fires before all entry windows close, meaning entries near end of last window can\'t complete their planned hold.',
      },
      {
        condition: 'Day trading without windows',
        level: 'warn' as const,
        explain: 'Without session windows, a day strategy fires signals all market hours including the volatile open and close.',
      },
    ],
  },
  {
    group: 'Frequency Limits',
    color: 'text-gray-400',
    rules: [
      {
        condition: 'High trade count',
        level: 'warn' as const,
        explain: 'More than 10 trades per session is unusual even for scalpers. High counts often indicate the strategy is overfit to noise.',
      },
      {
        condition: 'Very short cooldown',
        level: 'warn' as const,
        explain: 'Less than 5 minutes between entries on a day strategy risks multiple entries on the same directional move.',
      },
      {
        condition: 'Short cooldown rule',
        level: 'warn' as const,
        explain: 'A cooldown under 15 minutes may not fully prevent re-entry while the original adverse move is still in progress.',
      },
    ],
  },
  {
    group: 'PDT Rules',
    color: 'text-red-400',
    rules: [
      {
        condition: 'Exceeds PDT limit',
        level: 'danger' as const,
        explain: 'FINRA PDT rule: retail accounts under $25,000 may only make 3 day trades per rolling 5-session window. Exceeding this will trigger a margin call or account restriction.',
      },
    ],
  },
  {
    group: 'Gap Risk',
    color: 'text-amber-400',
    rules: [
      {
        condition: 'Loose gap filter',
        level: 'warn' as const,
        explain: 'A gap threshold above 5% rarely filters anything. Most meaningful gap protection comes from tighter values (1–3%).',
      },
    ],
  },
]

function GovernorValidationInfoPanel({ onClose }: { onClose: () => void }) {
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
      {GOVERNOR_VALIDATION_RULES.map(group => (
        <div key={group.group} className="space-y-2">
          <div className={clsx('text-[10px] font-semibold uppercase tracking-wide', group.color)}>{group.group}</div>
          {group.rules.map(rule => (
            <div key={rule.condition} className="rounded border border-gray-800 bg-gray-900/40 p-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className={clsx(
                  'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded',
                  rule.level === 'danger' ? 'bg-red-950/60 text-red-400' : 'bg-amber-950/60 text-amber-400'
                )}>
                  {rule.level}
                </span>
                <span className="text-xs font-medium text-gray-200">{rule.condition}</span>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">{rule.explain}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Governor Form ─────────────────────────────────────────────────────────────

function GovernorForm({
  initial,
  onSave,
  onCancel,
  isPending,
  error,
}: {
  initial: Partial<StrategyControls>
  onSave: (data: Partial<StrategyControls>) => void
  onCancel: () => void
  isPending: boolean
  error?: string
}) {
  const [form, setForm] = useState<Partial<StrategyControls>>(initial)
  const [summary, setSummary] = useState<ControlsSummary | null>(null)

  const summarizeMutation = useMutation({
    mutationFn: () => strategyControlsApi.summarize(form),
    onSuccess: (result: ControlsSummary) => {
      setSummary(result)
      if (result.suggested_name) setForm(f => ({ ...f, name: result.suggested_name }))
      if (result.suggested_description) setForm(f => ({ ...f, description: result.suggested_description }))
    },
  })

  // Validation info slideout
  const [showInfo, setShowInfo] = useState(false)

  // Collapsible section toggles
  const [showRegime, setShowRegime] = useState(false)
  const [showGates, setShowGates] = useState(false)
  const [showPdt, setShowPdt] = useState(false)
  const [showGapRisk, setShowGapRisk] = useState(false)
  const [cdOpen, setCdOpen] = useState(false)

  // Entry windows helpers
  const windows: Array<{ start: string; end: string }> = (form.market_hours as any)?.entry_windows ?? []
  const setWindows = (wws: typeof windows) =>
    setForm(f => ({ ...f, market_hours: { ...(f.market_hours ?? {}), entry_windows: wws } }))

  // ── Inline field-level validation hints ──────────────────────────────────────
  const durationMode = form.duration_mode ?? 'swing'
  const forceFlatBy: string = (form.market_hours as any)?.force_flat_by ?? ''
  const maxTradesPerSession = form.max_trades_per_session ?? null
  const minMinutesBetween = form.min_time_between_entries_min ?? null
  const pdtConfig = form.pdt ?? {}
  const pdtEnforce = (pdtConfig as { enforce?: boolean }).enforce ?? false
  const pdtMaxDayTrades = (pdtConfig as { max_day_trades_per_window?: number }).max_day_trades_per_window ?? null
  const gapRiskConfig = form.gap_risk ?? {}
  const gapMaxPct = (gapRiskConfig as { max_gap_pct?: number }).max_gap_pct ?? null
  const cooldownRules = form.cooldown_rules ?? []

  // Sort windows by start time for overlap detection
  const sortedWindows = [...windows].sort((a, b) => a.start.localeCompare(b.start))
  const lastWindowEnd = sortedWindows.length > 0 ? sortedWindows[sortedWindows.length - 1].end : ''

  // Check overlap: window[i].end > window[i+1].start
  const overlappingIndices = new Set<number>()
  for (let i = 0; i < sortedWindows.length - 1; i++) {
    if (sortedWindows[i].end > sortedWindows[i + 1].start) {
      // Find original indices
      const origI = windows.findIndex(w => w.start === sortedWindows[i].start && w.end === sortedWindows[i].end)
      const origJ = windows.findIndex(w => w.start === sortedWindows[i + 1].start && w.end === sortedWindows[i + 1].end)
      if (origI >= 0) overlappingIndices.add(origI)
      if (origJ >= 0) overlappingIndices.add(origJ)
    }
  }

  const windowsOverlap = overlappingIndices.size > 0
  const forceFlatBeforeLastWindow = forceFlatBy && lastWindowEnd && forceFlatBy < lastWindowEnd
  const dayTradingNoWindows = durationMode === 'day' && windows.length === 0
  const highTradeCount = maxTradesPerSession !== null && maxTradesPerSession > 10
  const shortCooldownDay = minMinutesBetween !== null && minMinutesBetween < 5 && durationMode === 'day'
  const pdtExceeded = pdtEnforce && pdtMaxDayTrades !== null && pdtMaxDayTrades > 3
  const looseGapFilter = gapMaxPct !== null && gapMaxPct > 5

  // Per-cooldown-rule hints
  const cooldownRuleHints: Array<{ text: string; level: 'warn' | 'danger' } | null> = cooldownRules.map(rule => {
    const dur = rule.duration_minutes ?? null
    if (dur !== null && dur < 15) {
      return { text: 'Short cooldown may not prevent re-entry on the same move', level: 'warn' as const }
    }
    return null
  })

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="col-span-2">
          <label className="label">Name</label>
          <input
            className="input w-full"
            value={form.name ?? ''}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="col-span-2">
          <label className="label">Description</label>
          <textarea
            className="input w-full resize-none text-xs"
            rows={2}
            value={form.description ?? ''}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
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
      {showInfo && <GovernorValidationInfoPanel onClose={() => setShowInfo(false)} />}

      {/* Timeframe + Duration Mode */}
      <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-sky-400">Timeframe &amp; Mode</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Timeframe</label>
            <select
              className="input w-full"
              value={form.timeframe ?? '1d'}
              onChange={e => setForm(f => ({ ...f, timeframe: e.target.value }))}
            >
              {['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'].map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Duration Mode</label>
            <select
              className="input w-full"
              value={form.duration_mode ?? 'swing'}
              onChange={e => setForm(f => ({ ...f, duration_mode: e.target.value as StrategyControls['duration_mode'] }))}
            >
              <option value="day">Day</option>
              <option value="swing">Swing</option>
              <option value="position">Position</option>
            </select>
          </div>
        </div>
      </div>

      {/* Session Windows */}
      <div className={clsx('rounded border bg-gray-900/40 p-3 space-y-2', durationMode !== 'day' ? 'border-gray-700/50' : 'border-gray-800')}>
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Session Windows</div>
          {durationMode !== 'day' && (
            <span className="text-[10px] text-amber-500/70 italic">intraday only — ignored on {durationMode} charts</span>
          )}
        </div>
        <div className="space-y-2">
          {windows.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={clsx('input w-24 text-xs', overlappingIndices.has(i) ? 'border-amber-700/60' : '')}
                placeholder="HH:MM"
                value={w.start}
                onChange={e => setWindows(windows.map((ww, j) => j === i ? { ...ww, start: e.target.value } : ww))}
              />
              <span className="text-xs text-gray-500">→</span>
              <input
                className="input w-24 text-xs"
                placeholder="HH:MM"
                value={w.end}
                onChange={e => setWindows(windows.map((ww, j) => j === i ? { ...ww, end: e.target.value } : ww))}
              />
              <button
                type="button"
                onClick={() => setWindows(windows.filter((_, j) => j !== i))}
                className="text-gray-600 hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setWindows([...windows, { start: '09:30', end: '11:00' }])}
            className="btn-ghost text-xs flex items-center gap-1"
          >
            <Plus size={11} /> Add window
          </button>
          {windowsOverlap && (
            <p className="text-[10px] mt-0.5 leading-tight text-amber-400">
              Overlapping windows detected — some bars may generate duplicate signals
            </p>
          )}
          {dayTradingNoWindows && (
            <p className="text-[10px] mt-0.5 leading-tight text-amber-400">
              Day trading without session windows — will trade all hours
            </p>
          )}
          {forceFlatBeforeLastWindow && (
            <p className="text-[10px] mt-0.5 leading-tight text-red-400">
              Force flat fires before last entry window closes
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mt-2">
          <div>
            <label className={clsx('label', forceFlatBeforeLastWindow ? 'text-red-400' : '')}>Force Flat By (HH:MM)</label>
            <input
              className={clsx('input w-full', forceFlatBeforeLastWindow ? 'border-red-700/60' : '')}
              placeholder="15:45"
              value={(form.market_hours as any)?.force_flat_by ?? ''}
              onChange={e => setForm(f => ({ ...f, market_hours: { ...(f.market_hours ?? {}), force_flat_by: e.target.value } }))}
            />
          </div>
          <div>
            <label className="label">Timezone</label>
            <input
              className="input w-full"
              placeholder="America/New_York"
              value={(form.market_hours as any)?.timezone ?? ''}
              onChange={e => setForm(f => ({ ...f, market_hours: { ...(f.market_hours ?? {}), timezone: e.target.value } }))}
            />
          </div>
        </div>
        <div>
          <label className="label">Skip first N min</label>
          <input
            className="input w-32 text-xs"
            type="number"
            min={0}
            placeholder="0 = disabled"
            value={(form.market_hours as any)?.skip_first_minutes || ''}
            onChange={e => {
              const val = parseInt(e.target.value) || 0
              setForm(f => {
                const mh = { ...(f.market_hours ?? {}) } as Record<string, unknown>
                if (val > 0) { mh['skip_first_minutes'] = val } else { delete mh['skip_first_minutes'] }
                return { ...f, market_hours: mh }
              })
            }}
          />
        </div>
      </div>

      {/* Session Caps */}
      <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Session Caps</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={clsx('label', highTradeCount ? 'text-amber-400' : '')}>Max Trades / Session</label>
            <input
              className={clsx('input w-full', highTradeCount ? 'border-amber-700/60' : '')}
              type="number"
              placeholder="No limit"
              value={form.max_trades_per_session ?? ''}
              onChange={e => setForm(f => ({ ...f, max_trades_per_session: parseInt(e.target.value) || undefined }))}
            />
            {highTradeCount && (
              <p className="text-[10px] mt-0.5 leading-tight text-amber-400">
                High trade count — consider whether your strategy can actually generate this many quality signals
              </p>
            )}
          </div>
          <div>
            <label className="label">Max Trades / Day</label>
            <input
              className="input w-full"
              type="number"
              placeholder="No limit"
              value={form.max_trades_per_day ?? ''}
              onChange={e => setForm(f => ({ ...f, max_trades_per_day: parseInt(e.target.value) || undefined }))}
            />
          </div>
          <div>
            <label className={clsx('label', shortCooldownDay ? 'text-amber-400' : '')}>Min Minutes Between Entries</label>
            <input
              className={clsx('input w-full', shortCooldownDay ? 'border-amber-700/60' : '')}
              type="number"
              placeholder="No limit"
              value={form.min_time_between_entries_min ?? ''}
              onChange={e => setForm(f => ({ ...f, min_time_between_entries_min: parseInt(e.target.value) || undefined }))}
            />
            {shortCooldownDay && (
              <p className="text-[10px] mt-0.5 leading-tight text-amber-400">
                Very short cooldown for day trading — may cause overtrading
              </p>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            className="accent-sky-500"
            checked={form.earnings_blackout_enabled ?? false}
            onChange={e => setForm(f => ({ ...f, earnings_blackout_enabled: e.target.checked }))}
          />
          Earnings blackout enabled
        </label>
      </div>

      {/* Step 8: Regime Filters */}
      <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
        <button
          type="button"
          onClick={() => setShowRegime(v => !v)}
          className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-200"
        >
          <span>Regime Filters</span>
          {showRegime ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showRegime && (
          <div className="space-y-2 pt-1">
            {(
              [
                ['trending_up',    'Trending Up'],
                ['trending_down',  'Trending Down'],
                ['ranging',        'Ranging'],
                ['volatile',       'Volatile'],
                ['low_volatility', 'Low Volatility'],
              ] as [string, string][]
            ).map(([value, label]) => {
              const allowed = form.regime_filter?.allowed ?? []
              const checked = allowed.includes(value)
              return (
                <label key={value} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-sky-500"
                    checked={checked}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        regime_filter: {
                          allowed: e.target.checked
                            ? [...(f.regime_filter?.allowed ?? []), value]
                            : (f.regime_filter?.allowed ?? []).filter(r => r !== value),
                        },
                      }))
                    }
                  />
                  {label}
                </label>
              )
            })}
            <p className="text-xs text-gray-600 pt-1">
              Only fire signals when market regime matches one of these. Leave all unchecked to allow any regime.
            </p>
          </div>
        )}
      </div>

      {/* Step 9: Advanced Gates */}
      <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
        <button
          type="button"
          onClick={() => setShowGates(v => !v)}
          className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-200"
        >
          <span>Advanced Gates</span>
          {showGates ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showGates && (
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-sky-500"
                  checked={form.gap_risk?.earnings_blackout ?? form.earnings_blackout_enabled ?? false}
                  onChange={e =>
                    setForm(f => ({
                      ...f,
                      earnings_blackout_enabled: e.target.checked,
                      gap_risk: { ...(f.gap_risk ?? {}), earnings_blackout: e.target.checked },
                    }))
                  }
                />
                Block entries within N days of earnings
              </label>
              {(form.gap_risk?.earnings_blackout ?? form.earnings_blackout_enabled) && (
                <div className="ml-5">
                  <label className="label">Days before earnings to block</label>
                  <input
                    className="input w-28"
                    type="number"
                    min={1}
                    value={form.gap_risk?.earnings_blackout_days_before ?? 1}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        gap_risk: { ...(f.gap_risk ?? {}), earnings_blackout_days_before: parseInt(e.target.value) || 1 },
                      }))
                    }
                  />
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                className="accent-sky-500"
                checked={form.gap_risk?.weekend_position_allowed ?? false}
                onChange={e =>
                  setForm(f => ({
                    ...f,
                    gap_risk: { ...(f.gap_risk ?? {}), weekend_position_allowed: e.target.checked },
                  }))
                }
              />
              Allow holding positions over weekend
            </label>
          </div>
        )}
      </div>

      {/* Cooldown Rules */}
      <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
        <button
          type="button"
          className="flex items-center justify-between w-full text-xs font-semibold uppercase tracking-wide text-gray-400"
          onClick={() => setCdOpen(o => !o)}
        >
          <span>Cooldown Rules</span>
          {cdOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {cdOpen && (
          <div className="space-y-3 pt-1">
            {((form.cooldown_rules ?? []) as Array<{ trigger: string; duration_minutes?: number; duration_bars?: number; cooldown_unit?: 'minutes' | 'bars'; session_reset?: boolean; consecutive_count?: number }>).map((rule, i) => {
              // Determine unit — default to minutes for day, bars for swing/position
              const unit: 'minutes' | 'bars' = rule.cooldown_unit ?? (durationMode === 'day' ? 'minutes' : 'bars')
              const durVal = unit === 'minutes' ? (rule.duration_minutes ?? '') : (rule.duration_bars ?? '')
              const updateCd = (patch: Partial<typeof rule>) =>
                setForm(f => ({ ...f, cooldown_rules: ((f.cooldown_rules ?? []) as typeof rule[]).map((r, j) => j === i ? { ...r, ...patch } : r) as StrategyControls['cooldown_rules'] }))

              // Plain-English translation
              const tfMap: Record<string, string> = { '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes', '30m': '30 minutes', '1h': '1 hour', '4h': '4 hours', '1d': '1 day', '1w': '1 week' }
              const barLabel = tfMap[form.timeframe ?? '1d'] ?? 'bar'
              const cooldownPlain = unit === 'minutes'
                ? (durVal ? `Wait ${durVal} min` : null)
                : (durVal ? `Wait ${durVal} ${durVal === 1 ? barLabel : barLabel + 's'}` : null)

              const hint = unit === 'minutes' && typeof durVal === 'number' && durVal < 15
                ? 'Short cooldown may not prevent re-entry on the same move'
                : null

              return (
                <div key={i} className="rounded border border-gray-700/60 bg-gray-800/40 p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1">
                      <label className="label">Trigger</label>
                      <select
                        className="input w-full text-xs"
                        value={rule.trigger}
                        onChange={e => updateCd({ trigger: e.target.value })}
                      >
                        <option value="stop_hit">Stop hit</option>
                        <option value="consecutive_losses">Consecutive losses</option>
                        <option value="daily_loss_limit">Daily loss limit</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, cooldown_rules: ((f.cooldown_rules ?? []) as typeof rule[]).filter((_, j) => j !== i) as StrategyControls['cooldown_rules'] }))}
                      className="text-gray-600 hover:text-red-400 mt-4 flex-shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      {/* Unit toggle */}
                      <div className="flex items-center gap-1 mb-1">
                        <label className="label mb-0">Cooldown</label>
                        <div className="ml-auto flex rounded overflow-hidden border border-gray-700 text-[10px]">
                          {(['minutes', 'bars'] as const).map(u => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => updateCd({ cooldown_unit: u, duration_minutes: u === 'minutes' ? (rule.duration_bars ?? undefined) : undefined, duration_bars: u === 'bars' ? (rule.duration_minutes ?? undefined) : undefined })}
                              className={clsx('px-1.5 py-0.5 transition-colors', unit === u ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700')}
                            >{u}</button>
                          ))}
                        </div>
                      </div>
                      <input
                        className={clsx('input w-full text-xs', hint ? 'border-amber-700/60' : '')}
                        type="number"
                        min={0}
                        placeholder={unit === 'minutes' ? '30' : '2'}
                        value={durVal}
                        onChange={e => {
                          const v = parseInt(e.target.value) || undefined
                          updateCd(unit === 'minutes' ? { duration_minutes: v } : { duration_bars: v })
                        }}
                      />
                      {cooldownPlain && (
                        <p className="text-[10px] mt-0.5 text-indigo-400 italic">{cooldownPlain} after trigger</p>
                      )}
                      {hint && <p className="text-[10px] mt-0.5 leading-tight text-amber-400">{hint}</p>}
                    </div>
                    {rule.trigger === 'consecutive_losses' && (
                      <div>
                        <label className="label">After N losses</label>
                        <input
                          className="input w-full text-xs"
                          type="number"
                          min={1}
                          placeholder="3"
                          value={rule.consecutive_count ?? ''}
                          onChange={e => updateCd({ consecutive_count: parseInt(e.target.value) || undefined })}
                        />
                      </div>
                    )}
                  </div>
                  {/* Session reset only relevant for day trading */}
                  {durationMode === 'day' && (
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-sky-500"
                        checked={rule.session_reset ?? false}
                        onChange={e => updateCd({ session_reset: e.target.checked })}
                      />
                      Reset at session open
                    </label>
                  )}
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => {
                const defaultUnit = durationMode === 'day' ? 'minutes' : 'bars'
                const defaultRule = durationMode === 'day'
                  ? { trigger: 'stop_hit', duration_minutes: 30, cooldown_unit: 'minutes' as const, session_reset: true }
                  : { trigger: 'stop_hit', duration_bars: 2, cooldown_unit: 'bars' as const }
                setForm(f => ({ ...f, cooldown_rules: [...(f.cooldown_rules ?? []), defaultRule] as StrategyControls['cooldown_rules'] }))
                setCdOpen(true)
              }}
              className="btn-ghost text-xs flex items-center gap-1"
            >
              <Plus size={11} /> Add cooldown rule
            </button>
          </div>
        )}
      </div>

      {/* Step 10: PDT Rules */}
      <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
        <button
          type="button"
          onClick={() => setShowPdt(v => !v)}
          className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-200"
        >
          <span>PDT Rules</span>
          {showPdt ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showPdt && (
          <div className="space-y-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                className="accent-sky-500"
                checked={(form.pdt as { enforce?: boolean })?.enforce ?? false}
                onChange={e =>
                  setForm(f => ({ ...f, pdt: { ...(f.pdt ?? {}), enforce: e.target.checked } }))
                }
              />
              Enforce PDT
            </label>
            {(form.pdt as { enforce?: boolean })?.enforce && (
              <div className="space-y-2 ml-5">
                <div>
                  <label className={clsx('label', pdtExceeded ? 'text-red-400' : '')}>Max day trades per 5-session window</label>
                  <input
                    className={clsx('input w-28', pdtExceeded ? 'border-red-700/60' : '')}
                    type="number"
                    min={0}
                    value={(form.pdt as { max_day_trades_per_window?: number })?.max_day_trades_per_window ?? 3}
                    onChange={e =>
                      setForm(f => ({ ...f, pdt: { ...(f.pdt ?? {}), max_day_trades_per_window: parseInt(e.target.value) || 3 } }))
                    }
                  />
                  {pdtExceeded && (
                    <p className="text-[10px] mt-0.5 leading-tight text-red-400">
                      Exceeds PDT limit of 3 day trades per 5-session window
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">Account equity threshold ($)</label>
                  <input
                    className="input w-36"
                    type="number"
                    min={0}
                    value={(form.pdt as { equity_threshold?: number })?.equity_threshold ?? 25000}
                    onChange={e =>
                      setForm(f => ({ ...f, pdt: { ...(f.pdt ?? {}), equity_threshold: parseFloat(e.target.value) || 25000 } }))
                    }
                  />
                </div>
                <div>
                  <label className="label">On limit reached</label>
                  <select
                    className="input w-full"
                    value={(form.pdt as { on_limit_reached?: string })?.on_limit_reached ?? 'pause_entries'}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        pdt: {
                          ...(f.pdt ?? {}),
                          on_limit_reached: e.target.value as 'pause_entries' | 'block_new' | 'warn_only',
                        },
                      }))
                    }
                  >
                    <option value="pause_entries">Pause new entries</option>
                    <option value="block_new">Block all new orders</option>
                    <option value="warn_only">Warn only</option>
                  </select>
                </div>
              </div>
            )}
            <p className="text-xs text-gray-600 pt-1">
              PDT rule: max 3 day trades per rolling 5-session window for accounts under $25,000.
            </p>
          </div>
        )}
      </div>

      {/* Step 11: Gap Risk */}
      <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
        <button
          type="button"
          onClick={() => setShowGapRisk(v => !v)}
          className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-200"
        >
          <span>Gap Risk</span>
          {showGapRisk ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showGapRisk && (
          <div className="space-y-2 pt-1">
            <div>
              <label className={clsx('label', looseGapFilter ? 'text-amber-400' : '')}>Max gap % to enter</label>
              <input
                className={clsx('input w-36', looseGapFilter ? 'border-amber-700/60' : '')}
                type="number"
                min={0}
                step={0.5}
                placeholder="No limit"
                value={(form.gap_risk as { max_gap_pct?: number })?.max_gap_pct ?? ''}
                onChange={e =>
                  setForm(f => ({
                    ...f,
                    gap_risk: {
                      ...(f.gap_risk ?? {}),
                      max_gap_pct: e.target.value === '' ? undefined : parseFloat(e.target.value),
                    },
                  }))
                }
              />
              {looseGapFilter && (
                <p className="text-[10px] mt-0.5 leading-tight text-amber-400">
                  Gap filter &gt;5% rarely triggers — consider a tighter threshold
                </p>
              )}
            </div>
            <p className="text-xs text-gray-600">
              Prevents entering after large overnight gaps. E.g. 2.0 = skip entry if stock gapped &gt;2% at open.
            </p>
          </div>
        )}
      </div>

      {/* AI Summarize */}
      <div className="rounded border border-gray-800 bg-gray-900/30 p-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">AI Advisor</span>
          <button
            type="button"
            onClick={() => summarizeMutation.mutate()}
            disabled={summarizeMutation.isPending}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all hover:opacity-80"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)',
              color: 'var(--color-accent)',
            }}
          >
            {summarizeMutation.isPending
              ? <><Loader2 size={11} className="animate-spin" /> Analyzing…</>
              : <><Sparkles size={11} /> Summarize Controls</>}
          </button>
        </div>

        {summarizeMutation.isError && (
          <p className="text-xs text-red-400 mt-1">Analysis failed — is the AI service running?</p>
        )}

        {summary && (
          <div className="mt-2 space-y-2">
            {(summary.suggested_name || summary.suggested_description) && (
              <div className="rounded border border-indigo-800/40 bg-indigo-950/20 p-2 space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-indigo-400 font-semibold flex items-center gap-1">
                  <span>✓</span> Name &amp; description updated
                </div>
                {summary.suggested_name && (
                  <p className="text-xs text-gray-300 font-medium">{summary.suggested_name}</p>
                )}
                {summary.suggested_description && (
                  <p className="text-[11px] text-gray-500 leading-relaxed">{summary.suggested_description}</p>
                )}
              </div>
            )}
            {summary.summary && (
              <p className="text-xs text-gray-400 leading-relaxed">{summary.summary}</p>
            )}
            {summary.compatibility && (
              <div className="flex items-center gap-2 flex-wrap">
                {(
                  [
                    ['Day Trading', summary.compatibility.day_trading],
                    ['Swing', summary.compatibility.swing_trading],
                    ['Position', summary.compatibility.position_trading],
                  ] as [string, boolean][]
                ).map(([label, ok]) => (
                  <span
                    key={label}
                    className={clsx(
                      'text-[10px] px-1.5 py-0.5 rounded font-medium',
                      ok
                        ? 'bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-700'
                        : 'bg-gray-800/60 text-gray-500 ring-1 ring-gray-700',
                    )}
                  >
                    {label} {ok ? '✓' : '✗'}
                  </span>
                ))}
              </div>
            )}
            {summary.warnings.length > 0 && (
              <div className="space-y-0.5">
                <div className="text-[10px] uppercase tracking-wide text-gray-600 font-semibold">Warnings</div>
                {summary.warnings.map((w, i) => (
                  <div key={i} className="flex gap-1.5 text-xs text-amber-400">
                    <span className="shrink-0">⚠</span> {w}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => { summarizeMutation.reset(); setSummary(null) }}
              className="text-[10px] text-gray-600 hover:text-gray-400"
            >
              dismiss
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost">Cancel</button>
        <button
          onClick={() => onSave(form)}
          disabled={!form.name?.trim() || isPending}
          className="btn-primary"
        >
          {isPending ? 'Saving...' : 'Save Controls'}
        </button>
      </div>
    </div>
  )
}

// ─── Create Panel ─────────────────────────────────────────────────────────────

function CreatePanel({ onClose, onCreated }: { onClose: () => void; onCreated: (g: StrategyControls) => void }) {
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (data: Partial<StrategyControls>) => strategyControlsApi.create(data),
    onSuccess: onCreated,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="rounded border border-indigo-800/50 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200">New Strategy Controls</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={14} /></button>
      </div>
      <GovernorForm
        initial={DEFAULT_FORM}
        onSave={data => mutation.mutate(data)}
        onCancel={onClose}
        isPending={mutation.isPending}
        error={error}
      />
    </div>
  )
}

// ─── Governor Detail ──────────────────────────────────────────────────────────

function GovernorDetail({ governor, onBack }: { governor: StrategyControls; onBack: () => void }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editError, setEditError] = useState('')

  const updateMutation = useMutation({
    mutationFn: (data: Partial<StrategyControls>) => strategyControlsApi.update(governor.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strategy-controls'] })
      setEditing(false)
      setEditError('')
    },
    onError: (e: Error) => setEditError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => strategyControlsApi.delete(governor.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['strategy-controls'] }); onBack() },
  })

  const g = governor
  const mh = (g.market_hours ?? {}) as any
  const windows: Array<{ start: string; end: string }> = mh.entry_windows ?? []
  const skipFirstMinutes: number = mh.skip_first_minutes ?? 0
  const detailCooldownRules: Array<{ trigger: string; duration_minutes?: number; session_reset?: boolean }> =
    (g.cooldown_rules as Array<{ trigger: string; duration_minutes?: number; session_reset?: boolean }>) ?? []
  const DETAIL_TRIGGER_LABELS: Record<string, string> = { stop_hit: 'Stop hit', consecutive_losses: 'Consecutive losses', daily_loss_limit: 'Daily loss limit' }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-300 mt-0.5">
          <ChevronRight size={14} className="rotate-180" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-200">{g.name}</span>
            <ModeBadge mode={g.duration_mode} />
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">{g.timeframe}</span>
          </div>
          {g.description && <p className="text-xs text-gray-500 mt-0.5">{g.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {g.is_golden && <span title="Golden template — read-only"><Crown size={13} className="text-amber-400" /></span>}
          {!editing && !g.is_golden && (
            <button onClick={() => setEditing(true)} className="text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-gray-800/50">
              <Pencil size={13} />
            </button>
          )}
          {!g.is_golden && !confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="text-gray-600 hover:text-red-400 p-1 rounded hover:bg-red-950/30">
              <Trash2 size={13} />
            </button>
          ) : !g.is_golden ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="text-xs text-red-400 px-2 py-0.5 rounded bg-red-950/40 hover:bg-red-900/50"
              >
                {deleteMutation.isPending ? '...' : 'Delete'}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
            </div>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="rounded border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Edit Strategy Controls</div>
          <GovernorForm
            initial={g}
            onSave={data => updateMutation.mutate(data)}
            onCancel={() => { setEditing(false); setEditError('') }}
            isPending={updateMutation.isPending}
            error={editError}
          />
        </div>
      ) : (
        <>
          <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-400">Session Windows</div>
            {windows.length === 0 ? (
              <p className="text-xs text-gray-600">No entry windows — signals allowed all session.</p>
            ) : (
              <div className="space-y-1">
                {windows.map((w, i) => (
                  <div key={i} className="text-xs font-mono text-gray-300">{w.start} → {w.end}</div>
                ))}
                {mh.force_flat_by && (
                  <div className="text-xs text-amber-400 mt-1">Force flat by {mh.force_flat_by} ({mh.timezone ?? 'America/New_York'})</div>
                )}
                {skipFirstMinutes > 0 && (
                  <div className="text-xs text-gray-400 mt-1">Skip first {skipFirstMinutes} min</div>
                )}
              </div>
            )}
          </div>

          {detailCooldownRules.length > 0 && (
            <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Cooldown Rules</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-600">
                    <th className="text-left pb-1 font-medium">Trigger</th>
                    <th className="text-right pb-1 font-medium">Duration</th>
                    <th className="text-right pb-1 font-medium">Resets</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {detailCooldownRules.map((rule, i) => (
                    <tr key={i}>
                      <td className="py-1.5 text-gray-400">{DETAIL_TRIGGER_LABELS[rule.trigger] ?? rule.trigger}</td>
                      <td className="py-1.5 text-gray-200 text-right font-mono">
                        {rule.duration_minutes != null ? `${rule.duration_minutes} min` : '—'}
                      </td>
                      <td className="py-1.5 text-gray-200 text-right">{rule.session_reset ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Session Caps</div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-800/60">
                {[
                  ['Max Trades / Session', g.max_trades_per_session ?? '—'],
                  ['Max Trades / Day', g.max_trades_per_day ?? '—'],
                  ['Min Minutes Between Entries', g.min_time_between_entries_min ?? '—'],
                  ['Earnings Blackout', g.earnings_blackout_enabled ? 'Yes' : 'No'],
                ].map(([label, val]) => (
                  <tr key={label as string}>
                    <td className="py-1.5 text-gray-500">{label}</td>
                    <td className="py-1.5 text-gray-200 text-right font-mono">{val as React.ReactNode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Regime Filter */}
          {(() => {
            const regimeFilter = g.regime_filter as { allowed?: string[] } | undefined
            const allowed = regimeFilter?.allowed ?? []
            const regimeLabels: Record<string, string> = {
              trending_up: 'Trending Up',
              trending_down: 'Trending Down',
              ranging: 'Ranging',
              volatile: 'Volatile',
              low_volatility: 'Low Volatility',
            }
            return (
              <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-sky-400 mb-2">Regime Filter</div>
                {allowed.length === 0 ? (
                  <span className="text-xs text-gray-500">Any regime</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {allowed.map(r => (
                      <span key={r} className="text-xs px-2 py-0.5 rounded-full bg-sky-900/40 text-sky-300 ring-1 ring-sky-800">
                        {regimeLabels[r] ?? r}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Advanced Gates */}
          {(() => {
            const gExt = g as unknown as Record<string, unknown>
            const hasEarningsConfig = g.earnings_blackout_enabled != null
            const hasWeekendHold = gExt.no_weekend_hold != null
            if (!hasEarningsConfig && !hasWeekendHold) return null
            const noWeekendHold = gExt.no_weekend_hold as boolean | undefined
            const earningsBlackoutDays = gExt.earnings_blackout_days_before as number | undefined
            return (
              <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Advanced Gates</div>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-gray-800/60">
                    {hasEarningsConfig && (
                      <tr>
                        <td className="py-1.5 text-gray-500">Earnings blackout</td>
                        <td className="py-1.5 text-gray-200 text-right font-mono">
                          {g.earnings_blackout_enabled
                            ? `Yes${earningsBlackoutDays != null ? ` (${earningsBlackoutDays}d before)` : ''}`
                            : 'No'}
                        </td>
                      </tr>
                    )}
                    {hasWeekendHold && (
                      <tr>
                        <td className="py-1.5 text-gray-500">Weekend hold</td>
                        <td className="py-1.5 text-gray-200 text-right font-mono">{noWeekendHold ? 'No' : 'Yes'}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )
          })()}

          {/* PDT Rules */}
          {(() => {
            const pdt = g.pdt as { enforce?: boolean; max_day_trades?: number; equity_threshold?: number; on_limit?: string } | undefined
            if (!pdt?.enforce) return null
            return (
              <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-400 mb-2">PDT Rules</div>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-gray-800/60">
                    {([
                      ['Enforce', pdt.enforce ? 'Yes' : 'No'],
                      ['Max day trades', String(pdt.max_day_trades ?? '—')],
                      ['Equity threshold', pdt.equity_threshold != null ? `$${pdt.equity_threshold.toLocaleString()}` : '—'],
                      ['On limit', pdt.on_limit ?? '—'],
                    ] as [string, string][]).map(([label, val]) => (
                      <tr key={label}>
                        <td className="py-1.5 text-gray-500">{label}</td>
                        <td className="py-1.5 text-gray-200 text-right font-mono">{val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}

          {/* Gap Risk */}
          {(() => {
            const gapRisk = g.gap_risk as { max_gap_pct?: number } | undefined
            if (gapRisk?.max_gap_pct == null) return null
            return (
              <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Gap Risk</div>
                <p className="text-xs text-gray-300">Max gap to enter: {gapRisk.max_gap_pct}%</p>
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}

// ─── Governor Card ─────────────────────────────────────────────────────────────

function GovernorCard({ governor, onClick, onDelete, onDuplicate }: {
  governor: StrategyControls
  onClick: () => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const mh = (governor.market_hours ?? {}) as any
  const windows: Array<{ start: string; end: string }> = mh.entry_windows ?? []
  const cooldownRules = (governor.cooldown_rules ?? []) as Array<unknown>
  const regimeFilter = governor.regime_filter as { allowed?: string[] } | undefined
  const regimeAllowed = regimeFilter?.allowed ?? []
  const pdt = governor.pdt as { enforce?: boolean } | undefined

  return (
    <div className={clsx(
      'rounded border px-4 py-3 transition-colors space-y-1.5',
      governor.is_golden ? 'border-amber-800/60 bg-amber-950/10 hover:border-amber-700' : 'border-gray-800 bg-gray-900/50 hover:border-gray-700 hover:bg-gray-900'
    )}>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onClick} className="flex items-center gap-2 flex-1 text-left min-w-0">
          {governor.is_golden && <Crown size={12} className="text-amber-400 flex-shrink-0" />}
          <span className="text-sm font-medium text-gray-200">{governor.name}</span>
          <ModeBadge mode={governor.duration_mode} />
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">{governor.timeframe}</span>
          {governor.tags?.map(tag => (
            <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{tag}</span>
          ))}
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate() }}
            className="p-1 rounded text-gray-600 hover:text-sky-400 hover:bg-sky-950/30 transition-colors"
            title="Duplicate"
          >
            <Copy size={12} />
          </button>
          {!governor.is_golden && (
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
      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
        {windows.length > 0
          ? <span>{windows.length} entry window{windows.length !== 1 ? 's' : ''}</span>
          : <span>All-session</span>
        }
        {mh.force_flat_by && <span>Flat by {mh.force_flat_by}</span>}
        {governor.max_trades_per_session && <span>Max {governor.max_trades_per_session} trades/session</span>}
        {governor.max_trades_per_day && <span>Max {governor.max_trades_per_day}/day</span>}
        {cooldownRules.length > 0 && <span>Cooldown on</span>}
        {regimeAllowed.length > 0 && <span>{regimeAllowed.length} regime{regimeAllowed.length !== 1 ? 's' : ''}</span>}
        {pdt?.enforce && <span>PDT enforced</span>}
        {governor.is_golden && <span className="text-amber-500/80">Golden template — read-only</span>}
        <span className="text-gray-700 ml-auto">{governor.created_at ? new Date(governor.created_at).toLocaleDateString() : '—'}</span>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const MODE_FILTER_CHIPS: Array<{ label: string; value: string | null }> = [
  { label: 'All', value: null },
  { label: 'Intraday', value: 'day' },
  { label: 'Swing', value: 'swing' },
  { label: 'Position', value: 'position' },
]

export function StrategyControls() {
  const pausePolling = usePollingGate()
  const [selected, setSelected] = useState<StrategyControls | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [modeFilter, setModeFilter] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: governors = [], isLoading, error } = useQuery({
    queryKey: ['strategy-controls'],
    queryFn: () => strategyControlsApi.list(),
    refetchInterval: pausePolling ? false : 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => strategyControlsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['strategy-controls'] }),
    onError: (e: Error) => alert(e.message),
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => strategyControlsApi.duplicate(id),
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ['strategy-controls'] }); setSelected(g) },
  })

  const handleCreated = (g: StrategyControls) => {
    qc.invalidateQueries({ queryKey: ['strategy-controls'] })
    setShowCreate(false)
    setSelected(g)
  }

  const filteredGovernors = modeFilter
    ? governors.filter(g => g.duration_mode === modeFilter)
    : governors

  if (selected) {
    return (
      <div className="max-w-2xl mx-auto">
        <GovernorDetail governor={selected} onBack={() => setSelected(null)} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Clock size={15} className="text-sky-400" /> Strategy Controls
        </h1>
        <button onClick={() => setShowCreate(s => !s)} className="btn-primary text-xs flex items-center gap-1.5">
          <Plus size={13} /> New Strategy Controls
        </button>
      </div>

      {showCreate && (
        <CreatePanel onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}

      {/* Mode filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {MODE_FILTER_CHIPS.map(chip => (
          <button
            key={chip.label}
            type="button"
            onClick={() => setModeFilter(chip.value)}
            className={clsx(
              'text-xs px-2.5 py-1 rounded transition-colors',
              modeFilter === chip.value
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            )}
          >
            {chip.label}
          </button>
        ))}
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

      {!isLoading && governors.length === 0 && (
        <div className="rounded border border-gray-800 bg-gray-900/40 px-4 py-8 text-center space-y-2">
          <Clock size={24} className="mx-auto text-gray-700" />
          <p className="text-sm text-gray-400">No strategy controls yet</p>
          <p className="text-xs text-gray-600">
            Strategy Controls define when a strategy is allowed to act — timeframe, session windows, regime filter, cooldowns.
            One set of controls can be reused across many programs.
          </p>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs mt-2">
            Create First Strategy Controls
          </button>
        </div>
      )}

      {filteredGovernors.some(g => g.is_golden) && (
        <div className="text-xs font-semibold text-amber-600/80 uppercase tracking-wide flex items-center gap-1.5">
          <Crown size={11} /> Golden Templates
        </div>
      )}
      <div className="space-y-2">
        {filteredGovernors.filter(g => g.is_golden).map(g => (
          <GovernorCard
            key={g.id} governor={g} onClick={() => setSelected(g)}
            onDelete={() => { if (confirm(`Delete "${g.name}"?`)) deleteMutation.mutate(g.id) }}
            onDuplicate={() => duplicateMutation.mutate(g.id)}
          />
        ))}
        {filteredGovernors.some(g => g.is_golden) && filteredGovernors.some(g => !g.is_golden) && (
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide pt-1">Your Controls</div>
        )}
        {filteredGovernors.filter(g => !g.is_golden).map(g => (
          <GovernorCard
            key={g.id} governor={g} onClick={() => setSelected(g)}
            onDelete={() => { if (confirm(`Delete "${g.name}"?`)) deleteMutation.mutate(g.id) }}
            onDuplicate={() => duplicateMutation.mutate(g.id)}
          />
        ))}
      </div>
    </div>
  )
}
