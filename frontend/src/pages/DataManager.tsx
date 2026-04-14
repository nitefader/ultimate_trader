import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePollingGate } from '../hooks/usePollingGate'
import { DatePickerInput } from '../components/DatePickerInput'
import {
  Database, Search, Download, Trash2, RefreshCw, CheckCircle2,
  XCircle, AlertTriangle, ChevronRight, Info, Zap, BarChart2,
  Calendar, HardDrive, Clock, ArrowLeft,
} from 'lucide-react'
import clsx from 'clsx'
import { dataApi, type DataItem, type TickerResult, type BatchFetchResult } from '../api/data'
import { accountsApi } from '../api/accounts'
import type { Account } from '../types'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Tooltip } from '../components/Tooltip'

// ── Wizard step definitions ───────────────────────────────────────────────────

type Provider = 'yfinance' | 'alpaca'
type WizardStep = 'provider' | 'symbol' | 'configure' | 'review' | 'done'

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'provider',   label: 'Provider'   },
  { id: 'symbol',     label: 'Symbol'     },
  { id: 'configure',  label: 'Configure'  },
  { id: 'review',     label: 'Review'     },
  { id: 'done',       label: 'Done'       },
]

// yFinance timeframe constraints
const YF_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo']
const YF_MAX_DAYS: Record<string, number> = { '1m': 7, '5m': 60, '15m': 60, '30m': 60, '1h': 730 }

// Alpaca timeframes
const ALP_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1wk', '1mo']

function getMinStartDate(provider: Provider, timeframe: string): string {
  if (provider === 'yfinance' && YF_MAX_DAYS[timeframe]) {
    const d = new Date()
    d.setDate(d.getDate() - YF_MAX_DAYS[timeframe])
    return d.toISOString().split('T')[0]
  }
  if (provider === 'alpaca') return '2016-01-01'
  return '2000-01-01'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Breadcrumb({ step, stepIndex }: { step: WizardStep; stepIndex: number }) {
  return (
    <nav className="flex items-center gap-1 mb-6 flex-wrap">
      {STEPS.slice(0, -1).map((s, i) => {
        const isActive  = s.id === step
        const isDone    = i < stepIndex
        const isFuture  = i > stepIndex
        return (
          <React.Fragment key={s.id}>
            <span
              className={clsx(
                'text-xs font-semibold px-2.5 py-1 rounded transition-all',
                isActive  && 'bg-sky-600 text-white',
                isDone    && 'bg-emerald-900/60 text-emerald-400',
                isFuture  && 'text-gray-600',
              )}
            >
              {isDone && <CheckCircle2 size={10} className="inline mr-1" />}
              {s.label}
            </span>
            {i < STEPS.length - 2 && (
              <ChevronRight size={12} className={clsx('flex-shrink-0', isFuture ? 'text-gray-700' : 'text-gray-500')} />
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}

// ── Step 1: Provider ──────────────────────────────────────────────────────────

function ProviderStep({
  selected,
  onSelect,
}: {
  selected: Provider | null
  onSelect: (p: Provider) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-100 mb-1">Choose Data Provider</h2>
        <p className="text-sm text-gray-400">Select where to download historical OHLCV data from.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {/* Yahoo Finance */}
        <button
          onClick={() => onSelect('yfinance')}
          className={clsx(
            'card text-left transition-all hover:border-sky-600',
            selected === 'yfinance' ? 'border-sky-500 bg-sky-950/40' : 'border-gray-700',
          )}
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="font-bold text-gray-100 text-base">Yahoo Finance</div>
              <div className="text-xs text-emerald-400 font-semibold mt-0.5">Free · No credentials needed</div>
            </div>
            {selected === 'yfinance' && (
              <CheckCircle2 size={18} className="text-sky-400 flex-shrink-0" />
            )}
          </div>
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500" />Up to 20+ years of daily data</li>
            <li className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500" />Stocks, ETFs, indices, crypto, forex</li>
            <li className="flex items-center gap-2"><AlertTriangle size={12} className="text-amber-500" />Intraday limited: 1m → 7 days, 5–30m → 60 days</li>
            <li className="flex items-center gap-2"><AlertTriangle size={12} className="text-amber-500" />4h timeframe not supported</li>
            <li className="flex items-center gap-2"><Info size={12} className="text-gray-500" />Adjusted prices (splits &amp; dividends)</li>
          </ul>
          <div className="mt-3 text-xs text-gray-600 bg-gray-800/60 rounded p-2">
            Best for: Daily &amp; weekly backtests, long history, no broker account needed
          </div>
        </button>

        {/* Alpaca */}
        <button
          onClick={() => onSelect('alpaca')}
          className={clsx(
            'card text-left transition-all hover:border-orange-600',
            selected === 'alpaca' ? 'border-orange-500 bg-orange-950/30' : 'border-gray-700',
          )}
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="font-bold text-gray-100 text-base">Alpaca Markets</div>
              <div className="text-xs text-orange-400 font-semibold mt-0.5">Requires API credentials</div>
            </div>
            {selected === 'alpaca' && (
              <CheckCircle2 size={18} className="text-orange-400 flex-shrink-0" />
            )}
          </div>
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500" />History from 2016 for US equities</li>
            <li className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500" />Full intraday: 1m, 5m, 15m, 30m, 1h, <strong className="text-orange-300">4h</strong></li>
            <li className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500" />Split + dividend adjusted</li>
            <li className="flex items-center gap-2"><AlertTriangle size={12} className="text-amber-500" />US equities &amp; crypto only</li>
            <li className="flex items-center gap-2"><Info size={12} className="text-gray-500" />Paper keys work for data access</li>
          </ul>
          <div className="mt-3 text-xs text-gray-600 bg-gray-800/60 rounded p-2">
            Best for: Intraday strategies, 4h data, broker-consistent prices
          </div>
        </button>
      </div>
    </div>
  )
}

// ── Step 2: Symbol ────────────────────────────────────────────────────────────

function SymbolStep({
  provider,
  selected,
  alpacaKey,
  alpacaSecret,
  onSelect,
  onAlpacaKeyChange,
  onAlpacaSecretChange,
}: {
  provider: Provider
  selected: string[]
  alpacaKey: string
  alpacaSecret: string
  onSelect: (syms: string[]) => void
  onAlpacaKeyChange: (k: string) => void
  onAlpacaSecretChange: (s: string) => void
}) {
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  // Debounce search
  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timerRef.current)
  }, [query])

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })
  const alpacaAccounts = accounts.filter(a => a.broker === 'alpaca')

  const searchEnabled = provider === 'yfinance'
    ? debouncedQuery.length >= 1
    : debouncedQuery.length >= 1 && !!alpacaKey && !!alpacaSecret

  const { data: searchData, isFetching } = useQuery({
    queryKey: ['ticker-search', debouncedQuery, provider, alpacaKey],
    queryFn: () => dataApi.search(debouncedQuery, provider, alpacaKey, alpacaSecret, 12),
    enabled: searchEnabled,
    staleTime: 10_000,
  })

  const results: TickerResult[] = searchData?.results ?? []

  const toggle = (sym: string) => {
    onSelect(
      selected.includes(sym) ? selected.filter(s => s !== sym) : [...selected, sym]
    )
  }

  const loadFromAccount = (acc: Account) => {
    const cfg = acc.broker_config as any
    const paper = cfg?.paper ?? {}
    onAlpacaKeyChange(paper.api_key ?? '')
    onAlpacaSecretChange(paper.secret_key ?? '')
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-100 mb-1">Search &amp; Select Symbols</h2>
        <p className="text-sm text-gray-400">
          {provider === 'yfinance'
            ? 'Search any ticker — stocks, ETFs, indices, crypto.'
            : 'Search US equities and crypto on Alpaca.'}
        </p>
      </div>

      {/* Alpaca creds */}
      {provider === 'alpaca' && (
        <div className="card border-orange-900/60 bg-orange-950/20 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-orange-300">Alpaca Credentials Required</span>
            {alpacaAccounts.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Load from account:</span>
                {alpacaAccounts.map(a => (
                  <button
                    key={a.id}
                    onClick={() => loadFromAccount(a)}
                    className="text-xs text-orange-400 hover:text-orange-300 underline"
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">API Key</label>
              <input
                className="input w-full font-mono text-xs"
                placeholder="PK... or AK..."
                value={alpacaKey}
                onChange={e => onAlpacaKeyChange(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Secret Key</label>
              <input
                type="password"
                className="input w-full font-mono text-xs"
                placeholder="••••••••••••••••"
                value={alpacaSecret}
                onChange={e => onAlpacaSecretChange(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-gray-600">Paper keys work for data access. Keys are only used for this download session.</p>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <label className="label">Search Ticker</label>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            ref={inputRef}
            className="input w-full pl-9"
            placeholder={provider === 'yfinance' ? 'SPY, AAPL, BTC-USD...' : 'AAPL, TSLA, MSFT...'}
            value={query}
            onChange={e => { setQuery(e.target.value); setShowDropdown(true) }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          />
          {isFetching && (
            <RefreshCw size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />
          )}
        </div>

        {showDropdown && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 bg-gray-900 border border-gray-700 rounded-b-lg mt-0.5 z-20 max-h-60 overflow-y-auto shadow-xl">
            {results.map(r => (
              <button
                key={r.symbol}
                onMouseDown={() => { toggle(r.symbol); setQuery(''); setShowDropdown(false) }}
                className={clsx(
                  'w-full text-left px-4 py-2.5 hover:bg-gray-800 flex items-center justify-between transition-colors',
                  selected.includes(r.symbol) && 'bg-sky-950/40',
                )}
              >
                <div>
                  <span className="font-mono font-bold text-sm text-gray-100">{r.symbol}</span>
                  <span className="text-xs text-gray-400 ml-2">{r.name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-600">{r.exchange}</span>
                  {selected.includes(r.symbol) && <CheckCircle2 size={12} className="text-sky-400" />}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Popular symbols quick-add */}
      <div>
        <div className="text-xs text-gray-500 mb-2">Quick add popular symbols:</div>
        <div className="flex flex-wrap gap-2">
          {['SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMZN', 'META'].map(sym => (
            <button
              key={sym}
              onClick={() => toggle(sym)}
              className={clsx(
                'px-2.5 py-1 rounded text-xs font-mono font-semibold transition-all border',
                selected.includes(sym)
                  ? 'border-sky-500 bg-sky-950/60 text-sky-300'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200',
              )}
            >
              {selected.includes(sym) && '✓ '}{sym}
            </button>
          ))}
        </div>
      </div>

      {/* Selected list */}
      {selected.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-2">Selected ({selected.length}):</div>
          <div className="flex flex-wrap gap-2">
            {selected.map(sym => (
              <span
                key={sym}
                className="flex items-center gap-1.5 bg-sky-900/60 text-sky-300 px-2.5 py-1 rounded text-xs font-mono font-semibold"
              >
                {sym}
                <button onClick={() => toggle(sym)} className="hover:text-white">
                  <XCircle size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step 3: Configure ─────────────────────────────────────────────────────────

function ConfigureStep({
  provider,
  timeframe,
  start,
  end,
  force,
  onTimeframe,
  onStart,
  onEnd,
  onForce,
}: {
  provider: Provider
  timeframe: string
  start: string
  end: string
  force: boolean
  onTimeframe: (t: string) => void
  onStart: (s: string) => void
  onEnd: (s: string) => void
  onForce: (f: boolean) => void
}) {
  const timeframes = provider === 'alpaca' ? ALP_TIMEFRAMES : YF_TIMEFRAMES
  const minStart = getMinStartDate(provider, timeframe)
  const isIntraday = ['1m', '5m', '15m', '30m', '1h', '4h'].includes(timeframe)
  const maxDays = provider === 'yfinance' ? YF_MAX_DAYS[timeframe] : null

  const TIMEFRAME_LABELS: Record<string, string> = {
    '1m': '1 Minute', '5m': '5 Minutes', '15m': '15 Minutes', '30m': '30 Minutes',
    '1h': '1 Hour', '4h': '4 Hours', '1d': '1 Day', '1wk': '1 Week', '1mo': '1 Month',
  }

  // Smart defaults based on timeframe
  const handleTimeframeChange = (tf: string) => {
    onTimeframe(tf)
    const newMin = getMinStartDate(provider, tf)
    if (start < newMin) onStart(newMin)
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-100 mb-1">Configure Download</h2>
        <p className="text-sm text-gray-400">Set the timeframe and date range for your historical data.</p>
      </div>

      {/* Timeframe */}
      <div>
        <label className="label">Timeframe</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {timeframes.map(tf => (
            <button
              key={tf}
              onClick={() => handleTimeframeChange(tf)}
              className={clsx(
                'px-3 py-1.5 rounded text-sm font-mono font-semibold border transition-all',
                timeframe === tf
                  ? 'border-sky-500 bg-sky-950/60 text-sky-300'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500',
                tf === '4h' && provider === 'alpaca' && 'border-orange-800 text-orange-400',
              )}
            >
              {tf}
              {tf === '4h' && provider === 'alpaca' && (
                <span className="ml-1 text-xs text-orange-500">★</span>
              )}
            </button>
          ))}
        </div>
        {timeframe && (
          <p className="text-xs text-gray-500 mt-1.5">
            {TIMEFRAME_LABELS[timeframe] || timeframe} bars
            {timeframe === '4h' && ' — exclusive to Alpaca'}
          </p>
        )}
      </div>

      {/* Constraint hint */}
      {isIntraday && maxDays && (
        <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-900/60 rounded-lg px-3 py-2.5">
          <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">
            <strong>yFinance limit:</strong> {timeframe} data is only available for the last <strong>{maxDays} days</strong>.
            The start date has been automatically adjusted.
          </p>
        </div>
      )}

      {/* Date range */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Start Date</label>
          <DatePickerInput
            className="w-full"
            value={start}
            min={minStart}
            max={end}
            onChange={onStart}
          />
          {start < minStart && (
            <p className="text-xs text-red-400 mt-1">
              Minimum start date for {timeframe} on {provider}: {minStart}
            </p>
          )}
        </div>
        <div>
          <label className="label">End Date</label>
          <DatePickerInput
            className="w-full"
            value={end}
            min={start}
            max={new Date().toISOString().split('T')[0]}
            onChange={onEnd}
          />
        </div>
      </div>

      {/* Summary pill */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 bg-gray-800/50 rounded-lg p-3">
        <BarChart2 size={12} />
        <span>Provider: <strong className="text-gray-200">{provider === 'yfinance' ? 'Yahoo Finance' : 'Alpaca'}</strong></span>
        <span>·</span>
        <span>Timeframe: <strong className="text-gray-200">{timeframe}</strong></span>
        <span>·</span>
        <span>Range: <strong className="text-gray-200">{start} → {end}</strong></span>
      </div>

      {/* Advanced options */}
      <div className="border-t border-gray-800 pt-4">
        <div className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Advanced Options</div>
        <label className="flex items-center gap-3 cursor-pointer group">
          <div
            onClick={() => onForce(!force)}
            className={clsx(
              'w-10 h-5 rounded-full transition-colors relative cursor-pointer',
              force ? 'bg-sky-600' : 'bg-gray-700',
            )}
          >
            <div className={clsx(
              'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
              force ? 'translate-x-5' : 'translate-x-0.5',
            )} />
          </div>
          <div>
            <div className="text-sm text-gray-300">Force re-download</div>
            <div className="text-xs text-gray-500">Overwrite existing cache even if already up to date</div>
          </div>
        </label>
      </div>
    </div>
  )
}

// ── Step 4: Review ────────────────────────────────────────────────────────────

function ReviewStep({
  provider,
  symbols,
  timeframe,
  start,
  end,
  force,
  cachedItems,
}: {
  provider: Provider
  symbols: string[]
  timeframe: string
  start: string
  end: string
  force: boolean
  cachedItems: DataItem[]
}) {
  const cachedSet = new Set(
    cachedItems
      .filter(c => c.timeframe === timeframe && c.provider === provider)
      .map(c => c.symbol)
  )

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-100 mb-1">Review &amp; Confirm</h2>
        <p className="text-sm text-gray-400">Confirm the download parameters below.</p>
      </div>

      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div className="text-gray-500">Provider</div>
          <div className="text-gray-100 font-semibold">{provider === 'yfinance' ? 'Yahoo Finance' : 'Alpaca Markets'}</div>
          <div className="text-gray-500">Timeframe</div>
          <div className="text-gray-100 font-mono font-semibold">{timeframe}</div>
          <div className="text-gray-500">Date Range</div>
          <div className="text-gray-100">{start} → {end}</div>
          <div className="text-gray-500">Force Download</div>
          <div className={force ? 'text-amber-400' : 'text-gray-400'}>{force ? 'Yes (overwrite)' : 'No (use cache if fresh)'}</div>
        </div>
      </div>

      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Symbols ({symbols.length})</div>
        <div className="space-y-1">
          {symbols.map(sym => {
            const isCached = cachedSet.has(sym)
            return (
              <div key={sym} className="flex items-center justify-between bg-gray-800/50 rounded px-3 py-2">
                <span className="font-mono font-bold text-gray-100">{sym}</span>
                {isCached ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 size={12} />
                    {force ? 'Will re-download' : 'Cache exists — incremental update'}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-sky-400">
                    <Download size={12} />
                    New download
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Step 5: Done ──────────────────────────────────────────────────────────────

function DoneStep({
  results,
  provider,
  onReset,
}: {
  results: Array<{ symbol: string; status: string; bar_count?: number; error?: string; first_date?: string; last_date?: string }>
  provider: Provider | null
  onReset: () => void
}) {
  const ok = results.filter(r => r.status === 'ok')
  const failed = results.filter(r => r.status !== 'ok')
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {failed.length === 0 ? (
          <CheckCircle2 size={28} className="text-emerald-400 flex-shrink-0" />
        ) : (
          <AlertTriangle size={28} className="text-amber-400 flex-shrink-0" />
        )}
        <div>
          <h2 className="text-lg font-bold text-gray-100">
            {failed.length === 0 ? 'Download Complete' : `${ok.length} succeeded, ${failed.length} failed`}
          </h2>
          <p className="text-sm text-gray-400">{ok.length} dataset{ok.length !== 1 ? 's' : ''} ready for backtesting.</p>
        </div>
      </div>

      <div className="space-y-1">
        {results.map(r => (
          <div key={r.symbol} className={clsx(
            'flex items-center justify-between rounded px-3 py-2',
            r.status === 'ok' ? 'bg-emerald-950/30' : 'bg-red-950/30',
          )}>
            <span className="font-mono font-bold text-sm text-gray-100">{r.symbol}</span>
            {r.status === 'ok' ? (
              <span className="text-xs text-emerald-400">
                {r.bar_count?.toLocaleString()} bars · {r.first_date} → {r.last_date} · source: {provider === 'alpaca' ? 'Alpaca' : 'Yahoo Finance'}
              </span>
            ) : (
              <span className="text-xs text-red-400">{r.error}</span>
            )}
          </div>
        ))}
      </div>

      <button onClick={onReset} className="btn-ghost flex items-center gap-2">
        <ArrowLeft size={14} /> Download More
      </button>
    </div>
  )
}

// ── Inventory table ───────────────────────────────────────────────────────────

function InventoryTable({
  items,
  onDelete,
  deletingKey,
}: {
  items: DataItem[]
  onDelete: (symbol: string, timeframe: string, provider: string) => void
  deletingKey: string | null
}) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<DataItem | null>(null)
  const filtered = items.filter(
    i => i.symbol.toLowerCase().includes(filter.toLowerCase())
  )

  const { data: chartData, isLoading: chartLoading, isError: chartIsError, error: chartErrorRaw } = useQuery({
    queryKey: ['data-bars', selected?.symbol, selected?.timeframe, selected?.provider],
    queryFn: () => dataApi.getBars(selected!.symbol, selected!.timeframe, selected!.provider),
    enabled: !!selected,
    staleTime: 30_000,
  })
  const previewBars = (chartData?.bars ?? []).slice(-20).reverse()

  const chartErrorMessage = (() => {
    const err = chartErrorRaw as any
    return err?.response?.data?.detail ?? err?.message ?? 'Failed to load cached bars.'
  })()

  if (items.length === 0) {
    return (
      <div className="card text-center py-10">
        <Database size={32} className="text-gray-700 mx-auto mb-3" />
        <p className="text-sm text-gray-500 font-semibold">No cached datasets yet</p>
        <p className="text-xs text-gray-600 mt-1">Use the wizard above to download historical data.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-300">Cached Datasets</h3>
          <span className="badge badge-gray">{items.length}</span>
        </div>
        <input
          className="input text-xs py-1 w-40"
          placeholder="Filter symbol..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/60">
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Symbol</th>
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">TF</th>
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Data Source</th>
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Coverage</th>
              <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Bars</th>
              <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium uppercase tracking-wide">Size</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((item, i) => {
              const key = `${item.symbol}_${item.timeframe}_${item.provider}`
              const isDeleting = deletingKey === key
              const isSelected = selected?.symbol === item.symbol && selected?.timeframe === item.timeframe && selected?.provider === item.provider
              return (
                <tr
                  key={i}
                  className={clsx(
                    'border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors cursor-pointer',
                    isSelected && 'bg-sky-900/20 ring-1 ring-sky-700/40',
                  )}
                  onClick={() => setSelected(isSelected ? null : item)}
                >
                  <td className="px-4 py-2.5 font-mono font-bold text-emerald-400">{item.symbol}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{item.timeframe}</td>
                  <td className="px-4 py-2.5">
                    <span className={clsx(
                      'badge text-xs',
                      item.provider === 'alpaca' ? 'bg-orange-900/60 text-orange-300' : 'bg-gray-800 text-gray-400',
                    )}>
                      {item.provider === 'alpaca' ? 'Alpaca' : 'Yahoo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {item.first_date} → {item.last_date}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-300 text-xs">
                    {item.bar_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                    {item.file_size_kb} KB
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Tooltip content="Visualize chart">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelected(isSelected ? null : item); }}
                        className={clsx('transition-colors p-1 mr-1', isSelected ? 'text-sky-400' : 'text-gray-500 hover:text-sky-400')}
                      >
                        <BarChart2 size={13} />
                      </button>
                    </Tooltip>
                    <Tooltip content="Delete cache">
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(item.symbol, item.timeframe, item.provider); }}
                        disabled={isDeleting}
                        className="text-gray-600 hover:text-red-400 transition-colors p-1"
                      >
                        {isDeleting ? (
                          <RefreshCw size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                      </button>
                    </Tooltip>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="card mt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-gray-200">
                {selected.symbol} {selected.timeframe} chart
              </div>
              <div className="text-xs text-gray-500">
                Source: {selected.provider === 'alpaca' ? 'Alpaca Markets' : 'Yahoo Finance'} · {selected.first_date} to {selected.last_date}
              </div>
            </div>
            <button className="text-xs text-gray-500 hover:text-gray-300" onClick={() => setSelected(null)}>Close</button>
          </div>

          {chartLoading ? (
            <div className="text-sm text-gray-500 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" />Loading chart...</div>
          ) : chartIsError ? (
            <div className="text-sm text-red-400">
              Failed to load chart data: {chartErrorMessage}
              {String(chartErrorMessage).includes('404') || String(chartErrorMessage).includes('Not Found') ? (
                <span className="text-xs text-gray-500 block mt-1">If backend was running before this feature was added, restart it so the new /data/bars endpoint is available.</span>
              ) : null}
            </div>
          ) : !chartData || chartData.bars.length === 0 ? (
            <div className="text-sm text-gray-500">No bars found in cache for this dataset.</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  Showing last {chartData.bars.length.toLocaleString()} bars
                </span>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData.bars} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
                    <defs>
                      <linearGradient id="dmClose" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(v) => String(v).slice(0, 10)} minTickGap={30} />
                    <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} width={68} domain={["auto", "auto"]} />
                    <YAxis yAxisId="volume" hide domain={[0, 'dataMax']} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                      labelStyle={{ color: '#cbd5e1', fontSize: 12 }}
                      formatter={(value: number, name: string) => {
                        if (name === 'close') return [value.toFixed(2), 'Close']
                        return [Math.round(value).toLocaleString(), 'Volume']
                      }}
                    />
                    <Area yAxisId="price" type="monotone" dataKey="close" stroke="#38bdf8" strokeWidth={1.8} fill="url(#dmClose)" dot={false} />
                    <Area yAxisId="volume" type="monotone" dataKey="volume" stroke="#64748b" fill="#1e293b" fillOpacity={0.2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                  Downloaded Data Preview (latest {previewBars.length} bars)
                </div>
                <div className="border border-gray-800 rounded overflow-hidden">
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-900/70 sticky top-0">
                        <tr className="border-b border-gray-800">
                          <th className="text-left px-3 py-2 text-gray-500 font-medium uppercase tracking-wide">Date</th>
                          <th className="text-right px-3 py-2 text-gray-500 font-medium uppercase tracking-wide">Open</th>
                          <th className="text-right px-3 py-2 text-gray-500 font-medium uppercase tracking-wide">High</th>
                          <th className="text-right px-3 py-2 text-gray-500 font-medium uppercase tracking-wide">Low</th>
                          <th className="text-right px-3 py-2 text-gray-500 font-medium uppercase tracking-wide">Close</th>
                          <th className="text-right px-3 py-2 text-gray-500 font-medium uppercase tracking-wide">Volume</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewBars.map((b, i) => (
                          <tr key={`${b.t}_${i}`} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                            <td className="px-3 py-1.5 text-gray-300 font-mono">{String(b.t).slice(0, 10)}</td>
                            <td className="px-3 py-1.5 text-right text-gray-300">{b.open.toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-right text-emerald-300">{b.high.toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-right text-rose-300">{b.low.toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-right text-sky-300">{b.close.toFixed(2)}</td>
                            <td className="px-3 py-1.5 text-right text-gray-400">{Math.round(b.volume).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main DataManager ──────────────────────────────────────────────────────────

export function DataManager() {
  const pausePolling = usePollingGate()
  const queryClient = useQueryClient()
  const [showWizard, setShowWizard] = useState(false)
  const [step, setStep] = useState<WizardStep>('provider')
  const stepIndex = STEPS.findIndex(s => s.id === step)

  // Wizard state
  const [provider, setProvider] = useState<Provider | null>(null)
  const [symbols, setSymbols] = useState<string[]>([])
  const [alpacaKey, setAlpacaKey] = useState('')
  const [alpacaSecret, setAlpacaSecret] = useState('')
  const [timeframe, setTimeframe] = useState('1d')
  const [start, setStart] = useState('2020-01-01')
  const [end, setEnd] = useState(new Date().toISOString().split('T')[0])
  const [force, setForce] = useState(false)
  const [downloadResults, setDownloadResults] = useState<any[]>([])
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const { data: inventory = [], refetch: refetchInventory } = useQuery({
    queryKey: ['data-inventory'],
    queryFn: dataApi.getInventory,
    refetchInterval: pausePolling ? false : 30_000,
  })

  const downloadMutation = useMutation<BatchFetchResult>({
    mutationFn: () => {
      if (symbols.length === 1) {
        return dataApi.fetch({
          symbol: symbols[0],
          timeframe,
          start,
          end,
          provider: provider!,
          force,
          api_key: alpacaKey,
          secret_key: alpacaSecret,
        }).then(r => ({ results: [{ ...r, status: 'ok' as const }] }))
      }
      return dataApi.fetchMany({
        symbols,
        timeframe,
        start,
        end,
        provider: provider!,
        api_key: alpacaKey,
        secret_key: alpacaSecret,
      })
    },
    onSuccess: (data) => {
      setDownloadResults(data.results)
      setStep('done')
      refetchInventory()
      queryClient.invalidateQueries({ queryKey: ['data-inventory'] })
    },
    onError: (err: any) => {
      setDownloadResults(symbols.map(s => ({
        symbol: s,
        status: 'error',
        error: err?.response?.data?.detail ?? err.message,
      })))
      setStep('done')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: ({ symbol, timeframe, provider }: { symbol: string; timeframe: string; provider: string }) =>
      dataApi.deleteCache(symbol, timeframe, provider),
    onMutate: ({ symbol, timeframe, provider }) =>
      setDeletingKey(`${symbol}_${timeframe}_${provider}`),
    onSettled: () => {
      setDeletingKey(null)
      refetchInventory()
    },
  })

  const canProceed = (() => {
    if (step === 'provider') return !!provider
    if (step === 'symbol')   return symbols.length > 0 && (provider !== 'alpaca' || (!!alpacaKey && !!alpacaSecret))
    if (step === 'configure') return !!timeframe && !!start && !!end && start <= end
    return true
  })()

  const nextStep = () => {
    const order: WizardStep[] = ['provider', 'symbol', 'configure', 'review', 'done']
    const idx = order.indexOf(step)
    if (step === 'review') {
      downloadMutation.mutate()
    } else {
      setStep(order[idx + 1])
    }
  }

  const prevStep = () => {
    const order: WizardStep[] = ['provider', 'symbol', 'configure', 'review', 'done']
    const idx = order.indexOf(step)
    if (idx > 0) setStep(order[idx - 1])
  }

  const resetWizard = () => {
    setStep('provider')
    setProvider(null)
    setSymbols([])
    setAlpacaKey('')
    setAlpacaSecret('')
    setTimeframe('1d')
    setStart('2020-01-01')
    setEnd(new Date().toISOString().split('T')[0])
    setForce(false)
    setDownloadResults([])
    setShowWizard(false)
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Data Manager</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Download and manage historical OHLCV data for backtesting
          </p>
        </div>
        {!showWizard && (
          <button
            onClick={() => setShowWizard(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Download size={14} /> Download Data
          </button>
        )}
      </div>

      {/* Wizard panel */}
      {showWizard && (
        <div className="card border-sky-900/40">
          {step !== 'done' && <Breadcrumb step={step} stepIndex={stepIndex} />}

          {step === 'provider' && (
            <ProviderStep selected={provider} onSelect={(p) => { setProvider(p); setTimeframe('1d') }} />
          )}
          {step === 'symbol' && provider && (
            <SymbolStep
              provider={provider}
              selected={symbols}
              alpacaKey={alpacaKey}
              alpacaSecret={alpacaSecret}
              onSelect={setSymbols}
              onAlpacaKeyChange={setAlpacaKey}
              onAlpacaSecretChange={setAlpacaSecret}
            />
          )}
          {step === 'configure' && provider && (
            <ConfigureStep
              provider={provider}
              timeframe={timeframe}
              start={start}
              end={end}
              force={force}
              onTimeframe={setTimeframe}
              onStart={setStart}
              onEnd={setEnd}
              onForce={setForce}
            />
          )}
          {step === 'review' && provider && (
            <ReviewStep
              provider={provider}
              symbols={symbols}
              timeframe={timeframe}
              start={start}
              end={end}
              force={force}
              cachedItems={inventory}
            />
          )}
          {step === 'done' && (
            <DoneStep results={downloadResults} provider={provider} onReset={resetWizard} />
          )}

          {/* Navigation buttons */}
          {step !== 'done' && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-800">
              <div className="flex items-center gap-3">
                {step !== 'provider' && (
                  <button onClick={prevStep} className="btn-ghost flex items-center gap-2">
                    <ArrowLeft size={14} /> Back
                  </button>
                )}
                <button onClick={resetWizard} className="text-xs text-gray-500 hover:text-gray-300">
                  Cancel
                </button>
              </div>
              <button
                onClick={nextStep}
                disabled={!canProceed || downloadMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {downloadMutation.isPending ? (
                  <><RefreshCw size={14} className="animate-spin" /> Downloading…</>
                ) : step === 'review' ? (
                  <><Download size={14} /> Start Download</>
                ) : (
                  <>Next <ChevronRight size={14} /></>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Inventory */}
      <InventoryTable
        items={inventory}
        onDelete={(symbol, timeframe, provider) =>
          deleteMutation.mutate({ symbol, timeframe, provider })
        }
        deletingKey={deletingKey}
      />
    </div>
  )
}
