import React from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { EquityPoint } from '../../types'

interface Props {
  data: EquityPoint[]
  initialCapital?: number
}

const fmt = (v: number) => `$${v.toLocaleString('en', { maximumFractionDigits: 0 })}`
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`

export function EquityCurve({ data, initialCapital }: Props) {
  if (!data || data.length === 0) {
    return <div className="h-64 flex items-center justify-center text-gray-500 text-sm">No equity data</div>
  }

  // Thin out data if too many points for performance
  const thin = data.length > 1000
    ? data.filter((_, i) => i % Math.ceil(data.length / 1000) === 0)
    : data

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={thin} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="equity-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickFormatter={(v) => v.slice(0, 7)}
            minTickGap={60}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickFormatter={fmt}
            width={72}
          />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6 }}
            labelStyle={{ color: '#9ca3af', fontSize: 11 }}
            formatter={(v: number) => [fmt(v), 'Equity']}
          />
          {initialCapital && (
            <ReferenceLine y={initialCapital} stroke="#374151" strokeDasharray="4 4" />
          )}
          <Area
            type="monotone"
            dataKey="equity"
            stroke="#0ea5e9"
            strokeWidth={1.5}
            fill="url(#equity-grad)"
            dot={false}
            activeDot={{ r: 4, fill: '#0ea5e9' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
