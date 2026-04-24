import React, { memo, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useOutlet, Link } from 'react-router-dom'
import {
  BarChart2, Database, List, Layers,
  Monitor, Shield, TrendingUp, Zap, Calendar,
  Activity, Key, Radio, Server, Target, FlaskConical, Palette, CandlestickChart, PlayCircle,
  ChevronLeft, ChevronRight, ShieldCheck, HardDriveDownload, Clock, Play, Menu, X,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { KillSwitch } from './KillSwitch'
import { WatchlistToastRail } from './WatchlistToastRail'
import { PreMarketChecklist } from './PreMarketChecklist'
import { deploymentsApi } from '../api/accounts'
import { backtestsApi } from '../api/backtests'
import { usePollingGate } from '../hooks/usePollingGate'
import { useTheme, THEMES } from '../context/ThemeContext'
import clsx from 'clsx'

type NavItem = { to: string; label: string; icon: React.ElementType; end?: boolean }
type NavGroup = { group: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    group: '',
    items: [
      { to: '/', label: 'Dashboard', icon: Monitor, end: true },
    ],
  },
  {
    group: 'Build',
    items: [
      { to: '/strategies', label: 'Strategies', icon: Layers },
      { to: '/watchlists', label: 'Watchlists', icon: List },
      { to: '/risk-profiles', label: 'Risk Profiles', icon: ShieldCheck },
      { to: '/strategy-controls', label: 'Strategy Controls', icon: Clock },
      { to: '/execution-styles', label: 'Execution Styles', icon: Play },
    ],
  },
  {
    group: 'Test & Validate',
    items: [
      { to: '/simulation', label: 'Sim Lab', icon: PlayCircle },
      { to: '/backtest', label: 'Backtest', icon: TrendingUp },
      { to: '/runs', label: 'Run History', icon: BarChart2 },
      { to: '/charts', label: 'Chart Lab', icon: CandlestickChart },
    ],
  },
  {
    group: 'Optimize',
    items: [
      { to: '/lab', label: 'Optim. Lab', icon: FlaskConical },
    ],
  },
  {
    group: 'Deploy & Monitor',
    items: [
      { to: '/programs', label: 'Programs', icon: Target },
      { to: '/deployments', label: 'Deployments', icon: Zap },
      { to: '/monitor', label: 'Live Monitor', icon: Radio },
      { to: '/portfolio-governors', label: 'Portfolio Governor', icon: ShieldCheck },
      { to: '/broker-accounts', label: 'Broker Accounts', icon: Shield },
    ],
  },
  {
    group: 'System',
    items: [
      { to: '/services/data', label: 'Services', icon: Server },
      { to: '/security', label: 'Credentials', icon: Key },
      { to: '/data', label: 'Data', icon: Database },
      { to: '/events', label: 'Events', icon: Calendar },
      { to: '/backup', label: 'Backup', icon: HardDriveDownload },
      { to: '/logs', label: 'Logs', icon: Activity },
    ],
  },
]

export function Layout() {
  const [showKillSwitchWarning, setShowKillSwitchWarning] = React.useState(false)
  const [isMobileNav, setIsMobileNav] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth < 1024)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ultratrader.sidebar_collapsed')
      if (saved !== null) return saved === '1'
      return typeof window !== 'undefined' && window.innerWidth < 1200
    } catch {
      return false
    }
  })

  useEffect(() => {
    function onResize() {
      const nextIsMobileNav = window.innerWidth < 1024
      setIsMobileNav(nextIsMobileNav)
      if (window.innerWidth < 1200) setCollapsed(true)
      if (!nextIsMobileNav) setMobileNavOpen(false)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const wasKilled = localStorage.getItem('ultratrader.kill_switch_active') === '1'
    if (wasKilled) {
      setShowKillSwitchWarning(true)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('ultratrader.sidebar_collapsed', collapsed ? '1' : '0')
    } catch {
      // ignore
    }
  }, [collapsed])

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-bg-page)' }}>
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
      <PreMarketChecklist />

      {isMobileNav && mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside
        className={clsx(
          'flex flex-col',
          isMobileNav
            ? clsx(
                'fixed inset-y-0 left-0 z-40 w-72 max-w-[86vw] shadow-2xl transition-transform duration-200',
                mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
              )
            : clsx(collapsed ? 'w-12' : 'w-48', 'flex-shrink-0')
        )}
        style={{ backgroundColor: 'var(--color-bg-card)', borderRight: '1px solid var(--color-border)', transition: isMobileNav ? undefined : 'width 180ms ease' }}
      >
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <div className="font-bold tracking-tight" style={{ color: 'var(--color-accent)', fontSize: !isMobileNav && collapsed ? 16 : undefined }}>
              {!isMobileNav && collapsed ? 'UT' : 'UltraTrader'}
            </div>
            {(isMobileNav || !collapsed) && (
              <div className="text-xs" style={{ color: 'var(--color-text-faint)' }}>2026 Edition</div>
            )}
          </div>
          <div>
            <button
              onClick={() => isMobileNav ? setMobileNavOpen(false) : setCollapsed((current) => !current)}
              aria-pressed={isMobileNav ? mobileNavOpen : collapsed}
              aria-label={isMobileNav ? 'Close sidebar' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="p-1 rounded hover:bg-gray-800/30"
              title={isMobileNav ? 'Close' : collapsed ? 'Expand' : 'Collapse'}
            >
              {isMobileNav ? <X size={16} /> : collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {NAV_GROUPS.map(({ group, items }) => (
            <div key={group}>
              {group && (isMobileNav || !collapsed) && (
                <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest select-none" style={{ color: 'var(--color-text-faint)' }}>
                  {group}
                </div>
              )}
              <div className="space-y-0.5">
                {items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    title={!isMobileNav && collapsed ? label : undefined}
                    aria-label={label}
                    onClick={() => {
                      if (isMobileNav) setMobileNavOpen(false)
                    }}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-2.5 py-1.5 rounded text-sm transition-colors',
                        isActive ? 'nav-active' : 'nav-idle',
                        !isMobileNav && collapsed ? 'justify-center px-0' : 'px-3'
                      )
                    }
                  >
                    <Icon size={!isMobileNav && collapsed ? 18 : 15} />
                    {(isMobileNav || !collapsed) && label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <ThemePicker collapsed={!isMobileNav && collapsed} />

        <div className="px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="text-xs" style={{ color: 'var(--color-text-faint)' }}>{!isMobileNav && collapsed ? 'v1' : 'v1.0.0'}</div>
        </div>
      </aside>

      <WatchlistToastRail />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-12 flex-shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4" style={{ backgroundColor: 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {isMobileNav && (
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="rounded p-1.5 hover:bg-gray-800/30"
                aria-label="Open navigation menu"
              >
                <Menu size={18} />
              </button>
            )}
            <HeaderDeploymentStatus />
            <BacktestRunningIndicator />
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <KillSwitch />
          </div>
        </header>

        <StableOutlet />
      </div>
    </div>
  )
}

const HeaderDeploymentStatus = memo(function HeaderDeploymentStatus() {
  const pausePolling = usePollingGate()
  const { data: deployments = [] } = useQuery({
    queryKey: ['deployments', 'header'],
    queryFn: async () => {
      const [paper, live] = await Promise.all([
        deploymentsApi.list(undefined, 'paper'),
        deploymentsApi.list(undefined, 'live'),
      ])
      return [...paper, ...live]
    },
    refetchInterval: pausePolling ? false : 10_000,
    notifyOnChangeProps: ['data'],
  })

  const paperActive = deployments.filter((deployment) => deployment.status === 'running' && deployment.mode === 'paper').length
  const liveActive = deployments.filter((deployment) => deployment.status === 'running' && deployment.mode === 'live').length

  return (
    <div className="flex min-w-0 items-center gap-3">
      {(paperActive > 0 || liveActive > 0) ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
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
  )
})

const BacktestRunningIndicator = memo(function BacktestRunningIndicator() {
  const pausePolling = usePollingGate()
  const { data: runs = [] } = useQuery({
    queryKey: ['backtests', 'header'],
    queryFn: () => backtestsApi.list(undefined, 20),
    refetchInterval: pausePolling ? false : 4_000,
    notifyOnChangeProps: ['data'],
    select: (data) => data.filter((run: any) => run.status === 'running' || run.status === 'pending'),
  })

  if (!runs.length) return null

  const run = runs[0]
  const label = run.status === 'pending' ? 'Queued' : 'Running'
  const symbols = (run.symbols as string[] | undefined)?.join(', ') ?? '...'

  return (
    <Link
      to={`/runs/${run.id}`}
      className="flex max-w-full items-center gap-2 rounded-full px-2.5 py-1 text-xs transition-opacity hover:opacity-80"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)', textDecoration: 'none' }}
      title="Click to view backtest progress"
    >
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: 'var(--color-accent)' }} />
        <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: 'var(--color-accent)' }} />
      </span>
      <span className="truncate">Backtest {label} - {symbols}</span>
      {runs.length > 1 && <span className="ml-1 opacity-70">+{runs.length - 1}</span>}
    </Link>
  )
})

const StableOutlet = memo(function StableOutlet() {
  const outlet = useOutlet()

  return <main className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto p-2 sm:p-3 lg:p-4" style={{ backgroundColor: 'var(--color-bg-page)' }}>{outlet}</main>
})

function ThemePicker({ collapsed = false }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative px-3 pb-2" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem' }}>
      <button
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs transition-colors"
        style={{ color: 'var(--color-text-muted)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '')}
      >
        <Palette size={13} />
        {!collapsed && <span>Theme</span>}
        {!collapsed && <span className="ml-auto capitalize text-[11px]" style={{ color: 'var(--color-text-faint)' }}>{theme}</span>}
      </button>

      {open && (
        <div
          className="absolute left-3 right-3 rounded-lg p-2 z-50 space-y-1 shadow-2xl"
          style={{
            bottom: '100%',
            marginBottom: '4px',
            backgroundColor: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-float)',
          }}
        >
          <div className="text-[10px] uppercase tracking-widest px-2 pb-1" style={{ color: 'var(--color-text-faint)' }}>Themes</div>
          {THEMES.map((themeOption) => (
            <button
              key={themeOption.value}
              onClick={() => { setTheme(themeOption.value); setOpen(false) }}
              className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded text-xs transition-colors"
              style={{
                color: theme === themeOption.value ? 'var(--color-accent)' : 'var(--color-text-muted)',
                backgroundColor: theme === themeOption.value ? 'var(--color-accent-dim)' : 'transparent',
              }}
              onMouseEnter={(e) => { if (theme !== themeOption.value) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)' }}
              onMouseLeave={(e) => { if (theme !== themeOption.value) e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              <span
                className="w-3 h-3 rounded-full border"
                style={{ backgroundColor: themeOption.preview, borderColor: 'var(--color-border)' }}
              />
              {themeOption.label}
              {theme === themeOption.value && <span className="ml-auto text-[10px]">OK</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
