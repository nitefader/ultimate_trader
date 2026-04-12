import pytest

from app.services.alpaca_service import (
    AlpacaConfigError,
    AlpacaOrderRequest,
    AlpacaOrderValidationError,
    LIVE_BASE_URL,
    PAPER_BASE_URL,
    _build_order_request,
    build_client_config,
)


def test_build_client_config_defaults_to_paper_url():
    config = build_client_config("paper-key", "paper-secret", "paper")

    assert config.mode == "paper"
    assert config.base_url == PAPER_BASE_URL


def test_build_client_config_rejects_mode_url_mismatch():
    with pytest.raises(AlpacaConfigError):
        build_client_config("paper-key", "paper-secret", "paper", LIVE_BASE_URL)


def test_build_order_request_rejects_unsupported_tif_for_equities():
    with pytest.raises(AlpacaOrderValidationError):
        _build_order_request(
            AlpacaOrderRequest(
                symbol="AAPL",
                qty=1,
                side="buy",
                order_type="market",
                time_in_force="unsupported",
            )
        )


def test_build_order_request_requires_limit_price_for_limit_orders():
    with pytest.raises(AlpacaOrderValidationError):
        _build_order_request(
            AlpacaOrderRequest(
                symbol="AAPL",
                qty=1,
                side="buy",
                order_type="limit",
                time_in_force="day",
            )
        )
