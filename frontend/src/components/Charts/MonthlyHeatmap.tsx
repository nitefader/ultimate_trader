import React from 'react'
import clsx from 'clsx'

interface Props {
  data: Record<string, number>   // "YYYY-MM" → return_pct
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function colorClass(val: number): string {
  if (val > 5) return 'bg-emerald-700 text-emerald-100'
  if (val > 2) return 'bg-emerald-900 text-emerald-300'
  if (val > 0) return 'bg-emerald-950 text-emerald-400'
  if (val > -2) return 'bg-red-950 text-red-400'
  if (val > -5) return 'bg-red-900 text-red-300'
  return 'bg-red-700 text-red-100'
}

export function MonthlyHeatmap({ data }: Props) {
  if (!data || Object.keys(data).length === 0) {
    return <div className="text-sm text-gray-500">No monthly return data</div>
  }

  const years = [...new Set(Object.keys(data).map(k => k.slice(0, 4)))].sort()

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="text-gray-500 pr-2 text-left w-12">Year</th>
            {MONTHS.map(m => (
              <th key={m} className="text-gray-500 w-10 text-center">{m}</th>
            ))}
            <th className="text-gray-500 pl-2 w-14 text-right">Annual</th>
          </tr>
        </thead>
        <tbody>
          {years.map(year => {
            let annual = 1
            return (
              <tr key={year}>
                <td className="text-gray-400 pr-2 py-0.5">{year}</td>
                {Array.from({ length: 12 }, (_, i) => {
                  const key = `${year}-${String(i + 1).padStart(2, '0')}`
                  const val = data[key]
                  if (val !== undefined) annual *= (1 + val / 100)
                  return (
                    <td key={i} className="py-0.5">
                      {val !== undefined ? (
                        <div className={clsx('rounded text-center py-0.5 px-1', colorClass(val))}>
                          {val > 0 ? '+' : ''}{val.toFixed(1)}
                        </div>
                      ) : (
                        <div className="rounded text-center py-0.5 px-1 text-gray-700">—</div>
                      )}
                    </td>
                  )
                })}
                <td className={clsx(
                  'pl-2 text-right font-bold',
                  annual > 1 ? 'text-emerald-400' : 'text-red-400',
                )}>
                  {annual > 1 ? '+' : ''}{((annual - 1) * 100).toFixed(1)}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
