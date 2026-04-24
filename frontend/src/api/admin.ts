import api from './client'
import type { UserJourneyValidationsResponse } from '../types'

export const adminApi = {
  downloadBackup: async (): Promise<void> => {
    const response = await api.get('/admin/backup', { responseType: 'blob' })
    const url = URL.createObjectURL(response.data as Blob)
    const a = document.createElement('a')
    // Try to get filename from Content-Disposition header
    const cd = response.headers['content-disposition'] ?? ''
    const match = cd.match(/filename="([^"]+)"/)
    a.download = match ? match[1] : 'ultratrader_backup.db'
    a.href = url
    a.click()
    URL.revokeObjectURL(url)
  },

  restore: (file: File): Promise<{ status: string; bytes: number; message: string }> => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ status: string; bytes: number; message: string }>(
      '/admin/restore',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    ).then(r => r.data)
  },

  getUserJourneyValidations: async (): Promise<UserJourneyValidationsResponse> => {
    const r = await api.get<UserJourneyValidationsResponse>('/admin/user-journey-validations')
    return r.data
  },
}
