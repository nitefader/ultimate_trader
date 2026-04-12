# Position Sizing Config Examples

"""
Supported methods for calculate_position_size:

- Fixed shares: {"method": "fixed_shares", "shares": 100}
- Fixed dollar: {"method": "fixed_dollar", "amount": 10000}
- Fixed % equity: {"method": "fixed_pct_equity", "pct": 10.0}
- Risk %: {"method": "risk_pct", "risk_pct": 1.0}  # risk 1% of equity
- ATR risk: {"method": "atr_risk", "atr_period": 14, "atr_mult": 1.0, "risk_pct": 1.0}
- Kelly: {"method": "kelly", "win_rate": 0.55, "avg_win": 2.0, "avg_loss": 1.0}
- Rolling Kelly: {"method": "rolling_kelly"}

Example usage:
config = {"method": "risk_pct", "risk_pct": 1.0}
quantity = calculate_position_size(config, entry_price, stop_price, account_equity, direction, df, bar_index)
"""
