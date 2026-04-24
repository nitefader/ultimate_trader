import React, { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Save, CheckCircle, AlertCircle, Code2, ChevronDown, ChevronUp, Cpu, Layers3, Clock3 } from 'lucide-react'
import clsx from 'clsx'
import { strategiesApi } from '../../api/strategies'
import { useStrategyForm } from './useStrategyForm'
import { CoreTab } from './tabs/CoreTab'
import { SignalsTab } from './tabs/SignalsTab'
import { StopTargetsTab } from './tabs/StopTargetsTab'
import { ExitsTab } from './tabs/ExitsTab'
import { DRAFT_STORAGE_KEY } from './constants'
import type { StrategyConfig, StrategyFeaturePlanPreviewItem } from '../../types'
import type { InitialFormState } from './useStrategyForm'

type TabId = 'core' | 'signals' | 'stopTargets' | 'exits'

const TABS: { id: TabId; label: string }[] = [
  { id: 'core', label: 'Core' },
  { id: 'signals', label: 'Signals' },
  { id: 'stopTargets', label: 'Stop & Targets' },
  { id: 'exits', label: 'Exits' },
]

function TabDot({ count }: { count: number }) {
  if (count === 0) return <span className="ml-1.5 w-2 h-2 rounded-full bg-emerald-500 inline-block" />
  return (
    <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold leading-none">
      {count}
    </span>
  )
}

function summarizeFeature(feature: StrategyFeaturePlanPreviewItem): string {
  const paramEntries = Object.entries(feature.params)
  if (!paramEntries.length) return feature.kind
  return `${feature.kind}(${paramEntries.map(([key, value]) => `${key}=${String(value)}`).join(', ')})`
}

function cleanConfig(cfg: StrategyConfig): StrategyConfig {
  const c = { ...cfg }
  if (Array.isArray(c.symbols) && c.symbols.length === 0) delete c.symbols
  const legacyConfig = c as Record<string, unknown>
  if (Array.isArray(legacyConfig.watchlist_subscriptions) && legacyConfig.watchlist_subscriptions.length === 0) {
    delete legacyConfig.watchlist_subscriptions
  }
  return c
}

export type ShellMode = 'create' | 'edit' | 'new_version'

export interface ShellSaveArgs {
  name: string
  description: string
  category: string
  durationMode: string
  config: StrategyConfig
}

interface Props {
  mode: ShellMode
  initial?: InitialFormState
  /** label shown in header */
  contextLabel?: string
  /** called when user successfully saves; receives the cleaned payload */
  onSave: (args: ShellSaveArgs) => Promise<void>
  /** optional label for the primary save button (default: "Save Strategy") */
  saveLabel?: string
  /** shown above the tab bar — e.g. edit banner with notes input */
  headerSlot?: React.ReactNode
  /** initial tab to open */
  initialTab?: TabId
}

export function StrategyBuilderShell({
  mode,
  initial,
  contextLabel,
  onSave,
  saveLabel = 'Save Strategy',
  headerSlot,
  initialTab = 'core',
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const [showJson, setShowJson] = useState(false)

  const skipDraft = mode !== 'create' || Boolean(initial)
  const form = useStrategyForm(skipDraft, initial)

  const validateMutation = useMutation({
    mutationFn: () => strategiesApi.validate(cleanConfig(form.config)),
    onSuccess: result => {
      const filteredWarnings = result.warnings.filter(
        (w: string) => !/^Unknown indicator kind '[a-z_]+_\d+'/.test(w)
      )
      form.setValidationResult({ ...result, warnings: filteredWarnings })
    },
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      onSave({
        name: form.name,
        description: form.description,
        category: form.category,
        durationMode: form.durationMode,
        config: cleanConfig(form.config),
      }),
    onSuccess: () => {
      if (mode === 'create') {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY)
      }
    },
  })

  const summaryStats = [
    { label: 'Mode', value: form.durationMode.toUpperCase(), tone: 'text-sky-300' },
    { label: 'Long', value: String(form.config.entry?.conditions?.length ?? 0), tone: 'text-emerald-300' },
    { label: 'Short', value: String(form.config.entry?.short_conditions?.length ?? 0), tone: 'text-fuchsia-300' },
    { label: 'Targets', value: String(form.config.targets?.length ?? 0), tone: 'text-amber-300' },
  ]

  const totalErrors = Object.values(form.tabErrors).reduce((a, b) => a + b, 0)

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-gray-800 bg-gray-950 px-2 py-2 mb-3">
        <div className="flex items-center gap-3 min-w-0 mb-2">
          <span className="text-[10px] uppercase tracking-widest text-sky-500 shrink-0">
            {contextLabel ?? 'Strategy Lab'}
          </span>
          <span className="text-sm font-semibold text-white truncate">{form.name || 'Untitled'}</span>
          {mode === 'create' && form.draftStatus && (
            <span className="text-[10px] text-sky-600 shrink-0">{form.draftStatus}</span>
          )}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            {summaryStats.map(stat => (
              <span key={stat.label} className="text-xs hidden sm:inline">
                <span className="text-gray-600">{stat.label} </span>
                <span className={stat.tone}>{stat.value}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { key: 'entry', label: 'Entry Rules', required: true, ok: Boolean((form.config.entry?.conditions?.length ?? 0) > 0 || (form.config.entry?.short_conditions?.length ?? 0) > 0) },
            { key: 'stop', label: 'Stop Loss', required: true, ok: Boolean(form.config.stop_loss?.method) },
            { key: 'target', label: 'Profit Target', required: true, ok: Boolean((form.config.targets?.length ?? 0) > 0) },
            { key: 'exit', label: 'Signal Exit', required: false, ok: Boolean((form.config.exit_conditions?.conditions?.length ?? 0) > 0) },
          ].map(item => (
            <span key={item.key} className={clsx(
              'text-[10px] font-medium px-2 py-0.5 rounded-full border',
              item.ok
                ? 'border-emerald-800 bg-emerald-950/40 text-emerald-400'
                : item.required
                  ? 'border-gray-700 bg-gray-900 text-gray-500'
                  : 'border-gray-800 bg-transparent text-gray-700',
            )}>
              {item.label}{item.ok ? ' ✓' : item.required ? '' : ' —'}
            </span>
          ))}
        </div>
      </div>

      {/* ── Optional header slot (e.g. notes input, edit mode banner) ── */}
      {headerSlot && <div className="shrink-0 px-1 mb-3">{headerSlot}</div>}

      {/* ── Tab strip ── */}
      <div className="shrink-0 flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-0.5 mb-3">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex-1 justify-center',
              activeTab === tab.id
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            )}
          >
            {tab.label}
            <TabDot count={form.tabErrors[tab.id] ?? 0} />
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-20">
        <div className="space-y-2">
          {activeTab === 'core' && (
            <CoreTab
              name={form.name} setName={form.setName}
              description={form.description} setDescription={form.setDescription}
              category={form.category} setCategory={form.setCategory}
              durationMode={form.durationMode} onDurationModeChange={form.handleDurationModeChange}
              config={form.config} setConfigKey={form.setConfigKey}
              localErrors={form.localErrors}
              onSwitchToSignals={() => setActiveTab('signals')}
            />
          )}
          {activeTab === 'signals' && (
            <SignalsTab config={form.config} setConfigKey={form.setConfigKey} localErrors={form.localErrors} />
          )}
          {activeTab === 'stopTargets' && (
            <StopTargetsTab config={form.config} setConfigKey={form.setConfigKey} localErrors={form.localErrors} />
          )}
          {activeTab === 'exits' && (
            <ExitsTab config={form.config} setConfigKey={form.setConfigKey} />
          )}

          {form.validationResult?.feature_plan_preview && (
            <section className="rounded-xl border border-sky-900/60 bg-sky-950/20 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sky-300">
                    <Cpu size={14} />
                    <h3 className="text-sm font-semibold">Feature Plan Preview</h3>
                  </div>
                  <p className="text-xs text-sky-100/70">
                    Canonical planner preview from strategy validation. This is the current feature demand contract the runtime would try to satisfy.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-right text-xs min-w-[220px]">
                  <div className="rounded-lg border border-sky-900/60 bg-gray-950/50 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-sky-200/60">Features</div>
                    <div className="text-lg font-semibold text-white">{form.validationResult.feature_plan_preview.features.length}</div>
                  </div>
                  <div className="rounded-lg border border-sky-900/60 bg-gray-950/50 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-sky-200/60">Symbols</div>
                    <div className="text-lg font-semibold text-white">{form.validationResult.feature_plan_preview.symbols.length || '—'}</div>
                  </div>
                  <div className="rounded-lg border border-sky-900/60 bg-gray-950/50 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-sky-200/60">Frames</div>
                    <div className="text-lg font-semibold text-white">{form.validationResult.feature_plan_preview.timeframes.join(', ') || '—'}</div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    <Layers3 size={12} />
                    Planned Features
                  </div>
                  <div className="space-y-2">
                    {form.validationResult.feature_plan_preview.features.length === 0 ? (
                      <div className="text-xs text-gray-500">No canonical feature demand was inferred from the current strategy yet.</div>
                    ) : (
                      form.validationResult.feature_plan_preview.features.map((feature, index) => (
                        <div key={`${feature.kind}-${index}`} className="rounded-md border border-gray-800 bg-gray-900/60 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-gray-100">{summarizeFeature(feature)}</div>
                            <div className="text-[11px] uppercase tracking-wide text-sky-300">{feature.timeframe}</div>
                          </div>
                          <div className="mt-1 text-xs text-gray-400">
                            Source: <span className="text-gray-200">{feature.source}</span>
                            {' · '}
                            Runtime columns: <span className="text-gray-200">{feature.runtime_columns.join(', ')}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      <Clock3 size={12} />
                      Warm-Up
                    </div>
                    <div className="space-y-2">
                      {Object.keys(form.validationResult.feature_plan_preview.warmup_bars_by_timeframe).length === 0 ? (
                        <div className="text-xs text-gray-500">No warm-up requirements inferred yet.</div>
                      ) : (
                        Object.entries(form.validationResult.feature_plan_preview.warmup_bars_by_timeframe).map(([timeframe, bars]) => (
                          <div key={timeframe} className="flex items-center justify-between text-xs rounded-md border border-gray-800 bg-gray-900/60 px-3 py-2">
                            <span className="text-gray-300">{timeframe}</span>
                            <span className="font-semibold text-white">{bars} bars</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Demand Scope</div>
                    <div className="space-y-1 text-xs text-gray-300">
                      <div>
                        Symbols:{' '}
                        <span className="text-white">
                          {form.validationResult.feature_plan_preview.symbols.length
                            ? form.validationResult.feature_plan_preview.symbols.join(', ')
                            : 'Not pinned in strategy config'}
                        </span>
                      </div>
                      <div>
                        Feature keys:{' '}
                        <span className="text-white">{form.validationResult.feature_plan_preview.feature_keys.length}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* ── JSON Preview ── */}
      {showJson && (
        <div className="rounded-xl border border-gray-800 bg-gray-950/80 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1.5"><Code2 size={12} /> Config JSON</span>
            <button onClick={() => setShowJson(false)} className="text-xs text-gray-600 hover:text-gray-400">hide</button>
          </div>
          <pre className="text-[11px] text-gray-400 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-72">
            {JSON.stringify(form.config, null, 2)}
          </pre>
        </div>
      )}

      {/* ── Sticky bottom bar ── */}
      <div className="shrink-0 fixed bottom-0 left-0 right-0 z-40 border-t border-gray-800 bg-gray-950/95 backdrop-blur-sm px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          {form.validationResult?.valid && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle size={13} /> Valid — ready to save
            </span>
          )}
          {form.validationResult && !form.validationResult.valid && (
            <div className="space-y-0.5">
              {form.validationResult.errors.map((e: string, i: number) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-red-400">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" /> {e}
                </div>
              ))}
            </div>
          )}
          {form.validationResult?.warnings?.filter((w: string) => w).map((w: string, i: number) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-amber-400">
              <span className="shrink-0">⚠</span> {w}
            </div>
          ))}
          {totalErrors > 0 && !form.validationResult && (
            <span className="text-xs text-amber-400">{totalErrors} field issue{totalErrors !== 1 ? 's' : ''} — fix before validating</span>
          )}
          {saveMutation.isError && (
            <span className="text-xs text-red-400">{(saveMutation.error as Error)?.message ?? 'Save failed'}</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            className="btn-ghost text-xs flex items-center gap-1"
            onClick={() => setShowJson(v => !v)}
            title="Toggle JSON preview"
          >
            <Code2 size={12} />
            {showJson ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
          <button
            className="btn-ghost text-sm"
            onClick={() => validateMutation.mutate()}
            disabled={validateMutation.isPending || !form.canValidate}
            title={!form.canValidate ? 'Complete all required fields first' : undefined}
          >
            {validateMutation.isPending ? 'Validating…' : 'Validate'}
          </button>
          <button
            className="btn-primary flex items-center gap-1.5 text-sm"
            onClick={() => saveMutation.mutate()}
            disabled={!form.canSave || saveMutation.isPending}
            title={!form.canSave ? 'Validate successfully before saving' : undefined}
          >
            <Save size={14} /> {saveMutation.isPending ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
