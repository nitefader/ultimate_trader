import api from './client'
import type { Strategy, StrategyVersion, StrategyConfig } from '../types'

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
  validate: (config: StrategyConfig) =>
    api.post<{ valid: boolean; errors: string[]; warnings: string[] }>('/strategies/validate', { config }).then(r => r.data),
}
