# Stop-Loss Config Examples

"""
Supported methods for calculate_stop:

- Fixed %: {"method": "fixed_pct", "value": 2.0}
- Fixed dollar: {"method": "fixed_dollar", "value": 500}
- ATR multiple: {"method": "atr_multiple", "period": 14, "mult": 2.0}
- Previous bar low/high: {"method": "prev_bar_low"} or {"method": "prev_bar_high"}
- N bars low/high: {"method": "n_bars_low", "n": 3}
- Swing low/high: {"method": "swing_low", "lookback": 3}
- FVG low/midpoint: {"method": "fvg_low", "direction": "bullish"}
- S/R support/resistance: {"method": "sr_support"}
- Session low/high: {"method": "session_low"}
- Chandelier: {"method": "chandelier", "period": 22, "mult": 3.0}
- Combined: {"method": "combined", "stops": [...], "rule": "farthest"}

Example usage:
config = {"method": "atr_multiple", "period": 14, "mult": 2.0}
stop_price = calculate_stop(config, entry_price, direction, bar, df, bar_index)
"""
