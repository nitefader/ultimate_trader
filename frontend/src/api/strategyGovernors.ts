import api from './client'
import type { StrategyControls } from '../types'

export interface ControlsSummary {
  summary: string
  suggested_name: string
  suggested_description: string
  compatibility: { day_trading: boolean; swing_trading: boolean; position_trading: boolean }
  warnings: string[]
}

export const strategyControlsApi = {
  list: () =>
    api.get<StrategyControls[]>('/strategy-controls').then(r => r.data),

  get: (id: string) =>
    api.get<StrategyControls>(`/strategy-controls/${id}`).then(r => r.data),

  create: (data: Partial<StrategyControls>) =>
    api.post<StrategyControls>('/strategy-controls', data).then(r => r.data),

  update: (id: string, data: Partial<StrategyControls>) =>
    api.put<StrategyControls>(`/strategy-controls/${id}`, data).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/strategy-controls/${id}`).then(r => r.data),

  duplicate: (id: string) =>
    api.post<StrategyControls>(`/strategy-controls/${id}/duplicate`).then(r => r.data),

  summarize: (data: Partial<StrategyControls>) =>
    api.post<ControlsSummary>('/strategy-controls/summarize', data).then(r => r.data),
}
