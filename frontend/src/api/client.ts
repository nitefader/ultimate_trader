import axios from 'axios'

export const api = axios.create({
  baseURL: '/api/v1',
  timeout: 120_000,
  headers: { 'Content-Type': 'application/json' },
})

function getApiErrorMessage(err: any) {
  const detail = err.response?.data?.detail
  const backendError = err.response?.data?.error

  if (typeof detail === 'string' && detail) {
    return detail
  }

  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (typeof item?.msg === 'string') return item.msg
        return JSON.stringify(item)
      })
      .join('; ')
  }

  if (detail && typeof detail === 'object') {
    if (typeof detail.message === 'string' && detail.message) {
      return detail.message
    }
    return JSON.stringify(detail)
  }

  if (typeof backendError === 'string' && backendError) {
    return backendError
  }

  return err.message || 'API error'
}

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg = getApiErrorMessage(err)
    console.error('[API]', msg, err.config?.url)
    return Promise.reject(new Error(msg))
  },
)

export default api
