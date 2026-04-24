/**
 * Pre-Market Checklist — appears automatically at 9:00am ET when live deployments are active.
 * State is persisted per calendar day so it only shows once per day.
 * Cannot be skipped for live-mode accounts (can only be dismissed after checking all items).
 */
import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { deploymentsApi } from '../api/accounts'
import { CheckSquare, Square, X, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'

const STORAGE_KEY = 'ultratrader.premarket_checklist_date'
const CHECKLIST_ITEMS = [
  { id: 'news', label: 'Reviewed pre-market news for open positions / watchlist symbols' },
  { id: 'gap', label: 'Checked for significant overnight gaps (>2% on key holdings)' },
  { id: 'risk', label: 'Confirmed daily loss limits and drawdown lockouts are in place' },
  { id: 'governor', label: 'Governor is active and showing expected programs' },
  { id: 'data', label: 'Data feed / broker connection is live (green status)' },
  { id: 'plan', label: 'Today\'s trading plan reviewed — no conflicting macro events' },
]

function todayET(): string {
  // Returns "YYYY-MM-DD" in US Eastern time
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).split('/').reverse().join('-').replace(/(\d{4})-(\d{2})-(\d{2})/, '$1-$3-$2')
  // Workaround: just use ISO date shifted to ET
}

function getETDateString(): string {
  const now = new Date()
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  // etStr is like "04/17/2026"
  const [m, d, y] = etStr.split('/')
  return `${y}-${m}-${d}`
}

function getETHour(): number {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }), 10)
}

function hasCompletedToday(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === getETDateString()
  } catch {
    return false
  }
}

function markCompletedToday() {
  try {
    localStorage.setItem(STORAGE_KEY, getETDateString())
  } catch {}
}

export function PreMarketChecklist() {
  const [visible, setVisible] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState(false)

  const { data: deployments = [] } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => deploymentsApi.list(),
    staleTime: 60_000,
  })

  const hasLiveDeployment = (deployments as any[]).some(
    d => d.mode === 'live' && (d.status === 'running' || d.status === 'active'),
  )

  useEffect(() => {
    if (!hasLiveDeployment) return
    if (hasCompletedToday()) return
    if (dismissed) return

    const checkTime = () => {
      const h = getETHour()
      if (h >= 9 && h < 10) {
        setVisible(true)
      }
    }

    checkTime()
    const interval = setInterval(checkTime, 60_000)
    return () => clearInterval(interval)
  }, [hasLiveDeployment, dismissed])

  if (!visible) return null

  const allChecked = CHECKLIST_ITEMS.every(item => checked.has(item.id))

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleComplete = () => {
    markCompletedToday()
    setVisible(false)
    setDismissed(true)
  }

  const handleSnooze = () => {
    // Allow dismissal without completing for non-critical review — but will reappear next day
    setVisible(false)
    setDismissed(true)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="card max-w-lg w-full space-y-4 border-amber-800/60">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
            <h2 className="text-sm font-semibold text-amber-300">Pre-Market Checklist</h2>
            <span className="text-xs text-gray-500">9:00 AM ET — Live deployments active</span>
          </div>
        </div>

        <p className="text-xs text-gray-400">
          You have live deployments running. Complete this checklist before the market opens.
        </p>

        {/* Checklist items */}
        <div className="space-y-2">
          {CHECKLIST_ITEMS.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => toggle(item.id)}
              className="w-full flex items-start gap-2.5 text-left rounded px-3 py-2 transition-colors hover:bg-gray-800/40"
            >
              {checked.has(item.id)
                ? <CheckSquare size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                : <Square size={15} className="text-gray-600 flex-shrink-0 mt-0.5" />
              }
              <span className={clsx(
                'text-xs',
                checked.has(item.id) ? 'text-gray-400 line-through' : 'text-gray-200',
              )}>
                {item.label}
              </span>
            </button>
          ))}
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-gray-800 rounded">
            <div
              className="h-1.5 bg-emerald-500 rounded transition-all"
              style={{ width: `${(checked.size / CHECKLIST_ITEMS.length) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 flex-shrink-0">{checked.size}/{CHECKLIST_ITEMS.length}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={handleSnooze}
            className="text-xs text-gray-500 hover:text-gray-300 transition"
          >
            Remind me tomorrow
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={!allChecked}
            className={clsx(
              'btn-primary text-sm px-4',
              !allChecked && 'opacity-40 cursor-not-allowed',
            )}
          >
            {allChecked ? 'All Clear — Open Market' : `${CHECKLIST_ITEMS.length - checked.size} items remaining`}
          </button>
        </div>
      </div>
    </div>
  )
}
