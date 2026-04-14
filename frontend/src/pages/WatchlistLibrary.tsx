import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { watchlistsApi, Watchlist, WatchlistMembership } from '../api/watchlists'
import { usePollingGate } from '../hooks/usePollingGate'
import { SelectMenu } from '../components/SelectMenu'
import clsx from 'clsx'
import {
  Plus, RefreshCw, ChevronRight, X, Search, BookOpen,
  Clock, Layers, Zap, Calendar, BarChart2, Trash2, Pencil, Check,
} from 'lucide-react'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, React.ReactNode> = {
  manual: <BookOpen size={12} />,
  scanner: <Zap size={12} />,
  index: <BarChart2 size={12} />,
  sector_rotation: <Layers size={12} />,
  earnings_calendar: <Calendar size={12} />,
}

const TYPE_COLORS: Record<string, string> = {
  manual: 'bg-gray-800 text-gray-400 ring-1 ring-gray-700',
  scanner: 'bg-amber-900/60 text-amber-300 ring-1 ring-amber-700',
  index: 'bg-sky-900/60 text-sky-300 ring-1 ring-sky-700',
  sector_rotation: 'bg-purple-900/60 text-purple-300 ring-1 ring-purple-700',
  earnings_calendar: 'bg-rose-900/60 text-rose-300 ring-1 ring-rose-700',
}

const STATE_COLORS: Record<string, string> = {
  active: 'text-emerald-400',
  candidate: 'text-amber-400',
  pending_removal: 'text-orange-400',
  inactive: 'text-gray-600',
  suspended: 'text-red-400',
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={clsx('flex items-center gap-1 text-xs px-1.5 py-0.5 rounded', TYPE_COLORS[type] ?? TYPE_COLORS.manual)}>
      {TYPE_ICONS[type] ?? <BookOpen size={12} />}
      {type.replace(/_/g, ' ')}
    </span>
  )
}

function activeCount(wl: Watchlist) {
  return wl.memberships.filter(m => m.state === 'active').length
}

function totalCount(wl: Watchlist) {
  return wl.memberships.filter(m => m.state !== 'inactive').length
}

// ─── Create Watchlist Modal ───────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (w: Watchlist) => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('manual')
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => watchlistsApi.create({ name: name.trim(), watchlist_type: type }),
    onSuccess: onCreated,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="card w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">New Watchlist</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={14} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input className="input w-full" placeholder="e.g. Momentum Scan" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Type</label>
            <SelectMenu
              value={type}
              onChange={setType}
              options={[
                { value: 'manual', label: 'Manual — curated by hand' },
                { value: 'scanner', label: 'Scanner — refreshed by scheduled job' },
                { value: 'index', label: 'Index — tracks an index constituent list' },
                { value: 'sector_rotation', label: 'Sector Rotation — sector-weighted universe' },
                { value: 'earnings_calendar', label: 'Earnings Calendar — earnings exclusion list' },
              ]}
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Symbols Panel ────────────────────────────────────────────────────────

function AddSymbolsPanel({ watchlistId, onDone }: { watchlistId: string; onDone: () => void }) {
  const [raw, setRaw] = useState('')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => {
      const symbols = raw.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
      return watchlistsApi.refresh(watchlistId, symbols)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlists', watchlistId] })
      qc.invalidateQueries({ queryKey: ['watchlists'] })
      setRaw('')
      onDone()
    },
  })

  return (
    <div className="rounded border border-gray-800 bg-gray-900/60 px-3 py-3 space-y-2">
      <div className="text-xs font-medium text-gray-400">Add / Refresh Symbols</div>
      <textarea
        className="input w-full resize-none text-xs font-mono"
        rows={3}
        placeholder="AAPL, MSFT, GOOGL — comma or newline separated"
        value={raw}
        onChange={e => setRaw(e.target.value)}
      />
      <div className="flex gap-2 justify-end">
        <button onClick={onDone} className="btn-ghost text-xs">Cancel</button>
        <button
          onClick={() => mutation.mutate()}
          disabled={!raw.trim() || mutation.isPending}
          className="btn-primary text-xs"
        >
          {mutation.isPending ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}

// ─── Membership Row ───────────────────────────────────────────────────────────

function MemberRow({ m, watchlistId, selected, onToggleSelect }: {
  m: WatchlistMembership
  watchlistId: string
  selected: boolean
  onToggleSelect: () => void
}) {
  const qc = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const suspend = useMutation({
    mutationFn: () => watchlistsApi.updateMemberState(watchlistId, m.symbol, 'suspended'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlists', watchlistId] }),
  })

  const remove = useMutation({
    mutationFn: () => watchlistsApi.removeMember(watchlistId, m.symbol),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlists', watchlistId] })
      qc.invalidateQueries({ queryKey: ['watchlists'] })
      setConfirmDelete(false)
    },
  })

  return (
    <div className={clsx('flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800/50 group', selected && 'bg-sky-950/20')}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        className="accent-sky-500 flex-shrink-0"
      />
      <span className={clsx('text-xs font-mono font-medium w-16 flex-shrink-0', STATE_COLORS[m.state] ?? 'text-gray-400')}>
        {m.symbol}
      </span>
      <span className={clsx('text-xs flex-1', STATE_COLORS[m.state] ?? 'text-gray-500')}>
        {m.state.replace(/_/g, ' ')}
      </span>
      {m.active_since && (
        <span className="text-xs text-gray-600 hidden group-hover:block">
          {new Date(m.active_since).toLocaleDateString()}
        </span>
      )}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {m.state !== 'suspended' && m.state !== 'inactive' && (
          <button
            onClick={() => suspend.mutate()}
            disabled={suspend.isPending}
            className="text-xs text-gray-600 hover:text-amber-400 px-1.5 py-0.5 rounded hover:bg-amber-950/30"
          >
            suspend
          </button>
        )}
        {confirmDelete ? (
          <>
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="text-xs text-red-400 px-1.5 py-0.5 rounded bg-red-950/40 hover:bg-red-900/50"
            >
              {remove.isPending ? '…' : 'confirm'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-gray-600 hover:text-red-400 p-0.5 rounded hover:bg-red-950/30"
            title="Remove from watchlist"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Watchlist Detail ─────────────────────────────────────────────────────────

function WatchlistDetail({ watchlist, onBack }: { watchlist: Watchlist; onBack: () => void }) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(watchlist.name)
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set())
  const pausePolling = usePollingGate()

  const { data: liveWl = watchlist } = useQuery({
    queryKey: ['watchlists', watchlist.id],
    queryFn: () => watchlistsApi.get(watchlist.id),
    refetchInterval: pausePolling ? false : 15_000,
    initialData: watchlist,
  })

  const renameMutation = useMutation({
    mutationFn: (name: string) => watchlistsApi.rename(watchlist.id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlists'] })
      qc.invalidateQueries({ queryKey: ['watchlists', watchlist.id] })
      setRenaming(false)
    },
  })

  const bulkSuspendMutation = useMutation({
    mutationFn: async (symbols: string[]) => {
      for (const sym of symbols) {
        await watchlistsApi.updateMemberState(watchlist.id, sym, 'suspended')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlists', watchlist.id] })
      setSelectedSymbols(new Set())
    },
  })

  const bulkRemoveMutation = useMutation({
    mutationFn: async (symbols: string[]) => {
      for (const sym of symbols) {
        await watchlistsApi.removeMember(watchlist.id, sym)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlists', watchlist.id] })
      qc.invalidateQueries({ queryKey: ['watchlists'] })
      setSelectedSymbols(new Set())
    },
  })

  const filtered = liveWl.memberships.filter(m =>
    search ? m.symbol.includes(search.toUpperCase()) : true
  )
  const sorted = [...filtered].sort((a, b) => {
    const order = { active: 0, candidate: 1, pending_removal: 2, inactive: 3, suspended: 4 }
    return (order[a.state] ?? 5) - (order[b.state] ?? 5) || a.symbol.localeCompare(b.symbol)
  })

  const active = liveWl.memberships.filter(m => m.state === 'active')
  const candidate = liveWl.memberships.filter(m => m.state === 'candidate')
  const pendingRemoval = liveWl.memberships.filter(m => m.state === 'pending_removal')
  const suspended = liveWl.memberships.filter(m => m.state === 'suspended')
  const allSymbols = sorted.map(m => m.symbol)
  const allSelected = allSymbols.length > 0 && allSymbols.every(s => selectedSymbols.has(s))

  const toggleSymbol = (sym: string) => {
    setSelectedSymbols(prev => {
      const next = new Set(prev)
      if (next.has(sym)) next.delete(sym)
      else next.add(sym)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-300 mt-0.5">
          <ChevronRight size={14} className="rotate-180" />
        </button>
        <div className="flex-1 min-w-0">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                className="input text-sm font-semibold py-0.5 px-2 w-52"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') renameMutation.mutate(renameValue)
                  if (e.key === 'Escape') setRenaming(false)
                }}
              />
              <button
                onClick={() => renameMutation.mutate(renameValue)}
                disabled={!renameValue.trim() || renameMutation.isPending}
                className="text-emerald-400 hover:text-emerald-300"
              >
                <Check size={13} />
              </button>
              <button onClick={() => setRenaming(false)} className="text-gray-500 hover:text-gray-300">
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-200">{liveWl.name}</span>
              <button
                onClick={() => { setRenameValue(liveWl.name); setRenaming(true) }}
                className="text-gray-600 hover:text-gray-400"
                title="Rename watchlist"
              >
                <Pencil size={11} />
              </button>
              <TypeBadge type={liveWl.watchlist_type} />
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="text-emerald-400">{active.length} active</span>
            {candidate.length > 0 && <span className="text-amber-400">{candidate.length} candidate</span>}
            {pendingRemoval.length > 0 && <span className="text-orange-400">{pendingRemoval.length} pending removal</span>}
            {suspended.length > 0 && <span className="text-red-400">{suspended.length} suspended</span>}
            {liveWl.resolved_at && (
              <span className="flex items-center gap-1">
                <Clock size={10} /> {new Date(liveWl.resolved_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs flex items-center gap-1 text-gray-400 hover:text-gray-200 px-2 py-1 rounded border border-gray-700 hover:border-gray-600"
        >
          <Plus size={12} />
          Add Symbols
        </button>
      </div>

      {showAdd && (
        <AddSymbolsPanel watchlistId={liveWl.id} onDone={() => setShowAdd(false)} />
      )}

      {liveWl.memberships.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              className="input w-full pl-7 text-xs"
              placeholder="Filter symbols..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <span className="text-xs text-gray-600">{sorted.length} shown</span>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedSymbols.size > 0 && (
        <div className="flex items-center gap-3 rounded border border-sky-800 bg-sky-950/30 px-3 py-2">
          <span className="text-xs text-sky-300 font-medium">{selectedSymbols.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              className="text-xs px-2.5 py-1 rounded bg-amber-900/40 text-amber-300 hover:bg-amber-900/60 disabled:opacity-40"
              disabled={bulkSuspendMutation.isPending}
              onClick={() => bulkSuspendMutation.mutate(Array.from(selectedSymbols))}
            >
              Suspend {selectedSymbols.size}
            </button>
            <button
              className="text-xs px-2.5 py-1 rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 disabled:opacity-40"
              disabled={bulkRemoveMutation.isPending}
              onClick={() => {
                if (window.confirm(`Remove ${selectedSymbols.size} symbol(s) from this watchlist?`)) {
                  bulkRemoveMutation.mutate(Array.from(selectedSymbols))
                }
              }}
            >
              Remove {selectedSymbols.size}
            </button>
            <button
              className="text-xs text-gray-500 hover:text-gray-300"
              onClick={() => setSelectedSymbols(new Set())}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {liveWl.memberships.length === 0 ? (
        <div className="rounded border border-gray-800 bg-gray-900/40 px-4 py-6 text-center">
          <p className="text-xs text-gray-500">No symbols yet. Add symbols to get started.</p>
        </div>
      ) : (
        <div className="rounded border border-gray-800 bg-gray-900/40 divide-y divide-gray-800/60">
          {/* Select all header */}
          <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-900/60 border-b border-gray-800/60">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => {
                if (allSelected) setSelectedSymbols(new Set())
                else setSelectedSymbols(new Set(allSymbols))
              }}
              className="accent-sky-500"
            />
            <span className="text-[10px] text-gray-600 uppercase tracking-wide select-none">
              Symbol
            </span>
            <span className="text-[10px] text-gray-600 ml-16 uppercase tracking-wide select-none flex-1">
              State
            </span>
            <span className="text-[10px] text-gray-600 uppercase tracking-wide select-none mr-8">
              Actions
            </span>
          </div>
          {sorted.map(m => (
            <MemberRow
              key={m.symbol}
              m={m}
              watchlistId={liveWl.id}
              selected={selectedSymbols.has(m.symbol)}
              onToggleSelect={() => toggleSymbol(m.symbol)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Watchlist Card ───────────────────────────────────────────────────────────

function WatchlistCard({ wl, onClick }: { wl: Watchlist; onClick: () => void }) {
  const active = activeCount(wl)
  const total = totalCount(wl)

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded border border-gray-800 bg-gray-900/50 hover:border-gray-700 hover:bg-gray-900 px-4 py-3 transition-colors space-y-1.5"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-gray-200">{wl.name}</span>
        <TypeBadge type={wl.watchlist_type} />
        {/* Source pill — how programs reference this */}
        <span className="text-xs text-sky-400/80 border border-sky-800/50 px-1.5 py-0.5 rounded font-mono">
          {wl.name.slice(0, 10).replace(/\s+/g, '_').toUpperCase()} ↗
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="text-emerald-400 font-medium">{active}</span>
        <span className="text-gray-600">/ {total} symbols</span>
        {wl.refresh_cron && (
          <span className="flex items-center gap-1 text-gray-600">
            <Clock size={10} /> {wl.refresh_cron}
          </span>
        )}
        {wl.resolved_at && (
          <span className="text-gray-700">updated {new Date(wl.resolved_at).toLocaleDateString()}</span>
        )}
      </div>
    </button>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function WatchlistLibrary() {
  const pausePolling = usePollingGate()
  const [selected, setSelected] = useState<Watchlist | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const qc = useQueryClient()

  const { data: watchlists = [], isLoading, error } = useQuery({
    queryKey: ['watchlists'],
    queryFn: () => watchlistsApi.list(),
    refetchInterval: pausePolling ? false : 30_000,
  })

  const handleCreated = (wl: Watchlist) => {
    qc.invalidateQueries({ queryKey: ['watchlists'] })
    setShowCreate(false)
    setSelected(wl)
  }

  if (selected) {
    return (
      <div className="max-w-2xl mx-auto">
        <WatchlistDetail watchlist={selected} onBack={() => setSelected(null)} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />}

      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-gray-200">Watchlist Library</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary text-xs flex items-center gap-1.5"
        >
          <Plus size={13} />
          New Watchlist
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-gray-500 py-8 justify-center">
          <RefreshCw size={13} className="animate-spin" /> Loading...
        </div>
      )}

      {error && (
        <div className="rounded border border-red-800 bg-red-950/20 px-3 py-2 text-xs text-red-400">
          {(error as Error).message}
        </div>
      )}

      {!isLoading && watchlists.length === 0 && (
        <div className="rounded border border-gray-800 bg-gray-900/40 px-4 py-8 text-center space-y-2">
          <p className="text-sm text-gray-400">No watchlists yet</p>
          <p className="text-xs text-gray-600">Watchlists are the universe source for TradingPrograms. Create a manual list or a scanner-driven list.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs mt-2">Create First Watchlist</button>
        </div>
      )}

      <div className="space-y-2">
        {watchlists.map(wl => (
          <WatchlistCard key={wl.id} wl={wl} onClick={() => setSelected(wl)} />
        ))}
      </div>
    </div>
  )
}
