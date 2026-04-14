/**
 * Watchlist update toast rail store.
 *
 * Polls watchlist membership counts and fires toast notifications when
 * active symbol counts change. Toasts are acknowledged individually or cleared
 * when navigating to the Watchlist Library.
 */
import { create } from 'zustand'

export interface WatchlistToast {
  id: string
  watchlistId: string
  watchlistName: string
  added: number
  removed: number
  timestamp: number   // Date.now()
  acknowledged: boolean
}

interface WatchlistToastState {
  toasts: WatchlistToast[]
  // Snapshot of last-known active counts per watchlist (used to detect changes)
  _lastCounts: Record<string, number>

  // Actions
  recordSnapshot: (watchlistId: string, name: string, activeCount: number) => void
  acknowledge: (id: string) => void
  acknowledgeAll: () => void
  clearOld: (olderThanMs?: number) => void
}

export const useWatchlistToastStore = create<WatchlistToastState>((set, get) => ({
  toasts: [],
  _lastCounts: {},

  recordSnapshot: (watchlistId, name, activeCount) => {
    const { _lastCounts, toasts } = get()
    const prev = _lastCounts[watchlistId]

    if (prev === undefined) {
      // First observation — just store the baseline, no toast
      set({ _lastCounts: { ..._lastCounts, [watchlistId]: activeCount } })
      return
    }

    const delta = activeCount - prev
    if (delta === 0) return

    const added = Math.max(0, delta)
    const removed = Math.max(0, -delta)

    const toast: WatchlistToast = {
      id: `${watchlistId}-${Date.now()}`,
      watchlistId,
      watchlistName: name,
      added,
      removed,
      timestamp: Date.now(),
      acknowledged: false,
    }

    set({
      _lastCounts: { ..._lastCounts, [watchlistId]: activeCount },
      // Keep at most 10 toasts; prepend newest
      toasts: [toast, ...toasts.filter(t => t.watchlistId !== watchlistId || t.acknowledged)].slice(0, 10),
    })
  },

  acknowledge: (id) =>
    set(s => ({
      toasts: s.toasts.map(t => t.id === id ? { ...t, acknowledged: true } : t),
    })),

  acknowledgeAll: () =>
    set(s => ({ toasts: s.toasts.map(t => ({ ...t, acknowledged: true })) })),

  clearOld: (olderThanMs = 5 * 60 * 1000) => {
    const cutoff = Date.now() - olderThanMs
    set(s => ({ toasts: s.toasts.filter(t => !t.acknowledged || t.timestamp > cutoff) }))
  },
}))
