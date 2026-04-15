import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, Loader, TrendingUp, Database, Cpu, FlaskConical, BarChart2 } from 'lucide-react'

interface Props {
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  runId?: string
  errorMsg?: string | null
  walkForwardEnabled: boolean
  symbols: string[]
  timeframe: string
  trainWindowMonths: number
  testWindowMonths: number
}

// Simulated stage sequence — gives the user a sense of what the engine is doing
// Timings are illustrative; real completion triggers immediate navigation.
const STAGES_STANDARD = [
  { key: 'data',    icon: Database,    label: 'Fetching market data',       ms: 600 },
  { key: 'warmup',  icon: Cpu,         label: 'Warming up indicators',      ms: 900 },
  { key: 'engine',  icon: TrendingUp,  label: 'Running backtest engine',    ms: 1200 },
  { key: 'metrics', icon: BarChart2,   label: 'Computing metrics',          ms: 400 },
]

const STAGES_WF = [
  { key: 'data',    icon: Database,    label: 'Fetching market data',       ms: 600 },
  { key: 'warmup',  icon: Cpu,         label: 'Warming up indicators',      ms: 700 },
  { key: 'train',   icon: FlaskConical,label: 'Training walk-forward folds',ms: 1400 },
  { key: 'oos',     icon: TrendingUp,  label: 'Running out-of-sample test', ms: 1000 },
  { key: 'stitch',  icon: BarChart2,   label: 'Stitching OOS equity curve', ms: 400 },
  { key: 'metrics', icon: BarChart2,   label: 'Computing metrics',          ms: 300 },
]

function useElapsed(running: boolean) {
  const [elapsed, setElapsed] = useState(0)
  const start = useRef<number | null>(null)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    if (running) {
      start.current = Date.now()
      const tick = () => {
        setElapsed(Math.floor((Date.now() - start.current!) / 1000))
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)
    } else {
      if (raf.current) cancelAnimationFrame(raf.current)
      if (!running) setElapsed(0)
    }
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [running])

  return elapsed
}

export function BacktestLaunchOverlay({
  isPending,
  isSuccess,
  isError,
  runId,
  errorMsg,
  walkForwardEnabled,
  symbols,
  timeframe,
  trainWindowMonths,
  testWindowMonths,
}: Props) {
  const navigate = useNavigate()
  const stages = walkForwardEnabled ? STAGES_WF : STAGES_STANDARD
  const [stageIndex, setStageIndex] = useState(0)
  const elapsed = useElapsed(isPending)

  // Advance simulated stages while pending
  useEffect(() => {
    if (!isPending) { setStageIndex(0); return }
    let idx = 0
    const advance = () => {
      if (idx < stages.length - 1) {
        idx++
        setStageIndex(idx)
        timer = setTimeout(advance, stages[idx].ms)
      }
    }
    let timer = setTimeout(advance, stages[0].ms)
    return () => clearTimeout(timer)
  }, [isPending, stages])

  // Navigate immediately when backend confirms success
  useEffect(() => {
    if (isSuccess && runId) {
      const t = setTimeout(() => navigate(`/runs/${runId}`), 420)
      return () => clearTimeout(t)
    }
  }, [isSuccess, runId, navigate])

  if (!isPending && !isSuccess) return null

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-bg-card)',
        boxShadow: 'var(--shadow-float)',
      }}
    >
      {/* Header bar */}
      <div
        className="px-4 py-3 flex items-center gap-3"
        style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-hover)' }}
      >
        {isSuccess ? (
          <CheckCircle size={16} className="shrink-0" style={{ color: 'var(--color-success)' }} />
        ) : (
          <Loader size={16} className="shrink-0 animate-spin" style={{ color: 'var(--color-accent)' }} />
        )}
        <div className="flex-1">
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {isSuccess ? 'Backtest complete — redirecting…' : 'Backtest running'}
          </div>
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {symbols.join(', ')} · {timeframe}
            {walkForwardEnabled && ` · ${trainWindowMonths}m train / ${testWindowMonths}m test`}
          </div>
        </div>
        {isPending && (
          <div className="text-xs font-mono tabular-nums" style={{ color: 'var(--color-text-faint)' }}>
            {elapsed}s
          </div>
        )}
      </div>

      {/* Stage list */}
      <div className="px-4 py-3 space-y-2">
        {stages.map((stage, i) => {
          const Icon = stage.icon
          const done = i < stageIndex || isSuccess
          const active = i === stageIndex && isPending
          const waiting = i > stageIndex && !isSuccess

          return (
            <div key={stage.key} className="flex items-center gap-3">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-300"
                style={{
                  backgroundColor: done
                    ? 'color-mix(in srgb, var(--color-success) 20%, transparent)'
                    : active
                    ? 'color-mix(in srgb, var(--color-accent) 20%, transparent)'
                    : 'var(--color-bg-hover)',
                  border: `1px solid ${done ? 'var(--color-success)' : active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                }}
              >
                {done ? (
                  <CheckCircle size={12} style={{ color: 'var(--color-success)' }} />
                ) : active ? (
                  <Loader size={12} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                ) : (
                  <Icon size={12} style={{ color: 'var(--color-text-faint)' }} />
                )}
              </div>
              <span
                className="text-xs transition-colors duration-300"
                style={{
                  color: done
                    ? 'var(--color-success)'
                    : active
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-faint)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {stage.label}
              </span>
              {active && (
                <span className="ml-auto">
                  <span className="inline-flex gap-0.5">
                    {[0, 1, 2].map((j) => (
                      <span
                        key={j}
                        className="w-1 h-1 rounded-full animate-bounce"
                        style={{
                          backgroundColor: 'var(--color-accent)',
                          animationDelay: `${j * 150}ms`,
                          opacity: 0.7,
                        }}
                      />
                    ))}
                  </span>
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className="px-4 pb-4">
        <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-hover)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: isSuccess ? '100%' : `${Math.min(((stageIndex + 0.5) / stages.length) * 100, 95)}%`,
              backgroundColor: isSuccess ? 'var(--color-success)' : 'var(--color-accent)',
            }}
          />
        </div>
      </div>
    </div>
  )
}
