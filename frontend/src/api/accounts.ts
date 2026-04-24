import api from './client'
import type { Account, Deployment, KillSwitchStatus } from '../types'

export interface DeploymentTradeRow {
  id: string
  symbol: string
  direction: string
  entry_time: string | null
  entry_price: number
  quantity: number
  initial_stop: number | null
  current_stop: number | null
  current_price: number | null
  unrealized_pnl: number | null
  exit_time: string | null
  exit_price: number | null
  exit_reason: string | null
  net_pnl: number | null
  r_multiple: number | null
  is_open: boolean
  regime_at_entry: string | null
}

export const accountsApi = {
  list: (refresh = false, includeActivity = false) =>
    api.get<Account[]>('/accounts', { params: { refresh, include_activity: includeActivity } }).then(r => r.data),
  refresh: (id: string) => api.post<Account>(`/accounts/${id}/refresh`).then(r => r.data),
  get: (id: string) => api.get<Account>(`/accounts/${id}`).then(r => r.data),
  create: (data: Partial<Account>) => api.post<Account>('/accounts', data).then(r => r.data),
  update: (id: string, data: Partial<Account>) => api.put<Account>(`/accounts/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete<void>(`/accounts/${id}`).then(r => r.data),
  getCredentials: (id: string) => api.get(`/accounts/${id}/credentials`).then(r => r.data),
  updateCredentials: (id: string, data: { broker_config: Record<string, unknown> }) =>
    api.put(`/accounts/${id}/credentials`, data).then(r => r.data),
  validateCredentials: (id: string) => api.post(`/accounts/${id}/credentials/validate`).then(r => r.data),
  getBrokerStatus: (id: string) => api.get(`/accounts/${id}/broker/status`).then(r => r.data),
  getBrokerOrders: (id: string, status = 'open') => api.get(`/accounts/${id}/broker/orders`, { params: { status_filter: status } }).then(r => r.data),
  syncFromBroker: (id: string) => api.post<{ synced: boolean; initial_balance: number; leverage: number; equity: number; multiplier: number }>(`/accounts/${id}/sync-from-broker`).then(r => r.data),
  halt: (id: string, reason: string) =>
    api.post(`/accounts/${id}/halt`, { reason }).then(r => r.data),
  resume: (id: string) => api.post(`/accounts/${id}/resume`).then(r => r.data),
  flatten: (id: string) => api.post(`/accounts/${id}/flatten`).then(r => r.data),
  emergencyExit: (id: string, reason: string) =>
    api.post(`/accounts/${id}/emergency-exit`, { reason }).then(r => r.data),
}

export const deploymentsApi = {
  list: (accountId?: string, mode?: string) =>
    api.get<Deployment[]>('/deployments', { params: { account_id: accountId, mode } }).then(r => r.data),
  get: (id: string) => api.get<Deployment>(`/deployments/${id}`).then(r => r.data),
  promoteToPaper: (data: {
    strategy_version_id: string
    account_id: string
    run_id?: string
    notes?: string
  }) => api.post<Deployment>('/deployments/promote-to-paper', data).then(r => r.data),
  promoteToLive: (data: {
    paper_deployment_id: string
    live_account_id: string
    notes?: string
    safety_checklist: Record<string, boolean>
  }) => api.post<Deployment>('/deployments/promote-to-live', data).then(r => r.data),
  start: (id: string) => api.post(`/deployments/${id}/start`).then(r => r.data),
  pause: (id: string) => api.post(`/deployments/${id}/pause`).then(r => r.data),
  stop: (id: string, reason?: string) => api.post(`/deployments/${id}/stop`, { reason }).then(r => r.data),
  getPositions: (id: string) => api.get(`/deployments/${id}/positions`).then(r => r.data),
  scaleOut: (id: string, symbol: string, exitPct: number) =>
    api.post(`/deployments/${id}/positions/${symbol}/scale-out`, { exit_pct: exitPct }).then(r => r.data),
  replaceStop: (id: string, symbol: string, orderId: string, stopPrice: number, qty?: number) =>
    api.post(`/deployments/${id}/positions/${symbol}/replace-stop`, { order_id: orderId, stop_price: stopPrice, qty }).then(r => r.data),
  moveStopToBreakeven: (id: string, symbol: string, orderId: string, entryPrice: number, currentAtr: number, qty?: number, bePad?: number) =>
    api.post(`/deployments/${id}/positions/${symbol}/move-stop-be`, { order_id: orderId, entry_price: entryPrice, current_atr: currentAtr, qty, breakeven_atr_pad: bePad }).then(r => r.data),
  getTrades: (id: string, openOnly = false) =>
    api.get<{
      trades: DeploymentTradeRow[]
      summary: { open_count: number; closed_count: number; total_realized_pnl: number; total_unrealized_pnl: number; win_rate_pct: number | null }
    }>(`/deployments/${id}/trades`, { params: { open_only: openOnly } }).then(r => r.data),
}

export interface OrderAuditEntry {
  order_id: string
  client_order_id: string | null
  symbol: string
  side: string
  qty: number
  intent: string
  reason: string
  deployment_id: string | null
}

export interface SweepResult {
  scope: string
  dry_run: boolean
  orders_canceled: OrderAuditEntry[]
  orders_skipped_protective: OrderAuditEntry[]
  orders_skipped_has_position: OrderAuditEntry[]
  orders_skipped_unknown: OrderAuditEntry[]
  errors: string[]
  kill_state_fetch_failed: boolean
  account_id?: string
}

export interface KillAllResponse {
  action: string
  scope: string
  scope_id: string | null
  status: string
  reason: string
  kill_switch: KillSwitchStatus
  sweep: SweepResult[]
}

export interface DeploymentPauseResponse {
  action: string
  scope: string
  scope_id: string
  status: string
  kill_state_fetch_failed: boolean
  orders_canceled: OrderAuditEntry[]
  orders_skipped_protective: OrderAuditEntry[]
  orders_skipped_has_position: OrderAuditEntry[]
  orders_skipped_unknown: OrderAuditEntry[]
  errors: string[]
}

export const controlApi = {
  status: () => api.get<{ kill_switch: KillSwitchStatus; platform_mode: string }>('/control/status').then(r => r.data),
  killAll: (reason: string, dryRun = false) =>
    api.post<KillAllResponse>('/control/kill-all', { reason, dry_run: dryRun }).then(r => r.data),
  resumeAll: () => api.post('/control/resume-all', {}).then(r => r.data),
  killStrategy: (id: string, reason: string) =>
    api.post(`/control/kill-strategy/${id}`, { reason }).then(r => r.data),
  pauseStrategy: (id: string) => api.post(`/control/pause-strategy/${id}`).then(r => r.data),
  resumeStrategy: (id: string) => api.post(`/control/resume-strategy/${id}`).then(r => r.data),
  pauseDeployment: (id: string, dryRun = false) =>
    api.post<DeploymentPauseResponse>(`/control/pause-deployment/${id}`, { dry_run: dryRun }).then(r => r.data),
  resumeDeployment: (id: string) =>
    api.post(`/control/resume-deployment/${id}`).then(r => r.data),
  events: (limit?: number) =>
    api.get('/control/kill-events', { params: { limit } }).then(r => r.data),
}
