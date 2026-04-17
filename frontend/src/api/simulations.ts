import { api } from './client'

export interface CreateSimulationRequest {
  strategy_version_id: string
  symbols: string[]
  timeframe: string
  start_date: string
  end_date: string
  initial_capital?: number
  commission_per_share?: number
  slippage_ticks?: number
  data_provider?: string
  alpaca_api_key?: string
  alpaca_secret_key?: string
}

export interface SimulationMetadata {
  simulation_id: string
  total_bars: number
  symbols: string[]
  timeframe: string
  start_date: string
  end_date: string
  initial_capital: number
  indicators: string[]
  strategy_name: string
  status?: string
  speed?: number
}

export interface PositionSnapshot {
  symbol: string
  direction: 'long' | 'short'
  quantity: number
  avg_entry: number
  current_price: number
  stop_price: number | null
  target_prices: number[]
  unrealized_pnl: number
  unrealized_pnl_pct: number
  max_favorable: number
  max_adverse: number
  entry_time: string | null
  regime_at_entry: string | null
  trade_id: string | null
  initial_risk: number | null
}

export interface TradeEvent {
  symbol: string
  direction: string
  quantity: number
  entry_price: number
  exit_price?: number
  stop_price?: number
  target_prices?: number[]
  gross_pnl?: number
  net_pnl?: number
  commission: number
  exit_reason?: string
  entry_time?: string
  exit_time?: string
  trade_id?: string
  regime_at_entry?: string
  initial_risk?: number
  r_multiple?: number | null
}

export interface RejectionEvent {
  symbol: string
  direction: string
  quantity: number
  price: number
  reason: string
}

export interface BarSnapshotData {
  bar_num: number
  timestamp: string
  total_bars: number
  progress_pct: number
  symbols: Record<string, Record<string, number | string | null>>
  entries: TradeEvent[]
  exits: TradeEvent[]
  scale_events: TradeEvent[]
  rejections: RejectionEvent[]
  equity: number
  cash: number
  drawdown: number
  unrealized_pnl: number
  total_return_pct: number
  open_positions: PositionSnapshot[]
  daily_pnl: number
  daily_trade_count: number
  portfolio_heat: number
  risk_killed: boolean
  cooldowns: Record<string, { trigger: string; expires_at_bar?: number; consecutive_losses: number }>
  regime: string
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate: number
  total_net_pnl: number
}

export const simulationsApi = {
  create: (data: CreateSimulationRequest) =>
    api.post<SimulationMetadata>('/simulations/create', data).then((r) => r.data),

  list: () =>
    api.get<SimulationMetadata[]>('/simulations').then((r) => r.data),

  get: (id: string) =>
    api.get<SimulationMetadata>(`/simulations/${id}`).then((r) => r.data),

  step: (id: string) =>
    api.post<BarSnapshotData>(`/simulations/${id}/step`).then((r) => r.data),

  skip: (id: string, targetBar: number) =>
    api.post<BarSnapshotData>(`/simulations/${id}/skip`, { target_bar: targetBar }).then((r) => r.data),

  skipToTrade: (id: string) =>
    api.post<BarSnapshotData>(`/simulations/${id}/skip-to-trade`).then((r) => r.data),

  finalize: (id: string) =>
    api.post(`/simulations/${id}/finalize`).then((r) => r.data),

  getEquityCurve: (id: string) =>
    api.get<{ equity_curve: any[] }>(`/simulations/${id}/equity-curve`).then((r) => r.data),

  getTrades: (id: string) =>
    api.get<{ trades: any[] }>(`/simulations/${id}/trades`).then((r) => r.data),

  delete: (id: string) =>
    api.delete(`/simulations/${id}`).then((r) => r.data),
}

/**
 * Create a WebSocket connection to a simulation session.
 * Returns the WebSocket instance for sending commands.
 */
export function createSimulationWs(simulationId: string): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  // WebSocket is mounted directly on the app at /ws/simulation/{id}
  // (not on the /api/v1/simulations router) to avoid route collision.
  return new WebSocket(`${protocol}//${host}/ws/simulation/${simulationId}`)
}
