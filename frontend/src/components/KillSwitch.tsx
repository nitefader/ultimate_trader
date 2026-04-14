import React, { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Power, RotateCcw, X, ShieldAlert } from 'lucide-react'
import { controlApi, deploymentsApi } from '../api/accounts'
import { strategiesApi } from '../api/strategies'
import { useKillSwitchStore } from '../stores/useKillSwitchStore'
import { SelectMenu } from './SelectMenu'
import { Tooltip } from './Tooltip'

/**
 * HALT ALL - must always be visible in the header.
 * Stops all trading across all accounts and strategies.
 */
export function KillSwitch() {
  const { status, killAll, resumeAll, fetch } = useKillSwitchStore()
  const [pending, setPending] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [scope, setScope] = useState<'global' | 'strategy'>('global')
  const [strategyId, setStrategyId] = useState('')
  const reasonRef = useRef<HTMLInputElement>(null)
  const isKilled = status?.global_killed ?? false

  const { data: deployments = [] } = useQuery({
    queryKey: ['deployments', 'all-for-halt'],
    queryFn: async () => {
      const [paper, live] = await Promise.all([
        deploymentsApi.list(undefined, 'paper'),
        deploymentsApi.list(undefined, 'live'),
      ])
      return [...paper, ...live]
    },
  })

  const { data: strategies = [] } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
  })

  const activeDeployments = deployments.filter(d => d.status === 'running' || d.status === 'paused')

  function strategyName(stratId: string) {
    return strategies.find(s => s.id === stratId)?.name ?? stratId.slice(0, 8) + '...'
  }

  useEffect(() => {
    if (showConfirm && reasonRef.current) reasonRef.current.focus()
  }, [showConfirm])

  const openConfirm = () => {
    if (pending) return
    setReason('')
    setConfirmText('')
    setScope('global')
    setStrategyId('')
    setShowConfirm(true)
  }

  const handleKill = async () => {
    if (pending || confirmText !== 'HALT') return
    if (scope === 'strategy' && !strategyId.trim()) return
    setPending(true)
    setShowConfirm(false)
    try {
      if (scope === 'global') {
        await killAll(reason.trim() || 'Manual kill switch - UI')
      } else {
        await controlApi.killStrategy(strategyId.trim(), reason.trim() || 'Manual strategy kill - UI')
        await fetch()
      }
    } finally {
      setPending(false)
      setReason('')
      setConfirmText('')
      setStrategyId('')
    }
  }

  const handleResume = async () => {
    if (pending) return
    setPending(true)
    try {
      await resumeAll()
    } finally {
      setPending(false)
    }
  }

  const handleResumeStrategy = async () => {
    if (pending || !strategyId.trim()) return
    setPending(true)
    try {
      await controlApi.resumeStrategy(strategyId.trim())
      await fetch()
    } finally {
      setPending(false)
    }
  }

  if (isKilled) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-red-400 font-bold text-sm animate-pulse flex items-center gap-1">
          <AlertTriangle size={16} /> PLATFORM HALTED
        </span>
        <button
          className="btn-ghost text-xs flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleResume}
          disabled={pending}
        >
          <RotateCcw size={12} /> {pending ? 'Resuming...' : 'Resume All'}
        </button>
        {activeDeployments.length > 0 && (
          <SelectMenu
            className="w-56 text-xs"
            value={strategyId}
            onChange={setStrategyId}
            placeholder="— Resume a strategy —"
            options={[
              { value: '', label: '— Resume a strategy —' },
              ...activeDeployments.map(d => ({
                value: d.strategy_id,
                label: `${strategyName(d.strategy_id)} · ${d.mode.toUpperCase()}`,
              })),
            ]}
          />
        )}
        <button
          className="btn-ghost text-xs flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleResumeStrategy}
          disabled={pending || !strategyId.trim()}
        >
          <RotateCcw size={12} /> Resume Strategy
        </button>
      </div>
    )
  }

  return (
    <>
      <Tooltip content="Halt All — blocks new orders on every account and strategy" side="bottom">
      <button
        className="btn flex items-center gap-2 bg-red-900 hover:bg-red-700 text-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={openConfirm}
        disabled={pending}
      >
        <Power size={14} />
        {pending ? 'Halting...' : 'HALT ALL'}
      </button>
      </Tooltip>

      {/* Kill switch confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-red-800 rounded-lg shadow-2xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-red-400">
                <ShieldAlert size={20} />
                <h2 className="text-lg font-bold">Confirm Halt All</h2>
              </div>
              <button className="text-gray-500 hover:text-gray-300" onClick={() => setShowConfirm(false)}>
                <X size={18} />
              </button>
            </div>

            <p className="text-sm text-gray-300 mb-4">
              Blocks all new orders across <strong className="text-red-400">every account and strategy</strong> on the platform. Open positions are not closed.
            </p>

            <div className="space-y-3">
              <div>
                <label className="label">Scope</label>
                <SelectMenu
                  value={scope}
                  onChange={v => setScope(v as 'global' | 'strategy')}
                  options={[
                    { value: 'global', label: 'Global (all trading)' },
                    { value: 'strategy', label: 'Strategy only' },
                  ]}
                />
              </div>
              {scope === 'strategy' && (
                <div>
                  <label className="label">Strategy</label>
                  {activeDeployments.length === 0 ? (
                    <div className="text-xs text-gray-500 py-2">No active deployments found.</div>
                  ) : (
                    <SelectMenu
                      value={strategyId}
                      onChange={setStrategyId}
                      placeholder="— Select a strategy —"
                      options={[
                        { value: '', label: '— Select a strategy —' },
                        ...activeDeployments.map(d => ({
                          value: d.strategy_id,
                          label: `${strategyName(d.strategy_id)} · ${d.mode.toUpperCase()} · ${d.status}`,
                        })),
                      ]}
                    />
                  )}
                </div>
              )}
              <div>
                <label className="label">Reason (optional)</label>
                <input
                  ref={reasonRef}
                  className="input w-full"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Market crash, unexpected behavior..."
                />
              </div>
              <div>
                <label className="label">
                  Type <span className="text-red-400 font-mono font-bold">HALT</span> to confirm
                </label>
                <input
                  className="input w-full font-mono"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value.toUpperCase())}
                  placeholder="HALT"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-5">
              <button className="btn-ghost text-sm" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button
                className="btn flex items-center gap-2 bg-red-800 hover:bg-red-700 text-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={confirmText !== 'HALT' || (scope === 'strategy' && !strategyId.trim())}
                onClick={handleKill}
              >
                <Power size={14} /> {scope === 'global' ? 'Halt All Trading' : 'Halt Strategy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
