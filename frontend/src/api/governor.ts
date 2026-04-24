import api from './client'
import type { PortfolioGovernor, GovernorEvent } from '../types'

export const governorApi = {
  list: () =>
    api.get<PortfolioGovernor[]>('/governor').then(r => r.data),

  get: (accountId: string) =>
    api.get<PortfolioGovernor>(`/governor/${accountId}`).then(r => r.data),

  bootstrap: (accountId: string) =>
    api.post<PortfolioGovernor>(`/governor/${accountId}/bootstrap`).then(r => r.data),

  halt: (accountId: string, reason = '') =>
    api.post(`/governor/${accountId}/halt`, { reason }).then(r => r.data),

  resume: (accountId: string) =>
    api.post(`/governor/${accountId}/resume`).then(r => r.data),

  getEvents: (accountId: string, params?: { event_type?: string; limit?: number; offset?: number }) =>
    api.get<{ events: GovernorEvent[] }>(`/governor/${accountId}/events`, { params })
      .then(r => r.data?.events ?? [])
      .catch(() => [] as GovernorEvent[]),

  allocate: (accountId: string, data: { program_id: string; allocated_capital_usd: number; broker_mode: string }) =>
    api.post<{ allocation_id: string; program_name: string; status: string }>(`/governor/${accountId}/allocate`, data).then(r => r.data),

  portfolioSnapshot: (accountId: string) =>
    api.get<{
      account_id: string
      governor_id: string
      total_allocated_capital_usd: number
      program_count: number
      programs: Array<{
        allocation_id: string
        program_id: string
        program_name: string
        status: string
        broker_mode: string
        allocated_capital_usd: number
        capital_pct: number
        symbol_count: number
        symbols: string[]
      }>
      symbol_overlap: Array<{ program_a: string; program_b: string; shared_symbols: string[]; overlap_count: number }>
      collision_risk_symbols: Array<{ symbol: string; programs: string[] }>
    }>(`/governor/${accountId}/portfolio-snapshot`).then(r => r.data),
}
