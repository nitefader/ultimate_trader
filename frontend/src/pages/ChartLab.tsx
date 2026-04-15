/**
 * ChartLab — visualise indicators on saved OHLCV data.
 *
 * Price pane:  candlestick bars + price-scale overlays (MA, BB, Keltner, Donchian, SAR, Ichimoku)
 * Volume pane: bar chart
 * Oscillator pane: RSI, MACD, Stochastic, ADX, ATR, IBS, Z-score, BT_Snipe, OBV
 */
import React, { useCallback, useMemo, useState } from 'react'
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
  Cell,
} from 'recharts'
import { Activity, ChevronDown, ChevronUp, Settings, X } from 'lucide-react'
import api from '../api/client'

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

// ── Candlestick custom bar ────────────────────────────────────────────────────

function CandleBar(props: any) {
  const { x, y, width, payload } = props
  if (!payload) return null
  const { open, high, low, close } = payload
  if (open == null || close == null) return null

  const bullish = close >= open
  const fill = bullish ? 'var(--color-success)' : 'var(--color-danger)'
  const strokeColor = bullish ? 'var(--color-success)' : 'var(--color-danger)'

  // y-axis domain is set by the price range — we need to convert price→pixel
  // Recharts provides yAxis via the chart context; we get it through the shape props
  const { yAxis } = props
  if (!yAxis) return null
  const { scale } = yAxis
  if (!scale) return null

  const yHigh  = scale(high)
  const yLow   = scale(low)
  const yOpen  = scale(open)
  const yClose = scale(close)

  const bodyTop    = Math.min(yOpen, yClose)
  const bodyBottom = Math.max(yOpen, yClose)
  const bodyH      = Math.max(bodyBottom - bodyTop, 1)
  const cx         = x + width / 2

  return (
    <g>
      {/* Wick */}
      <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={strokeColor} strokeWidth={1} />
      {/* Body */}
      <rect
        x={x + 1}
        y={bodyTop}
        width={Math.max(width - 2, 1)}
        height={bodyH}
        fill={fill}
        stroke={strokeColor}
        strokeWidth={0.5}
        fillOpacity={0.85}
      />
    </g>
  )
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, activeIndicators }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null

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
      <div className="font-semibold" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
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

  const activeIndicators = useMemo(() =>
    ALL_INDICATORS.filter(ind => activeSpecs.has(ind.spec)),
  [activeSpecs])

  const priceIndicators  = activeIndicators.filter(i => i.pane === 'price')
  const oscIndicators    = activeIndicators.filter(i => i.pane === 'oscillator')

  // Build chart rows: merge bar data with indicator series
  const rows = useMemo(() => {
    if (!chartData) return []
    const { bars, series } = chartData
    const keys = Object.keys(series)
    return bars.map((b, idx) => {
      const row: Record<string, any> = {
        t: fmtDate(b.t, selectedTf ?? '1d'),
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

        <div className="ml-auto flex items-center gap-1.5">
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
            {INDICATOR_GROUPS.map(group => (
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
          <div style={{ flex: '0 0 55%', minHeight: 280 }}>
            <div className="text-[10px] uppercase tracking-wide px-1 mb-0.5" style={{ color: 'var(--color-text-faint)' }}>
              {selectedSymbol} · Price{priceIndicators.length > 0 ? ` + ${priceIndicators.map(i => i.label).join(', ')}` : ''}
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 9, fill: 'var(--color-text-faint)' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={priceDomain}
                  tick={{ fontSize: 9, fill: 'var(--color-text-faint)' }}
                  tickLine={false}
                  width={58}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  orientation="right"
                />
                <Tooltip
                  content={<ChartTooltip activeIndicators={priceIndicators} />}
                  cursor={{ stroke: 'var(--color-text-faint)', strokeDasharray: '3 3', strokeWidth: 1 }}
                />

                {/* Candlestick — rendered as a Bar with custom shape */}
                <RBar dataKey="candle" shape={<CandleBar />} isAnimationActive={false}>
                  {rows.map((r, i) => (
                    <Cell
                      key={i}
                      fill={r.close >= r.open ? 'var(--color-success)' : 'var(--color-danger)'}
                    />
                  ))}
                </RBar>

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
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ── Volume pane ── */}
          <div style={{ flex: '0 0 10%', minHeight: 50 }}>
            <div className="text-[10px] uppercase tracking-wide px-1 mb-0.5" style={{ color: 'var(--color-text-faint)' }}>Volume</div>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="t" hide />
                <YAxis tick={{ fontSize: 8, fill: 'var(--color-text-faint)' }} tickLine={false} width={58}
                  tickFormatter={(v: number) => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)}
                  orientation="right"
                />
                <RBar dataKey="volume" isAnimationActive={false}>
                  {rows.map((r, i) => (
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
                <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="t" tick={{ fontSize: 9, fill: 'var(--color-text-faint)' }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-faint)' }} tickLine={false} width={58} orientation="right" />
                  <Tooltip
                    content={<ChartTooltip activeIndicators={oscIndicators} />}
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
                      {rows.map((r, i) => (
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
