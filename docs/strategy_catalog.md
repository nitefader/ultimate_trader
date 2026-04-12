# Strategy Catalog — Starter Strategies

This document summarises the starter strategy templates included under `backend/configs/strategies/` and suggested acceptance criteria for each.

For each strategy the minimal acceptance criteria are:
- YAML loads and parses
- Passes `POST /strategies/validate` (no fatal config errors)
- Backtest smoke run (local synthetic data) completes without exception
- Conservative default risk/sizing is present (position_sizing or defaults)

Strategies included:

- `momentum.yaml` — Momentum — Trend following with EMA crossover, ADX filter, swing stops, scale-out. Acceptance: validate + backtest smoke.
- `volatility_breakout.yaml` — Donchian/ATR breakout with volatility confirmation. Acceptance: validate + backtest smoke.
- `swing_reversal.yaml` — Swing-based reversal with RSI confirmation. Acceptance: validate + backtest smoke.
- `pairs_mean_reversion.yaml` — Cointegration pairs mean-reversion. Acceptance: validate + backtest smoke.
- `mean_reversion.yaml` — FVG/SR mean reversion with regime filter. Acceptance: validate + backtest smoke.
- `macro_reversion.yaml` — ETF mean-reversion fade. Acceptance: validate + backtest smoke.
- `intraday_scalper.yaml` — 1m scalper with tight ATR stops. Acceptance: validate + backtest smoke.
- `intraday_momentum.yaml` — First-hour opening breakout (5m). Acceptance: validate + backtest smoke.
- `gap_open_fade.yaml` — Opening gap fade with VWAP/time exit. Acceptance: validate + backtest smoke.
- `breakout_trend.yaml` — Breakout with volume confirmation and trailing exit. Acceptance: validate + backtest smoke.

Next steps:
- `QuantLead` should author short research notes and expected KPIs for each strategy (Sharpe target, min trades, max drawdown threshold).
- `ProductManager` must add explicit acceptance criteria per strategy and map them to test cases in `backend/tests/`.
