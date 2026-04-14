/**
 * WatchlistToastRail — persistent bottom-right toast rail for watchlist updates.
 *
 * Polls watchlist active counts every 60s and fires toasts when counts change.
 * Format: "Momentum Scan — 4 added, 2 removed · 2 min ago" with "Review" link.
 */
import React, { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { watchlistsApi } from '../api/watchlists'
import { useWatchlistToastStore } from '../stores/useWatchlistToastStore'
import { usePollingGate } from '../hooks/usePollingGate'
import { X, BookOpen, ExternalLink } from 'lucide-react'
import clsx from 'clsx'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins === 1) return '1 min ago'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  return hrs === 1 ? '1 hr ago' : `${hrs} hrs ago`
}

export function WatchlistToastRail() {
  const pausePolling = usePollingGate()
  const { toasts, recordSnapshot, acknowledge, clearOld } = useWatchlistToastStore()

  // Poll watchlists every 60s to detect membership changes
  const { data: watchlists = [] } = useQuery({
    queryKey: ['watchlists', 'toast-poll'],
    queryFn: () => watchlistsApi.list(),
    refetchInterval: pausePolling ? false : 60_000,
    staleTime: 30_000,
  })

  // Record snapshots whenever watchlist data refreshes
  useEffect(() => {
    for (const wl of watchlists) {
      const activeCount = wl.memberships.filter(m => m.state === 'active').length
      recordSnapshot(wl.id, wl.name, activeCount)
    }
  }, [watchlists, recordSnapshot])

  // Clean up acknowledged old toasts every 5 min
  useEffect(() => {
    const interval = setInterval(() => clearOld(), 5 * 60_000)
    return () => clearInterval(interval)
  }, [clearOld])

  const visible = toasts.filter(t => !t.acknowledged)

  if (visible.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 space-y-2 w-80 pointer-events-none">
      {visible.map(toast => (
        <div
          key={toast.id}
          className={clsx(
            'pointer-events-auto flex items-start gap-2.5 rounded border bg-gray-900 px-3 py-2.5 shadow-lg shadow-black/40',
            toast.added > 0 && toast.removed === 0
              ? 'border-emerald-800'
              : toast.removed > 0 && toast.added === 0
              ? 'border-orange-800'
              : 'border-amber-800',
          )}
        >
          <BookOpen size={13} className="text-gray-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-200 truncate">{toast.watchlistName}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {toast.added > 0 && (
                <span className="text-emerald-400">{toast.added} added</span>
              )}
              {toast.added > 0 && toast.removed > 0 && (
                <span className="text-gray-600">, </span>
              )}
              {toast.removed > 0 && (
                <span className="text-orange-400">{toast.removed} removed</span>
              )}
              <span className="text-gray-600"> · {relativeTime(toast.timestamp)}</span>
            </div>
            <Link
              to="/watchlists"
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 mt-1"
              onClick={() => acknowledge(toast.id)}
            >
              Review Changes <ExternalLink size={10} />
            </Link>
          </div>
          <button
            onClick={() => acknowledge(toast.id)}
            className="text-gray-600 hover:text-gray-400 flex-shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
