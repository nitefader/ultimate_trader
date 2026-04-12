# Quant Research Workflow Template

This Jupyter notebook template guides systematic quant research for new strategies.

## 1. Hypothesis Statement
- Clearly state the trading hypothesis or alpha idea.

## 2. Data Exploration
- Load and visualize relevant market data.
- Check for missing values, outliers, and data quality.

## 3. Feature Engineering
- Create features/indicators for signal generation.
- Document rationale for each feature.

## 4. In-Sample Backtest
- Run initial backtest on in-sample data.
- Plot equity curve, drawdown, and key metrics.

## 5. Out-of-Sample Validation
- Split data and run out-of-sample backtest (walk-forward or cross-validation).
- Compare in-sample vs. out-of-sample performance.

## 6. Statistical Evaluation
- Compute Sharpe, Sortino, t-stat, and autocorrelation of returns.
- Check for overfitting and regime dependence.

## 7. Transaction Cost & Slippage Simulation
- Model realistic costs and slippage in backtest.

## 8. Risk Analysis
- Analyze drawdown, volatility, and max position size.

## 9. Documentation & Handoff
- Summarize findings, risks, and next steps.
- Attach code and results for review.

---

_Use this template for all new quant research. Save completed notebooks in the research/ directory._
