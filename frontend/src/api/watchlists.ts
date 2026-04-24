import { api } from './client'

export interface WatchlistMembership {
  symbol: string
  state: 'candidate' | 'active' | 'pending_removal' | 'inactive' | 'suspended'
  resolved_at: string | null
  candidate_since: string | null
  active_since: string | null
  pending_removal_since: string | null
  inactive_until: string | null
  suspended_at: string | null
  metadata: Record<string, unknown>
}

export interface Watchlist {
  id: string
  name: string
  watchlist_type: 'manual' | 'scanner' | 'index' | 'sector_rotation' | 'earnings_calendar'
  refresh_cron: string | null
  min_refresh_interval_minutes: number
  config: Record<string, unknown>
  is_golden: boolean
  tags: string[]
  created_at: string | null
  updated_at: string | null
  resolved_at: string | null
  memberships: WatchlistMembership[]
}

export const watchlistsApi = {
  list: (): Promise<Watchlist[]> =>
    api.get('/watchlists').then((r) => r.data),

  get: (id: string): Promise<Watchlist> =>
    api.get(`/watchlists/${id}`).then((r) => r.data),

  create: (data: {
    name: string
    watchlist_type?: string
    refresh_cron?: string
    min_refresh_interval_minutes?: number
    config?: Record<string, unknown>
  }): Promise<Watchlist> =>
    api.post('/watchlists', data).then((r) => r.data),

  refresh: (id: string, symbols: string[]): Promise<Watchlist> =>
    api.post(`/watchlists/${id}/refresh`, { symbols }).then((r) => r.data),

  updateMemberState: (id: string, symbol: string, state: string, reason?: string) =>
    api.patch(`/watchlists/${id}/members/${symbol}`, { state, reason }).then((r) => r.data),

  removeMember: (id: string, symbol: string) =>
    api.delete(`/watchlists/${id}/members/${symbol}`).then((r) => r.data),

  rename: (id: string, name: string) =>
    api.patch(`/watchlists/${id}`, { name }).then((r) => r.data as Watchlist),

  delete: (id: string) =>
    api.delete(`/watchlists/${id}`).then((r) => r.data),

  duplicate: (id: string): Promise<Watchlist> =>
    api.post(`/watchlists/${id}/duplicate`).then((r) => r.data),
}
