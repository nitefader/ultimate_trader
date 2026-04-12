import pytest


def test_from_keys_rejects_mismatched_baseurl_and_mode():
    from app.brokers.alpaca_broker import AlpacaBroker

    # Paper flag true but live host provided -> should raise
    with pytest.raises(ValueError):
        AlpacaBroker.from_keys("AK", "SK", paper=True, base_url="https://api.alpaca.markets")

    # Paper flag false but paper host provided -> should raise
    with pytest.raises(ValueError):
        AlpacaBroker.from_keys("AK", "SK", paper=False, base_url="https://paper-api.alpaca.markets")


def test_from_keys_allows_matching_baseurl_and_mode():
    from app.brokers.alpaca_broker import AlpacaBroker

    b = AlpacaBroker.from_keys("AK", "SK", paper=True, base_url="https://paper-api.alpaca.markets")
    assert b._config.mode == "paper"
    assert b._config.base_url == "https://paper-api.alpaca.markets"

    b2 = AlpacaBroker.from_keys("AK", "SK", paper=False, base_url="https://api.alpaca.markets")
    assert b2._config.mode == "live"
    assert b2._config.base_url == "https://api.alpaca.markets"
