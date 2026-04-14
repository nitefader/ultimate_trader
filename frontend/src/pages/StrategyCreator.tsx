import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Save, CheckCircle, AlertCircle, Plus, Trash2, Code, Clock, ShieldAlert, TrendingUp } from 'lucide-react'
import { strategiesApi } from '../api/strategies'
import { ConditionBuilder } from '../components/StrategyBuilder/ConditionBuilder'
import { TickerSearch } from '../components/TickerSearch'
import { SelectMenu } from '../components/SelectMenu'
import type { StrategyConfig, Condition, CooldownRule, ScaleLevel, DurationMode } from '../types'

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo']
const REGIMES = ['trending_up', 'trending_down', 'ranging', 'high_volatility', 'low_volatility']
const STOP_METHODS = ['fixed_pct', 'fixed_dollar', 'atr_multiple', 'prev_bar_low', 'n_bars_low', 'swing_low', 'fvg_low', 'sr_support', 'chandelier']
const TARGET_METHODS = ['r_multiple', 'fixed_pct', 'atr_multiple', 'sr_resistance', 'swing_high', 'prev_day_high']
const SIZING_METHODS = ['risk_pct', 'fixed_shares', 'fixed_dollar', 'fixed_pct_equity', 'atr_risk', 'kelly']
const COOLDOWN_TRIGGERS = ['loss', 'win', 'stop_out', 'target_hit', 'any_exit', 'consecutive_loss']
const DRAFT_STORAGE_KEY = 'strategy_creator_draft_v1'

const DURATION_MODE_DEFAULTS: Record<DurationMode, Partial<StrategyConfig>> = {
  day: {
    timeframe: '5m',
    market_hours: {
      timezone: 'America/New_York',
      entry_windows: [
        { start: '09:35', end: '11:00' },
        { start: '14:30', end: '15:30' },
      ],
      force_flat_by: '15:45',
      skip_first_bar: true,
    },
    pdt: {
      enforce: true,
      max_day_trades_per_window: 3,
      window_sessions: 5,
      equity_threshold: 25000,
      on_limit_reached: 'pause_entries',
    },
    gap_open_exit: false,
    gap_risk: undefined,
  },
  swing: {
    timeframe: '1d',
    market_hours: undefined,
    pdt: undefined,
    gap_open_exit: false,
    gap_risk: undefined,
  },
  position: {
    timeframe: '1d',
    market_hours: undefined,
    pdt: undefined,
    gap_open_exit: true,
    gap_risk: {
      max_gap_pct: 0.05,
      weekend_position_allowed: true,
      earnings_blackout: true,
      earnings_blackout_days_before: 1,
    },
    exit: { max_bars: 60 },
  },
}

const DEFAULT_CONFIG: StrategyConfig = {
  hypothesis: 'Breakouts with volume expansion in trending regimes have positive expectancy.',
  symbols: ['SPY'],
  timeframe: '1d',
  duration_mode: 'swing',
  entry: {
    directions: ['long'],
    logic: 'all_of',
    conditions: [],
  },
  stop_loss: { method: 'fixed_pct', value: 2.0 },
  targets: [{ method: 'r_multiple', r: 2.0 }],
  position_sizing: { method: 'risk_pct', risk_pct: 1.0 },
  leverage: 1.0,
  risk: {
    max_position_size_pct: 0.10,
    max_daily_loss_pct: 0.03,
    max_drawdown_lockout_pct: 0.10,
    max_open_positions: 10,
    max_portfolio_heat: 0.06,
  },
  regime_filter: { allowed: [] },
  cooldown_rules: [],
  scale_out: { levels: [{ pct: 50 }, { pct: 50 }], move_stop_to_be_after_t1: true },
}

type SectionStatus = 'error' | 'ready' | 'neutral'

function Section({
  id,
  title,
  status,
  children,
}: {
  id: string
  title: string
  status?: SectionStatus
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)

  const statusClass =
    status === 'error'
      ? 'text-red-400 border-red-700/70 bg-red-950/40'
      : status === 'ready'
        ? 'text-emerald-400 border-emerald-700/70 bg-emerald-950/30'
        : 'text-gray-400 border-gray-700 bg-gray-900/40'

  const statusText = status === 'error' ? 'Needs attention' : status === 'ready' ? 'Ready' : 'Optional'

  return (
    <div className="card" id={id}>
      <button
        className="flex items-center justify-between w-full text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
          <span className={`text-[11px] border rounded px-1.5 py-0.5 ${statusClass}`}>{statusText}</span>
        </div>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="mt-4 space-y-3">{children}</div>}
    </div>
  )
}

function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string
  children: React.ReactNode
  error?: string
  hint?: string
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      {!error && hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function toSimpleYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object') {
          return `${pad}-\n${toSimpleYaml(item, indent + 1)}`
        }
        return `${pad}- ${toSimpleYaml(item, 0)}`
      })
      .join('\n')
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
  if (entries.length === 0) return '{}'

  return entries
    .map(([k, v]) => {
      if (v !== null && typeof v === 'object') {
        return `${pad}${k}:\n${toSimpleYaml(v, indent + 1)}`
      }
      return `${pad}${k}: ${toSimpleYaml(v, 0)}`
    })
    .join('\n')
}

export function StrategyCreator() {
  const navigate = useNavigate()
  const [name, setName] = useState('My Strategy')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('custom')
  const [durationMode, setDurationMode] = useState<DurationMode>('swing')
  const [previewFormat, setPreviewFormat] = useState<'json' | 'yaml'>('json')
  const [config, setConfig] = useState<StrategyConfig>(DEFAULT_CONFIG)

  const handleDurationModeChange = (mode: DurationMode) => {
    setDurationMode(mode)
    const modeDefaults = DURATION_MODE_DEFAULTS[mode]
    setConfig(c => ({ ...c, duration_mode: mode, ...modeDefaults }))
  }
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null)
  const [draftStatus, setDraftStatus] = useState<string>('')

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId)
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Sync durationMode state when draft is restored (config.duration_mode comes from localStorage)
  useEffect(() => {
    if (config.duration_mode && config.duration_mode !== durationMode) {
      setDurationMode(config.duration_mode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // only on mount — intentionally not tracking config here

  const localErrors = useMemo(() => {
    const errors: Record<string, string> = {}

    if (!name.trim()) errors.name = 'Name is required.'
    if (!config.hypothesis?.trim()) errors.hypothesis = 'Hypothesis is required.'

    if (!config.symbols?.length || config.symbols.some((s) => !s.trim())) {
      errors.symbols = 'At least one valid symbol is required.'
    }
    if (!config.timeframe || !TIMEFRAMES.includes(config.timeframe)) {
      errors.timeframe = 'Select a supported timeframe.'
    }

    if (!config.entry?.directions?.length) {
      errors.entryDirections = 'Select at least one direction.'
    }
    if (!config.entry?.conditions?.length) {
      errors.entryConditions = 'Add at least one entry condition.'
    }

    const stopMethod = config.stop_loss?.method
    if (!stopMethod) {
      errors.stopMethod = 'Stop loss method is required.'
    } else if ((stopMethod === 'fixed_pct' || stopMethod === 'fixed_dollar') && !isPositiveNumber(config.stop_loss?.value)) {
      errors.stopValue = 'Stop value must be greater than 0.'
    } else if (stopMethod === 'atr_multiple') {
      if (!isPositiveNumber(config.stop_loss?.period)) errors.stopPeriod = 'ATR period must be greater than 0.'
      if (!isPositiveNumber(config.stop_loss?.mult)) errors.stopMult = 'ATR multiplier must be greater than 0.'
    }

    if (!config.targets?.length) {
      errors.targets = 'At least one profit target is required.'
    } else {
      const hasInvalidTarget = config.targets.some((t) => t.method === 'r_multiple' && !isPositiveNumber(t.r))
      if (hasInvalidTarget) errors.targets = 'Each r_multiple target must have an R value greater than 0.'
    }

    if (!config.position_sizing?.method) {
      errors.sizingMethod = 'Position sizing method is required.'
    }
    if (config.position_sizing?.method === 'risk_pct') {
      const riskPct = config.position_sizing?.risk_pct
      if (!(typeof riskPct === 'number' && Number.isFinite(riskPct) && riskPct > 0 && riskPct <= 100)) {
        errors.riskPct = 'Risk % per trade must be between 0 and 100.'
      }
    }
    if (!(typeof config.leverage === 'number' && Number.isFinite(config.leverage) && config.leverage >= 1)) {
      errors.leverage = 'Leverage must be at least 1.'
    }

    const maxPos = config.risk?.max_position_size_pct
    const maxDaily = config.risk?.max_daily_loss_pct
    const maxOpen = config.risk?.max_open_positions
    const maxHeat = config.risk?.max_portfolio_heat

    if (!(typeof maxPos === 'number' && Number.isFinite(maxPos) && maxPos > 0 && maxPos <= 1)) {
      errors.maxPositionSize = 'Max Position Size must be between 0% and 100%.'
    }
    if (!(typeof maxDaily === 'number' && Number.isFinite(maxDaily) && maxDaily > 0 && maxDaily <= 1)) {
      errors.maxDailyLoss = 'Max Daily Loss must be between 0% and 100%.'
    }
    if (!(typeof maxOpen === 'number' && Number.isFinite(maxOpen) && maxOpen >= 1)) {
      errors.maxOpenPositions = 'Max Open Positions must be at least 1.'
    }
    if (!(typeof maxHeat === 'number' && Number.isFinite(maxHeat) && maxHeat > 0 && maxHeat <= 1)) {
      errors.maxHeat = 'Max Portfolio Heat must be between 0% and 100%.'
    }
    if (
      typeof maxPos === 'number' &&
      Number.isFinite(maxPos) &&
      typeof maxHeat === 'number' &&
      Number.isFinite(maxHeat) &&
      maxPos > maxHeat
    ) {
      errors.riskCoherence = 'Max Position Size cannot exceed Max Portfolio Heat.'
    }

    return errors
  }, [config, name])

  const setConfigKey = <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => {
    setValidationResult(null)
    setConfig(c => ({ ...c, [key]: value }))
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        name?: string
        description?: string
        category?: string
        config?: StrategyConfig
        savedAt?: string
      }
      if (!parsed.config) return
      const restore = window.confirm('Restore your last strategy draft?')
      if (!restore) return
      setName(parsed.name ?? 'My Strategy')
      setDescription(parsed.description ?? '')
      setCategory(parsed.category ?? 'custom')
      setConfig(parsed.config)
      setDraftStatus(parsed.savedAt ? `Draft restored from ${new Date(parsed.savedAt).toLocaleString()}` : 'Draft restored')
    } catch {
      setDraftStatus('Could not restore previous draft.')
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify({
            name,
            description,
            category,
            config,
            savedAt: new Date().toISOString(),
          })
        )
        setDraftStatus('Draft auto-saved')
      } catch {
        setDraftStatus('Draft autosave failed')
      }
    }, 1500)

    return () => window.clearTimeout(timeout)
  }, [name, description, category, config])

  const validateMutation = useMutation({
    mutationFn: () => strategiesApi.validate(config),
    onSuccess: setValidationResult,
  })

  const saveMutation = useMutation({
    mutationFn: () => strategiesApi.create({ name, description, category, duration_mode: durationMode, config }),
    onSuccess: (data) => {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY)
      navigate(`/strategies/${data.id}`)
    },
  })

  const blueprintChecks = [
    { key: 'hypothesis', label: 'Hypothesis defined', ok: Boolean(config.hypothesis?.trim()) },
    { key: 'timeframe', label: 'Timeframe specified', ok: Boolean(config.timeframe) },
    { key: 'entry', label: 'Entry rules specified', ok: Boolean(config.entry?.conditions?.length) },
    {
      key: 'exit',
      label: 'Exit rules specified',
      ok: Boolean(config.stop_loss?.method) && Boolean((config.targets?.length ?? 0) > 0 || config.entry?.conditions?.length),
    },
    { key: 'sizing', label: 'Sizing specified', ok: Boolean(config.position_sizing?.method) },
    { key: 'risk', label: 'Risk limits specified', ok: Boolean(config.risk?.max_position_size_pct && config.risk?.max_daily_loss_pct && config.risk?.max_open_positions) },
  ]
  const missingBlueprint = blueprintChecks.filter(c => !c.ok).map(c => c.label)
  const canValidate = missingBlueprint.length === 0 && Object.keys(localErrors).length === 0
  const canSave = Boolean(validationResult?.valid) && Object.keys(localErrors).length === 0 && !validateMutation.isPending && !saveMutation.isPending

  const sectionErrors = useMemo(() => {
    return {
      strategyInfo: ['name', 'hypothesis'].filter((k) => Boolean(localErrors[k])).length,
      universeTimeframe: ['symbols', 'timeframe'].filter((k) => Boolean(localErrors[k])).length,
      entryRules: ['entryDirections', 'entryConditions'].filter((k) => Boolean(localErrors[k])).length,
      stopLoss: ['stopMethod', 'stopValue', 'stopPeriod', 'stopMult'].filter((k) => Boolean(localErrors[k])).length,
      profitTargets: ['targets'].filter((k) => Boolean(localErrors[k])).length,
      positionSizing: ['sizingMethod', 'riskPct', 'leverage'].filter((k) => Boolean(localErrors[k])).length,
      riskControls: ['maxPositionSize', 'maxDailyLoss', 'maxOpenPositions', 'maxHeat', 'riskCoherence'].filter((k) => Boolean(localErrors[k])).length,
      regimeFilter: 0,
      cooldownRules: 0,
    }
  }, [localErrors])

  const sectionStatus: {
    strategyInfo: SectionStatus
    universeTimeframe: SectionStatus
    entryRules: SectionStatus
    stopLoss: SectionStatus
    profitTargets: SectionStatus
    positionSizing: SectionStatus
    riskControls: SectionStatus
    regimeFilter: SectionStatus
    cooldownRules: SectionStatus
  } = {
    strategyInfo: sectionErrors.strategyInfo > 0 ? 'error' : 'ready',
    universeTimeframe: sectionErrors.universeTimeframe > 0 ? 'error' : 'ready',
    entryRules: sectionErrors.entryRules > 0 ? 'error' : 'ready',
    stopLoss: sectionErrors.stopLoss > 0 ? 'error' : 'ready',
    profitTargets: sectionErrors.profitTargets > 0 ? 'error' : 'ready',
    positionSizing: sectionErrors.positionSizing > 0 ? 'error' : 'ready',
    riskControls: sectionErrors.riskControls > 0 ? 'error' : 'ready',
    regimeFilter: 'neutral',
    cooldownRules: 'neutral',
  }

  const errorSections = [
    { id: 'strategy-info', label: 'Strategy Info', count: sectionErrors.strategyInfo },
    { id: 'universe-timeframe', label: 'Universe & Timeframe', count: sectionErrors.universeTimeframe },
    { id: 'entry-rules', label: 'Entry Rules', count: sectionErrors.entryRules },
    { id: 'stop-loss', label: 'Stop Loss', count: sectionErrors.stopLoss },
    { id: 'profit-targets', label: 'Profit Targets', count: sectionErrors.profitTargets },
    { id: 'position-sizing', label: 'Position Sizing', count: sectionErrors.positionSizing },
    { id: 'risk-controls', label: 'Risk Controls', count: sectionErrors.riskControls },
  ].filter((s) => s.count > 0)

  const handleStopMethodChange = (method: string) => {
    if (method === 'fixed_pct' || method === 'fixed_dollar') {
      const safeValue = isPositiveNumber(config.stop_loss?.value) ? config.stop_loss?.value : 2
      setConfigKey('stop_loss', { method, value: safeValue })
      return
    }
    if (method === 'atr_multiple') {
      const safePeriod = isPositiveNumber(config.stop_loss?.period) ? config.stop_loss?.period : 14
      const safeMult = isPositiveNumber(config.stop_loss?.mult) ? config.stop_loss?.mult : 2
      setConfigKey('stop_loss', { method, period: safePeriod, mult: safeMult })
      return
    }
    setConfigKey('stop_loss', { method })
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Strategy Creator</h1>
          <p className="text-xs text-gray-500 mt-0.5">Define entry/exit rules, stops, targets, and risk parameters</p>
          {draftStatus && <p className="text-xs text-sky-400 mt-1">{draftStatus}</p>}
        </div>
        <div className="flex gap-2">
          <button
            className="btn-ghost text-xs"
            onClick={() => validateMutation.mutate()}
            disabled={validateMutation.isPending || !canValidate}
          >
            Validate
          </button>
          <button
            className="btn-primary flex items-center gap-1.5"
            onClick={() => saveMutation.mutate()}
            disabled={!canSave}
          >
            <Save size={14} /> Save Strategy
          </button>
        </div>
      </div>

      {/* Validation result */}
      {validationResult && (
        <div className={`card border ${validationResult.valid ? 'border-emerald-700' : 'border-red-700'}`}>
          <div className="flex items-center gap-2 mb-2">
            {validationResult.valid ? <CheckCircle size={16} className="text-emerald-400" /> : <AlertCircle size={16} className="text-red-400" />}
            <span className="text-sm font-semibold">{validationResult.valid ? 'Valid configuration' : 'Validation failed'}</span>
          </div>
          {validationResult.errors.map((e, i) => <div key={i} className="text-xs text-red-400">✗ {e}</div>)}
          {validationResult.warnings.map((w, i) => <div key={i} className="text-xs text-amber-400">⚠ {w}</div>)}
        </div>
      )}

      {Object.keys(localErrors).length > 0 && (
        <div className="card border border-amber-700">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={16} className="text-amber-400" />
            <span className="text-sm font-semibold text-amber-300">Resolve {Object.keys(localErrors).length} field issue(s) before validate/save</span>
          </div>
          {errorSections.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {errorSections.map((section) => (
                <button
                  key={section.id}
                  className="text-xs px-2 py-1 rounded border border-amber-700/70 text-amber-200 hover:bg-amber-950/30"
                  onClick={() => scrollToSection(section.id)}
                >
                  Go to {section.label} ({section.count})
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Metadata */}
      <Section id="strategy-info" title="Strategy Info" status={sectionStatus.strategyInfo}>
        <Field label="Hypothesis (your edge)" error={localErrors.hypothesis}>
          <textarea
            className="input w-full resize-none"
            rows={2}
            value={config.hypothesis ?? ''}
            onChange={e => setConfigKey('hypothesis', e.target.value)}
            placeholder="Example: Momentum breakouts with expanding volume outperform in trending regimes."
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" error={localErrors.name}>
            <input className="input w-full" value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <Field label="Category">
            <SelectMenu
              value={category}
              onChange={setCategory}
              options={[
                { value: 'custom', label: 'Custom' },
                { value: 'momentum', label: 'Momentum' },
                { value: 'mean_reversion', label: 'Mean Reversion' },
                { value: 'breakout', label: 'Breakout' },
                { value: 'scalp', label: 'Scalp' },
              ]}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            className="input w-full resize-none"
            rows={2}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What does this strategy do?"
          />
        </Field>
      </Section>

      {/* ── Trading Mode ──────────────────────────────────────────────────────── */}
      <Section id="trading-mode" title="Trading Mode" status="neutral">
        <Field
          label="Duration Mode"
          hint="Controls hold period, PDT enforcement, overnight risk rules, and eligible timeframes."
        >
          <div className="grid grid-cols-3 gap-3 mt-1">
            {([
              { value: 'day' as DurationMode, icon: <Clock size={14} />, label: 'Day', desc: 'Intraday only — flat by close. PDT rules apply. Best on 1m–15m bars.' },
              { value: 'swing' as DurationMode, icon: <TrendingUp size={14} />, label: 'Swing', desc: 'Holds 1–10 days. Overnight risk. Daily or hourly bars.' },
              { value: 'position' as DurationMode, icon: <ShieldAlert size={14} />, label: 'Position', desc: 'Multi-week hold. Daily bars. Gap risk controls + earnings blackout.' },
            ] as const).map(({ value, icon, label, desc }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleDurationModeChange(value)}
                className={`flex flex-col items-start gap-1 p-3 rounded border text-left transition-colors ${
                  durationMode === value
                    ? 'border-sky-500 bg-sky-950/40 text-sky-200'
                    : 'border-gray-700 bg-gray-900/40 text-gray-400 hover:border-gray-500'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-sm">
                  {icon} {label}
                </div>
                <p className="text-[11px] leading-relaxed">{desc}</p>
              </button>
            ))}
          </div>
        </Field>

        {/* Day-mode: Market hours + PDT */}
        {durationMode === 'day' && (
          <div className="space-y-3 pt-2 border-t border-gray-800 mt-2">
            <p className="text-xs font-semibold text-sky-400 flex items-center gap-1.5"><Clock size={12} /> Day Trading Controls</p>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Entry Window 1 Start" hint="Format: HH:MM (ET)">
                <input
                  type="text" className="input w-full" placeholder="09:35"
                  value={config.market_hours?.entry_windows?.[0]?.start ?? '09:35'}
                  onChange={e => setConfigKey('market_hours', {
                    ...config.market_hours,
                    entry_windows: [
                      { start: e.target.value, end: config.market_hours?.entry_windows?.[0]?.end ?? '11:00' },
                      ...(config.market_hours?.entry_windows?.slice(1) ?? []),
                    ],
                  })}
                />
              </Field>
              <Field label="Entry Window 1 End">
                <input
                  type="text" className="input w-full" placeholder="11:00"
                  value={config.market_hours?.entry_windows?.[0]?.end ?? '11:00'}
                  onChange={e => setConfigKey('market_hours', {
                    ...config.market_hours,
                    entry_windows: [
                      { start: config.market_hours?.entry_windows?.[0]?.start ?? '09:35', end: e.target.value },
                      ...(config.market_hours?.entry_windows?.slice(1) ?? []),
                    ],
                  })}
                />
              </Field>
              <Field label="Entry Window 2 Start (optional)" hint="Leave blank to disable">
                <input
                  type="text" className="input w-full" placeholder="14:30"
                  value={config.market_hours?.entry_windows?.[1]?.start ?? ''}
                  onChange={e => {
                    const val = e.target.value
                    const windows = [...(config.market_hours?.entry_windows ?? [{ start: '09:35', end: '11:00' }])]
                    if (val) {
                      windows[1] = { start: val, end: windows[1]?.end ?? '15:30' }
                    } else {
                      windows.splice(1, 1)
                    }
                    setConfigKey('market_hours', { ...config.market_hours, entry_windows: windows })
                  }}
                />
              </Field>
              <Field label="Entry Window 2 End">
                <input
                  type="text" className="input w-full" placeholder="15:30"
                  value={config.market_hours?.entry_windows?.[1]?.end ?? ''}
                  onChange={e => {
                    const windows = [...(config.market_hours?.entry_windows ?? [{ start: '09:35', end: '11:00' }])]
                    if (windows[1]) windows[1] = { ...windows[1], end: e.target.value }
                    setConfigKey('market_hours', { ...config.market_hours, entry_windows: windows })
                  }}
                />
              </Field>
              <Field label="Force Flat By (ET)" hint="Hard close — all positions exited by this time">
                <input
                  type="text" className="input w-full" placeholder="15:45"
                  value={config.market_hours?.force_flat_by ?? '15:45'}
                  onChange={e => setConfigKey('market_hours', { ...config.market_hours, force_flat_by: e.target.value })}
                />
              </Field>
              <Field label="Timezone">
                <input
                  type="text" className="input w-full" placeholder="America/New_York"
                  value={config.market_hours?.timezone ?? 'America/New_York'}
                  onChange={e => setConfigKey('market_hours', { ...config.market_hours, timezone: e.target.value })}
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox" className="accent-sky-500"
                checked={config.market_hours?.skip_first_bar ?? true}
                onChange={e => setConfigKey('market_hours', { ...config.market_hours, skip_first_bar: e.target.checked })}
              />
              Skip first bar (avoid 09:30 gap noise)
            </label>

            <div className="border-t border-gray-800 pt-3 space-y-2">
              <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5"><ShieldAlert size={12} /> PDT (Pattern Day Trader) Protection</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Enforce PDT Cap" hint="Required for margin accounts &lt; $25k">
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer mt-1">
                    <input
                      type="checkbox" className="accent-sky-500"
                      checked={config.pdt?.enforce ?? true}
                      onChange={e => setConfigKey('pdt', { ...config.pdt, enforce: e.target.checked })}
                    />
                    Enable PDT enforcement
                  </label>
                </Field>
                <Field label="Max Day Trades / Window" hint="FINRA limit: 3 per 5 sessions">
                  <input
                    type="number" className="input w-full"
                    value={config.pdt?.max_day_trades_per_window ?? 3}
                    onChange={e => setConfigKey('pdt', { ...config.pdt, max_day_trades_per_window: parseInt(e.target.value) })}
                  />
                </Field>
                <Field label="Equity Threshold ($)" hint="Accounts above this bypass PDT cap">
                  <input
                    type="number" className="input w-full"
                    value={config.pdt?.equity_threshold ?? 25000}
                    onChange={e => setConfigKey('pdt', { ...config.pdt, equity_threshold: parseInt(e.target.value) })}
                  />
                </Field>
                <Field label="On Limit Reached">
                  <SelectMenu
                    value={config.pdt?.on_limit_reached ?? 'pause_entries'}
                    onChange={v => setConfigKey('pdt', { ...config.pdt, on_limit_reached: v as any })}
                    options={[
                      { value: 'pause_entries', label: 'Pause new entries' },
                      { value: 'block_new', label: 'Block all new orders' },
                      { value: 'warn_only', label: 'Warn only (no enforcement)' },
                    ]}
                  />
                </Field>
              </div>
            </div>
          </div>
        )}

        {/* Position-mode: Gap risk + max hold */}
        {durationMode === 'position' && (
          <div className="space-y-3 pt-2 border-t border-gray-800 mt-2">
            <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5"><ShieldAlert size={12} /> Overnight & Gap Risk Controls</p>

            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox" className="accent-sky-500"
                checked={config.gap_open_exit ?? true}
                onChange={e => setConfigKey('gap_open_exit', e.target.checked)}
              />
              Gap-open exit — if next open gaps below stop, exit at open price immediately
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox" className="accent-sky-500"
                checked={config.gap_risk?.earnings_blackout ?? true}
                onChange={e => setConfigKey('gap_risk', { ...config.gap_risk, earnings_blackout: e.target.checked })}
              />
              Earnings blackout — close position EOD before earnings release
            </label>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Earnings Blackout Days Before" hint="Close position N days before earnings">
                <input
                  type="number" className="input w-full"
                  value={config.gap_risk?.earnings_blackout_days_before ?? 1}
                  onChange={e => setConfigKey('gap_risk', { ...config.gap_risk, earnings_blackout_days_before: parseInt(e.target.value) })}
                />
              </Field>
              <Field label="Max Gap % (reduce size above)" hint="e.g. 0.05 = 5% expected gap">
                <input
                  type="number" step="0.01" className="input w-full"
                  value={config.gap_risk?.max_gap_pct ?? 0.05}
                  onChange={e => setConfigKey('gap_risk', { ...config.gap_risk, max_gap_pct: parseFloat(e.target.value) })}
                />
              </Field>
              <Field label="Max Hold Bars" hint="Force exit after N daily bars (~60 bars = 3 months)">
                <input
                  type="number" className="input w-full"
                  value={config.exit?.max_bars ?? 60}
                  onChange={e => setConfigKey('exit', { max_bars: parseInt(e.target.value) })}
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox" className="accent-sky-500"
                checked={config.gap_risk?.weekend_position_allowed ?? true}
                onChange={e => setConfigKey('gap_risk', { ...config.gap_risk, weekend_position_allowed: e.target.checked })}
              />
              Allow weekend positions (normal for daily-bar strategies)
            </label>
          </div>
        )}
      </Section>

      <Section id="blueprint-checklist" title="Backtest Blueprint Checklist" status={missingBlueprint.length > 0 ? 'error' : 'ready'}>
        <div className="space-y-1">
          {blueprintChecks.map(c => (
            <div key={c.key} className="text-xs flex items-center gap-2">
              <span className={c.ok ? 'text-emerald-400' : 'text-red-400'}>{c.ok ? '✓' : '✗'}</span>
              <span className="text-gray-300">{c.label}</span>
            </div>
          ))}
        </div>
        {!canValidate && (
          <div className="text-xs text-amber-400 pt-2">
            Complete all checklist items before validation: {missingBlueprint.join(', ')}.
          </div>
        )}
      </Section>

      <Section id="config-preview" title="Config Preview" status="neutral">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">Live strategy config snapshot for quick review before save.</p>
          <div className="inline-flex rounded border border-gray-700 overflow-hidden">
            <button
              className={`px-2.5 py-1 text-xs ${previewFormat === 'json' ? 'bg-sky-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-gray-200'}`}
              onClick={() => setPreviewFormat('json')}
            >
              JSON
            </button>
            <button
              className={`px-2.5 py-1 text-xs ${previewFormat === 'yaml' ? 'bg-sky-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-gray-200'}`}
              onClick={() => setPreviewFormat('yaml')}
            >
              YAML
            </button>
          </div>
        </div>
        <div className="rounded border border-gray-800 bg-gray-950/70 p-3">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <Code size={12} />
            {previewFormat === 'json' ? 'strategy-config.json' : 'strategy-config.yaml'}
          </div>
          <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words max-h-80 overflow-auto">
            {previewFormat === 'json'
              ? JSON.stringify(config, null, 2)
              : toSimpleYaml(config)}
          </pre>
        </div>
      </Section>

      {/* Universe & timeframe */}
      <Section id="universe-timeframe" title="Universe & Timeframe" status={sectionStatus.universeTimeframe}>
        <Field label="Symbols" error={localErrors.symbols}>
          <TickerSearch
            selected={config.symbols ?? []}
            onChange={syms => setConfigKey('symbols', syms)}
            placeholder="Search ticker — SPY, AAPL, TSLA..."
          />
        </Field>
        <Field label="Timeframe" error={localErrors.timeframe}>
          <SelectMenu
            value={config.timeframe ?? '1d'}
            onChange={v => setConfigKey('timeframe', v)}
            options={TIMEFRAMES.map(tf => ({ value: tf, label: tf }))}
          />
        </Field>
      </Section>

      {/* Entry rules */}
      <Section id="entry-rules" title="Entry Rules" status={sectionStatus.entryRules}>
        <Field label="Directions" error={localErrors.entryDirections}>
          <div className="flex gap-3">
            {['long', 'short'].map(dir => (
              <label key={dir} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-sky-500"
                  checked={config.entry?.directions?.includes(dir) ?? false}
                  onChange={e => {
                    const dirs = config.entry?.directions ?? []
                    setConfigKey('entry', {
                      ...config.entry,
                      directions: e.target.checked ? [...dirs, dir] : dirs.filter(d => d !== dir),
                    })
                  }}
                />
                <span className="text-sm capitalize">{dir}</span>
              </label>
            ))}
          </div>
        </Field>

        <ConditionBuilder
          conditions={config.entry?.conditions ?? []}
          onChange={(conds) => setConfigKey('entry', { ...config.entry, conditions: conds })}
          logic={config.entry?.logic ?? 'all_of'}
          onLogicChange={(logic) => setConfigKey('entry', { ...config.entry, logic })}
          label="Entry Conditions"
        />
        {localErrors.entryConditions && <p className="text-xs text-red-400 -mt-1">{localErrors.entryConditions}</p>}
      </Section>

      {/* Stop loss */}
      <Section id="stop-loss" title="Stop Loss" status={sectionStatus.stopLoss}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Method">
            <SelectMenu
              value={config.stop_loss?.method ?? 'fixed_pct'}
              onChange={v => handleStopMethodChange(v)}
              options={STOP_METHODS.map(m => ({ value: m, label: m }))}
            />
          </Field>
          {(config.stop_loss?.method === 'fixed_pct' || config.stop_loss?.method === 'fixed_dollar') && (
            <Field label="Value" error={localErrors.stopValue}>
              <input
                type="number"
                className="input w-full"
                value={config.stop_loss?.value ?? 2}
                onChange={e => setConfigKey('stop_loss', { ...config.stop_loss, value: parseFloat(e.target.value) } as any)}
              />
            </Field>
          )}
          {config.stop_loss?.method === 'atr_multiple' && (
            <>
              <Field label="ATR Period" error={localErrors.stopPeriod}>
                <input type="number" className="input w-full" value={config.stop_loss?.period ?? 14}
                  onChange={e => setConfigKey('stop_loss', { ...config.stop_loss, period: parseInt(e.target.value) } as any)}
                />
              </Field>
              <Field label="Multiplier" error={localErrors.stopMult}>
                <input type="number" step="0.1" className="input w-full" value={config.stop_loss?.mult ?? 2.0}
                  onChange={e => setConfigKey('stop_loss', { ...config.stop_loss, mult: parseFloat(e.target.value) } as any)}
                />
              </Field>
            </>
          )}
        </div>
        {localErrors.stopMethod && <p className="text-xs text-red-400">{localErrors.stopMethod}</p>}
      </Section>

      {/* Targets */}
      <Section id="profit-targets" title="Profit Targets" status={sectionStatus.profitTargets}>
        {(config.targets ?? []).map((target, i) => (
          <div key={i} className="flex items-center gap-2 bg-gray-800 rounded p-2">
            <span className="text-xs text-gray-500 w-16">Target {i + 1}</span>
            <SelectMenu
              value={target.method}
              onChange={v => {
                const targets = [...(config.targets ?? [])]
                targets[i] = { ...targets[i], method: v }
                setConfigKey('targets', targets)
              }}
              options={TARGET_METHODS.map(m => ({ value: m, label: m }))}
            />
            {target.method === 'r_multiple' && (
              <input
                type="number" step="0.5" className="input text-xs py-1 w-20"
                value={target.r ?? 2}
                onChange={e => {
                  const targets = [...(config.targets ?? [])]
                  targets[i] = { ...targets[i], r: parseFloat(e.target.value) }
                  setConfigKey('targets', targets)
                }}
              />
            )}
            <button
              className="ml-auto text-gray-500 hover:text-red-400"
              onClick={() => setConfigKey('targets', (config.targets ?? []).filter((_, idx) => idx !== i))}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          className="btn-ghost text-xs flex items-center gap-1"
          onClick={() => setConfigKey('targets', [...(config.targets ?? []), { method: 'r_multiple', r: 2.0 }])}
        >
          <Plus size={12} /> Add Target
        </button>
        {localErrors.targets && <p className="text-xs text-red-400">{localErrors.targets}</p>}
      </Section>

      {/* Position sizing */}
      <Section id="position-sizing" title="Position Sizing" status={sectionStatus.positionSizing}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Method">
            <SelectMenu
              value={config.position_sizing?.method ?? 'risk_pct'}
              onChange={v => setConfigKey('position_sizing', { ...config.position_sizing, method: v })}
              options={SIZING_METHODS.map(m => ({ value: m, label: m }))}
            />
          </Field>
          {config.position_sizing?.method === 'risk_pct' && (
            <Field label="Risk % per trade" error={localErrors.riskPct} hint="Use 1 for 1% risk per trade.">
              <input
                type="number" step="0.1" className="input w-full"
                value={config.position_sizing?.risk_pct ?? 1.0}
                onChange={e => setConfigKey('position_sizing', { ...config.position_sizing, risk_pct: parseFloat(e.target.value) } as any)}
              />
            </Field>
          )}
          <Field label="Leverage" error={localErrors.leverage} hint="Minimum is 1.">
            <input
              type="number" step="0.1" min="1" className="input w-full"
              value={config.leverage ?? 1.0}
              onChange={e => setConfigKey('leverage', parseFloat(e.target.value))}
            />
          </Field>
        </div>
      </Section>

      {/* Risk controls */}
      <Section id="risk-controls" title="Risk Controls" status={sectionStatus.riskControls}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Max Position Size %" error={localErrors.maxPositionSize}>
            <input type="number" step="0.01" className="input w-full"
              value={(config.risk?.max_position_size_pct ?? 0.10) * 100}
              onChange={e => setConfigKey('risk', { ...config.risk, max_position_size_pct: parseFloat(e.target.value) / 100 })}
            />
          </Field>
          <Field label="Max Daily Loss %" error={localErrors.maxDailyLoss}>
            <input type="number" step="0.01" className="input w-full"
              value={(config.risk?.max_daily_loss_pct ?? 0.03) * 100}
              onChange={e => setConfigKey('risk', { ...config.risk, max_daily_loss_pct: parseFloat(e.target.value) / 100 })}
            />
          </Field>
          <Field label="Max Open Positions" error={localErrors.maxOpenPositions}>
            <input type="number" className="input w-full"
              value={config.risk?.max_open_positions ?? 10}
              onChange={e => setConfigKey('risk', { ...config.risk, max_open_positions: parseInt(e.target.value) })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
          <Field label="Max Portfolio Heat %" error={localErrors.maxHeat}>
            <input
              type="number"
              step="0.01"
              className="input w-full"
              value={(config.risk?.max_portfolio_heat ?? 0.06) * 100}
              onChange={e => setConfigKey('risk', { ...config.risk, max_portfolio_heat: parseFloat(e.target.value) / 100 })}
            />
          </Field>
        </div>
        {localErrors.riskCoherence && <p className="text-xs text-red-400 mt-2">{localErrors.riskCoherence}</p>}
        {localErrors.sizingMethod && <p className="text-xs text-red-400 mt-2">{localErrors.sizingMethod}</p>}
      </Section>

      {/* Regime filter */}
      <Section id="regime-filter" title="Regime Filter" status={sectionStatus.regimeFilter}>
        <Field label="Allowed Regimes (leave empty = all)">
          <div className="flex flex-wrap gap-2">
            {REGIMES.map(r => (
              <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-sky-500"
                  checked={config.regime_filter?.allowed?.includes(r) ?? false}
                  onChange={e => {
                    const allowed = config.regime_filter?.allowed ?? []
                    setConfigKey('regime_filter', {
                      allowed: e.target.checked ? [...allowed, r] : allowed.filter(a => a !== r),
                    })
                  }}
                />
                <span className="text-sm">{r}</span>
              </label>
            ))}
          </div>
        </Field>
      </Section>

      {/* Cooldown rules */}
      <Section id="cooldown-rules" title="Cooldown Rules" status={sectionStatus.cooldownRules}>
        {(config.cooldown_rules ?? []).map((rule, i) => (
          <div key={i} className="flex items-center gap-2 bg-gray-800 rounded p-2">
            <SelectMenu
              value={rule.trigger}
              onChange={v => {
                const rules = [...(config.cooldown_rules ?? [])]
                rules[i] = { ...rules[i], trigger: v }
                setConfigKey('cooldown_rules', rules)
              }}
              options={COOLDOWN_TRIGGERS.map(t => ({ value: t, label: t }))}
            />
            <input
              type="number" className="input text-xs py-1 w-24" placeholder="Minutes"
              value={rule.duration_minutes ?? ''}
              onChange={e => {
                const rules = [...(config.cooldown_rules ?? [])]
                rules[i] = { ...rules[i], duration_minutes: parseInt(e.target.value) || undefined }
                setConfigKey('cooldown_rules', rules)
              }}
            />
            <label className="flex items-center gap-1 text-xs text-gray-400">
              <input type="checkbox" className="accent-sky-500"
                checked={rule.session_reset ?? false}
                onChange={e => {
                  const rules = [...(config.cooldown_rules ?? [])]
                  rules[i] = { ...rules[i], session_reset: e.target.checked }
                  setConfigKey('cooldown_rules', rules)
                }}
              />
              Session reset
            </label>
            <button
              className="ml-auto text-gray-500 hover:text-red-400"
              onClick={() => setConfigKey('cooldown_rules', (config.cooldown_rules ?? []).filter((_, idx) => idx !== i))}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          className="btn-ghost text-xs flex items-center gap-1"
          onClick={() => setConfigKey('cooldown_rules', [...(config.cooldown_rules ?? []), { trigger: 'stop_out', duration_minutes: 60, symbol_level: true }])}
        >
          <Plus size={12} /> Add Cooldown Rule
        </button>
      </Section>
    </div>
  )
}
