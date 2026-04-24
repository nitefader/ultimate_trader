import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { executionStylesApi } from '../api/executionStyles'
import type { StyleAnalysis } from '../api/executionStyles'
import { usePollingGate } from '../hooks/usePollingGate'
import type { ExecutionStyle } from '../types'
import clsx from 'clsx'
import {
  Plus, RefreshCw, ChevronRight, X, Trash2, Pencil, Crown, Copy, Play,
  Info, Sparkles, Loader2, ChevronDown, ChevronUp, CheckCircle2,
  Zap, TrendingUp, BarChart2, Activity,
} from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BRACKET_COLOR: Record<string, string> = {
  bracket:       'bg-sky-900/60 text-sky-300 ring-1 ring-sky-700',
  oco:           'bg-purple-900/60 text-purple-300 ring-1 ring-purple-700',
  trailing_stop: 'bg-amber-900/60 text-amber-300 ring-1 ring-amber-700',
  none:          'bg-gray-800 text-gray-400 ring-1 ring-gray-700',
}

const HEALTH_COLOR: Record<string, string> = {
  clean:   'bg-emerald-900/40 text-emerald-300 ring-1 ring-emerald-700',
  caution: 'bg-amber-900/40 text-amber-300 ring-1 ring-amber-700',
  risky:   'bg-red-900/40 text-red-300 ring-1 ring-red-700',
}

function BracketBadge({ mode }: { mode: string }) {
  return (
    <span className={clsx('text-xs px-1.5 py-0.5 rounded', BRACKET_COLOR[mode] ?? BRACKET_COLOR.none)}>
      {mode.replace('_', ' ')}
    </span>
  )
}

// ─── Default form values ───────────────────────────────────────────────────────

const DEFAULT_FORM: Partial<ExecutionStyle> = {
  name: '',
  description: '',
  entry_order_type: 'market',
  entry_time_in_force: 'day',
  entry_limit_offset_method: null,
  entry_limit_offset_value: null,
  entry_cancel_after_bars: null,
  bracket_mode: 'bracket',
  stop_order_type: 'market',
  take_profit_order_type: 'limit',
  trailing_stop_type: null,
  trailing_stop_value: null,
  scale_out: [],
  stop_progression_targets: [],
  atr_source: 'strategy',
  atr_length: null,
  atr_timeframe: null,
  breakeven_trigger_level: null,
  breakeven_atr_offset: 0.0,
  final_runner_exit_mode: 'internal',
  final_runner_trail_type: null,
  final_runner_trail_value: null,
  final_runner_time_in_force: null,
  fill_model: 'next_open',
  slippage_bps_assumption: 5.0,
  commission_per_share: 0.005,
  tags: [],
  source_type: 'manual',
}

// ─── Template quick-starts ────────────────────────────────────────────────────

const TEMPLATES: { label: string; icon: React.ReactNode; description: string; values: Partial<ExecutionStyle> }[] = [
  {
    label: 'Market + Bracket',
    icon: <Zap size={14} className="text-sky-400" />,
    description: 'Market entry, bracket stop + TP',
    values: { entry_order_type: 'market', entry_time_in_force: 'day', bracket_mode: 'bracket', stop_order_type: 'market', take_profit_order_type: 'limit', fill_model: 'next_open' },
  },
  {
    label: 'Limit Pullback',
    icon: <TrendingUp size={14} className="text-purple-400" />,
    description: 'Limit entry with ATR offset, GTC',
    values: { entry_order_type: 'limit', entry_time_in_force: 'gtc', entry_limit_offset_method: 'atr', entry_limit_offset_value: 0.5, bracket_mode: 'bracket', stop_order_type: 'market', take_profit_order_type: 'limit', fill_model: 'next_open' },
  },
  {
    label: 'Stop-Limit Breakout',
    icon: <BarChart2 size={14} className="text-amber-400" />,
    description: 'Stop-limit entry on breakout, GTC',
    values: { entry_order_type: 'stop_limit', entry_time_in_force: 'gtc', entry_limit_offset_method: 'atr', entry_limit_offset_value: 0.25, bracket_mode: 'bracket', stop_order_type: 'market', take_profit_order_type: 'limit', fill_model: 'next_open' },
  },
  {
    label: 'Trailing Exit',
    icon: <Activity size={14} className="text-emerald-400" />,
    description: 'Market entry, trailing stop exit',
    values: { entry_order_type: 'market', entry_time_in_force: 'day', bracket_mode: 'trailing_stop', trailing_stop_type: 'percent', trailing_stop_value: 2.0, fill_model: 'next_open' },
  },
]

// ─── Validation info panel ────────────────────────────────────────────────────

const VALIDATION_RULES = [
  {
    group: 'Entry Orders',
    color: 'text-sky-400',
    rules: [
      { level: 'info' as const, condition: 'Market order', explain: 'Fills immediately at best available price. Use next_open fill model in backtests for conservative results.' },
      { level: 'warn' as const, condition: 'Limit/Stop-Limit without offset method', explain: 'Will submit at the exact signal price. Set an offset method (ATR/Pct/Fixed) for realistic limit placement.' },
      { level: 'warn' as const, condition: 'GTC + Market order', explain: 'A GTC market order may fill outside regular session hours. Prefer Day TIF for intraday strategies.' },
      { level: 'warn' as const, condition: 'IOC with bracket', explain: 'Alpaca rejects IOC + bracket at the API level (422 error). IOC is incompatible with bracket and OCO order classes.' },
      { level: 'info' as const, condition: 'OPG / CLS TIF', explain: 'OPG fills at market open auction; CLS fills at closing auction. Only valid with market or limit orders on primary exchange. Stop and stop-limit orders cannot use OPG or CLS.' },
    ],
  },
  {
    group: 'Exit Mechanics',
    color: 'text-gray-400',
    rules: [
      { level: 'info' as const, condition: 'Bracket mode', explain: 'Alpaca native bracket — single order submission with stop-loss and take-profit legs. Alpaca manages both.' },
      { level: 'warn' as const, condition: 'OCO mode', explain: 'One-Cancels-Other exit structure placed after entry fills. Unlike bracket, OCO does not bundle entry + exits in one submission — it is two resting exit orders where one cancels the other.' },
      { level: 'warn' as const, condition: 'Market stop on bracket', explain: 'Market stop = worst-case fill on gaps. Use limit stop if you want slippage control, but risk of non-fill on large gaps.' },
      { level: 'info' as const, condition: 'Trailing stop', explain: 'Dynamic exit — stop price moves with the position. No fixed take-profit; suitable for trend-following.' },
      { level: 'info' as const, condition: 'None (manual)', explain: 'No automatic exit bracket. Strategy must explicitly signal exits. Scale-out breakeven move has no effect.' },
    ],
  },
  {
    group: 'Backtest Assumptions',
    color: 'text-gray-400',
    rules: [
      { level: 'info' as const, condition: 'Next Open fill model', explain: 'Fills at the open of the next bar. Conservative — closest to real-world market order execution.' },
      { level: 'warn' as const, condition: 'Bar Close fill model', explain: 'Fills at the bar close. Optimistic — assumes perfect execution at the last price. Can overstate backtest results.' },
      { level: 'info' as const, condition: 'VWAP Proxy fill model', explain: 'Fills at an estimated VWAP for the bar. Realistic for intraday strategies with high liquidity.' },
    ],
  },
]

function ValidationInfoPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="rounded border border-indigo-800/40 bg-gray-950 p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-indigo-300 font-semibold">
          <Info size={12} /> Execution Style Rules
        </div>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-400"><X size={12} /></button>
      </div>
      <p className="text-gray-500 leading-relaxed">
        Execution Styles define how orders are expressed to Alpaca and how fills are modeled in backtests. These rules help you avoid invalid or dangerous combinations.
      </p>
      {VALIDATION_RULES.map(group => (
        <div key={group.group} className="space-y-1.5">
          <div className={clsx('text-[10px] font-semibold uppercase tracking-wide', group.color)}>{group.group}</div>
          {group.rules.map(rule => (
            <div key={rule.condition} className="flex gap-2">
              <span className={clsx('flex-shrink-0 text-[10px] px-1 py-0.5 rounded font-medium',
                rule.level === 'warn' ? 'bg-amber-900/40 text-amber-400' : 'bg-gray-800 text-gray-500'
              )}>
                {rule.level === 'warn' ? 'warn' : 'info'}
              </span>
              <div>
                <span className="text-gray-300">{rule.condition}</span>
                <span className="text-gray-500"> — {rule.explain}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Execution Preview Rail ───────────────────────────────────────────────────

function ExecutionPreviewRail({ form }: { form: Partial<ExecutionStyle> }) {
  const isTrailing = form.bracket_mode === 'trailing_stop'
  const isNone = form.bracket_mode === 'none'
  const isLimit = form.entry_order_type === 'limit' || form.entry_order_type === 'stop_limit'

  const brokerLines: string[] = []
  const btLines: string[] = []
  const warnings: string[] = []

  // Broker behavior
  const orderLabel = form.entry_order_type === 'stop_limit' ? 'stop-limit' : form.entry_order_type ?? 'market'
  brokerLines.push(`Entry: submit a ${orderLabel} order to Alpaca`)
  if (isLimit && form.entry_limit_offset_method) {
    brokerLines.push(`Limit offset: ${form.entry_limit_offset_method}${form.entry_limit_offset_value ? ` = ${form.entry_limit_offset_value}` : ''}`)
  }
  if (form.entry_cancel_after_bars) {
    brokerLines.push(`Cancel if unfilled after ${form.entry_cancel_after_bars} bars`)
  }
  const tifLabel: Record<string, string> = { day: 'Day — cancels at close', gtc: 'GTC — stays open until filled or cancelled', ioc: 'IOC — cancels unfilled immediately', opg: 'OPG — fills at open auction', cls: 'CLS — fills at closing auction' }
  brokerLines.push(`TIF: ${tifLabel[form.entry_time_in_force ?? 'day'] ?? form.entry_time_in_force}`)

  if (isTrailing) {
    const trailDesc = form.trailing_stop_value
      ? `${form.trailing_stop_value}${form.trailing_stop_type === 'percent' ? '%' : '$'} trailing stop`
      : 'trailing stop (value not set)'
    brokerLines.push(`Exit: ${trailDesc} — standalone sell order placed after entry fills`)
    brokerLines.push('Stop price moves with position; no fixed take-profit')
  } else if (isNone) {
    brokerLines.push('Exit: no automatic bracket — strategy must signal exits explicitly')
  } else if (form.bracket_mode === 'oco') {
    brokerLines.push('Exit: OCO — two resting exit orders (stop + TP) placed after entry fills')
    brokerLines.push('When one leg fills, Alpaca cancels the other')
    brokerLines.push(`Stop leg: ${form.stop_order_type ?? 'market'} order`)
    brokerLines.push(`TP leg: ${form.take_profit_order_type ?? 'limit'} order`)
  } else {
    brokerLines.push('Exit: Alpaca native bracket — entry + stop + TP in one submission')
    brokerLines.push(`Stop leg: ${form.stop_order_type ?? 'market'} order`)
    brokerLines.push(`TP leg: ${form.take_profit_order_type ?? 'limit'} order`)
  }

  const scaleLevels = form.scale_out ?? []
  if (scaleLevels.length > 0) {
    const total = scaleLevels.reduce((s: number, l: { pct?: number }) => s + (l.pct ?? 0), 0)
    brokerLines.push(`Scale-out: ${scaleLevels.length} level(s), ${total.toFixed(0)}% total`)
    if (form.atr_source === 'custom' && form.atr_length && form.atr_timeframe) {
      brokerLines.push(`ATR: ${form.atr_length}-period on ${form.atr_timeframe} (custom override)`)
    } else {
      brokerLines.push('ATR: from strategy feature engine')
    }
    if (form.breakeven_trigger_level != null && !isNone) {
      brokerLines.push(`After T${form.breakeven_trigger_level}: stop moves to entry ${(form.breakeven_atr_offset ?? 0) >= 0 ? '+' : '−'} ${Math.abs(form.breakeven_atr_offset ?? 0).toFixed(2)} ATR`)
    }
    if (form.final_runner_exit_mode === 'alpaca_trailing') {
      const trailDesc = form.final_runner_trail_type === 'atr'
        ? `${form.final_runner_trail_value ?? '?'}× ATR trail`
        : form.final_runner_trail_type === 'price'
        ? `$${form.final_runner_trail_value ?? '?'} trail`
        : `${form.final_runner_trail_value ?? '?'}% trail`
      brokerLines.push(`Runner: Alpaca trailing stop — ${trailDesc}`)
    }
  }

  // Backtest behavior
  const fillDesc: Record<string, string> = {
    next_open: 'Next Open — fills at bar[+1] open (conservative)',
    bar_close: 'Bar Close — fills at bar close (optimistic)',
    vwap_proxy: 'VWAP Proxy — estimated intraday average (realistic)',
  }
  btLines.push(`Fill model: ${fillDesc[form.fill_model ?? 'next_open'] ?? form.fill_model}`)
  btLines.push(`Slippage: ${form.slippage_bps_assumption ?? 5} bps applied to every fill`)
  btLines.push(`Commission: $${form.commission_per_share ?? 0.005}/share both sides`)

  // Warnings
  if (form.entry_time_in_force === 'gtc' && form.entry_order_type === 'market') {
    warnings.push('GTC + market order may fill outside session hours')
  }
  if (form.entry_time_in_force === 'ioc' && (form.bracket_mode === 'bracket' || form.bracket_mode === 'oco')) {
    warnings.push('Alpaca rejects IOC + bracket/OCO — submission will error')
  }
  if (isLimit && !form.entry_limit_offset_method) {
    warnings.push('Limit entry without offset method — will use exact signal price')
  }
  if (isTrailing && !form.trailing_stop_value) {
    warnings.push('Trailing stop value not set')
  }
  if (scaleLevels.length > 0) {
    const total = scaleLevels.reduce((s: number, l: { pct?: number }) => s + (l.pct ?? 0), 0)
    if (total > 100) warnings.push(`Scale-out levels sum to ${total.toFixed(0)}% — exceeds 100%`)
  }
  if (form.breakeven_trigger_level != null && isNone) {
    warnings.push('Breakeven stop move has no effect — bracket mode is None')
  }
  if (form.fill_model === 'bar_close') {
    warnings.push('Bar Close fill model is optimistic — may overstate backtest results')
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded border border-sky-800/40 bg-gray-950/60 p-3 space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-400">Broker Behavior</div>
        <ul className="space-y-1">
          {brokerLines.map((l, i) => (
            <li key={i} className="text-gray-400 leading-snug">· {l}</li>
          ))}
        </ul>
      </div>

      <div className="rounded border border-gray-800/60 bg-gray-950/60 p-3 space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Backtest Behavior</div>
        <ul className="space-y-1">
          {btLines.map((l, i) => (
            <li key={i} className="text-gray-400 leading-snug">· {l}</li>
          ))}
        </ul>
      </div>

      {warnings.length > 0 && (
        <div className="rounded border border-amber-800/40 bg-amber-950/10 p-3 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">Warnings</div>
          {warnings.map((w, i) => (
            <p key={i} className="text-amber-400/80 leading-snug">⚠ {w}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Execution Style Form ─────────────────────────────────────────────────────

function StyleForm({
  initial,
  onSave,
  onCancel,
  isPending,
  error,
}: {
  initial: Partial<ExecutionStyle>
  onSave: (data: Partial<ExecutionStyle>) => void
  onCancel: () => void
  isPending: boolean
  error?: string
}) {
  const [form, setForm] = useState<Partial<ExecutionStyle>>(initial)
  const [showInfo, setShowInfo] = useState(false)
  const [showAdvancedEntry, setShowAdvancedEntry] = useState(
    !!(initial.entry_limit_offset_method || initial.entry_cancel_after_bars)
  )
  const [analysis, setAnalysis] = useState<StyleAnalysis | null>(null)

  const analyzeMutation = useMutation({
    mutationFn: () => executionStylesApi.analyze(form),
    onSuccess: (result) => {
      setAnalysis(result)
      if (result.suggested_name) setForm(f => ({ ...f, name: result.suggested_name }))
      if (result.suggested_description) setForm(f => ({ ...f, description: result.suggested_description }))
    },
  })

  const isLimit = form.entry_order_type === 'limit' || form.entry_order_type === 'stop_limit'
  const isTrailing = form.bracket_mode === 'trailing_stop'
  const isNone = form.bracket_mode === 'none'

  // ── Field hints ───────────────────────────────────────────────────────────
  type Hint = { text: string; level: 'warn' | 'danger' }
  const hints: Partial<Record<string, Hint>> = {}

  if (isLimit && !form.entry_limit_offset_method) {
    hints.entry_limit_offset_method = { level: 'warn', text: 'No offset — will submit at exact signal price' }
  }
  if (form.entry_time_in_force === 'gtc' && form.entry_order_type === 'market') {
    hints.entry_time_in_force = { level: 'warn', text: 'GTC market order may fill outside session hours' }
  }
  if (form.entry_time_in_force === 'ioc' && (form.bracket_mode === 'bracket' || form.bracket_mode === 'oco')) {
    hints.entry_time_in_force = { level: 'danger', text: 'Alpaca rejects IOC + bracket/OCO — this combination will error at submission' }
  }
  if ((form.entry_time_in_force === 'opg' || form.entry_time_in_force === 'cls') &&
      (form.entry_order_type === 'stop' || form.entry_order_type === 'stop_limit')) {
    hints.entry_order_type = { level: 'warn', text: 'OPG/CLS TIF not valid with stop or stop-limit orders — Alpaca will reject' }
  }
  if (isTrailing && !form.trailing_stop_value) {
    hints.trailing_stop_value = { level: 'danger', text: 'Trail value is required' }
  }
  if (form.atr_source === 'custom' && (!form.atr_length || !form.atr_timeframe)) {
    hints.atr_source = { level: 'danger', text: 'Custom ATR requires both length and timeframe' }
  }
  const scaleLevels = form.scale_out ?? []
  const scaleTotal = scaleLevels.reduce((s: number, l: { pct?: number }) => s + (l.pct ?? 0), 0)
  if (scaleLevels.length > 0 && scaleTotal > 100) {
    hints.scale_out = { level: 'danger', text: `Scale-out levels sum to ${scaleTotal.toFixed(0)}% — exceeds 100%` }
  }
  const beTrigger = form.breakeven_trigger_level ?? null
  if (beTrigger !== null && beTrigger > scaleLevels.length) {
    hints.breakeven_trigger_level = { level: 'warn', text: `Trigger T${beTrigger} exceeds ${scaleLevels.length} scale level(s) — breakeven move will never fire` }
  }
  if (form.final_runner_exit_mode === 'alpaca_trailing' && !form.final_runner_trail_value) {
    hints.final_runner_trail_value = { level: 'danger', text: 'Trail value is required' }
  }
  if (form.final_runner_exit_mode === 'alpaca_trailing' && form.bracket_mode !== 'none') {
    hints.final_runner_bracket = { level: 'warn', text: 'Set bracket mode to None when using Alpaca trailing stop on the runner — active bracket may conflict' }
  }

  const hintClass = (key: string) => {
    const h = hints[key]
    if (!h) return ''
    return h.level === 'danger' ? 'border-red-700/60' : 'border-amber-700/60'
  }
  const labelClass = (key: string) => {
    const h = hints[key]
    if (!h) return 'label'
    return clsx('label', h.level === 'danger' ? 'text-red-400' : 'text-amber-400')
  }
  const HintText = ({ k }: { k: string }) => {
    const h = hints[k]
    if (!h) return null
    return <p className={clsx('text-[10px] mt-0.5 leading-tight', h.level === 'danger' ? 'text-red-400' : 'text-amber-400')}>{h.text}</p>
  }

  return (
    <div className="flex gap-4">
      {/* ── Left: form ── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Info toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowInfo(v => !v)}
            className={clsx('flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors',
              showInfo ? 'text-indigo-300 bg-indigo-950/40' : 'text-gray-600 hover:text-indigo-400'
            )}
          >
            <Info size={10} /> Order mechanics rules
          </button>
        </div>
        {showInfo && <ValidationInfoPanel onClose={() => setShowInfo(false)} />}

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

        {/* Entry Order */}
        <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-400">Entry Order</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass('entry_order_type')}>Order Type</label>
              <select
                className={clsx('input w-full', hintClass('entry_order_type'))}
                value={form.entry_order_type ?? 'market'}
                onChange={e => {
                  const val = e.target.value as ExecutionStyle['entry_order_type']
                  setForm(f => ({ ...f, entry_order_type: val }))
                  if (val === 'limit' || val === 'stop_limit') setShowAdvancedEntry(true)
                }}
              >
                <option value="market">Market</option>
                <option value="limit">Limit</option>
                <option value="stop">Stop</option>
                <option value="stop_limit">Stop-Limit</option>
              </select>
              <HintText k="entry_order_type" />
            </div>
            <div>
              <label className={labelClass('entry_time_in_force')}>Time in Force</label>
              <select
                className={clsx('input w-full', hintClass('entry_time_in_force'))}
                value={form.entry_time_in_force ?? 'day'}
                onChange={e => setForm(f => ({ ...f, entry_time_in_force: e.target.value as ExecutionStyle['entry_time_in_force'] }))}
              >
                <option value="day">Day</option>
                <option value="gtc">GTC</option>
                <option value="ioc">IOC</option>
                <option value="opg">OPG</option>
                <option value="cls">CLS</option>
              </select>
              <HintText k="entry_time_in_force" />
            </div>
          </div>

          {/* Advanced entry — collapsible */}
          <button
            type="button"
            onClick={() => setShowAdvancedEntry(v => !v)}
            className="w-full flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-300 pt-1"
          >
            <span>Limit Offset / Cancel Rules</span>
            {showAdvancedEntry ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {showAdvancedEntry && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 pt-1">
              <div>
                <label className={labelClass('entry_limit_offset_method')}>Offset Method</label>
                <select
                  className={clsx('input w-full', hintClass('entry_limit_offset_method'))}
                  value={form.entry_limit_offset_method ?? ''}
                  onChange={e => setForm(f => ({ ...f, entry_limit_offset_method: (e.target.value || null) as ExecutionStyle['entry_limit_offset_method'] }))}
                >
                  <option value="">None</option>
                  <option value="atr">ATR</option>
                  <option value="pct">Pct</option>
                  <option value="fixed">Fixed $</option>
                </select>
                <HintText k="entry_limit_offset_method" />
              </div>
              <div>
                <label className="label">Offset Value</label>
                <input
                  className="input w-full"
                  type="number"
                  step="0.01"
                  value={form.entry_limit_offset_value ?? ''}
                  onChange={e => setForm(f => ({ ...f, entry_limit_offset_value: parseFloat(e.target.value) || null }))}
                />
              </div>
              <div>
                <label className="label">Cancel After (bars)</label>
                <input
                  className="input w-full"
                  type="number"
                  value={form.entry_cancel_after_bars ?? ''}
                  onChange={e => setForm(f => ({ ...f, entry_cancel_after_bars: parseInt(e.target.value) || null }))}
                />
              </div>
            </div>
          )}
        </div>

        {/* Exit Mechanics */}
        <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Exit Mechanics</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Bracket Mode</label>
              <select
                className="input w-full"
                value={form.bracket_mode ?? 'bracket'}
                onChange={e => setForm(f => ({ ...f, bracket_mode: e.target.value as ExecutionStyle['bracket_mode'] }))}
              >
                <option value="bracket">Bracket (stop + TP)</option>
                <option value="oco">OCO</option>
                <option value="trailing_stop">Trailing Stop</option>
                <option value="none">None (manual)</option>
              </select>
            </div>
            {!isTrailing && !isNone && (
              <>
                <div>
                  <label className="label">Stop Order Type</label>
                  <select
                    className="input w-full"
                    value={form.stop_order_type ?? 'market'}
                    onChange={e => setForm(f => ({ ...f, stop_order_type: e.target.value as ExecutionStyle['stop_order_type'] }))}
                  >
                    <option value="market">Market</option>
                    <option value="limit">Limit</option>
                  </select>
                </div>
                <div>
                  <label className="label">Take-Profit Order Type</label>
                  <select
                    className="input w-full"
                    value={form.take_profit_order_type ?? 'limit'}
                    onChange={e => setForm(f => ({ ...f, take_profit_order_type: e.target.value as ExecutionStyle['take_profit_order_type'] }))}
                  >
                    <option value="limit">Limit</option>
                    <option value="market">Market</option>
                  </select>
                </div>
              </>
            )}
            {isTrailing && (
              <>
                <div>
                  <label className="label">Trail Type</label>
                  <select
                    className="input w-full"
                    value={form.trailing_stop_type ?? 'percent'}
                    onChange={e => setForm(f => ({ ...f, trailing_stop_type: e.target.value as ExecutionStyle['trailing_stop_type'] }))}
                  >
                    <option value="percent">Percent — % of current market price (e.g. 2.0 = 2%)</option>
                    <option value="dollar">Dollar — fixed $ amount below HWM (e.g. 1.50 = $1.50)</option>
                  </select>
                  <p className="text-[10px] mt-0.5 text-gray-500">Alpaca manages the trail server-side automatically — the stop price moves with the position's high-water mark. Cannot be used as a bracket stop leg.</p>
                </div>
                <div>
                  <label className={labelClass('trailing_stop_value')}>Trail Value</label>
                  <input
                    className={clsx('input w-full', hintClass('trailing_stop_value'))}
                    type="number"
                    step="0.1"
                    value={form.trailing_stop_value ?? ''}
                    onChange={e => setForm(f => ({ ...f, trailing_stop_value: parseFloat(e.target.value) || null }))}
                  />
                  <HintText k="trailing_stop_value" />
                  <p className="text-[10px] mt-0.5 text-gray-500">
                    {form.trailing_stop_type === 'dollar'
                      ? 'e.g. 1.50 → stop stays $1.50 below the high-water mark'
                      : 'e.g. 2.0 → stop stays 2% below the high-water mark'}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Scale-Out & Stop Progression — unified table */}
        <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Scale-Out &amp; Stop Progression</div>
          <p className="text-[10px] text-gray-600 italic">Alpaca has no native scale-out. Each level fires a partial close when the target is reached. Stop is moved via ReplaceOrderRequest (no cancel+resubmit). Positive multiplier = stop above entry (locked profit).</p>

          {/* ATR Source */}
          <div className="border border-gray-800/60 rounded p-2.5 space-y-2 bg-gray-950/30">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">ATR Source</span>
              <HintText k="atr_source" />
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input type="radio" name="atr_source" className="accent-sky-500"
                  checked={form.atr_source !== 'custom'}
                  onChange={() => setForm(f => ({ ...f, atr_source: 'strategy', atr_length: null, atr_timeframe: null }))}
                />
                Strategy ATR
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input type="radio" name="atr_source" className="accent-sky-500"
                  checked={form.atr_source === 'custom'}
                  onChange={() => setForm(f => ({ ...f, atr_source: 'custom', atr_length: f.atr_length ?? 14, atr_timeframe: f.atr_timeframe ?? '1d' }))}
                />
                Custom ATR
              </label>
            </div>
            {form.atr_source === 'custom' ? (
              <div className="flex items-center gap-2 pt-0.5">
                <input
                  type="number"
                  className={clsx('input w-16 text-xs py-1', hintClass('atr_source'))}
                  min={1} max={200} step={1}
                  placeholder="14"
                  value={form.atr_length ?? ''}
                  onChange={e => setForm(f => ({ ...f, atr_length: parseInt(e.target.value) || null }))}
                />
                <span className="text-xs text-gray-600">periods on</span>
                <select
                  className={clsx('input text-xs py-1', hintClass('atr_source'))}
                  value={form.atr_timeframe ?? '1d'}
                  onChange={e => setForm(f => ({ ...f, atr_timeframe: e.target.value }))}
                >
                  {['1m','5m','15m','30m','1h','4h','1d'].map(tf => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-[10px] text-gray-600">Uses ATR from the strategy's feature engine</p>
            )}
            <p className="text-[10px] text-gray-600/60">ATR is used to calculate all stop distances and progression levels.</p>
          </div>

          {/* Initial stop row */}
          <div className="flex items-center gap-2 py-1 border-b border-gray-800/60">
            <span className="text-xs text-gray-500 w-20 flex-shrink-0">Initial stop</span>
            <input
              type="number"
              className="input w-20 text-xs py-1"
              placeholder="0.00"
              step="0.05"
              value={(form.stop_progression_targets ?? [])[0] ?? ''}
              onChange={e => {
                const next = [...(form.stop_progression_targets ?? [])]
                next[0] = parseFloat(e.target.value) || 0
                setForm(f => ({ ...f, stop_progression_targets: next }))
              }}
            />
            <span className="text-xs text-gray-500">× ATR</span>
            <span className="text-[10px] text-gray-600 ml-2">
              {(() => { const m = (form.stop_progression_targets ?? [])[0] ?? 0; return m === 0 ? 'at entry' : m > 0 ? `Entry + ${m.toFixed(2)} ATR` : `Entry − ${Math.abs(m).toFixed(2)} ATR` })()}
            </span>
          </div>

          {/* Per-level table */}
          {scaleLevels.length > 0 && (
            <div className="space-y-0">
              <div className="grid grid-cols-[3rem_5rem_1fr_6rem_1.5rem] gap-x-2 px-1 pb-1 text-[10px] text-gray-600 uppercase tracking-wide">
                <span>Target</span><span>Exit %</span><span>After exit → move stop to</span><span>Preview</span><span />
              </div>
              {scaleLevels.map((level: { pct?: number }, i: number) => {
                const stopMult = (form.stop_progression_targets ?? [])[i + 1] ?? null
                const preview = stopMult === null ? '—'
                  : stopMult === 0 ? 'at entry'
                  : stopMult > 0 ? `Entry + ${stopMult.toFixed(2)} ATR`
                  : `Entry − ${Math.abs(stopMult).toFixed(2)} ATR`
                return (
                  <div key={i} className="grid grid-cols-[3rem_5rem_1fr_6rem_1.5rem] gap-x-2 items-center py-1 border-b border-gray-800/30">
                    <span className="text-xs text-gray-400 font-medium">T{i + 1}</span>
                    <input
                      type="number" className="input w-full text-xs py-1" placeholder="%" min={1} max={100}
                      value={level.pct ?? ''}
                      onChange={e => {
                        const next = [...scaleLevels]
                        next[i] = { ...next[i], pct: parseFloat(e.target.value) || 0 }
                        setForm(f => ({ ...f, scale_out: next }))
                      }}
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        className="input w-20 text-xs py-1"
                        placeholder="mult"
                        step="0.05"
                        value={stopMult ?? ''}
                        onChange={e => {
                          const next = [...(form.stop_progression_targets ?? [])]
                          while (next.length <= i + 1) next.push(0)
                          next[i + 1] = parseFloat(e.target.value) || 0
                          setForm(f => ({ ...f, stop_progression_targets: next }))
                        }}
                      />
                      <span className="text-xs text-gray-600">× ATR</span>
                    </div>
                    <span className={clsx('text-[10px] leading-tight',
                      stopMult === null ? 'text-gray-700'
                        : stopMult > 0 ? 'text-emerald-500/70'
                        : stopMult < 0 ? 'text-amber-500/70'
                        : 'text-gray-500'
                    )}>{preview}</span>
                    <button
                      type="button"
                      className="text-gray-600 hover:text-red-400 text-xs"
                      onClick={() => setForm(f => ({
                        ...f,
                        scale_out: (f.scale_out ?? []).filter((_: unknown, idx: number) => idx !== i),
                        stop_progression_targets: (f.stop_progression_targets ?? []).filter((_: number, idx: number) => idx !== i + 1),
                      }))}
                    >✕</button>
                  </div>
                )
              })}
              {scaleTotal < 100 && (
                <p className="text-[10px] text-gray-600 pt-1 pl-1">
                  remaining {(100 - scaleTotal).toFixed(0)}% → <span className="text-sky-500/70">Final Runner</span>
                </p>
              )}
            </div>
          )}

          {hints.scale_out && (
            <p className={clsx('text-[10px]', hints.scale_out.level === 'danger' ? 'text-red-400' : 'text-amber-400')}>
              {hints.scale_out.text}
            </p>
          )}
          {scaleLevels.length > 0 && (
            <p className="text-[10px] text-gray-600">
              Total exit: <span className={scaleTotal > 100 ? 'text-red-400' : 'text-gray-400'}>{scaleTotal.toFixed(0)}%</span> of position
            </p>
          )}
          <button
            type="button"
            className="btn-ghost text-xs flex items-center gap-1"
            onClick={() => setForm(f => ({
              ...f,
              scale_out: [...(f.scale_out ?? []), { pct: 50 }],
              stop_progression_targets: [...(f.stop_progression_targets ?? []).slice(0, (f.scale_out ?? []).length + 1), 0],
            }))}
          >+ Add Level</button>
        </div>

        {/* Breakeven / Entry Reset */}
        <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Breakeven / Entry Reset</div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="radio" name="be_trigger" className="accent-sky-500"
                checked={form.breakeven_trigger_level === null || form.breakeven_trigger_level === undefined}
                onChange={() => setForm(f => ({ ...f, breakeven_trigger_level: null }))}
              />
              Disabled
            </label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input
                  type="radio" name="be_trigger" className="accent-sky-500"
                  checked={form.breakeven_trigger_level !== null && form.breakeven_trigger_level !== undefined}
                  onChange={() => setForm(f => ({ ...f, breakeven_trigger_level: 1 }))}
                />
                Trigger after
              </label>
              <select
                className="input py-0.5 text-xs w-20"
                disabled={form.breakeven_trigger_level === null || form.breakeven_trigger_level === undefined}
                value={form.breakeven_trigger_level ?? 1}
                onChange={e => setForm(f => ({ ...f, breakeven_trigger_level: parseInt(e.target.value) }))}
              >
                {scaleLevels.length === 0
                  ? <option value={1}>T1</option>
                  : scaleLevels.map((_: unknown, i: number) => <option key={i} value={i + 1}>T{i + 1}</option>)
                }
              </select>
              <span className="text-xs text-gray-500">fills</span>
            </div>
            <HintText k="breakeven_trigger_level" />
          </div>

          {(form.breakeven_trigger_level !== null && form.breakeven_trigger_level !== undefined) && (
            <div className="space-y-1 pt-1">
              <label className="label">Offset from entry</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="input w-24"
                  step="0.01"
                  value={form.breakeven_atr_offset ?? 0}
                  onChange={e => setForm(f => ({ ...f, breakeven_atr_offset: parseFloat(e.target.value) || 0 }))}
                />
                <span className="text-xs text-gray-500">× ATR from entry</span>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">
                {(() => {
                  const v = form.breakeven_atr_offset ?? 0
                  if (v > 0) return `+${v.toFixed(2)} ATR → stop moves to Entry + ${v.toFixed(2)} ATR — locks in small profit buffer`
                  if (v < 0) return `${v.toFixed(2)} ATR → stop moves to Entry − ${Math.abs(v).toFixed(2)} ATR — accepts a small loss if hit`
                  return '0.00 ATR → stop moves to exact entry price — true breakeven'
                })()}
              </p>
            </div>
          )}
        </div>

        {/* Final Runner Exit */}
        <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Final Runner Exit</div>
            {form.final_runner_exit_mode === 'alpaca_trailing' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-300 ring-1 ring-sky-700 flex items-center gap-1">
                ⚡ Broker-managed
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-600 italic">Controls what happens to the remaining position after all scale-out targets fill.</p>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="radio" name="runner_mode" className="accent-sky-500"
                checked={form.final_runner_exit_mode === 'internal' || !form.final_runner_exit_mode}
                onChange={() => setForm(f => ({ ...f, final_runner_exit_mode: 'internal' }))}
              />
              Internal Stop Progression — continue using the stop_progression_targets engine
            </label>
            <label className="flex items-center gap-2 text-xs text-sky-300 cursor-pointer">
              <input
                type="radio" name="runner_mode" className="accent-sky-500"
                checked={form.final_runner_exit_mode === 'alpaca_trailing'}
                onChange={() => setForm(f => ({ ...f, final_runner_exit_mode: 'alpaca_trailing', final_runner_trail_type: f.final_runner_trail_type ?? 'percent', final_runner_time_in_force: f.final_runner_time_in_force ?? 'gtc' }))}
              />
              Alpaca Trailing Stop ⚡ — broker manages the stop server-side after last scale
            </label>
          </div>

          {form.final_runner_exit_mode === 'alpaca_trailing' && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Trail Type</label>
                  <div className="flex flex-col gap-1 mt-1">
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                      <input type="radio" name="trail_type" className="accent-sky-500"
                        checked={form.final_runner_trail_type === 'percent'}
                        onChange={() => setForm(f => ({ ...f, final_runner_trail_type: 'percent' }))}
                      />
                      Percent (% of price)
                    </label>
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                      <input type="radio" name="trail_type" className="accent-sky-500"
                        checked={form.final_runner_trail_type === 'price'}
                        onChange={() => setForm(f => ({ ...f, final_runner_trail_type: 'price' }))}
                      />
                      Dollar ($ amount)
                    </label>
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                      <input type="radio" name="trail_type" className="accent-sky-500"
                        checked={form.final_runner_trail_type === 'atr'}
                        onChange={() => setForm(f => ({ ...f, final_runner_trail_type: 'atr' }))}
                      />
                      ATR multiplier
                    </label>
                  </div>
                </div>
                <div>
                  <label className={labelClass('final_runner_trail_value')}>Trail Value</label>
                  <input
                    type="number"
                    className={clsx('input w-full', hintClass('final_runner_trail_value'))}
                    step="0.1"
                    placeholder={form.final_runner_trail_type === 'price' ? '1.50' : form.final_runner_trail_type === 'atr' ? '2.0' : '2.0'}
                    value={form.final_runner_trail_value ?? ''}
                    onChange={e => setForm(f => ({ ...f, final_runner_trail_value: parseFloat(e.target.value) || null }))}
                  />
                  <HintText k="final_runner_trail_value" />
                  <p className="text-[10px] mt-0.5 text-gray-600">
                    {form.final_runner_trail_type === 'price'
                      ? 'e.g. 1.50 = stop stays $1.50 below the HWM'
                      : form.final_runner_trail_type === 'atr'
                      ? 'e.g. 2.0 = stop trails 2× ATR below the HWM — uses ATR source defined above'
                      : 'e.g. 2.0 = stop stays 2% below the HWM'}
                  </p>
                </div>
              </div>
              <div>
                <label className="label">Time in Force</label>
                <div className="flex gap-4 mt-1">
                  {(['day', 'gtc'] as const).map(tif => (
                    <label key={tif} className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                      <input type="radio" name="runner_tif" className="accent-sky-500"
                        checked={form.final_runner_time_in_force === tif}
                        onChange={() => setForm(f => ({ ...f, final_runner_time_in_force: tif }))}
                      />
                      {tif.toUpperCase()}
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded border border-sky-900/30 bg-sky-950/20 p-2 space-y-1">
                <p className="text-[10px] text-sky-400/80">ℹ Broker-managed trailing stop</p>
                <p className="text-[10px] text-gray-500">· Activates only after the last scale-out level fills</p>
                <p className="text-[10px] text-gray-500">· Alpaca manages the HWM tracking server-side</p>
                <p className="text-[10px] text-gray-500">· Converts to market order when triggered</p>
                <p className="text-[10px] text-gray-500">· Portfolio Governor will not send competing stop orders while broker owns the stop</p>
              </div>
              <HintText k="final_runner_bracket" />
            </div>
          )}
        </div>

        {/* Backtest Assumptions */}
        <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Backtest Assumptions</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className="label">Fill Model</label>
              <select
                className="input w-full"
                value={form.fill_model ?? 'next_open'}
                onChange={e => setForm(f => ({ ...f, fill_model: e.target.value }))}
              >
                <option value="next_open">Next Open</option>
                <option value="bar_close">Bar Close</option>
                <option value="vwap_proxy">VWAP Proxy</option>
              </select>
            </div>
            <div>
              <label className="label">Slippage (bps)</label>
              <input
                className="input w-full"
                type="number"
                step="0.5"
                value={form.slippage_bps_assumption ?? 5}
                onChange={e => setForm(f => ({ ...f, slippage_bps_assumption: parseFloat(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <label className="label">Commission ($/share)</label>
              <input
                className="input w-full"
                type="number"
                step="0.001"
                value={form.commission_per_share ?? 0.005}
                onChange={e => setForm(f => ({ ...f, commission_per_share: parseFloat(e.target.value) || 0 }))}
              />
            </div>
          </div>
        </div>

        {/* AI Advisor */}
        <div className="rounded border border-gray-800 bg-gray-900/40 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">AI Advisor</div>
            <button
              type="button"
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending}
              className={clsx(
                'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded transition-colors',
                analyzeMutation.isPending
                  ? 'text-gray-500 bg-gray-800 cursor-not-allowed'
                  : 'text-indigo-300 bg-indigo-950/40 hover:bg-indigo-900/40'
              )}
            >
              {analyzeMutation.isPending
                ? <><Loader2 size={11} className="animate-spin" /> Analyzing...</>
                : <><Sparkles size={11} /> Analyze Style</>
              }
            </button>
          </div>

          {analysis && (
            <div className="space-y-2 pt-1">
              {/* Health badge */}
              <div className="flex items-center gap-2">
                <span className={clsx('text-xs px-2 py-0.5 rounded font-medium', HEALTH_COLOR[analysis.health] ?? HEALTH_COLOR.clean)}>
                  {analysis.health}
                </span>
              </div>

              {/* Auto-applied confirmation */}
              <div className="rounded border border-emerald-800/40 bg-emerald-950/20 px-2.5 py-2 space-y-0.5">
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                  <CheckCircle2 size={11} /> Name & description updated
                </div>
                <p className="text-[10px] text-emerald-300/70">{analysis.suggested_name}</p>
              </div>

              {analysis.insights.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Insights</div>
                  {analysis.insights.map((ins, i) => (
                    <p key={i} className="text-[11px] text-gray-400 leading-snug">· {ins}</p>
                  ))}
                </div>
              )}

              {analysis.suggestions.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Suggestions</div>
                  {analysis.suggestions.map((s, i) => (
                    <p key={i} className="text-[11px] text-indigo-300/80 leading-snug">→ {s}</p>
                  ))}
                </div>
              )}

              {analysis.warnings.length > 0 && (
                <div className="space-y-1">
                  {analysis.warnings.map((w, i) => (
                    <p key={i} className="text-[11px] text-amber-400/80 leading-snug">⚠ {w}</p>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => setAnalysis(null)}
                className="text-[10px] text-gray-600 hover:text-gray-400"
              >Dismiss</button>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
          <button
            type="button"
            onClick={() => onSave(form)}
            disabled={!form.name?.trim() || isPending}
            className="btn-primary"
          >
            {isPending ? 'Saving...' : 'Save Style'}
          </button>
        </div>
      </div>

      {/* ── Right: preview rail ── */}
      <div className="hidden lg:block w-56 flex-shrink-0">
        <div className="sticky top-4">
          <ExecutionPreviewRail form={form} />
        </div>
      </div>
    </div>
  )
}

// ─── Create Panel (inline) ────────────────────────────────────────────────────

function CreatePanel({
  onClose,
  onCreated,
  initialValues,
}: {
  onClose: () => void
  onCreated: (s: ExecutionStyle) => void
  initialValues?: Partial<ExecutionStyle>
}) {
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (data: Partial<ExecutionStyle>) => executionStylesApi.create(data),
    onSuccess: onCreated,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="rounded border border-indigo-800/50 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200">New Execution Style</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={14} /></button>
      </div>
      <StyleForm
        initial={{ ...DEFAULT_FORM, ...initialValues }}
        onSave={data => mutation.mutate(data)}
        onCancel={onClose}
        isPending={mutation.isPending}
        error={error}
      />
    </div>
  )
}

// ─── Style Detail ─────────────────────────────────────────────────────────────

function StyleDetail({ style, onBack }: { style: ExecutionStyle; onBack: () => void }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editError, setEditError] = useState('')

  const updateMutation = useMutation({
    mutationFn: (data: Partial<ExecutionStyle>) => executionStylesApi.update(style.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['execution-styles'] })
      setEditing(false)
      setEditError('')
    },
    onError: (e: Error) => setEditError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => executionStylesApi.delete(style.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['execution-styles'] }); onBack() },
  })

  const s = style

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-300 mt-0.5">
          <ChevronRight size={14} className="rotate-180" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-200">{s.name}</span>
            <BracketBadge mode={s.bracket_mode} />
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{s.entry_order_type}</span>
          </div>
          {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {s.is_golden && <span title="Golden template — read-only"><Crown size={13} className="text-amber-400" /></span>}
          {!editing && !s.is_golden && (
            <button onClick={() => setEditing(true)} className="text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-gray-800/50">
              <Pencil size={13} />
            </button>
          )}
          {!s.is_golden && !confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="text-gray-600 hover:text-red-400 p-1 rounded hover:bg-red-950/30">
              <Trash2 size={13} />
            </button>
          ) : !s.is_golden ? (
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
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Edit Style</div>
          <StyleForm
            initial={s}
            onSave={data => updateMutation.mutate(data)}
            onCancel={() => { setEditing(false); setEditError('') }}
            isPending={updateMutation.isPending}
            error={editError}
          />
        </div>
      ) : (
        <>
          <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-400 mb-2">Entry</div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-800/60">
                {[
                  ['Order Type', s.entry_order_type],
                  ['Time in Force', s.entry_time_in_force],
                  s.entry_limit_offset_method ? ['Limit Offset', `${s.entry_limit_offset_value} ${s.entry_limit_offset_method}`] : null,
                  s.entry_cancel_after_bars ? ['Cancel After', `${s.entry_cancel_after_bars} bars`] : null,
                ].filter(Boolean).map((row) => { const [label, val] = row as [string, React.ReactNode]; return (
                  <tr key={label}>
                    <td className="py-1.5 text-gray-500">{label}</td>
                    <td className="py-1.5 text-gray-200 text-right font-mono">{val}</td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>

          <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Exit</div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-800/60">
                {[
                  ['Bracket Mode', s.bracket_mode.replace('_', ' ')],
                  s.bracket_mode !== 'trailing_stop' && s.bracket_mode !== 'none' ? ['Stop Order', s.stop_order_type] : null,
                  s.bracket_mode !== 'trailing_stop' && s.bracket_mode !== 'none' ? ['Take-Profit Order', s.take_profit_order_type] : null,
                  s.bracket_mode === 'trailing_stop' ? ['Trail Type', s.trailing_stop_type] : null,
                  s.bracket_mode === 'trailing_stop' ? ['Trail Value', s.trailing_stop_value] : null,
                  (s.scale_out?.length ?? 0) > 0 ? ['Scale-out Levels', s.scale_out.length] : null,
                  ['ATR Source', s.atr_source === 'custom' && s.atr_length && s.atr_timeframe ? `Custom — ${s.atr_length}p ${s.atr_timeframe}` : 'Strategy'],
                  s.breakeven_trigger_level != null ? ['Breakeven Move', `After T${s.breakeven_trigger_level}, offset ${s.breakeven_atr_offset ?? 0} ATR`] : null,
                  s.final_runner_exit_mode === 'alpaca_trailing' ? ['Final Runner', `Alpaca trailing ${s.final_runner_trail_type === 'atr' ? `${s.final_runner_trail_value ?? '?'}× ATR` : s.final_runner_trail_type === 'price' ? `$${s.final_runner_trail_value ?? '?'}` : `${s.final_runner_trail_value ?? '?'}%`}`] : null,
                ].filter(Boolean).map((row) => { const [label, val] = row as [string, React.ReactNode]; return (
                  <tr key={label}>
                    <td className="py-1.5 text-gray-500">{label}</td>
                    <td className="py-1.5 text-gray-200 text-right font-mono">{val}</td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>

          <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Backtest Assumptions</div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-800/60">
                {[
                  ['Fill Model', s.fill_model.replace('_', ' ')],
                  ['Slippage', `${s.slippage_bps_assumption} bps`],
                  ['Commission', `$${s.commission_per_share}/share`],
                ].map(([label, val]) => (
                  <tr key={label as string}>
                    <td className="py-1.5 text-gray-500">{label}</td>
                    <td className="py-1.5 text-gray-200 text-right font-mono">{val as React.ReactNode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Style Card ────────────────────────────────────────────────────────────────

function StyleCard({ style, onClick, onDelete, onDuplicate }: {
  style: ExecutionStyle
  onClick: () => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  return (
    <div className={clsx(
      'rounded border px-4 py-3 transition-colors space-y-1.5',
      style.is_golden ? 'border-amber-800/60 bg-amber-950/10 hover:border-amber-700' : 'border-gray-800 bg-gray-900/50 hover:border-gray-700 hover:bg-gray-900'
    )}>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onClick} className="flex items-center gap-2 flex-1 text-left min-w-0">
          {style.is_golden && <Crown size={12} className="text-amber-400 flex-shrink-0" />}
          <span className="text-sm font-medium text-gray-200">{style.name}</span>
          <BracketBadge mode={style.bracket_mode} />
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{style.entry_order_type}</span>
          {style.tags?.map(tag => (
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
          {!style.is_golden && (
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
        <span>Fill: {style.fill_model.replace('_', ' ')}</span>
        <span>Slippage: {style.slippage_bps_assumption} bps</span>
        {style.is_golden && <span className="text-amber-500/80">Golden template — read-only</span>}
        <span className="text-gray-700 ml-auto">{style.created_at ? new Date(style.created_at).toLocaleDateString() : '—'}</span>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ExecutionStyles() {
  const pausePolling = usePollingGate()
  const [selected, setSelected] = useState<ExecutionStyle | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createInitialValues, setCreateInitialValues] = useState<Partial<ExecutionStyle> | undefined>()
  const qc = useQueryClient()

  const { data: styles = [], isLoading, error } = useQuery({
    queryKey: ['execution-styles'],
    queryFn: () => executionStylesApi.list(),
    refetchInterval: pausePolling ? false : 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => executionStylesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution-styles'] }),
    onError: (e: Error) => alert(e.message),
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => executionStylesApi.duplicate(id),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['execution-styles'] }); setSelected(s) },
  })

  const handleCreated = (s: ExecutionStyle) => {
    qc.invalidateQueries({ queryKey: ['execution-styles'] })
    setShowCreate(false)
    setCreateInitialValues(undefined)
    setSelected(s)
  }

  const openCreateWithTemplate = (values: Partial<ExecutionStyle>) => {
    setCreateInitialValues(values)
    setShowCreate(true)
  }

  if (selected) {
    return (
      <div className="max-w-3xl mx-auto">
        <StyleDetail style={selected} onBack={() => setSelected(null)} />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Play size={15} className="text-sky-400" /> Execution Styles
        </h1>
        <button
          onClick={() => { setCreateInitialValues(undefined); setShowCreate(v => !v) }}
          className="btn-primary text-xs flex items-center gap-1.5"
        >
          <Plus size={13} /> New Style
        </button>
      </div>

      {/* Template quick-starts */}
      {!showCreate && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TEMPLATES.map(t => (
            <button
              key={t.label}
              onClick={() => openCreateWithTemplate(t.values)}
              className="rounded border border-gray-800 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900 px-3 py-2.5 text-left transition-colors space-y-1"
            >
              <div className="flex items-center gap-1.5">
                {t.icon}
                <span className="text-xs font-medium text-gray-300">{t.label}</span>
              </div>
              <p className="text-[10px] text-gray-600 leading-snug">{t.description}</p>
            </button>
          ))}
        </div>
      )}

      {/* Inline create panel */}
      {showCreate && (
        <CreatePanel
          onClose={() => { setShowCreate(false); setCreateInitialValues(undefined) }}
          onCreated={handleCreated}
          initialValues={createInitialValues}
        />
      )}

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

      {!isLoading && styles.length === 0 && !showCreate && (
        <div className="rounded border border-gray-800 bg-gray-900/40 px-4 py-8 text-center space-y-2">
          <Play size={24} className="mx-auto text-gray-700" />
          <p className="text-sm text-gray-400">No execution styles yet</p>
          <p className="text-xs text-gray-600">
            Execution styles define Alpaca order mechanics — bracket / OCO / trailing stop, limit pullback,
            and backtest fill assumptions.
          </p>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs mt-2">
            Create First Style
          </button>
        </div>
      )}

      {styles.some(s => s.is_golden) && (
        <div className="text-xs font-semibold text-amber-600/80 uppercase tracking-wide flex items-center gap-1.5">
          <Crown size={11} /> Golden Templates
        </div>
      )}
      <div className="space-y-2">
        {styles.filter(s => s.is_golden).map(s => (
          <StyleCard
            key={s.id} style={s} onClick={() => setSelected(s)}
            onDelete={() => { if (confirm(`Delete "${s.name}"?`)) deleteMutation.mutate(s.id) }}
            onDuplicate={() => duplicateMutation.mutate(s.id)}
          />
        ))}
        {styles.some(s => s.is_golden) && styles.some(s => !s.is_golden) && (
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide pt-1">Your Styles</div>
        )}
        {styles.filter(s => !s.is_golden).map(s => (
          <StyleCard
            key={s.id} style={s} onClick={() => setSelected(s)}
            onDelete={() => { if (confirm(`Delete "${s.name}"?`)) deleteMutation.mutate(s.id) }}
            onDuplicate={() => duplicateMutation.mutate(s.id)}
          />
        ))}
      </div>
    </div>
  )
}
