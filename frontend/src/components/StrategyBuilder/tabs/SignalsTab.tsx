import React from 'react'
import { ArrowDownUp } from 'lucide-react'
import { Section, Field } from '../primitives'
import { ConditionBuilder } from '../ConditionBuilder'
import type { StrategyConfig } from '../../../types'

const MIRROR_OP: Record<string, string> = {
  '>': '<', '>=': '<=', '<': '>', '<=': '>=',
  crosses_above: 'crosses_below', crosses_below: 'crosses_above',
}

function mirrorCond(cond: any): any {
  if (!cond || typeof cond !== 'object') return cond
  const type = cond.type ?? 'single'
  if (type === 'single') { const f = MIRROR_OP[cond.op]; return f ? { ...cond, op: f } : { ...cond } }
  if (type === 'all_of' || type === 'any_of' || type === 'n_of_m') return { ...cond, conditions: (cond.conditions ?? []).map(mirrorCond) }
  if (type === 'not') return { ...cond, condition: mirrorCond(cond.condition) }
  return cond
}

function mirrorConditions(conditions: any[]): any[] {
  return JSON.parse(JSON.stringify(conditions)).map(mirrorCond)
}

type Dir = 'long' | 'short'

interface Props {
  config: StrategyConfig
  setConfigKey: <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => void
  localErrors: Record<string, string>
}

export function SignalsTab({ config, setConfigKey, localErrors }: Props) {
  return (
    <div className="space-y-2">
      <Section id="entry-rules" title="Entry Rules" status={localErrors.entryDirections || localErrors.entryConditions ? 'error' : 'ready'}>
        <Field label="Directions" error={localErrors.entryDirections}>
          <div className="flex gap-3">
            {(['long', 'short'] as Dir[]).map(dir => (
              <label key={dir} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" className="accent-sky-500"
                  checked={config.entry?.directions?.includes(dir) ?? false}
                  onChange={e => {
                    const dirs = config.entry?.directions ?? []
                    setConfigKey('entry', { ...config.entry, directions: e.target.checked ? [...dirs, dir] : dirs.filter(d => d !== dir) })
                  }}
                />
                <span className="text-sm capitalize">{dir}</span>
              </label>
            ))}
          </div>
        </Field>

        <ConditionBuilder
          conditions={config.entry?.conditions ?? []}
          onChange={conds => setConfigKey('entry', { ...config.entry, conditions: conds })}
          logic={config.entry?.logic ?? 'all_of'}
          onLogicChange={logic => setConfigKey('entry', { ...config.entry, logic, long_logic: logic })}
          label="Long Conditions"
        />

        {(config.entry?.conditions?.length ?? 0) > 0 && (
          <div className="flex justify-center -my-1">
            <button type="button"
              onClick={() => {
                const mirrored = mirrorConditions(config.entry?.conditions ?? [])
                setConfigKey('entry', {
                  ...config.entry,
                  short_conditions: mirrored,
                  short_logic: config.entry?.logic ?? 'all_of',
                  directions: Array.from(new Set([...(config.entry?.directions ?? []), 'short'])),
                })
              }}
              className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all hover:opacity-80"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)',
                color: 'var(--color-accent)',
              }}
            >
              <ArrowDownUp size={12} /> Mirror Long → Short
            </button>
          </div>
        )}

        <ConditionBuilder
          conditions={config.entry?.short_conditions ?? []}
          onChange={conds => setConfigKey('entry', { ...config.entry, short_conditions: conds })}
          logic={config.entry?.short_logic ?? config.entry?.logic ?? 'all_of'}
          onLogicChange={logic => setConfigKey('entry', { ...config.entry, short_logic: logic })}
          label="Short Conditions"
        />
        {localErrors.entryConditions && <p className="text-xs text-red-400 -mt-1">{localErrors.entryConditions}</p>}
      </Section>
    </div>
  )
}
