import React, { useMemo, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { strategiesApi } from '../api/strategies'
import { backtestsApi } from '../api/backtests'
import { Plus, Search, TrendingUp, Download, Upload, Sparkles, Loader2, X } from 'lucide-react'
import { PageHelp } from '../components/PageHelp'
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

function NewStrategyModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)
    try {
      const result = await strategiesApi.generateConditions(prompt.trim(), 'entry')
      navigate('/strategies/new', { state: { aiPrompt: prompt, aiConditions: result.conditions, aiLogic: result.logic } })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } }
      const status = axiosErr?.response?.status
      const detail = axiosErr?.response?.data?.detail
      if (status === 424) {
        setError(`No AI service configured. ${detail ?? 'Go to Services → add a Groq or Gemini key and mark it as Default AI.'}`)
      } else {
        setError(detail ?? (err instanceof Error ? err.message : 'Generation failed'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-100">New Strategy</h2>
            <p className="text-xs text-gray-500 mt-0.5">Describe your trading idea and let AI build the signal structure, or start from scratch.</p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 shrink-0 mt-0.5"><X size={16} /></button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Describe your strategy</label>
          <textarea
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600/40 resize-none"
            rows={4}
            placeholder="e.g. Buy when RSI crosses above 30 and price is above the 20-period EMA. Exit when RSI crosses above 70."
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate() }}
            disabled={loading}
            autoFocus
          />
          <p className="text-[10px] text-gray-600">Ctrl+Enter to generate</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loading ? 'Generating…' : 'Generate with AI'}
          </button>
          <Link
            to="/strategies/new"
            className="px-4 py-2.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            onClick={onClose}
          >
            Build Manually
          </Link>
        </div>
      </div>
    </div>
  )
}

export function Strategies() {
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()

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
      {showNewModal && <NewStrategyModal onClose={() => setShowNewModal(false)} />}
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-100 flex items-center">Strategies<PageHelp page="strategies" /></h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {strategies.length} strat{strategies.length !== 1 ? 'egies' : 'egy'} · click to view versions, config &amp; runs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setImportError(null)
              setImportSuccess(null)
              try {
                const text = await file.text()
                const payload = JSON.parse(text)
                const result = await strategiesApi.import(payload)
                setImportSuccess(`Imported "${result.strategy_name}" (${result.versions_imported} version${result.versions_imported !== 1 ? 's' : ''})`)
                qc.invalidateQueries({ queryKey: ['strategies'] })
                setTimeout(() => navigate(`/strategies/${result.strategy_id}`), 800)
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Import failed'
                setImportError(msg)
              }
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="btn-secondary flex items-center gap-1.5 text-sm shrink-0"
          >
            <Upload size={14} /> Import
          </button>
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="btn-primary flex items-center gap-1.5 text-sm shrink-0"
          >
            <Plus size={14} /> New Strategy
          </button>
        </div>
      </div>

      {importError && (
        <div className="rounded border border-red-800 bg-red-950/30 px-4 py-2 text-sm text-red-300">
          Import failed: {importError}
        </div>
      )}
      {importSuccess && (
        <div className="rounded border border-green-800 bg-green-950/30 px-4 py-2 text-sm text-green-300">
          {importSuccess}
        </div>
      )}

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
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="btn-primary text-sm inline-flex items-center gap-1.5 mt-1"
          >
            <Plus size={14} /> Create First Strategy
          </button>
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
              bestRun={undefined}
              onExport={async () => {
                setExporting(s.id)
                try {
                  const data = await strategiesApi.export(s.id)
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `strategy_${s.name.replace(/\s+/g, '_')}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                } catch {
                  // silently ignore — browser download failures are rare
                } finally {
                  setExporting(null)
                }
              }}
              isExporting={exporting === s.id}
            />
          )
        })}
      </div>
    </div>
  )
}

function StrategyCard({
  strategy: s,
  onExport,
  isExporting,
}: {
  strategy: Strategy
  bestRun?: { sharpe?: number | null; return_pct?: number | null; total_trades?: number | null }
  onExport?: () => void
  isExporting?: boolean
}) {
  const v = (s as any).versions?.[0]
  const durationMode = v?.duration_mode ?? (s as any).duration_mode

  return (
    <div className="card hover:border-sky-700/60 transition-colors relative group">
      <Link to={`/strategies/${s.id}`} className="block">
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
      </Link>

      {/* Export button */}
      {onExport && (
        <button
          type="button"
          onClick={e => { e.preventDefault(); onExport() }}
          disabled={isExporting}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400 hover:text-sky-300 border border-gray-700 hover:border-sky-700 rounded px-1.5 py-0.5 bg-gray-950 flex items-center gap-1"
          title="Export strategy as JSON"
        >
          <Download size={10} />
          {isExporting ? '…' : 'Export'}
        </button>
      )}

      <div className="absolute inset-x-0 bottom-0 h-0.5 rounded-b bg-sky-700/0 group-hover:bg-sky-700/40 transition-all" />
    </div>
  )
}
