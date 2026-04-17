import api from './client'
import axios from 'axios'

export interface DataItem {
  symbol: string
  timeframe: string
  provider: 'yfinance' | 'alpaca'
  first_date: string
  last_date: string
  bar_count: number
  file_size_kb: number
  downloaded_at?: string
}

export interface TickerResult {
  symbol: string
  name: string
  type: string
  exchange: string
  tradable?: boolean
}

export interface FetchResult {
  symbol: string
  timeframe: string
  provider: string
  bar_count: number
  first_date: string
  last_date: string
}

export interface BatchFetchResult {
  results: Array<{ symbol: string; status: 'ok' | 'error'; bar_count?: number; error?: string }>
}

export interface DataBar {
  t: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface CachedBarsResponse {
  symbol: string
  timeframe: string
  provider: 'yfinance' | 'alpaca'
  bars: DataBar[]
}

export interface ProviderInfo {
  name: string
  supported_timeframes: string[]
  intraday_max_days: Record<string, number>
  max_history_years: number
  requires_credentials: boolean
  notes: string
}

export interface ProvidersResponse {
  providers: {
    yfinance: ProviderInfo
    alpaca: ProviderInfo
  }
}

export const dataApi = {
  getProviders: () =>
    api.get<ProvidersResponse>('/data/providers').then(r => r.data),

  getInventory: () =>
    api.get<{ items: DataItem[] }>('/data/inventory').then(r => r.data.items),

  getSymbolInventory: (symbol: string, timeframe: string, provider = 'yfinance') =>
    api.get<DataItem>(`/data/inventory/${symbol}/${timeframe}`, { params: { provider } }).then(r => r.data),

  getBars: (symbol: string, timeframe: string, provider: 'yfinance' | 'alpaca', limit = 2000) =>
    api.get<CachedBarsResponse>(`/data/bars/${symbol}/${timeframe}`, { params: { provider, limit } })
      .then(r => r.data)
      .catch(async (err: any) => {
        const isNotFound = String(err?.message || '').toLowerCase().includes('not found')
        const isLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
        if (!isNotFound || !isLocal) {
          throw err
        }

        // Local resilience: if a stale backend is still bound to 8000, try the fresh backend on 8010.
        try {
          const fallback = await axios.get<CachedBarsResponse>(
            `http://127.0.0.1:8010/api/v1/data/bars/${symbol}/${timeframe}`,
            { params: { provider, limit } },
          )
          return fallback.data
        } catch {
          // Preserve the original 404-style signal so UI can show an actionable message.
          throw err
        }
      }),

  search: (q: string, provider = 'yfinance', apiKey = '', secretKey = '', limit = 15) =>
    api.get<{ results: TickerResult[]; provider: string }>('/data/search', {
      params: { q, provider, api_key: apiKey, secret_key: secretKey, limit },
    }).then(r => r.data),

  fetch: (params: {
    symbol: string
    timeframe: string
    start: string
    end: string
    provider: 'yfinance' | 'alpaca'
    force?: boolean
    api_key?: string
    secret_key?: string
  }) => api.post<FetchResult>('/data/fetch', params).then(r => r.data),

  fetchMany: (params: {
    symbols: string[]
    timeframe: string
    start: string
    end: string
    provider: 'yfinance' | 'alpaca'
    api_key?: string
    secret_key?: string
  }) => api.post<BatchFetchResult>('/data/fetch-many', params).then(r => r.data),

  deleteCache: (symbol: string, timeframe: string, provider = 'yfinance') =>
    api.delete(`/data/cache/${symbol}/${timeframe}`, { params: { provider } }).then(r => r.data),
}
