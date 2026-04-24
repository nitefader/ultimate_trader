import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { backtestsApi } from '../api/backtests'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, X, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface Props {
  runId: string
  tradeId: string
  onClose: () => void
}

function fmt$(n: number | null | undefined) {
  if (n == null) return '—'
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pnlClass(n: number | null | undefined) {
  if (n == null) return 'text-gray-400'
  return n >= 0 ? 'text-green-400' : 'text-red-400'
}

// Tiny inline OHLCV bar chart — no dependency needed
function MiniBarChart({
  bars,
  currentIdx,
  entryTime,
  exitTime,
}: {
  bars: Array<{ time: string; open: number; high: number; low: number; close: number }>
  currentIdx: number
  entryTime: string | null
  exitTime: string | null
}) {
  if (bars.length === 0) return <div className="text-gray-500 text-xs py-4 text-center">No bar data available</div>

  const allHighs = bars.map(b => b.high)
  const allLows = bars.map(b => b.low)
  const maxH = Math.max(...allHighs)
  const minL = Math.min(...allLows)
  const range = maxH - minL || 1

  const BAR_W = 8
  const GAP = 3
  const CHART_H = 120
  const totalW = bars.length * (BAR_W + GAP)

  function yPct(price: number) {
    return ((maxH - price) / range) * CHART_H
  }

  return (
    <div className="overflow-x-auto">
      <svg width={totalW} height={CHART_H + 4} className="block">
        {bars.map((bar, i) => {
          const isEntry = entryTime && bar.time.startsWith(entryTime.slice(0, 16))
          const isExit = exitTime && bar.time.startsWith(exitTime.slice(0, 16))
          const isCurrent = i === currentIdx
          const isUp = bar.close >= bar.open
          const x = i * (BAR_W + GAP)
          const bodyTop = Math.min(yPct(bar.open), yPct(bar.close))
          const bodyH = Math.max(Math.abs(yPct(bar.open) - yPct(bar.close)), 1)
          const color = isEntry ? '#22c55e' : isExit ? '#ef4444' : isCurrent ? '#38bdf8' : isUp ? '#4ade80' : '#f87171'
          const opacity = i <= currentIdx ? 1 : 0.3

          return (
            <g key={i} opacity={opacity}>
              {/* Wick */}
              <line
                x1={x + BAR_W / 2}
                x2={x + BAR_W / 2}
                y1={yPct(bar.high)}
                y2={yPct(bar.low)}
                stroke={color}
                strokeWidth={1}
              />
              {/* Body */}
              <rect x={x} y={bodyTop} width={BAR_W} height={bodyH} fill={color} />
              {/* Entry/Exit markers */}
              {(isEntry || isExit) && (
                <rect x={x - 1} y={0} width={BAR_W + 2} height={CHART_H} fill={color} fillOpacity={0.08} />
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function TradeReplayPanel({ runId, tradeId, onClose }: Props) {
  const [step, setStep] = useState(0)

  const { data, isLoading, error } = useQuery({
    queryKey: ['trade-replay', runId, tradeId],
    queryFn: () => backtestsApi.getTradeReplay(runId, tradeId, 10),
  })

  if (isLoading) {
    return (
      <div className="card p-4 flex items-center justify-between">
        <span className="text-sm text-gray-400 animate-pulse">Loading replay…</span>
        <button type="button" onClick={onClose}><X size={14} /></button>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="card p-4 flex items-center justify-between">
        <span className="text-sm text-red-400">Could not load replay data.</span>
        <button type="button" onClick={onClose}><X size={14} /></button>
      </div>
    )
  }

  const { bars, annotations: ann, conditions_fired, symbol, direction } = data
  const maxStep = bars.length > 0 ? bars.length - 1 : 0
  const currentBar = bars[step]

  // Determine where entry/exit bars are for stepper indicator
  const entryBarIdx = ann.entry_time ? bars.findIndex(b => b.time >= ann.entry_time!) : -1
  const exitBarIdx = ann.exit_time ? bars.findIndex(b => b.time >= ann.exit_time!) : -1

  return (
    <div className="card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-200 text-sm">
            Trade Replay — {symbol}
          </h3>
          <span className={clsx(
            'text-xs px-2 py-0.5 rounded font-medium',
            direction === 'long' ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300',
          )}>
            {direction === 'long' ? <TrendingUp size={11} className="inline mr-1" /> : <TrendingDown size={11} className="inline mr-1" />}
            {direction}
          </span>
          {ann.exit_reason && (
            <span className="text-xs text-gray-500">Exit: {ann.exit_reason}</span>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-200 transition">
          <X size={14} />
        </button>
      </div>

      {/* Chart */}
      <div className="rounded border border-gray-800 bg-gray-950 p-2">
        <MiniBarChart
          bars={bars}
          currentIdx={step}
          entryTime={ann.entry_time}
          exitTime={ann.exit_time}
        />
      </div>

      {/* Stepper controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep(s => Math.max(0, s - 1))}
          className="btn-secondary p-1 disabled:opacity-30"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1 relative h-2 bg-gray-800 rounded">
          <div
            className="absolute h-2 bg-sky-600 rounded transition-all"
            style={{ width: `${maxStep > 0 ? (step / maxStep) * 100 : 0}%` }}
          />
          {entryBarIdx >= 0 && (
            <div
              className="absolute top-0 w-0.5 h-2 bg-green-400"
              style={{ left: `${(entryBarIdx / maxStep) * 100}%` }}
              title="Entry"
            />
          )}
          {exitBarIdx >= 0 && (
            <div
              className="absolute top-0 w-0.5 h-2 bg-red-400"
              style={{ left: `${(exitBarIdx / maxStep) * 100}%` }}
              title="Exit"
            />
          )}
        </div>
        <button
          type="button"
          disabled={step >= maxStep}
          onClick={() => setStep(s => Math.min(maxStep, s + 1))}
          className="btn-secondary p-1 disabled:opacity-30"
        >
          <ChevronRight size={16} />
        </button>
        <span className="text-xs text-gray-500 font-mono w-20 text-right">
          Bar {step + 1} / {bars.length}
        </span>
      </div>

      {/* Current bar info */}
      {currentBar && (
        <div className="grid grid-cols-5 gap-2 text-xs">
          {(['open', 'high', 'low', 'close'] as const).map(k => (
            <div key={k} className="rounded bg-gray-900 px-2 py-1.5">
              <div className="text-gray-500 capitalize mb-0.5">{k}</div>
              <div className="font-mono text-gray-200">{fmt$(currentBar[k])}</div>
            </div>
          ))}
          <div className="rounded bg-gray-900 px-2 py-1.5">
            <div className="text-gray-500 mb-0.5">Volume</div>
            <div className="font-mono text-gray-200">{currentBar.volume.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Trade details + conditions */}
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div className="space-y-1">
          <div className="text-gray-500 font-semibold uppercase tracking-wide mb-1.5">Trade Details</div>
          <div className="flex justify-between">
            <span className="text-gray-500">Entry</span>
            <span className="font-mono text-gray-200">{fmt$(ann.entry_price)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Stop</span>
            <span className="font-mono text-red-400">{fmt$(ann.initial_stop)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Target</span>
            <span className="font-mono text-green-400">{fmt$(ann.initial_target)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Exit</span>
            <span className="font-mono text-gray-200">{fmt$(ann.exit_price)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Net P&L</span>
            <span className={clsx('font-mono font-medium', pnlClass(ann.net_pnl))}>{fmt$(ann.net_pnl)}</span>
          </div>
          {ann.r_multiple != null && (
            <div className="flex justify-between">
              <span className="text-gray-500">R-Multiple</span>
              <span className={clsx('font-mono font-medium', pnlClass(ann.r_multiple))}>{ann.r_multiple.toFixed(2)}R</span>
            </div>
          )}
        </div>

        <div>
          <div className="text-gray-500 font-semibold uppercase tracking-wide mb-1.5">Entry Conditions Fired</div>
          {conditions_fired.length === 0 ? (
            <div className="text-gray-600 text-xs">No conditions recorded</div>
          ) : (
            <div className="space-y-1">
              {conditions_fired.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  <Minus size={10} className="text-emerald-400 flex-shrink-0" />
                  <span className="font-mono text-emerald-300">{c}</span>
                </div>
              ))}
            </div>
          )}
          {ann.regime_at_entry && (
            <div className="mt-2">
              <span className="text-gray-500">Regime: </span>
              <span className="text-sky-400 font-mono">{ann.regime_at_entry}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
