import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import clsx from 'clsx'
import { DatePickerInput } from '../components/DatePickerInput'
import {
  Search,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  AlertTriangle,
  TrendingUp,
  Zap,
  X,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MarketEvent {
  id: string
  name: string
  category: string
  symbol?: string
  event_time: string
  impact: string
  source: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_IMPACTS = ['all', 'high', 'medium', 'low'] as const
type ImpactFilter = (typeof ALL_IMPACTS)[number]

const ET_TZ = 'America/New_York'

const IMPACT_ROW_CLASS: Record<string, string> = {
  high: 'border-l-2 border-red-600',
  medium: 'border-l-2 border-amber-600',
  low: 'border-l-2 border-gray-700',
}

const IMPACT_BADGE_UPCOMING: Record<string, string> = {
  high: 'bg-red-900 text-red-200 ring-1 ring-red-700',
  medium: 'bg-amber-900 text-amber-200 ring-1 ring-amber-700',
  low: 'bg-gray-800 text-gray-400',
}

const IMPACT_BADGE_PAST: Record<string, string> = {
  high: 'bg-gray-800 text-gray-500',
  medium: 'bg-gray-800 text-gray-500',
  low: 'bg-gray-800 text-gray-600',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekMonday(from: Date): string {
  const d = new Date(from)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function formatTimeET(isoString: string): string {
  return (
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: ET_TZ,
    }).format(new Date(isoString)) + ' ET'
  )
}

function formatDateET(isoString: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: ET_TZ,
  }).format(new Date(isoString))
}

function etDateKey(isoString: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ET_TZ }).format(new Date(isoString))
}

function todayKeyET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ET_TZ }).format(new Date())
}

function formatCountdown(isoString: string, now: Date): string {
  const diffMs = new Date(isoString).getTime() - now.getTime()
  const diffSec = Math.round(diffMs / 1000)
  const absSec = Math.abs(diffSec)
  if (absSec < 60) return diffSec >= 0 ? 'Starting now' : 'Just now'
  const absMins = Math.floor(absSec / 60)
  if (absMins < 60) return diffSec > 0 ? `in ${absMins}m` : `${absMins}m ago`
  const absHrs = Math.floor(absMins / 60)
  const remMins = absMins % 60
  if (absHrs < 24) {
    const minPart = remMins > 0 ? ` ${remMins}m` : ''
    return diffSec > 0 ? `in ${absHrs}h${minPart}` : `${absHrs}h${minPart} ago`
  }
  const absDays = Math.floor(absHrs / 24)
  return diffSec > 0 ? `in ${absDays}d` : `${absDays}d ago`
}

function isJustNow(isoString: string, now: Date): boolean {
  return Math.abs(new Date(isoString).getTime() - now.getTime()) < 60 * 60 * 1000
}

function formatCurrentTimeET(d: Date): string {
  return (
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: ET_TZ,
    }).format(d) + ' ET'
  )
}

function isMarketOpen(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now)
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? ''
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)
  if (['Sat', 'Sun'].includes(weekday)) return false
  const totalMins = hour * 60 + minute
  return totalMins >= 9 * 60 + 30 && totalMins < 16 * 60
}

function groupByDate(events: MarketEvent[]): [string, MarketEvent[]][] {
  const map = new Map<string, MarketEvent[]>()
  for (const e of events) {
    const key = etDateKey(e.event_time)
    const arr = map.get(key) ?? []
    arr.push(e)
    map.set(key, arr)
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ImpactPills({
  value,
  onChange,
}: {
  value: ImpactFilter
  onChange: (v: ImpactFilter) => void
}) {
  return (
    <div className="flex rounded border border-gray-700 overflow-hidden text-xs">
      {ALL_IMPACTS.map(imp => {
        const active = value === imp
        const activeClass =
          imp === 'high'
            ? 'bg-red-900 text-red-100'
            : imp === 'medium'
            ? 'bg-amber-900 text-amber-100'
            : imp === 'low'
            ? 'bg-sky-900 text-sky-100'
            : 'bg-gray-700 text-gray-100'
        return (
          <button
            key={imp}
            type="button"
            onClick={() => onChange(imp)}
            className={clsx(
              'px-2.5 py-1.5 capitalize transition font-medium',
              active ? activeClass : 'bg-gray-900 text-gray-400 hover:bg-gray-800',
            )}
          >
            {imp}
          </button>
        )
      })}
    </div>
  )
}

function CategoryPills({
  value,
  onChange,
  categories,
}: {
  value: string
  onChange: (v: string) => void
  categories: string[]
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {categories.map(cat => (
        <button
          key={cat}
          type="button"
          onClick={() => onChange(cat)}
          className={clsx(
            'px-2.5 py-1 rounded text-xs capitalize transition font-medium border',
            value === cat
              ? 'bg-sky-900 text-sky-200 border-sky-700'
              : 'bg-gray-900 text-gray-400 border-gray-700 hover:bg-gray-800 hover:text-gray-200',
          )}
        >
          {cat === 'all' ? 'All' : cat}
        </button>
      ))}
    </div>
  )
}

function CountdownChip({ isoString, now, isPast }: { isoString: string; now: Date; isPast: boolean }) {
  const label = formatCountdown(isoString, now)
  const justNow = isJustNow(isoString, now)

  if (justNow && isPast) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-900 text-amber-200 ring-1 ring-amber-700">
        <Zap size={9} />
        Just now
      </span>
    )
  }
  if (isPast) {
    return <span className="text-xs text-gray-600 font-mono">{label}</span>
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-300">
      <Clock size={9} className="text-gray-500" />
      {label}
    </span>
  )
}

function EventRow({ event, now, isPast }: { event: MarketEvent; now: Date; isPast: boolean }) {
  const impact = event.impact?.toLowerCase() ?? 'low'
  const badgeClass = isPast
    ? (IMPACT_BADGE_PAST[impact] ?? 'bg-gray-800 text-gray-600')
    : (IMPACT_BADGE_UPCOMING[impact] ?? 'bg-gray-800 text-gray-400')

  return (
    <tr
      className={clsx(
        'border-b border-gray-800/40 transition-colors',
        isPast ? 'opacity-55 hover:opacity-80' : 'hover:bg-gray-800/25',
        !isPast ? (IMPACT_ROW_CLASS[impact] ?? 'border-l-2 border-transparent') : 'border-l-2 border-transparent',
      )}
    >
      <td className={clsx('px-4 py-2 font-medium', isPast ? 'text-gray-500' : 'text-gray-200')}>
        <div className="flex items-center gap-2">
          {!isPast && impact === 'high' && (
            <AlertTriangle size={11} className="text-red-500 flex-shrink-0" />
          )}
          <span className={clsx(!isPast && impact === 'high' ? 'font-semibold' : '')}>
            {event.name}
          </span>
        </div>
      </td>
      <td className="px-4 py-2 text-xs capitalize text-gray-500">{event.category}</td>
      <td className="px-4 py-2 text-xs font-mono text-gray-500">{event.symbol ?? '—'}</td>
      <td className="px-4 py-2 text-xs whitespace-nowrap text-gray-400 font-mono">
        {formatTimeET(event.event_time)}
      </td>
      <td className="px-4 py-2 whitespace-nowrap">
        <CountdownChip isoString={event.event_time} now={now} isPast={isPast} />
      </td>
      <td className="px-4 py-2">
        <span className={clsx('badge text-xs capitalize', badgeClass)}>{event.impact}</span>
      </td>
      <td className="px-4 py-2 text-xs text-gray-600">{event.source}</td>
    </tr>
  )
}

function DateSection({
  dateKey,
  label,
  events,
  isToday,
  now,
  isPast,
}: {
  dateKey: string
  label: string
  events: MarketEvent[]
  isToday: boolean
  now: Date
  isPast: boolean
}) {
  const highCount = events.filter(e => e.impact?.toLowerCase() === 'high').length

  return (
    <div className={clsx('card p-0 overflow-hidden', isToday && 'ring-1 ring-sky-700/60')}>
      {/* Date header */}
      <div
        className={clsx(
          'flex items-center gap-3 px-4 py-2.5 border-b',
          isToday
            ? 'bg-sky-950/40 border-sky-800/50'
            : isPast
            ? 'bg-gray-900/40 border-gray-800'
            : 'bg-gray-900/60 border-gray-800',
        )}
      >
        <Calendar size={13} className={isToday ? 'text-sky-400' : 'text-gray-600'} />
        <span
          className={clsx(
            'text-xs font-bold uppercase tracking-wide',
            isToday ? 'text-sky-300' : isPast ? 'text-gray-600' : 'text-gray-300',
          )}
        >
          {label}
        </span>
        {isToday && (
          <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-sky-700 text-sky-100 tracking-wider">
            TODAY
          </span>
        )}
        {highCount > 0 && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-red-900/60 text-red-300">
            <AlertTriangle size={9} />
            {highCount} high
          </span>
        )}
        <span className="ml-auto text-xs text-gray-600">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Rows */}
      <table className="w-full text-sm">
        <tbody>
          {events
            .slice()
            .sort((a, b) => a.event_time.localeCompare(b.event_time))
            .map(e => (
              <EventRow key={e.id} event={e} now={now} isPast={isPast} />
            ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function EventCalendar() {
  const qc = useQueryClient()

  // Live clock tick every 30 seconds
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const defaultFrom = useMemo(() => getWeekMonday(new Date()), [])
  const defaultTo = useMemo(() => addDays(new Date().toISOString().slice(0, 10), 14), [])

  const [searchQuery, setSearchQuery] = useState('')
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(defaultTo)
  const [pastCollapsed, setPastCollapsed] = useState(true)

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get('/events').then(r => r.data as MarketEvent[]),
  })

  const seedMutation = useMutation({
    mutationFn: () => api.post('/events/seed-sample'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })

  const clearFilters = useCallback(() => {
    setSearchQuery('')
    setImpactFilter('all')
    setCategoryFilter('all')
    setDateFrom(defaultFrom)
    setDateTo(defaultTo)
  }, [defaultFrom, defaultTo])

  const availableCategories = useMemo(() => {
    const cats = new Set(events.map(e => e.category?.toLowerCase()).filter(Boolean))
    return ['all', ...Array.from(cats).sort()]
  }, [events])

  const todayKey = useMemo(() => todayKeyET(), [])

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

  const { upcomingEvents, pastEvents } = useMemo(() => {
    const nowIso = now.toISOString()
    const upcoming: MarketEvent[] = []
    const past: MarketEvent[] = []
    for (const e of filteredEvents) {
      if (e.event_time >= nowIso) upcoming.push(e)
      else past.push(e)
    }
    return { upcomingEvents: upcoming, pastEvents: past }
  }, [filteredEvents, now])

  const upcomingGroups = useMemo(() => groupByDate(upcomingEvents), [upcomingEvents])
  const pastGroups = useMemo(
    () => groupByDate(pastEvents).slice().reverse(),
    [pastEvents],
  )

  const nextHighImpact = useMemo(
    () =>
      upcomingEvents
        .filter(e => e.impact?.toLowerCase() === 'high')
        .sort((a, b) => a.event_time.localeCompare(b.event_time))[0] ?? null,
    [upcomingEvents],
  )

  const hasNonDefaultFilters =
    impactFilter !== 'all' ||
    categoryFilter !== 'all' ||
    searchQuery !== '' ||
    dateFrom !== defaultFrom ||
    dateTo !== defaultTo

  const marketOpen = isMarketOpen(now)

  return (
    <div className="space-y-4">

      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Event Calendar</h1>
          <p className="text-xs text-gray-500 mt-0.5">Market events · Economic announcements · Earnings</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-gray-900 border border-gray-800 text-xs">
          <span
            className={clsx(
              'w-2 h-2 rounded-full flex-shrink-0',
              marketOpen ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600',
            )}
          />
          <span className={marketOpen ? 'text-emerald-300 font-medium' : 'text-gray-500'}>
            {marketOpen ? 'Market Open' : 'Closed'}
          </span>
          <span className="text-gray-600 font-mono">{formatCurrentTimeET(now)}</span>
        </div>
      </div>

      {/* Next high-impact hero banner */}
      {nextHighImpact && (
        <div className="card border-red-800/60 bg-red-950/20 p-3">
          <div className="flex items-center gap-3">
            <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-red-400 uppercase tracking-wide font-semibold mb-0.5">
                Next High-Impact Event
              </div>
              <div className="text-sm font-semibold text-gray-100 truncate">{nextHighImpact.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {formatDateET(nextHighImpact.event_time)} · {formatTimeET(nextHighImpact.event_time)}
                {nextHighImpact.symbol && (
                  <span className="font-mono ml-2 text-gray-600">{nextHighImpact.symbol}</span>
                )}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xs text-gray-500 mb-0.5">Time remaining</div>
              <div className="text-lg font-bold font-mono text-red-300 leading-none">
                {formatCountdown(nextHighImpact.event_time, now)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter panel */}
      {events.length > 0 && (
        <div className="card p-3 space-y-3">
          {/* Row 1: search + impact */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              <input
                className="input w-full pl-7 text-sm py-1.5"
                placeholder="Search event or symbol…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 whitespace-nowrap">Impact</span>
              <ImpactPills value={impactFilter} onChange={setImpactFilter} />
            </div>
          </div>

          {/* Row 2: category pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">Category</span>
            <CategoryPills value={categoryFilter} onChange={setCategoryFilter} categories={availableCategories} />
          </div>

          {/* Row 3: date range */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-gray-500 whitespace-nowrap">From</label>
              <DatePickerInput
                className="w-40"
                value={dateFrom}
                max={dateTo}
                onChange={setDateFrom}
              />
            </div>
            <span className="text-gray-600 text-xs">→</span>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-gray-500 whitespace-nowrap">To</label>
              <DatePickerInput
                className="w-40"
                value={dateTo}
                min={dateFrom}
                onChange={setDateTo}
              />
            </div>
            {hasNonDefaultFilters && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 ml-auto"
                onClick={clearFilters}
              >
                <X size={11} />
                Reset filters
              </button>
            )}
          </div>

          {/* Count summary */}
          <div className="text-xs text-gray-600">
            Showing {filteredEvents.length} of {events.length} event{events.length !== 1 ? 's' : ''}
            {filteredEvents.length > 0 && (
              <span className="ml-2 text-gray-700">
                · {upcomingEvents.length} upcoming · {pastEvents.length} past
              </span>
            )}
          </div>
        </div>
      )}

      {/* States */}
      {isLoading ? (
        <div className="card py-10 text-center space-y-3">
          <div className="h-3 bg-gray-800 rounded w-1/3 mx-auto animate-pulse" />
          <div className="h-3 bg-gray-800 rounded w-1/4 mx-auto animate-pulse" />
        </div>
      ) : events.length === 0 ? (
        <div className="card py-12 text-center space-y-4">
          <Calendar size={32} className="text-gray-700 mx-auto" />
          <div>
            <p className="text-sm text-gray-400 font-medium">No market events yet</p>
            <p className="text-xs text-gray-600 mt-1">
              Add FOMC, CPI, NFP and earnings events to track upcoming catalysts.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost text-sm mx-auto"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
          >
            {seedMutation.isPending ? 'Seeding…' : '+ Load Sample Events'}
          </button>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="card py-10 text-center space-y-3">
          <TrendingUp size={24} className="text-gray-700 mx-auto" />
          <p className="text-sm text-gray-500">No events match your filters.</p>
          <button type="button" className="text-xs text-sky-400 hover:text-sky-300" onClick={clearFilters}>
            Reset filters
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Column header legend */}
          <div className="grid px-4 text-xs text-gray-600 uppercase tracking-wide"
            style={{ gridTemplateColumns: '1fr 90px 70px 110px 110px 80px 80px' }}>
            {['Event', 'Category', 'Symbol', 'Time (ET)', 'Countdown', 'Impact', 'Source'].map(h => (
              <div key={h} className="py-1 pr-3">{h}</div>
            ))}
          </div>

          {/* Upcoming groups */}
          {upcomingGroups.length > 0 ? (
            upcomingGroups.map(([dateKey, dateEvents]) => (
              <DateSection
                key={dateKey}
                dateKey={dateKey}
                label={formatDateET(dateEvents[0].event_time)}
                events={dateEvents}
                isToday={dateKey === todayKey}
                now={now}
                isPast={false}
              />
            ))
          ) : (
            <div className="card py-6 text-center text-xs text-gray-600">
              No upcoming events in this date range.
            </div>
          )}

          {/* Past events — collapsible */}
          {pastEvents.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors w-full px-1 py-1"
                onClick={() => setPastCollapsed(c => !c)}
              >
                {pastCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                <span className="uppercase tracking-wide font-medium">
                  Past Events ({pastEvents.length})
                </span>
                <span className="flex-1 h-px bg-gray-800 ml-2" />
              </button>

              {!pastCollapsed && (
                <div className="space-y-3">
                  {pastGroups.map(([dateKey, dateEvents]) => (
                    <DateSection
                      key={dateKey}
                      dateKey={dateKey}
                      label={formatDateET(dateEvents[0].event_time)}
                      events={dateEvents}
                      isToday={dateKey === todayKey}
                      now={now}
                      isPast={true}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Strategy filter hint */}
      <div className="card text-xs text-gray-600 space-y-1 bg-gray-900/40">
        <div className="text-gray-500 font-semibold uppercase tracking-wide text-xs">Event Filter Settings</div>
        <p>
          Configure per-strategy event filters in the Strategy Creator under "Event Filter". Strategies
          can pause entries or close positions automatically before high-impact events.
        </p>
      </div>
    </div>
  )
}
