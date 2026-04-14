/**
 * PDTGauge — arc gauge showing day trade count vs limit (3 for non-PDT accounts).
 *
 * Turns red at 3/3. Hover shows individual day trade expiry dates.
 *
 * Used in AccountMonitor header for MARGIN accounts with equity < $25k.
 * Not rendered for CASH accounts or PDT-qualified accounts (equity >= $25k).
 */
import React from 'react'
import clsx from 'clsx'

interface PDTGaugeProps {
  dayTradesUsed: number
  maxDayTrades?: number
  isPDT?: boolean
  accountMode?: string
  equity?: number
  // Window entries: list of ISO timestamps when each counted day trade was placed
  tradeTimestamps?: string[]
}

function ArcPath({ pct, color }: { pct: number; color: string }) {
  // SVG arc: 270° sweep, centered at 24,24, r=20
  const r = 18
  const cx = 24
  const cy = 24
  const startAngle = -225  // degrees: start bottom-left
  const sweepAngle = 270   // degrees: sweep to bottom-right
  const clampedPct = Math.min(1, Math.max(0, pct))
  const angle = startAngle + sweepAngle * clampedPct
  const toRad = (d: number) => (d * Math.PI) / 180
  const x = cx + r * Math.cos(toRad(angle))
  const y = cy + r * Math.sin(toRad(angle))
  const x0 = cx + r * Math.cos(toRad(startAngle))
  const y0 = cy + r * Math.sin(toRad(startAngle))
  const largeArc = sweepAngle * clampedPct > 180 ? 1 : 0

  if (clampedPct <= 0) return null
  if (clampedPct >= 1) {
    // Full circle workaround
    const x1 = cx + r * Math.cos(toRad(startAngle + sweepAngle - 0.01))
    const y1 = cy + r * Math.sin(toRad(startAngle + sweepAngle - 0.01))
    return (
      <path
        d={`M ${x0} ${y0} A ${r} ${r} 0 1 1 ${x1} ${y1}`}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
    )
  }
  return (
    <path
      d={`M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y}`}
      fill="none"
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
    />
  )
}

export function PDTGauge({
  dayTradesUsed,
  maxDayTrades = 3,
  isPDT = false,
  accountMode = 'margin',
  equity = 0,
  tradeTimestamps = [],
}: PDTGaugeProps) {
  // Only render for non-PDT margin accounts with equity < $25k
  const shouldShow = accountMode === 'margin' && !isPDT && equity < 25_000

  if (!shouldShow) return null

  const pct = Math.min(1, dayTradesUsed / maxDayTrades)
  const atLimit = dayTradesUsed >= maxDayTrades
  const color = atLimit ? '#ef4444' : dayTradesUsed >= 2 ? '#f59e0b' : '#34d399'

  return (
    // Pure CSS hover — no mouse event handlers, no React state, no focus/blur triggers
    <div className="group relative flex items-center gap-1.5 cursor-default">
      <div className="w-12 h-12 relative flex-shrink-0">
        <svg viewBox="0 0 48 48" className="w-full h-full">
          {/* Track */}
          <ArcPath pct={1} color="#374151" />
          {/* Fill */}
          <ArcPath pct={pct} color={color} />
          {/* Center text */}
          <text
            x="24"
            y="27"
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill={color}
          >
            {dayTradesUsed}/{maxDayTrades}
          </text>
        </svg>
        {atLimit && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 animate-ping" />
        )}
      </div>
      <div className="text-xs">
        <div className={clsx('font-medium', atLimit ? 'text-red-400' : 'text-gray-400')}>
          PDT
        </div>
        <div className="text-gray-600">day trades</div>
      </div>

      {/* CSS-only tooltip — shown via group-hover, zero JS events */}
      <div
        role="tooltip"
        className={clsx(
          'pointer-events-none absolute bottom-full left-0 mb-2 w-56 z-50',
          'rounded border border-gray-700 bg-gray-900 shadow-lg p-2 space-y-1',
          'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
        )}
      >
        <div className="text-xs font-semibold text-gray-300 mb-1">Day Trade Window</div>
        {tradeTimestamps.length === 0 ? (
          <div className="text-xs text-gray-600">No day trades recorded in window.</div>
        ) : (
          tradeTimestamps.map((ts, i) => {
            const d = new Date(ts)
            // Day trade rolls off after 5 sessions — approximate as +5 calendar days
            const expiry = new Date(d.getTime() + 5 * 24 * 60 * 60 * 1000)
            return (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-gray-400">Trade {i + 1}</span>
                <span className="text-gray-500">expires {expiry.toLocaleDateString()}</span>
              </div>
            )
          })
        )}
        {atLimit && (
          <div className="text-xs text-red-400 border-t border-gray-800 pt-1 mt-1">
            Day trading blocked until a trade expires.
          </div>
        )}
      </div>
    </div>
  )
}
