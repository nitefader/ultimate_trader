import React, { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Strategies = lazy(() => import('./pages/Strategies').then((m) => ({ default: m.Strategies })))
const StrategyCreator = lazy(() => import('./pages/StrategyCreator').then((m) => ({ default: m.StrategyCreator })))
const StrategyDetails = lazy(() => import('./pages/StrategyDetails').then((m) => ({ default: m.StrategyDetails })))
const StrategyEditorEdit = lazy(() => import('./pages/StrategyEditor').then((m) => ({ default: () => React.createElement(m.StrategyEditor, { mode: 'edit' }) })))
const StrategyEditorNewVersion = lazy(() => import('./pages/StrategyEditor').then((m) => ({ default: () => React.createElement(m.StrategyEditor, { mode: 'new_version' }) })))
const BacktestLauncher = lazy(() => import('./pages/BacktestLauncher').then((m) => ({ default: m.BacktestLauncher })))
const RunHistory = lazy(() => import('./pages/RunHistory').then((m) => ({ default: m.RunHistory })))
const RunDetails = lazy(() => import('./pages/RunDetails').then((m) => ({ default: m.RunDetails })))
const AccountMonitor = lazy(() => import('./pages/AccountMonitor').then((m) => ({ default: m.AccountMonitor })))
const CredentialManager = lazy(() => import('./pages/CredentialManager').then((m) => ({ default: m.CredentialManager })))
const AccountGovernorPage = lazy(() => import('./pages/AccountGovernor').then((m) => ({ default: m.AccountGovernor })))
const RiskProfilesPage = lazy(() => import('./pages/RiskProfiles').then((m) => ({ default: m.RiskProfiles })))
const DataManager = lazy(() => import('./pages/DataManager').then((m) => ({ default: m.DataManager })))
const EventCalendar = lazy(() => import('./pages/EventCalendar').then((m) => ({ default: m.EventCalendar })))
const LogsPanel = lazy(() => import('./pages/LogsPanel').then((m) => ({ default: m.LogsPanel })))
const LiveMonitor = lazy(() => import('./pages/LiveMonitor').then((m) => ({ default: m.LiveMonitor })))
const Services = lazy(() => import('./pages/Services').then((m) => ({ default: m.Services })))
const TradingPrograms = lazy(() => import('./pages/TradingPrograms').then((m) => ({ default: m.TradingPrograms })))
const WatchlistLibrary = lazy(() => import('./pages/WatchlistLibrary').then((m) => ({ default: m.WatchlistLibrary })))
const OptimizationLab = lazy(() => import('./pages/OptimizationLab').then((m) => ({ default: m.OptimizationLab })))
const ChartLab = lazy(() => import('./pages/ChartLab').then((m) => ({ default: m.ChartLab })))
const SimulationLab = lazy(() => import('./pages/SimulationLab').then((m) => ({ default: m.SimulationLab })))
const BackupRestore = lazy(() => import('./pages/BackupRestore').then((m) => ({ default: m.BackupRestore })))
const StrategyControlsPage = lazy(() => import('./pages/StrategyGovernors').then((m) => ({ default: m.StrategyControls })))
const ExecutionStylesPage = lazy(() => import('./pages/ExecutionStyles').then((m) => ({ default: m.ExecutionStyles })))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-gray-400">Loading page...</div>}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="strategies" element={<Strategies />} />
            <Route path="strategies/new" element={<StrategyCreator />} />
            <Route path="strategies/:strategyId" element={<StrategyDetails />} />
            <Route path="strategies/:strategyId/edit" element={<StrategyEditorEdit />} />
            <Route path="strategies/:strategyId/new-version" element={<StrategyEditorNewVersion />} />
            <Route path="backtest" element={<BacktestLauncher />} />
            <Route path="runs" element={<RunHistory />} />
            <Route path="runs/:runId" element={<RunDetails />} />
            <Route path="broker-accounts" element={<AccountMonitor />} />
            <Route path="accounts" element={<AccountMonitor />} />
            <Route path="security" element={<CredentialManager />} />
            <Route path="deployments" element={<AccountGovernorPage />} />
            <Route path="portfolio-governors" element={<AccountGovernorPage />} />
            <Route path="governor" element={<AccountGovernorPage />} />
            <Route path="risk-profiles" element={<RiskProfilesPage />} />
            <Route path="monitor" element={<LiveMonitor />} />
            <Route path="services" element={<Services />} />
            <Route path="services/data" element={<Services />} />
            <Route path="services/ai" element={<Services />} />
            <Route path="data" element={<DataManager />} />
            <Route path="events" element={<EventCalendar />} />
            <Route path="logs" element={<LogsPanel />} />
            <Route path="programs" element={<TradingPrograms />} />
            <Route path="watchlists" element={<WatchlistLibrary />} />
            <Route path="lab" element={<OptimizationLab />} />
            <Route path="charts" element={<ChartLab />} />
            <Route path="simulation" element={<SimulationLab />} />
            <Route path="backup" element={<BackupRestore />} />
            <Route path="strategy-controls" element={<StrategyControlsPage />} />
            <Route path="governors" element={<StrategyControlsPage />} />
            <Route path="execution-styles" element={<ExecutionStylesPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
