# Example: Variable Slippage Model for BacktestEngine

"""
To use a custom slippage model in BacktestEngine, pass a callable or use a built-in string (e.g., "random_normal") in run_config:

Example run_config:
run_config = {
    ...,
    "slippage_model": "random_normal",  # Built-in: random normal slippage (mean=0, std=1 tick)
    # OR
    # "slippage_model": my_custom_slippage_fn
}

# Custom slippage function signature:
def my_custom_slippage_fn(price, direction, bar, bar_index, symbol, tick_size):
    # Example: volatility-proportional slippage
    slip = bar["atr_14"] * 0.01  # 1% of ATR
    return price + slip if direction == "long" else price - slip

# Pass to BacktestEngine:
engine = BacktestEngine(strategy_config, {**run_config, "slippage_model": my_custom_slippage_fn})
"""
