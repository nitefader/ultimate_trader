import React, { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, RefreshCw, CheckCircle2, X } from 'lucide-react'
import clsx from 'clsx'
import { dataApi, type TickerResult } from '../api/data'

interface TickerSearchProps {
  /** Currently selected symbols */
  selected: string[]
  /** Callback when selection changes */
  onChange: (symbols: string[]) => void
  /** Placeholder text */
  placeholder?: string
  /** Allow multiple selections (default: true) */
  multi?: boolean
  /** Additional classname on root */
  className?: string
}

export function TickerSearch({
  selected,
  onChange,
  placeholder = 'Search ticker — SPY, AAPL, TSLA...',
  multi = true,
  className,
}: TickerSearchProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timerRef.current)
  }, [query])

  const { data: searchData, isFetching } = useQuery({
    queryKey: ['ticker-search', debouncedQuery],
    queryFn: () => dataApi.search(debouncedQuery, 'yfinance', '', '', 12),
    enabled: debouncedQuery.length >= 1,
    staleTime: 30_000,
  })

  const results: TickerResult[] = searchData?.results ?? []

  const toggle = (sym: string) => {
    if (multi) {
      onChange(
        selected.includes(sym) ? selected.filter(s => s !== sym) : [...selected, sym],
      )
    } else {
      onChange([sym])
    }
  }

  const remove = (sym: string) => onChange(selected.filter(s => s !== sym))

  return (
    <div className={clsx('space-y-2', className)}>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(sym => (
            <span
              key={sym}
              className="inline-flex items-center gap-1 rounded bg-sky-950/60 border border-sky-800/40 px-2 py-0.5 text-xs font-mono text-sky-200"
            >
              {sym}
              <button
                onClick={() => remove(sym)}
                className="text-sky-400 hover:text-red-400 transition-colors"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input + dropdown */}
      <div className="relative">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            ref={inputRef}
            className="input w-full pl-9"
            placeholder={placeholder}
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
          <div className="absolute top-full left-0 right-0 bg-gray-900 border border-gray-700 rounded-b-lg mt-0.5 z-30 max-h-60 overflow-y-auto shadow-xl">
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
                  <span className="text-xs text-gray-400 ml-2 truncate">{r.name}</span>
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
    </div>
  )
}
