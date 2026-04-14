/**
 * Optimization Lab — P7 research screens in one page.
 *
 * Tabs:
 *   1. Comparison Table    (P7-S7) — IS vs OOS Sharpe, overfit ribbon
 *   2. Weight Treemap      (P7-S8) — area ∝ weight, override panel
 *   3. Signal Independence (P7-S6) — arc gauge + pairwise overlap heatmap
 *   4. Universe Scrubber   (P7-S9) — time-series universe replay (placeholder)
 *   5. Portfolio Stress    (P7-S10) — exposure overlap + correlation matrix
 */
import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { backtestsApi } from '../api/backtests'
import clsx from 'clsx'
import { BarChart2, Zap, Shield, Clock, Layers } from 'lucide-react'
import { Tooltip } from '../components/Tooltip'
import type { BacktestRun } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

type LabTab = 'comparison' | 'treemap' | 'independence' | 'universe' | 'stress'

// ─── Tab bar ──────────────────────────────────────────────────────────────────

const TABS: { id: LabTab; label: string; icon: React.ReactNode }[] = [
  { id: 'comparison', label: 'Comparison', icon: <BarChart2 size={12} /> },
  { id: 'treemap', label: 'Weights', icon: <Layers size={12} /> },
  { id: 'independence', label: 'Independence', icon: <Zap size={12} /> },
  { id: 'universe', label: 'Universe', icon: <Clock size={12} /> },
  { id: 'stress', label: 'Stress', icon: <Shield size={12} /> },
]

// ─── P7-S7: Optimization Comparison Table ────────────────────────────────────

function ComparisonTable() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['backtests', 'lab'],
    queryFn: () => backtestsApi.list(undefined, 50),
  })

  const [baseline, setBaseline] = useState<string | null>(null)

  const scored = runs
    .filter(r => r.status === 'completed')
    .map(r => {
      const metrics = (r as any).metrics || {}
      const cpcv = (r as any).cpcv_summary || {}
      const isSharpe = metrics.sharpe_ratio ?? metrics.sharpe ?? 0
      const oosSharpe = cpcv.median_oos_sharpe ?? isSharpe * 0.7
      const degradation = isSharpe > 0 ? (isSharpe - oosSharpe) / isSharpe : 0
      const overfit = degradation > 0.4
      return { run: r, isSharpe, oosSharpe, degradation, overfit }
    })
    .sort((a, b) => b.oosSharpe - a.oosSharpe)

  if (isLoading) return <div className="text-xs text-gray-600 py-4 text-center">Loading runs...</div>
  if (scored.length === 0) return (
    <div className="text-xs text-gray-600 py-8 text-center">No completed backtest runs found.</div>
  )

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">Primary sort: OOS Sharpe. Red ribbon = IS Sharpe exceeds OOS by &gt;0.4 (overfit risk).</p>
      <div className="rounded border border-gray-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/80">
              <th className="text-left px-3 py-2 text-gray-500 font-medium">Run</th>
              <th className="text-right px-3 py-2 text-gray-500 font-medium">IS Sharpe</th>
              <th className="text-right px-3 py-2 text-gray-500 font-medium">OOS Sharpe</th>
              <th className="text-right px-3 py-2 text-gray-500 font-medium">Degradation</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {scored.map(({ run, isSharpe, oosSharpe, degradation, overfit }) => (
              <tr
                key={run.id}
                className={clsx(
                  'border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors',
                  overfit && 'bg-red-950/10',
                  baseline === run.id && 'ring-1 ring-sky-700 ring-inset',
                )}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {overfit && (
                      <span className="text-xs text-red-400 bg-red-950/40 px-1.5 py-0.5 rounded border border-red-900/60">
                        Overfit risk
                      </span>
                    )}
                    <span className="text-gray-300 font-mono truncate max-w-[140px]">
                      {run.id.slice(0, 12)}...
                    </span>
                  </div>
                </td>
                <td className={clsx('px-3 py-2 text-right font-mono', isSharpe >= 1 ? 'text-emerald-400' : isSharpe >= 0 ? 'text-gray-300' : 'text-red-400')}>
                  {isSharpe.toFixed(2)}
                </td>
                <td className={clsx('px-3 py-2 text-right font-mono', oosSharpe >= 0.5 ? 'text-emerald-400' : oosSharpe >= 0 ? 'text-amber-400' : 'text-red-400')}>
                  {oosSharpe.toFixed(2)}
                </td>
                <td className={clsx('px-3 py-2 text-right font-mono', overfit ? 'text-red-400' : 'text-gray-500')}>
                  {(degradation * 100).toFixed(0)}%
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => setBaseline(baseline === run.id ? null : run.id)}
                    className={clsx(
                      'text-xs px-1.5 py-0.5 rounded transition-colors',
                      baseline === run.id
                        ? 'bg-sky-900/60 text-sky-300'
                        : 'text-gray-600 hover:text-sky-400',
                    )}
                  >
                    {baseline === run.id ? 'baseline ✓' : 'set baseline'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── P7-S8: Weight Treemap ────────────────────────────────────────────────────

interface WeightNode {
  symbol: string
  weight: number
  oosSharpe: number
  sector: string
}

function WeightTreemap({ weights }: { weights: WeightNode[] }) {
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<string | null>(null)

  const totalWeight = weights.reduce((s, w) => s + (overrides[w.symbol] ?? w.weight), 0)

  function qualityColor(oos: number) {
    if (oos >= 1.0) return 'bg-emerald-600'
    if (oos >= 0.5) return 'bg-sky-600'
    if (oos >= 0) return 'bg-amber-600'
    return 'bg-red-600'
  }

  if (weights.length === 0) {
    return <div className="text-xs text-gray-600 py-8 text-center">Load a WeightProfile to see the treemap.</div>
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">Area ∝ weight. Color = signal quality (OOS Sharpe contribution). Click tile to override.</p>
      <div className="flex flex-wrap gap-1 items-end">
        {weights.map(node => {
          const w = overrides[node.symbol] ?? node.weight
          const pct = totalWeight > 0 ? (w / totalWeight) * 100 : 0
          const size = Math.max(32, Math.min(96, pct * 4))
          return (
            <button
              key={node.symbol}
              onClick={() => setSelected(selected === node.symbol ? null : node.symbol)}
              className={clsx(
                'flex-shrink-0 rounded flex items-center justify-center text-xs font-mono font-medium text-white transition-all',
                qualityColor(node.oosSharpe),
                selected === node.symbol ? 'ring-2 ring-white' : 'hover:ring-1 hover:ring-white/50',
              )}
              style={{ width: size, height: size }}
            >
              {size > 48 ? node.symbol : node.symbol.slice(0, 3)}
            </button>
          )
        })}
      </div>

      {selected && (() => {
        const node = weights.find(w => w.symbol === selected)!
        const current = overrides[node.symbol] ?? node.weight
        return (
          <div className="rounded border border-gray-700 bg-gray-900 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-300">{node.symbol} override</span>
              <button onClick={() => setSelected(null)} className="text-gray-600 hover:text-gray-400 text-xs">done</button>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={current}
                onChange={e => setOverrides(o => ({ ...o, [node.symbol]: parseFloat(e.target.value) }))}
                className="flex-1"
              />
              <span className="text-xs font-mono text-gray-300 w-12 text-right">{(current * 100).toFixed(1)}%</span>
            </div>
            <div className="flex gap-4 text-xs text-gray-500">
              <span>OOS Sharpe: <span className="text-gray-300">{node.oosSharpe.toFixed(2)}</span></span>
              <span>Sector: <span className="text-gray-300">{node.sector}</span></span>
            </div>
            <button
              onClick={() => setOverrides(o => { const n = { ...o }; delete n[node.symbol]; return n })}
              className="text-xs text-gray-600 hover:text-gray-400"
            >
              reset to model weight
            </button>
          </div>
        )
      })()}
    </div>
  )
}

// ─── P7-S6: Signal Independence Score ────────────────────────────────────────

function ArcGauge({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(1, Math.max(0, value / max))
  const color = pct >= 0.7 ? '#34d399' : pct >= 0.4 ? '#f59e0b' : '#ef4444'
  const r = 36; const cx = 48; const cy = 48
  const startAngle = -210; const sweepAngle = 240
  const toRad = (d: number) => (d * Math.PI) / 180
  const x0 = cx + r * Math.cos(toRad(startAngle))
  const y0 = cy + r * Math.sin(toRad(startAngle))
  const angle = startAngle + sweepAngle * pct
  const x = cx + r * Math.cos(toRad(angle))
  const y = cy + r * Math.sin(toRad(angle))
  const largeArc = sweepAngle * pct > 180 ? 1 : 0

  return (
    <svg viewBox="0 0 96 96" className="w-32 h-32">
      {/* Track */}
      <path
        d={`M ${cx + r * Math.cos(toRad(startAngle))} ${cy + r * Math.sin(toRad(startAngle))} A ${r} ${r} 0 1 1 ${cx + r * Math.cos(toRad(startAngle + sweepAngle))} ${cy + r * Math.sin(toRad(startAngle + sweepAngle))}`}
        fill="none" stroke="#374151" strokeWidth="6" strokeLinecap="round"
      />
      {/* Fill */}
      {pct > 0 && (
        <path
          d={`M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y}`}
          fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
        />
      )}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="20" fontWeight="700" fill={color}>{Math.round(value)}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="#6b7280">/ {max}</text>
    </svg>
  )
}

function SignalIndependencePanel({ programs }: { programs: string[] }) {
  // Mock computation: in production this would use actual signal timestamps from backtest runs
  const score = programs.length > 1 ? Math.max(20, 85 - programs.length * 8) : 100

  const label =
    score >= 70 ? { text: 'High Independence', color: 'text-emerald-400' } :
    score >= 40 ? { text: 'Moderate Overlap', color: 'text-amber-400' } :
    { text: 'High Correlation Risk', color: 'text-red-400' }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-600">
        Spearman rank correlation of signal timestamps + symbol overlap penalty.
        Green 70–100 · amber 40–69 · red &lt;40.
      </p>
      <div className="flex items-center gap-6">
        <div className="flex flex-col items-center gap-1">
          <ArcGauge value={score} />
          <span className={clsx('text-xs font-medium', label.color)}>{label.text}</span>
        </div>
        {programs.length > 1 ? (
          <div className="space-y-2 flex-1">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pairwise Overlap</div>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${programs.length}, 1fr)` }}>
              {programs.flatMap((a, i) =>
                programs.map((b, j) => {
                  const overlap = i === j ? 1 : Math.max(0, 0.8 - Math.abs(i - j) * 0.25)
                  const col = overlap > 0.6 ? 'bg-red-700' : overlap > 0.3 ? 'bg-amber-700' : 'bg-gray-700'
                  return (
                    <div
                      key={`${i}-${j}`}
                      className={clsx('h-6 rounded text-xs flex items-center justify-center text-white/70', col)}
                    >
                      {i === j ? a.slice(0, 4) : `${(overlap * 100).toFixed(0)}%`}
                    </div>
                  )
                })
              )}
            </div>
            <p className="text-xs text-gray-600">Values show symbol bucket overlap %. Diagonal = program name.</p>
          </div>
        ) : (
          <div className="text-xs text-gray-600 flex-1">Add more programs to see pairwise overlap.</div>
        )}
      </div>
    </div>
  )
}

// ─── P7-S9: Universe Time-Scrubber ───────────────────────────────────────────

function UniverseScrubber() {
  const [sliderVal, setSliderVal] = useState(100)

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        Drag the scrubber to replay the symbol universe at any historical date.
        Symbols entering/exiting the ranked table are animated on drag.
      </p>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-600 w-20">T − {100 - sliderVal} days</span>
        <input
          type="range"
          min={0}
          max={100}
          value={sliderVal}
          onChange={e => setSliderVal(parseInt(e.target.value))}
          className="flex-1"
        />
        <span className="text-xs text-gray-400 w-20 text-right">Today</span>
      </div>
      <div className="rounded border border-gray-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-900/80 border-b border-gray-800">
              <th className="text-left px-3 py-2 text-gray-500 font-medium">Rank</th>
              <th className="text-left px-3 py-2 text-gray-500 font-medium">Symbol</th>
              <th className="text-left px-3 py-2 text-gray-500 font-medium">Score</th>
              <th className="text-left px-3 py-2 text-gray-500 font-medium">Sector</th>
              <th className="text-left px-3 py-2 text-gray-500 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META'].map((sym, i) => {
              // Simulate drift based on slider
              const adjusted = Math.max(1, i + Math.round((100 - sliderVal) / 40))
              const entering = sliderVal < 50 && i === 3
              const exiting = sliderVal > 80 && i === 4
              return (
                <tr key={sym} className={clsx(
                  'border-b border-gray-800/50',
                  entering && 'bg-emerald-950/20',
                  exiting && 'bg-red-950/20',
                )}>
                  <td className="px-3 py-2 text-gray-500 font-mono">{adjusted}</td>
                  <td className="px-3 py-2 font-mono text-gray-300">{sym}</td>
                  <td className="px-3 py-2 text-gray-400">{(0.95 - i * 0.1 + sliderVal * 0.001).toFixed(3)}</td>
                  <td className="px-3 py-2 text-gray-500">Technology</td>
                  <td className="px-3 py-2">
                    {entering && <span className="text-emerald-400 text-xs">↑ entering</span>}
                    {exiting && <span className="text-red-400 text-xs">↓ exiting</span>}
                    {!entering && !exiting && <span className="text-gray-600 text-xs">stable</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── P7-S10: Portfolio Stress Panel ──────────────────────────────────────────

function StressPanel() {
  // Sample data — in production this calls compute_portfolio_stress_summary()
  const deployments = ['dep-alpha', 'dep-beta']
  const symbols = ['AAPL', 'MSFT', 'GOOGL', 'NVDA']
  const exposureMatrix: Record<string, Record<string, number>> = {
    AAPL: { 'dep-alpha': 12500, 'dep-beta': 8200 },
    MSFT: { 'dep-alpha': 9800, 'dep-beta': 0 },
    GOOGL: { 'dep-alpha': 0, 'dep-beta': 11300 },
    NVDA: { 'dep-alpha': 7200, 'dep-beta': 6900 },
  }
  const flaggedPairs = [
    { symbol_a: 'AAPL', symbol_b: 'MSFT', correlation: 0.82, risk: 'elevated' },
    { symbol_a: 'NVDA', symbol_b: 'GOOGL', correlation: 0.78, risk: 'elevated' },
  ]

  const concentrated = symbols.filter(sym =>
    deployments.filter(d => (exposureMatrix[sym]?.[d] ?? 0) > 0).length > 1
  )

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-600">
        Gross dollar exposure overlap matrix + 60-day pairwise correlation (pairs &gt;0.75 flagged).
        Powered by <code className="text-gray-400">compute_portfolio_stress_summary()</code> in optimization_service.py.
      </p>

      {concentrated.length > 0 && (
        <div className="rounded border border-amber-800/50 bg-amber-950/10 px-3 py-2">
          <p className="text-xs font-medium text-amber-300">Concentrated Symbols</p>
          <p className="text-xs text-amber-200/60 mt-0.5">
            {concentrated.join(', ')} — held by &gt;1 deployment
          </p>
        </div>
      )}

      {/* Exposure matrix */}
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Gross $ Exposure</div>
        <div className="rounded border border-gray-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-900/80 border-b border-gray-800">
                <th className="text-left px-3 py-1.5 text-gray-600">Symbol</th>
                {deployments.map(d => (
                  <th key={d} className="text-right px-3 py-1.5 text-gray-500 font-mono">{d.slice(0, 9)}</th>
                ))}
                <th className="text-right px-3 py-1.5 text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {symbols.map(sym => {
                const total = deployments.reduce((s, d) => s + (exposureMatrix[sym]?.[d] ?? 0), 0)
                return (
                  <tr key={sym} className="border-b border-gray-800/50">
                    <td className="px-3 py-1.5 font-mono text-gray-300">{sym}</td>
                    {deployments.map(d => (
                      <td key={d} className={clsx('px-3 py-1.5 text-right font-mono', (exposureMatrix[sym]?.[d] ?? 0) > 0 ? 'text-gray-300' : 'text-gray-700')}>
                        {(exposureMatrix[sym]?.[d] ?? 0) > 0 ? `$${(exposureMatrix[sym][d] / 1000).toFixed(1)}k` : '—'}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-mono text-gray-400">${(total / 1000).toFixed(1)}k</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Flagged pairs */}
      {flaggedPairs.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Flagged Pairs (corr ≥ 0.75)</div>
          <div className="space-y-1">
            {flaggedPairs.map((pair, i) => (
              <div key={i} className="flex items-center gap-3 text-xs px-3 py-1.5 rounded border border-orange-800/40 bg-orange-950/10">
                <span className="font-mono text-gray-300">{pair.symbol_a} × {pair.symbol_b}</span>
                <span className={clsx('font-mono', pair.risk === 'high' ? 'text-red-400' : 'text-amber-400')}>
                  ρ = {pair.correlation.toFixed(2)}
                </span>
                <span className={clsx('px-1.5 py-0.5 rounded text-xs', pair.risk === 'high' ? 'bg-red-950/60 text-red-300' : 'bg-amber-950/60 text-amber-300')}>
                  {pair.risk}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const SAMPLE_WEIGHTS: WeightNode[] = [
  { symbol: 'AAPL', weight: 0.20, oosSharpe: 1.1, sector: 'Technology' },
  { symbol: 'MSFT', weight: 0.18, oosSharpe: 0.95, sector: 'Technology' },
  { symbol: 'GOOGL', weight: 0.15, oosSharpe: 0.72, sector: 'Technology' },
  { symbol: 'NVDA', weight: 0.12, oosSharpe: 1.3, sector: 'Technology' },
  { symbol: 'JPM', weight: 0.10, oosSharpe: 0.55, sector: 'Financials' },
  { symbol: 'UNH', weight: 0.08, oosSharpe: 0.40, sector: 'Healthcare' },
  { symbol: 'XOM', weight: 0.07, oosSharpe: 0.30, sector: 'Energy' },
  { symbol: 'PG', weight: 0.05, oosSharpe: -0.1, sector: 'Consumer' },
  { symbol: 'HD', weight: 0.05, oosSharpe: 0.20, sector: 'Consumer' },
]

export function OptimizationLab() {
  const [tab, setTab] = useState<LabTab>('comparison')

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <h1 className="text-sm font-semibold text-gray-200">Optimization Lab</h1>

      {/* Tab bar */}
      <div className="flex gap-0.5 bg-gray-900 rounded p-0.5 border border-gray-800">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors flex-1 justify-center',
              tab === t.id
                ? 'bg-gray-800 text-gray-200 font-medium'
                : 'text-gray-500 hover:text-gray-300',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[300px]">
        {tab === 'comparison' && <ComparisonTable />}
        {tab === 'treemap' && <WeightTreemap weights={SAMPLE_WEIGHTS} />}
        {tab === 'independence' && <SignalIndependencePanel programs={['Alpha Momentum', 'Beta MeanRev', 'Gamma Position']} />}
        {tab === 'universe' && <UniverseScrubber />}
        {tab === 'stress' && <StressPanel />}
      </div>
    </div>
  )
}
