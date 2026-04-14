import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { strategiesApi } from '../api/strategies'
import { backtestsApi } from '../api/backtests'
import { Plus, Search, TrendingUp, Filter } from 'lucide-react'
import clsx from 'clsx'
import type { Strategy } from '../types'

const CATEGORY_COLORS: Record<string, string> = {
  momentum:       'bg-sky-900/60 text-sky-300 ring-1 ring-sky-700',
  mean_reversion: 'bg-purple-900/60 text-purple-300 ring-1 ring-purple-700',
  breakout:       'bg-amber-900/60 text-amber-300 ring-1 ring-amber-700',
  trend_following:'bg-emerald-900/60 text-emerald-300 ring-1 ring-emerald-700',
  scalp:          'bg-rose-900/60 text-rose-300 ring-1 ring-rose-700',
  custom:         'bg-gray-800 text-gray-400 ring-1 ring-gray-700',
}

const DURATION_LABELS: Record<string, { label: string; color: string }> = {
  day:      { label: 'DAY',   color: 'bg-sky-900/60 text-sky-300' },
  swing:    { label: 'SWING', color: 'bg-indigo-900/60 text-indigo-300' },
  position: { label: 'POS',   color: 'bg-violet-900/60 text-violet-300' },
}

function DurationBadge({ mode }: { mode?: string }) {
  const d = DURATION_LABELS[mode ?? '']
  if (!d) return null
  return (
    <span className={clsx('text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide', d.color)}>
      {d.label}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded', CATEGORY_COLORS[category] ?? CATEGORY_COLORS.custom)}>
      {category.replace(/_/g, ' ')}
    </span>
  )
}

function TagChip({ tag }: { tag: string }) {
  return (
    <span className="text-[10px] bg-gray-800/80 text-gray-500 px-1.5 py-0.5 rounded font-mono">
      #{tag}
    </span>
  )
}

export function Strategies() {
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')

  const { data: strategies = [], isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
  })

  // Load recent runs for metrics overlay (non-blocking)
  const { data: runs = [] } = useQuery({
    queryKey: ['backtests'],
    queryFn: () => backtestsApi.list(undefined, 200),
  })

  // Build a quick-lookup: strategy_version_id → best sharpe run
  const bestRunByVersion = useMemo(() => {
    const map: Record<string, { sharpe?: number | null; return_pct?: number | null; total_trades?: number | null }> = {}
    for (const r of runs) {
      if (r.status !== 'completed' || !r.metrics) continue
      const existing = map[r.strategy_version_id]
      const sharpe = r.metrics.sharpe_ratio ?? -Infinity
      if (!existing || (sharpe > (existing.sharpe ?? -Infinity))) {
        map[r.strategy_version_id] = {
          sharpe: r.metrics.sharpe_ratio,
          return_pct: r.metrics.total_return_pct,
          total_trades: r.metrics.total_trades,
        }
      }
    }
    return map
  }, [runs])

  const categories = useMemo(() => {
    const cats = new Set(strategies.map(s => s.category))
    return ['all', ...Array.from(cats).sort()]
  }, [strategies])

  const filtered = useMemo(() => {
    return strategies.filter(s => {
      if (catFilter !== 'all' && s.category !== catFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        return (
          s.name.toLowerCase().includes(q) ||
          (s.description ?? '').toLowerCase().includes(q) ||
          s.tags?.some(t => t.toLowerCase().includes(q))
        )
      }
      return true
    })
  }, [strategies, catFilter, search])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Strategies</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {strategies.length} strat{strategies.length !== 1 ? 'egies' : 'egy'} · click to view versions, config &amp; runs
          </p>
        </div>
        <Link to="/strategies/new" className="btn-primary flex items-center gap-1.5 text-sm shrink-0">
          <Plus size={14} /> New Strategy
        </Link>
      </div>

      {/* Filters */}
      {!isLoading && strategies.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
            <input
              className="bg-gray-900 border border-gray-700 rounded pl-7 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-sky-600 w-52"
              placeholder="Search name, tag, description…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCatFilter(cat)}
                className={clsx(
                  'text-xs px-2.5 py-1 rounded transition-colors',
                  catFilter === cat
                    ? 'bg-sky-800 text-sky-200 ring-1 ring-sky-600'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700',
                )}
              >
                {cat === 'all' ? 'All' : cat.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          {(search || catFilter !== 'all') && (
            <span className="text-xs text-gray-600">{filtered.length} shown</span>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-gray-500 text-sm py-8 text-center">Loading strategies…</div>
      )}

      {/* Empty state */}
      {!isLoading && strategies.length === 0 && (
        <div className="card text-center py-14 space-y-3">
          <TrendingUp size={36} className="text-gray-700 mx-auto" />
          <p className="text-gray-400 font-medium">No strategies yet</p>
          <p className="text-xs text-gray-600 max-w-sm mx-auto">
            A strategy defines your entry logic, stop loss, targets, and risk rules.
            Create one here, then launch backtests to validate it.
          </p>
          <Link to="/strategies/new" className="btn-primary text-sm inline-flex items-center gap-1.5 mt-1">
            <Plus size={14} /> Create First Strategy
          </Link>
        </div>
      )}

      {/* Grid */}
      {!isLoading && filtered.length === 0 && strategies.length > 0 && (
        <div className="card text-center py-8 text-gray-500 text-sm">
          No strategies match your filter.{' '}
          <button onClick={() => { setSearch(''); setCatFilter('all') }} className="text-sky-400 hover:underline">Clear filters</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(s => {
          // Find best backtest result across all versions of this strategy
          // (approximate — runs are keyed by version_id, not strategy_id)
          const allVersionRuns = runs.filter(r =>
            r.status === 'completed' && r.metrics && r.strategy_version_id
          )
          const stratRuns = allVersionRuns.filter(() => true) // can't easily join without versions list here
          // Use a simpler signal: any completed run with metrics keyed to any known version
          const bestSharpe = allVersionRuns
            .filter(r => r.strategy_version_id)
            .map(r => bestRunByVersion[r.strategy_version_id])
            .filter(Boolean)
            .sort((a, b) => (b?.sharpe ?? -Infinity) - (a?.sharpe ?? -Infinity))[0]

          return (
            <StrategyCard
              key={s.id}
              strategy={s}
              bestRun={undefined /* per-strategy linkage requires fetching versions — show on detail page */}
            />
          )
        })}
      </div>
    </div>
  )
}

function StrategyCard({ strategy: s }: { strategy: Strategy; bestRun?: { sharpe?: number | null; return_pct?: number | null; total_trades?: number | null } }) {
  const v = (s as any).versions?.[0]  // if API returns versions inline
  const durationMode = v?.duration_mode ?? (s as any).duration_mode

  return (
    <Link
      to={`/strategies/${s.id}`}
      className="card hover:border-sky-700/60 transition-colors block group relative"
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-semibold text-gray-100 group-hover:text-sky-300 transition-colors text-sm leading-snug flex-1 min-w-0">
          {s.name}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <DurationBadge mode={durationMode} />
          <CategoryBadge category={s.category} />
        </div>
      </div>

      {/* Description */}
      {s.description && (
        <p className="text-xs text-gray-500 mb-3 line-clamp-2 leading-relaxed">{s.description}</p>
      )}

      {/* Tags */}
      {s.tags && s.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {s.tags.slice(0, 5).map(tag => <TagChip key={tag} tag={tag} />)}
          {s.tags.length > 5 && <span className="text-[10px] text-gray-600">+{s.tags.length - 5}</span>}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-600 pt-2 border-t border-gray-800/60">
        <span>{s.created_at?.slice(0, 10)}</span>
        <span className={clsx(
          'badge text-xs',
          s.status === 'active' ? 'badge-green' : 'badge-gray'
        )}>
          {s.status}
        </span>
      </div>

      {/* Quick action hint */}
      <div className="absolute inset-x-0 bottom-0 h-0.5 rounded-b bg-sky-700/0 group-hover:bg-sky-700/40 transition-all" />
    </Link>
  )
}
