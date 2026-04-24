import api from './client'
import type { ExecutionStyle } from '../types'

export interface StyleAnalysis {
  suggested_name: string
  suggested_description: string
  health: 'clean' | 'caution' | 'risky'
  insights: string[]
  suggestions: string[]
  warnings: string[]
}

export const executionStylesApi = {
  list: () =>
    api.get<ExecutionStyle[]>('/execution-styles').then(r => r.data),

  get: (id: string) =>
    api.get<ExecutionStyle>(`/execution-styles/${id}`).then(r => r.data),

  create: (data: Partial<ExecutionStyle>) =>
    api.post<ExecutionStyle>('/execution-styles', data).then(r => r.data),

  update: (id: string, data: Partial<ExecutionStyle>) =>
    api.put<ExecutionStyle>(`/execution-styles/${id}`, data).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/execution-styles/${id}`).then(r => r.data),

  duplicate: (id: string) =>
    api.post<ExecutionStyle>(`/execution-styles/${id}/duplicate`).then(r => r.data),

  analyze: (data: Partial<ExecutionStyle>) =>
    api.post<StyleAnalysis>('/execution-styles/analyze', data).then(r => r.data),
}
