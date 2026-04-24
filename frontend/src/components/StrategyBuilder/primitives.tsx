import React, { useState } from 'react'

export type SectionStatus = 'error' | 'ready' | 'neutral'

export function Section({
  id,
  title,
  status,
  children,
  defaultOpen = true,
}: {
  id: string
  title: string
  status?: SectionStatus
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const statusClass =
    status === 'error'
      ? 'text-red-300 border-red-800/80 bg-red-950/40'
      : status === 'ready'
        ? 'text-emerald-300 border-emerald-800/80 bg-emerald-950/30'
        : 'text-gray-300 border-gray-700 bg-gray-950/50'
  const statusText = status === 'error' ? 'Needs attention' : status === 'ready' ? 'Ready' : 'Optional'

  return (
    <section
      className="rounded-xl border border-gray-800 bg-gray-900/60 px-3 py-2"
      id={id}
    >
      <button className="flex w-full items-center justify-between text-left py-0.5" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-gray-200">{title}</h3>
          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${statusClass}`}>{statusText}</span>
        </div>
        <span className="text-[10px] text-gray-600">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="mt-2 space-y-3">{children}</div>}
    </section>
  )
}

export function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string
  children: React.ReactNode
  error?: string
  hint?: string
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {!error && hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

export function DirectionToggle({
  value,
  onChange,
}: {
  value: 'both' | 'long' | 'short'
  onChange: (d: 'both' | 'long' | 'short') => void
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-xs text-gray-500">Apply to:</span>
      <div className="flex gap-0.5 rounded border border-gray-700 bg-gray-900/60 p-0.5">
        {(['both', 'long', 'short'] as const).map(d => (
          <button
            key={d}
            onClick={() => onChange(d)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              value === d ? 'bg-sky-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {d === 'both' ? 'Both' : d === 'long' ? 'Long only' : 'Short only'}
          </button>
        ))}
      </div>
    </div>
  )
}
