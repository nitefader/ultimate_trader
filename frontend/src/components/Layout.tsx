import React, { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  BarChart2, Database, Layers,
  Monitor, Shield, TrendingUp, Zap, Calendar,
  Activity, Key, Radio, Server,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { KillSwitch } from './KillSwitch'
import { deploymentsApi } from '../api/accounts'
import { useKillSwitchStore } from '../stores/useKillSwitchStore'
import clsx from 'clsx'

const NAV = [
  { to: '/', label: 'Dashboard', icon: Monitor, end: true },
  { to: '/strategies', label: 'Strategies', icon: Layers },
  { to: '/backtest', label: 'Backtest', icon: TrendingUp },
  { to: '/runs', label: 'Run History', icon: BarChart2 },
  { to: '/monitor', label: 'Live Monitor', icon: Radio },
  { to: '/accounts', label: 'Accounts', icon: Shield },
  { to: '/security', label: 'Security', icon: Key },
  { to: '/services', label: 'Services', icon: Server },
  { to: '/deployments', label: 'Deploy', icon: Zap },
  { to: '/data', label: 'Data', icon: Database },
  { to: '/events', label: 'Events', icon: Calendar },
  { to: '/logs', label: 'Logs', icon: Activity },
]

export function Layout() {
  const { fetch } = useKillSwitchStore()
  const [showKillSwitchWarning, setShowKillSwitchWarning] = React.useState(false)

  const { data: deployments = [] } = useQuery({
    queryKey: ['deployments', 'header'],
    queryFn: async () => {
      const [paper, live] = await Promise.all([
        deploymentsApi.list(undefined, 'paper'),
        deploymentsApi.list(undefined, 'live'),
      ])
      return [...paper, ...live]
    },
    refetchInterval: 10_000,
  })

  const paperActive = deployments.filter(d => d.status === 'running' && d.mode === 'paper').length
  const liveActive = deployments.filter(d => d.status === 'running' && d.mode === 'live').length

  useEffect(() => {
    fetch()
    const interval = setInterval(fetch, 10_000)
    return () => clearInterval(interval)
  }, [fetch])

  useEffect(() => {
    const wasKilled = localStorage.getItem('ultratrader.kill_switch_active') === '1'
    if (wasKilled) {
      setShowKillSwitchWarning(true)
    }
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {showKillSwitchWarning && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="card max-w-lg w-full border-red-800 bg-red-950/40 space-y-3">
            <h2 className="text-sm font-semibold text-red-300">Kill Switch Was Active</h2>
            <p className="text-sm text-gray-200">
              Kill switch was active when you last visited. Check status before trading.
            </p>
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setShowKillSwitchWarning(false)}>
                Acknowledge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-gray-800 flex flex-col bg-gray-900">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-gray-800">
          <div className="text-sky-400 font-bold text-lg tracking-tight">UltraTrader</div>
          <div className="text-gray-500 text-xs">2026 Edition</div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors',
                  isActive
                    ? 'bg-sky-900/60 text-sky-300 font-semibold'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800',
                )
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 pb-4 border-t border-gray-800 pt-3">
          <div className="text-xs text-gray-600">v1.0.0</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-12 border-b border-gray-800 flex items-center justify-between px-4 bg-gray-900 flex-shrink-0">
          <div className="flex items-center gap-3">
            {(paperActive > 0 || liveActive > 0) ? (
              <div className="flex items-center gap-2 text-xs">
                {paperActive > 0 && (
                  <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-indigo-900/60 text-indigo-300 ring-1 ring-indigo-700 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                    Paper: {paperActive}
                  </span>
                )}
                {liveActive > 0 && (
                  <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-900/60 text-red-300 ring-1 ring-red-700 font-medium animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                    Live: {liveActive}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-gray-600">No active deployments</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <KillSwitch />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
