from __future__ import annotations

import yaml
from pathlib import Path
import pandas as pd
import numpy as np
import pytest

from app.core.backtest import BacktestEngine


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _make_synthetic_df(n=120):
    idx = pd.date_range("2020-01-01", periods=n, freq="D")
    prices = 100 + np.cumsum(np.random.randn(n) * 0.5)
    open_p = prices + np.random.randn(n) * 0.2
    high = np.maximum(open_p, prices) + np.abs(np.random.randn(n) * 0.2)
    low = np.minimum(open_p, prices) - np.abs(np.random.randn(n) * 0.2)
    close = prices
    volume = np.random.randint(1000, 5000, size=n)
    df = pd.DataFrame({"open": open_p, "high": high, "low": low, "close": close, "volume": volume}, index=idx)
    return df


def test_backtest_engine_smoke_runs_for_each_strategy():
    configs_dir = _repo_root() / "backend" / "configs" / "strategies"
    yamls = sorted(list(configs_dir.glob("*.yaml")))
    assert yamls, "Expected at least one sample strategy YAML"

    for p in yamls:
        cfg = yaml.safe_load(p.read_text(encoding="utf-8"))
        symbols = cfg.get("symbols") or ["SPY"]
        symbol = symbols[0]
        df = _make_synthetic_df(n=120)
        data = {symbol: df}
        run_cfg = {"symbols": [symbol], "timeframe": cfg.get("timeframe", "1d"), "start_date": str(df.index[0].date()), "end_date": str(df.index[-1].date()), "initial_capital": 100_000}

        engine = BacktestEngine(cfg, run_cfg)
        if cfg.get("pairs"):
            with pytest.raises(ValueError, match="Pairs backtests are not supported"):
                engine.run_backtest(data)
            continue

        result = engine.run_backtest(data)

        assert hasattr(result, "trades"), f"Backtest result missing trades for {p.name}"
        assert isinstance(result.trades, list)
