/**
 * SimulationLab — real-time strategy validation using the full BacktestEngine.
 *
 * Layout:
 *   - Collapsible setup drawer (auto-collapses after launch, re-opens via button)
 *   - Full-width chart area: price (55%) + volume (10%) + oscillator (25%) + equity strip (10%)
 *   - Indicator panel (grouped toggles, routes to correct pane automatically)
 *   - Right sidebar: tabbed Metrics | Positions | Trade Log (no item cap)
 *   - Chart parity with ChartLab: tms numeric x-axis, CSS color vars, median slot-width
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Customized,
  BarChart,
  Bar,
  Cell,
} from 'recharts'
import {
  Play, Pause, SkipForward, FastForward, ChevronRight,
  AlertTriangle, Activity, Loader, RotateCcw, ZoomIn, ZoomOut,
  Settings, ChevronDown, ChevronUp, X,
} from 'lucide-react'
import clsx from 'clsx'
import { strategiesApi } from '../api/strategies'
import { servicesApi } from '../api/services'
import { programsApi } from '../api/programs'
import {
  simulationsApi, createSimulationWs,
  type BarSnapshotData, type SimulationMetadata, type TradeEvent,
} from '../api/simulations'
import { DatePickerInput } from '../components/DatePickerInput'
import { SelectMenu } from '../components/SelectMenu'
import { TickerSearch } from '../components/TickerSearch'
import { PageHelp } from '../components/PageHelp'

// ── Constants ─────────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10)
const jan2020 = '2020-01-01'

const timeframeOptions = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1wk'].map((tf) => ({
  value: tf, label: tf,
}))

const speedOptions = [
  { value: '1',   label: '1×' },
  { value: '5',   label: '5×' },
  { value: '25',  label: '25×' },
  { value: '100', label: '100×' },
  { value: '500', label: 'Max' },
]

// ── Indicator catalogue (matches ChartLab) ────────────────────────────────────

interface IndicatorDef {
  spec: string
  label: string
  pane: 'price' | 'oscillator'
  color: string
  produces?: string[]
  dash?: string
}

const INDICATOR_GROUPS: { group: string; items: IndicatorDef[] }[] = [
  {
    group: 'Moving Averages',
    items: [
      { spec: 'ema_9',      label: 'EMA 9',      pane: 'price',      color: '#38bdf8' },
      { spec: 'ema_20',     label: 'EMA 20',     pane: 'price',      color: '#818cf8' },
      { spec: 'ema_50',     label: 'EMA 50',     pane: 'price',      color: '#a78bfa' },
      { spec: 'ema_200',    label: 'EMA 200',    pane: 'price',      color: '#f472b6' },
      { spec: 'sma_20',     label: 'SMA 20',     pane: 'price',      color: '#fb923c', dash: '4 2' },
      { spec: 'sma_50',     label: 'SMA 50',     pane: 'price',      color: '#fbbf24', dash: '4 2' },
      { spec: 'sma_200',    label: 'SMA 200',    pane: 'price',      color: '#f87171', dash: '4 2' },
      { spec: 'hull_ma',    label: 'HMA 20',     pane: 'price',      color: '#34d399' },
      { spec: 'vwap',       label: 'VWAP',       pane: 'price',      color: '#2dd4bf', dash: '6 2' },
    ],
  },
  {
    group: 'Bands & Channels',
    items: [
      { spec: 'bb_upper',   label: 'Bollinger',  pane: 'price',      color: '#7dd3fc',
        produces: ['bb_upper', 'bb_mid', 'bb_lower'] },
      { spec: 'kc_upper',   label: 'Keltner',    pane: 'price',      color: '#86efac',
        produces: ['kc_upper', 'kc_mid', 'kc_lower'] },
      { spec: 'dc_upper',   label: 'Donchian',   pane: 'price',      color: '#fca5a5',
        produces: ['dc_upper', 'dc_mid', 'dc_lower'] },
    ],
  },
  {
    group: 'Trend',
    items: [
      { spec: 'sar',        label: 'Parabolic SAR', pane: 'price',   color: '#e879f9' },
      { spec: 'macd',       label: 'MACD',       pane: 'oscillator', color: '#38bdf8',
        produces: ['macd', 'macd_signal', 'macd_hist'] },
      { spec: 'adx',        label: 'ADX 14',     pane: 'oscillator', color: '#c084fc',
        produces: ['adx', 'plus_di', 'minus_di'] },
    ],
  },
  {
    group: 'Oscillators',
    items: [
      { spec: 'rsi_14',     label: 'RSI 14',     pane: 'oscillator', color: '#f59e0b' },
      { spec: 'rsi_3',      label: 'RSI 3',      pane: 'oscillator', color: '#fb923c' },
      { spec: 'stoch_k',    label: 'Stochastic', pane: 'oscillator', color: '#34d399',
        produces: ['stoch_k', 'stoch_d'] },
      { spec: 'ibs',        label: 'IBS',        pane: 'oscillator', color: '#a3e635' },
      { spec: 'zscore',     label: 'Z-Score',    pane: 'oscillator', color: '#22d3ee' },
      { spec: 'bt_snipe',   label: 'BT Snipe',   pane: 'oscillator', color: '#f472b6' },
    ],
  },
  {
    group: 'Volume / Volatility',
    items: [
      { spec: 'atr_14',     label: 'ATR 14',     pane: 'oscillator', color: '#fb7185' },
      { spec: 'obv',        label: 'OBV',        pane: 'oscillator', color: '#94a3b8' },
    ],
  },
]

const ALL_INDICATORS: IndicatorDef[] = INDICATOR_GROUPS.flatMap(g => g.items)

// Build lookup: data key → IndicatorDef
const KEY_TO_DEF: Record<string, IndicatorDef> = {}
for (const def of ALL_INDICATORS) {
  for (const k of (def.produces ?? [def.spec])) {
    KEY_TO_DEF[k] = def
  }
}

// ── Date formatting ───────────────────────────────────────────────────────────

function fmtTs(ms: number, tf: string): string {
  const d = new Date(ms)
  if (tf === '1d' || tf === '1wk') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  }
  if (tf === '1wk') {
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// ── CandlestickLayer — parity with ChartLab ───────────────────────────────────
// Uses tms (numeric ms) x-axis with median-distance slot-width calculation.
// Colors use CSS variables to respect the active theme.

function CandlestickLayer(props: any) {
  const { xAxisMap, yAxisMap, data } = props
  if (!data?.length) return null

  const xAxis = xAxisMap && (Object.values(xAxisMap)[0] as any)
  const yAxis = yAxisMap && (Object.values(yAxisMap)[0] as any)
  if (!yAxis?.scale) return null

  const yScale = yAxis.scale
  const xScale = xAxis?.scale
  const xOffset = xAxis?.x ?? 0

  // Compute slot width using median of adjacent pixel distances (handles weekend gaps)
  let slotWidth: number
  if (xScale?.bandwidth) {
    slotWidth = xScale.bandwidth()
  } else {
    try {
      const xs: number[] = data
        .map((d: any) => {
          const px = xScale ? xScale(d.tms) : NaN
          return typeof px === 'number' && !isNaN(px) ? px : NaN
        })
        .filter((v: number) => !isNaN(v))
      if (xs.length >= 2) {
        const diffs: number[] = []
        for (let i = 1; i < xs.length; i++) diffs.push(Math.abs(xs[i] - xs[i - 1]))
        diffs.sort((a, b) => a - b)
        slotWidth = diffs[Math.floor(diffs.length / 2)]
      } else {
        slotWidth = (xAxis?.width ?? 600) / data.length
      }
    } catch {
      slotWidth = (xAxis?.width ?? 600) / data.length
    }
  }

  const bw = Math.max(slotWidth - 2, 1)

  return (
    <g>
      {data.map((d: any, i: number) => {
        const { open, high, low, close } = d
        if (open == null || close == null || high == null || low == null) return null

        const bullish = close >= open
        const color = bullish ? 'var(--color-success)' : 'var(--color-danger)'

        let cx: number
        if (xScale?.bandwidth) {
          cx = xOffset + (xScale(d.tms) ?? 0) + xScale.bandwidth() / 2
        } else if (xScale) {
          const px = xScale(d.tms)
          cx = typeof px === 'number' && !isNaN(px) ? px : xOffset + (i + 0.5) * slotWidth
        } else {
          cx = xOffset + (i + 0.5) * slotWidth
        }

        const yH = yScale(high)
        const yL = yScale(low)
        const yO = yScale(open)
        const yC = yScale(close)
        const bodyTop = Math.min(yO, yC)
        const bodyH = Math.max(Math.abs(yC - yO), 1)

        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
            <rect x={cx - bw / 2} y={bodyTop} width={bw} height={bodyH}
              fill={color} fillOpacity={0.85} stroke={color} strokeWidth={0.5} />

            {/* Entry arrow — green up-triangle below the bar */}
            {d._entry && (
              <g>
                <polygon
                  points={`${cx},${yScale(d._entryPrice) - 14} ${cx - 6},${yScale(d._entryPrice) - 2} ${cx + 6},${yScale(d._entryPrice) - 2}`}
                  fill="var(--color-success)" stroke="rgba(0,0,0,0.4)" strokeWidth={1} />
                <text x={cx + 9} y={yScale(d._entryPrice) - 5} fontSize={8}
                  fill="var(--color-success)" fontFamily="monospace">
                  B {d._entryPrice?.toFixed(2)}
                </text>
              </g>
            )}

            {/* Exit arrow — down-triangle, colored by P&L */}
            {d._exit && (
              <g>
                <polygon
                  points={`${cx},${yScale(d._exitPrice) + 14} ${cx - 6},${yScale(d._exitPrice) + 2} ${cx + 6},${yScale(d._exitPrice) + 2}`}
                  fill={d._exitPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}
                  stroke="rgba(0,0,0,0.4)" strokeWidth={1} />
                <text x={cx + 9} y={yScale(d._exitPrice) + 12} fontSize={8}
                  fill={d._exitPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}
                  fontFamily="monospace">
                  S {d._exitPrice?.toFixed(2)} ({d._exitPnl >= 0 ? '+' : ''}{d._exitPnl?.toFixed(0)})
                </text>
              </g>
            )}
          </g>
        )
      })}
    </g>
  )
}

// ── Shared tooltip ─────────────────────────────────────────────────────────────

function SimTooltip({ active, payload, tf }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const label = typeof d.tms === 'number' ? fmtTs(d.tms, tf ?? '1d') : ''
  return (
    <div className="rounded-lg text-xs px-3 py-2 space-y-1 shadow-xl"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', minWidth: 160 }}>
      <div className="font-semibold" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
      {d.open != null && (
        <div className="grid grid-cols-2 gap-x-3 font-mono">
          <span style={{ color: 'var(--color-text-faint)' }}>O</span><span>{d.open?.toFixed(2)}</span>
          <span style={{ color: 'var(--color-text-faint)' }}>H</span>
          <span style={{ color: 'var(--color-success)' }}>{d.high?.toFixed(2)}</span>
          <span style={{ color: 'var(--color-text-faint)' }}>L</span>
          <span style={{ color: 'var(--color-danger)' }}>{d.low?.toFixed(2)}</span>
          <span style={{ color: 'var(--color-text-faint)' }}>C</span>
          <span style={{ color: d.close >= d.open ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600 }}>
            {d.close?.toFixed(2)}
          </span>
        </div>
      )}
      {payload.slice(1).map((p: any) => {
        if (p.value == null || p.dataKey === 'close') return null
        return (
          <div key={p.dataKey} className="flex justify-between gap-3 font-mono">
            <span style={{ color: p.stroke ?? p.fill ?? 'var(--color-text-faint)' }}>{p.dataKey}</span>
            <span>{typeof p.value === 'number' ? p.value.toFixed(3) : p.value}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Metric row ────────────────────────────────────────────────────────────────

function MR({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span className="text-right font-medium tabular-nums truncate"
        style={{ color: color || 'var(--color-text-primary)' }}>{value}</span>
    </>
  )
}

// ── Sidebar tab type ──────────────────────────────────────────────────────────

type SidebarTab = 'metrics' | 'positions' | 'trades'

// ── Main component ─────────────────────────────────────────────────────────────

export function SimulationLab() {
  const [searchParams] = useSearchParams()
  const prefillProgramId = searchParams.get('program_id') ?? ''

  // ── Persisted setup state ────────────────────────────────────────────────────

  const STORAGE_KEY = 'simlab_state_v3'
  function loadPersisted() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') ?? {} } catch { return {} }
  }
  const persisted = loadPersisted()

  const [sourceMode, setSourceMode] = useState<'strategy' | 'program'>(
    prefillProgramId ? 'program' : (persisted.sourceMode || 'strategy'))
  const [programId, setProgramId] = useState(prefillProgramId || persisted.programId || '')
  const [strategyId, setStrategyId] = useState(persisted.strategyId || '')
  const [versionId, setVersionId] = useState(persisted.versionId || '')
  const [symbols, setSymbols] = useState<string[]>(persisted.symbols || [])
  const [timeframe, setTimeframe] = useState(persisted.timeframe || '1d')
  const [startDate, setStartDate] = useState(persisted.startDate || jan2020)
  const [endDate, setEndDate] = useState(persisted.endDate || today)
  const [capital, setCapital] = useState(persisted.capital || 100000)
  const [provider, setProvider] = useState(persisted.provider || 'auto')
  const [selectedServiceId, setSelectedServiceId] = useState(persisted.selectedServiceId || '')

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        sourceMode, programId, strategyId, versionId, symbols,
        timeframe, startDate, endDate, capital, provider, selectedServiceId,
      }))
    } catch {}
  }, [sourceMode, programId, strategyId, versionId, symbols, timeframe, startDate, endDate, capital, provider, selectedServiceId])

  useEffect(() => {
    if (!prefillProgramId) return
    setSourceMode('program')
    setProgramId(prefillProgramId)
  }, [prefillProgramId])

  // ── Simulation runtime state ─────────────────────────────────────────────────

  const [simMeta, setSimMeta] = useState<SimulationMetadata | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'completed'>('idle')
  const [speed, setSpeed] = useState(5)
  const [error, setError] = useState('')
  const [setupOpen, setSetupOpen] = useState(true)
  const [featurePlanOpen, setFeaturePlanOpen] = useState(false)

  // Bar data
  const [barHistory, setBarHistory] = useState<BarSnapshotData[]>([])
  const [latestBar, setLatestBar] = useState<BarSnapshotData | null>(null)
  const [allEntries, setAllEntries] = useState<TradeEvent[]>([])
  const [allExits, setAllExits] = useState<TradeEvent[]>([])
  const [equityCurve, setEquityCurve] = useState<{ tms: number; equity: number; drawdown: number }[]>([])
  const [finalMetrics, setFinalMetrics] = useState<any>(null)

  // Active indicator toggles (matched against data keys)
  const [activeSpecs, setActiveSpecs] = useState<Set<string>>(new Set())
  const [indPanelOpen, setIndPanelOpen] = useState(false)

  // Sidebar tab
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('metrics')

  // Zoom state — index-based (same as ChartLab)
  const [zoomWindow, setZoomWindow] = useState<[number, number] | null>(null)
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [dragEnd, setDragEnd] = useState<number | null>(null)
  const isDragging = dragStart !== null

  const wsRef = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: strategies } = useQuery({ queryKey: ['strategies'], queryFn: () => strategiesApi.list() })
  const { data: strategyDetail } = useQuery({
    queryKey: ['strategy', strategyId],
    queryFn: () => strategiesApi.get(strategyId),
    enabled: !!strategyId,
  })
  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: () => servicesApi.list() })
  const { data: programs = [] } = useQuery({ queryKey: ['programs'], queryFn: () => programsApi.list() })

  const alpacaServices = (services as any[]).filter((s) => s.provider === 'alpaca' && s.has_credentials)
  useEffect(() => {
    if (!selectedServiceId && alpacaServices.length === 1) setSelectedServiceId(alpacaServices[0].id)
  }, [alpacaServices, selectedServiceId])

  const versions = (strategyDetail as any)?.versions ?? []
  useEffect(() => {
    if (versions.length > 0 && !versionId) setVersionId(versions[0].id)
  }, [versions, versionId])

  // ── Timeframe helpers ────────────────────────────────────────────────────────

  const isIntraday = useMemo(() => ['1m', '5m', '15m', '30m', '1h', '4h'].includes(timeframe), [timeframe])

  const makeBarKey = useCallback((raw: string): string => {
    if (isIntraday) return raw.slice(0, 19)
    return raw.split(' ')[0] || raw.slice(0, 10)
  }, [isIntraday])

  // ── WS handler ───────────────────────────────────────────────────────────────

  const handleWsMessage = useCallback((event: MessageEvent) => {
    if (!mountedRef.current) return
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'bar') {
        const bar: BarSnapshotData = msg.data
        setLatestBar(bar)
        setBarHistory((prev) => [...prev, bar])  // no cap — full history
        setEquityCurve((prev) => [
          ...prev,
          { tms: new Date(bar.timestamp).getTime(), equity: bar.equity, drawdown: bar.drawdown },
        ])
        if (bar.entries?.length > 0) setAllEntries((prev) => [...prev, ...bar.entries])
        if (bar.exits?.length > 0) setAllExits((prev) => [...prev, ...bar.exits])
      } else if (msg.type === 'completed') {
        setStatus('completed')
        setFinalMetrics(msg.data)
      } else if (msg.type === 'status') {
        if (msg.status === 'playing') setStatus('playing')
        else if (msg.status === 'paused') setStatus('paused')
      } else if (msg.type === 'equity_catchup') {
        const curve = (msg.data || []).map((p: any) => ({
          tms: new Date(p.date).getTime(), equity: p.equity, drawdown: p.drawdown,
        }))
        setEquityCurve(curve)
      } else if (msg.type === 'init') {
        setStatus('ready')
      } else if (msg.type === 'error') {
        setError(msg.message)
      }
    } catch (e) {
      console.error('[SimLab] WS parse error:', e)
    }
  }, [])

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (sourceMode === 'strategy') {
      if (!strategyId) { setError('Select a strategy first'); return }
      if (!versionId) { setError('Select a strategy version'); return }
    } else {
      if (!programId) { setError('Select a program'); return }
    }
    if (sourceMode === 'strategy' && !symbols.length) { setError('Select at least one symbol'); return }
    if (!timeframe) { setError('Select a timeframe'); return }
    if (!startDate || !endDate) { setError('Select start and end dates'); return }
    if ((provider === 'alpaca' || provider === 'auto') && alpacaServices.length && !selectedServiceId) {
      setError('Select an Alpaca service account'); return
    }

    setError('')
    setStatus('loading')
    setBarHistory([]); setLatestBar(null); setAllEntries([]); setAllExits([])
    setEquityCurve([]); setFinalMetrics(null); setZoomWindow(null)
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }

    try {
      let alpacaKey = '', alpacaSecret = ''
      if ((provider === 'alpaca' || provider === 'auto') && selectedServiceId) {
        const svc = alpacaServices.find((s: any) => s.id === selectedServiceId)
        if (svc) { alpacaKey = svc.api_key; alpacaSecret = svc.secret_key }
      }

      const meta = await simulationsApi.create({
        ...(sourceMode === 'program' ? { program_id: programId } : { strategy_version_id: versionId }),
        symbols, timeframe,
        start_date: startDate, end_date: endDate,
        initial_capital: capital, data_provider: provider,
        alpaca_api_key: alpacaKey || undefined,
        alpaca_secret_key: alpacaSecret || undefined,
      })
      if (!mountedRef.current) return
      setSimMeta(meta)
      setSetupOpen(false)  // auto-collapse setup after successful init

      if (meta.provider) {
        setError(`Provider: ${meta.provider}${meta.date_clamped ? ' (date range clamped)' : ''}`)
      }

      // Auto-activate indicators that are present in the first bar's data
      // We'll resolve these when the first bar arrives — for now seed from meta.indicators
      if (meta.indicators?.length) {
        const initial = new Set<string>()
        for (const k of (meta.indicators as string[])) {
          if (KEY_TO_DEF[k]) initial.add(KEY_TO_DEF[k].spec)
        }
        setActiveSpecs(initial)
      }

      const ws = createSimulationWs(meta.simulation_id)
      ws.onopen = () => console.log('[SimLab] WS connected')
      ws.onmessage = handleWsMessage
      ws.onerror = () => {
        if (mountedRef.current) setError('WebSocket connection failed')
      }
      ws.onclose = () => {
        if (mountedRef.current && wsRef.current === ws) {
          if (status === 'playing') setError('Connection lost — simulation paused')
          setStatus((prev) => prev === 'playing' ? 'paused' : prev)
        }
      }
      wsRef.current = ws
    } catch (e: any) {
      if (mountedRef.current) { setError(e.message || 'Failed to create simulation'); setStatus('idle') }
    }
  }

  const sendWs = (cmd: Record<string, any>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(cmd))
  }

  const handlePlay = () => { sendWs({ action: 'set_speed', speed }); sendWs({ action: 'play' }); setStatus('playing') }
  const handlePause = () => { sendWs({ action: 'pause' }); setStatus('paused') }
  const handleStep = () => { sendWs({ action: 'step' }); setStatus('paused') }
  const handleSkipToTrade = () => sendWs({ action: 'skip_to_trade' })
  const handleFinalize = () => sendWs({ action: 'finalize' })
  const handleSpeedChange = (v: string) => { const s = parseFloat(v); setSpeed(s); sendWs({ action: 'set_speed', speed: s }) }

  const handleReset = () => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    setStatus('idle'); setSimMeta(null); setBarHistory([]); setLatestBar(null)
    setAllEntries([]); setAllExits([]); setEquityCurve([]); setFinalMetrics(null)
    setError(''); setZoomWindow(null); setSetupOpen(true)
  }

  useEffect(() => () => { if (wsRef.current) wsRef.current.close() }, [])

  // ── Chart data ───────────────────────────────────────────────────────────────

  const activeSymbols = useMemo(
    () => (simMeta?.symbols?.length ? simMeta.symbols : symbols),
    [simMeta?.symbols, symbols],
  )
  const primarySymbol = activeSymbols[0] || ''

  const entryMap = useMemo(() => {
    const m = new Map<string, TradeEvent>()
    for (const e of allEntries) if (e.symbol === primarySymbol && e.entry_time) m.set(makeBarKey(e.entry_time), e)
    return m
  }, [allEntries, primarySymbol, makeBarKey])

  const exitMap = useMemo(() => {
    const m = new Map<string, TradeEvent>()
    for (const e of allExits) if (e.symbol === primarySymbol && e.exit_time) m.set(makeBarKey(e.exit_time), e)
    return m
  }, [allExits, primarySymbol, makeBarKey])

  // Build rows with tms numeric timestamps (matches ChartLab)
  const rows = useMemo(() => {
    return barHistory.map((b) => {
      const sym = b.symbols[primarySymbol]
      if (!sym) return null
      const barKey = makeBarKey(b.timestamp)
      const entry = entryMap.get(barKey)
      const exit = exitMap.get(barKey)
      const tms = new Date(b.timestamp).getTime()
      return {
        tms,
        open: sym.open, high: sym.high, low: sym.low, close: sym.close, volume: sym.volume,
        ...Object.fromEntries(
          Object.entries(sym).filter(([k]) => !['open', 'high', 'low', 'close', 'volume', 'regime'].includes(k))
        ),
        _entry: !!entry,
        _entryPrice: entry?.entry_price,
        _exit: !!exit,
        _exitPrice: exit?.exit_price,
        _exitPnl: exit?.net_pnl ?? 0,
      }
    }).filter(Boolean) as any[]
  }, [barHistory, primarySymbol, entryMap, exitMap, makeBarKey])

  // Visible slice
  const visibleRows = useMemo(() => {
    if (!zoomWindow) return rows
    return rows.slice(zoomWindow[0], zoomWindow[1] + 1)
  }, [rows, zoomWindow])

  // Price domain with 5% padding
  const visiblePriceDomain = useMemo(() => {
    if (!visibleRows.length) return ['auto', 'auto'] as ['auto', 'auto']
    const prices = visibleRows.flatMap((r: any) => [r.high, r.low])
    const mn = Math.min(...prices), mx = Math.max(...prices)
    const pad = (mx - mn) * 0.05
    return [Math.floor((mn - pad) * 100) / 100, Math.ceil((mx + pad) * 100) / 100] as [number, number]
  }, [visibleRows])

  // Thin equity for smooth area chart
  const thinEquity = useMemo(() => {
    if (equityCurve.length <= 500) return equityCurve
    const step = Math.ceil(equityCurve.length / 500)
    return equityCurve.filter((_, i) => i % step === 0 || i === equityCurve.length - 1)
  }, [equityCurve])

  // Determine which indicator keys are present in the live data
  const availableDataKeys = useMemo(() => {
    if (!rows[0]) return new Set<string>()
    const skip = new Set(['tms', 'open', 'high', 'low', 'close', 'volume', '_entry', '_entryPrice', '_exit', '_exitPrice', '_exitPnl'])
    return new Set(Object.keys(rows[0]).filter(k => !skip.has(k) && (rows[0] as any)[k] != null))
  }, [rows])

  // Active indicator defs split by pane
  const { priceIndicators, oscIndicators } = useMemo(() => {
    const price: IndicatorDef[] = []
    const osc: IndicatorDef[] = []
    const seen = new Set<string>()
    for (const spec of activeSpecs) {
      const def = ALL_INDICATORS.find(d => d.spec === spec)
      if (!def || seen.has(def.spec)) continue
      // Only show if any of its keys are present in the data
      const keys = def.produces ?? [def.spec]
      if (!keys.some(k => availableDataKeys.has(k))) continue
      seen.add(def.spec)
      if (def.pane === 'price') price.push(def)
      else osc.push(def)
    }
    return { priceIndicators: price, oscIndicators: osc }
  }, [activeSpecs, availableDataKeys])

  // ── Zoom helpers ─────────────────────────────────────────────────────────────

  const commitZoomIndices = useCallback((i1: number, i2: number) => {
    const offset = zoomWindow ? zoomWindow[0] : 0
    const a = offset + i1, b = offset + i2
    if (a === b) return
    const lo = Math.min(a, b), hi = Math.max(a, b)
    if (hi - lo < 2) return
    setZoomWindow([lo, hi])
  }, [zoomWindow])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const total = rows.length
    if (!total) return
    const [lo, hi] = zoomWindow ?? [0, total - 1]
    const factor = e.deltaY > 0 ? 1.15 : 0.87
    const newVis = Math.round(Math.min(Math.max((hi - lo) * factor, 10), total))
    const center = Math.round((lo + hi) / 2)
    const nLo = Math.max(0, center - Math.floor(newVis / 2))
    const nHi = Math.min(total - 1, nLo + newVis)
    if (nHi - nLo < 2) return
    setZoomWindow([nLo, nHi])
  }, [rows, zoomWindow])

  const handleZoomIn = () => {
    const total = rows.length
    if (total < 10) return
    const [lo, hi] = zoomWindow ?? [0, total - 1]
    const newVis = Math.max(10, Math.round((hi - lo) * 0.6))
    const center = Math.round((lo + hi) / 2)
    const nLo = Math.max(0, center - Math.floor(newVis / 2))
    setZoomWindow([nLo, Math.min(total - 1, nLo + newVis)])
  }

  const handleZoomOut = () => {
    const total = rows.length
    if (!total || !zoomWindow) return
    const [lo, hi] = zoomWindow
    const newVis = Math.min(total, Math.round((hi - lo) * 1.6))
    const center = Math.round((lo + hi) / 2)
    const nLo = Math.max(0, center - Math.floor(newVis / 2))
    const nHi = Math.min(total - 1, nLo + newVis)
    if (nHi - nLo >= total - 2) setZoomWindow(null)
    else setZoomWindow([nLo, nHi])
  }

  // ── Trade log — full, sorted newest-first ────────────────────────────────────

  const tradeLog = useMemo(() => {
    const items: Array<TradeEvent & { _type: 'entry' | 'exit' }> = [
      ...allEntries.map((e) => ({ ...e, _type: 'entry' as const })),
      ...allExits.map((e) => ({ ...e, _type: 'exit' as const })),
    ]
    items.sort((a, b) => {
      const ta = a._type === 'exit' ? (a.exit_time ?? '') : (a.entry_time ?? '')
      const tb = b._type === 'exit' ? (b.exit_time ?? '') : (b.entry_time ?? '')
      return tb.localeCompare(ta)
    })
    return items  // no slice — full history
  }, [allEntries, allExits])

  // ── Derived state ─────────────────────────────────────────────────────────────

  const isSetupMode = status === 'idle' || status === 'loading'
  const isZoomed = zoomWindow !== null
  const zoomBarCount = isZoomed ? (zoomWindow![1] - zoomWindow![0] + 1) : rows.length

  const pxColor = (v: number) => v >= 0 ? 'var(--color-success)' : 'var(--color-danger)'

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col gap-0" style={{ minHeight: 0 }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
            Simulation Lab<PageHelp page="simlab" />
          </h1>
          {simMeta && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              <span style={{ color: 'var(--color-accent)' }}>{simMeta.strategy_name}</span>
              <span className="opacity-40">·</span>
              <span>{activeSymbols.join(', ')}</span>
              <span className="opacity-40">·</span>
              <span>{timeframe}</span>
              {latestBar && (
                <>
                  <span className="opacity-40">·</span>
                  <span className="tabular-nums">
                    {(latestBar.bar_num + 1).toLocaleString()} / {latestBar.total_bars.toLocaleString()} bars
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Setup toggle button — only when simulation is running */}
          {!isSetupMode && (
            <button
              className="btn-ghost text-xs flex items-center gap-1 py-1 px-2"
              onClick={() => setSetupOpen(o => !o)}
            >
              <Settings size={11} />
              Setup
              {setupOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
          )}

          {!isSetupMode && (
            <button className="btn-sm text-xs flex items-center gap-1" onClick={handleReset}>
              <RotateCcw size={12} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* ── Error / info banner ─────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs flex-shrink-0"
          style={{
            backgroundColor: error.startsWith('Provider:') ? 'rgba(56,189,248,0.08)' : 'rgba(239,68,68,0.12)',
            color: error.startsWith('Provider:') ? 'var(--color-text-secondary)' : '#f87171',
            borderBottom: '1px solid var(--color-border)',
          }}>
          {!error.startsWith('Provider:') && <AlertTriangle size={12} />}
          <span>{error}</span>
          <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => setError('')}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Collapsible setup drawer ─────────────────────────────────────────── */}
      {(isSetupMode || setupOpen) && (
        <div className="flex-shrink-0 border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="p-4 space-y-4 max-w-5xl">

            {/* Source toggle */}
            <div className="flex gap-1 rounded border border-gray-700 bg-gray-900/60 p-0.5 w-fit">
              {(['strategy', 'program'] as const).map((mode) => (
                <button key={mode} onClick={() => setSourceMode(mode)}
                  className={clsx('px-3 py-1 rounded text-xs font-medium transition-colors',
                    sourceMode === mode ? 'bg-sky-600 text-white' : 'text-gray-400 hover:text-gray-200')}>
                  {mode === 'strategy' ? 'Strategy Version' : 'Program'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* Strategy/Program picker */}
              {sourceMode === 'strategy' ? (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Strategy</label>
                    <SelectMenu value={strategyId} onChange={(v) => { setStrategyId(v); setVersionId('') }}
                      options={(strategies || []).map((s: any) => ({ value: s.id, label: s.name }))}
                      placeholder="Select strategy..." />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Version</label>
                    <SelectMenu value={versionId} onChange={setVersionId}
                      options={versions.map((v: any) => ({
                        value: v.id,
                        label: `v${v.version} — ${v.duration_mode || 'swing'}${v.notes ? ' (' + v.notes.slice(0, 24) + ')' : ''}`,
                      }))}
                      placeholder={strategyId ? (versions.length === 0 ? 'Loading...' : 'Select version...') : 'Pick a strategy first'} />
                  </div>
                </>
              ) : (
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Program</label>
                  <SelectMenu value={programId} onChange={setProgramId}
                    options={(programs as any[]).map((p) => ({ value: p.id, label: `${p.name} v${p.version}` }))}
                    placeholder="Select a saved program..." />
                </div>
              )}

              {/* Symbols */}
              <div className="space-y-1 col-span-2 md:col-span-1">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Symbols</label>
                <TickerSearch selected={symbols} onChange={setSymbols} />
              </div>

              {/* Timeframe */}
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Timeframe</label>
                <SelectMenu value={timeframe} onChange={setTimeframe} options={timeframeOptions} />
              </div>

              {/* Start date */}
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Start</label>
                <DatePickerInput value={startDate} onChange={setStartDate} />
              </div>

              {/* End date */}
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>End</label>
                <DatePickerInput value={endDate} onChange={setEndDate} />
              </div>

              {/* Capital */}
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Capital</label>
                <input type="number" className="input w-full" value={capital}
                  onChange={(e) => setCapital(Number(e.target.value))} />
              </div>

              {/* Provider */}
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Data Provider</label>
                <SelectMenu value={provider} onChange={setProvider} options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'yfinance', label: 'Yahoo Finance' },
                  { value: 'alpaca', label: 'Alpaca' },
                ]} />
              </div>

              {/* Alpaca service */}
              {(provider === 'alpaca' || provider === 'auto') && alpacaServices.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Alpaca Account</label>
                  <SelectMenu value={selectedServiceId} onChange={setSelectedServiceId}
                    options={alpacaServices.map((s: any) => ({ value: s.id, label: s.name || s.id.slice(0, 8) }))}
                    placeholder="Select account..." />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {!isSetupMode && (
                <button className="btn-sm text-xs" onClick={() => setSetupOpen(false)}>Cancel</button>
              )}
              <button className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
                onClick={handleCreate} disabled={status === 'loading'}>
                {status === 'loading'
                  ? <><Loader size={14} className="animate-spin" /> Loading data &amp; indicators…</>
                  : <><Play size={14} /> Initialize Simulation</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Simulation view ──────────────────────────────────────────────────── */}
      {!isSetupMode && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

          {/* Controls bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0 flex-wrap"
            style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>

            {/* Transport */}
            <div className="flex items-center gap-0.5">
              {status === 'playing' ? (
                <button className="btn-sm" onClick={handlePause} title="Pause"><Pause size={13} /></button>
              ) : (
                <button className="btn-sm btn-primary" onClick={handlePlay} title="Play" disabled={status === 'completed'}>
                  <Play size={13} />
                </button>
              )}
              <button className="btn-sm" onClick={handleStep} title="Step" disabled={status === 'completed' || status === 'playing'}>
                <ChevronRight size={13} />
              </button>
              <button className="btn-sm" onClick={handleSkipToTrade} title="Skip to next trade" disabled={status === 'completed' || status === 'playing'}>
                <SkipForward size={13} />
              </button>
              <button className="btn-sm" onClick={handleFinalize} title="Run to end" disabled={status === 'completed'}>
                <FastForward size={13} />
              </button>
            </div>

            <div className="h-4 w-px flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />

            {/* Speed */}
            <div className="flex items-center gap-1">
              {speedOptions.map((opt) => (
                <button key={opt.value}
                  className={clsx('text-xs px-1.5 py-0.5 rounded transition-all',
                    speed === parseFloat(opt.value) ? 'btn-primary' : 'btn-sm')}
                  onClick={() => handleSpeedChange(opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="h-4 w-px flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />

            {/* Progress */}
            {latestBar && (
              <div className="flex items-center gap-2 min-w-[100px] flex-1">
                <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
                  <div className="h-full rounded-full transition-all duration-150"
                    style={{ width: `${latestBar.progress_pct}%`, backgroundColor: 'var(--color-accent)' }} />
                </div>
                <span className="text-xs tabular-nums flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                  {latestBar.progress_pct.toFixed(0)}%
                </span>
              </div>
            )}

            {/* Status badge */}
            <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0',
              status === 'playing'   && 'bg-green-900/40 text-green-400',
              status === 'paused'    && 'bg-yellow-900/40 text-yellow-400',
              status === 'completed' && 'bg-blue-900/40 text-blue-400',
              status === 'ready'     && 'bg-gray-800 text-gray-400',
            )}>
              {status}
            </span>

            <div className="h-4 w-px flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />

            {/* Zoom controls */}
            <div className="flex items-center gap-0.5">
              <button className="btn-sm" onClick={handleZoomIn} title="Zoom in"><ZoomIn size={13} /></button>
              <button className="btn-sm" onClick={handleZoomOut} title="Zoom out"><ZoomOut size={13} /></button>
              {isZoomed && (
                <button className="btn-sm text-xs px-2"
                  onClick={() => { setZoomWindow(null); setDragStart(null); setDragEnd(null) }}
                  style={{ color: 'var(--color-accent)' }}>
                  {zoomBarCount} bars ↺
                </button>
              )}
            </div>

            {/* Indicator panel toggle */}
            <button className="btn-ghost text-xs flex items-center gap-1 py-1 px-2 ml-auto"
              onClick={() => setIndPanelOpen(o => !o)}>
              <Activity size={11} />
              Studies
              {activeSpecs.size > 0 && (
                <span className="px-1 rounded text-[10px]"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 20%, transparent)', color: 'var(--color-accent)' }}>
                  {activeSpecs.size}
                </span>
              )}
              {indPanelOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
          </div>

          {/* Indicator panel — only shows indicators present in the simulation data */}
          {indPanelOpen && (
            <div className="flex-shrink-0 px-3 py-2"
              style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }}>
              {availableDataKeys.size === 0 ? (
                <p className="text-xs" style={{ color: 'var(--color-text-faint)' }}>
                  No indicators in data yet — start the simulation to see available studies.
                </p>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {INDICATOR_GROUPS.map(group => {
                    const availableItems = group.items.filter(ind =>
                      (ind.produces ?? [ind.spec]).some(k => availableDataKeys.has(k))
                    )
                    if (!availableItems.length) return null
                    return (
                      <div key={group.group} className="min-w-[130px]">
                        <div className="text-[10px] uppercase tracking-wide mb-1.5 font-semibold"
                          style={{ color: 'var(--color-text-faint)' }}>
                          {group.group}
                        </div>
                        <div className="space-y-0.5">
                          {availableItems.map(ind => {
                            const on = activeSpecs.has(ind.spec)
                            return (
                              <button key={ind.spec} type="button"
                                onClick={() => setActiveSpecs(prev => {
                                  const next = new Set(prev)
                                  on ? next.delete(ind.spec) : next.add(ind.spec)
                                  return next
                                })}
                                className="flex items-center gap-1.5 w-full text-left px-2 py-1 rounded text-xs transition-all"
                                style={{
                                  background: on ? `color-mix(in srgb, ${ind.color} 18%, transparent)` : 'transparent',
                                  border: `1px solid ${on ? ind.color : 'var(--color-border)'}`,
                                  color: on ? ind.color : 'var(--color-text-faint)',
                                }}
                              >
                                <span className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ background: on ? ind.color : 'var(--color-border)' }} />
                                {ind.label}
                                <span className="ml-auto text-[9px] opacity-50">
                                  {ind.pane === 'price' ? 'P' : 'O'}
                                </span>
                                {on && <X size={9} className="flex-shrink-0" style={{ color: ind.color }} />}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Feature plan (collapsible) */}
          {simMeta?.feature_plan_preview && (
            <div className="flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <button
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs"
                style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}
                onClick={() => setFeaturePlanOpen(o => !o)}
              >
                <span className="flex items-center gap-2">
                  <span style={{ color: 'var(--color-accent)' }}>Feature Engine</span>
                  <span>{simMeta.feature_plan_preview.features.length} features</span>
                  <span className="opacity-50">·</span>
                  <span>warmup: {Object.values(simMeta.feature_plan_preview.warmup_bars_by_timeframe).reduce((a: number, b: any) => a + b, 0)} bars</span>
                </span>
                {featurePlanOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {featurePlanOpen && (
                <div className="px-3 py-3 grid gap-3 xl:grid-cols-2"
                  style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                  <div className="rounded-lg border p-3 space-y-1.5" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
                      Planned Features
                    </div>
                    {simMeta.feature_plan_preview.features.map((f: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1 border-b last:border-0"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
                        <span>{f.kind}{Object.keys(f.params || {}).length > 0 ? ` (${Object.entries(f.params).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}</span>
                        <span style={{ color: 'var(--color-text-faint)' }}>{f.timeframe}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border p-3 space-y-1.5" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                      Warm-Up by Frame
                    </div>
                    {Object.entries(simMeta.feature_plan_preview.warmup_bars_by_timeframe).map(([frame, bars]: [string, any]) => (
                      <div key={frame} className="flex justify-between text-xs">
                        <span style={{ color: 'var(--color-text-secondary)' }}>{frame}</span>
                        <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{bars} bars</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Main body — chart + sidebar */}
          <div className="flex-1 flex min-h-0 overflow-hidden">

            {/* LEFT: Charts ──────────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0" style={{ gap: 0 }}>

              {/* Chart header: symbol · OHLC · indicators */}
              <div className="flex items-center justify-between px-3 py-1 flex-shrink-0"
                style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="font-bold" style={{ color: 'var(--color-success)' }}>{primarySymbol}</span>
                  {activeSymbols.length > 1 && (
                    <span style={{ color: 'var(--color-text-tertiary)' }}>+{activeSymbols.length - 1}</span>
                  )}
                  <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{timeframe}</span>
                  {priceIndicators.map((ind, i) => (
                    <span key={ind.spec} className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{ backgroundColor: ind.color + '22', color: ind.color }}>
                      {ind.label}
                    </span>
                  ))}
                </div>

                {latestBar?.symbols[primarySymbol] && (
                  <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                    <span style={{ color: 'var(--color-text-tertiary)' }}>O</span>
                    <span>{(latestBar.symbols[primarySymbol]?.open as number)?.toFixed(2)}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>H</span>
                    <span style={{ color: 'var(--color-success)' }}>{(latestBar.symbols[primarySymbol]?.high as number)?.toFixed(2)}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>L</span>
                    <span style={{ color: 'var(--color-danger)' }}>{(latestBar.symbols[primarySymbol]?.low as number)?.toFixed(2)}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>C</span>
                    <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {(latestBar.symbols[primarySymbol]?.close as number)?.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {/* Strategy info bar — reads from simMeta, not hardcoded */}
              {simMeta && (
                <div className="px-3 py-1 flex items-center gap-2 text-[10px] font-mono flex-shrink-0"
                  style={{ backgroundColor: 'var(--color-bg-tertiary)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>
                  <span style={{ color: 'var(--color-accent)' }}>STRATEGY</span>
                  <span>{simMeta.strategy_name}</span>
                  {simMeta.timeframe && (
                    <>
                      <span className="opacity-40">·</span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{simMeta.timeframe}</span>
                    </>
                  )}
                  {simMeta.start_date && simMeta.end_date && (
                    <>
                      <span className="opacity-40">·</span>
                      <span>{simMeta.start_date} → {simMeta.end_date}</span>
                    </>
                  )}
                  {latestBar && (
                    <>
                      <span className="opacity-40">·</span>
                      <span style={{ color: latestBar.total_return_pct >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        {latestBar.total_return_pct >= 0 ? '+' : ''}{latestBar.total_return_pct.toFixed(2)}%
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* ── Chart panes — flex-1 gives a concrete height for %-based flex-basis ── */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ gap: 0 }}>

              {/* ── Price pane (55%) ─────────────────────────────────────────── */}
              <div style={{ flex: '0 0 55%', minHeight: 220, position: 'relative' }} onWheel={handleWheel}>
                <div className="text-[10px] uppercase tracking-wide px-2 pt-1 flex items-center gap-2"
                  style={{ color: 'var(--color-text-faint)' }}>
                  <span>{primarySymbol} · Price</span>
                  {isZoomed && (
                    <span style={{ color: 'var(--color-accent)' }}>· {zoomBarCount} bars zoomed</span>
                  )}
                </div>
                <ResponsiveContainer width="100%" height="calc(100% - 18px)">
                  <ComposedChart data={visibleRows} margin={{ top: 4, right: 60, bottom: 0, left: 0 }}
                    onMouseDown={(e: any) => typeof e?.activeTooltipIndex === 'number' && setDragStart(e.activeTooltipIndex)}
                    onMouseMove={(e: any) => isDragging && typeof e?.activeTooltipIndex === 'number' && setDragEnd(e.activeTooltipIndex)}
                    onMouseUp={() => {
                      if (dragStart !== null && dragEnd !== null) commitZoomIndices(dragStart, dragEnd)
                      setDragStart(null); setDragEnd(null)
                    }}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="1 4" opacity={0.2} />
                    <XAxis dataKey="tms" type="number" domain={['dataMin', 'dataMax']}
                      tick={{ fontSize: 9, fill: 'var(--color-text-tertiary)' }} tickLine={false}
                      tickFormatter={(v: number) => fmtTs(v, timeframe)} />
                    <YAxis yAxisId="price" orientation="right" domain={visiblePriceDomain}
                      tick={{ fontSize: 9, fill: 'var(--color-text-secondary)', fontFamily: 'monospace' }}
                      tickLine={false} width={58} tickFormatter={(v: number) => v.toFixed(2)} />
                    <Tooltip content={<SimTooltip tf={timeframe} />}
                      cursor={{ stroke: 'var(--color-text-faint)', strokeDasharray: '3 3', strokeWidth: 1 }} />

                    {/* Invisible close line to anchor Y axis domain */}
                    <Line yAxisId="price" type="monotone" dataKey="close" stroke="transparent"
                      dot={false} isAnimationActive={false} legendType="none" />

                    {/* TOS-style candlesticks — theme-aware colors */}
                    <Customized component={CandlestickLayer} />

                    {/* Price-overlay indicators */}
                    {priceIndicators.map(ind => {
                      const keys = ind.produces ?? [ind.spec]
                      return keys.map((k, ki) => (
                        <Line key={k} yAxisId="price" type="monotone" dataKey={k}
                          stroke={ind.color} strokeWidth={ki === 0 ? 1.5 : 1}
                          strokeDasharray={ind.dash ?? (k.includes('upper') || k.includes('lower') ? '3 3' : undefined)}
                          strokeOpacity={ki === 0 ? 1 : 0.7}
                          dot={false} isAnimationActive={false} connectNulls />
                      ))
                    })}

                    {/* Open position reference lines */}
                    {latestBar?.open_positions?.filter(p => p.symbol === primarySymbol && p.stop_price).map((p, i) => (
                      <ReferenceLine key={`stop-${i}`} yAxisId="price" y={p.stop_price!}
                        stroke="var(--color-danger)" strokeDasharray="6 3" strokeWidth={1.5}
                        label={{ value: `SL ${p.stop_price?.toFixed(2)}`, position: 'right', fontSize: 9, fill: 'var(--color-danger)', fontFamily: 'monospace' }} />
                    ))}
                    {latestBar?.open_positions?.filter(p => p.symbol === primarySymbol).flatMap(p =>
                      (p.target_prices || []).map((tp: number, i: number) => (
                        <ReferenceLine key={`tgt-${p.trade_id}-${i}`} yAxisId="price" y={tp}
                          stroke="var(--color-success)" strokeDasharray="4 4" strokeWidth={1}
                          label={{ value: `T${i + 1} ${tp.toFixed(2)}`, position: 'right', fontSize: 9, fill: 'var(--color-success)', fontFamily: 'monospace' }} />
                      ))
                    )}
                    {latestBar?.open_positions?.filter(p => p.symbol === primarySymbol).map((p, i) => (
                      <ReferenceLine key={`entry-${i}`} yAxisId="price" y={p.avg_entry}
                        stroke="#fbbf24" strokeDasharray="2 4" strokeWidth={1} opacity={0.7}
                        label={{ value: `Avg ${p.avg_entry.toFixed(2)}`, position: 'right', fontSize: 8, fill: '#fbbf24', fontFamily: 'monospace' }} />
                    ))}

                    {/* Drag-to-zoom highlight */}
                    {isDragging && dragStart !== null && dragEnd !== null &&
                      visibleRows[dragStart] && visibleRows[dragEnd] && (
                        <ReferenceArea
                          x1={(visibleRows[dragStart] as any).tms}
                          x2={(visibleRows[dragEnd] as any).tms}
                          strokeOpacity={0.3} fill="var(--color-accent)" fillOpacity={0.12} />
                      )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* ── Volume pane (10%) ─────────────────────────────────────────── */}
              <div style={{ flex: '0 0 10%', minHeight: 36 }}>
                <div className="text-[10px] px-2 pt-0.5 uppercase tracking-wide"
                  style={{ color: 'var(--color-text-faint)' }}>Volume</div>
                <ResponsiveContainer width="100%" height="calc(100% - 16px)">
                  <BarChart data={visibleRows} margin={{ top: 0, right: 60, bottom: 0, left: 0 }}>
                    <XAxis dataKey="tms" type="number" domain={['dataMin', 'dataMax']} hide />
                    <YAxis orientation="right" tick={{ fontSize: 8, fill: 'var(--color-text-faint)' }}
                      tickLine={false} width={58}
                      tickFormatter={(v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                    <Bar dataKey="volume" isAnimationActive={false}>
                      {visibleRows.map((r: any, i: number) => (
                        <Cell key={i}
                          fill={r.close >= r.open ? 'var(--color-success)' : 'var(--color-danger)'}
                          fillOpacity={0.45} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* ── Oscillator pane (25%) — only when oscillator indicators active ── */}
              {oscIndicators.length > 0 && (
                <div style={{ flex: '0 0 25%', minHeight: 80 }}>
                  <div className="text-[10px] px-2 pt-0.5 uppercase tracking-wide"
                    style={{ color: 'var(--color-text-faint)' }}>
                    {oscIndicators.map(i => i.label).join(' · ')}
                  </div>
                  <ResponsiveContainer width="100%" height="calc(100% - 16px)">
                    <ComposedChart data={visibleRows} margin={{ top: 4, right: 60, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.3} />
                      <XAxis dataKey="tms" type="number" domain={['dataMin', 'dataMax']}
                        tick={{ fontSize: 9, fill: 'var(--color-text-faint)' }} tickLine={false}
                        tickFormatter={(v: number) => fmtTs(v, timeframe)} />
                      <YAxis orientation="right" tick={{ fontSize: 9, fill: 'var(--color-text-faint)' }}
                        tickLine={false} width={58} />
                      <Tooltip content={<SimTooltip tf={timeframe} />}
                        cursor={{ stroke: 'var(--color-text-faint)', strokeDasharray: '3 3', strokeWidth: 1 }} />

                      {/* Reference levels */}
                      {oscIndicators.some(i => i.spec.startsWith('rsi')) && (
                        <>
                          <ReferenceLine y={70} stroke="var(--color-danger)"   strokeDasharray="4 2" strokeOpacity={0.5} />
                          <ReferenceLine y={50} stroke="var(--color-border)"   strokeDasharray="2 2" strokeOpacity={0.4} />
                          <ReferenceLine y={30} stroke="var(--color-success)"  strokeDasharray="4 2" strokeOpacity={0.5} />
                        </>
                      )}
                      {oscIndicators.some(i => i.spec === 'stoch_k') && (
                        <>
                          <ReferenceLine y={80} stroke="var(--color-danger)"  strokeDasharray="4 2" strokeOpacity={0.5} />
                          <ReferenceLine y={20} stroke="var(--color-success)" strokeDasharray="4 2" strokeOpacity={0.5} />
                        </>
                      )}
                      {oscIndicators.some(i => ['zscore', 'bt_snipe'].includes(i.spec)) && (
                        <>
                          <ReferenceLine y={2}  stroke="var(--color-danger)"  strokeDasharray="4 2" strokeOpacity={0.5} />
                          <ReferenceLine y={-2} stroke="var(--color-success)" strokeDasharray="4 2" strokeOpacity={0.5} />
                          <ReferenceLine y={0}  stroke="var(--color-border)"  strokeDasharray="2 2" strokeOpacity={0.4} />
                        </>
                      )}
                      {oscIndicators.some(i => i.spec === 'macd') && (
                        <ReferenceLine y={0} stroke="var(--color-border)" strokeDasharray="2 2" strokeOpacity={0.5} />
                      )}
                      {oscIndicators.some(i => i.spec === 'ibs') && (
                        <>
                          <ReferenceLine y={0.8} stroke="var(--color-danger)"  strokeDasharray="4 2" strokeOpacity={0.5} />
                          <ReferenceLine y={0.5} stroke="var(--color-border)"  strokeDasharray="2 2" strokeOpacity={0.4} />
                          <ReferenceLine y={0.2} stroke="var(--color-success)" strokeDasharray="4 2" strokeOpacity={0.5} />
                        </>
                      )}

                      {/* MACD histogram */}
                      {activeSpecs.has('macd') && (
                        <Bar dataKey="macd_hist" isAnimationActive={false} opacity={0.6}>
                          {visibleRows.map((r: any, i: number) => (
                            <Cell key={i} fill={(r.macd_hist ?? 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)'} />
                          ))}
                        </Bar>
                      )}

                      {/* Oscillator lines */}
                      {oscIndicators.map(ind => {
                        const keys = (ind.produces ?? [ind.spec]).filter(k => k !== 'macd_hist')
                        const colorOverrides: Record<string, string> = {
                          macd_signal: '#f472b6',
                          plus_di: 'var(--color-success)',
                          minus_di: 'var(--color-danger)',
                          stoch_d: '#fb923c',
                        }
                        return keys.map((k, ki) => (
                          <Line key={k} type="monotone" dataKey={k}
                            stroke={colorOverrides[k] ?? ind.color}
                            strokeWidth={ki === 0 ? 1.5 : 1}
                            dot={false} isAnimationActive={false} connectNulls
                            strokeOpacity={ki === 0 ? 1 : 0.75}
                            strokeDasharray={ki > 0 ? '4 2' : undefined} />
                        ))
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* ── Equity strip (remaining space, min 10%) ──────────────────── */}
              <div style={{ flex: '1 0 10%', minHeight: 60, borderTop: '1px solid var(--color-border)' }}>
                <div className="px-2 py-0.5 text-[10px] font-mono flex items-center gap-3"
                  style={{ color: 'var(--color-text-tertiary)' }}>
                  <span>EQUITY</span>
                  {latestBar && (
                    <>
                      <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        ${latestBar.equity.toLocaleString()}
                      </span>
                      <span style={{ color: pxColor(latestBar.total_return_pct) }}>
                        {latestBar.total_return_pct >= 0 ? '+' : ''}{latestBar.total_return_pct.toFixed(2)}%
                      </span>
                      <span>DD {(latestBar.drawdown * 100).toFixed(2)}%</span>
                    </>
                  )}
                </div>
                <ResponsiveContainer width="100%" height="calc(100% - 20px)">
                  <AreaChart data={thinEquity} margin={{ top: 0, right: 60, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="tms" type="number" domain={['dataMin', 'dataMax']} hide />
                    <YAxis orientation="right" domain={['auto', 'auto']}
                      tick={{ fontSize: 8, fill: 'var(--color-text-faint)', fontFamily: 'monospace' }}
                      tickLine={false} width={58} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)', fontSize: 10, borderRadius: 4 }}
                      formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'Equity']} />
                    <Area type="monotone" dataKey="equity" stroke="var(--color-success)"
                      fill="url(#eqGrad)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <ReferenceLine y={simMeta?.initial_capital || 100000}
                      stroke="var(--color-border)" strokeDasharray="4 4" strokeWidth={0.75} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              </div>{/* end chart panes wrapper */}
            </div>

            {/* RIGHT: Tabbed sidebar ──────────────────────────────────────────── */}
            <div className="w-72 xl:w-80 flex-shrink-0 flex flex-col border-l min-h-0"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>

              {/* Tab bar */}
              <div className="flex flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                {(['metrics', 'positions', 'trades'] as SidebarTab[]).map((tab) => {
                  const labels: Record<SidebarTab, string> = {
                    metrics: 'Metrics',
                    positions: `Positions${latestBar?.open_positions?.length ? ` (${latestBar.open_positions.length})` : ''}`,
                    trades: `Trades${allExits.length ? ` (${allExits.length})` : ''}`,
                  }
                  return (
                    <button key={tab} onClick={() => setSidebarTab(tab)}
                      className="flex-1 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        color: sidebarTab === tab ? 'var(--color-accent)' : 'var(--color-text-faint)',
                        borderBottom: sidebarTab === tab ? '2px solid var(--color-accent)' : '2px solid transparent',
                        backgroundColor: 'transparent',
                      }}>
                      {labels[tab]}
                    </button>
                  )
                })}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto min-h-0 p-3">

                {/* ── Metrics tab ── */}
                {sidebarTab === 'metrics' && (
                  <div className="space-y-3">
                    {/* Live stats */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      <MR label="Equity" value={latestBar ? `$${latestBar.equity.toLocaleString()}` : '—'} />
                      <MR label="Return" value={latestBar ? `${latestBar.total_return_pct.toFixed(2)}%` : '—'}
                        color={latestBar ? pxColor(latestBar.total_return_pct) : undefined} />
                      <MR label="Net P&amp;L" value={latestBar ? `$${latestBar.total_net_pnl.toFixed(0)}` : '—'}
                        color={latestBar ? pxColor(latestBar.total_net_pnl) : undefined} />
                      <MR label="Drawdown" value={latestBar ? `${(latestBar.drawdown * 100).toFixed(2)}%` : '—'}
                        color="var(--color-danger)" />
                      <MR label="Win Rate" value={latestBar ? `${latestBar.win_rate.toFixed(1)}%` : '—'} />
                      <MR label="Trades" value={latestBar?.total_trades?.toString() || '0'} />
                      <MR label="Daily P&amp;L" value={latestBar ? `$${latestBar.daily_pnl.toFixed(0)}` : '—'}
                        color={latestBar ? pxColor(latestBar.daily_pnl) : undefined} />
                      <MR label="Heat" value={latestBar ? `${(latestBar.portfolio_heat * 100).toFixed(1)}%` : '—'} />
                      <MR label="Positions" value={latestBar?.open_positions?.length?.toString() || '0'} />
                      <MR label="Regime" value={latestBar?.regime || '—'} />
                    </div>

                    {/* Final results when complete */}
                    {status === 'completed' && finalMetrics?.metrics && (
                      <div className="rounded-lg border border-green-800/50 p-3 space-y-2">
                        <div className="text-xs font-semibold" style={{ color: 'var(--color-success)' }}>
                          Simulation Complete
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                          <MR label="Total Return" value={`${(finalMetrics.metrics.total_return_pct ?? 0).toFixed(2)}%`} />
                          <MR label="Sharpe" value={(finalMetrics.metrics.sharpe_ratio ?? 0).toFixed(2)} />
                          <MR label="Max DD" value={`${(finalMetrics.metrics.max_drawdown_pct ?? 0).toFixed(2)}%`} />
                          <MR label="Win Rate" value={`${(finalMetrics.metrics.win_rate_pct ?? 0).toFixed(1)}%`} />
                          <MR label="Prof. Factor" value={(finalMetrics.metrics.profit_factor ?? 0).toFixed(2)} />
                          <MR label="SQN" value={(finalMetrics.metrics.sqn ?? 0).toFixed(2)} />
                          <MR label="Avg R" value={(finalMetrics.metrics.avg_r_multiple ?? 0).toFixed(2)} />
                          <MR label="Total Trades" value={`${finalMetrics.total_trades ?? 0}`} />
                        </div>
                      </div>
                    )}

                    {/* Risk rejections */}
                    {latestBar?.rejections && latestBar.rejections.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs font-medium" style={{ color: '#fbbf24' }}>Risk Rejections</div>
                        {latestBar.rejections.map((r: any, i: number) => (
                          <div key={i} className="text-xs py-0.5 opacity-75">
                            <span className="font-medium">{r.symbol}</span>
                            <span className="opacity-60"> — {r.reason}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Active cooldowns */}
                    {latestBar && Object.keys(latestBar.cooldowns).length > 0 && (
                      <div className="space-y-1">
                        <div className="text-xs font-medium" style={{ color: '#fbbf24' }}>Cooldowns</div>
                        {Object.entries(latestBar.cooldowns).map(([sym, cd]: [string, any]) => (
                          <div key={sym} className="text-xs py-0.5 opacity-75">
                            <span className="font-medium">{sym}</span>
                            <span className="opacity-60"> — {cd.trigger}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Positions tab ── */}
                {sidebarTab === 'positions' && (
                  <div className="space-y-2">
                    {(latestBar?.open_positions || []).length === 0 && (
                      <p className="text-xs italic" style={{ color: 'var(--color-text-faint)' }}>No open positions</p>
                    )}
                    {(latestBar?.open_positions || []).map((pos: any, i: number) => (
                      <div key={i} className="rounded-lg p-2.5 space-y-1.5"
                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-card)' }}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs">{pos.symbol}</span>
                            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium',
                              pos.direction === 'long' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400')}>
                              {pos.direction.toUpperCase()}
                            </span>
                          </div>
                          <span className="text-xs tabular-nums font-medium"
                            style={{ color: pxColor(pos.unrealized_pnl) }}>
                            ${pos.unrealized_pnl.toFixed(0)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          <span>Qty</span><span className="tabular-nums">{pos.quantity.toFixed(1)}</span>
                          <span>Entry</span><span className="tabular-nums">${pos.avg_entry.toFixed(2)}</span>
                          {pos.stop_price && (
                            <><span>Stop</span><span className="tabular-nums text-red-400">${pos.stop_price.toFixed(2)}</span></>
                          )}
                          <span>Return</span>
                          <span className="tabular-nums" style={{ color: pxColor(pos.unrealized_pnl_pct) }}>
                            {pos.unrealized_pnl_pct.toFixed(2)}%
                          </span>
                        </div>
                        {(pos.target_prices || []).length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {(pos.target_prices as number[]).map((tp: number, ti: number) => (
                              <span key={ti} className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: 'rgba(34,197,94,0.12)', color: 'var(--color-success)' }}>
                                T{ti + 1} {tp.toFixed(2)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Trades tab ── */}
                {sidebarTab === 'trades' && (
                  <div className="space-y-0.5">
                    {tradeLog.length === 0 && (
                      <p className="text-xs italic" style={{ color: 'var(--color-text-faint)' }}>No trades yet</p>
                    )}
                    {tradeLog.map((t, i) => (
                      <div key={i} className="flex items-center justify-between py-1 text-xs border-b"
                        style={{ borderColor: 'var(--color-border)' }}>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className={clsx('font-medium text-[10px] px-1 py-0.5 rounded',
                              t._type === 'exit' ? 'bg-red-900/30 text-red-400' : 'bg-green-900/30 text-green-400')}>
                              {t._type === 'exit' ? 'EXIT' : 'ENTRY'}
                            </span>
                            <span className="font-medium">{t.symbol}</span>
                            <span className="opacity-50 text-[10px]">
                              {t._type === 'exit' ? t.exit_reason : t.direction}
                            </span>
                          </div>
                          <div className="opacity-40 text-[10px] font-mono">
                            {t._type === 'exit'
                              ? (t.exit_time || '').slice(0, 16).replace('T', ' ')
                              : (t.entry_time || '').slice(0, 16).replace('T', ' ')}
                          </div>
                        </div>
                        <div className="text-right">
                          {t._type === 'exit' ? (
                            <>
                              <span className="font-medium tabular-nums" style={{ color: pxColor(t.net_pnl ?? 0) }}>
                                ${(t.net_pnl ?? 0).toFixed(0)}
                              </span>
                              {t.r_multiple != null && (
                                <div className="text-[10px] opacity-50 tabular-nums">{t.r_multiple.toFixed(2)}R</div>
                              )}
                            </>
                          ) : (
                            <span className="opacity-60 tabular-nums">
                              @{t.entry_price.toFixed(2)} ×{t.quantity.toFixed(0)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty state when no simulation has been started */}
      {isSetupMode && !setupOpen && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3"
          style={{ color: 'var(--color-text-faint)' }}>
          <Activity size={32} />
          <p className="text-sm">Configure and initialize a simulation to begin.</p>
          <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2"
            onClick={() => setSetupOpen(true)}>
            <Settings size={14} /> Open Setup
          </button>
        </div>
      )}
    </div>
  )
}

export default SimulationLab
