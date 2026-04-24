import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertCircle, Database, Info, Loader, Play } from 'lucide-react'
import clsx from 'clsx'
import { backtestsApi } from '../api/backtests'
import { servicesApi } from '../api/services'
import { programsApi } from '../api/programs'
import { DatePickerInput } from '../components/DatePickerInput'
import { SelectMenu } from '../components/SelectMenu'
import { BacktestLaunchOverlay } from '../components/BacktestLaunchOverlay'
import { TickerSearch } from '../components/TickerSearch'
import { useKillSwitchStore } from '../stores/useKillSwitchStore'
import { PageHelp } from '../components/PageHelp'

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
  { value: 'sqn', label: 'SQN (System Quality Number)' },
  { value: 'sortino_ratio', label: 'Sortino Ratio' },
  { value: 'calmar_ratio', label: 'Calmar Ratio' },
  { value: 'total_return_pct', label: 'Total Return %' },
  { value: 'win_rate_pct', label: 'Win Rate %' },
  { value: 'profit_factor', label: 'Profit Factor' },
  { value: 'max_drawdown_pct', label: 'Max Drawdown % (minimize)' },
  { value: 'expectancy', label: 'Expectancy ($)' },
]

/** Derive the natural window unit and sensible defaults from the selected timeframe */
function wfUnitFromTimeframe(tf: string): {
  unit: 'bars' | 'days' | 'months'
  label: string
  defaultTrain: number
  defaultTest: number
  minTrain: number
  minTest: number
  tip: string
} {
  if (['1m', '5m', '15m', '30m'].includes(tf)) {
    return { unit: 'bars', label: 'bars', defaultTrain: 500, defaultTest: 150, minTrain: 100, minTest: 30, tip: 'Try 500 bars train + 150 bars test for minute charts.' }
  }
  if (['1h', '4h'].includes(tf)) {
    return { unit: 'days', label: 'days', defaultTrain: 60, defaultTest: 20, minTrain: 10, minTest: 3, tip: 'Try 60 days train + 20 days test for hourly charts.' }
  }
  // 1d, 1wk
  return { unit: 'months', label: 'months', defaultTrain: 12, defaultTest: 3, minTrain: 3, minTest: 1, tip: 'Try 12 months train + 3 months test for daily charts.' }
}

/** Convert a window value to the backend months field (backend always takes months) */
function toMonths(value: number, unit: 'bars' | 'days' | 'months', barsPerDay: number): number {
  if (unit === 'months') return value
  if (unit === 'days') return Math.max(1, Math.round(value / 30))
  // bars → days → months
  const days = value / barsPerDay
  return Math.max(1, Math.round(days / 30))
}

/** Approximate trading bars per day for a given timeframe */
function barsPerDayForTf(tf: string): number {
  const map: Record<string, number> = { '1m': 390, '5m': 78, '15m': 26, '30m': 13, '1h': 7, '4h': 2, '1d': 1, '1wk': 1 }
  return map[tf] ?? 1
}

export function BacktestLauncher() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillProgramId = searchParams.get('program_id') ?? ''

  const [selectedProgramId, setSelectedProgramId] = useState(prefillProgramId)

  const { data: programs = [], isLoading: programsLoading } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  })
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
  const [trainWindow, setTrainWindow] = useState(12)
  const [testWindow, setTestWindow] = useState(3)
  const [warmupBars, setWarmupBars] = useState(100)
  const [maxFolds, setMaxFolds] = useState(24)
  const [selectionMetric, setSelectionMetric] = useState<string>('sharpe_ratio')

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

  // Reset window defaults when timeframe changes so the unit/values make sense
  const prevTimeframeRef = React.useRef(timeframe)
  useEffect(() => {
    if (prevTimeframeRef.current === timeframe) return
    prevTimeframeRef.current = timeframe
    const { defaultTrain, defaultTest } = wfUnitFromTimeframe(timeframe)
    setTrainWindow(defaultTrain)
    setTestWindow(defaultTest)
  }, [timeframe])

  const wfInfo = wfUnitFromTimeframe(timeframe)

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
      const sharedConfig = {
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
          train_window_months: toMonths(trainWindow, wfInfo.unit, barsPerDayForTf(timeframe)),
          test_window_months: toMonths(testWindow, wfInfo.unit, barsPerDayForTf(timeframe)),
          warmup_bars: warmupBars,
          max_folds: maxFolds,
          selection_metric: selectionMetric,
          max_parameter_combinations: 64,
        },
      }
      const result = await backtestsApi.launch({ ...sharedConfig, program_id: selectedProgramId })

      if (result.status === 'failed') {
        throw new Error(result.error ?? 'Backtest failed to launch')
      }

      return result
    },
    onSuccess: (data) => {
      navigate(`/runs/${data.run_id}`)
    },
  })

  const serviceOptions = alpacaServices.map((service) => ({
    value: service.id,
    label: `${service.name} (${service.environment})${service.is_default ? ' * default' : ''}`,
  }))

  const launchValidationErrors: string[] = []
  if (!selectedProgramId) launchValidationErrors.push('Select a program.')
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
  if (walkForwardEnabled && trainWindow < wfInfo.minTrain) {
    launchValidationErrors.push(`Training window should be at least ${wfInfo.minTrain} ${wfInfo.label}.`)
  }
  if (walkForwardEnabled && testWindow < wfInfo.minTest) {
    launchValidationErrors.push(`Test window should be at least ${wfInfo.minTest} ${wfInfo.label}.`)
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
        <h1 className="text-xl font-bold text-gray-100 flex items-center">Backtest Launcher<PageHelp page="backtest" /></h1>
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
          Program Selection
        </h3>
        <p className="text-xs text-gray-500">
          Backtests run against a full Program — strategy signal + Governor + Execution Style + Risk Profile + Watchlists.
        </p>
        {programsLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader size={14} className="animate-spin" /> Loading programs...
          </div>
        ) : programs.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-400">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
            <span>No programs found. <a href="/programs" className="underline hover:text-amber-300">Build one first</a>.</span>
          </div>
        ) : (
          <div>
            <label className="label">Program</label>
            <SelectMenu className="w-full" value={selectedProgramId} placeholder="- Select a program -"
              options={programs.map(p => ({ value: p.id, label: p.name }))}
              onChange={setSelectedProgramId}
            />
          </div>
        )}
        {selectedProgramId && (
          <p className="text-xs text-gray-500">
            Timeframe and symbols will be resolved from the program's Governor and Watchlists. Override below if needed.
          </p>
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
              <strong className="text-gray-500">Tip:</strong> {wfInfo.tip} Ensure your date range spans at least (train + test) × 2 for meaningful folds.
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div>
                <label className="label">Train Window ({wfInfo.label})</label>
                <input
                  type="number"
                  className="input w-full"
                  min={wfInfo.minTrain}
                  value={trainWindow}
                  onChange={(event) =>
                    setTrainWindow(parseInt(event.target.value, 10) || wfInfo.defaultTrain)
                  }
                />
              </div>
              <div>
                <label className="label">Test Window ({wfInfo.label})</label>
                <input
                  type="number"
                  className="input w-full"
                  min={wfInfo.minTest}
                  value={testWindow}
                  onChange={(event) =>
                    setTestWindow(parseInt(event.target.value, 10) || wfInfo.defaultTest)
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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

      {errorMsg && !launchMutation.isPending && (
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
          Kill switch is active — backtests are disabled. Resume trading from the Accounts screen.
        </div>
      )}

      {/* Launch button — hidden while overlay is showing */}
      {!launchMutation.isPending && !launchMutation.isSuccess && (
        <button
          type="button"
          className={clsx(
            'btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm font-semibold',
            !canLaunch && 'cursor-not-allowed opacity-50',
          )}
          onClick={() => launchMutation.mutate()}
          disabled={!canLaunch}
        >
          <Play size={16} /> Launch Backtest
        </button>
      )}

      {/* Live status overlay — shown from click until redirect */}
      <BacktestLaunchOverlay
        isPending={launchMutation.isPending}
        isSuccess={launchMutation.isSuccess}
        isError={launchMutation.isError}
        runId={launchMutation.data?.run_id}
        errorMsg={errorMsg}
        walkForwardEnabled={walkForwardEnabled}
        symbols={symbolList}
        timeframe={timeframe}
        trainWindowMonths={toMonths(trainWindow, wfInfo.unit, barsPerDayForTf(timeframe))}
        testWindowMonths={toMonths(testWindow, wfInfo.unit, barsPerDayForTf(timeframe))}
      />

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
            Walk-forward: {trainWindow} {wfInfo.label} train {'→'} {testWindow} {wfInfo.label} blind test,
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
