import React from 'react'
import clsx from 'clsx'
import type { Mode } from '../types'

interface Props {
  mode: Mode
  large?: boolean
  animated?: boolean
}

const MODE_CONFIG: Record<Mode, { label: string; bg: string; text: string; ring: string }> = {
  backtest: {
    label: 'BACKTEST',
    bg: 'bg-emerald-900/80',
    text: 'text-emerald-300',
    ring: 'ring-emerald-500',
  },
  paper: {
    label: 'PAPER TRADING',
    bg: 'bg-indigo-900/80',
    text: 'text-indigo-300',
    ring: 'ring-indigo-500',
  },
  live: {
    label: '⚡ LIVE TRADING',
    bg: 'bg-red-900/80',
    text: 'text-red-300',
    ring: 'ring-red-500',
  },
}

/**
 * Mode indicator — always prominently visible in the UI.
 * LIVE mode has additional animated ring to make it impossible to miss.
 */
export function ModeIndicator({ mode, large = false, animated = true }: Props) {
  const cfg = MODE_CONFIG[mode]
  return (
    <span
      className={clsx(
        'inline-flex items-center font-bold tracking-widest rounded px-3 py-1',
        cfg.bg, cfg.text,
        large ? 'text-base ring-2' : 'text-xs ring-1',
        cfg.ring,
        mode === 'live' && animated && 'animate-pulse',
      )}
    >
      {cfg.label}
    </span>
  )
}
