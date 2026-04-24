import api from './client'
import type { Strategy, StrategyVersion, StrategyConfig, StrategyValidationResult } from '../types'

export const strategiesApi = {
  list: () => api.get<Strategy[]>('/strategies').then(r => r.data),
  get: (id: string) => api.get<Strategy & { versions: StrategyVersion[] }>(`/strategies/${id}`).then(r => r.data),
  create: (data: { name: string; description?: string; category?: string; config: StrategyConfig; duration_mode?: string; notes?: string }) =>
    api.post<{ id: string; version_id: string }>('/strategies', data).then(r => r.data),
  update: (id: string, data: Partial<Strategy>) =>
    api.put(`/strategies/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/strategies/${id}`).then(r => r.data),
  createVersion: (id: string, data: { config: StrategyConfig; notes?: string }) =>
    api.post<{ id: string; version: number }>(`/strategies/${id}/versions`, data).then(r => r.data),
  getVersion: (strategyId: string, versionId: string) =>
    api.get<StrategyVersion>(`/strategies/${strategyId}/versions/${versionId}`).then(r => r.data),
  deleteVersion: (strategyId: string, versionId: string) =>
    api.delete(`/strategies/${strategyId}/versions/${versionId}`).then(r => r.data),
  patchVersion: (strategyId: string, versionId: string, data: { config?: StrategyConfig; notes?: string }) =>
    api.patch(`/strategies/${strategyId}/versions/${versionId}`, data).then(r => r.data),
  validate: (config: StrategyConfig) =>
    api.post<StrategyValidationResult>('/strategies/validate', { config }).then(r => r.data),
  indicatorKinds: () =>
    api.get<string[]>('/strategies/indicator-kinds').then(r => r.data),
  export: (id: string) =>
    api.get<Record<string, unknown>>(`/strategies/${id}/export`).then(r => r.data),
  import: (payload: Record<string, unknown>, nameOverride?: string) =>
    api.post<{ strategy_id: string; strategy_name: string; versions_imported: number; status: string }>(
      '/strategies/import',
      { payload, name_override: nameOverride ?? null },
    ).then(r => r.data),
  diffVersions: (strategyId: string, v1Id: string, v2Id: string) =>
    api.get<{
      strategy_id: string
      v1: { id: string; version: number; notes?: string; created_at: string | null }
      v2: { id: string; version: number; notes?: string; created_at: string | null }
      added: Array<{ path: string; v1_value: null; v2_value: unknown }>
      removed: Array<{ path: string; v1_value: unknown; v2_value: null }>
      changed: Array<{ path: string; v1_value: unknown; v2_value: unknown }>
      total_changes: number
    }>(`/strategies/${strategyId}/versions/${v1Id}/diff/${v2Id}`).then(r => r.data),
  generateConditions: (prompt: string, conditionType: 'entry' | 'exit' | 'stop' = 'entry') =>
    api.post<{ conditions: import('../types').Condition[]; logic: string }>(
      '/strategies/generate-conditions',
      { prompt, condition_type: conditionType },
    ).then(r => r.data),
  generateBrief: (prompt: string) =>
    api.post<{
      name: string
      hypothesis: string
      description: string
      conditions: import('../types').Condition[]
      logic: string
      short_conditions: import('../types').Condition[]
      short_logic: string
      assumptions: string[]
      warnings: string[]
      partial_success: boolean
    }>('/strategies/generate-brief', { prompt }).then(r => r.data),
}
