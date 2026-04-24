import api from './client'
import type { RiskProfile } from '../types'

export interface RiskProfileAnalysis {
  health: 'good' | 'caution' | 'risky'
  summary: string
  suggested_name: string
  suggested_description: string
  insights: { label: string; text: string; tone: 'ok' | 'warn' | 'danger' }[]
  suggestions: string[]
}

export const riskProfilesApi = {
  list: () =>
    api.get<RiskProfile[]>('/risk-profiles').then(r => r.data),

  get: (id: string) =>
    api.get<RiskProfile>(`/risk-profiles/${id}`).then(r => r.data),

  create: (data: Partial<RiskProfile>) =>
    api.post<RiskProfile>('/risk-profiles', data).then(r => r.data),

  update: (id: string, data: Partial<RiskProfile>) =>
    api.put<RiskProfile>(`/risk-profiles/${id}`, data).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/risk-profiles/${id}`).then(r => r.data),

  duplicate: (id: string) =>
    api.post<RiskProfile>(`/risk-profiles/${id}/duplicate`).then(r => r.data),

  attachToAccount: (accountId: string, profileId: string) =>
    api.put(`/accounts/${accountId}/risk-profile`, { risk_profile_id: profileId }).then(r => r.data),

  detachFromAccount: (accountId: string) =>
    api.delete(`/accounts/${accountId}/risk-profile`).then(r => r.data),

  analyze: (params: Omit<RiskProfile, 'id' | 'name' | 'description' | 'source_type' | 'source_run_id' | 'source_optimization_id' | 'is_golden' | 'tags' | 'created_at' | 'updated_at' | 'linked_accounts'>) =>
    api.post<RiskProfileAnalysis>('/risk-profiles/analyze', params).then(r => r.data),
}
