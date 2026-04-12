# UltraTrader 2026 — Product Requirements Document

**Version:** 1.0 draft  
**Date:** April 2026  
**Audience:** PM, Project Manager, TigerTeam, Engineering, Design, QA, Risk, Compliance

## 1. Executive Summary
UltraTrader 2026 is a full-stack algorithmic trading platform that supports the full workflow from strategy creation to backtest, paper deployment, live deployment, monitoring, and emergency controls. The product must make trading state obvious, strategy behavior explainable, and promotion to paper/live both safe and fast.

## 2. Problem Statement
Trading workflows are often fragmented across separate tools for research, backtesting, live execution, and monitoring. This increases operational risk and slows learning loops. UltraTrader should unify those workflows and provide strong controls around data reuse, strategy versioning, approvals, account routing, and live supervision.

## 3. Goals
- Unify the workflow: Create Strategy → Backtest → Paper → Live → Monitor → Kill/Stop/Pause.
- Support rich no-code/low-code strategy configuration.
- Persist all critical artifacts: strategies, versions, accounts, credentials, cache, runs, deployments, and logs.
- Make risk state obvious across all screens.
- Deliver a cloud-ready, production-grade platform.

## 4. Non-goals
- A fully opaque autonomous trading black box.
- Broker exclusivity beyond the first deep Alpaca integration.
- A full institutional OMS replacement in the first release.

## 5. Users
- Trader
- Quant / Strategy Developer
- Risk Manager
- Admin
- Compliance / Audit Stakeholder

## 6. Product Principles
- Mode clarity beats cleverness.
- Explainable over magical.
- Safety defaults first.
- Reuse before redownload.
- Configuration over code forks.
- Premium operator UX.

## 7. In-Scope Modules
- Dashboard
- Strategy Studio
- Backtest Lab
- Accounts & Credentials
- Deployment Manager
- Live Monitor
- Data Vault
- Event Calendar & Regime
- Logs & Controls
- ML Decision Support (P1)

## 8. Core Functional Requirements

### 8.1 Strategy Studio
- Visual strategy builder with sections for entries, filters, exits, sizing, scaling, cooldowns, regime, events, deployments, and notes.
- Support `all_of`, `any_of`, `not`, and `n_of_m` logic including 6-of-7 configurations.
- Allow entry and exit rules based on price, indicators, previous-bar OHLC, prior-N-bar OHLC, support/resistance, FVG, session levels, and regime.
- Support structure-aware stop-loss and target placement using swing highs/lows, prior-day levels, support/resistance, FVG bounds/midpoint, ATR, and fixed rules.
- Support staged scale-in and scale-out rules.
- Support cooldowns after wins, losses, exits, stop-outs, streaks, and events.
- Persist version history and show JSON/YAML previews.
- Provide a searchable ticker universe.

### 8.2 Backtest Lab
- No-lookahead simulation with explicit fill rules.
- Multi-symbol and multi-timeframe support.
- Slippage, commission, leverage, margin, and session assumptions.
- Trade logs with entry/exit reasons and triggering conditions.
- Equity, drawdown, heatmaps, Monte Carlo, and comparison views.

### 8.3 Data Vault
- Cache and reuse historical OHLCV data.
- Augment overlapping ranges instead of redownloading.
- CRUD for cached datasets.
- Track source, freshness, adjusted mode, row count, and storage footprint.

### 8.4 Accounts & Credentials
- CRUD for multiple paper and live accounts.
- Safe front-end credential management.
- Strong visual distinction between paper and live.
- Multi-account routing with account-specific overrides.

### 8.5 Deployment & Promotion
- Promote backtest-approved strategies to paper without rewrites.
- Promote paper deployments to live only after approvals and safety checks.
- Preserve audit history and deployment notes.

### 8.6 Operations & Safety
- Global and scoped kill switches.
- Flatten position / flatten deployment / flatten account controls.
- Risk controls for leverage, margin, max position size, max daily loss, drawdown lockout, and portfolio heat.
- Clear Backtest/Paper/Live banners and mode indicators.

### 8.7 Regime, Events, and ML
- Regime-aware trading filters.
- Event blackout windows around macro and symbol-specific announcements.
- Optional explainable ML assistance for ranking, filtering, regime classification, or probability scoring.

## 9. UX Requirements
- Calm, professional design system.
- High-contrast live-state warnings.
- Guided confirmations for critical actions.
- Clear status, failure, and next-step states.
- Strategy builder should feel deliberate, not like a raw form.

## 10. Non-Functional Requirements
- Async job handling for long tasks.
- Structured logging and audit trails.
- Containerization and environment-based config.
- SQLite locally, production-grade relational database in cloud.
- Test coverage for execution, scaling, cooldowns, kill behavior, cache behavior, and critical APIs.
- Safe secret handling.

## 11. Acceptance Criteria
- Create strategies with N-of-M logic, scaling, cooldowns, and structure-aware rules.
- Use previous-bar OHLC, support/resistance, and FVG in strategy logic.
- Launch backtests and inspect explainable trade behavior.
- Cache and augment historical data.
- Manage paper and live Alpaca accounts safely from the UI.
- Promote winning backtests to paper, then to live with approvals.
- Monitor multiple accounts with visible mode state.
- Trigger kill controls and see them logged.
- Run locally and deploy via containers.

## 12. TigerTeam Delivery Plan
1. Foundation
2. Core trading workflows
3. Promotion and safety
4. Advanced strategy intelligence
5. Hardening and polish

## 13. Key Open Questions
- Role permissions for live approvals and kill-switch disarm.
- First-release market scope and session coverage.
- Final ML scope and evaluation framework.
- Provider limits and cache freshness policy.
