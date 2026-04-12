# Strategy Starters — Summary & Quick Acceptance Criteria

This document summarizes the starter strategies included in `backend/configs/strategies/` and provides short acceptance criteria and test-case suggestions so they are production-ready.

Included strategies (10):

1. Momentum - Trend Following (`momentum.yaml`)
   - Regime: trending
   - Acceptance: YAML loads and seeds; backtest runs on 1 year of SPY data and produces >= 10 trades; config has scale-out and trailing stop configured.
   - Smoke test: run backtest with `scripts/seed_strategies.py` then call backtest endpoint for the strategy id; ensure no exceptions and trade log produced.

2. Mean Reversion - FVG Fade (`mean_reversion.yaml`)
   - Regime: ranging/low volatility
   - Acceptance: JSON/YAML preview renders in Strategy Studio; backtest produces mean-reversion-shaped exits.
   - Smoke test: validate `stop_loss` uses `fvg_low`/`fvg_high` when detected.

3. Breakout Trend - Channel Break (`breakout_trend.yaml`)
   - Regime: trending_up
   - Acceptance: Donchian/high breakout detection present; backtest demonstrates ATR-protected entries.
   - Smoke test: ensure `trailing_stop` activates after target1 in replay.

4. Macro Mean Reversion - ETF Fade (`macro_reversion.yaml`)
   - Regime: ranging
   - Acceptance: multi-symbol backtest runs across TLT/GLD/IEF and produces portfolio-level metrics.
   - Smoke test: seed then run portfolio backtest and confirm aggregated P&L summary returns.

5. Intraday Scalper - Micro Momentum (`intraday_scalper.yaml`)  (NEW)
   - Regime: intraday 1m
   - Acceptance: loads, backtest completes on 30 days of 1m data without errors; per-trade risk <= configured `risk_pct`.
   - Smoke test: backtest with low-latency fixtures and confirm time_exit applied.

6. Pairs Mean Reversion - Cointegration Fade (`pairs_mean_reversion.yaml`)  (NEW)
   - Regime: cointegrated pair spread
   - Acceptance: config parses `pairs` key; backtest handles spread_zscore inputs and exits on zscore mean reversion.
   - Smoke test: unit test for `spread_zscore` computation against known fixture.

7. Volatility Breakout - Donchian (`volatility_breakout.yaml`)  (NEW)
   - Regime: volatility expansion
   - Acceptance: Donchian breakout + ATR confirmation works; trailing stops applied.
   - Smoke test: synthetic breakout series yields entries and trailing stops move.

8. Gap Open Fade - Opening Reversion (`gap_open_fade.yaml`)  (NEW)
   - Regime: open-session mean reversion
   - Acceptance: open gap detection works and time_exit enforced within first bars.
   - Smoke test: simulated opening gap feed triggers expected entry and time_exit.

9. Swing Reversal - Structure Fade (`swing_reversal.yaml`)  (NEW)
   - Regime: swing reversal on 4h timeframe
   - Acceptance: swing-based stops are applied and scale-out works as configured.
   - Smoke test: run backtest with known swing fixture and verify stop placement.

10. Intraday Momentum - Opening Breakout (`intraday_momentum.yaml`)  (NEW)
    - Regime: opening momentum (5m)
    - Acceptance: opening range detection and volume confirmation must be present; backtest produces reasonable trade counts.
    - Smoke test: simulate opening range breakout and verify entry + trailing stop behaviour.

General testing notes:
- Use `scripts/seed_strategies.py` to seed the YAML configs into the database for UI and backtest validation.
- Define unit tests for small computational functions (FVG detection, spread z-score, opening_range, donchian_high/low).
- E2E test: run a short backtest for each strategy with reduced history to confirm the engine executes without errors.

If you want, I can:
- Run a static validation pass over all YAMLs to ensure fields parse and basic invariants hold.
- Seed the strategies automatically and run miniature backtests to capture sample outputs for each starter.
- Produce Playwright/Jest test skeletons for the ProductManager / QA to run against acceptance criteria.
