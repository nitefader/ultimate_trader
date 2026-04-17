import React, { useMemo } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Trade } from '../../types'

type Props = {
  trades: Trade[]
  symbol?: string
}

type ChartPoint = {
  index: number
  isoTime: string
  dateLabel: string
  price: number
  side: 'entry' | 'exit'
  symbol: string
  direction: string
  exitReason?: string
  pnl?: number
}

function toDateLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

function fmtPrice(v: number): string {
  return `$${v.toFixed(2)}`
}

function fmtPnl(v: number | undefined): string {
  if (v == null) return '-'
  return `${v >= 0 ? '+' : ''}$${v.toFixed(0)}`
}

export function TradeEntryExitChart({ trades, symbol }: Props) {
  const filteredTrades = useMemo(() => {
    if (!symbol || symbol === 'ALL') return trades
    return trades.filter(t => t.symbol === symbol)
  }, [trades, symbol])

  const points = useMemo<ChartPoint[]>(() => {
    const out: ChartPoint[] = []

    for (const t of filteredTrades) {
      if (t.entry_time && t.entry_price != null) {
        out.push({
          index: 0,
          isoTime: t.entry_time,
          dateLabel: toDateLabel(t.entry_time),
          price: t.entry_price,
          side: 'entry',
          symbol: t.symbol,
          direction: t.direction,
        })
      }

      if (t.exit_time && t.exit_price != null) {
        out.push({
          index: 0,
          isoTime: t.exit_time,
          dateLabel: toDateLabel(t.exit_time),
          price: t.exit_price,
          side: 'exit',
          symbol: t.symbol,
          direction: t.direction,
          exitReason: t.exit_reason,
          pnl: t.net_pnl,
        })
      }
    }

    out.sort((a, b) => a.isoTime.localeCompare(b.isoTime))
    return out.map((p, idx) => ({ ...p, index: idx }))
  }, [filteredTrades])

  const entries = useMemo(() => points.filter(p => p.side === 'entry'), [points])
  const exits = useMemo(() => points.filter(p => p.side === 'exit'), [points])

  // Compute tick positions where date label changes to avoid duplicates
  const ticks = useMemo(() => {
    if (points.length === 0) return []
    const result: number[] = [0] // always start with first point
    for (let i = 1; i < points.length; i++) {
      if (points[i].dateLabel !== points[i - 1].dateLabel) {
        result.push(i)
      }
    }
    // If we have many ticks, limit to ~8 max by keeping first, last, and evenly spaced ones
    if (result.length > 8) {
      const step = Math.ceil(result.length / 8)
      const filtered = result.filter((_, idx) => idx % step === 0 || idx === result.length - 1)
      return filtered.length > 0 ? filtered : [0, Math.max(0, points.length - 1)]
    }
    return result
  }, [points])

  if (points.length === 0) {
    return <div className="text-xs text-gray-500">No trade points available for this selection.</div>
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            type="number"
            dataKey="index"
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            tickFormatter={(v) => {
              const idx = Math.round(Number(v))
              const point = points[Math.max(0, Math.min(points.length - 1, idx))]
              return point?.dateLabel ?? ''
            }}
            domain={[0, Math.max(points.length - 1, 0)]}
            ticks={ticks}
          />
          <YAxis
            dataKey="price"
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
            domain={['dataMin - 1', 'dataMax + 1']}
          />
          <Tooltip
            contentStyle={{
              background: '#0b1220',
              border: '1px solid #1f2937',
              borderRadius: 10,
              color: '#e5e7eb',
              fontSize: 12,
            }}
            formatter={(value: number) => [fmtPrice(Number(value)), 'Price']}
            labelFormatter={(label) => {
              const point = points[Math.max(0, Math.min(points.length - 1, Math.round(Number(label))))]
              if (!point) return ''
              const bits = [point.dateLabel, `${point.symbol} ${point.side.toUpperCase()}`, point.direction]
              if (point.exitReason) bits.push(point.exitReason)
              if (point.side === 'exit') bits.push(`PnL ${fmtPnl(point.pnl)}`)
              return bits.join(' | ')
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />

          <Line
            type="monotone"
            dataKey="price"
            name="Execution Path"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Scatter
            data={entries}
            name="Entries"
            fill="#22c55e"
            dataKey="price"
            isAnimationActive={false}
          />
          <Scatter
            data={exits}
            name="Exits"
            fill="#ef4444"
            dataKey="price"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
