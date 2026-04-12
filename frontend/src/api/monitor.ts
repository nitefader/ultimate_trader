import api from './client'

export interface LiveRun {
  id: string
  mode: 'paper' | 'live'
  status: string
  strategy_id: string
  strategy_name: string | null
  account_id: string
  account_name: string
  account_mode: string
  account_equity: number
  account_unrealized_pnl: number
  broker: string
  started_at: string | null
  created_at: string
  config_overrides: Record<string, unknown>
}

export interface LivePosition {
  symbol: string
  qty: number | null
  side: string
  avg_entry_price: number | null
  current_price: number | null
  market_value: number | null
  cost_basis: number | null
  unrealized_pl: number | null
  unrealized_plpc: number | null
  unrealized_intraday_pl: number | null
  change_today: number | null
}

export interface LiveOrder {
  id: string
  client_order_id: string | null
  symbol: string
  qty: number | null
  filled_qty: number
  side: string
  type: string
  time_in_force: string
  limit_price: number | null
  stop_price: number | null
  filled_avg_price: number | null
  status: string
  created_at: string | null
  filled_at: string | null
}

export interface LiveAccountData {
  id?: string
  cash: number
  equity: number
  portfolio_value: number
  buying_power?: number
  unrealized_pnl?: number
  simulated?: boolean
  paper?: boolean
  error?: string
}

export interface RunDetail extends LiveRun {
  live_account: LiveAccountData
  open_orders: LiveOrder[]
}

export const monitorApi = {
  listRuns: () =>
    api.get<LiveRun[]>('/monitor/runs').then(r => r.data),

  getRunDetail: (id: string) =>
    api.get<RunDetail>(`/monitor/runs/${id}`).then(r => r.data),

  getPositions: (id: string) =>
    api.get<LivePosition[]>(`/monitor/runs/${id}/positions`).then(r => r.data),

  getOrders: (id: string, status = 'open') =>
    api.get<LiveOrder[]>(`/monitor/runs/${id}/orders`, { params: { status } }).then(r => r.data),

  closePosition: (id: string, symbol: string, qty?: number) =>
    api.post(`/monitor/runs/${id}/close-position`, { symbol, qty }).then(r => r.data),

  closeAll: (id: string) =>
    api.post(`/monitor/runs/${id}/close-all`).then(r => r.data),
}
