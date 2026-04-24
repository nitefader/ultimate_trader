import api from './client'

export interface DataServiceRecord {
  id: string
  name: string
  provider: string
  environment: string
  model: string | null
  api_key: string
  secret_key: string
  has_credentials: boolean
  is_default: boolean
  is_default_ai: boolean
  is_active: boolean
  created_at: string | null
  updated_at: string | null
}

export interface DataServiceCreate {
  name: string
  provider?: string
  environment?: string
  model?: string
  api_key?: string
  secret_key?: string
  is_default?: boolean
  is_default_ai?: boolean
}

export interface DataServiceUpdate {
  name?: string
  provider?: string
  environment?: string
  model?: string
  api_key?: string
  secret_key?: string
  is_default?: boolean
  is_default_ai?: boolean
  is_active?: boolean
}

export const servicesApi = {
  list: () => api.get<DataServiceRecord[]>('/services').then(r => r.data),
  get: (id: string) => api.get<DataServiceRecord>(`/services/${id}`).then(r => r.data),
  getDefault: () => api.get<DataServiceRecord>('/services/default').then(r => r.data),
  create: (data: DataServiceCreate) => api.post<DataServiceRecord>('/services', data).then(r => r.data),
  update: (id: string, data: DataServiceUpdate) => api.put<DataServiceRecord>(`/services/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete<{ deleted: string }>(`/services/${id}`).then(r => r.data),
  setDefault: (id: string) => api.post<DataServiceRecord>(`/services/${id}/set-default`).then(r => r.data),
  setDefaultAi: (id: string) => api.post<DataServiceRecord>(`/services/${id}/set-default-ai`).then(r => r.data),
  test: (id: string) => api.post(`/services/${id}/test`).then(r => r.data),
  testInline: (data: { api_key: string; secret_key: string; environment: string }) =>
    api.post('/services/test-inline', data).then(r => r.data),
}
