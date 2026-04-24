import { api } from './client'

export interface TradingProgram {
  id: string
  name: string
  version: number
  description: string | null
  notes: string | null
  status: 'draft' | 'frozen' | 'deprecated'
  duration_mode: string
  strategy_version_id: string | null
  strategy_governor_id: string | null
  execution_style_id: string | null
  risk_profile_id: string | null
  optimization_profile_id: string | null
  weight_profile_id: string | null
  symbol_universe_snapshot_id: string | null
  execution_policy: Record<string, unknown>
  watchlist_subscriptions: string[]
  watchlist_combination_rule: string
  parent_program_id: string | null
  frozen_at: string | null
  frozen_by: string | null
  deprecation_reason: string | null
  created_at: string | null
  updated_at: string | null
  created_by: string
}

export interface AccountAllocation {
  id: string
  trading_program_id: string
  account_id: string
  status: 'pending' | 'paper' | 'promoted_to_live' | 'paused' | 'stopped' | 'killed'
  broker_mode: 'paper' | 'live'
  conflict_resolution: 'first_wins' | 'aggregate'
  allocated_capital_usd: number
  position_size_scale_pct: number | null
  session_window_shift_min: number | null
  drawdown_threshold_pct: number | null
  started_at: string | null
  stopped_at: string | null
  promoted_at: string | null
  promoted_by: string | null
  stop_reason: string | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export interface PromotionReview {
  can_promote: boolean
  blocking_issues: string[]
  warnings: string[]
  review_payload: Record<string, unknown>
}

export interface ProgramValidation {
  can_deploy: boolean
  missing_components: string[]
  warnings: string[]
  expected_behavior: string[]
  attached_components: Record<string, boolean>
}

export const programsApi = {
  list: (): Promise<TradingProgram[]> =>
    api.get('/programs').then((r) => r.data),

  get: (id: string): Promise<TradingProgram> =>
    api.get(`/programs/${id}`).then((r) => r.data),

  create: (data: {
    name: string
    description?: string
    notes?: string
    strategy_version_id?: string
    strategy_governor_id?: string
    execution_style_id?: string
    risk_profile_id?: string
    optimization_profile_id?: string
    weight_profile_id?: string
    symbol_universe_snapshot_id?: string
    execution_policy?: Record<string, unknown>
    duration_mode?: string
    parent_program_id?: string
  }): Promise<TradingProgram> =>
    api.post('/programs', data).then((r) => r.data),

  update: (id: string, updates: Partial<TradingProgram>): Promise<TradingProgram> =>
    api.patch(`/programs/${id}`, updates).then((r) => r.data),

  validate: (id: string): Promise<ProgramValidation> =>
    api.post(`/programs/${id}/validate`).then((r) => r.data),

  deprecate: (id: string, reason = 'superseded'): Promise<TradingProgram> =>
    api.post(`/programs/${id}/deprecate`, null, { params: { reason } }).then((r) => r.data),

  listAllocations: (programId: string): Promise<AccountAllocation[]> =>
    api.get(`/programs/${programId}/allocations`).then((r) => r.data),

  createAllocation: (programId: string, data: {
    account_id: string
    allocated_capital_usd?: number
    conflict_resolution?: string
    broker_mode?: string
    position_size_scale_pct?: number
    session_window_shift_min?: number
    drawdown_threshold_pct?: number
    notes?: string
  }): Promise<AccountAllocation> =>
    api.post(`/programs/${programId}/allocations`, data).then((r) => r.data),

  startAllocation: (programId: string, allocationId: string): Promise<AccountAllocation> =>
    api.post(`/programs/${programId}/allocations/${allocationId}/start`).then((r) => r.data),

  stopAllocation: (programId: string, allocationId: string, reason = 'manual'): Promise<AccountAllocation> =>
    api.post(`/programs/${programId}/allocations/${allocationId}/stop`, null, { params: { reason } }).then((r) => r.data),

  preparePromotion: (programId: string, allocationId: string, data: {
    paper_perf_summary?: Record<string, unknown>
    safety_checklist?: Record<string, boolean>
    reviewer?: string
  }): Promise<PromotionReview> =>
    api.post(`/programs/${programId}/allocations/${allocationId}/promotion-review`, data).then((r) => r.data),

  executePromotion: (programId: string, allocationId: string, reviewPayload: Record<string, unknown>): Promise<AccountAllocation> =>
    api.post(`/programs/${programId}/allocations/${allocationId}/promote`, {
      review_payload: reviewPayload,
      promoted_by: 'user',
    }).then((r) => r.data),

  revertPromotion: (programId: string, allocationId: string, reason: string): Promise<AccountAllocation> =>
    api.post(`/programs/${programId}/allocations/${allocationId}/revert`, {
      reason,
      reverted_by: 'user',
    }).then((r) => r.data),
}
