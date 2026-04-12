import api from './client'

export const mlApi = {
  promoteAdvice: (data: { paper_deployment_id: string }) =>
    api.post('/ml/promote-advice', data).then(r => r.data),
}

export default mlApi
