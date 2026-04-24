import React, { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { strategiesApi } from '../api/strategies'
import { VersionDiffPanel } from '../components/VersionDiffPanel'
import { Pencil, Trash2, ChevronDown, ChevronUp, Code, AlertTriangle, TrendingUp, GitCompare } from 'lucide-react'
import clsx from 'clsx'
import type { Strategy, StrategyVersion, StrategyConfig, Condition } from '../types'


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
    const fmt = (side: any) => {
      if (!side || typeof side !== 'object') return String(side ?? '?')
      const base = side.indicator ?? side.field ?? side.prev_bar ?? JSON.stringify(side)
      const offset = typeof side.n_bars_back === 'number' && side.n_bars_back > 0 ? `[${side.n_bars_back}]` : ''
      return `${base}${offset}`
    }
    const left = fmt(c.left)
    const right = typeof c.right === 'object' ? fmt(c.right) : String(c.right ?? '?')
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
        <Row label="Watchlist">
          {config.watchlist_name
            ? <Pill color="sky">{config.watchlist_name}</Pill>
            : config.symbols?.length
              ? <span className="text-xs text-gray-400">{config.symbols.slice(0, 6).join(', ')}{config.symbols.length > 6 ? ` +${config.symbols.length - 6} more` : ''}</span>
              : <span className="text-gray-500 text-xs">Not set</span>
          }
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
        <Row label="Long Logic"><Pill>{config.entry?.logic ?? config.entry?.long_logic ?? 'all_of'}</Pill></Row>
        {(config.entry?.conditions ?? []).length > 0 ? (
          <div className="space-y-1 mt-2">
            <div className="text-[11px] uppercase tracking-wide text-emerald-400">Long Conditions</div>
            {(config.entry?.conditions ?? []).map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-gray-800/60 px-3 py-2 text-xs font-mono text-gray-300">
                <span className="text-gray-600 w-4">{i + 1}.</span>
                {conditionToHuman(c)}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500 mt-1">No long entry conditions defined</div>
        )}
        <Row label="Short Logic"><Pill>{config.entry?.short_logic ?? config.entry?.logic ?? 'all_of'}</Pill></Row>
        {(config.entry?.short_conditions ?? []).length > 0 ? (
          <div className="space-y-1 mt-2">
            <div className="text-[11px] uppercase tracking-wide text-red-400">Short Conditions</div>
            {(config.entry?.short_conditions ?? []).map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-gray-800/60 px-3 py-2 text-xs font-mono text-gray-300">
                <span className="text-gray-600 w-4">{i + 1}.</span>
                {conditionToHuman(c)}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500 mt-1">No short entry conditions defined</div>
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


    </div>
  )
}


export function StrategyDetails() {
  const { strategyId } = useParams<{ strategyId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [showRawJson, setShowRawJson] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null)
  const [diffBaseVersionId, setDiffBaseVersionId] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['strategy', strategyId],
    queryFn: () => strategiesApi.get(strategyId!),
    enabled: !!strategyId,
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
          <Link to={`/strategies/${strategyId}/new-version`} className="btn-ghost text-sm">
            + New Version
          </Link>
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
                      {versions.length > 1 && selected && selected.id !== v.id && (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            setDiffBaseVersionId(v.id === diffBaseVersionId ? null : v.id)
                          }}
                          title={`Diff v${selected.version} → v${v.version}`}
                          className={clsx(
                            'p-1 rounded transition',
                            diffBaseVersionId === v.id
                              ? 'text-sky-400 bg-sky-950/30'
                              : 'text-gray-600 hover:text-sky-400 hover:bg-sky-950/30',
                          )}
                        >
                          <GitCompare size={11} />
                        </button>
                      )}
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
                {selected && (
                  <Link to={`/strategies/${strategyId}/edit`} className="btn-ghost text-xs flex items-center gap-1">
                    <Pencil size={12} /> Edit
                  </Link>
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

          {selected ? (
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

      {/* Version diff panel — shown when a base version is selected for comparison */}
      {diffBaseVersionId && selected && strategyId && selected.id !== diffBaseVersionId && (
        <VersionDiffPanel
          strategyId={strategyId}
          v1Id={diffBaseVersionId}
          v2Id={selected.id}
          onClose={() => setDiffBaseVersionId(null)}
        />
      )}
    </div>
  )
}
