import React, { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { strategiesApi } from '../api/strategies'
import { ConditionBuilder } from '../components/StrategyBuilder/ConditionBuilder'
import { SelectMenu } from '../components/SelectMenu'
import { Pencil, Save, X, Plus, Trash2, ChevronDown, ChevronUp, Code, AlertTriangle, TrendingUp } from 'lucide-react'
import clsx from 'clsx'
import type { Strategy, StrategyVersion, StrategyConfig, Condition, CooldownRule, ScaleLevel } from '../types'

const DRAFT_STATUSES = new Set(['backtest_only'])
const LIVE_STATUSES = new Set(['paper_approved', 'live_approved'])

const STOP_METHODS = ['fixed_pct', 'fixed_dollar', 'atr_multiple', 'prev_bar_low', 'n_bars_low', 'swing_low', 'fvg_low', 'sr_support', 'chandelier']
const TARGET_METHODS = ['r_multiple', 'fixed_pct', 'atr_multiple', 'sr_resistance', 'swing_high', 'prev_day_high']
const SIZING_METHODS = ['risk_pct', 'fixed_shares', 'fixed_dollar', 'fixed_pct_equity', 'atr_risk', 'kelly']
const REGIMES = ['trending_up', 'trending_down', 'ranging', 'high_volatility', 'low_volatility']
const COOLDOWN_TRIGGERS = ['loss', 'win', 'stop_out', 'target_hit', 'any_exit', 'consecutive_loss']
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo']

function pretty(obj: unknown): string {
  try { return JSON.stringify(obj, null, 2) } catch { return String(obj) }
}

/* ── Reusable read-only display helpers ────────────────── */

function Pill({ children, color = 'gray' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-800 text-gray-300',
    sky: 'bg-sky-900/50 text-sky-300',
    emerald: 'bg-emerald-900/50 text-emerald-300',
    amber: 'bg-amber-900/50 text-amber-300',
    red: 'bg-red-900/50 text-red-300',
  }
  return <span className={clsx('px-2 py-0.5 rounded text-xs font-mono', colors[color] ?? colors.gray)}>{children}</span>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="text-xs text-gray-500 w-40 shrink-0">{label}</span>
      <span className="text-sm text-gray-200">{children}</span>
    </div>
  )
}

function SectionCard({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card">
      <button className="flex items-center justify-between w-full text-left" onClick={() => setOpen(o => !o)}>
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        {open ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
      </button>
      {open && <div className="mt-3 space-y-2">{children}</div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>
}

function conditionToHuman(c: Condition): string {
  if (c.type === 'single') {
    const left = c.left?.indicator ?? c.left?.field ?? c.left?.prev_bar ?? '?'
    const right = typeof c.right === 'object' ? (c.right?.indicator ?? c.right?.field ?? c.right?.prev_bar ?? JSON.stringify(c.right)) : String(c.right ?? '?')
    return `${left} ${c.op ?? '?'} ${right}`
  }
  if (c.type === 'all_of' && c.conditions) return `ALL( ${c.conditions.map(conditionToHuman).join(' AND ')} )`
  if (c.type === 'any_of' && c.conditions) return `ANY( ${c.conditions.map(conditionToHuman).join(' OR ')} )`
  if (c.type === 'n_of_m' && c.conditions) return `${c.n ?? '?'}_of_${c.conditions.length}( ${c.conditions.map(conditionToHuman).join(', ')} )`
  if (c.type === 'regime_filter') return `regime ∈ [${c.allowed?.join(', ') ?? ''}]`
  if (c.type === 'not' && c.condition) return `NOT( ${conditionToHuman(c.condition)} )`
  return JSON.stringify(c)
}

/* ── Read-only config viewer ──────────────────────────── */

function ConfigViewer({ config }: { config: StrategyConfig }) {
  return (
    <div className="space-y-4">
      {config.hypothesis && (
        <SectionCard title="Hypothesis">
          <p className="text-sm text-gray-300 italic">"{config.hypothesis}"</p>
        </SectionCard>
      )}

      <SectionCard title="Universe & Timeframe">
        <Row label="Symbols">
          <div className="flex flex-wrap gap-1">
            {(config.symbols ?? []).map(s => <Pill key={s} color="sky">{s}</Pill>)}
            {(!config.symbols || config.symbols.length === 0) && <span className="text-gray-500 text-xs">Not set</span>}
          </div>
        </Row>
        <Row label="Timeframe"><Pill>{config.timeframe ?? '—'}</Pill></Row>
        {config.leverage != null && config.leverage !== 1 && (
          <Row label="Leverage"><Pill color="amber">{config.leverage}x</Pill></Row>
        )}
      </SectionCard>

      <SectionCard title="Entry Rules">
        <Row label="Directions">
          <div className="flex gap-1">
            {(config.entry?.directions ?? []).map(d => (
              <Pill key={d} color={d === 'long' ? 'emerald' : 'red'}>{d}</Pill>
            ))}
            {(!config.entry?.directions || config.entry.directions.length === 0) && <span className="text-gray-500 text-xs">None</span>}
          </div>
        </Row>
        <Row label="Logic"><Pill>{config.entry?.logic ?? 'all_of'}</Pill></Row>
        {config.entry?.conditions && config.entry.conditions.length > 0 ? (
          <div className="space-y-1 mt-2">
            {config.entry.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-gray-800/60 px-3 py-2 text-xs font-mono text-gray-300">
                <span className="text-gray-600 w-4">{i + 1}.</span>
                {conditionToHuman(c)}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500 mt-1">No entry conditions defined</div>
        )}
      </SectionCard>

      <SectionCard title="Stop Loss">
        {config.stop_loss ? (
          <>
            <Row label="Method"><Pill>{config.stop_loss.method}</Pill></Row>
            {config.stop_loss.value != null && <Row label="Value">{config.stop_loss.value}{config.stop_loss.method.includes('pct') ? '%' : config.stop_loss.method.includes('dollar') ? '$' : ''}</Row>}
            {config.stop_loss.period != null && <Row label="Period">{config.stop_loss.period}</Row>}
            {config.stop_loss.mult != null && <Row label="Multiplier">{config.stop_loss.mult}x</Row>}
          </>
        ) : <div className="text-xs text-gray-500">No stop loss configured</div>}
      </SectionCard>

      <SectionCard title="Profit Targets">
        {config.targets && config.targets.length > 0 ? (
          <div className="space-y-1">
            {config.targets.map((t, i) => (
              <div key={i} className="flex items-center gap-3 rounded bg-gray-800/60 px-3 py-2 text-xs">
                <span className="text-gray-600">T{i + 1}</span>
                <Pill>{t.method}</Pill>
                {t.r != null && <span className="text-gray-300">{t.r}R</span>}
                {t.value != null && <span className="text-gray-300">{t.value}{t.method.includes('pct') ? '%' : ''}</span>}
              </div>
            ))}
          </div>
        ) : <div className="text-xs text-gray-500">No targets configured</div>}
      </SectionCard>

      <SectionCard title="Position Sizing">
        {config.position_sizing ? (
          <>
            <Row label="Method"><Pill>{config.position_sizing.method}</Pill></Row>
            {config.position_sizing.risk_pct != null && <Row label="Risk per trade">{config.position_sizing.risk_pct}%</Row>}
            {config.position_sizing.shares != null && <Row label="Fixed shares">{config.position_sizing.shares}</Row>}
            {config.position_sizing.amount != null && <Row label="Fixed amount">${config.position_sizing.amount}</Row>}
            {config.position_sizing.pct != null && <Row label="% of equity">{config.position_sizing.pct}%</Row>}
          </>
        ) : <div className="text-xs text-gray-500">Not configured</div>}
      </SectionCard>

      <SectionCard title="Risk Controls">
        {config.risk ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {config.risk.max_position_size_pct != null && <Row label="Max position size">{(config.risk.max_position_size_pct * 100).toFixed(1)}%</Row>}
            {config.risk.max_daily_loss_pct != null && <Row label="Max daily loss">{(config.risk.max_daily_loss_pct * 100).toFixed(1)}%</Row>}
            {config.risk.max_drawdown_lockout_pct != null && <Row label="Drawdown lockout">{(config.risk.max_drawdown_lockout_pct * 100).toFixed(1)}%</Row>}
            {config.risk.max_open_positions != null && <Row label="Max open positions">{config.risk.max_open_positions}</Row>}
            {config.risk.max_portfolio_heat != null && <Row label="Max portfolio heat">{(config.risk.max_portfolio_heat * 100).toFixed(1)}%</Row>}
          </div>
        ) : <div className="text-xs text-gray-500">No risk controls</div>}
      </SectionCard>

      <SectionCard title="Regime Filter" defaultOpen={false}>
        {config.regime_filter?.allowed && config.regime_filter.allowed.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {config.regime_filter.allowed.map(r => <Pill key={r} color="amber">{r}</Pill>)}
          </div>
        ) : <div className="text-xs text-gray-500">All regimes allowed (no filter)</div>}
      </SectionCard>

      <SectionCard title="Cooldown Rules" defaultOpen={false}>
        {config.cooldown_rules && config.cooldown_rules.length > 0 ? (
          <div className="space-y-1">
            {config.cooldown_rules.map((r, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-gray-800/60 px-3 py-2 text-xs">
                <Pill>{r.trigger}</Pill>
                {r.duration_minutes != null && <span className="text-gray-300">{r.duration_minutes} min</span>}
                {r.duration_bars != null && <span className="text-gray-300">{r.duration_bars} bars</span>}
                {r.session_reset && <Pill color="amber">session reset</Pill>}
                {r.symbol_level && <Pill color="sky">symbol-level</Pill>}
              </div>
            ))}
          </div>
        ) : <div className="text-xs text-gray-500">No cooldown rules</div>}
      </SectionCard>

      {(config.scale_out?.levels && config.scale_out.levels.length > 0) && (
        <SectionCard title="Scale Out" defaultOpen={false}>
          <div className="space-y-1">
            {config.scale_out.levels.map((l, i) => (
              <div key={i} className="text-xs text-gray-300 rounded bg-gray-800/60 px-3 py-2">
                Level {i + 1}: exit {l.pct}%
              </div>
            ))}
          </div>
          {config.scale_out.move_stop_to_be_after_t1 && (
            <div className="text-xs text-gray-400 mt-1">Move stop to breakeven after T1</div>
          )}
        </SectionCard>
      )}
    </div>
  )
}

/* ── Edit mode config editor ──────────────────────────── */

function ConfigEditor({ config, onChange }: { config: StrategyConfig; onChange: (c: StrategyConfig) => void }) {
  const set = <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => onChange({ ...config, [key]: value })

  return (
    <div className="space-y-4">
      <SectionCard title="Hypothesis">
        <textarea
          className="input w-full resize-none"
          rows={2}
          value={config.hypothesis ?? ''}
          onChange={e => set('hypothesis', e.target.value)}
          placeholder="What is your trading edge?"
        />
      </SectionCard>

      <SectionCard title="Universe & Timeframe">
        <Field label="Symbols (comma separated)">
          <input
            className="input w-full"
            value={config.symbols?.join(', ') ?? ''}
            onChange={e => set('symbols', e.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))}
            placeholder="SPY, QQQ, AAPL"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Timeframe">
            <SelectMenu
              value={config.timeframe ?? '1d'}
              onChange={v => set('timeframe', v)}
              options={TIMEFRAMES.map(tf => ({ value: tf, label: tf }))}
            />
          </Field>
          <Field label="Leverage">
            <input type="number" step="0.1" min="1" className="input w-full" value={config.leverage ?? 1} onChange={e => set('leverage', parseFloat(e.target.value))} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Entry Rules">
        <Field label="Directions">
          <div className="flex gap-3">
            {['long', 'short'].map(dir => (
              <label key={dir} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox" className="accent-sky-500"
                  checked={config.entry?.directions?.includes(dir) ?? false}
                  onChange={e => {
                    const dirs = config.entry?.directions ?? []
                    set('entry', { ...config.entry, directions: e.target.checked ? [...dirs, dir] : dirs.filter(d => d !== dir) })
                  }}
                />
                <span className="text-sm capitalize">{dir}</span>
              </label>
            ))}
          </div>
        </Field>
        <ConditionBuilder
          conditions={config.entry?.conditions ?? []}
          onChange={conds => set('entry', { ...config.entry, conditions: conds })}
          logic={config.entry?.logic ?? 'all_of'}
          onLogicChange={logic => set('entry', { ...config.entry, logic })}
          label="Entry Conditions"
        />
      </SectionCard>

      <SectionCard title="Stop Loss">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Method">
            <SelectMenu
              value={config.stop_loss?.method ?? 'fixed_pct'}
              onChange={v => set('stop_loss', { ...config.stop_loss, method: v })}
              options={STOP_METHODS.map(m => ({ value: m, label: m }))}
            />
          </Field>
          {(config.stop_loss?.method === 'fixed_pct' || config.stop_loss?.method === 'fixed_dollar') && (
            <Field label="Value">
              <input type="number" className="input w-full" value={config.stop_loss?.value ?? 2} onChange={e => set('stop_loss', { ...config.stop_loss, method: config.stop_loss?.method ?? 'fixed_pct', value: parseFloat(e.target.value) })} />
            </Field>
          )}
          {config.stop_loss?.method === 'atr_multiple' && (
            <>
              <Field label="ATR Period">
                <input type="number" className="input w-full" value={config.stop_loss?.period ?? 14} onChange={e => set('stop_loss', { ...config.stop_loss, method: 'atr_multiple', period: parseInt(e.target.value) })} />
              </Field>
              <Field label="Multiplier">
                <input type="number" step="0.1" className="input w-full" value={config.stop_loss?.mult ?? 2.0} onChange={e => set('stop_loss', { ...config.stop_loss, method: 'atr_multiple', mult: parseFloat(e.target.value) })} />
              </Field>
            </>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Profit Targets">
        {(config.targets ?? []).map((target, i) => (
          <div key={i} className="flex items-center gap-2 bg-gray-800 rounded p-2">
            <span className="text-xs text-gray-500 w-16">Target {i + 1}</span>
            <SelectMenu
              value={target.method}
              onChange={v => {
                const targets = [...(config.targets ?? [])]; targets[i] = { ...targets[i], method: v }; set('targets', targets)
              }}
              options={TARGET_METHODS.map(m => ({ value: m, label: m }))}
            />
            {target.method === 'r_multiple' && (
              <input type="number" step="0.5" className="input text-xs py-1 w-20" value={target.r ?? 2} onChange={e => {
                const targets = [...(config.targets ?? [])]; targets[i] = { ...targets[i], r: parseFloat(e.target.value) }; set('targets', targets)
              }} />
            )}
            <button className="ml-auto text-gray-500 hover:text-red-400" onClick={() => set('targets', (config.targets ?? []).filter((_, idx) => idx !== i))}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button className="btn-ghost text-xs flex items-center gap-1" onClick={() => set('targets', [...(config.targets ?? []), { method: 'r_multiple', r: 2.0 }])}>
          <Plus size={12} /> Add Target
        </button>
      </SectionCard>

      <SectionCard title="Position Sizing">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Method">
            <SelectMenu
              value={config.position_sizing?.method ?? 'risk_pct'}
              onChange={v => set('position_sizing', { ...config.position_sizing, method: v })}
              options={SIZING_METHODS.map(m => ({ value: m, label: m }))}
            />
          </Field>
          {config.position_sizing?.method === 'risk_pct' && (
            <Field label="Risk % per trade">
              <input type="number" step="0.1" className="input w-full" value={config.position_sizing?.risk_pct ?? 1.0} onChange={e => set('position_sizing', { ...config.position_sizing, method: 'risk_pct', risk_pct: parseFloat(e.target.value) })} />
            </Field>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Risk Controls">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Max Position Size %">
            <input type="number" step="0.01" className="input w-full" value={(config.risk?.max_position_size_pct ?? 0.10) * 100} onChange={e => set('risk', { ...config.risk, max_position_size_pct: parseFloat(e.target.value) / 100 })} />
          </Field>
          <Field label="Max Daily Loss %">
            <input type="number" step="0.01" className="input w-full" value={(config.risk?.max_daily_loss_pct ?? 0.03) * 100} onChange={e => set('risk', { ...config.risk, max_daily_loss_pct: parseFloat(e.target.value) / 100 })} />
          </Field>
          <Field label="Max Open Positions">
            <input type="number" className="input w-full" value={config.risk?.max_open_positions ?? 10} onChange={e => set('risk', { ...config.risk, max_open_positions: parseInt(e.target.value) })} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Regime Filter" defaultOpen={false}>
        <Field label="Allowed Regimes (leave empty = all)">
          <div className="flex flex-wrap gap-2">
            {REGIMES.map(r => (
              <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" className="accent-sky-500"
                  checked={config.regime_filter?.allowed?.includes(r) ?? false}
                  onChange={e => {
                    const allowed = config.regime_filter?.allowed ?? []
                    set('regime_filter', { allowed: e.target.checked ? [...allowed, r] : allowed.filter(a => a !== r) })
                  }}
                />
                <span className="text-sm">{r}</span>
              </label>
            ))}
          </div>
        </Field>
      </SectionCard>

      <SectionCard title="Cooldown Rules" defaultOpen={false}>
        {(config.cooldown_rules ?? []).map((rule, i) => (
          <div key={i} className="flex items-center gap-2 bg-gray-800 rounded p-2">
            <SelectMenu
              value={rule.trigger}
              onChange={v => {
                const rules = [...(config.cooldown_rules ?? [])]; rules[i] = { ...rules[i], trigger: v }; set('cooldown_rules', rules)
              }}
              options={COOLDOWN_TRIGGERS.map(t => ({ value: t, label: t }))}
            />
            <input type="number" className="input text-xs py-1 w-24" placeholder="Minutes" value={rule.duration_minutes ?? ''} onChange={e => {
              const rules = [...(config.cooldown_rules ?? [])]; rules[i] = { ...rules[i], duration_minutes: parseInt(e.target.value) || undefined }; set('cooldown_rules', rules)
            }} />
            <button className="ml-auto text-gray-500 hover:text-red-400" onClick={() => set('cooldown_rules', (config.cooldown_rules ?? []).filter((_, idx) => idx !== i))}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button className="btn-ghost text-xs flex items-center gap-1" onClick={() => set('cooldown_rules', [...(config.cooldown_rules ?? []), { trigger: 'loss', duration_minutes: 30 }])}>
          <Plus size={12} /> Add Cooldown Rule
        </button>
      </SectionCard>
    </div>
  )
}

export function StrategyDetails() {
  const { strategyId } = useParams<{ strategyId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [newVersionNotes, setNewVersionNotes] = useState('')
  const [ackCloneLatest, setAckCloneLatest] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editConfig, setEditConfig] = useState<StrategyConfig | null>(null)
  const [editNotes, setEditNotes] = useState('')
  const [showRawJson, setShowRawJson] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['strategy', strategyId],
    queryFn: () => strategiesApi.get(strategyId!),
    enabled: !!strategyId,
  })

  const createVersionMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error('Strategy not loaded')
      const notes = newVersionNotes.trim()
      if (!notes) throw new Error('Notes are required')
      if (!ackCloneLatest) throw new Error('Please confirm you are cloning the latest config')
      const latest = (data.versions ?? [])[0]
      const baseConfig: StrategyConfig = (latest?.config ?? {}) as any
      return strategiesApi.createVersion(data.id, { config: baseConfig, notes })
    },
    onSuccess: () => {
      setNewVersionNotes('')
      setAckCloneLatest(false)
      setCreating(false)
      qc.invalidateQueries({ queryKey: ['strategy', strategyId] })
    },
  })

  const saveEditMutation = useMutation({
    mutationFn: async () => {
      if (!data || !editConfig) throw new Error('No config to save')
      const notes = editNotes.trim()
      if (!notes) throw new Error('Notes are required for a new version')
      return strategiesApi.createVersion(data.id, { config: editConfig, notes })
    },
    onSuccess: () => {
      setEditing(false)
      setEditConfig(null)
      setEditNotes('')
      qc.invalidateQueries({ queryKey: ['strategy', strategyId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error('Strategy not loaded')
      return strategiesApi.delete(data.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strategies'] })
      navigate('/strategies')
    },
  })

  const deleteVersionMutation = useMutation({
    mutationFn: async (versionId: string) => {
      if (!strategyId) throw new Error('No strategy id')
      return strategiesApi.deleteVersion(strategyId, versionId)
    },
    onSuccess: (_data, versionId) => {
      setDeletingVersionId(null)
      // If we deleted the selected version, clear selection
      if (selectedVersionId === versionId) setSelectedVersionId(null)
      qc.invalidateQueries({ queryKey: ['strategy', strategyId] })
    },
  })

  if (isLoading) return <div className="text-gray-500 text-sm">Loading…</div>
  if (error) return <div className="text-red-400 text-sm">Failed to load strategy: {(error as Error).message}</div>
  if (!data) return <div className="text-red-400 text-sm">Strategy not found</div>

  const strategy: Strategy = data
  const versions: StrategyVersion[] = data.versions ?? []
  const selected = versions.find(v => v.id === (selectedVersionId ?? versions[0]?.id)) ?? versions[0]

  const startEditing = () => {
    setEditConfig(JSON.parse(JSON.stringify(selected?.config ?? {})))
    setEditNotes('')
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setEditConfig(null)
    setEditNotes('')
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link to="/strategies" className="text-gray-500 hover:text-gray-300 text-sm">← Strategies</Link>
          </div>
          <h1 className="text-xl font-bold text-gray-100">{strategy.name}</h1>
          <div className="text-xs text-gray-500 mt-1">
            <span className="badge badge-gray mr-2">{strategy.category}</span>
            <span className={clsx('badge', strategy.status === 'active' ? 'badge-green' : 'badge-gray')}>{strategy.status}</span>
          </div>
          {strategy.description && <p className="text-sm text-gray-400 mt-2">{strategy.description}</p>}
        </div>

        <div className="flex items-center gap-2">
          <Link to="/backtest" className="btn-primary text-sm">Run Backtest</Link>
          <button
            className="btn-ghost text-sm"
            onClick={() => setCreating(s => !s)}
          >
            + New Version
          </button>
          <button
            className="btn-ghost text-sm text-red-400 hover:text-red-300"
            onClick={() => setShowDeleteConfirm(s => !s)}
          >
            <Trash2 size={13} className="inline mr-1" />
            Delete
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="card border border-red-900/60 bg-red-950/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} className="text-red-400" />
            <span className="text-sm font-semibold text-red-300">Delete Strategy</span>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Permanently delete <span className="font-semibold text-gray-200">{strategy.name}</span> and all {versions.length} version(s).
            This cannot be undone. The server will block deletion if any runs or deployments are tied to this strategy.
          </p>
          {deleteMutation.isError && (() => {
            const err = deleteMutation.error as any
            const detail = err?.response?.data?.detail
            if (detail && typeof detail === 'object' && detail.blockers) {
              return (
                <div className="mb-3 rounded border border-amber-800 bg-amber-950/30 p-3 space-y-1">
                  <p className="text-xs font-semibold text-amber-300">{detail.message}</p>
                  {(detail.blockers as string[]).map((b: string, i: number) => (
                    <p key={i} className="text-xs text-amber-200">• {b}</p>
                  ))}
                </div>
              )
            }
            return <p className="text-xs text-red-400 mb-3">{err?.message ?? 'Delete failed'}</p>
          })()}
          <div className="flex items-center gap-2">
            <button
              className="text-xs px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white font-semibold disabled:opacity-50"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Confirm Delete'}
            </button>
            <button className="btn-ghost text-xs" onClick={() => { setShowDeleteConfirm(false); deleteMutation.reset() }}>Cancel</button>
          </div>
        </div>
      )}

      {creating && (
        <div className="card space-y-3 border border-indigo-900/50">
          <div className="text-sm font-semibold text-indigo-300">Create New Version</div>
          <div className="text-xs text-gray-500">
            This clones the latest version’s config as a starting point.
          </div>
          <div>
            <label className="label">Notes</label>
            <input
              className="input w-full"
              value={newVersionNotes}
              onChange={e => setNewVersionNotes(e.target.value)}
              placeholder="What changed in this version?"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              className="accent-indigo-500"
              checked={ackCloneLatest}
              onChange={e => setAckCloneLatest(e.target.checked)}
            />
            I understand this creates a new version by cloning the latest config
          </label>
          <div className="flex items-center gap-2">
            <button
              className="btn-primary text-sm"
              disabled={createVersionMutation.isPending || !newVersionNotes.trim() || !ackCloneLatest}
              onClick={() => createVersionMutation.mutate()}
            >
              {createVersionMutation.isPending ? 'Creating…' : 'Create Version'}
            </button>
            <button className="btn-ghost text-sm" onClick={() => setCreating(false)}>Cancel</button>
            {createVersionMutation.isError && (
              <span className="text-xs text-red-400 ml-auto">{(createVersionMutation.error as Error).message}</span>
            )}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-5 gap-4">
        <div className="card md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-200">Versions</h2>
            <span className="badge badge-gray">{versions.length}</span>
          </div>
          {versions.length === 0 ? (
            <div className="text-gray-500 text-sm">No versions</div>
          ) : (
            <div className="space-y-2">
              {versions.map(v => {
                const isProtected = new Set(['paper_approved', 'live_approved']).has(v.promotion_status)
                const isOnlyVersion = versions.length <= 1
                const canDeleteVer = !isProtected && !isOnlyVersion
                const isConfirmingDelete = deletingVersionId === v.id

                return (
                  <div key={v.id} className="relative">
                    <button
                      type="button"
                      onClick={() => { setSelectedVersionId(v.id); setDeletingVersionId(null) }}
                      className={clsx(
                        'w-full text-left rounded border px-3 py-2 transition pr-8',
                        selected?.id === v.id ? 'border-sky-600 bg-sky-950/20' : 'border-gray-800 hover:border-gray-700',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-mono text-gray-100">v{v.version}</div>
                        <span className="text-xs text-gray-500">{v.created_at?.slice(0, 10)}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 truncate">{v.notes ?? '—'}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-xs text-gray-600">{v.promotion_status}</span>
                        {v.duration_mode === 'day' && <span className="px-1 py-0.5 rounded text-[10px] font-semibold bg-sky-900/40 text-sky-400">DAY</span>}
                        {v.duration_mode === 'swing' && <span className="px-1 py-0.5 rounded text-[10px] font-semibold bg-indigo-900/40 text-indigo-400">SWING</span>}
                        {v.duration_mode === 'position' && <span className="px-1 py-0.5 rounded text-[10px] font-semibold bg-amber-900/40 text-amber-400">POS</span>}
                      </div>
                    </button>
                    {/* Quick action buttons */}
                    <div className="absolute right-2 top-2 flex items-center gap-1">
                      <Link
                        to={`/backtest?strategy_id=${strategyId}&version_id=${v.id}`}
                        onClick={e => e.stopPropagation()}
                        title={`Backtest v${v.version}`}
                        className="p-1 rounded text-gray-600 hover:text-sky-400 hover:bg-sky-950/30 transition"
                      >
                        <TrendingUp size={11} />
                      </Link>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setDeletingVersionId(isConfirmingDelete ? null : v.id)
                        }}
                        disabled={!canDeleteVer}
                        title={
                          isProtected ? `v${v.version} is ${v.promotion_status} — demote before deleting`
                            : isOnlyVersion ? 'Cannot delete the only version'
                            : `Delete v${v.version}`
                        }
                        className={clsx(
                          'p-1 rounded transition',
                          canDeleteVer
                            ? 'text-gray-600 hover:text-red-400 hover:bg-red-950/30'
                            : 'text-gray-800 cursor-not-allowed',
                        )}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>

                    {/* Inline confirm */}
                    {isConfirmingDelete && (
                      <div className="rounded border border-red-900/60 bg-red-950/20 px-3 py-2 mt-1 space-y-1.5">
                        <p className="text-xs text-red-300">Delete v{v.version}? Cannot be undone. Blocked if runs or deployments reference it.</p>
                        <div className="flex gap-2">
                          <button
                            className="text-xs px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-white font-semibold disabled:opacity-50"
                            disabled={deleteVersionMutation.isPending}
                            onClick={() => deleteVersionMutation.mutate(v.id)}
                          >
                            {deleteVersionMutation.isPending ? 'Deleting…' : 'Confirm'}
                          </button>
                          <button className="text-xs text-gray-400 hover:text-gray-200" onClick={() => { setDeletingVersionId(null); deleteVersionMutation.reset() }}>Cancel</button>
                        </div>
                        {deleteVersionMutation.isError && (() => {
                          const err = deleteVersionMutation.error as any
                          const detail = err?.response?.data?.detail
                          if (detail && typeof detail === 'object' && detail.blockers) {
                            return (
                              <div className="rounded border border-amber-800 bg-amber-950/30 p-2 space-y-1">
                                <p className="text-xs font-semibold text-amber-300">{detail.message}</p>
                                {(detail.blockers as string[]).map((b: string, i: number) => (
                                  <p key={i} className="text-xs text-amber-200">• {b}</p>
                                ))}
                              </div>
                            )
                          }
                          return <p className="text-xs text-red-400">{err?.message ?? 'Delete failed'}</p>
                        })()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="md:col-span-3 space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-200">Selected Version</h2>
              <div className="flex items-center gap-2">
                {selected && (
                  <span className="badge badge-gray font-mono">v{selected.version}</span>
                )}
                {selected && !editing && (
                  <button className="btn-ghost text-xs flex items-center gap-1" onClick={startEditing}>
                    <Pencil size={12} /> Edit
                  </button>
                )}
              </div>
            </div>
            {selected ? (
              <div className="grid grid-cols-3 gap-3 text-xs text-gray-500">
                <div>
                  <div className="text-gray-600">Promotion status</div>
                  <div className="text-gray-200">{selected.promotion_status}</div>
                </div>
                <div>
                  <div className="text-gray-600">Duration mode</div>
                  <div className="mt-0.5">
                    {selected.duration_mode === 'day' && <span className="px-2 py-0.5 rounded text-xs font-semibold bg-sky-900/50 text-sky-300">DAY</span>}
                    {selected.duration_mode === 'swing' && <span className="px-2 py-0.5 rounded text-xs font-semibold bg-indigo-900/50 text-indigo-300">SWING</span>}
                    {selected.duration_mode === 'position' && <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-900/50 text-amber-300">POSITION</span>}
                    {!selected.duration_mode && <span className="text-gray-500">—</span>}
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Created</div>
                  <div className="text-gray-200">{selected.created_at?.replace('T', ' ').slice(0, 19)}</div>
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-sm">Select a version to view details</div>
            )}
          </div>

          {editing && editConfig ? (
            <div className="space-y-4">
              <div className="card border border-indigo-900/50 bg-indigo-950/10">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-indigo-300">Editing — saves as new version</div>
                  <div className="flex items-center gap-2">
                    <button className="btn-ghost text-xs flex items-center gap-1" onClick={cancelEditing}>
                      <X size={12} /> Cancel
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">Version notes (required)</label>
                  <input className="input w-full" value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="What changed?" />
                </div>
                {saveEditMutation.isError && (
                  <div className="text-xs text-red-400 mt-2">{(saveEditMutation.error as Error).message}</div>
                )}
                <button
                  className="btn-primary mt-3 flex items-center gap-1.5"
                  disabled={saveEditMutation.isPending || !editNotes.trim()}
                  onClick={() => saveEditMutation.mutate()}
                >
                  <Save size={14} /> {saveEditMutation.isPending ? 'Saving…' : 'Save as New Version'}
                </button>
              </div>

              <ConfigEditor config={editConfig} onChange={setEditConfig} />
            </div>
          ) : selected ? (
            <div className="space-y-4">
              <ConfigViewer config={(selected.config ?? {}) as StrategyConfig} />

              {/* Raw JSON toggle */}
              <div className="card">
                <button
                  className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  onClick={() => setShowRawJson(v => !v)}
                >
                  <Code size={12} /> {showRawJson ? 'Hide' : 'Show'} raw JSON
                </button>
                {showRawJson && (
                  <pre className="mt-3 text-xs bg-gray-950/50 border border-gray-800 rounded p-3 overflow-auto max-h-[420px] text-gray-300">
{pretty(selected.config ?? {})}
                  </pre>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
