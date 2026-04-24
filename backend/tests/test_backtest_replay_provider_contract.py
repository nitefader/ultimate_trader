from __future__ import annotations

import pytest

from app.api.routes.backtests import _resolve_trade_replay_provider
from app.models.run import BacktestRun


def _make_run(parameters: dict[str, object] | None) -> BacktestRun:
    return BacktestRun(
        strategy_version_id="strategy-version-id",
        start_date="2024-01-01",
        end_date="2024-03-31",
        parameters=parameters or {},
    )


def test_trade_replay_prefers_provider_used() -> None:
    run = _make_run({"data_provider_used": "alpaca", "data_provider_requested": "yfinance"})
    assert _resolve_trade_replay_provider(run) == "alpaca"


def test_trade_replay_uses_explicit_requested_provider_when_used_missing() -> None:
    run = _make_run({"data_provider_requested": "yfinance"})
    assert _resolve_trade_replay_provider(run) == "yfinance"


@pytest.mark.parametrize(
    "parameters",
    [
        {},
        {"data_provider_requested": "auto"},
        {"data_provider_used": "auto"},
    ],
)
def test_trade_replay_rejects_ambiguous_provider_provenance(parameters: dict[str, object]) -> None:
    run = _make_run(parameters)
    with pytest.raises(ValueError, match="provider provenance is ambiguous"):
        _resolve_trade_replay_provider(run)
