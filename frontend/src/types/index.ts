export type Mode = 'backtest' | 'paper' | 'live'
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type DeploymentStatus = 'pending' | 'running' | 'paused' | 'stopped' | 'failed'
export type DurationMode = 'day' | 'swing' | 'position'

export interface Strategy {
  id: string
  name: string
  description?: string
  category: string
  status: string
  tags: string[]
  created_at: string
  updated_at?: string
}

export interface StrategyVersion {
  id: string
  strategy_id: string
  version: number
  config: StrategyConfig
  notes?: string
  duration_mode: DurationMode
  promotion_status: string
  created_at: string
}

export interface MarketHoursWindow {
  start: string  // "HH:MM" in timezone
  end: string
}

export interface MarketHoursConfig {
  timezone?: string
  entry_windows?: MarketHoursWindow[]
  force_flat_by?: string  // "HH:MM" — hard EOD exit
  skip_first_bar?: boolean
}

export interface PDTConfig {
  enforce?: boolean
  max_day_trades_per_window?: number
  window_sessions?: number
  equity_threshold?: number
  on_limit_reached?: 'pause_entries' | 'block_new' | 'warn_only'
}

export interface GapRiskConfig {
  max_gap_pct?: number
  weekend_position_allowed?: boolean
  earnings_blackout?: boolean
  earnings_blackout_days_before?: number
}

export interface ExitConfig {
  max_bars?: number
}

export interface EntryModuleConfig {
  order_type?: 'market' | 'limit' | 'stop'
  limit_offset_atr?: number | null
  limit_offset_pct?: number | null
  time_in_force?: 'day' | 'gtc' | 'ioc'
  cancel_after_bars?: number | null
}

export interface StrategyConfig {
  hypothesis?: string
  name?: string
  symbols?: string[]
  watchlist_id?: string
  watchlist_name?: string
  timeframe?: string
  duration_mode?: DurationMode
  entry?: EntryConfig
  stop_loss?: StopConfig
  short_stop_loss?: StopConfig
  targets?: TargetConfig[]
  short_targets?: TargetConfig[]
  exit_conditions?: { logic?: string; conditions?: Condition[] }
  short_exit_conditions?: { logic?: string; conditions?: Condition[] }
  position_sizing?: SizingConfig
  risk?: RiskConfig
  scale_in?: ScaleConfig
  trailing_stop?: TrailingStopConfig
  leverage?: number
  indicators?: IndicatorConfig
  entry_module?: EntryModuleConfig
  exit?: ExitConfig
}

export interface EntryConfig {
  directions?: string[]
  logic?: string
  conditions?: Condition[]
  short_conditions?: Condition[]
  long_logic?: string
  short_logic?: string
}

export interface Condition {
  type: 'single' | 'all_of' | 'any_of' | 'n_of_m' | 'regime_filter' | 'not'
  left?: ValueSpec
  op?: string
  right?: ValueSpec
  conditions?: Condition[]
  n?: number
  condition?: Condition
  allowed?: string[]
}

export interface ValueSpec {
  field?: string
  indicator?: string
  prev_bar?: string
  n_bars_back?: number
  period?: number
  timeframe?: string  // override evaluation timeframe for this indicator (e.g. "15m")
}

export interface StopConfig {
  method: string
  value?: number
  period?: number
  mult?: number
  timeframe?: string   // ATR timeframe override (e.g. "1h") — blank = use trade TF
  stops?: StopConfig[]
  rule?: string
}

export interface TargetConfig {
  method: string
  r?: number
  value?: number
  period?: number
  mult?: number
  timeframe?: string   // ATR timeframe override (e.g. "1h") — blank = use trade TF
}

export interface SizingConfig {
  method: string
  risk_pct?: number
  shares?: number
  amount?: number
  pct?: number
}

export interface RiskConfig {
  max_position_size_pct?: number
  max_daily_loss_pct?: number
  max_drawdown_lockout_pct?: number
  max_open_positions?: number
  max_portfolio_heat?: number
}

export interface RegimeFilter {
  allowed: string[]
}

export interface CooldownRule {
  trigger: string
  duration_minutes?: number
  duration_bars?: number
  session_reset?: boolean
  consecutive_count?: number
  symbol_level?: boolean
}

export interface ScaleConfig {
  max_adds?: number
  levels?: ScaleLevel[]
  move_stop_to_be_after_t1?: boolean
  conditions?: Condition[]
}

export interface ScaleLevel {
  level?: number
  pct: number
}

export interface TrailingStopConfig {
  method: string
  period?: number
  mult?: number
  value?: number
}

export interface IndicatorConfig {
  ema_periods?: number[]
  sma_periods?: number[]
  rsi_periods?: number[]
}

// ── IndicatorSpec — typed union for all supported indicators ─────────────────
// Each discriminated variant maps directly to a backend indicator function.

export type IndicatorSpec =
  | { kind: 'sma';           period: number }
  | { kind: 'ema';           period: number }
  | { kind: 'wma';           period: number }
  | { kind: 'vwma';          period: number }
  | { kind: 'hull_ma';       period: number }
  | { kind: 'rsi';           period: number }
  | { kind: 'macd';          fast: number; slow: number; signal: number }
  | { kind: 'bollinger';     period: number; std_dev: number }
  | { kind: 'keltner';       period: number; mult: number }
  | { kind: 'donchian';      period: number }
  | { kind: 'atr';           period: number }
  | { kind: 'adx';           period: number }
  | { kind: 'stochastic';    k_period: number; d_period: number }
  | { kind: 'chandelier';    period: number; mult: number }
  | { kind: 'ichimoku';      tenkan: number; kijun: number; senkou_b: number; displacement: number }
  | { kind: 'vwap_session' }
  | { kind: 'obv' }
  | { kind: 'fractals';      n: number }
  | { kind: 'pivot_points' }
  | { kind: 'swing_highs_lows'; lookback: number }

export type IndicatorKind = IndicatorSpec['kind']


// ── Backtest ──────────────────────────────────────────────────────────────────

export interface BacktestRun {
  id: string
  strategy_version_id: string
  mode: Mode
  status: RunStatus
  symbols: string[]
  timeframe: string
  start_date: string
  end_date: string
  initial_capital: number
  created_at: string
  completed_at?: string
  error_message?: string
  metrics?: RunMetrics
  validation_evidence?: ValidationEvidence
  feature_plan_preview?: StrategyFeaturePlanPreview
}

export interface RunMetrics {
  total_return_pct?: number
  cagr_pct?: number
  sharpe_ratio?: number
  sortino_ratio?: number
  calmar_ratio?: number
  max_drawdown_pct?: number
  max_drawdown_duration_days?: number
  recovery_factor?: number
  total_trades?: number
  winning_trades?: number
  losing_trades?: number
  win_rate_pct?: number
  avg_win_pct?: number
  avg_loss_pct?: number
  expectancy?: number
  profit_factor?: number
  avg_hold_days?: number
  long_trades?: number
  short_trades?: number
  exit_reason_breakdown?: Record<string, number>
  regime_breakdown?: Record<string, number>
  monthly_returns?: Record<string, number>
  monte_carlo?: MonteCarloResult
  walk_forward?: WalkForwardResult
  no_trades?: boolean
}

export interface WalkForwardResult {
  method?: string
  warnings?: string[]
  settings?: {
    train_window_months?: number
    test_window_months?: number
    warmup_bars?: number
    max_folds?: number
  }
  folds?: WalkForwardFold[]
  stitched_oos_equity?: Array<{ date: string; equity: number }>
  naive_full_period?: {
    total_return_pct?: number | null
    sharpe_ratio?: number | null
    max_drawdown_pct?: number | null
    total_trades?: number | null
  }
  anti_bias?: {
    cpcv_primary_guard_passed?: boolean
    leakage_checks_passed?: boolean
    parameter_locking_passed?: boolean
    causal_indicator_checks_passed?: boolean
    non_causal_indicator_refs?: string[]
  }
  cpcv?: CpcvResult
  aggregate_oos?: {
    fold_count?: number
    oos_total_return_pct?: number | null
    avg_oos_return_pct?: number | null
    positive_oos_fold_rate_pct?: number | null
  }
}

export interface WalkForwardFold {
  fold_id: string
  train_start: string
  train_end: string
  test_start: string
  test_end: string
  train_trades_count?: number
  test_trades_count?: number
  selected_parameters?: Record<string, string | number>
  parameter_locking_validated?: boolean
  turnover_shares?: number
  cost_impact?: number
  notes?: string | null
  train_metrics?: {
    total_return_pct?: number
    sharpe_ratio?: number
  }
  test_metrics?: {
    total_return_pct?: number
    sharpe_ratio?: number
    regime_breakdown?: Record<string, number>
  }
}

export interface CpcvResult {
  method?: string
  warnings?: string[]
  settings?: {
    n_paths?: number
    k_test_paths?: number
    embargo_bars?: number
    total_combos_evaluated?: number
  }
  aggregate?: {
    median_is_sharpe?: number | null
    median_oos_sharpe?: number | null
    pct_positive_oos_folds?: number | null
    is_oos_degradation_ratio?: number | null
    is_oos_degradation_infinite?: boolean
    fold_count?: number
    pass_primary_guard?: boolean
  }
  folds?: Array<{
    combo_id: string
    train_path_ids?: number[]
    test_path_ids?: number[]
    train_bars?: number
    test_bars?: number
    is_sharpe?: number
    oos_sharpe?: number
    oos_return_pct?: number
    parameter_locking_validated?: boolean
    error?: string
  }>
}

export interface ValidationEvidence {
  method?: string
  cpcv?: CpcvResult
  walk_forward?: WalkForwardResult
  anti_bias?: WalkForwardResult['anti_bias']
  regime_performance?: Record<string, number>
  per_symbol_oos_sharpe?: Record<string, number | null>
  cost_sensitivity_curve?: Array<{
    slippage_bps: number
    sharpe_ratio?: number | null
    total_return_pct?: number | null
    trade_count?: number | null
    error?: string
  }>
  warnings?: string[]
  is_oos_degradation_ratio?: number | null
  stability_score?: number | null
  created_at?: string | null
}

export interface MonteCarloResult {
  median_return_pct?: number
  p5_return_pct?: number
  p95_return_pct?: number
  median_max_drawdown_pct?: number
  p95_max_drawdown_pct?: number
  probability_profitable?: number
}

export interface StrategyFeaturePlanPreviewItem {
  kind: string
  timeframe: string
  source: string
  params: Record<string, unknown>
  runtime_columns: string[]
}

export interface StrategyFeaturePlanPreview {
  symbols: string[]
  timeframes: string[]
  feature_keys: string[]
  warmup_bars_by_timeframe: Record<string, number>
  features: StrategyFeaturePlanPreviewItem[]
}

export interface StrategyValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  feature_plan_preview?: StrategyFeaturePlanPreview
}

export interface EquityPoint {
  date: string
  equity: number
  cash: number
  drawdown: number
  regime: string
}

// User Journey validations (docs-driven)
export interface UserJourney {
  id: number
  domain: string
  title: string
  pages_components: string
  api_routes: string
  required_steps: string
  edge_cases: string
  priority: string
  status: 'covered' | 'partial' | 'not_covered'
  raw_status: string
}

export interface CoverageSummaryRow {
  domain: string
  total?: number | null
  covered?: number | null
  partial?: number | null
  not_covered?: number | null
}

export interface UserJourneyValidationsResponse {
  journeys: UserJourney[]
  coverage_summary: CoverageSummaryRow[]
  raw_markdown: string
}

export interface ScaleEvent {
  id: string
  event_type: 'scale_in' | 'scale_out'
  time: string
  price: number
  quantity: number
  quantity_pct: number
  reason?: string
  new_stop?: number
  realized_pnl?: number
}

export interface Trade {
  id: string
  symbol: string
  direction: string
  // Entry
  entry_time?: string
  entry_price: number
  entry_order_type?: string
  initial_quantity?: number
  initial_stop?: number
  initial_target?: number
  // Exit
  exit_time?: string
  exit_price?: number
  exit_quantity?: number
  exit_reason?: string
  // P&L
  realized_pnl?: number
  commission?: number
  slippage?: number
  net_pnl?: number
  return_pct?: number
  r_multiple?: number
  // State
  is_open?: boolean
  max_adverse_excursion?: number   // MAE — worst price against position
  max_favorable_excursion?: number  // MFE — best price in position's favor
  // Context
  regime_at_entry?: string
  entry_conditions_fired?: string[]
  tags?: string[]
  // Relations
  quantity: number
  scale_events?: ScaleEvent[]
}

export interface CompareRunSummary {
  run_id: string
  status: string
  symbols: string[]
  timeframe: string
  start_date: string
  end_date: string
  total_return_pct?: number | null
  cagr_pct?: number | null
  sharpe_ratio?: number | null
  max_drawdown_pct?: number | null
  win_rate_pct?: number | null
  profit_factor?: number | null
  total_trades?: number | null
  oos_total_return_pct?: number | null
  avg_oos_return_pct?: number | null
  cpcv_median_oos_sharpe?: number | null
  cpcv_passed?: boolean | null
  anti_bias_passed?: boolean | null
}

export interface CompareRunsResponse {
  left_run: CompareRunSummary
  right_run: CompareRunSummary
  deltas: {
    total_return_pct?: number | null
    sharpe_ratio?: number | null
    max_drawdown_pct?: number | null
    win_rate_pct?: number | null
    total_trades?: number | null
    oos_total_return_pct?: number | null
  }
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export interface Account {
  id: string
  name: string
  mode: Mode
  broker: string
  account_mode: 'cash' | 'margin'  // CASH: no shorts, no leverage, T+1; MARGIN: full controls
  initial_balance: number
  current_balance: number
  equity: number
  unrealized_pnl: number
  leverage: number
  max_position_size_pct: number
  max_daily_loss_pct: number
  max_drawdown_lockout_pct: number
  max_open_positions: number
  is_connected: boolean
  is_enabled: boolean
  is_killed: boolean
  kill_reason?: string
  allowed_symbols: string[]
  blocked_symbols: string[]
  data_service_id?: string | null
  broker_config?: Record<string, unknown>
  activity?: AccountActivity
  risk_profile_id?: string | null
  risk_profile?: Pick<RiskProfile, 'id' | 'name'> | null
  created_at: string
  updated_at?: string
}

export interface AccountActivity {
  deployment_count: number
  active_deployments: number
  open_trades: number
  open_positions: number
  open_orders: number
  position_symbols: string[]
  delete_blockers: string[]
  can_delete: boolean
  broker_error?: string | null
}

// ── Deployments ───────────────────────────────────────────────────────────────

export interface Deployment {
  id: string
  strategy_id: string
  strategy_version_id: string
  account_id: string
  mode: Mode
  status: DeploymentStatus
  config_overrides: Record<string, unknown>
  promoted_from_run_id?: string
  promoted_from_deployment_id?: string
  started_at?: string
  stopped_at?: string
  stop_reason?: string
  created_at: string
  approvals?: DeploymentApproval[]
}

export interface DeploymentApproval {
  id: string
  from_mode: Mode
  to_mode: Mode
  approved_by: string
  approved_at: string
  notes?: string
  safety_checklist: Record<string, boolean>
}

// ── Kill Switch ───────────────────────────────────────────────────────────────

export interface KillSwitchStatus {
  global_killed: boolean
  global_kill_reason?: string
  killed_accounts: string[]
  killed_strategies: string[]
}

// ── Risk Profiles ─────────────────────────────────────────────────────────────

export interface RiskProfile {
  id: string
  name: string
  description?: string
  // Directional long
  max_open_positions_long: number
  max_portfolio_heat_long: number
  max_correlated_exposure_long: number
  max_position_size_pct_long: number
  // Directional short
  max_open_positions_short: number
  max_portfolio_heat_short: number
  max_correlated_exposure_short: number
  max_position_size_pct_short: number
  // Account-wide
  max_daily_loss_pct: number
  max_drawdown_lockout_pct: number
  max_leverage: number
  // Provenance
  source_type: 'manual' | 'backtest' | 'optimizer'
  source_run_id?: string
  source_optimization_id?: string
  is_golden?: boolean
  tags?: string[]
  linked_accounts: Array<{ id: string; name: string }>
  created_at: string
  updated_at: string
}

// ── Strategy Controls ─────────────────────────────────────────────────────────

export interface StrategyControls {
  id: string
  name: string
  description: string | null
  timeframe: string
  duration_mode: DurationMode
  market_hours: MarketHoursConfig
  pdt: PDTConfig
  gap_risk: GapRiskConfig
  regime_filter: RegimeFilter
  cooldown_rules: CooldownRule[]
  max_trades_per_session: number | null
  max_trades_per_day: number | null
  min_time_between_entries_min: number | null
  earnings_blackout_enabled: boolean
  is_golden: boolean
  tags: string[]
  source_type: string
  created_at: string | null
  updated_at: string | null
}

// ── Execution Style ───────────────────────────────────────────────────────────

export interface ExecutionStyle {
  id: string
  name: string
  description: string | null
  entry_order_type: 'market' | 'limit' | 'stop' | 'stop_limit'
  entry_time_in_force: 'day' | 'gtc' | 'ioc' | 'opg' | 'cls'
  entry_limit_offset_method: 'atr' | 'pct' | 'fixed' | null
  entry_limit_offset_value: number | null
  entry_cancel_after_bars: number | null
  bracket_mode: 'none' | 'bracket' | 'oco' | 'trailing_stop'
  stop_order_type: 'market' | 'limit'
  take_profit_order_type: 'market' | 'limit'
  trailing_stop_type: 'percent' | 'dollar' | null
  trailing_stop_value: number | null
  scale_out: ScaleLevel[]
  stop_progression_targets: number[]
  atr_source: 'strategy' | 'custom'
  atr_length: number | null
  atr_timeframe: string | null
  breakeven_trigger_level: number | null
  breakeven_atr_offset: number
  final_runner_exit_mode: 'internal' | 'alpaca_trailing'
  final_runner_trail_type: 'percent' | 'price' | 'atr' | null
  final_runner_trail_value: number | null
  final_runner_time_in_force: 'day' | 'gtc' | null
  fill_model: string
  slippage_bps_assumption: number
  commission_per_share: number
  is_golden: boolean
  tags: string[]
  source_type: string
  created_at: string | null
  updated_at: string | null
}

// ── Portfolio Governor ────────────────────────────────────────────────────────

export interface PortfolioGovernor {
  id: string
  account_id: string
  governor_label?: string
  governor_status: 'initializing' | 'active' | 'paused' | 'halted'
  status: string
  risk_profile_id?: string
  poll_config: Record<string, number>
  session_realized_pnl: number
  daily_loss_lockout_triggered: boolean
  halt_trigger?: string
  halt_at?: string
  last_governor_tick_at?: string
  created_at: string
}

export interface GovernorEvent {
  id: string
  governor_id: string
  allocation_id?: string
  event_type: string
  symbol?: string
  detail: Record<string, unknown>
  emitted_at: string
}
