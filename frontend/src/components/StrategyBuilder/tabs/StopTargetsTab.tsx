import React, { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Section, Field } from '../primitives'
import { SelectMenu } from '../../SelectMenu'
import type { StrategyConfig, StopConfig, TargetConfig } from '../../../types'

const STOP_METHODS = [
  { value: 'fixed_pct',    label: 'Fixed %' },
  { value: 'fixed_dollar', label: 'Fixed $' },
  { value: 'atr_multiple', label: 'ATR Multiple' },
  { value: 'chandelier',   label: 'Chandelier' },
  { value: 'swing_low',    label: 'Swing Low/High' },
  { value: 'prev_bar_low', label: 'Prev Bar Low/High' },
  { value: 'n_bars_low',   label: 'N-Bar Low/High' },
]

const TARGET_METHODS = [
  { value: 'r_multiple',   label: 'R Multiple' },
  { value: 'fixed_pct',    label: 'Fixed %' },
  { value: 'fixed_dollar', label: 'Fixed $' },
  { value: 'atr_multiple', label: 'ATR Multiple' },
  { value: 'swing_high',   label: 'Swing High/Low' },
  { value: 'prev_day_high', label: 'Prev Day High/Low' },
]

// Timeframe options for ATR override — blank = use trade timeframe
const ATR_TF_OPTIONS = [
  { value: '',    label: 'Trade TF' },
  { value: '1m',  label: '1m' },
  { value: '5m',  label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h',  label: '1h' },
  { value: '4h',  label: '4h' },
  { value: '1d',  label: '1d' },
]

type Dir = 'long' | 'short'

function DirToggle({ value, onChange, show }: { value: Dir; onChange: (d: Dir) => void; show: boolean }) {
  if (!show) return null
  return (
    <div className="inline-flex rounded border border-gray-700 overflow-hidden text-xs mb-3">
      {(['long', 'short'] as Dir[]).map(d => (
        <button key={d} onClick={() => onChange(d)}
          className={`px-3 py-1 capitalize ${value === d ? 'bg-sky-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
          {d}
        </button>
      ))}
    </div>
  )
}

function AtrFields<T extends { period?: number; mult?: number; timeframe?: string }>({
  cfg, onChange,
}: {
  cfg: T
  onChange: (patch: Partial<T>) => void
}) {
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-faint)' }}>Period</label>
        <input type="number" className="input w-16 text-xs py-1" placeholder="14"
          value={cfg.period ?? ''}
          onChange={e => onChange({ period: parseInt(e.target.value) || undefined } as Partial<T>)} />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-faint)' }}>Mult</label>
        <input type="number" className="input w-16 text-xs py-1" placeholder="2.0" step="0.1"
          value={cfg.mult ?? ''}
          onChange={e => onChange({ mult: parseFloat(e.target.value) || undefined } as Partial<T>)} />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-faint)' }}>ATR TF</label>
        <div className="w-24">
          <SelectMenu
            value={cfg.timeframe ?? ''}
            onChange={v => onChange({ timeframe: v || undefined } as Partial<T>)}
            options={ATR_TF_OPTIONS}
          />
        </div>
      </div>
    </>
  )
}

function StopEditor({ stop, onChange }: { stop: StopConfig; onChange: (s: StopConfig) => void }) {
  const isAtr = stop.method === 'atr_multiple' || stop.method === 'chandelier'
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-faint)' }}>Method</label>
        <div className="w-44">
          <SelectMenu value={stop.method} onChange={v => onChange({ ...stop, method: v })} options={STOP_METHODS} />
        </div>
      </div>

      {(stop.method === 'fixed_pct' || stop.method === 'fixed_dollar') && (
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-faint)' }}>
            {stop.method === 'fixed_pct' ? 'Pct %' : 'Amount $'}
          </label>
          <input type="number" className="input w-24 text-xs py-1" placeholder="2.0"
            value={stop.value ?? ''}
            onChange={e => onChange({ ...stop, value: parseFloat(e.target.value) || undefined })} />
        </div>
      )}

      {stop.method === 'n_bars_low' && (
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-faint)' }}>Bars</label>
          <input type="number" className="input w-16 text-xs py-1" placeholder="3"
            value={stop.value ?? ''}
            onChange={e => onChange({ ...stop, value: parseInt(e.target.value) || undefined })} />
        </div>
      )}

      {isAtr && (
        <AtrFields
          cfg={stop}
          onChange={patch => onChange({ ...stop, ...patch })}
        />
      )}
    </div>
  )
}

function TargetEditor({
  target, index, onChange, onRemove,
}: {
  target: TargetConfig
  index: number
  onChange: (t: TargetConfig) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-faint)' }}>
          T{index + 1} Method
        </label>
        <div className="w-40">
          <SelectMenu value={target.method} onChange={v => onChange({ ...target, method: v })} options={TARGET_METHODS} />
        </div>
      </div>

      {target.method === 'r_multiple' && (
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-faint)' }}>R Value</label>
          <input type="number" className="input w-20 text-xs py-1" placeholder="2.0" step="0.5"
            value={target.r ?? ''}
            onChange={e => onChange({ ...target, r: parseFloat(e.target.value) || undefined })} />
        </div>
      )}

      {(target.method === 'fixed_pct' || target.method === 'fixed_dollar') && (
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-faint)' }}>
            {target.method === 'fixed_pct' ? 'Pct %' : 'Amount $'}
          </label>
          <input type="number" className="input w-24 text-xs py-1" placeholder="4.0"
            value={target.value ?? ''}
            onChange={e => onChange({ ...target, value: parseFloat(e.target.value) || undefined })} />
        </div>
      )}

      {target.method === 'atr_multiple' && (
        <AtrFields
          cfg={target}
          onChange={patch => onChange({ ...target, ...patch })}
        />
      )}

      <button onClick={onRemove} className="mb-0.5 text-gray-500 hover:text-red-400" title="Remove target">
        <Trash2 size={12} />
      </button>
    </div>
  )
}

interface Props {
  config: StrategyConfig
  setConfigKey: <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => void
  localErrors: Record<string, string>
}

export function StopTargetsTab({ config, setConfigKey, localErrors }: Props) {
  const [stopDir, setStopDir] = useState<Dir>('long')
  const [targetDir, setTargetDir] = useState<Dir>('long')

  const isShort = config.entry?.directions?.includes('short') ?? false

  const longStop = config.stop_loss ?? { method: 'fixed_pct', value: 2.0 }
  const shortStop = config.short_stop_loss ?? longStop
  const activeStop = stopDir === 'long' ? longStop : shortStop
  function setStop(s: StopConfig) {
    if (stopDir === 'long') setConfigKey('stop_loss', s)
    else setConfigKey('short_stop_loss', s)
  }

  const longTargets = config.targets ?? []
  const shortTargets = config.short_targets ?? []
  const activeTargets = targetDir === 'long' ? longTargets : shortTargets
  function setTargets(t: TargetConfig[]) {
    if (targetDir === 'long') setConfigKey('targets', t)
    else setConfigKey('short_targets', t)
  }

  const stopStatus = localErrors.stopMethod || localErrors.stopValue || localErrors.stopPeriod || localErrors.stopMult
    ? 'error' as const : 'ready' as const
  const targetStatus = localErrors.targets ? 'error' as const : 'ready' as const

  return (
    <div className="space-y-2">
      <Section id="stop-loss" title="Stop Loss" status={stopStatus}>
        <DirToggle value={stopDir} onChange={setStopDir} show={isShort} />
        <StopEditor stop={activeStop} onChange={setStop} />
        {localErrors.stopMethod && <p className="text-xs text-red-400 mt-1">{localErrors.stopMethod}</p>}
        {localErrors.stopValue  && <p className="text-xs text-red-400 mt-1">{localErrors.stopValue}</p>}
        {localErrors.stopPeriod && <p className="text-xs text-red-400 mt-1">{localErrors.stopPeriod}</p>}
        {localErrors.stopMult   && <p className="text-xs text-red-400 mt-1">{localErrors.stopMult}</p>}
        {isShort && stopDir === 'short' && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-faint)' }}>
            Short stop triggers when price rises above entry by this amount.
          </p>
        )}
        {(activeStop.method === 'atr_multiple' || activeStop.method === 'chandelier') && activeStop.timeframe && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-faint)' }}>
            ATR computed on {activeStop.timeframe} bars — only completed bars used (no lookahead).
          </p>
        )}
      </Section>

      <Section id="targets" title="Profit Targets" status={targetStatus}>
        <DirToggle value={targetDir} onChange={setTargetDir} show={isShort} />
        <div className="space-y-3">
          {activeTargets.map((t, i) => (
            <TargetEditor key={i} index={i} target={t}
              onChange={updated => { const next = [...activeTargets]; next[i] = updated; setTargets(next) }}
              onRemove={() => setTargets(activeTargets.filter((_, idx) => idx !== i))} />
          ))}
        </div>
        <button className="btn-ghost text-xs flex items-center gap-1 mt-2"
          onClick={() => setTargets([...activeTargets, { method: 'r_multiple', r: 2.0 }])}>
          <Plus size={12} /> Add Target
        </button>
        {localErrors.targets && <p className="text-xs text-red-400 mt-1">{localErrors.targets}</p>}
        {activeTargets.some(t => t.method === 'atr_multiple' && t.timeframe) && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-faint)' }}>
            ATR targets on custom timeframes use completed bars only (no lookahead).
          </p>
        )}
      </Section>
    </div>
  )
}
