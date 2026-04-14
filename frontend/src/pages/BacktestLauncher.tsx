import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertCircle, Database, Info, Loader, Play } from 'lucide-react'
import clsx from 'clsx'
import { backtestsApi } from '../api/backtests'
import { servicesApi } from '../api/services'
import { strategiesApi } from '../api/strategies'
import { DatePickerInput } from '../components/DatePickerInput'
import { SelectMenu } from '../components/SelectMenu'
import { TickerSearch } from '../components/TickerSearch'
import { useKillSwitchStore } from '../stores/useKillSwitchStore'

const today = new Date().toISOString().slice(0, 10)
const jan2018 = '2018-01-01'

const timeframeOptions = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1wk'].map((tf) => ({
  value: tf,
  label: tf,
}))

const dataProviderOptions = [
  { value: 'auto', label: 'Auto (recommended)' },
  { value: 'yfinance', label: 'Yahoo Finance' },
  { value: 'alpaca', label: 'Alpaca' },
]

const optimizationMetricOptions = [
  { value: 'sharpe_ratio', label: 'Sharpe Ratio' },
  { value: 'total_return_pct', label: 'Total Return %' },
  { value: 'sortino_ratio', label: 'Sortino Ratio' },
  { value: 'calmar_ratio', label: 'Calmar Ratio' },
  { value: 'win_rate_pct', label: 'Win Rate %' },
  { value: 'profit_factor', label: 'Profit Factor' },
]

export function BacktestLauncher() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillStrategyId = searchParams.get('strategy_id') ?? ''
  const prefillVersionId = searchParams.get('version_id') ?? ''

  const { data: strategies = [], isLoading: strategiesLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
  })

  const [selectedStrategyId, setSelectedStrategyId] = useState(prefillStrategyId)
  const [selectedVersionId, setSelectedVersionId] = useState(prefillVersionId)
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
    (service) =>
      service.provider?.toLowerCase() === 'alpaca' &&
      service.has_credentials &&
      service.is_active,
  )

  useEffect(() => {
    if (selectedServiceId || alpacaServices.length === 0) return
    const defaultSvc = alpacaServices.find((service) => service.is_default) ?? alpacaServices[0]
    if (defaultSvc) setSelectedServiceId(defaultSvc.id)
  }, [alpacaServices, selectedServiceId])

  useEffect(() => {
    const service = alpacaServices.find((item) => item.id === selectedServiceId)
    if (service) {
      setAlpacaApiKey(service.api_key ?? '')
      setAlpacaSecretKey(service.secret_key ?? '')
    } else {
      setAlpacaApiKey('')
      setAlpacaSecretKey('')
    }
  }, [alpacaServices, selectedServiceId])

  const symbolList = symbols
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)

  const { data: providerRecommendation } = useQuery({
    queryKey: [
      'provider-recommendation',
      symbolList.join(','),
      timeframe,
      startDate,
      endDate,
      Boolean(alpacaApiKey && alpacaSecretKey),
      selectedServiceId,
    ],
    queryFn: () =>
      backtestsApi.recommendProvider({
        symbols: symbolList,
        timeframe,
        start_date: startDate,
        end_date: endDate,
        has_alpaca_credentials: Boolean(
          selectedServiceId || (alpacaApiKey && alpacaSecretKey),
        ),
      }),
    enabled: symbolList.length > 0,
    staleTime: 30_000,
  })

  const launchMutation = useMutation({
    mutationFn: async () => {
      const result = await backtestsApi.launch({
        strategy_version_id: selectedVersionId,
        symbols: symbols.split(',').map((symbol) => symbol.trim()).filter(Boolean),
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

  useEffect(() => {
    // Auto-select latest version only when no version is chosen and no prefill
    if (!selectedVersionId && latestVersion && !prefillVersionId) {
      setSelectedVersionId(latestVersion.id)
    }
  }, [latestVersion, selectedVersionId, prefillVersionId])

  const strategyOptions = strategies.map((strategy) => ({
    value: strategy.id,
    label: `${strategy.name} (${strategy.category})`,
  }))

  const versionOptions = versions.map((version) => ({
    value: version.id,
    label: `v${version.version} - ${version.notes ?? 'no notes'} (${version.promotion_status})`,
  }))

  const serviceOptions = alpacaServices.map((service) => ({
    value: service.id,
    label: `${service.name} (${service.environment})${service.is_default ? ' * default' : ''}`,
  }))

  const launchValidationErrors: string[] = []
  if (!selectedStrategyId) launchValidationErrors.push('Select a strategy.')
  if (!selectedVersionId) launchValidationErrors.push('Select a strategy version.')
  if (symbolList.length === 0) launchValidationErrors.push('Provide at least one symbol.')
  if (symbolList.some((symbol) => !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))) {
    launchValidationErrors.push('Use valid ticker symbols (uppercase letters/numbers).')
  }
  if (new Date(startDate) > new Date(endDate)) {
    launchValidationErrors.push('Start date must be on or before end date.')
  }
  if (capital < 1000) launchValidationErrors.push('Initial capital must be at least $1,000.')
  if (commission < 0) launchValidationErrors.push('Commission cannot be negative.')
  if (commissionPct < 0 || commissionPct > 2) {
    launchValidationErrors.push('Commission %/trade must be between 0 and 2%.')
  }
  if (slippage < 0 || slippage > 10) {
    launchValidationErrors.push('Slippage ticks must be between 0 and 10.')
  }
  if (dataProvider === 'alpaca' && !selectedServiceId) {
    launchValidationErrors.push(
      'Alpaca provider requires a service account. Create one under Services.',
    )
  }
  if (dataProvider === 'yfinance' && timeframe === '4h') {
    launchValidationErrors.push(
      '4h timeframe is not available on yfinance. Use auto or alpaca.',
    )
  }
  if (walkForwardEnabled && trainWindowMonths < 3) {
    launchValidationErrors.push('Training window should be at least 3 months.')
  }
  if (walkForwardEnabled && testWindowMonths < 1) {
    launchValidationErrors.push('Test window should be at least 1 month.')
  }
  if (walkForwardEnabled && warmupBars < 20) {
    launchValidationErrors.push('Warmup bars should be at least 20 for stable indicators.')
  }

  const killSwitchStatus = useKillSwitchStore((state) => state.status)
  const isKilled = killSwitchStatus?.global_killed ?? false
  const canLaunch =
    launchValidationErrors.length === 0 && !launchMutation.isPending && !isKilled

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
        <p className="mt-0.5 text-xs text-gray-500">
          Run a strategy against historical market data
        </p>
      </div>

      {launchValidationErrors.length > 0 && (
        <div className="card space-y-1 border-amber-800 bg-amber-900/20 text-xs text-amber-200">
          <div className="font-semibold text-amber-300">Preflight checks</div>
          {launchValidationErrors.map((error, index) => (
            <div key={index}>- {error}</div>
          ))}
        </div>
      )}

      <div className="card space-y-4">
        <h3 className="border-b border-gray-800 pb-2 text-sm font-semibold text-gray-200">
          Strategy Selection
        </h3>

        {strategiesLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader size={14} className="animate-spin" /> Loading strategies...
          </div>
        ) : strategies.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-400">
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
            <SelectMenu
              className="w-full"
              value={selectedStrategyId}
              placeholder="- Select a strategy -"
              options={strategyOptions}
              onChange={(value) => {
                setSelectedStrategyId(value)
                setSelectedVersionId('')
              }}
            />
          </div>
        )}

        {versions.length > 0 && (
          <div>
            <label className="label">Version</label>
            <SelectMenu
              className="w-full"
              value={selectedVersionId}
              placeholder="- Select version -"
              options={versionOptions}
              onChange={setSelectedVersionId}
            />
          </div>
        )}

        {latestVersion && !selectedVersionId && (
          <div
            className="cursor-pointer text-xs text-sky-400 hover:text-sky-300"
            onClick={() => setSelectedVersionId(latestVersion.id)}
          >
            Use latest version (v{latestVersion.version})
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <h3 className="border-b border-gray-800 pb-2 text-sm font-semibold text-gray-200">
          Data Configuration
        </h3>

        <div>
          <label className="label">Symbols</label>
          <TickerSearch
            selected={symbolList}
            onChange={(next) => setSymbols(next.join(', '))}
            placeholder="Search ticker - SPY, QQQ, AAPL..."
          />
          <p className="mt-1 text-xs text-gray-600">
            Select one or more symbols. Data is cached after first download.
          </p>
        </div>

        <div>
          <label className="label">Data Provider</label>
          <SelectMenu
            className="w-full"
            value={dataProvider}
            options={dataProviderOptions}
            onChange={(value) => setDataProvider(value as 'auto' | 'yfinance' | 'alpaca')}
          />
          <p className="mt-1 text-xs text-gray-600">
            Auto mode picks provider based on timeframe/range and credential availability.
          </p>
        </div>

        {providerRecommendation && (
          <div className="space-y-1 rounded border border-sky-800 bg-sky-950/30 p-3 text-xs text-sky-200">
            <div className="font-semibold text-sky-300">
              Provider Recommendation: {providerRecommendation.provider.toUpperCase()} (
              {providerRecommendation.confidence})
            </div>
            <div>{providerRecommendation.reason}</div>
            {providerRecommendation.warnings?.map((warning, index) => (
              <div key={index} className="text-amber-300">
                - {warning}
              </div>
            ))}
            {dataProvider !== providerRecommendation.provider && (
              <button
                type="button"
                className="mt-1 text-[11px] text-sky-300 underline"
                onClick={() => setDataProvider(providerRecommendation.provider)}
              >
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
              <SelectMenu
                className="w-full"
                value={selectedServiceId}
                placeholder="- Select an Alpaca account -"
                options={serviceOptions}
                onChange={setSelectedServiceId}
              />
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
            <SelectMenu
              className="w-full"
              value={timeframe}
              options={timeframeOptions}
              onChange={setTimeframe}
            />
          </div>
          <div>
            <label className="label">Start Date</label>
            <DatePickerInput
              className="w-full"
              value={startDate}
              max={endDate}
              onChange={setStartDate}
            />
          </div>
          <div>
            <label className="label">End Date</label>
            <DatePickerInput
              className="w-full"
              value={endDate}
              min={startDate}
              max={today}
              onChange={setEndDate}
            />
          </div>
        </div>

        {timeframe !== '1d' && timeframe !== '1wk' && (
          <div className="flex items-start gap-2 rounded border border-sky-900/30 bg-sky-900/10 p-2 text-xs text-sky-400/80">
            <Info size={13} className="mt-0.5 flex-shrink-0" />
            <span>
              Intraday data on yfinance is limited: 1m = 7 days, 5-30m = 60 days, 1h = 2
              years. For deeper intraday history, use Alpaca or Auto.
            </span>
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <h3 className="border-b border-gray-800 pb-2 text-sm font-semibold text-gray-200">
          Walk-Forward Configuration
        </h3>

        <div className="flex items-center justify-between rounded border border-gray-800 px-3 py-2">
          <div>
            <div className="text-xs font-semibold text-gray-300">Enable Honest Walk-Forward</div>
            <div className="text-[11px] text-gray-500">
              Train on in-sample window, lock params, then test only on unseen data. <span className="text-sky-400/80">Strongly recommended</span> — prevents overfitting.
            </div>
          </div>
          <input
            type="checkbox"
            checked={walkForwardEnabled}
            onChange={(event) => setWalkForwardEnabled(event.target.checked)}
            className="h-4 w-4"
          />
        </div>

        {walkForwardEnabled && (
          <>
            <div className="text-[11px] text-gray-600 bg-gray-900/60 rounded px-3 py-2 border border-gray-800">
              <strong className="text-gray-500">Tip:</strong> For daily strategies, try 12m train + 3m test. For intraday, try 3m train + 1m test.
              Ensure your date range spans at least (train + test) × 2 months for meaningful folds.
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div>
                <label className="label">Train Window (months)</label>
                <input
                  type="number"
                  className="input w-full"
                  min={3}
                  max={60}
                  value={trainWindowMonths}
                  onChange={(event) =>
                    setTrainWindowMonths(parseInt(event.target.value, 10) || 12)
                  }
                />
              </div>
              <div>
                <label className="label">Test Window (months)</label>
                <input
                  type="number"
                  className="input w-full"
                  min={1}
                  max={24}
                  value={testWindowMonths}
                  onChange={(event) =>
                    setTestWindowMonths(parseInt(event.target.value, 10) || 3)
                  }
                />
              </div>
              <div>
                <label className="label">Warmup Bars</label>
                <input
                  type="number"
                  className="input w-full"
                  min={20}
                  max={600}
                  value={warmupBars}
                  onChange={(event) => setWarmupBars(parseInt(event.target.value, 10) || 100)}
                />
                <p className="text-[10px] text-gray-600 mt-0.5">Bars to warm up indicators before trading starts. 100 is safe for most strategies.</p>
              </div>
              <div>
                <label className="label">Max Folds</label>
                <input
                  type="number"
                  className="input w-full"
                  min={1}
                  max={60}
                  value={maxFolds}
                  onChange={(event) => setMaxFolds(parseInt(event.target.value, 10) || 24)}
                />
                <p className="text-[10px] text-gray-600 mt-0.5">Cap on number of train/test periods. 24 is usually sufficient.</p>
              </div>
              <div>
                <label className="label">Optimization Metric</label>
                <SelectMenu
                  className="w-full"
                  value={selectionMetric}
                  options={optimizationMetricOptions}
                  onChange={setSelectionMetric}
                />
                <p className="text-[10px] text-gray-600 mt-0.5">Metric used to rank parameter sets during training. Sharpe balances return and risk.</p>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card space-y-4">
        <h3 className="border-b border-gray-800 pb-2 text-sm font-semibold text-gray-200">
          Execution Parameters
        </h3>

        <div className="text-[11px] text-gray-600 bg-gray-900/60 rounded px-3 py-2 border border-gray-800">
          <strong className="text-gray-500">Tip:</strong> For realistic results, use Alpaca commission defaults: $0.005/share or 0.1%/trade. Set slippage to 1–2 ticks for liquid ETFs, higher for small-caps.
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Initial Capital ($)</label>
            <input
              type="number"
              className="input w-full"
              value={capital}
              min={1000}
              step={1000}
              onChange={(event) => setCapital(parseInt(event.target.value, 10) || 0)}
            />
            <p className="text-[10px] text-gray-600 mt-0.5">Starting portfolio value for the simulation.</p>
          </div>
          <div>
            <label className="label">Commission/Share ($)</label>
            <input
              type="number"
              step="0.001"
              className="input w-full"
              value={commission}
              min={0}
              onChange={(event) => setCommission(parseFloat(event.target.value) || 0)}
            />
            <p className="text-[10px] text-gray-600 mt-0.5">Flat fee per share. Alpaca: $0.005 (equity). Use 0 if broker charges % only.</p>
          </div>
          <div>
            <label className="label">Commission (% per trade)</label>
            <input
              type="number"
              step="0.01"
              className="input w-full"
              value={commissionPct}
              min={0}
              max={2}
              onChange={(event) => setCommissionPct(parseFloat(event.target.value) || 0)}
            />
            <p className="text-[10px] text-gray-600 mt-0.5">Percentage of trade value. Alpaca: 0.1%. Applied on top of per-share fee.</p>
          </div>
          <div>
            <label className="label">Slippage Ticks</label>
            <input
              type="number"
              className="input w-full"
              value={slippage}
              min={0}
              max={10}
              onChange={(event) => setSlippage(parseInt(event.target.value, 10) || 0)}
            />
            <p className="text-[10px] text-gray-600 mt-0.5">Market impact / fill slippage in price ticks. 1 tick = 1 cent for most equities.</p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-900/30 p-3 text-sm text-red-400">
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
          <div>
            <div className="mb-0.5 font-semibold">Backtest failed to launch</div>
            <div className="font-mono text-xs text-red-500">{errorMsg}</div>
          </div>
        </div>
      )}

      {isKilled && (
        <div className="flex items-center gap-2 rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-400">
          <AlertCircle size={14} />
          Kill switch is active - backtests are disabled. Resume trading from the Accounts
          screen.
        </div>
      )}

      <button
        type="button"
        className={clsx(
          'btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm font-semibold',
          !canLaunch && 'cursor-not-allowed opacity-50',
        )}
        onClick={() => launchMutation.mutate()}
        disabled={!canLaunch}
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

      <div className="space-y-1 px-1 text-xs text-gray-600">
        <p>Signals fire at bar close; fills execute at next bar open plus slippage.</p>
        <p>
          Costs: ${commission.toFixed(3)}/share + {commissionPct.toFixed(2)}% per trade -
          {' '}Slippage: {slippage} tick(s) - Capital: ${capital.toLocaleString()}
        </p>
        <p>
          Provider:{' '}
          {dataProvider === 'auto'
            ? `Auto${providerRecommendation ? ` -> ${providerRecommendation.provider}` : ''}`
            : dataProvider}
        </p>
        {walkForwardEnabled ? (
          <p>
            Walk-forward: {trainWindowMonths}m train {'->'} {testWindowMonths}m blind
            test,
            stitched out-of-sample reporting only.
          </p>
        ) : (
          <p>Walk-forward disabled: this run uses naive full-period evaluation.</p>
        )}
        <p>
          Historical bars are downloaded from the selected provider and cached locally on
          first run.
        </p>
      </div>
    </div>
  )
}
