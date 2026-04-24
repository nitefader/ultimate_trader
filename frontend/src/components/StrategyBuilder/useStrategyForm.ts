import { useState, useEffect, useMemo } from 'react'
import type { StrategyConfig, DurationMode, StrategyValidationResult } from '../../types'
import { TIMEFRAMES, DRAFT_STORAGE_KEY } from './constants'

const DURATION_MODE_DEFAULTS: Record<DurationMode, Partial<StrategyConfig>> = {
  day: {
    timeframe: '5m',
  },
  swing: {
    timeframe: '1d',
  },
  position: {
    timeframe: '1d',
    exit: { max_bars: 60 },
  },
}

export const DEFAULT_CONFIG: StrategyConfig = {
  hypothesis: 'Breakouts with volume expansion in trending regimes have positive expectancy.',
  symbols: [],
  timeframe: '1d',
  duration_mode: 'swing',
  entry: {
    directions: ['long'],
    logic: 'all_of',
    conditions: [],
  },
  stop_loss: { method: 'fixed_pct', value: 2.0 },
  targets: [{ method: 'r_multiple', r: 2.0 }],
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export interface InitialFormState {
  name?: string
  description?: string
  category?: string
  config: StrategyConfig
}

export function useStrategyForm(skipDraftRestore = false, initial?: InitialFormState) {
  const [name, setName] = useState(initial?.name ?? 'My Strategy')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [category, setCategory] = useState(initial?.category ?? 'custom')
  const [durationMode, setDurationMode] = useState<DurationMode>(
    (initial?.config?.duration_mode as DurationMode | undefined) ?? 'swing'
  )
  const [config, setConfig] = useState<StrategyConfig>(initial?.config ?? DEFAULT_CONFIG)
  const [validationResult, setValidationResult] = useState<StrategyValidationResult | null>(null)
  const [draftStatus, setDraftStatus] = useState('')
  const [stopDirection, setStopDirection] = useState<'both' | 'long' | 'short'>('both')
  const [targetDirection, setTargetDirection] = useState<'both' | 'long' | 'short'>('both')

  // Restore draft on mount — skipped when an initial config is provided
  useEffect(() => {
    if (skipDraftRestore || initial) return
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { name?: string; description?: string; category?: string; config?: StrategyConfig; savedAt?: string }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync durationMode when draft is restored
  useEffect(() => {
    if (config.duration_mode && config.duration_mode !== durationMode) {
      setDurationMode(config.duration_mode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-save draft
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ name, description, category, config, savedAt: new Date().toISOString() }))
        setDraftStatus('Draft auto-saved')
      } catch {
        setDraftStatus('Draft autosave failed')
      }
    }, 1500)
    return () => window.clearTimeout(timeout)
  }, [name, description, category, config])

  const setConfigKey = <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => {
    setValidationResult(null)
    setConfig(c => ({ ...c, [key]: value }))
  }

  const handleDurationModeChange = (mode: DurationMode) => {
    setDurationMode(mode)
    setConfig(c => ({ ...c, duration_mode: mode, ...DURATION_MODE_DEFAULTS[mode] }))
  }

  const localErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    if (!name.trim()) errors.name = 'Name is required.'
    if (!config.hypothesis?.trim()) errors.hypothesis = 'Hypothesis is required.'

    if (!config.entry?.directions?.length) errors.entryDirections = 'Select at least one direction.'
    if (!config.entry?.conditions?.length && !config.entry?.short_conditions?.length) errors.entryConditions = 'Add at least one long or short entry rule.'

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
    } else if (config.targets.some(t => t.method === 'r_multiple' && !isPositiveNumber(t.r))) {
      errors.targets = 'Each r_multiple target must have an R value greater than 0.'
    }

    return errors
  }, [config, name])

  const tabErrors = useMemo(() => ({
    core: ['name', 'hypothesis'].filter(k => Boolean(localErrors[k])).length,
    signals: ['entryDirections', 'entryConditions'].filter(k => Boolean(localErrors[k])).length,
    stopTargets: ['stopMethod', 'stopValue', 'stopPeriod', 'stopMult', 'targets'].filter(k => Boolean(localErrors[k])).length,
    exits: 0,
  }), [localErrors])

  const blueprintChecks = [
    { key: 'hypothesis', label: 'Hypothesis defined', ok: Boolean(config.hypothesis?.trim()) },
    { key: 'entry', label: 'Entry rules specified', ok: Boolean((config.entry?.conditions?.length ?? 0) > 0 || (config.entry?.short_conditions?.length ?? 0) > 0) },
    { key: 'exit', label: 'Exit rules specified', ok: Boolean(config.stop_loss?.method) && Boolean((config.targets?.length ?? 0) > 0) },
  ]
  const canValidate = blueprintChecks.every(c => c.ok) && Object.keys(localErrors).length === 0
  const canSave = Boolean(validationResult?.valid) && Object.keys(localErrors).length === 0

  return {
    // metadata
    name, setName,
    description, setDescription,
    category, setCategory,
    durationMode, handleDurationModeChange,
    // config
    config, setConfig, setConfigKey,
    // direction splits
    stopDirection, setStopDirection,
    targetDirection, setTargetDirection,
    // validation
    validationResult, setValidationResult,
    localErrors, tabErrors,
    blueprintChecks, canValidate, canSave,
    draftStatus,
  }
}
