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

// Impact colour tokens — using CSS vars so they swap with theme
function impactBorderColor(impact: string): string {
  if (impact === 'high')   return 'var(--color-danger)'
  if (impact === 'medium') return 'var(--color-warning)'
  return 'var(--color-border)'
}

function impactBadgeStyle(impact: string, isPast: boolean): React.CSSProperties {
  if (isPast) {
    return {
      background: 'color-mix(in srgb, var(--color-text-faint) 12%, transparent)',
      color: 'var(--color-text-faint)',
    }
  }
  if (impact === 'high')
    return {
      background: 'color-mix(in srgb, var(--color-danger) 18%, transparent)',
      color: 'var(--color-danger)',
      boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-danger) 40%, transparent)',
    }
  if (impact === 'medium')
    return {
      background: 'color-mix(in srgb, var(--color-warning) 18%, transparent)',
      color: 'var(--color-warning)',
      boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-warning) 40%, transparent)',
    }
  return {
    background: 'color-mix(in srgb, var(--color-text-faint) 10%, transparent)',
    color: 'var(--color-text-muted)',
  }
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
    <div
      className="flex rounded overflow-hidden text-xs"
      style={{ border: '1px solid var(--color-border)' }}
    >
      {ALL_IMPACTS.map(imp => {
        const active = value === imp
        let activeStyle: React.CSSProperties = {}
        if (active) {
          if (imp === 'high')
            activeStyle = { background: 'color-mix(in srgb, var(--color-danger) 25%, transparent)', color: 'var(--color-danger)' }
          else if (imp === 'medium')
            activeStyle = { background: 'color-mix(in srgb, var(--color-warning) 25%, transparent)', color: 'var(--color-warning)' }
          else if (imp === 'low')
            activeStyle = { background: 'color-mix(in srgb, var(--color-accent) 20%, transparent)', color: 'var(--color-accent)' }
          else
            activeStyle = { background: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' }
        }
        return (
          <button
            key={imp}
            type="button"
            onClick={() => onChange(imp)}
            className="px-2.5 py-1.5 capitalize transition font-medium"
            style={active
              ? activeStyle
              : { background: 'var(--color-bg-card)', color: 'var(--color-text-faint)' }
            }
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
          className="px-2.5 py-1 rounded text-xs capitalize transition font-medium"
          style={
            value === cat
              ? {
                  background: 'color-mix(in srgb, var(--color-accent) 20%, transparent)',
                  color: 'var(--color-accent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)',
                }
              : {
                  background: 'var(--color-bg-card)',
                  color: 'var(--color-text-faint)',
                  border: '1px solid var(--color-border)',
                }
          }
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
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
        style={{
          background: 'color-mix(in srgb, var(--color-warning) 20%, transparent)',
          color: 'var(--color-warning)',
          boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-warning) 40%, transparent)',
        }}
      >
        <Zap size={9} />
        Just now
      </span>
    )
  }
  if (isPast) {
    return <span className="text-xs font-mono" style={{ color: 'var(--color-text-faint)' }}>{label}</span>
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
      style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}
    >
      <Clock size={9} style={{ color: 'var(--color-text-faint)' }} />
      {label}
    </span>
  )
}

function EventRow({ event, now, isPast }: { event: MarketEvent; now: Date; isPast: boolean }) {
  const impact = event.impact?.toLowerCase() ?? 'low'

  return (
    <tr
      className="transition-colors"
      style={{
        borderBottom: '1px solid color-mix(in srgb, var(--color-border) 60%, transparent)',
        borderLeft: `2px solid ${isPast ? 'transparent' : impactBorderColor(impact)}`,
        opacity: isPast ? 0.55 : 1,
      }}
      onMouseEnter={e => { if (!isPast) e.currentTarget.style.background = 'var(--color-bg-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = '' }}
    >
      <td className="px-4 py-2 font-medium" style={{ color: isPast ? 'var(--color-text-faint)' : 'var(--color-text-primary)' }}>
        <div className="flex items-center gap-2">
          {!isPast && impact === 'high' && (
            <AlertTriangle size={11} className="flex-shrink-0" style={{ color: 'var(--color-danger)' }} />
          )}
          <span style={{ fontWeight: !isPast && impact === 'high' ? 600 : 400 }}>
            {event.name}
          </span>
        </div>
      </td>
      <td className="px-4 py-2 text-xs capitalize" style={{ color: 'var(--color-text-faint)' }}>{event.category}</td>
      <td className="px-4 py-2 text-xs font-mono" style={{ color: 'var(--color-text-faint)' }}>{event.symbol ?? '—'}</td>
      <td className="px-4 py-2 text-xs whitespace-nowrap font-mono" style={{ color: 'var(--color-text-muted)' }}>
        {formatTimeET(event.event_time)}
      </td>
      <td className="px-4 py-2 whitespace-nowrap">
        <CountdownChip isoString={event.event_time} now={now} isPast={isPast} />
      </td>
      <td className="px-4 py-2">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold capitalize"
          style={impactBadgeStyle(impact, isPast)}
        >
          {event.impact}
        </span>
      </td>
      <td className="px-4 py-2 text-xs" style={{ color: 'var(--color-text-faint)' }}>{event.source}</td>
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
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: isToday
          ? '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)'
          : '1px solid var(--color-border)',
        boxShadow: isToday ? '0 0 0 1px color-mix(in srgb, var(--color-accent) 20%, transparent)' : undefined,
      }}
    >
      {/* Date header */}
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        style={{
          borderBottom: '1px solid var(--color-border)',
          background: isToday
            ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
            : 'var(--color-bg-hover)',
        }}
      >
        <Calendar
          size={13}
          style={{ color: isToday ? 'var(--color-accent)' : 'var(--color-text-faint)' }}
        />
        <span
          className="text-xs font-bold uppercase tracking-wide"
          style={{
            color: isToday ? 'var(--color-accent)' : isPast ? 'var(--color-text-faint)' : 'var(--color-text-primary)',
          }}
        >
          {label}
        </span>
        {isToday && (
          <span
            className="px-1.5 py-0.5 rounded text-xs font-bold tracking-wider"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 25%, transparent)',
              color: 'var(--color-accent)',
            }}
          >
            TODAY
          </span>
        )}
        {highCount > 0 && (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
            style={{
              background: 'color-mix(in srgb, var(--color-danger) 15%, transparent)',
              color: 'var(--color-danger)',
            }}
          >
            <AlertTriangle size={9} />
            {highCount} high
          </span>
        )}
        <span className="ml-auto text-xs" style={{ color: 'var(--color-text-faint)' }}>
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Rows */}
      <table className="w-full text-sm" style={{ background: 'var(--color-bg-card)' }}>
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
          <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            Event Calendar
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-faint)' }}>
            Market events · Economic announcements · Earnings
          </p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded text-xs"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span
            className={clsx('w-2 h-2 rounded-full flex-shrink-0', marketOpen && 'animate-pulse')}
            style={{ background: marketOpen ? 'var(--color-success)' : 'var(--color-text-faint)' }}
          />
          <span style={{ color: marketOpen ? 'var(--color-success)' : 'var(--color-text-faint)', fontWeight: marketOpen ? 600 : 400 }}>
            {marketOpen ? 'Market Open' : 'Closed'}
          </span>
          <span className="font-mono" style={{ color: 'var(--color-text-faint)' }}>
            {formatCurrentTimeET(now)}
          </span>
        </div>
      </div>

      {/* Next high-impact hero banner */}
      {nextHighImpact && (
        <div
          className="card p-3"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
            background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)',
          }}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle size={16} className="flex-shrink-0" style={{ color: 'var(--color-danger)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs uppercase tracking-wide font-semibold mb-0.5" style={{ color: 'var(--color-danger)' }}>
                Next High-Impact Event
              </div>
              <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                {nextHighImpact.name}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {formatDateET(nextHighImpact.event_time)} · {formatTimeET(nextHighImpact.event_time)}
                {nextHighImpact.symbol && (
                  <span className="font-mono ml-2" style={{ color: 'var(--color-text-faint)' }}>
                    {nextHighImpact.symbol}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xs mb-0.5" style={{ color: 'var(--color-text-faint)' }}>Time remaining</div>
              <div className="text-lg font-bold font-mono leading-none" style={{ color: 'var(--color-danger)' }}>
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
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-faint)' }} />
              <input
                className="input w-full pl-7 text-sm py-1.5"
                placeholder="Search event or symbol…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-faint)' }}>Impact</span>
              <ImpactPills value={impactFilter} onChange={setImpactFilter} />
            </div>
          </div>

          {/* Row 2: category pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-faint)' }}>Category</span>
            <CategoryPills value={categoryFilter} onChange={setCategoryFilter} categories={availableCategories} />
          </div>

          {/* Row 3: date range */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-faint)' }}>From</label>
              <DatePickerInput
                className="w-40"
                value={dateFrom}
                max={dateTo}
                onChange={setDateFrom}
              />
            </div>
            <span className="text-xs" style={{ color: 'var(--color-text-faint)' }}>→</span>
            <div className="flex items-center gap-1.5">
              <label className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-faint)' }}>To</label>
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
                className="flex items-center gap-1 text-xs hover:opacity-80 ml-auto transition-opacity"
                style={{ color: 'var(--color-accent)' }}
                onClick={clearFilters}
              >
                <X size={11} />
                Reset filters
              </button>
            )}
          </div>

          {/* Count summary */}
          <div className="text-xs" style={{ color: 'var(--color-text-faint)' }}>
            Showing {filteredEvents.length} of {events.length} event{events.length !== 1 ? 's' : ''}
            {filteredEvents.length > 0 && (
              <span className="ml-2" style={{ color: 'var(--color-text-faint)', opacity: 0.6 }}>
                · {upcomingEvents.length} upcoming · {pastEvents.length} past
              </span>
            )}
          </div>
        </div>
      )}

      {/* States */}
      {isLoading ? (
        <div className="card py-10 text-center space-y-3">
          <div className="h-3 rounded w-1/3 mx-auto animate-pulse" style={{ background: 'var(--color-bg-hover)' }} />
          <div className="h-3 rounded w-1/4 mx-auto animate-pulse" style={{ background: 'var(--color-bg-hover)' }} />
        </div>
      ) : events.length === 0 ? (
        <div className="card py-12 text-center space-y-4">
          <Calendar size={32} className="mx-auto" style={{ color: 'var(--color-text-faint)' }} />
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>No market events yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-faint)' }}>
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
          <TrendingUp size={24} className="mx-auto" style={{ color: 'var(--color-text-faint)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No events match your filters.</p>
          <button
            type="button"
            className="text-xs hover:opacity-80 transition-opacity"
            style={{ color: 'var(--color-accent)' }}
            onClick={clearFilters}
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Column header legend */}
          <div
            className="grid px-4 text-xs uppercase tracking-wide"
            style={{
              gridTemplateColumns: '1fr 90px 70px 110px 110px 80px 80px',
              color: 'var(--color-text-faint)',
            }}
          >
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
            <div className="card py-6 text-center text-xs" style={{ color: 'var(--color-text-faint)' }}>
              No upcoming events in this date range.
            </div>
          )}

          {/* Past events — collapsible */}
          {pastEvents.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                className="flex items-center gap-2 text-xs transition-colors w-full px-1 py-1 hover:opacity-80"
                style={{ color: 'var(--color-text-faint)' }}
                onClick={() => setPastCollapsed(c => !c)}
              >
                {pastCollapsed
                  ? <ChevronRight size={13} />
                  : <ChevronDown size={13} />
                }
                <span className="uppercase tracking-wide font-medium">
                  Past Events ({pastEvents.length})
                </span>
                <span className="flex-1 h-px ml-2" style={{ background: 'var(--color-border)' }} />
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
      <div
        className="card text-xs space-y-1"
        style={{ background: 'color-mix(in srgb, var(--color-bg-hover) 60%, transparent)' }}
      >
        <div className="font-semibold uppercase tracking-wide text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Event Filter Settings
        </div>
        <p style={{ color: 'var(--color-text-faint)' }}>
          Configure per-strategy event filters in the Strategy Creator under "Event Filter". Strategies
          can pause entries or close positions automatically before high-impact events.
        </p>
      </div>
    </div>
  )
}
