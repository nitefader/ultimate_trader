import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Section, Field } from '../primitives'
import { ConditionBuilder } from '../ConditionBuilder'
import type { StrategyConfig } from '../../../types'

interface Props {
  config: StrategyConfig
  setConfigKey: <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => void
}

export function ExitsTab({ config, setConfigKey }: Props) {
  const isShort = config.entry?.directions?.includes('short') ?? false
  const longExit = config.exit_conditions ?? { logic: 'any_of', conditions: [] }
  const shortExit = config.short_exit_conditions ?? { logic: 'any_of', conditions: [] }

  return (
    <div className="space-y-2">
      <Section id="signal-exits" title="Signal-Based Exits" status="neutral">
        <p className="text-xs text-gray-500 mb-2">Optional — trigger exit before stop/target fires.</p>
        <ConditionBuilder
          conditions={longExit.conditions ?? []}
          onChange={conds => setConfigKey('exit_conditions', { ...longExit, conditions: conds })}
          logic={longExit.logic ?? 'any_of'}
          onLogicChange={logic => setConfigKey('exit_conditions', { ...longExit, logic })}
          label="Long Exit Triggers"
        />
        {isShort && (
          <ConditionBuilder
            conditions={shortExit.conditions ?? []}
            onChange={conds => setConfigKey('short_exit_conditions', { ...shortExit, conditions: conds })}
            logic={shortExit.logic ?? 'any_of'}
            onLogicChange={logic => setConfigKey('short_exit_conditions', { ...shortExit, logic })}
            label="Short Exit Triggers"
          />
        )}
      </Section>

      <Section id="time-exit" title="Time-Based Exit" status="neutral">
        <p className="text-xs text-gray-500 mb-2">Force-exit after N bars regardless of P&amp;L.</p>
        {config.exit?.max_bars == null ? (
          <button className="btn-ghost text-xs flex items-center gap-1"
            onClick={() => setConfigKey('exit', { ...config.exit, max_bars: 20 })}>
            <Plus size={12} /> Add max bars exit
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <Field label="Max Bars Hold">
              <input type="number" className="input w-32"
                value={config.exit?.max_bars ?? 20}
                onChange={e => setConfigKey('exit', { ...config.exit, max_bars: parseInt(e.target.value) || undefined })} />
            </Field>
            <button className="mt-5 text-gray-500 hover:text-red-400"
              onClick={() => { const ex = { ...config.exit }; delete ex.max_bars; setConfigKey('exit', ex) }}>
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </Section>
    </div>
  )
}
