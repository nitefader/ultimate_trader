import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Play, Loader, AlertCircle, Info, Database } from 'lucide-react'
import { strategiesApi } from '../api/strategies'
import { backtestsApi } from '../api/backtests'
import { servicesApi } from '../api/services'
import { useKillSwitchStore } from '../stores/useKillSwitchStore'
import { TickerSearch } from '../components/TickerSearch'
import clsx from 'clsx'

const today = new Date().toISOString().slice(0, 10)
const jan2018 = '2018-01-01'

export function BacktestLauncher() {
  const navigate = useNavigate()
  const { data: strategies = [], isLoading: strategiesLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
  })

  const [selectedStrategyId, setSelectedStrategyId] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [symbols, setSymbols] = useState('SPY')
  const [timeframe, setTimeframe] = useState('1d')
  const [dataProvider, setDataProvider] = useState<'auto' | 'yfinance' | 'alpaca'>('auto')
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')
  const [alpacaApiKey, setAlpacaApiKey] = useState('')
  const [alpacaSecretKey, setAlpacaSecretKey] = useState('')
  const [startDate, setStartDate] = useState(jan2018)
  const [endDate, setEndDate] = useState(today)
  const [capital, setCapital] = useState(100000)
  const [commission, setCommission] = useState(0.005)
  const [commissionPct, setCommissionPct] = useState(0.1)
  const [slippage, setSlippage] = useState(1)
  const [walkForwardEnabled, setWalkForwardEnabled] = useState(true)
  const [trainWindowMonths, setTrainWindowMonths] = useState(12)
  const [testWindowMonths, setTestWindowMonths] = useState(3)
  const [warmupBars, setWarmupBars] = useState(100)
  const [maxFolds, setMaxFolds] = useState(24)
  const [selectionMetric, setSelectionMetric] = useState<string>('sharpe_ratio')

  const { data: strategyDetail } = useQuery({
    queryKey: ['strategy', selectedStrategyId],
    queryFn: () => strategiesApi.get(selectedStrategyId),
    enabled: !!selectedStrategyId,
  })

  const { data: allServices = [] } = useQuery({
    queryKey: ['services'],
    queryFn: servicesApi.list,
  })

  const alpacaServices = allServices.filter(
    (s) => s.provider?.toLowerCase() === 'alpaca' && s.has_credentials && s.is_active,
  )

  // Auto-select the default Alpaca service account on first load
  useEffect(() => {
    if (selectedServiceId || alpacaServices.length === 0) return
    const defaultSvc = alpacaServices.find((s) => s.is_default) ?? alpacaServices[0]
    if (defaultSvc) setSelectedServiceId(defaultSvc.id)
  }, [alpacaServices])

  // When a service account is selected, populate the key fields from it
  useEffect(() => {
    const svc = alpacaServices.find((s) => s.id === selectedServiceId)
    if (svc) {
      setAlpacaApiKey(svc.api_key ?? '')
      setAlpacaSecretKey(svc.secret_key ?? '')
    } else {
      setAlpacaApiKey('')
      setAlpacaSecretKey('')
    }
  }, [selectedServiceId])

  const symbolList = symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)

  const { data: providerRecommendation } = useQuery({
    queryKey: ['provider-recommendation', symbolList.join(','), timeframe, startDate, endDate, Boolean(alpacaApiKey && alpacaSecretKey), selectedServiceId],
    queryFn: () => backtestsApi.recommendProvider({
      symbols: symbolList,
      timeframe,
      start_date: startDate,
      end_date: endDate,
      has_alpaca_credentials: Boolean(selectedServiceId || (alpacaApiKey && alpacaSecretKey)),
    }),
    enabled: symbolList.length > 0,
    staleTime: 30_000,
  })

  const launchMutation = useMutation({
    mutationFn: async () => {
      const result = await backtestsApi.launch({
        strategy_version_id: selectedVersionId,
        symbols: symbols.split(',').map((s) => s.trim()).filter(Boolean),
        timeframe,
        start_date: startDate,
        end_date: endDate,
        initial_capital: capital,
        commission_per_share: commission,
        commission_pct_per_trade: commissionPct,
        slippage_ticks: slippage,
        data_provider: dataProvider,
        alpaca_api_key: alpacaApiKey,
        alpaca_secret_key: alpacaSecretKey,
        walk_forward: {
          enabled: walkForwardEnabled,
          train_window_months: trainWindowMonths,
          test_window_months: testWindowMonths,
          warmup_bars: warmupBars,
          max_folds: maxFolds,
          selection_metric: selectionMetric,
          max_parameter_combinations: 64,
        },
      })

      if (result.status === 'failed') {
        throw new Error(result.error ?? 'Backtest failed to launch')
      }

      return result
    },
    onSuccess: (data) => {
      navigate(`/runs/${data.run_id}`)
    },
  })

  const versions = strategyDetail?.versions ?? []
  const latestVersion = versions[0]

  const launchValidationErrors: string[] = []
  if (!selectedStrategyId) launchValidationErrors.push('Select a strategy.')
  if (!selectedVersionId) launchValidationErrors.push('Select a strategy version.')
  if (symbolList.length === 0) launchValidationErrors.push('Provide at least one symbol.')
  if (symbolList.some((s) => !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s))) {
    launchValidationErrors.push('Use valid ticker symbols (uppercase letters/numbers).')
  }
  if (new Date(startDate) > new Date(endDate)) launchValidationErrors.push('Start date must be on or before end date.')
  if (capital < 1000) launchValidationErrors.push('Initial capital must be at least $1,000.')
  if (commission < 0) launchValidationErrors.push('Commission cannot be negative.')
  if (commissionPct < 0 || commissionPct > 2) launchValidationErrors.push('Commission %/trade must be between 0 and 2%.')
  if (slippage < 0 || slippage > 10) launchValidationErrors.push('Slippage ticks must be between 0 and 10.')
  if (dataProvider === 'alpaca' && !selectedServiceId) {
    launchValidationErrors.push('Alpaca provider requires a service account. Create one under Services.')
  }
  if (dataProvider === 'yfinance' && timeframe === '4h') {
    launchValidationErrors.push('4h timeframe is not available on yfinance. Use auto or alpaca.')
  }
  if (walkForwardEnabled && trainWindowMonths < 3) launchValidationErrors.push('Training window should be at least 3 months.')
  if (walkForwardEnabled && testWindowMonths < 1) launchValidationErrors.push('Test window should be at least 1 month.')
  if (walkForwardEnabled && warmupBars < 20) launchValidationErrors.push('Warmup bars should be at least 20 for stable indicators.')

  useEffect(() => {
    if (!selectedVersionId && latestVersion) {
      setSelectedVersionId(latestVersion.id)
    }
  }, [latestVersion, selectedVersionId])

  const killSwitchStatus = useKillSwitchStore(s => s.status)
  const isKilled = killSwitchStatus?.global_killed ?? false
  const canLaunch = launchValidationErrors.length === 0 && !launchMutation.isPending && !isKilled

  const errorMsg = launchMutation.error
    ? (() => {
        const err = launchMutation.error as any
        const detail = err?.response?.data?.detail
        const backendError = err?.response?.data?.error
        if (detail && backendError && backendError !== detail) {
          return `${detail}: ${backendError}`
        }
        return detail ?? backendError ?? (err as Error).message ?? 'Unknown error'
      })()
    : null

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-100">Backtest Launcher</h1>
        <p className="text-xs text-gray-500 mt-0.5">Run a strategy against historical market data</p>
      </div>

      {launchValidationErrors.length > 0 && (
        <div className="card border-amber-800 bg-amber-900/20 text-amber-200 text-xs space-y-1">
          <div className="font-semibold text-amber-300">Preflight checks</div>
          {launchValidationErrors.map((err, i) => (
            <div key={i}>• {err}</div>
          ))}
        </div>
      )}

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-gray-200 border-b border-gray-800 pb-2">
          Strategy Selection
        </h3>

        {strategiesLoading ? (
          <div className="text-gray-500 text-sm flex items-center gap-2">
            <Loader size={14} className="animate-spin" /> Loading strategies...
          </div>
        ) : strategies.length === 0 ? (
          <div className="flex items-start gap-2 text-amber-400 text-sm bg-amber-900/20 border border-amber-800/50 rounded-lg p-3">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              No strategies found.{' '}
              <a href="/strategies/new" className="underline hover:text-amber-300">
                Create one first
              </a>{' '}
              before running a backtest.
            </span>
          </div>
        ) : (
          <div>
            <label className="label">Strategy</label>
            <select
              className="input w-full"
              value={selectedStrategyId}
              onChange={(e) => {
                setSelectedStrategyId(e.target.value)
                setSelectedVersionId('')
              }}
            >
              <option value="">- Select a strategy -</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.category})
                </option>
              ))}
            </select>
          </div>
        )}

        {versions.length > 0 && (
          <div>
            <label className="label">Version</label>
            <select
              className="input w-full"
              value={selectedVersionId}
              onChange={(e) => setSelectedVersionId(e.target.value)}
            >
              <option value="">- Select version -</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} - {v.notes ?? 'no notes'} ({v.promotion_status})
                </option>
              ))}
            </select>
          </div>
        )}

        {latestVersion && !selectedVersionId && (
          <div
            className="text-xs text-sky-400 cursor-pointer hover:text-sky-300"
            onClick={() => setSelectedVersionId(latestVersion.id)}
          >
            Use latest version (v{latestVersion.version})
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-gray-200 border-b border-gray-800 pb-2">Data Configuration</h3>

        <div>
          <label className="label">Symbols</label>
          <TickerSearch
            selected={symbolList}
            onChange={(next) => setSymbols(next.join(', '))}
            placeholder="Search ticker — SPY, QQQ, AAPL..."
          />
          <p className="text-xs text-gray-600 mt-1">Select one or more symbols. Data is cached after first download.</p>
        </div>

        <div>
          <label className="label">Data Provider</label>
          <select className="input w-full" value={dataProvider} onChange={(e) => setDataProvider(e.target.value as 'auto' | 'yfinance' | 'alpaca')}>
            <option value="auto">Auto (recommended)</option>
            <option value="yfinance">Yahoo Finance</option>
            <option value="alpaca">Alpaca</option>
          </select>
          <p className="text-xs text-gray-600 mt-1">Auto mode picks provider based on timeframe/range and credential availability.</p>
        </div>

        {providerRecommendation && (
          <div className="rounded border border-sky-800 bg-sky-950/30 p-3 text-xs text-sky-200 space-y-1">
            <div className="font-semibold text-sky-300">Provider Recommendation: {providerRecommendation.provider.toUpperCase()} ({providerRecommendation.confidence})</div>
            <div>{providerRecommendation.reason}</div>
            {providerRecommendation.warnings?.map((w, i) => (
              <div key={i} className="text-amber-300">• {w}</div>
            ))}
            {dataProvider !== providerRecommendation.provider && (
              <button className="mt-1 text-[11px] text-sky-300 underline" onClick={() => setDataProvider(providerRecommendation.provider)}>
                Use recommended provider
              </button>
            )}
          </div>
        )}

        {(dataProvider === 'alpaca' || dataProvider === 'auto') && (
          <div className="space-y-2">
            <label className="label flex items-center gap-1.5">
              <Database size={12} />
              Alpaca Service Account
              {dataProvider === 'alpaca' && <span className="text-red-400">*</span>}
            </label>

            {alpacaServices.length === 0 ? (
              <div className="flex items-start gap-2 rounded border border-amber-800/60 bg-amber-900/20 p-3 text-xs text-amber-300">
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                <span>
                  No Alpaca service account found.{' '}
                  <a href="/services" className="underline hover:text-amber-200">
                    Create a service account for Alpaca
                  </a>{' '}
                  to use Alpaca as a data provider.
                </span>
              </div>
            ) : (
              <select
                className="input w-full"
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
              >
                <option value="">— Select an Alpaca account —</option>
                {alpacaServices.map((svc) => (
                  <option key={svc.id} value={svc.id}>
                    {svc.name} ({svc.environment})
                    {svc.is_default ? ' ★ default' : ''}
                  </option>
                ))}
              </select>
            )}

            {selectedServiceId && (
              <p className="text-[11px] text-green-500">
                Credentials loaded from service account.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Timeframe</label>
            <select className="input w-full" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              {['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1wk'].map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Start Date</label>
            <input type="date" className="input w-full" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="label">End Date</label>
            <input type="date" className="input w-full" value={endDate} onChange={(e) => setEndDate(e.target.value)} max={today} />
          </div>
        </div>

        {timeframe !== '1d' && timeframe !== '1wk' && (
          <div className="flex items-start gap-2 text-sky-400/80 text-xs bg-sky-900/10 border border-sky-900/30 rounded p-2">
            <Info size={13} className="mt-0.5 flex-shrink-0" />
            <span>Intraday data on yfinance is limited: 1m = 7 days, 5-30m = 60 days, 1h = 2 years. For deeper intraday history, use Alpaca or Auto.</span>
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-gray-200 border-b border-gray-800 pb-2">Walk-Forward Configuration</h3>

        <div className="flex items-center justify-between rounded border border-gray-800 px-3 py-2">
          <div>
            <div className="text-xs font-semibold text-gray-300">Enable Honest Walk-Forward</div>
            <div className="text-[11px] text-gray-500">Train on in-sample window, lock params, then test only on unseen data.</div>
          </div>
          <input
            type="checkbox"
            checked={walkForwardEnabled}
            onChange={(e) => setWalkForwardEnabled(e.target.checked)}
            className="h-4 w-4"
          />
        </div>

        {walkForwardEnabled && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="label">Train Window (months)</label>
              <input type="number" className="input w-full" min={3} max={60} value={trainWindowMonths} onChange={(e) => setTrainWindowMonths(parseInt(e.target.value) || 12)} />
            </div>
            <div>
              <label className="label">Test Window (months)</label>
              <input type="number" className="input w-full" min={1} max={24} value={testWindowMonths} onChange={(e) => setTestWindowMonths(parseInt(e.target.value) || 3)} />
            </div>
            <div>
              <label className="label">Warmup Bars</label>
              <input type="number" className="input w-full" min={20} max={600} value={warmupBars} onChange={(e) => setWarmupBars(parseInt(e.target.value) || 100)} />
            </div>
            <div>
              <label className="label">Max Folds</label>
              <input type="number" className="input w-full" min={1} max={60} value={maxFolds} onChange={(e) => setMaxFolds(parseInt(e.target.value) || 24)} />
            </div>
            <div>
              <label className="label">Optimization Metric</label>
              <select className="input w-full" value={selectionMetric} onChange={e => setSelectionMetric(e.target.value)}>
                <option value="sharpe_ratio">Sharpe Ratio</option>
                <option value="total_return_pct">Total Return %</option>
                <option value="sortino_ratio">Sortino Ratio</option>
                <option value="calmar_ratio">Calmar Ratio</option>
                <option value="win_rate_pct">Win Rate %</option>
                <option value="profit_factor">Profit Factor</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-gray-200 border-b border-gray-800 pb-2">Execution Parameters</h3>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Initial Capital ($)</label>
            <input
              type="number"
              className="input w-full"
              value={capital}
              onChange={(e) => setCapital(parseInt(e.target.value) || 0)}
              min={1000}
              step={1000}
            />
          </div>
          <div>
            <label className="label">Commission/Share ($)</label>
            <input
              type="number"
              step="0.001"
              className="input w-full"
              value={commission}
              onChange={(e) => setCommission(parseFloat(e.target.value) || 0)}
              min={0}
            />
          </div>
          <div>
            <label className="label">Commission (% per trade)</label>
            <input
              type="number"
              step="0.01"
              className="input w-full"
              value={commissionPct}
              onChange={(e) => setCommissionPct(parseFloat(e.target.value) || 0)}
              min={0}
              max={2}
            />
          </div>
          <div>
            <label className="label">Slippage Ticks</label>
            <input
              type="number"
              className="input w-full"
              value={slippage}
              onChange={(e) => setSlippage(parseInt(e.target.value) || 0)}
              min={0}
              max={10}
            />
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2 bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold mb-0.5">Backtest failed to launch</div>
            <div className="text-xs text-red-500 font-mono">{errorMsg}</div>
          </div>
        </div>
      )}

      {isKilled && (
        <div className="flex items-center gap-2 rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-400">
          <AlertCircle size={14} />
          Kill switch is active — backtests are disabled. Resume trading from the Accounts screen.
        </div>
      )}
      <button
        className={clsx(
          'btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold',
          !canLaunch && 'opacity-50 cursor-not-allowed',
        )}
        onClick={() => launchMutation.mutate()}
        disabled={!canLaunch}
        title={isKilled ? 'Kill switch is active — backtests are disabled' : undefined}
      >
        {launchMutation.isPending ? (
          <>
            <Loader size={16} className="animate-spin" /> Running Backtest...
          </>
        ) : (
          <>
            <Play size={16} /> Launch Backtest
          </>
        )}
      </button>

      <div className="text-xs text-gray-600 space-y-1 px-1">
        <p>Signals fire at bar close; fills execute at next bar open plus slippage.</p>
        <p>Costs: ${commission.toFixed(3)}/share + {commissionPct.toFixed(2)}% per trade · Slippage: {slippage} tick(s) · Capital: ${capital.toLocaleString()}</p>
        <p>Provider: {dataProvider === 'auto' ? `Auto${providerRecommendation ? ` → ${providerRecommendation.provider}` : ''}` : dataProvider}</p>
        {walkForwardEnabled ? (
          <p>Walk-forward: {trainWindowMonths}m train → {testWindowMonths}m blind test, stitched out-of-sample reporting only.</p>
        ) : (
          <p>Walk-forward disabled: this run uses naive full-period evaluation.</p>
        )}
        <p>Historical bars are downloaded from the selected provider and cached locally on first run.</p>
      </div>
    </div>
  )
}
