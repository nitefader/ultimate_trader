from __future__ import annotations

import os
import pytest

from app.services.alpaca_service import validate_credentials, build_client_config


def _has_alpaca_env() -> bool:
    return bool(os.environ.get("ALPACA_API_KEY") and os.environ.get("ALPACA_SECRET_KEY"))


@pytest.mark.skipif(not _has_alpaca_env(), reason="ALPACA_API_KEY/ALPACA_SECRET_KEY not set")
def test_validate_alpaca_sandbox_credentials():
    api_key = os.environ["ALPACA_API_KEY"]
    secret = os.environ["ALPACA_SECRET_KEY"]
    base = os.environ.get("ALPACA_BASE_URL", "https://paper-api.alpaca.markets")
    # Strip trailing /v2 path if present — build_client_config expects bare host
    base = base.rstrip("/").removesuffix("/v2")

    config = build_client_config(api_key, secret, "paper", base)
    resp = validate_credentials(config)
    assert resp.get("valid") is True, f"Sandbox credential validation failed: {resp}"
