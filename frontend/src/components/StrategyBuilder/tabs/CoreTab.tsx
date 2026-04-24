import React, { useState, useRef } from 'react'
import { Clock, TrendingUp, ShieldAlert, Sparkles, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { SelectMenu } from '../../SelectMenu'
import { Section, Field } from '../primitives'
import { MicButton } from '../useSpeechInput'
import { strategiesApi } from '../../../api/strategies'
import type { StrategyConfig, DurationMode } from '../../../types'

interface Props {
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  category: string
  setCategory: (v: string) => void
  durationMode: DurationMode
  onDurationModeChange: (m: DurationMode) => void
  config: StrategyConfig
  setConfigKey: <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => void
  localErrors: Record<string, string>
  onSwitchToSignals?: () => void
}

export function CoreTab({
  name, setName, description, setDescription, category, setCategory,
  durationMode, onDurationModeChange, config, setConfigKey,
  localErrors, onSwitchToSignals,
}: Props) {
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiMessages, setAiMessages] = useState<{ type: 'warning' | 'assumption'; text: string }[]>([])
  const promptRef = useRef<HTMLInputElement>(null)

  const hasContent = Boolean(name || description || config.hypothesis)

  const briefMutation = useMutation({
    mutationFn: () => strategiesApi.generateBrief(aiPrompt),
    onSuccess: (result) => {
      const apply = () => {
        if (result.name) setName(result.name)
        if (result.hypothesis) setConfigKey('hypothesis', result.hypothesis)
        if (result.description) setDescription(result.description)
        const hasLong = result.conditions?.length > 0
        const hasShort = result.short_conditions?.length > 0
        if (hasLong || hasShort) {
          const dirs: string[] = []
          if (hasLong) dirs.push('long')
          if (hasShort) dirs.push('short')
          setConfigKey('entry', {
            ...config.entry,
            directions: dirs,
            conditions: result.conditions ?? [],
            logic: result.logic ?? 'all_of',
            ...(hasShort && {
              short_conditions: result.short_conditions,
              short_logic: result.short_logic ?? 'all_of',
            }),
          })
        }
        const msgs: { type: 'warning' | 'assumption'; text: string }[] = [
          ...result.assumptions.map(t => ({ type: 'assumption' as const, text: t })),
          ...result.warnings.map(t => ({ type: 'warning' as const, text: t })),
        ]
        setAiMessages(msgs)
        // Always keep panel open after generation so prompt + messages stay visible
        setAiOpen(true)
        // Only switch to Signals if there are no messages needing attention
        const hasAnyConditions = (result.conditions?.length ?? 0) > 0 || (result.short_conditions?.length ?? 0) > 0
        if (hasAnyConditions && msgs.length === 0 && onSwitchToSignals) {
          onSwitchToSignals()
        }
      }

      if (hasContent && (result.name || result.hypothesis || result.description)) {
        if (window.confirm('Replace existing content with AI-generated fields?')) apply()
      } else {
        apply()
      }
    },
  })

  return (
    <div className="space-y-2">
      {/* Strategy metadata */}
      <Section id="strategy-info" title="Strategy Info" status={localErrors.name || localErrors.hypothesis ? 'error' : 'ready'}>
        {/* AI Brief Generator */}
        <div className="mb-2">
          <button
            type="button"
            onClick={() => { setAiOpen(o => !o); setTimeout(() => promptRef.current?.focus(), 50) }}
            className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <Sparkles size={12} />
            Generate with AI
            {aiOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>

          {aiOpen && (
            <div className="mt-2 space-y-2">
              <div className="flex gap-2">
                <input
                  ref={promptRef}
                  className="input flex-1 text-xs"
                  placeholder="e.g. RSI mean reversion on small caps with volume confirmation"
                  value={aiPrompt}
                  onChange={e => { setAiPrompt(e.target.value); setAiMessages([]) }}
                  disabled={briefMutation.isPending}
                  onKeyDown={e => { if (e.key === 'Enter' && aiPrompt.trim().length >= 3) briefMutation.mutate() }}
                />
                <button
                  className="btn-primary text-xs flex items-center gap-1.5 shrink-0"
                  onClick={() => briefMutation.mutate()}
                  disabled={briefMutation.isPending || aiPrompt.trim().length < 3}
                >
                  {briefMutation.isPending
                    ? <><Loader2 size={11} className="animate-spin" /> Generating…</>
                    : 'Generate'}
                </button>
              </div>

              {briefMutation.isError && (
                <p className="text-xs text-red-400">
                  {(briefMutation.error as { message?: string })?.message ?? 'Generation failed — check your AI service is configured.'}
                </p>
              )}

              {aiMessages.map((m, i) => (
                <p key={i} className={`text-xs ${m.type === 'warning' ? 'text-amber-400' : 'text-sky-400'}`}>
                  {m.type === 'warning' ? '⚠ ' : '→ '}{m.text}
                </p>
              ))}
            </div>
          )}
        </div>

        <Field label="Hypothesis (your edge)" error={localErrors.hypothesis}>
          <div className="flex items-start gap-1">
            <textarea
              className="input w-full resize-none" rows={2}
              value={config.hypothesis ?? ''}
              onChange={e => setConfigKey('hypothesis', e.target.value)}
              placeholder="Example: Momentum breakouts with expanding volume outperform in trending regimes."
            />
            <MicButton onTranscript={t => setConfigKey('hypothesis', (config.hypothesis ? config.hypothesis + ' ' : '') + t)} />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" error={localErrors.name}>
            <div className="flex items-center gap-1">
              <input className="input w-full" value={name} onChange={e => setName(e.target.value)} />
              <MicButton onTranscript={t => setName(t.trim())} />
            </div>
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
          <div className="flex items-start gap-1">
            <textarea
              className="input w-full resize-none" rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What does this strategy do?"
            />
            <MicButton onTranscript={t => setDescription((description ? description + ' ' : '') + t)} />
          </div>
        </Field>
      </Section>

      {/* Duration mode — kept here so user defines the strategy's intended hold period */}
      <Section id="trading-mode" title="Trading Mode" status="neutral">
        <Field label="Duration Mode" hint="Defines the hold period and which Universe Profile types are compatible.">
          <div className="grid grid-cols-3 gap-3 mt-1">
            {([
              { value: 'day' as DurationMode, icon: <Clock size={14} />, label: 'Day', desc: 'Intraday only — flat by close. PDT rules apply. Best on 1m–15m bars.' },
              { value: 'swing' as DurationMode, icon: <TrendingUp size={14} />, label: 'Swing', desc: 'Holds 1–10 days. Overnight risk. Daily or hourly bars.' },
              { value: 'position' as DurationMode, icon: <ShieldAlert size={14} />, label: 'Position', desc: 'Multi-week hold. Daily bars. Gap risk controls + earnings blackout.' },
            ] as const).map(({ value, icon, label, desc }) => (
              <button
                key={value} type="button"
                onClick={() => onDurationModeChange(value)}
                className={`flex flex-col items-start gap-1 p-3 rounded border text-left transition-colors ${
                  durationMode === value
                    ? 'border-sky-500 bg-sky-950/40 text-sky-200'
                    : 'border-gray-700 bg-gray-900/40 text-gray-400 hover:border-gray-500'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-sm">{icon} {label}</div>
                <p className="text-[11px] leading-relaxed">{desc}</p>
              </button>
            ))}
          </div>
        </Field>
        <p className="text-[11px] text-gray-600 mt-1">
          Session hours, PDT rules, regime filter, and cooldowns are configured in Strategy Controls attached to a Program.
        </p>
      </Section>
    </div>
  )
}
