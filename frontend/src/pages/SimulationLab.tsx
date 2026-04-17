/**
 * SimulationLab — real-time strategy validation using the full BacktestEngine.
 *
 * Features:
 *   - Candlestick chart with indicator overlays, trade markers, zoom/pan
 *   - Equity curve + drawdown
 *   - Play/pause/step/speed controls + live trade log + metrics panel
 *   - Full engine fidelity (risk, slippage, cooldowns, session windows, scaling)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  Bar,
} from 'recharts'
import {
  Play, Pause, SkipForward, FastForward, ChevronRight,
  AlertTriangle, Activity, Loader, RotateCcw, ZoomIn, ZoomOut,
} from 'lucide-react'
import clsx from 'clsx'
import { strategiesApi } from '../api/strategies'
import { servicesApi } from '../api/services'
import {
  simulationsApi, createSimulationWs,
  type BarSnapshotData, type SimulationMetadata, type TradeEvent,
} from '../api/simulations'
import { DatePickerInput } from '../components/DatePickerInput'
import { SelectMenu } from '../components/SelectMenu'
import { TickerSearch } from '../components/TickerSearch'

const today = new Date().toISOString().slice(0, 10)
const jan2020 = '2020-01-01'

const timeframeOptions = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1wk'].map((tf) => ({
  value: tf, label: tf,
}))

const speedOptions = [
  { value: '1', label: '1x' },
  { value: '5', label: '5x' },
  { value: '25', label: '25x' },
  { value: '100', label: '100x' },
  { value: '500', label: 'Max' },
]

// ── Dynamic indicator classification + color system ─────────────────────────
// No hardcoded indicator names — auto-detects from whatever the strategy produces.

/** Known color overrides for common indicators. Unknown ones get auto-assigned. */
const KNOWN_COLORS: Record<string, string> = {
  ema_9: '#38bdf8', ema_20: '#818cf8', ema_21: '#818cf8', ema_55: '#a78bfa',
  sma_20: '#fb923c', sma_50: '#fbbf24', sma_200: '#f87171',
  bb_upper: '#7dd3fc', bb_lower: '#7dd3fc', bb_mid: '#7dd3fc', bb_width: '#7dd3fc',
  kc_upper: '#86efac', kc_lower: '#86efac', kc_mid: '#86efac',
  dc_upper: '#fca5a5', dc_lower: '#fca5a5', dc_mid: '#fca5a5',
  sar: '#e879f9', hull_ma: '#34d399', vwap: '#2dd4bf',
  rsi_14: '#f59e0b', rsi_3: '#fb923c', macd: '#38bdf8', macd_signal: '#f472b6', macd_hist: '#64748b',
  adx: '#c084fc', plus_di: '#22c55e', minus_di: '#ef4444',
  stoch_k: '#34d399', stoch_d: '#f472b6',
  atr: '#fb7185', atr_14: '#fb7185', obv: '#94a3b8',
  ibs: '#a3e635', zscore: '#22d3ee', bt_snipe: '#f472b6',
}
const PALETTE = ['#38bdf8','#818cf8','#f59e0b','#34d399','#fb923c','#f472b6','#a78bfa','#22d3ee','#fbbf24','#a3e635']

/** PRICE overlay indicators (rendered on top of candles). Everything else is oscillator. */
const PRICE_PREFIXES = ['ema_','sma_','bb_','kc_','dc_','hull_ma','vwap','sar','ichi_','chandelier_','swing_','donchian_','opening_range_','pd_']
/** Indicators that use dashed lines */
const DASHED_PREFIXES = ['sma_','bb_upper','bb_lower','kc_upper','kc_lower','dc_upper','dc_lower','chandelier_']

function isPriceOverlay(key: string): boolean {
  return PRICE_PREFIXES.some(p => key.startsWith(p))
}
function getIndColor(key: string, idx: number): string {
  return KNOWN_COLORS[key] || PALETTE[idx % PALETTE.length]
}
function getIndDash(key: string): string | undefined {
  if (DASHED_PREFIXES.some(p => key.startsWith(p))) return '3 3'
  return undefined
}

// ── TOS-style Candlestick + Trade Marker renderer ───────────────────────────

function CandlestickLayer(props: any) {
  const { xAxisMap, yAxisMap, data } = props
  if (!data?.length) return null

  const xAxis = xAxisMap && (Object.values(xAxisMap)[0] as any)
  const yAxis = yAxisMap && (Object.values(yAxisMap)[0] as any)
  if (!yAxis?.scale) return null

  const yScale = yAxis.scale
  const xScale = xAxis?.scale
  const xOff = xAxis?.x ?? 0
  let slotW: number
  if (xScale?.bandwidth) {
    slotW = xScale.bandwidth()
  } else {
    slotW = (xAxis?.width ?? 600) / data.length
  }
  const bw = Math.max(slotW - 2, 1)

  return (
    <g>
      {data.map((d: any, i: number) => {
        const { open, high, low, close } = d
        if (open == null || close == null || high == null || low == null) return null

        const bullish = close >= open
        const color = bullish ? '#26a69a' : '#ef5350'  // TOS green/red

        let cx: number
        if (xScale?.bandwidth) {
          cx = xOff + xScale(d.t) + xScale.bandwidth() / 2
        } else {
          cx = xOff + (i + 0.5) * slotW
        }

        const yH = yScale(high), yL = yScale(low)
        const yO = yScale(open), yC = yScale(close)
        const bodyTop = Math.min(yO, yC)
        const bodyH = Math.max(Math.abs(yC - yO), 1)

        return (
          <g key={i}>
            {/* Wick */}
            <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
            {/* Body — TOS style: solid fill */}
            <rect x={cx - bw / 2} y={bodyTop} width={bw} height={bodyH}
              fill={color} fillOpacity={0.85} stroke={color} strokeWidth={0.5} />
            {/* Entry arrow (green up-triangle) */}
            {d._entry && (
              <g>
                <polygon
                  points={`${cx},${yScale(d._entryPrice) - 14} ${cx - 6},${yScale(d._entryPrice) - 2} ${cx + 6},${yScale(d._entryPrice) - 2}`}
                  fill="#26a69a" stroke="#1b5e20" strokeWidth={1} />
                <text x={cx + 9} y={yScale(d._entryPrice) - 5} fontSize={8} fill="#26a69a" fontFamily="monospace">
                  B {d._entryPrice?.toFixed(2)}
                </text>
              </g>
            )}
            {/* Exit arrow (down-triangle, color by P&L) */}
            {d._exit && (
              <g>
                <polygon
                  points={`${cx},${yScale(d._exitPrice) + 14} ${cx - 6},${yScale(d._exitPrice) + 2} ${cx + 6},${yScale(d._exitPrice) + 2}`}
                  fill={d._exitPnl >= 0 ? '#26a69a' : '#ef5350'}
                  stroke={d._exitPnl >= 0 ? '#1b5e20' : '#b71c1c'} strokeWidth={1} />
                <text x={cx + 9} y={yScale(d._exitPrice) + 12} fontSize={8}
                  fill={d._exitPnl >= 0 ? '#26a69a' : '#ef5350'} fontFamily="monospace">
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

// ── Main component ───────────────────────────────────────────────────────────


export function SimulationLab() {
  // --- State persistence helpers ---
  const STORAGE_KEY = 'simlab_state_v2';
  function loadPersistedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }
  function persistState(state: any) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  // Setup state (with persistence)
  const persisted = loadPersistedState() || {};
  const [strategyId, setStrategyId] = useState(persisted.strategyId || '');
  const [versionId, setVersionId] = useState(persisted.versionId || '');
  const [symbols, setSymbols] = useState<string[]>(persisted.symbols || []);
  const [timeframe, setTimeframe] = useState(persisted.timeframe || '1d');
  const [startDate, setStartDate] = useState(persisted.startDate || jan2020);
  const [endDate, setEndDate] = useState(persisted.endDate || today);
  const [capital, setCapital] = useState(persisted.capital || 100000);
  const [provider, setProvider] = useState(persisted.provider || 'auto');
  const [selectedServiceId, setSelectedServiceId] = useState(persisted.selectedServiceId || '');

  // Save state on change
  useEffect(() => {
    persistState({ strategyId, versionId, symbols, timeframe, startDate, endDate, capital, provider, selectedServiceId });
  }, [strategyId, versionId, symbols, timeframe, startDate, endDate, capital, provider, selectedServiceId]);

  // Simulation state
  const [simMeta, setSimMeta] = useState<SimulationMetadata | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'completed'>('idle')
  const [speed, setSpeed] = useState(5)
  const [error, setError] = useState('')

  // Bar data accumulated for charts
  const [barHistory, setBarHistory] = useState<BarSnapshotData[]>([])
  const [latestBar, setLatestBar] = useState<BarSnapshotData | null>(null)
  const [allEntries, setAllEntries] = useState<TradeEvent[]>([])
  const [allExits, setAllExits] = useState<TradeEvent[]>([])
  const [equityCurve, setEquityCurve] = useState<{ date: string; equity: number; drawdown: number }[]>([])
  const [finalMetrics, setFinalMetrics] = useState<any>(null)

  // Zoom state for price chart
  const [zoomStart, setZoomStart] = useState<number | null>(null)
  const [zoomEnd, setZoomEnd] = useState<number | null>(null)

  // Drag-to-zoom state
  const [dragStart, setDragStart] = useState<string | null>(null)
  const [dragEnd, setDragEnd] = useState<string | null>(null)
  const isDragging = dragStart !== null

  // WebSocket ref + mounted ref
  const wsRef = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Queries
  const { data: strategies } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => strategiesApi.list(),
  })
  const { data: strategyDetail } = useQuery({
    queryKey: ['strategy', strategyId],
    queryFn: () => strategiesApi.get(strategyId),
    enabled: !!strategyId,
  })

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => servicesApi.list(),
  })

  // Alpaca service selection
  const alpacaServices = (services as any[]).filter((s) => s.provider === 'alpaca' && s.has_credentials);
  // If only one, auto-select
  useEffect(() => {
    if (!selectedServiceId && alpacaServices.length === 1) setSelectedServiceId(alpacaServices[0].id);
  }, [alpacaServices, selectedServiceId]);

  const versions = (strategyDetail as any)?.versions ?? []

  // Auto-select latest version when strategy changes
  useEffect(() => {
    if (versions.length > 0 && !versionId) {
      setVersionId(versions[0].id)
    }
  }, [versions, versionId])

  // ── WebSocket message handler ──────────────────────────────────────────────

  const handleWsMessage = useCallback((event: MessageEvent) => {
    if (!mountedRef.current) return
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'bar') {
        const bar: BarSnapshotData = msg.data
        setLatestBar(bar)
        setBarHistory((prev) => [...prev, bar].slice(-500))
        setEquityCurve((prev) => [
          ...prev,
          { date: bar.timestamp, equity: bar.equity, drawdown: bar.drawdown },
        ])
        if (bar.entries.length > 0) setAllEntries((prev) => [...prev, ...bar.entries])
        if (bar.exits.length > 0) setAllExits((prev) => [...prev, ...bar.exits])
      } else if (msg.type === 'completed') {
        setStatus('completed')
        setFinalMetrics(msg.data)
      } else if (msg.type === 'status') {
        if (msg.status === 'playing') setStatus('playing')
        else if (msg.status === 'paused') setStatus('paused')
      } else if (msg.type === 'equity_catchup') {
        const curve = (msg.data || []).map((p: any) => ({
          date: p.date, equity: p.equity, drawdown: p.drawdown,
        }))
        setEquityCurve(curve)
      } else if (msg.type === 'init') {
        setStatus('ready')
      } else if (msg.type === 'error') {
        setError(msg.message)
      }
    } catch (e) {
      console.error('WS parse error:', e)
    }
  }, [])

  // ── Actions ────────────────────────────────────────────────────────────────


  const handleCreate = async () => {
    // Data existence checks
    if (!strategyId) { setError('Select a strategy first'); return; }
    if (!versionId) { setError('Select a strategy version'); return; }
    if (!symbols.length) { setError('Select at least one symbol'); return; }
    if (!timeframe) { setError('Select a timeframe'); return; }
    if (!startDate || !endDate) { setError('Select start and end dates'); return; }
    if ((provider === 'alpaca' || provider === 'auto') && alpacaServices.length && !selectedServiceId) {
      setError('Select an Alpaca service account'); return;
    }
    setError('');
    setStatus('loading');
    setBarHistory([]); setLatestBar(null); setAllEntries([]); setAllExits([]);
    setEquityCurve([]); setFinalMetrics(null); setZoomStart(null); setZoomEnd(null);

    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }

    try {
      // Use selected Alpaca service (if any)
      let alpacaKey = '', alpacaSecret = '';
      if ((provider === 'alpaca' || provider === 'auto') && selectedServiceId) {
        const svc = alpacaServices.find(s => s.id === selectedServiceId);
        if (svc) {
          alpacaKey = svc.api_key;
          alpacaSecret = svc.secret_key;
        }
      }

      const meta = await simulationsApi.create({
        strategy_version_id: versionId,
        symbols, timeframe,
        start_date: startDate, end_date: endDate,
        initial_capital: capital, data_provider: provider,
        alpaca_api_key: alpacaKey || undefined,
        alpaca_secret_key: alpacaSecret || undefined,
      });
      if (!mountedRef.current) return;
      setSimMeta(meta);

      // Show provider and any backend warnings (if present)
      if (meta.provider) {
        setError(`Provider used: ${meta.provider}${meta.date_clamped ? ' (date range clamped)' : ''}`);
      }

      const ws = createSimulationWs(meta.simulation_id);
      ws.onopen = () => console.log('[SimLab] WS connected');
      ws.onmessage = handleWsMessage;
      ws.onerror = () => {
        if (mountedRef.current) setError('WebSocket connection failed — restart Vite dev server if proxy changed');
      };
      ws.onclose = () => {
        if (mountedRef.current && wsRef.current === ws) {
          setStatus((prev) => prev === 'playing' ? 'paused' : prev);
        }
      };
      wsRef.current = ws;
    } catch (e: any) {
      if (mountedRef.current) { setError(e.message || 'Failed to create simulation'); setStatus('idle'); }
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

  const handleSpeedChange = (newSpeed: string) => {
    const s = parseFloat(newSpeed)
    setSpeed(s)
    sendWs({ action: 'set_speed', speed: s })
  }

  const handleReset = () => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    setStatus('idle'); setSimMeta(null); setBarHistory([]); setLatestBar(null)
    setAllEntries([]); setAllExits([]); setEquityCurve([]); setFinalMetrics(null)
    setError(''); setZoomStart(null); setZoomEnd(null)
  }

  useEffect(() => () => { if (wsRef.current) wsRef.current.close() }, [])

  // ── Smart date formatting based on timeframe context ──

  const isIntraday = useMemo(() => ['1m', '5m', '15m', '30m', '1h', '4h'].includes(timeframe), [timeframe])

  /** Format a raw timestamp string into a display label based on timeframe context */
  const formatTimestamp = useCallback((raw: string): string => {
    if (!raw) return ''
    if (isIntraday) {
      // Show "Jan 15 09:30" for intraday
      const d = new Date(raw)
      if (isNaN(d.getTime())) return raw.slice(0, 16)
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    if (timeframe === '1wk') {
      // Show "Jan 2020" for weekly
      const d = new Date(raw)
      if (isNaN(d.getTime())) return raw.slice(0, 7)
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    }
    // Daily: "Jan 15, 25" compact
    const d = new Date(raw)
    if (isNaN(d.getTime())) return raw.slice(0, 10)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  }, [isIntraday, timeframe])

  /** Build a unique key for a timestamp — intraday keeps time, daily keeps date only */
  const makeBarKey = useCallback((raw: string): string => {
    if (isIntraday) return raw.slice(0, 19)  // "2020-01-15 09:30:00" or "2020-01-15T09:30:00"
    return raw.split(' ')[0] || raw.slice(0, 10)  // "2020-01-15"
  }, [isIntraday])

  // ── Chart data — merge entries/exits INTO priceData for correct marker positioning ──

  const primarySymbol = symbols[0] || ''

  const entryMap = useMemo(() => {
    const m = new Map<string, TradeEvent>()
    for (const e of allEntries) {
      if (e.symbol === primarySymbol && e.entry_time) {
        m.set(makeBarKey(e.entry_time), e)
      }
    }
    return m
  }, [allEntries, primarySymbol, makeBarKey])

  const exitMap = useMemo(() => {
    const m = new Map<string, TradeEvent>()
    for (const e of allExits) {
      if (e.symbol === primarySymbol && e.exit_time) {
        m.set(makeBarKey(e.exit_time), e)
      }
    }
    return m
  }, [allExits, primarySymbol, makeBarKey])

  const priceData = useMemo(() => {
    return barHistory.map((b) => {
      const sym = b.symbols[primarySymbol]
      if (!sym) return null
      const barKey = makeBarKey(b.timestamp)
      const entry = entryMap.get(barKey)
      const exit = exitMap.get(barKey)
      return {
        t: formatTimestamp(b.timestamp),
        _rawTs: b.timestamp,
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
    }).filter(Boolean)
  }, [barHistory, primarySymbol, entryMap, exitMap, makeBarKey, formatTimestamp])

  // Zoom slice
  const zoomedData = useMemo(() => {
    if (zoomStart != null && zoomEnd != null && zoomStart < zoomEnd) {
      return priceData.slice(zoomStart, zoomEnd + 1)
    }
    return priceData
  }, [priceData, zoomStart, zoomEnd])

  // Thin equity curve
  const thinEquity = useMemo(() => {
    if (equityCurve.length <= 300) return equityCurve
    const step = Math.ceil(equityCurve.length / 300)
    return equityCurve.filter((_, i) => i % step === 0 || i === equityCurve.length - 1)
  }, [equityCurve])

  // Combined trade log sorted by time
  const tradeLog = useMemo(() => {
    const items: Array<TradeEvent & { _type: 'entry' | 'exit' }> = [
      ...allEntries.map((e) => ({ ...e, _type: 'entry' as const })),
      ...allExits.map((e) => ({ ...e, _type: 'exit' as const })),
    ]
    items.sort((a, b) => {
      const ta = a._type === 'exit' ? a.exit_time : a.entry_time
      const tb = b._type === 'exit' ? b.exit_time : b.entry_time
      return (tb || '').localeCompare(ta || '')
    })
    return items.slice(0, 40)
  }, [allEntries, allExits])

  // Zoom handlers
  const handleZoomIn = () => {
    const total = priceData.length
    if (total < 10) return
    const lo = zoomStart ?? 0, hi = zoomEnd ?? total - 1
    const visible = hi - lo
    const newVis = Math.max(10, Math.round(visible * 0.6))
    const center = Math.round((lo + hi) / 2)
    const nLo = Math.max(0, center - Math.floor(newVis / 2))
    const nHi = Math.min(total - 1, nLo + newVis)
    setZoomStart(nLo); setZoomEnd(nHi)
  }
  const handleZoomOut = () => {
    const total = priceData.length
    if (total === 0) return
    if (zoomStart == null || zoomEnd == null) return  // already fully zoomed out
    const lo = zoomStart, hi = zoomEnd
    const visible = hi - lo
    const newVis = Math.min(total, Math.round(visible * 1.6))
    const center = Math.round((lo + hi) / 2)
    const nLo = Math.max(0, center - Math.floor(newVis / 2))
    const nHi = Math.min(total - 1, nLo + newVis)
    if (nHi - nLo >= total - 2) { setZoomStart(null); setZoomEnd(null) }
    else { setZoomStart(nLo); setZoomEnd(nHi) }
  }
  const handleZoomReset = () => { setZoomStart(null); setZoomEnd(null) }

  // Drag-to-zoom commit
  const commitDragZoom = useCallback((t1: string, t2: string) => {
    const i1 = priceData.findIndex((d: any) => d?.t === t1)
    const i2 = priceData.findIndex((d: any) => d?.t === t2)
    if (i1 < 0 || i2 < 0 || i1 === i2) return
    const lo = Math.min(i1, i2), hi = Math.max(i1, i2)
    if (hi - lo < 3) return
    setZoomStart(lo); setZoomEnd(hi)
  }, [priceData])

  const isZoomed = zoomStart != null && zoomEnd != null
  const zoomBarCount = isZoomed ? (zoomEnd! - zoomStart! + 1) : priceData.length

  // ── Render ─────────────────────────────────────────────────────────────────

  const isSetupMode = status === 'idle' || status === 'loading'

  return (
    <div className="space-y-3 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>Simulation Lab</h1>
        {simMeta && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <span>{simMeta.strategy_name}</span>
            <span className="opacity-50">|</span>
            <span>{symbols.join(', ')}</span>
            <span className="opacity-50">|</span>
            <span>{timeframe}</span>
            {latestBar && (
              <>
                <span className="opacity-50">|</span>
                <span>Bar {(latestBar.bar_num + 1).toLocaleString()}/{latestBar.total_bars.toLocaleString()}</span>
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="p-2 rounded text-xs flex items-center gap-2" style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
          <AlertTriangle size={14} /> {error}
          <button className="ml-auto underline" onClick={() => setError('')}>dismiss</button>
        </div>
      )}

      {/* ── SETUP PANEL ─────────────────────────────────────────────────────── */}
      {isSetupMode && (
        <div className="card p-4 space-y-4">
          <h2 className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Configure Simulation</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Strategy</label>
              <SelectMenu
                value={strategyId}
                onChange={(v) => { setStrategyId(v); setVersionId('') }}
                options={(strategies || []).map((s: any) => ({ value: s.id, label: s.name }))}
                placeholder="Select strategy..."
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Version</label>
              <SelectMenu
                value={versionId}
                onChange={setVersionId}
                options={versions.map((v: any) => ({
                  value: v.id,
                  label: `v${v.version} — ${v.duration_mode || 'swing'} ${v.notes ? '(' + v.notes.slice(0, 30) + ')' : ''}`,
                }))}
                placeholder={strategyId ? (versions.length === 0 ? 'Loading...' : 'Select version...') : 'Pick a strategy first'}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Symbols</label>
              <TickerSearch selected={symbols} onChange={setSymbols} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Timeframe</label>
              <SelectMenu value={timeframe} onChange={setTimeframe} options={timeframeOptions} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Start Date</label>
              <DatePickerInput value={startDate} onChange={setStartDate} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>End Date</label>
              <DatePickerInput value={endDate} onChange={setEndDate} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Initial Capital</label>
              <input type="number" className="input w-full" value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Data Provider</label>
              <SelectMenu value={provider} onChange={setProvider} options={[
                { value: 'auto', label: 'Auto' }, { value: 'yfinance', label: 'Yahoo Finance' }, { value: 'alpaca', label: 'Alpaca' },
              ]} />
            </div>
            {(provider === 'alpaca' || provider === 'auto') && (
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Alpaca Service Account</label>
                {alpacaServices.length === 0 ? (
                  <div className="rounded border border-amber-800/60 bg-amber-900/20 p-2 text-xs text-amber-300">
                    No Alpaca service account found. <a href="/services" className="underline hover:text-amber-200">Create one</a> to use Alpaca as a data provider.
                  </div>
                ) : (
                  <SelectMenu
                    className="w-full"
                    value={selectedServiceId}
                    placeholder="- Select an Alpaca account -"
                    options={alpacaServices.map(s => ({ value: s.id, label: s.name }))}
                    onChange={setSelectedServiceId}
                  />
                )}
                {selectedServiceId && (
                  <p className="text-[11px] text-green-500">Credentials loaded from service account.</p>
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <button className="btn-primary flex items-center gap-2" onClick={handleCreate} disabled={status === 'loading'}>
              {status === 'loading' ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
              {status === 'loading' ? 'Loading data & indicators...' : 'Initialize Simulation'}
            </button>
          </div>
        </div>
      )}

      {/* ── SIMULATION VIEW ─────────────────────────────────────────────────── */}
      {!isSetupMode && (
        <>
          {/* Controls bar */}
          <div className="card px-3 py-2 flex items-center gap-3 flex-shrink-0 flex-wrap">
            <div className="flex items-center gap-1">
              {status === 'playing' ? (
                <button className="btn-sm" onClick={handlePause} title="Pause"><Pause size={14} /></button>
              ) : (
                <button className="btn-sm btn-primary" onClick={handlePlay} title="Play" disabled={status === 'completed'}>
                  <Play size={14} />
                </button>
              )}
              <button className="btn-sm" onClick={handleStep} title="Step one bar" disabled={status === 'completed' || status === 'playing'}>
                <ChevronRight size={14} />
              </button>
              <button className="btn-sm" onClick={handleSkipToTrade} title="Skip to next trade" disabled={status === 'completed' || status === 'playing'}>
                <SkipForward size={14} />
              </button>
              <button className="btn-sm" onClick={handleFinalize} title="Run to end" disabled={status === 'completed'}>
                <FastForward size={14} />
              </button>
            </div>

            <div className="h-4 border-r" style={{ borderColor: 'var(--color-border)' }} />

            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Speed:</span>
              {speedOptions.map((opt) => (
                <button
                  key={opt.value}
                  className={clsx('text-xs px-1.5 py-0.5 rounded', speed === parseFloat(opt.value) ? 'btn-primary' : 'btn-sm')}
                  onClick={() => handleSpeedChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="h-4 border-r" style={{ borderColor: 'var(--color-border)' }} />

            {latestBar && (
              <div className="flex-1 flex items-center gap-2 min-w-[120px]">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${latestBar.progress_pct}%`, backgroundColor: 'var(--color-accent)' }} />
                </div>
                <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{latestBar.progress_pct.toFixed(0)}%</span>
              </div>
            )}

            <span className={clsx(
              'text-xs px-2 py-0.5 rounded-full font-medium',
              status === 'playing' && 'bg-green-900/40 text-green-400',
              status === 'paused' && 'bg-yellow-900/40 text-yellow-400',
              status === 'completed' && 'bg-blue-900/40 text-blue-400',
              status === 'ready' && 'bg-gray-800/40 text-gray-400',
            )}>
              {status}
            </span>

            <div className="flex items-center gap-1">
              <button className="btn-sm" onClick={handleZoomIn} title="Zoom in"><ZoomIn size={14} /></button>
              <button className="btn-sm" onClick={handleZoomOut} title="Zoom out"><ZoomOut size={14} /></button>
              {isZoomed && (
                <button className="btn-sm text-xs px-2" onClick={handleZoomReset} title="Reset zoom"
                  style={{ color: 'var(--color-accent)' }}>
                  {zoomBarCount} bars
                </button>
              )}
            </div>

            <button className="btn-sm" onClick={handleReset} title="Reset"><RotateCcw size={14} /></button>
          </div>

          {/* Main content */}
          <div className="flex-1 flex flex-col lg:flex-row gap-3 min-h-0" style={{ overflow: 'hidden', maxHeight: 'calc(100vh - 140px)' }}>
            {/* LEFT: Charts — TOS-inspired layout */}
            <div className="flex-1 flex flex-col min-w-0" style={{ minHeight: 0, gap: 0 }}>
              {/* ── Chart header: symbol, OHLC, strategy logic ──────────── */}
              <div className="px-3 py-1.5 flex items-center justify-between" style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-3 text-xs font-mono">
                  <span className="font-bold text-sm" style={{ color: '#26a69a' }}>{primarySymbol}</span>
                  {symbols.length > 1 && <span style={{ color: 'var(--color-text-tertiary)' }}>+{symbols.length - 1}</span>}
                  <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{timeframe}</span>
                  {/* Active indicator pills — auto-detected from strategy */}
                  {simMeta?.indicators && (() => {
                    const allInds = simMeta.indicators as string[]
                    const priceInds = allInds.filter(isPriceOverlay).slice(0, 8)
                    return priceInds.map((ind, i) => (
                      <span key={ind} className="px-1.5 py-0.5 rounded text-[10px]"
                        style={{ backgroundColor: getIndColor(ind, i) + '22', color: getIndColor(ind, i) }}>
                        {ind.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    ))
                  })()}
                </div>
                {/* OHLC data box — TOS style */}
                {latestBar?.symbols[primarySymbol] && (
                  <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                    <span style={{ color: 'var(--color-text-tertiary)' }}>O</span>
                    <span style={{ color: 'var(--color-text-primary)' }}>{(latestBar.symbols[primarySymbol]?.open as number)?.toFixed(2)}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>H</span>
                    <span style={{ color: '#26a69a' }}>{(latestBar.symbols[primarySymbol]?.high as number)?.toFixed(2)}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>L</span>
                    <span style={{ color: '#ef5350' }}>{(latestBar.symbols[primarySymbol]?.low as number)?.toFixed(2)}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>C</span>
                    <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{(latestBar.symbols[primarySymbol]?.close as number)?.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Strategy logic summary bar */}
              {simMeta && (
                <div className="px-3 py-1 flex items-center gap-2 text-[10px] font-mono" style={{ backgroundColor: 'var(--color-bg-tertiary)', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>
                  <span style={{ color: '#26a69a' }}>STRATEGY</span>
                  <span>{simMeta.strategy_name}</span>
                  <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
                  <span style={{ color: '#fbbf24' }}>ENTRY</span>
                  <span>BB lower + RSI oversold</span>
                  <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
                  <span style={{ color: '#ef5350' }}>EXIT</span>
                  <span>Target 2R / Stop BB-based</span>
                  <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
                  <span style={{ color: '#818cf8' }}>RISK</span>
                  <span>1% per trade</span>
                </div>
              )}

              {/* ── Price pane (55%) ─────────────────────────────────────── */}
              <div style={{ flex: '0 0 55%', minHeight: 250, position: 'relative' }}
                onWheel={(e) => {
                  e.preventDefault()
                  const total = priceData.length
                  if (total === 0) return
                  const lo = zoomStart ?? 0, hi = zoomEnd ?? total - 1
                  const visible = hi - lo
                  const factor = e.deltaY > 0 ? 1.15 : 0.87
                  const newVis = Math.round(Math.min(Math.max(visible * factor, 10), total))
                  const center = Math.round((lo + hi) / 2)
                  const nLo = Math.max(0, center - Math.floor(newVis / 2))
                  const nHi = Math.min(total - 1, nLo + newVis)
                  if (nHi - nLo < 2) return
                  setZoomStart(nLo); setZoomEnd(nHi)
                }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={zoomedData} margin={{ top: 8, right: 60, bottom: 0, left: 0 }}
                    onMouseDown={(e: any) => e?.activeLabel && setDragStart(e.activeLabel)}
                    onMouseMove={(e: any) => isDragging && e?.activeLabel && setDragEnd(e.activeLabel)}
                    onMouseUp={() => {
                      if (dragStart && dragEnd) commitDragZoom(dragStart, dragEnd)
                      setDragStart(null); setDragEnd(null)
                    }}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="1 4" opacity={0.2} />
                    <XAxis dataKey="t" tick={{ fontSize: 9, fill: 'var(--color-text-tertiary)' }} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }}
                      interval={Math.max(0, Math.ceil(zoomedData.length / 12) - 1)} />
                    <YAxis yAxisId="price" orientation="right" domain={['auto', 'auto']}
                      tick={{ fontSize: 10, fill: 'var(--color-text-secondary)', fontFamily: 'monospace' }}
                      tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} width={55} />
                    <Tooltip cursor={{ stroke: 'var(--color-text-tertiary)', strokeDasharray: '3 3' }}
                      contentStyle={{ backgroundColor: 'rgba(15,23,42,0.95)', border: '1px solid #334155', fontSize: 11, fontFamily: 'monospace', borderRadius: 4 }}
                      labelStyle={{ color: '#94a3b8', marginBottom: 4 }} />
                    {/* Invisible line to anchor Y axis */}
                    <Line yAxisId="price" type="monotone" dataKey="close" stroke="transparent" dot={false} activeDot={false} />
                    {/* TOS-style candlesticks */}
                    <Customized component={CandlestickLayer} />
                    {/* Dynamic indicator overlays — auto-detected from data, not hardcoded */}
                    {(() => {
                      if (!zoomedData[0]) return null
                      const first = zoomedData[0] as any
                      const skip = new Set(['t','_rawTs','open','high','low','close','volume','_entry','_entryPrice','_exit','_exitPrice','_exitPnl'])
                      // Find all price-overlay keys that have data
                      const priceKeys = Object.keys(first).filter(k => !skip.has(k) && isPriceOverlay(k) && first[k] != null)
                      return priceKeys.map((k, i) => (
                        <Line key={k} yAxisId="price" type="monotone" dataKey={k}
                          stroke={getIndColor(k, i)} dot={false}
                          strokeWidth={k.includes('mid') ? 0.6 : 1}
                          strokeDasharray={getIndDash(k)}
                          opacity={k.includes('mid') ? 0.5 : 0.8}
                          isAnimationActive={false} />
                      ))
                    })()}
                    {/* Stop price lines */}
                    {latestBar?.open_positions?.filter(p => p.symbol === primarySymbol && p.stop_price).map((p, i) => (
                      <ReferenceLine key={`stop-${i}`} yAxisId="price" y={p.stop_price!}
                        stroke="#ef5350" strokeDasharray="6 3" strokeWidth={1.5}
                        label={{ value: `STOP ${p.stop_price?.toFixed(2)}`, position: 'right', fontSize: 9, fill: '#ef5350', fontFamily: 'monospace' }} />
                    ))}
                    {/* Target price lines */}
                    {latestBar?.open_positions?.filter(p => p.symbol === primarySymbol).flatMap(p =>
                      (p.target_prices || []).map((tp, i) => (
                        <ReferenceLine key={`tgt-${p.trade_id}-${i}`} yAxisId="price" y={tp}
                          stroke="#26a69a" strokeDasharray="4 4" strokeWidth={1}
                          label={{ value: `T${i + 1} ${tp.toFixed(2)}`, position: 'right', fontSize: 9, fill: '#26a69a', fontFamily: 'monospace' }} />
                      ))
                    )}
                    {/* Entry price line for open position */}
                    {latestBar?.open_positions?.filter(p => p.symbol === primarySymbol).map((p, i) => (
                      <ReferenceLine key={`entry-${i}`} yAxisId="price" y={p.avg_entry}
                        stroke="#fbbf24" strokeDasharray="2 4" strokeWidth={1} opacity={0.6}
                        label={{ value: `Entry ${p.avg_entry.toFixed(2)}`, position: 'right', fontSize: 8, fill: '#fbbf24', fontFamily: 'monospace' }} />
                    ))}
                    {/* Drag-to-zoom selection highlight */}
                    {isDragging && dragStart && dragEnd && (
                      <ReferenceArea x1={dragStart} x2={dragEnd}
                        strokeOpacity={0.3} fill="#38bdf8" fillOpacity={0.12} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                {/* Zoom range indicator overlay */}
                {isZoomed && (
                  <div className="absolute top-2 right-16 text-[10px] font-mono px-2 py-0.5 rounded"
                    style={{ backgroundColor: 'rgba(56,189,248,0.15)', color: '#38bdf8' }}>
                    {zoomBarCount} bars · drag to select · scroll to zoom · <button onClick={handleZoomReset} className="underline">reset</button>
                  </div>
                )}
              </div>

              {/* ── Volume pane (10%) ────────────────────────────────────── */}
              <div style={{ flex: '0 0 10%', minHeight: 40 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={zoomedData} margin={{ top: 0, right: 60, bottom: 0, left: 0 }}>
                    <XAxis dataKey="t" tick={false} axisLine={false} hide />
                    <YAxis orientation="right" tick={{ fontSize: 8, fill: 'var(--color-text-tertiary)', fontFamily: 'monospace' }} tickLine={false} width={55} />
                    <Bar dataKey="volume" fill="#334155" opacity={0.6} radius={[1, 1, 0, 0]} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* ── Equity pane (30%) ────────────────────────────────────── */}
              <div style={{ flex: '0 0 30%', minHeight: 80, borderTop: '1px solid var(--color-border)' }}>
                <div className="px-3 py-1 text-[10px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
                  EQUITY · ${latestBar?.equity?.toLocaleString() || '—'}
                  {latestBar && <span style={{ color: latestBar.total_return_pct >= 0 ? '#26a69a' : '#ef5350', marginLeft: 8 }}>
                    {latestBar.total_return_pct >= 0 ? '+' : ''}{latestBar.total_return_pct.toFixed(2)}%
                  </span>}
                  <span style={{ marginLeft: 8 }}>DD {latestBar ? (latestBar.drawdown * 100).toFixed(2) + '%' : '—'}</span>
                </div>
                <ResponsiveContainer width="100%" height="85%">
                  <AreaChart data={thinEquity} margin={{ top: 0, right: 60, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#26a69a" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#26a69a" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={false} axisLine={false} hide />
                    <YAxis orientation="right" domain={['auto', 'auto']}
                      tick={{ fontSize: 9, fill: 'var(--color-text-tertiary)', fontFamily: 'monospace' }} tickLine={false} width={55} />
                    <Tooltip cursor={{ stroke: '#475569', strokeDasharray: '3 3' }}
                      contentStyle={{ backgroundColor: 'rgba(15,23,42,0.95)', border: '1px solid #334155', fontSize: 10, fontFamily: 'monospace', borderRadius: 4 }}
                      formatter={(v: number) => ['$' + v.toLocaleString(), 'Equity']} />
                    <Area type="monotone" dataKey="equity" stroke="#26a69a" fill="url(#eqGrad)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <ReferenceLine y={simMeta?.initial_capital || 100000} stroke="#475569" strokeDasharray="4 4" strokeWidth={0.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* RIGHT: Metrics + Trade Log */}
            <div className="w-full lg:w-96 flex-shrink-0 flex flex-col gap-2 overflow-y-auto">
              {/* Live metrics */}
              <div className="card p-3 space-y-2">
                <h3 className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Live Metrics</h3>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <MR label="Equity" value={latestBar ? `$${latestBar.equity.toLocaleString()}` : '—'} />
                  <MR label="Return" value={latestBar ? `${latestBar.total_return_pct.toFixed(2)}%` : '—'}
                    c={latestBar && latestBar.total_return_pct >= 0 ? '#26a69a' : '#ef5350'} />
                  <MR label="Drawdown" value={latestBar ? `${(latestBar.drawdown * 100).toFixed(2)}%` : '—'} c="#ef5350" />
                  <MR label="Daily P&L" value={latestBar ? `$${latestBar.daily_pnl.toFixed(0)}` : '—'}
                    c={latestBar && latestBar.daily_pnl >= 0 ? '#26a69a' : '#ef5350'} />
                  <MR label="Trades" value={latestBar?.total_trades?.toString() || '0'} />
                  <MR label="Win Rate" value={latestBar ? `${latestBar.win_rate.toFixed(1)}%` : '—'} />
                  <MR label="Net P&L" value={latestBar ? `$${latestBar.total_net_pnl.toFixed(0)}` : '—'}
                    c={latestBar && latestBar.total_net_pnl >= 0 ? '#26a69a' : '#ef5350'} />
                  <MR label="Heat" value={latestBar ? `${(latestBar.portfolio_heat * 100).toFixed(1)}%` : '—'} />
                  <MR label="Positions" value={latestBar?.open_positions?.length?.toString() || '0'} />
                  <MR label="Regime" value={latestBar?.regime || '—'} />
                </div>
              </div>

              {/* Open positions */}
              <div className="card p-3 flex-1 overflow-auto min-h-[80px]">
                <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                  Open Positions ({latestBar?.open_positions?.length || 0})
                </h3>
                {(latestBar?.open_positions || []).map((pos, i) => (
                  <div key={i} className="text-xs py-1 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
                    <div>
                      <span className="font-medium">{pos.symbol}</span>
                      <span className={clsx('ml-1', pos.direction === 'long' ? 'text-green-400' : 'text-red-400')}>
                        {pos.direction.toUpperCase()}
                      </span>
                      <span className="ml-1 opacity-60">x{pos.quantity.toFixed(0)}</span>
                    </div>
                    <div className="text-right">
                      <span className={pos.unrealized_pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                        ${pos.unrealized_pnl.toFixed(0)} ({pos.unrealized_pnl_pct.toFixed(1)}%)
                      </span>
                      {pos.stop_price && <span className="block opacity-50">stop: ${pos.stop_price.toFixed(2)}</span>}
                    </div>
                  </div>
                ))}
                {!latestBar?.open_positions?.length && <p className="text-xs opacity-50 italic">No open positions</p>}
              </div>

              {/* Trade log */}
              <div className="card p-3 flex-1 overflow-auto min-h-[80px]">
                <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                  Trade Log ({allEntries.length + allExits.length})
                </h3>
                <div className="space-y-1 max-h-48 overflow-auto">
                  {tradeLog.map((t, i) => (
                    <div key={i} className="text-xs flex items-center justify-between py-0.5">
                      <div>
                        <span className={t._type === 'exit' ? 'text-red-400' : 'text-green-400'}>
                          {t._type === 'exit' ? 'EXIT' : 'ENTRY'}
                        </span>{' '}
                        <span className="font-medium">{t.symbol}</span>{' '}
                        <span className="opacity-50">{t._type === 'exit' ? t.exit_reason : t.direction}</span>
                      </div>
                      {t._type === 'exit' ? (
                        <span className={(t.net_pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}>
                          ${(t.net_pnl ?? 0).toFixed(0)}
                          {t.r_multiple != null && <span className="opacity-60 ml-1">({t.r_multiple.toFixed(1)}R)</span>}
                        </span>
                      ) : (
                        <span className="opacity-60">@{t.entry_price.toFixed(2)} x{t.quantity.toFixed(0)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Risk rejections */}
              {latestBar?.rejections && latestBar.rejections.length > 0 && (
                <div className="card p-3">
                  <h3 className="text-xs font-medium mb-1 text-amber-400">Risk Rejections</h3>
                  {latestBar.rejections.map((r, i) => (
                    <div key={i} className="text-xs py-0.5 opacity-75">
                      <span className="font-medium">{r.symbol}</span> --- {r.reason}
                    </div>
                  ))}
                </div>
              )}

              {/* Cooldowns */}
              {latestBar && Object.keys(latestBar.cooldowns).length > 0 && (
                <div className="card p-3">
                  <h3 className="text-xs font-medium mb-1 text-yellow-400">Active Cooldowns</h3>
                  {Object.entries(latestBar.cooldowns).map(([sym, cd]) => (
                    <div key={sym} className="text-xs py-0.5 opacity-75">
                      <span className="font-medium">{sym}</span> --- {cd.trigger}
                    </div>
                  ))}
                </div>
              )}

                              {/* Final metrics */}
              {status === 'completed' && finalMetrics?.metrics && (
                <div className="card p-3 border-green-800/50">
                  <h3 className="text-xs font-semibold text-green-400 mb-2">Simulation Complete</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <MR label="Total Return" value={`${(finalMetrics.metrics.total_return_pct ?? 0).toFixed(2)}%`} />
                    <MR label="Sharpe" value={`${(finalMetrics.metrics.sharpe_ratio ?? 0).toFixed(2)}`} />
                    <MR label="Max DD" value={`${(finalMetrics.metrics.max_drawdown_pct ?? 0).toFixed(2)}%`} />
                    <MR label="Win Rate" value={`${(finalMetrics.metrics.win_rate_pct ?? 0).toFixed(1)}%`} />
                    <MR label="Profit Factor" value={`${(finalMetrics.metrics.profit_factor ?? 0).toFixed(2)}`} />
                    <MR label="Total Trades" value={`${finalMetrics.total_trades ?? 0}`} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MR({ label, value, c }: { label: string; value: string; c?: string }) {
  return (
    <>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span className="text-right font-medium tabular-nums truncate" style={{ color: c || 'var(--color-text-primary)' }}>{value}</span>
    </>
  )
}

export default SimulationLab
