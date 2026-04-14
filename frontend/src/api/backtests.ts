import api from './client'
import type { BacktestRun, CompareRunsResponse, EquityPoint, Trade } from '../types'

export const backtestsApi = {
  launch: (data: {
    strategy_version_id: string
    symbols?: string[]
    timeframe?: string
    start_date?: string
    end_date?: string
    initial_capital?: number
    commission_per_share?: number
    commission_pct_per_trade?: number
    slippage_ticks?: number
    data_provider?: 'auto' | 'yfinance' | 'alpaca'
    alpaca_api_key?: string
    alpaca_secret_key?: string
    walk_forward?: {
      enabled?: boolean
      train_window_months?: number
      test_window_months?: number
      warmup_bars?: number
      max_folds?: number
      selection_metric?: string
      max_parameter_combinations?: number
      parameter_candidates?: Record<string, (string | number)[]>
    }
    cpcv?: {
      enabled?: boolean
      n_paths?: number
      k_test_paths?: number
      embargo_bars?: number
      max_combos?: number
      min_bars_path?: number
    }
  }) => api.post<{ run_id: string; status: string; error?: string | null }>('/backtests/launch', data).then(r => r.data),

  recommendProvider: (data: {
    symbols?: string[]
    timeframe?: string
    start_date?: string
    end_date?: string
    has_alpaca_credentials?: boolean
  }) => api.post<{ provider: 'yfinance' | 'alpaca'; confidence: string; reason: string; warnings: string[] }>('/backtests/provider-recommendation', data).then(r => r.data),

  list: (strategyId?: string, limit?: number) =>
    api.get<BacktestRun[]>('/backtests', { params: { strategy_id: strategyId, limit } }).then(r => r.data),

  get: (runId: string) => api.get<BacktestRun>(`/backtests/${runId}`).then(r => r.data),

  update: (runId: string, data: {
    symbols?: string[]
    timeframe?: string
    start_date?: string
    end_date?: string
    initial_capital?: number
    parameters?: Record<string, unknown>
  }) => api.put<BacktestRun>(`/backtests/${runId}`, data).then(r => r.data),

  getEquityCurve: (runId: string) =>
    api.get<{ equity_curve: EquityPoint[] }>(`/backtests/${runId}/equity-curve`).then(r => r.data),

  getTrades: (runId: string) =>
    api.get<Trade[]>(`/backtests/${runId}/trades`).then(r => r.data),

  compare: (runId: string, otherRunId: string) =>
    api.post<CompareRunsResponse>(`/backtests/${runId}/compare`, { other_run_id: otherRunId }).then(r => r.data),

  delete: (runId: string) => api.delete<{ status: string }>(`/backtests/${runId}`).then(r => r.data),
}
