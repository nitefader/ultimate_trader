import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { strategiesApi } from '../api/strategies'
import { Plus } from 'lucide-react'
import clsx from 'clsx'

export function Strategies() {
  const { data: strategies = [], isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Strategies</h1>
        <Link to="/strategies/new" className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={14} /> New Strategy
        </Link>
      </div>

      {isLoading ? <div className="text-gray-500">Loading...</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {strategies.map(s => (
            <Link key={s.id} to={`/strategies/${s.id}`} className="card hover:border-sky-800 transition-colors block">
              <div className="flex items-start justify-between mb-2">
                <div className="font-semibold text-gray-100">{s.name}</div>
                <span className={clsx('badge', {
                  'bg-sky-900 text-sky-300': s.category === 'momentum',
                  'bg-purple-900 text-purple-300': s.category === 'mean_reversion',
                  'bg-amber-900 text-amber-300': s.category === 'breakout',
                  'badge-gray': s.category === 'custom',
                })}>
                  {s.category}
                </span>
              </div>
              {s.description && (
                <p className="text-xs text-gray-500 mb-3 line-clamp-2">{s.description}</p>
              )}
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>{s.created_at?.slice(0, 10)}</span>
                <span className={clsx('badge', s.status === 'active' ? 'badge-green' : 'badge-gray')}>
                  {s.status}
                </span>
              </div>
            </Link>
          ))}
          {strategies.length === 0 && (
            <div className="col-span-3 card text-center py-12 text-gray-500">
              No strategies yet. <Link to="/strategies/new" className="text-sky-400">Create one</Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
