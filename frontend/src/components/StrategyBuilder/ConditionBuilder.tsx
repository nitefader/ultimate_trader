import React, { useState } from 'react'
import { Plus, Trash2, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import type { Condition } from '../../types'
import { SelectMenu } from '../SelectMenu'

interface Props {
  conditions: Condition[]
  onChange: (conditions: Condition[]) => void
  logic: string
  onLogicChange: (logic: string) => void
  label?: string
}

const OPERATORS = ['>', '>=', '<', '<=', '==', '!=', 'crosses_above', 'crosses_below', 'between', 'in']
const FIELDS = ['close', 'open', 'high', 'low', 'volume']
const INDICATORS = [
  'rsi_14', 'rsi_7', 'ema_9', 'ema_21', 'ema_55', 'ema_200',
  'sma_20', 'sma_50', 'sma_200', 'atr_14', 'adx', 'plus_di', 'minus_di',
  'macd', 'macd_signal', 'macd_hist', 'bb_upper', 'bb_lower', 'bb_mid',
  'stoch_k', 'stoch_d',
]

type ValueType = 'literal' | 'field' | 'indicator' | 'prev_bar'

interface SingleConditionEditorProps {
  cond: Condition
  onUpdate: (c: Condition) => void
  onDelete: () => void
}

function SingleConditionEditor({ cond, onUpdate, onDelete }: SingleConditionEditorProps) {
  const getValueType = (spec: Condition['left']): ValueType => {
    if (!spec || typeof spec !== 'object') return 'literal'
    if ('field' in spec) return 'field'
    if ('indicator' in spec) return 'indicator'
    if ('prev_bar' in spec) return 'prev_bar'
    return 'literal'
  }

  const renderValueEditor = (
    spec: Condition['left'],
    onChange: (s: Condition['left']) => void,
    side: string,
  ) => {
    const type = getValueType(spec)
    const val = spec as Record<string, unknown>

    return (
      <div className="flex items-center gap-1">
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
            { value: 'field', label: 'Field' },
            { value: 'indicator', label: 'Indicator' },
            { value: 'prev_bar', label: 'Prev Bar' },
          ]}
        />

        {type === 'literal' && (
          <input
            type="number"
            className="input text-xs py-1 w-20"
            value={(spec as any) ?? 0}
            onChange={(e) => onChange(parseFloat(e.target.value) as any)}
          />
        )}
        {type === 'field' && (
          <SelectMenu
            value={val.field as string ?? 'close'}
            onChange={(v) => onChange({ field: v })}
            options={FIELDS.map(f => ({ value: f, label: f }))}
          />
        )}
        {type === 'indicator' && (
          <SelectMenu
            value={val.indicator as string ?? 'rsi_14'}
            onChange={(v) => onChange({ indicator: v })}
            options={INDICATORS.map(i => ({ value: i, label: i }))}
          />
        )}
        {type === 'prev_bar' && (
          <SelectMenu
            value={val.prev_bar as string ?? 'close'}
            onChange={(v) => onChange({ prev_bar: v })}
            options={FIELDS.map(f => ({ value: f, label: f }))}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 bg-gray-800 rounded p-2">
      {renderValueEditor(cond.left, (v) => onUpdate({ ...cond, left: v }), 'left')}

      <SelectMenu
        value={cond.op ?? '>'}
        onChange={(v) => onUpdate({ ...cond, op: v })}
        options={OPERATORS.map(op => ({ value: op, label: op }))}
      />

      {renderValueEditor(cond.right, (v) => onUpdate({ ...cond, right: v }), 'right')}

      <button className="text-gray-500 hover:text-red-400 ml-auto" onClick={onDelete}>
        <Trash2 size={12} />
      </button>
    </div>
  )
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

export function ConditionBuilder({ conditions, onChange, logic, onLogicChange, label = 'Conditions' }: Props) {
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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="label">{label}</label>
        <div className="flex items-center gap-2">
          <SelectMenu
            value={logic}
            onChange={(v) => onLogicChange(v)}
            options={LOGIC_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
          />
          <button className="btn-ghost text-xs flex items-center gap-1 py-1 px-2" onClick={addCondition}>
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {conditions.length === 0 && (
        <div className="text-gray-600 text-xs text-center py-4 border border-dashed border-gray-700 rounded">
          No conditions — click Add to define entry rules
        </div>
      )}

      <div className="space-y-1.5">
        {conditions.map((cond, i) => (
          <SingleConditionEditor
            key={i}
            cond={cond}
            onUpdate={(c) => updateCondition(i, c)}
            onDelete={() => deleteCondition(i)}
          />
        ))}
      </div>

      {conditions.length > 0 && (
        <div className="text-xs text-gray-500">
          {logic === 'all_of' && `All ${conditions.length} conditions must be true`}
          {logic === 'any_of' && `At least 1 of ${conditions.length} conditions must be true`}
          {logic.startsWith('n_of_m:') && (() => {
            const n = parseInt(logic.split(':')[1])
            return `${n} of ${conditions.length} conditions must be true (${conditions.length - n} can fail)`
          })()}
        </div>
      )}
    </div>
  )
}
