/**
 * ChartLab — visualise indicators on saved OHLCV data.
 *
 * Price pane:  candlestick bars + price-scale overlays (MA, BB, Keltner, Donchian, SAR, Ichimoku)
 * Volume pane: bar chart
 * Oscillator pane: RSI, MACD, Stochastic, ADX, ATR, IBS, Z-score, BT_Snipe, OBV
 */
import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar as RBar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Cell,
  Customized,
} from 'recharts'
import { Activity, ChevronDown, ChevronUp, Settings, X } from 'lucide-react'
import api from '../api/client'
import { strategiesApi } from '../api/strategies'

// ── Types ─────────────────────────────────────────────────────────────────────

interface InventoryItem {
  symbol: string
  timeframe: string
  source: string
  bar_count: number
  first_date: string
  last_date: string
}

interface Bar {
  t: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface IndicatorResponse {
  symbol: string
  timeframe: string
  bars: Bar[]
  series: Record<string, (number | null)[]>
}

// ── Indicator catalogue ───────────────────────────────────────────────────────

interface IndicatorDef {
  spec: string          // query param value sent to backend
  label: string
  pane: 'price' | 'oscillator' | 'volume'
  color: string
  produces?: string[]   // additional series keys produced (multi-output)
  dash?: string
}

const INDICATOR_GROUPS: { group: string; items: IndicatorDef[] }[] = [
  {
    group: 'Moving Averages',
    items: [
      { spec: 'ema_9',    label: 'EMA 9',    pane: 'price',      color: '#38bdf8' },
      { spec: 'ema_20',   label: 'EMA 20',   pane: 'price',      color: '#818cf8' },
      { spec: 'ema_50',   label: 'EMA 50',   pane: 'price',      color: '#a78bfa' },
      { spec: 'ema_200',  label: 'EMA 200',  pane: 'price',      color: '#f472b6' },
      { spec: 'sma_20',   label: 'SMA 20',   pane: 'price',      color: '#fb923c', dash: '4 2' },
      { spec: 'sma_50',   label: 'SMA 50',   pane: 'price',      color: '#fbbf24', dash: '4 2' },
      { spec: 'sma_200',  label: 'SMA 200',  pane: 'price',      color: '#f87171', dash: '4 2' },
      { spec: 'hull_ma_20', label: 'HMA 20', pane: 'price',      color: '#34d399' },
      { spec: 'vwma_20',  label: 'VWMA 20',  pane: 'price',      color: '#2dd4bf', dash: '6 2' },
    ],
  },
  {
    group: 'Bands & Channels',
    items: [
      { spec: 'bollinger_20', label: 'Bollinger (20)', pane: 'price', color: '#7dd3fc',
        produces: ['bb_upper', 'bb_mid', 'bb_lower'] },
      { spec: 'keltner',      label: 'Keltner (20)',   pane: 'price', color: '#86efac',
        produces: ['kc_upper', 'kc_mid', 'kc_lower'] },
      { spec: 'donchian_20',  label: 'Donchian (20)',  pane: 'price', color: '#fca5a5',
        produces: ['dc_upper', 'dc_mid', 'dc_lower'] },
    ],
  },
  {
    group: 'Trend & Momentum',
    items: [
      { spec: 'sar',          label: 'Parabolic SAR', pane: 'price',      color: '#e879f9' },
      { spec: 'macd',         label: 'MACD (12/26/9)', pane: 'oscillator', color: '#38bdf8',
        produces: ['macd', 'macd_signal', 'macd_hist'] },
      { spec: 'adx_14',       label: 'ADX (14)',       pane: 'oscillator', color: '#c084fc',
        produces: ['adx', 'plus_di', 'minus_di'] },
    ],
  },
  {
    group: 'Oscillators',
    items: [
      { spec: 'rsi_14',       label: 'RSI 14',         pane: 'oscillator', color: '#f59e0b' },
      { spec: 'rsi_3',        label: 'RSI 3',          pane: 'oscillator', color: '#fb923c' },
      { spec: 'stochastic',   label: 'Stochastic',     pane: 'oscillator', color: '#34d399',
        produces: ['stoch_k', 'stoch_d'] },
      { spec: 'ibs',          label: 'IBS',            pane: 'oscillator', color: '#a3e635' },
      { spec: 'zscore_20',    label: 'Z-Score (20)',   pane: 'oscillator', color: '#22d3ee' },
      { spec: 'bt_snipe',     label: 'BT Snipe',       pane: 'oscillator', color: '#f472b6' },
    ],
  },
  {
    group: 'Volume',
    items: [
      { spec: 'obv',          label: 'OBV',            pane: 'oscillator', color: '#94a3b8' },
      { spec: 'atr_14',       label: 'ATR (14)',        pane: 'oscillator', color: '#fb7185' },
    ],
  },
]

const ALL_INDICATORS: IndicatorDef[] = INDICATOR_GROUPS.flatMap(g => g.items)

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string, tf: string): string {
  const d = new Date(iso)
  if (tf === '1d' || tf === '1wk' || tf === '1mo') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  }
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ── Candlestick layer (via Recharts <Customized>) ─────────────────────────────
// Using Customized gives us direct access to xAxisMap/yAxisMap scales, which
// is the only reliable way to convert price→pixel in a ComposedChart.

function CandlestickLayer(props: any) {
  const { xAxisMap, yAxisMap, data } = props
  if (!data?.length) return null

  const xAxis = xAxisMap && Object.values(xAxisMap)[0] as any
  const yAxis = yAxisMap && Object.values(yAxisMap)[0] as any
  if (!yAxis?.scale) return null

  const yScale = yAxis.scale
  const xScale = xAxis?.scale

  // Compute a reasonable slot width for each candle. Prefer bandwidth()
  // when using a band scale; otherwise derive slot width from adjacent
  // pixel positions produced by the continuous xScale (time → px).
  let slotWidth: number
  if (xScale?.bandwidth) {
    slotWidth = xScale.bandwidth()
  } else {
    // Try to compute median difference between consecutive x positions
    try {
      const xs: number[] = data.map((d: any) => {
        const px = xScale ? xScale(d.tms) : NaN
        return typeof px === 'number' && !isNaN(px) ? px : NaN
      }).filter((v: number) => !isNaN(v))
      if (xs.length >= 2) {
        const diffs = [] as number[]
        for (let i = 1; i < xs.length; i++) diffs.push(Math.abs(xs[i] - xs[i - 1]))
        diffs.sort((a, b) => a - b)
        slotWidth = diffs[Math.floor(diffs.length / 2)]
      } else {
        const plotWidth = xAxis?.width ?? 600
        slotWidth = plotWidth / data.length
      }
    } catch (e) {
      const plotWidth = xAxis?.width ?? 600
      slotWidth = plotWidth / data.length
    }
  }

  const bw = Math.max(slotWidth - 2, 1)
  const xOffset = xAxis?.x ?? 0

  return (
    <g>
      {data.map((d: any, i: number) => {
        const { open, high, low, close } = d
        if (open == null || close == null || high == null || low == null) return null

        const bullish = close >= open
        const color = bullish ? 'var(--color-success)' : 'var(--color-danger)'

        // Compute pixel center for this candle. Prefer mapping the numeric
        // timestamp through the xScale; fall back to index-based placement.
        let cx: number | null = null
        if (xScale?.bandwidth) {
          // category/band scale (unlikely with numeric axis, but keep safe)
          cx = xOffset + (xScale(d.t) ?? 0) + xScale.bandwidth() / 2
        } else if (xScale) {
          const px = xScale(d.tms)
          if (typeof px === 'number' && !isNaN(px)) cx = px
        }
        if (cx == null) cx = xOffset + (i + 0.5) * slotWidth

        const yH = yScale(high)
        const yL = yScale(low)
        const yO = yScale(open)
        const yC = yScale(close)

        const bodyTop = Math.min(yO, yC)
        const bodyH = Math.max(Math.abs(yC - yO), 1)

        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
            <rect
              x={cx - bw / 2}
              y={bodyTop}
              width={bw}
              height={bodyH}
              fill={color}
              fillOpacity={0.85}
              stroke={color}
              strokeWidth={0.5}
            />
          </g>
        )
      })}
    </g>
  )
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, activeIndicators, tf }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const labelStr = typeof label === 'number' ? fmtDate(new Date(label).toISOString(), tf ?? '1d') : label

  return (
    <div
      className="rounded-lg text-xs px-3 py-2 space-y-1 shadow-xl"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-primary)',
        minWidth: 160,
      }}
    >
      <div className="font-semibold" style={{ color: 'var(--color-text-muted)' }}>{labelStr}</div>
      {d.open != null && (
        <div className="grid grid-cols-2 gap-x-3 font-mono">
          <span style={{ color: 'var(--color-text-faint)' }}>O</span><span>{d.open?.toFixed(2)}</span>
          <span style={{ color: 'var(--color-text-faint)' }}>H</span><span style={{ color: 'var(--color-success)' }}>{d.high?.toFixed(2)}</span>
          <span style={{ color: 'var(--color-text-faint)' }}>L</span><span style={{ color: 'var(--color-danger)' }}>{d.low?.toFixed(2)}</span>
          <span style={{ color: 'var(--color-text-faint)' }}>C</span>
          <span style={{ color: d.close >= d.open ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600 }}>
            {d.close?.toFixed(2)}
          </span>
        </div>
      )}
      {activeIndicators.map((ind: IndicatorDef) => {
        const keys = ind.produces ?? [ind.spec]
        return keys.map((k: string) => {
          const v = d[k]
          if (v == null) return null
          return (
            <div key={k} className="flex justify-between gap-3 font-mono">
              <span style={{ color: ind.color }}>{k}</span>
              <span>{typeof v === 'number' ? v.toFixed(3) : v}</span>
            </div>
          )
        })
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChartLab() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [selectedTf, setSelectedTf] = useState<string | null>(null)
  const [activeSpecs, setActiveSpecs] = useState<Set<string>>(new Set(['ema_20', 'rsi_14']))
  const [limit, setLimit] = useState(300)
  const [panelOpen, setPanelOpen] = useState(true)
  const [chartType, setChartType] = useState<'candles' | 'line'>('candles')

  // ── Zoom state ───────────────────────────────────────────────────────────────
  // zoomWindow = [startIdx, endIdx] into `rows`; null = show all
  const [zoomWindow, setZoomWindow] = useState<[number, number] | null>(null)
  const [dragStart, setDragStart] = useState<number | null>(null)   // index where drag began (visible rows)
  const [dragEnd, setDragEnd]     = useState<number | null>(null)   // index of current drag end (visible rows)
  const isDragging = dragStart !== null

  // Strategy-driven indicator auto-selection
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null)
  const { data: strategies } = useQuery({ queryKey: ['strategies'], queryFn: () => strategiesApi.list() })
  const { data: strategyDetail } = useQuery({
    queryKey: ['strategy', selectedStrategyId],
    queryFn: () => selectedStrategyId ? strategiesApi.get(selectedStrategyId) : Promise.resolve(null),
    enabled: !!selectedStrategyId,
  })

  // Collect indicator specs from a strategy config recursively
  function collectIndicators(obj: any, out = new Set<string>()) {
    if (obj == null) return out
    if (Array.isArray(obj)) {
      obj.forEach((v) => collectIndicators(v, out))
      return out
    }
    if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'indicator' && typeof v === 'string') out.add(v)
        else if (typeof v === 'string') {
          // match typical indicator tokens like rsi_14, ema_20, volume_sma_20
          if (/^[a-z_]+_\d+$/.test(v) || /^[a-z_]+$/.test(v)) {
            // avoid grabbing plain fields like 'timeframe' or 'symbols' by crude heuristic
            if (!['timeframe', 'duration_mode', 'category'].includes(k)) out.add(v)
          }
        } else {
          collectIndicators(v as any, out)
        }
      }
    }
    return out
  }

  // When a strategy is selected, auto-fill activeSpecs with its indicators
  useEffect(() => {
    if (!strategyDetail) return
    const config = (strategyDetail as any).versions?.[0]?.config ?? (strategyDetail as any).config ?? strategyDetail
    const set = collectIndicators(config)
    if (set.size > 0) setActiveSpecs(new Set(Array.from(set)))
  }, [strategyDetail])

  const strategyIndicatorSet = useMemo(() => {
    if (!strategyDetail) return new Set<string>()
    const config = (strategyDetail as any).versions?.[0]?.config ?? (strategyDetail as any).config ?? strategyDetail
    return collectIndicators(config)
  }, [strategyDetail])

  const visibleIndicatorGroups = useMemo(() => {
    if (!strategyIndicatorSet || strategyIndicatorSet.size === 0) return INDICATOR_GROUPS
    return INDICATOR_GROUPS.map(g => ({ group: g.group, items: g.items.filter(i => strategyIndicatorSet.has(i.spec) || (i.produces ?? []).some(p => strategyIndicatorSet.has(p))) })).filter(g => g.items.length > 0)
  }, [strategyIndicatorSet])

  // Build active indicator defs (include lightweight fallbacks for unknown specs)
  const activeIndicators = useMemo(() => {
    const defs: IndicatorDef[] = []
    for (const spec of Array.from(activeSpecs)) {
      const found = ALL_INDICATORS.find(i => i.spec === spec)
      if (found) defs.push(found)
      else {
        // create a fallback definition
        const pane: IndicatorDef['pane'] = /^(rsi|macd|stoch|zscore|ibs|obv|adx|atr|bt_snipe)/.test(spec) ? 'oscillator' : /volume|vwma|volume_sma/.test(spec) ? 'volume' : 'price'
        const label = spec.replace(/_/g, ' ').toUpperCase()
        defs.push({ spec, label, pane, color: '#94a3b8' })
      }
    }
    return defs
  }, [activeSpecs])

  const priceIndicators  = activeIndicators.filter(i => i.pane === 'price')
  const oscIndicators    = activeIndicators.filter(i => i.pane === 'oscillator')

  // Load inventory
  const { data: inventory } = useQuery({
    queryKey: ['data-inventory'],
    queryFn: () => api.get('/data/inventory').then(r => r.data.items as InventoryItem[]),
  })

  // Derive unique symbols + timeframes from inventory
  const symbols = useMemo(() =>
    [...new Set((inventory ?? []).map(i => i.symbol))].sort(), [inventory])

  const timeframesForSymbol = useMemo(() => {
    if (!selectedSymbol) return []
    return [...new Set((inventory ?? []).filter(i => i.symbol === selectedSymbol).map(i => i.timeframe))]
  }, [inventory, selectedSymbol])

  const selectedItem = useMemo(() =>
    (inventory ?? []).find(i => i.symbol === selectedSymbol && i.timeframe === selectedTf),
  [inventory, selectedSymbol, selectedTf])

  // Reset zoom when symbol/timeframe/limit changes
  React.useEffect(() => { setZoomWindow(null) }, [selectedSymbol, selectedTf, limit])

  // Auto-select first symbol/tf when inventory loads
  React.useEffect(() => {
    if (inventory?.length && !selectedSymbol) {
      setSelectedSymbol(inventory[0].symbol)
      setSelectedTf(inventory[0].timeframe)
    }
  }, [inventory, selectedSymbol])
  React.useEffect(() => {
    if (timeframesForSymbol.length && (!selectedTf || !timeframesForSymbol.includes(selectedTf))) {
      setSelectedTf(timeframesForSymbol[0])
    }
  }, [timeframesForSymbol, selectedTf])

  // Build indicator query string
  const indicatorQuery = useMemo(() => {
    // Always request data for any active spec; multi-output indicators send their root spec
    return Array.from(activeSpecs).join(',')
  }, [activeSpecs])

  // Fetch bars + indicators — pass provider from inventory so the backend finds the right cache file
  const provider = selectedItem?.source ?? 'yfinance'
  const { data: chartData, isLoading, error } = useQuery<IndicatorResponse>({
    queryKey: ['chart-lab', selectedSymbol, selectedTf, indicatorQuery, limit, provider],
    queryFn: () => api.get(`/data/indicators/${selectedSymbol}/${selectedTf}`, {
      params: { indicators: indicatorQuery, limit, provider },
    }).then(r => r.data),
    enabled: !!(selectedSymbol && selectedTf),
  })


  // Build chart rows: merge bar data with indicator series
  const rows = useMemo(() => {
    if (!chartData) return []
    const { bars, series } = chartData
    const keys = Object.keys(series)
    return bars.map((b, idx) => {
      const row: Record<string, any> = {
        // formatted label for ticks/tooltips
        t: fmtDate(b.t, selectedTf ?? '1d'),
        // numeric timestamp (ms) used for the X axis scaling
        tms: new Date(b.t).getTime(),
        open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
        // For candle shape rendering we need a "candle" value at the close price
        candle: b.close,
      }
      for (const k of keys) {
        row[k] = series[k][idx]
      }
      return row
    })
  }, [chartData, selectedTf])

  // Price domain with 5% padding
  const priceDomain = useMemo(() => {
    if (!chartData?.bars.length) return ['auto', 'auto'] as [string, string]
    const prices = chartData.bars.flatMap(b => [b.high, b.low])
    const mn = Math.min(...prices)
    const mx = Math.max(...prices)
    const pad = (mx - mn) * 0.05
    return [Math.floor((mn - pad) * 100) / 100, Math.ceil((mx + pad) * 100) / 100] as [number, number]
  }, [chartData])

  // Visible slice — either the zoomed window or all rows
  const visibleRows = useMemo(() => {
    if (!zoomWindow) return rows
    return rows.slice(zoomWindow[0], zoomWindow[1] + 1)
  }, [rows, zoomWindow])

  const visiblePriceDomain = useMemo(() => {
    if (!visibleRows.length) return priceDomain
    const prices = visibleRows.flatMap(r => [r.high, r.low])
    const mn = Math.min(...prices)
    const mx = Math.max(...prices)
    const pad = (mx - mn) * 0.05
    return [Math.floor((mn - pad) * 100) / 100, Math.ceil((mx + pad) * 100) / 100] as [number, number]
  }, [visibleRows, priceDomain])

  // Commit a drag selection (visible-row indices) to an absolute zoom window
  const commitZoomIndices = useCallback((visIdx1: number, visIdx2: number) => {
    if (visIdx1 == null || visIdx2 == null) return
    const offset = zoomWindow ? zoomWindow[0] : 0
    const a = offset + visIdx1
    const b = offset + visIdx2
    if (a === b) return
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    if (hi - lo < 2) return
    setZoomWindow([lo, hi])
  }, [zoomWindow])

  // Scroll-wheel zoom: shrink/expand window centered on hovered position
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const total = rows.length
    if (total === 0) return
    const [lo, hi] = zoomWindow ?? [0, total - 1]
    const visible = hi - lo
    const factor = e.deltaY > 0 ? 1.15 : 0.87   // scroll down = zoom out, up = zoom in
    const newVisible = Math.round(Math.min(Math.max(visible * factor, 10), total))
    const center = Math.round((lo + hi) / 2)
    const newLo = Math.max(0, center - Math.floor(newVisible / 2))
    const newHi = Math.min(total - 1, newLo + newVisible)
    if (newHi - newLo < 2) return
    setZoomWindow([newLo, newHi])
  }, [rows, zoomWindow])

  const toggleSpec = useCallback((spec: string) => {
    setActiveSpecs(prev => {
      const next = new Set(prev)
      if (next.has(spec)) next.delete(spec)
      else next.add(spec)
      return next
    })
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!inventory?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Activity size={36} style={{ color: 'var(--color-text-faint)' }} />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No cached data yet.</p>
        <p className="text-xs" style={{ color: 'var(--color-text-faint)' }}>
          Download data in <a href="/data" className="underline" style={{ color: 'var(--color-accent)' }}>Data Manager</a> first.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 h-full" style={{ minHeight: 0 }}>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold mr-2" style={{ color: 'var(--color-text-primary)' }}>Chart Lab</h1>

        {/* Strategy picker (auto-populates indicators) */}
        <select
          className="input text-sm py-1"
          value={selectedStrategyId ?? ''}
          onChange={e => setSelectedStrategyId(e.target.value || null)}
        >
          <option value="">(no strategy)</option>
          {(strategies ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        {/* Symbol picker */}
        <select
          className="input text-sm py-1"
          value={selectedSymbol ?? ''}
          onChange={e => setSelectedSymbol(e.target.value)}
        >
          {symbols.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Timeframe picker */}
        <select
          className="input text-sm py-1"
          value={selectedTf ?? ''}
          onChange={e => setSelectedTf(e.target.value)}
        >
          {timeframesForSymbol.map(tf => <option key={tf} value={tf}>{tf}</option>)}
        </select>

        {/* Bar limit */}
        <select
          className="input text-sm py-1"
          value={limit}
          onChange={e => setLimit(Number(e.target.value))}
        >
          {[100, 200, 300, 500, 750, 1000].map(n => (
            <option key={n} value={n}>{n} bars</option>
          ))}
        </select>

        {/* Data info */}
        {selectedItem && (
          <span className="text-xs ml-1" style={{ color: 'var(--color-text-faint)' }}>
            {selectedItem.first_date} → {selectedItem.last_date} · {selectedItem.bar_count.toLocaleString()} bars cached
          </span>
        )}

        {/* Chart type toggle */}
        <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {(['candles', 'line'] as const).map(type => (
            <button
              key={type}
              type="button"
              onClick={() => setChartType(type)}
              className="px-2.5 py-1 text-xs font-medium transition-all"
              style={{
                background: chartType === type ? 'var(--color-accent)' : 'transparent',
                color: chartType === type ? '#fff' : 'var(--color-text-faint)',
              }}
            >
              {type === 'candles' ? 'Candles' : 'Line'}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {zoomWindow && (
            <button
              className="btn-ghost text-xs flex items-center gap-1 py-1"
              onClick={() => { setZoomWindow(null); setDragStart(null); setDragEnd(null) }}
              style={{ color: 'var(--color-accent)' }}
            >
              ↺ Reset Zoom
            </button>
          )}
          {activeSpecs.size > 0 && (
            <span className="text-xs px-2 py-0.5 rounded" style={{
              background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
              color: 'var(--color-accent)',
            }}>
              {activeSpecs.size} active
            </span>
          )}
          <button
            className="btn-ghost text-xs flex items-center gap-1 py-1"
            onClick={() => setPanelOpen(p => !p)}
          >
            <Settings size={12} />
            {panelOpen ? 'Hide' : 'Show'} Indicators
            {panelOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {/* ── Indicator picker panel ── */}
      {panelOpen && (
        <div
          className="rounded-xl p-3"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-card)' }}
        >
          <div className="flex flex-wrap gap-4">
            {visibleIndicatorGroups.map(group => (
              <div key={group.group} className="min-w-[140px]">
                <div className="text-[10px] uppercase tracking-wide mb-1.5 font-semibold"
                  style={{ color: 'var(--color-text-faint)' }}>
                  {group.group}
                </div>
                <div className="space-y-1">
                  {group.items.map(ind => {
                    const on = activeSpecs.has(ind.spec)
                    return (
                      <button
                        key={ind.spec}
                        type="button"
                        onClick={() => toggleSpec(ind.spec)}
                        className="flex items-center gap-1.5 w-full text-left px-2 py-1 rounded text-xs transition-all"
                        style={{
                          background: on ? `color-mix(in srgb, ${ind.color} 18%, transparent)` : 'transparent',
                          border: `1px solid ${on ? ind.color : 'var(--color-border)'}`,
                          color: on ? ind.color : 'var(--color-text-faint)',
                          opacity: on ? 1 : 0.7,
                        }}
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: on ? ind.color : 'var(--color-border)' }}
                        />
                        {ind.label}
                        {on && (
                          <X size={9} className="ml-auto flex-shrink-0" style={{ color: ind.color }} />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Charts ── */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-text-faint)' }}>
          <span className="text-sm animate-pulse">Loading chart data…</span>
        </div>
      )}

      {error && (
        <div className="card text-sm" style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
          {(error as any)?.response?.data?.detail ?? (error as Error).message}
        </div>
      )}

      {!isLoading && !error && rows.length > 0 && (
        <div className="flex flex-col gap-0 flex-1" style={{ minHeight: 0 }}>

          {/* ── Price pane ── */}
          <div style={{ flex: '0 0 55%', minHeight: 280 }} onWheel={handleWheel}>
            <div className="text-[10px] uppercase tracking-wide px-1 mb-0.5" style={{ color: 'var(--color-text-faint)' }}>
              {selectedSymbol} · Price{priceIndicators.length > 0 ? ` + ${priceIndicators.map(i => i.label).join(', ')}` : ''}
              {zoomWindow && <span style={{ color: 'var(--color-accent)', marginLeft: 6 }}>· zoomed {visibleRows.length} bars</span>}
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={visibleRows}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                onMouseDown={(e: any) => typeof e?.activeTooltipIndex === 'number' && setDragStart(e.activeTooltipIndex)}
                onMouseMove={(e: any) => isDragging && typeof e?.activeTooltipIndex === 'number' && setDragEnd(e.activeTooltipIndex)}
                onMouseUp={() => {
                  if (dragStart !== null && dragEnd !== null) commitZoomIndices(dragStart, dragEnd)
                  setDragStart(null)
                  setDragEnd(null)
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} />
                <XAxis
                  dataKey="tms"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tick={{ fontSize: 9, fill: 'var(--color-text-faint)' }}
                  tickLine={false}
                  tickFormatter={(v: number) => fmtDate(new Date(v).toISOString(), selectedTf ?? '1d')}
                />
                <YAxis
                  domain={visiblePriceDomain}
                  tick={{ fontSize: 9, fill: 'var(--color-text-faint)' }}
                  tickLine={false}
                  width={58}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  orientation="right"
                />
                <Tooltip
                  content={<ChartTooltip activeIndicators={priceIndicators} tf={selectedTf} />}
                  cursor={{ stroke: 'var(--color-text-faint)', strokeDasharray: '3 3', strokeWidth: 1 }}
                />

                {/* Candlestick or line — toggled by chartType */}
                {chartType === 'candles' ? (
                  <Customized component={CandlestickLayer} />
                ) : (
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke="var(--color-accent)"
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                )}
                {/* Invisible line to anchor the y-axis domain to OHLC range */}
                {chartType === 'candles' && (
                  <Line dataKey="close" stroke="transparent" dot={false} isAnimationActive={false} legendType="none" />
                )}

                {/* Price-overlay indicators */}
                {priceIndicators.map(ind => {
                  const keys = ind.produces ?? [ind.spec]
                  return keys.map((k, ki) => (
                    <Line
                      key={k}
                      type="monotone"
                      dataKey={k}
                      stroke={ind.color}
                      strokeWidth={1.5}
                      strokeDasharray={ind.dash}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                      strokeOpacity={ki === 0 ? 1 : 0.6}
                    />
                  ))
                })}

                {/* Drag-to-zoom selection highlight */}
                {isDragging && dragStart !== null && dragEnd !== null && visibleRows[dragStart] && visibleRows[dragEnd] && (
                  <ReferenceArea
                    x1={visibleRows[dragStart].tms}
                    x2={visibleRows[dragEnd].tms}
                    strokeOpacity={0.3}
                    fill="var(--color-accent)"
                    fillOpacity={0.15}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ── Volume pane ── */}
          <div style={{ flex: '0 0 10%', minHeight: 50 }}>
            <div className="text-[10px] uppercase tracking-wide px-1 mb-0.5" style={{ color: 'var(--color-text-faint)' }}>Volume</div>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visibleRows} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="tms" hide />
                <YAxis tick={{ fontSize: 8, fill: 'var(--color-text-faint)' }} tickLine={false} width={58}
                  tickFormatter={(v: number) => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)}
                  orientation="right"
                />
                <RBar dataKey="volume" isAnimationActive={false}>
                  {visibleRows.map((r, i) => (
                    <Cell
                      key={i}
                      fill={r.close >= r.open ? 'var(--color-success)' : 'var(--color-danger)'}
                      fillOpacity={0.5}
                    />
                  ))}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── Oscillator pane ── */}
          {oscIndicators.length > 0 && (
            <div style={{ flex: '0 0 30%', minHeight: 120 }}>
              <div className="text-[10px] uppercase tracking-wide px-1 mb-0.5" style={{ color: 'var(--color-text-faint)' }}>
                {oscIndicators.map(i => i.label).join(' · ')}
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={visibleRows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="tms" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 9, fill: 'var(--color-text-faint)' }} tickLine={false} tickFormatter={(v: number) => fmtDate(new Date(v).toISOString(), selectedTf ?? '1d')} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-faint)' }} tickLine={false} width={58} orientation="right" />
                  <Tooltip
                    content={<ChartTooltip activeIndicators={oscIndicators} tf={selectedTf} />}
                    cursor={{ stroke: 'var(--color-text-faint)', strokeDasharray: '3 3', strokeWidth: 1 }}
                  />

                  {/* Reference lines for common levels */}
                  {oscIndicators.some(i => i.spec.startsWith('rsi')) && (
                    <>
                      <ReferenceLine y={70} stroke="var(--color-danger)" strokeDasharray="4 2" strokeOpacity={0.5} />
                      <ReferenceLine y={30} stroke="var(--color-success)" strokeDasharray="4 2" strokeOpacity={0.5} />
                      <ReferenceLine y={50} stroke="var(--color-border)" strokeDasharray="4 2" strokeOpacity={0.4} />
                    </>
                  )}
                  {oscIndicators.some(i => i.spec === 'stochastic') && (
                    <>
                      <ReferenceLine y={80} stroke="var(--color-danger)" strokeDasharray="4 2" strokeOpacity={0.5} />
                      <ReferenceLine y={20} stroke="var(--color-success)" strokeDasharray="4 2" strokeOpacity={0.5} />
                    </>
                  )}
                  {oscIndicators.some(i => ['zscore_20', 'bt_snipe'].includes(i.spec)) && (
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
                      <ReferenceLine y={0.2} stroke="var(--color-success)" strokeDasharray="4 2" strokeOpacity={0.5} />
                      <ReferenceLine y={0.5} stroke="var(--color-border)"  strokeDasharray="2 2" strokeOpacity={0.4} />
                    </>
                  )}

                  {/* MACD histogram as bars */}
                  {activeSpecs.has('macd') && (
                    <RBar dataKey="macd_hist" isAnimationActive={false} opacity={0.6}>
                      {visibleRows.map((r, i) => (
                        <Cell key={i} fill={(r.macd_hist ?? 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)'} />
                      ))}
                    </RBar>
                  )}

                  {/* All oscillator lines */}
                  {oscIndicators.map(ind => {
                    const keys = (ind.produces ?? [ind.spec]).filter(k => k !== 'macd_hist')
                    const colors: Record<string, string> = {
                      macd_signal: '#f472b6',
                      plus_di:  'var(--color-success)',
                      minus_di: 'var(--color-danger)',
                      stoch_d:  '#fb923c',
                    }
                    return keys.map((k, ki) => (
                      <Line
                        key={k}
                        type="monotone"
                        dataKey={k}
                        stroke={colors[k] ?? ind.color}
                        strokeWidth={ki === 0 ? 1.5 : 1}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                        strokeOpacity={ki === 0 ? 1 : 0.75}
                        strokeDasharray={ki > 0 ? '4 2' : undefined}
                      />
                    ))
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && selectedSymbol && selectedTf && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: 'var(--color-text-faint)' }}>
          <Activity size={28} />
          <p className="text-sm">No bars returned. Try downloading more data in Data Manager.</p>
        </div>
      )}
    </div>
  )
}
