import React, { useState, useRef } from 'react'
import { Plus, Trash2, Sparkles, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { Condition } from '../../types'
import { SelectMenu } from '../SelectMenu'
import { strategiesApi } from '../../api/strategies'
import { FALLBACK_INDICATOR_KINDS } from './constants'

interface Props {
  conditions: Condition[]
  onChange: (conditions: Condition[]) => void
  logic: string
  onLogicChange: (logic: string) => void
  label?: string
  indicatorKinds?: string[]
}

const OPERATORS = ['>', '>=', '<', '<=', '==', '!=', 'crosses_above', 'crosses_below', 'between', 'in']
const FIELDS = ['close', 'open', 'high', 'low', 'volume']
type ValueType = 'literal' | 'field' | 'indicator' | 'prev_bar'

const TIMEFRAME_OPTIONS = [
  { value: '', label: 'Trade TF' },
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '1d', label: '1d' },
]

interface SingleConditionEditorProps {
  cond: Condition
  index: number
  onUpdate: (c: Condition) => void
  onDelete: () => void
  indicatorKinds: string[]
}

const LOGIC_OPTIONS = [
  { value: 'all_of', label: 'ALL conditions true' },
  { value: 'any_of', label: 'ANY condition true' },
  { value: 'n_of_m:2', label: '2 of N true' },
  { value: 'n_of_m:3', label: '3 of N true' },
  { value: 'n_of_m:4', label: '4 of N true' },
  { value: 'n_of_m:5', label: '5 of N true' },
  { value: 'n_of_m:6', label: '6 of N true' },
  { value: 'n_of_m:7', label: '7 of N true' },
]

function summarizeValue(spec: Condition['left']): string {
  if (typeof spec === 'number') return String(spec)
  if (!spec || typeof spec !== 'object') return 'Value'
  const offset = typeof spec.n_bars_back === 'number' && spec.n_bars_back > 0 ? `[${spec.n_bars_back}]` : ''
  if ('field' in spec) return `Price.${spec.field}${offset}`
  if ('indicator' in spec) {
    const tf = spec.timeframe ? `@${spec.timeframe}` : ''
    return `${String(spec.indicator)}${tf}${offset}`
  }
  if ('prev_bar' in spec) return `Prev.${spec.prev_bar}`
  return 'Value'
}

function summarizeOperator(op?: string): string {
  switch (op) {
    case 'crosses_above':
      return 'crosses above'
    case 'crosses_below':
      return 'crosses below'
    default:
      return op ?? '>'
  }
}

function getValueType(spec: Condition['left']): ValueType {
  if (!spec || typeof spec !== 'object') return 'literal'
  if ('field' in spec) return 'field'
  if ('indicator' in spec) return 'indicator'
  if ('prev_bar' in spec) return 'prev_bar'
  return 'literal'
}

function ValueEditor({
  title,
  spec,
  onChange,
  indicatorKinds,
}: {
  title: string
  spec: Condition['left']
  onChange: (s: Condition['left']) => void
  indicatorKinds: string[]
}) {
  const type = getValueType(spec)
  const val = spec as Record<string, unknown>

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.24em] text-gray-500">{title}</span>
        <span className="text-[10px] text-sky-300">{summarizeValue(spec)}</span>
      </div>
      <div className="space-y-2">
        <SelectMenu
          value={type}
          onChange={(t) => {
            if (t === 'literal') onChange(50 as any)
            else if (t === 'field') onChange({ field: 'close' })
            else if (t === 'indicator') onChange({ indicator: 'rsi_14' })
            else if (t === 'prev_bar') onChange({ prev_bar: 'close' })
          }}
          options={[
            { value: 'literal', label: 'Value' },
            { value: 'field', label: 'Price field' },
            { value: 'indicator', label: 'Study output' },
            { value: 'prev_bar', label: 'Bar offset' },
          ]}
        />

        {type === 'literal' && (
          <input
            type="number"
            className="input w-full"
            value={(spec as any) ?? 0}
            onChange={(e) => onChange(parseFloat(e.target.value) as any)}
          />
        )}
        {type === 'field' && (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px]">
            <SelectMenu
              value={(val.field as string) ?? 'close'}
              onChange={(v) => onChange({ field: v, n_bars_back: Number(val.n_bars_back ?? 0) || undefined })}
              options={FIELDS.map((f) => ({ value: f, label: f.toUpperCase() }))}
            />
            <input
              type="number"
              min="0"
              className="input w-full"
              value={Number(val.n_bars_back ?? 0)}
              onChange={(e) => {
                const n = parseInt(e.target.value) || 0
                onChange({ field: (val.field as string) ?? 'close', n_bars_back: n > 0 ? n : undefined })
              }}
              placeholder="Bars"
            />
          </div>
        )}
        {type === 'indicator' && (
          <div className="space-y-2">
            <input
              list="indicator-options"
              className="input w-full"
              value={(val.indicator as string) ?? 'rsi_14'}
              onChange={(e) => onChange({
                indicator: e.target.value,
                n_bars_back: Number(val.n_bars_back ?? 0) || undefined,
                timeframe: (val.timeframe as string) || undefined,
              })}
              placeholder="rsi_2, ema_20, ema_50..."
            />
            <datalist id="indicator-options">
              {indicatorKinds.map((i) => <option key={i} value={i} />)}
            </datalist>
            <div className="grid gap-2 sm:grid-cols-[88px_120px_minmax(0,1fr)]">
              <input
                type="number"
                min="0"
                className="input w-full"
                value={Number(val.n_bars_back ?? 0)}
                onChange={(e) => {
                  const n = parseInt(e.target.value) || 0
                  onChange({
                    indicator: (val.indicator as string) ?? 'rsi_14',
                    n_bars_back: n > 0 ? n : undefined,
                    timeframe: (val.timeframe as string) || undefined,
                  })
                }}
                placeholder="Bars"
              />
              <SelectMenu
                value={(val.timeframe as string) ?? ''}
                onChange={(tf) => onChange({
                  indicator: (val.indicator as string) ?? 'rsi_14',
                  n_bars_back: Number(val.n_bars_back ?? 0) || undefined,
                  timeframe: tf || undefined,
                })}
                options={TIMEFRAME_OPTIONS}
              />
              <div className="flex items-center text-xs text-gray-500">
                Bar offset · Timeframe override
              </div>
            </div>
          </div>
        )}
        {type === 'prev_bar' && (
          <SelectMenu
            value={(val.prev_bar as string) ?? 'close'}
            onChange={(v) => onChange({ prev_bar: v })}
            options={FIELDS.map((f) => ({ value: f, label: `Prev ${f}` }))}
          />
        )}
      </div>
    </div>
  )
}

function SingleConditionEditor({ cond, index, onUpdate, onDelete, indicatorKinds }: SingleConditionEditorProps) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 via-gray-900 to-slate-950/90 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-gray-500">Rule {index + 1}</div>
          <div className="mt-1 text-sm text-gray-200">
            {summarizeValue(cond.left)} <span className="text-sky-300">{summarizeOperator(cond.op)}</span> {summarizeValue(cond.right)}
          </div>
        </div>
        <button
          type="button"
          className="rounded-lg border border-gray-800 bg-gray-950/70 px-2 py-2 text-gray-500 transition hover:border-red-800 hover:text-red-400"
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)]">
        <ValueEditor title="Left side" spec={cond.left} onChange={(v) => onUpdate({ ...cond, left: v })} indicatorKinds={indicatorKinds} />

        <div className="rounded-xl border border-sky-900/40 bg-sky-950/20 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.24em] text-sky-300">Comparator</div>
          <SelectMenu
            value={cond.op ?? '>'}
            onChange={(v) => onUpdate({ ...cond, op: v })}
            options={OPERATORS.map((op) => ({ value: op, label: op }))}
          />
          <div className="mt-3 text-xs text-gray-500">
            This defines how the trigger compares the left and right study values.
          </div>
        </div>

        <ValueEditor title="Right side" spec={cond.right} onChange={(v) => onUpdate({ ...cond, right: v })} indicatorKinds={indicatorKinds} />
      </div>
    </div>
  )
}

export function ConditionBuilder({ conditions, onChange, logic, onLogicChange, label = 'Conditions', indicatorKinds: propKinds }: Props) {
  const { data: fetchedKinds } = useQuery({
    queryKey: ['indicator-kinds'],
    queryFn: strategiesApi.indicatorKinds,
    staleTime: Infinity,
  })
  const indicatorKinds = propKinds ?? fetchedKinds ?? FALLBACK_INDICATOR_KINDS

  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setAiError(null)
    try {
      const result = await strategiesApi.generateConditions(aiPrompt.trim())
      if (result.conditions.length > 0) {
        onChange(result.conditions)
        onLogicChange(result.logic)
        setAiOpen(false)
        setAiPrompt('')
      } else {
        setAiError('AI returned no conditions. Try a more specific description.')
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } }
      const status = axiosErr?.response?.status
      const detail = axiosErr?.response?.data?.detail
      if (status === 424) {
        setAiError(`AI service not configured. ${detail ?? 'Go to Services → add a Groq or Gemini key and set it as Default AI.'}`)
      } else {
        setAiError(detail ?? (err instanceof Error ? err.message : 'Generation failed'))
      }
    } finally {
      setAiLoading(false)
    }
  }

  const addCondition = () => {
    onChange([
      ...conditions,
      { type: 'single', left: { field: 'close' }, op: '>', right: { indicator: 'ema_21' } },
    ])
  }

  const updateCondition = (i: number, c: Condition) => {
    const updated = [...conditions]
    updated[i] = c
    onChange(updated)
  }

  const deleteCondition = (i: number) => {
    onChange(conditions.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-800 bg-gradient-to-r from-slate-950 via-gray-950 to-gray-900 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <label className="label mb-2">{label}</label>
          <div className="text-xs text-gray-500">
            Build trade triggers as study expressions, then choose how many must confirm before entry.
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-[220px]">
            <SelectMenu
              value={logic}
              onChange={(v) => onLogicChange(v)}
              options={LOGIC_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
          <button
            type="button"
            className="flex items-center justify-center gap-1.5 rounded-lg border border-violet-700/60 bg-violet-950/50 px-3 py-2 text-xs text-violet-300 transition hover:border-violet-500 hover:bg-violet-900/50 hover:text-violet-100"
            onClick={() => { setAiOpen(o => !o); setAiError(null) }}
          >
            <Sparkles size={12} />
            Generate with AI
            {aiOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button className="btn-primary flex items-center justify-center gap-1.5 px-3 py-2 text-xs" onClick={addCondition}>
            <Plus size={12} /> Add Study Trigger
          </button>
        </div>
      </div>

      {aiOpen && (
        <div className="rounded-2xl border border-violet-800/50 bg-gradient-to-br from-violet-950/40 via-gray-950 to-gray-900 p-4 shadow-[0_0_24px_rgba(109,40,217,0.12)]">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles size={14} className="text-violet-400" />
            <span className="text-xs font-medium text-violet-300 uppercase tracking-widest">AI Condition Generator</span>
          </div>
          <p className="mb-3 text-xs text-gray-400">
            Describe your entry signal in plain English. The AI will generate a condition tree using your available indicators.
          </p>
          <textarea
            ref={textareaRef}
            className="w-full rounded-xl border border-gray-700 bg-gray-950/80 px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600/40 resize-none"
            rows={3}
            placeholder="e.g. Buy when RSI crosses above 30 and price is above the 20-period EMA and MACD histogram is positive"
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate() }}
            disabled={aiLoading}
          />
          {aiError && (
            <div className="mt-2 rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {aiError}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[10px] text-gray-600">Ctrl+Enter to generate · Replaces current conditions</span>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleGenerate}
              disabled={aiLoading || !aiPrompt.trim()}
            >
              {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {aiLoading ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      )}

      {conditions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/40 px-4 py-8 text-center">
          <div className="text-sm text-gray-300">No study triggers yet</div>
          <div className="mt-1 text-xs text-gray-500">Start with a simple expression like close {'>'} ema_21 or rsi_14 crosses_above 50.</div>
        </div>
      )}

      <div className="space-y-3">
        {conditions.map((cond, i) => (
          <SingleConditionEditor
            key={i}
            index={i}
            cond={cond}
            onUpdate={(c) => updateCondition(i, c)}
            onDelete={() => deleteCondition(i)}
            indicatorKinds={indicatorKinds}
          />
        ))}
      </div>

      {conditions.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs text-gray-500">
          {logic === 'all_of' && `Entry fires only when all ${conditions.length} study triggers confirm on the same bar.`}
          {logic === 'any_of' && `Entry fires when at least one of the ${conditions.length} study triggers confirms.`}
          {logic.startsWith('n_of_m:') && (() => {
            const n = parseInt(logic.split(':')[1])
            return `Entry fires when ${n} of ${conditions.length} study triggers confirm, allowing ${Math.max(conditions.length - n, 0)} to fail.`
          })()}
        </div>
      )}
    </div>
  )
}
