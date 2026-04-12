import React from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import type { EquityPoint } from '../../types'

interface Props {
  data: EquityPoint[]
}

export function DrawdownChart({ data }: Props) {
  if (!data || data.length === 0) {
    return <div className="h-40 flex items-center justify-center text-gray-500 text-sm">No data</div>
  }

  const thin = data.length > 1000
    ? data.filter((_, i) => i % Math.ceil(data.length / 1000) === 0)
    : data

  const chartData = thin.map(d => ({ ...d, drawdown_pct: -(d.drawdown * 100) }))

  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="dd-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
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
            tickFormatter={(v) => `${v.toFixed(1)}%`}
            width={52}
          />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6 }}
            formatter={(v: number) => [`${Math.abs(v).toFixed(2)}%`, 'Drawdown']}
          />
          <Area
            type="monotone"
            dataKey="drawdown_pct"
            stroke="#ef4444"
            strokeWidth={1}
            fill="url(#dd-grad)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
