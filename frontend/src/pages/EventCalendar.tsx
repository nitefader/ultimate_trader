import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import clsx from 'clsx'
import { Search, Filter } from 'lucide-react'

interface MarketEvent {
  id: string
  name: string
  category: string
  symbol?: string
  event_time: string
  impact: string
  source: string
}

const IMPACT_COLORS: Record<string, string> = {
  high: 'badge-red',
  medium: 'bg-amber-900 text-amber-300',
  low: 'badge-gray',
}

const ALL_IMPACTS = ['all', 'high', 'medium', 'low']
const ALL_CATEGORIES = ['all', 'macro', 'earnings', 'fed', 'economic', 'other']

export function EventCalendar() {
  const qc = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [impactFilter, setImpactFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get('/events').then(r => r.data as MarketEvent[]),
  })

  const seedMutation = useMutation({
    mutationFn: () => api.post('/events/seed-sample'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })

  // Derive available categories from actual data
  const availableCategories = useMemo(() => {
    const cats = new Set(events.map(e => e.category?.toLowerCase()).filter(Boolean))
    return ['all', ...Array.from(cats).sort()]
  }, [events])

  // Apply all filters
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (impactFilter !== 'all' && e.impact?.toLowerCase() !== impactFilter) return false
      if (categoryFilter !== 'all' && e.category?.toLowerCase() !== categoryFilter) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        if (!e.name?.toLowerCase().includes(q) && !e.symbol?.toLowerCase().includes(q)) return false
      }
      if (dateFrom && e.event_time < dateFrom) return false
      if (dateTo && e.event_time > dateTo + 'T23:59:59') return false
      return true
    })
  }, [events, impactFilter, categoryFilter, searchQuery, dateFrom, dateTo])

  const hasActiveFilters = impactFilter !== 'all' || categoryFilter !== 'all' || searchQuery || dateFrom || dateTo

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Event Calendar</h1>
          <p className="text-xs text-gray-500 mt-0.5">Market events and announcement filters</p>
        </div>
        <button className="btn-ghost text-sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
          {seedMutation.isPending ? 'Seeding…' : '+ Seed Sample Events'}
        </button>
      </div>

      {/* Filter Bar */}
      {events.length > 0 && (
        <div className="card p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[160px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className="input w-full pl-7 text-sm py-1.5"
                placeholder="Search event or symbol…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Impact filter */}
            <div className="flex items-center gap-1">
              <Filter size={13} className="text-gray-500 flex-shrink-0" />
              <div className="flex rounded border border-gray-700 overflow-hidden text-xs">
                {ALL_IMPACTS.map(imp => (
                  <button
                    key={imp}
                    type="button"
                    onClick={() => setImpactFilter(imp)}
                    className={clsx(
                      'px-2.5 py-1.5 capitalize transition',
                      impactFilter === imp
                        ? imp === 'high' ? 'bg-red-800 text-red-100'
                          : imp === 'medium' ? 'bg-amber-800 text-amber-100'
                          : 'bg-sky-800 text-sky-100'
                        : 'bg-gray-900 text-gray-400 hover:bg-gray-800',
                    )}
                  >
                    {imp}
                  </button>
                ))}
              </div>
            </div>

            {/* Category filter */}
            <select
              className="input text-sm py-1.5"
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
            >
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>{cat === 'all' ? 'All Categories' : cat}</option>
              ))}
            </select>

            {/* Date range */}
            <input
              type="date"
              className="input text-sm py-1.5"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              title="From date"
            />
            <span className="text-gray-600 text-xs">→</span>
            <input
              type="date"
              className="input text-sm py-1.5"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              title="To date"
            />

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                type="button"
                className="text-xs text-sky-400 hover:text-sky-300 whitespace-nowrap"
                onClick={() => {
                  setSearchQuery('')
                  setImpactFilter('all')
                  setCategoryFilter('all')
                  setDateFrom('')
                  setDateTo('')
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="text-xs text-gray-500">
            Showing {filteredEvents.length} of {events.length} event{events.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <div className="card text-center py-8 text-gray-500 text-sm">
          No events. Click "Seed Sample Events" to add example FOMC, CPI, and NFP events.
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="card text-center py-8 text-gray-500 text-sm">
          No events match your filters.{' '}
          <button
            type="button"
            className="text-sky-400 hover:text-sky-300"
            onClick={() => {
              setSearchQuery('')
              setImpactFilter('all')
              setCategoryFilter('all')
              setDateFrom('')
              setDateTo('')
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500">
                <th className="text-left px-4 py-2">Event</th>
                <th className="text-left px-4 py-2">Category</th>
                <th className="text-left px-4 py-2">Symbol</th>
                <th className="text-left px-4 py-2">Time</th>
                <th className="text-left px-4 py-2">Impact</th>
                <th className="text-left px-4 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents
                .slice()
                .sort((a, b) => a.event_time.localeCompare(b.event_time))
                .map(e => (
                <tr key={e.id} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                  <td className="px-4 py-1.5 text-gray-200 font-medium">{e.name}</td>
                  <td className="px-4 py-1.5 text-gray-400 text-xs capitalize">{e.category}</td>
                  <td className="px-4 py-1.5 text-gray-500 text-xs font-mono">{e.symbol ?? '—'}</td>
                  <td className="px-4 py-1.5 text-gray-400 text-xs whitespace-nowrap">
                    {e.event_time?.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="px-4 py-1.5">
                    <span className={clsx('badge', IMPACT_COLORS[e.impact] ?? 'badge-gray')}>{e.impact}</span>
                  </td>
                  <td className="px-4 py-1.5 text-gray-600 text-xs">{e.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card text-sm text-gray-500 space-y-2">
        <div className="text-gray-400 font-semibold text-xs">Event Filter Settings</div>
        <p className="text-xs">Configure per-strategy event filters in the Strategy Creator under "Event Filter". Strategies can be set to disable entries or close positions before high-impact events.</p>
      </div>
    </div>
  )
}
