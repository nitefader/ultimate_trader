import api from './client'

export type SliceStatus = 'queued' | 'in_progress' | 'completed'
export type ReviewStatus = 'not_started' | 'in_review' | 'passed' | 'failed'

export type ProgramSlice = {
  id: string
  title: string
  objective: string
  scope: string
  business_impact: string
  order_index: number
  blocked_by_ids: string[]
  status: SliceStatus
  review: ReviewStatus
  verification: string
  next_gate: string
  created_at?: string | null
  updated_at?: string | null
}

export const backlogApi = {
  list: () => api.get<ProgramSlice[]>('/backlog').then(r => r.data),
  create: (data: Omit<ProgramSlice, 'id' | 'created_at' | 'updated_at'>) =>
    api.post<ProgramSlice>('/backlog', data).then(r => r.data),
  update: (id: string, data: Partial<Omit<ProgramSlice, 'id' | 'created_at' | 'updated_at'>>) =>
    api.put<ProgramSlice>(`/backlog/${id}`, data).then(r => r.data),
}
