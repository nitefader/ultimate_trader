"""
Shared Alpaca Trading API v2 service built on the official alpaca-py SDK.

Paper and live trading both flow through the same client config and order
request models. The only environment-specific inputs are credentials, the
approved base URL, and the paper/live mode flag.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal, Callable, Awaitable
import asyncio

from alpaca.common.exceptions import APIError
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderClass, OrderSide, QueryOrderStatus, TimeInForce
from alpaca.trading.requests import (
    GetOrdersRequest,
    LimitOrderRequest,
    MarketOrderRequest,
    MarketOrderRequest as _BracketBase,
    ReplaceOrderRequest,
    StopOrderRequest,
    StopLimitOrderRequest,
    TrailingStopOrderRequest,
)

logger = logging.getLogger(__name__)

PaperOrLive = Literal["paper", "live"]
OrderType = Literal["market", "limit", "stop", "stop_limit", "trailing_stop"]
AssetClass = Literal["us_equity"]

PAPER_BASE_URL = "https://paper-api.alpaca.markets"
LIVE_BASE_URL = "https://api.alpaca.markets"
BASE_URL_BY_MODE: dict[PaperOrLive, str] = {
    "paper": PAPER_BASE_URL,
    "live": LIVE_BASE_URL,
}

SUPPORTED_ORDER_TIFS: dict[AssetClass, dict[OrderType, set[str]]] = {
    "us_equity": {
        "market":        {"day", "gtc", "opg", "cls", "ioc", "fok"},
        "limit":         {"day", "gtc", "opg", "cls", "ioc", "fok"},
        "stop":          {"day", "gtc"},
        "stop_limit":    {"day", "gtc"},
        "trailing_stop": {"day", "gtc"},
    }
}

TIME_IN_FORCE_BY_NAME = {
    "day": TimeInForce.DAY,
    "gtc": TimeInForce.GTC,
    "opg": TimeInForce.OPG,
    "cls": TimeInForce.CLS,
    "ioc": TimeInForce.IOC,
    "fok": TimeInForce.FOK,
}


class AlpacaConfigError(ValueError):
    """Raised when paper/live credentials are paired with an invalid target."""


class AlpacaOrderValidationError(ValueError):
    """Raised when an order request is not supported for the asset class."""


class AlpacaRateLimitError(RuntimeError):
    """Raised when the per-key rate limit is exceeded."""


# ── Rate limiter (per API-key, 200 req / 60s as per Alpaca docs) ────────────
_RATE_LIMIT_WINDOW = 60.0   # seconds
_RATE_LIMIT_MAX = 200       # requests per window per key
_rate_buckets: dict[str, list[float]] = {}
_rate_lock = threading.Lock()


def _check_rate_limit(api_key: str) -> None:
    now = time.monotonic()
    with _rate_lock:
        bucket = _rate_buckets.setdefault(api_key, [])
        # prune expired timestamps
        cutoff = now - _RATE_LIMIT_WINDOW
        bucket[:] = [t for t in bucket if t > cutoff]
        if len(bucket) >= _RATE_LIMIT_MAX:
            raise AlpacaRateLimitError(
                f"Rate limit exceeded: {_RATE_LIMIT_MAX} requests per "
                f"{_RATE_LIMIT_WINDOW:.0f}s for key ...{api_key[-4:]}"
            )
        bucket.append(now)


@dataclass(frozen=True)
class AlpacaClientConfig:
    api_key: str
    secret_key: str
    mode: PaperOrLive
    base_url: str


@dataclass(frozen=True)
class AlpacaOrderRequest:
    symbol: str
    qty: float
    side: Literal["buy", "sell"]
    order_type: OrderType = "market"
    time_in_force: str = "day"
    asset_class: AssetClass = "us_equity"
    limit_price: float | None = None
    stop_price: float | None = None        # required for stop / stop_limit
    trail_percent: float | None = None     # required for trailing_stop (percent-based)
    trail_price: float | None = None       # required for trailing_stop (dollar-based)
    client_order_id: str | None = None


_VALID_INTENTS = frozenset({"open", "close", "tp", "sl", "scale"})


def build_program_client_order_id(
    program_name: str | None = None,
    deployment_id: str | None = None,
    intent: str = "open",
) -> str:
    """
    Build a traceable client_order_id that encodes program identity and order intent.

    Format: {prog_abbrev}-{deploy8}-{intent}-{rand8}
    e.g. "MACDSPY-a3f2b1c4-open-d9e7f023"

    Intent must be one of: open, close, tp, sl, scale.
    Alpaca client_order_id limit is 128 chars; this stays well under (~35 chars max).
    """
    import re
    if intent not in _VALID_INTENTS:
        intent = "open"
    parts = []
    if program_name:
        abbrev = re.sub(r"[^A-Za-z0-9]", "", program_name.upper())[:10]
        if abbrev:
            parts.append(abbrev)
    if deployment_id:
        parts.append(deployment_id[:8])
    parts.append(intent)
    parts.append(uuid.uuid4().hex[:8])
    return "-".join(parts)


def parse_order_intent(client_order_id: str | None) -> str:
    """
    Extract the intent segment from a client_order_id.

    New format (4 dash-separated parts): {prog}-{deploy8}-{intent}-{rand8}
      → returns intent at index 2 if it is a valid intent value.
    Legacy format (3 parts) or raw UUID (5 hex groups): → "unknown"
    None or unparseable: → "unknown"
    """
    if not client_order_id:
        return "unknown"
    parts = client_order_id.split("-")
    if len(parts) == 4 and parts[2] in _VALID_INTENTS:
        return parts[2]
    return "unknown"


def parse_order_deployment_id(client_order_id: str | None) -> str | None:
    """
    Extract the 8-char deployment_id prefix from a client_order_id.

    New format: index 1 is the deploy8 segment (first 8 chars of deployment_id).
    Returns None for legacy format, None input, or unrecognized format.
    Callers compare: parse_order_deployment_id(coid) == deployment_id[:8]
    """
    if not client_order_id:
        return None
    parts = client_order_id.split("-")
    if len(parts) == 4 and parts[2] in _VALID_INTENTS:
        return parts[1]
    return None


@dataclass(frozen=True)
class AlpacaClosePositionRequest:
    symbol: str
    qty: float | None = None


def build_client_config(
    api_key: str,
    secret_key: str,
    mode: PaperOrLive | str,
    base_url: str | None = None,
) -> AlpacaClientConfig:
    normalized_mode = str(mode).strip().lower()
    if normalized_mode not in BASE_URL_BY_MODE:
        raise AlpacaConfigError(f"Unsupported Alpaca mode: {mode}")

    typed_mode = normalized_mode  # satisfy mypy after membership check
    expected_base_url = BASE_URL_BY_MODE[typed_mode]
    normalized_base_url = (base_url or expected_base_url).rstrip("/")

    if normalized_base_url != expected_base_url:
        raise AlpacaConfigError(
            f"Invalid Alpaca base URL for {typed_mode}: {normalized_base_url}. "
            f"Expected {expected_base_url}."
        )
    if not api_key or not secret_key:
        raise AlpacaConfigError("Alpaca API key and secret key are required")

    return AlpacaClientConfig(
        api_key=api_key,
        secret_key=secret_key,
        mode=typed_mode,
        base_url=normalized_base_url,
    )


def _client(config: AlpacaClientConfig) -> TradingClient:
    # Rate-limit before creating the client (each client call = 1 API request)
    _check_rate_limit(config.api_key)
    # alpaca-py TradingClient routes Trading API calls through v2 internally.
    return TradingClient(
        api_key=config.api_key,
        secret_key=config.secret_key,
        paper=config.mode == "paper",
        url_override=config.base_url,
    )


def _validate_order_request(order: AlpacaOrderRequest) -> None:
    asset_rules = SUPPORTED_ORDER_TIFS.get(order.asset_class)
    if asset_rules is None:
        raise AlpacaOrderValidationError(f"Unsupported Alpaca asset class: {order.asset_class}")

    if order.order_type not in asset_rules:
        raise AlpacaOrderValidationError(
            f"Unsupported Alpaca order type for {order.asset_class}: {order.order_type}"
        )

    tif_name = order.time_in_force.strip().lower()
    if tif_name not in asset_rules[order.order_type]:
        raise AlpacaOrderValidationError(
            f"time_in_force={order.time_in_force} is not supported for "
            f"{order.asset_class} {order.order_type} orders"
        )

    if tif_name not in TIME_IN_FORCE_BY_NAME:
        raise AlpacaOrderValidationError(f"Unsupported time_in_force: {order.time_in_force}")

    if order.side not in {"buy", "sell"}:
        raise AlpacaOrderValidationError(f"Unsupported order side: {order.side}")

    if order.qty <= 0:
        raise AlpacaOrderValidationError("Order quantity must be greater than zero")

    if order.order_type == "limit" and order.limit_price is None:
        raise AlpacaOrderValidationError("limit_price is required for limit orders")

    if order.order_type == "market" and order.limit_price is not None:
        raise AlpacaOrderValidationError("limit_price is only valid for limit/stop_limit orders")

    if order.order_type == "stop" and order.stop_price is None:
        raise AlpacaOrderValidationError("stop_price is required for stop orders")

    if order.order_type == "stop_limit" and order.stop_price is None:
        raise AlpacaOrderValidationError("stop_price is required for stop_limit orders")

    if order.order_type == "stop_limit" and order.limit_price is None:
        raise AlpacaOrderValidationError("limit_price is required for stop_limit orders")

    if order.order_type == "trailing_stop" and order.trail_percent is None and order.trail_price is None:
        raise AlpacaOrderValidationError("trailing_stop requires either trail_percent or trail_price")

    if order.order_type == "trailing_stop" and order.trail_percent is not None and order.trail_price is not None:
        raise AlpacaOrderValidationError("trailing_stop cannot have both trail_percent and trail_price")


def _build_order_request(
    order: AlpacaOrderRequest,
) -> MarketOrderRequest | LimitOrderRequest | StopOrderRequest | StopLimitOrderRequest | TrailingStopOrderRequest:
    _validate_order_request(order)

    common = {
        "symbol": (order.symbol or "").upper(),
        "qty": order.qty,
        "side": OrderSide.BUY if order.side == "buy" else OrderSide.SELL,
        "time_in_force": TIME_IN_FORCE_BY_NAME[order.time_in_force.strip().lower()],
        "client_order_id": order.client_order_id,
    }

    if order.order_type == "market":
        return MarketOrderRequest(**common)

    if order.order_type == "limit":
        return LimitOrderRequest(limit_price=order.limit_price, **common)

    if order.order_type == "stop":
        return StopOrderRequest(stop_price=order.stop_price, **common)

    if order.order_type == "stop_limit":
        return StopLimitOrderRequest(
            stop_price=order.stop_price,
            limit_price=order.limit_price,
            **common,
        )

    # trailing_stop — uses trail_percent OR trail_price (mutually exclusive)
    if order.trail_percent is not None:
        return TrailingStopOrderRequest(trail_percent=order.trail_percent, **common)
    return TrailingStopOrderRequest(trail_price=order.trail_price, **common)


def validate_credentials(config: AlpacaClientConfig) -> dict[str, Any]:
    """Validate credentials against Alpaca Trading API v2 by fetching the account."""
    try:
        client = _client(config)
        account = client.get_account()
        return {
            "valid": True,
            "account_id": str(account.id),
            "cash": float(account.cash),
            "portfolio_value": float(account.portfolio_value),
            "equity": float(account.equity),
            "buying_power": float(account.buying_power),
            "multiplier": int(getattr(account, "multiplier", 1) or 1),
            "status": str(account.status).split(".")[-1],
            "mode": config.mode,
            "base_url": config.base_url,
        }
    except (APIError, AlpacaConfigError) as exc:
        logger.warning("Alpaca credential validation failed: %s", exc)
        return {"valid": False, "error": str(exc)}
    except Exception as exc:
        logger.error("Unexpected error validating Alpaca credentials: %s", exc)
        return {"valid": False, "error": "Unexpected error"}


def get_account(config: AlpacaClientConfig) -> dict[str, Any]:
    """Fetch the current Alpaca account snapshot."""
    try:
        account = _client(config).get_account()
        return {
            "id": str(account.id),
            "cash": float(account.cash),
            "portfolio_value": float(account.portfolio_value),
            "buying_power": float(account.buying_power),
            "equity": float(account.equity),
            "last_equity": float(account.last_equity),
            "day_trade_count": getattr(account, "daytrade_count", 0),
            "pattern_day_trader": getattr(account, "pattern_day_trader", False),
            "status": str(account.status).split(".")[-1],
            "mode": config.mode,
            "base_url": config.base_url,
        }
    except APIError as exc:
        logger.warning("Failed to get Alpaca account snapshot: %s", exc)
        return {"error": str(exc)}
    except Exception as exc:
        logger.error("Unexpected error getting Alpaca account snapshot: %s", exc)
        return {"error": "Unexpected error"}


def get_positions(config: AlpacaClientConfig) -> list[dict[str, Any]]:
    """Fetch all open positions from Trading API v2."""
    try:
        positions = _client(config).get_all_positions()
        return [_fmt_position(position) for position in positions]
    except APIError as exc:
        logger.warning("Failed to get Alpaca positions: %s", exc)
        return []
    except Exception as exc:
        logger.error("Unexpected error getting Alpaca positions: %s", exc)
        return []


def get_account_status(config: AlpacaClientConfig) -> dict[str, Any]:
    """Fetch current account snapshot and open positions."""
    account = get_account(config)
    if account.get("error"):
        return {"error": account["error"]}
    return {"account": account, "positions": get_positions(config)}


def get_orders(config: AlpacaClientConfig, status_filter: str = "open") -> list[dict[str, Any]]:
    """Fetch orders from Trading API v2 filtered by status."""
    status_map = {
        "open": QueryOrderStatus.OPEN,
        "closed": QueryOrderStatus.CLOSED,
        "all": QueryOrderStatus.ALL,
    }
    try:
        req = GetOrdersRequest(status=status_map.get(status_filter, QueryOrderStatus.OPEN))
        orders = _client(config).get_orders(req)
        return [_fmt_order(order) for order in orders]
    except APIError as exc:
        logger.warning("Failed to get Alpaca orders: %s", exc)
        return []
    except Exception as exc:
        logger.error("Unexpected error getting Alpaca orders: %s", exc)
        return []


def place_order(config: AlpacaClientConfig, order: AlpacaOrderRequest) -> dict[str, Any]:
    """Submit a validated order to Alpaca Trading API v2.

    Pre-flight checks:
    - Auto-generate client_order_id for idempotency (ALP-020)
    - Verify account status is ACTIVE (ALP-022)
    - PDT guard: block day trades when daytrade_count >= 3 and equity < $25k (ALP-024)
    - Buying power check: reject orders that would exceed available buying power (ALP-019)
    """
    try:
        # Auto-generate client_order_id when not provided (ALP-020)
        # Uses build_program_client_order_id() when called from governor/broker with program context.
        if order.client_order_id is None:
            order = AlpacaOrderRequest(
                symbol=order.symbol,
                qty=order.qty,
                side=order.side,
                order_type=order.order_type,
                time_in_force=order.time_in_force,
                asset_class=order.asset_class,
                limit_price=order.limit_price,
                stop_price=order.stop_price,
                trail_percent=order.trail_percent,
                trail_price=order.trail_price,
                client_order_id=str(uuid.uuid4()),
            )

        # Pre-flight: account status + buying power + PDT checks
        account_info = get_account(config)
        if account_info.get("error"):
            return {"error": f"Pre-trade account check failed: {account_info['error']}"}

        # ALP-022: Block orders on non-ACTIVE accounts
        acct_status = str(account_info.get("status", "")).upper()
        if acct_status != "ACTIVE":
            return {"error": f"Account is {acct_status} — cannot place orders"}

        # ALP-024: PDT guard for non-PDT accounts
        day_trade_count = int(account_info.get("day_trade_count", 0))
        equity = float(account_info.get("equity", 0))
        is_pdt = bool(account_info.get("pattern_day_trader", False))
        if (
            not is_pdt
            and day_trade_count >= 3
            and equity < 25_000
            and order.time_in_force.lower() == "day"
        ):
            return {
                "error": (
                    f"PDT protection: {day_trade_count} day trades used with "
                    f"${equity:,.2f} equity (< $25,000 minimum). "
                    "Order blocked to avoid pattern day trader restriction."
                )
            }

        # ALP-019: Buying power pre-check for market orders
        buying_power = float(account_info.get("buying_power", 0))
        if order.order_type == "market" and order.side == "buy":
            # Rough estimate — actual fill price may differ
            estimated_cost = order.qty * (order.limit_price or 0)
            # For market orders limit_price is None; skip exact check but still
            # ensure buying power is not $0
            if buying_power <= 0:
                return {"error": "Insufficient buying power ($0.00 available)"}
        elif order.order_type == "limit" and order.side == "buy" and order.limit_price:
            estimated_cost = order.qty * order.limit_price
            if estimated_cost > buying_power:
                return {
                    "error": (
                        f"Insufficient buying power: order cost ~${estimated_cost:,.2f} "
                        f"exceeds available ${buying_power:,.2f}"
                    )
                }

        req = _build_order_request(order)
        submitted = _client(config).submit_order(req)
        return _fmt_order(submitted)
    except (APIError, AlpacaOrderValidationError, AlpacaConfigError) as exc:
        logger.error("Failed to place Alpaca order for %s: %s", order.symbol, exc)
        return {"error": str(exc)}
    except AlpacaRateLimitError as exc:
        logger.warning("Alpaca rate limit hit: %s", exc)
        return {"error": str(exc)}
    except Exception as exc:
        logger.error("Unexpected error placing Alpaca order: %s", exc)
        return {"error": "Unexpected error"}


def place_market_order(
    config: AlpacaClientConfig,
    symbol: str,
    qty: float,
    side: str,
    time_in_force: str = "day",
    asset_class: AssetClass = "us_equity",
    client_order_id: str | None = None,
    program_name: str | None = None,
    deployment_id: str | None = None,
    intent: str = "open",
) -> dict[str, Any]:
    oid = client_order_id or build_program_client_order_id(program_name, deployment_id, intent)
    return place_order(
        config,
        AlpacaOrderRequest(
            symbol=symbol,
            qty=qty,
            side=side,  # type: ignore[arg-type]
            order_type="market",
            time_in_force=time_in_force,
            asset_class=asset_class,
            client_order_id=oid,
        ),
    )


def place_limit_order(
    config: AlpacaClientConfig,
    symbol: str,
    qty: float,
    side: str,
    limit_price: float,
    time_in_force: str = "day",
    asset_class: AssetClass = "us_equity",
    client_order_id: str | None = None,
    program_name: str | None = None,
    deployment_id: str | None = None,
    intent: str = "open",
) -> dict[str, Any]:
    oid = client_order_id or build_program_client_order_id(program_name, deployment_id, intent)
    return place_order(
        config,
        AlpacaOrderRequest(
            symbol=symbol,
            qty=qty,
            side=side,  # type: ignore[arg-type]
            order_type="limit",
            limit_price=limit_price,
            time_in_force=time_in_force,
            asset_class=asset_class,
            client_order_id=oid,
        ),
    )


def place_stop_order(
    config: AlpacaClientConfig,
    symbol: str,
    qty: float,
    side: str,
    stop_price: float,
    time_in_force: str = "day",
    asset_class: AssetClass = "us_equity",
    client_order_id: str | None = None,
    program_name: str | None = None,
    deployment_id: str | None = None,
    intent: str = "open",
) -> dict[str, Any]:
    oid = client_order_id or build_program_client_order_id(program_name, deployment_id, intent)
    return place_order(
        config,
        AlpacaOrderRequest(
            symbol=symbol,
            qty=qty,
            side=side,  # type: ignore[arg-type]
            order_type="stop",
            stop_price=stop_price,
            time_in_force=time_in_force,
            asset_class=asset_class,
            client_order_id=oid,
        ),
    )


def place_stop_limit_order(
    config: AlpacaClientConfig,
    symbol: str,
    qty: float,
    side: str,
    stop_price: float,
    limit_price: float,
    time_in_force: str = "day",
    asset_class: AssetClass = "us_equity",
    client_order_id: str | None = None,
    program_name: str | None = None,
    deployment_id: str | None = None,
    intent: str = "open",
) -> dict[str, Any]:
    oid = client_order_id or build_program_client_order_id(program_name, deployment_id, intent)
    return place_order(
        config,
        AlpacaOrderRequest(
            symbol=symbol,
            qty=qty,
            side=side,  # type: ignore[arg-type]
            order_type="stop_limit",
            stop_price=stop_price,
            limit_price=limit_price,
            time_in_force=time_in_force,
            asset_class=asset_class,
            client_order_id=oid,
        ),
    )


def place_trailing_stop_order(
    config: AlpacaClientConfig,
    symbol: str,
    qty: float,
    side: str,
    *,
    trail_percent: float | None = None,
    trail_price: float | None = None,
    time_in_force: str = "day",
    asset_class: AssetClass = "us_equity",
    client_order_id: str | None = None,
    program_name: str | None = None,
    deployment_id: str | None = None,
    intent: str = "sl",
) -> dict[str, Any]:
    """Submit a trailing stop order to Alpaca.

    Exactly one of trail_percent (e.g. 2.0 for 2%) or trail_price (dollar amount)
    must be provided. This is a standalone exit order — place after entry fills.
    """
    oid = client_order_id or build_program_client_order_id(program_name, deployment_id, intent)
    return place_order(
        config,
        AlpacaOrderRequest(
            symbol=symbol,
            qty=qty,
            side=side,  # type: ignore[arg-type]
            order_type="trailing_stop",
            trail_percent=trail_percent,
            trail_price=trail_price,
            time_in_force=time_in_force,
            asset_class=asset_class,
            client_order_id=oid,
        ),
    )


def cancel_order(config: AlpacaClientConfig, order_id: str) -> dict[str, Any]:
    """Cancel a Trading API v2 order by ID."""
    try:
        _client(config).cancel_order_by_id(order_id)
        return {"cancelled": True, "order_id": order_id}
    except APIError as exc:
        return {"cancelled": False, "error": str(exc)}
    except Exception:
        return {"cancelled": False, "error": "Unexpected error"}


def cancel_all_orders(config: AlpacaClientConfig) -> dict[str, Any]:
    """Cancel all open Trading API v2 orders."""
    try:
        _client(config).cancel_orders()
        return {"cancelled": True}
    except APIError as exc:
        return {"cancelled": False, "error": str(exc)}
    except Exception:
        return {"cancelled": False, "error": "Unexpected error"}


def close_position(config: AlpacaClientConfig, close_request: AlpacaClosePositionRequest) -> dict[str, Any]:
    """Close one Trading API v2 position fully or partially."""
    try:
        client = _client(config)
        if close_request.qty is not None:
            result = client.close_position(close_request.symbol, qty=close_request.qty)
        else:
            result = client.close_position(close_request.symbol)
        return _fmt_order(result)
    except APIError as exc:
        return {"error": str(exc)}
    except Exception:
        return {"error": "Unexpected error"}


def close_all_positions(config: AlpacaClientConfig) -> list[dict[str, Any]]:
    """Close all Trading API v2 positions."""
    try:
        results = _client(config).close_all_positions(cancel_orders=True)
        return [_fmt_order(result) for result in (results or [])]
    except APIError as exc:
        return [{"error": str(exc)}]
    except Exception:
        return [{"error": "Unexpected error"}]


def get_asset_info(config: AlpacaClientConfig, symbol: str) -> dict[str, Any]:
    """
    Fetch Alpaca asset metadata for a symbol.

    Returns fractionable, shortable, easy_to_borrow, marginable flags.
    Used at universe resolution time to pre-check shortability / fractionability.
    """
    try:
        client = _client(config)
        asset = client.get_asset(symbol.upper())
        return {
            "symbol": str(asset.symbol),
            "name": str(getattr(asset, "name", "") or ""),
            "exchange": str(getattr(asset, "exchange", "") or "").split(".")[-1],
            "status": str(getattr(asset, "status", "") or "").split(".")[-1],
            "tradable": bool(getattr(asset, "tradable", False)),
            "fractionable": bool(getattr(asset, "fractionable", False)),
            "shortable": bool(getattr(asset, "shortable", False)),
            "easy_to_borrow": bool(getattr(asset, "easy_to_borrow", False)),
            "marginable": bool(getattr(asset, "marginable", False)),
        }
    except APIError as exc:
        logger.warning("Failed to get Alpaca asset info for %s: %s", symbol, exc)
        return {"error": str(exc), "symbol": symbol.upper()}
    except Exception as exc:
        logger.error("Unexpected error getting Alpaca asset info for %s: %s", symbol, exc)
        return {"error": "Unexpected error", "symbol": symbol.upper()}


def check_symbols_eligibility(
    config: AlpacaClientConfig,
    symbols: list[str],
    *,
    require_shortable: bool = False,
    require_fractionable: bool = False,
) -> dict[str, Any]:
    """
    Bulk-check symbol eligibility: shortability and fractionability.

    Called at universe resolution time before adding symbols to a SymbolUniverse.

    Returns:
        eligible : list[str]
        ineligible : list[dict] — symbol + reason
        asset_info : dict[symbol, asset_flags]
    """
    eligible: list[str] = []
    ineligible: list[dict[str, Any]] = []
    asset_info: dict[str, Any] = {}

    for symbol in symbols:
        info = get_asset_info(config, symbol)
        sym = symbol.upper()
        asset_info[sym] = info

        if info.get("error"):
            ineligible.append({"symbol": sym, "reason": f"asset lookup failed: {info['error']}"})
            continue

        if not info.get("tradable"):
            ineligible.append({"symbol": sym, "reason": "not tradable on Alpaca"})
            continue

        if require_shortable and not info.get("shortable"):
            ineligible.append({"symbol": sym, "reason": "not shortable"})
            continue

        if require_fractionable and not info.get("fractionable"):
            ineligible.append({"symbol": sym, "reason": "not fractionable"})
            continue

        eligible.append(sym)

    return {
        "eligible": eligible,
        "ineligible": ineligible,
        "asset_info": asset_info,
        "eligible_count": len(eligible),
        "ineligible_count": len(ineligible),
    }


def place_bracket_order(
    config: AlpacaClientConfig,
    symbol: str,
    qty: float,
    side: str,
    *,
    stop_price: float | None = None,
    stop_limit_price: float | None = None,
    take_profit_price: float | None = None,
    entry_limit_price: float | None = None,
    time_in_force: str = "day",
    client_order_id: str | None = None,
) -> dict[str, Any]:
    """Submit a bracket order (order_class=bracket) to Alpaca.

    Supports market or limit entry (entry_limit_price sets limit entry).
    Stop leg: market stop by default; set stop_limit_price for a stop-limit stop leg.
    At least one of stop_price or take_profit_price must be provided.
    """
    if not stop_price and not take_profit_price:
        return {"error": "bracket_order requires at least one of stop_price or take_profit_price"}

    try:
        _check_rate_limit(config.api_key)
        client = TradingClient(
            api_key=config.api_key,
            secret_key=config.secret_key,
            paper=config.mode == "paper",
            url_override=config.base_url,
        )

        order_side = OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL
        tif = TIME_IN_FORCE_BY_NAME.get(time_in_force.lower(), TimeInForce.DAY)
        coid = client_order_id or str(uuid.uuid4())

        order_data: dict[str, Any] = {
            "symbol": symbol.upper(),
            "qty": qty,
            "side": order_side,
            "time_in_force": tif,
            "order_class": "bracket",
            "client_order_id": coid,
        }
        if take_profit_price:
            order_data["take_profit"] = {"limit_price": take_profit_price}
        if stop_price:
            stop_leg: dict[str, float] = {"stop_price": stop_price}
            if stop_limit_price is not None:
                stop_leg["limit_price"] = stop_limit_price
            order_data["stop_loss"] = stop_leg

        # Use LimitOrderRequest when a limit entry price is provided, otherwise market.
        if entry_limit_price is not None:
            req = LimitOrderRequest(limit_price=entry_limit_price, **{k: v for k, v in order_data.items() if v is not None})
        else:
            req = MarketOrderRequest(**{k: v for k, v in order_data.items() if v is not None})

        submitted = client.submit_order(req)
        result = _fmt_order(submitted)
        result["order_class"] = "bracket"
        result["stop_price"] = stop_price
        result["take_profit_price"] = take_profit_price
        return result
    except APIError as exc:
        logger.error("Failed to place Alpaca bracket order for %s: %s", symbol, exc)
        return {"error": str(exc)}
    except AlpacaRateLimitError as exc:
        logger.warning("Alpaca rate limit hit: %s", exc)
        return {"error": str(exc)}
    except Exception as exc:
        logger.error("Unexpected error placing bracket order for %s: %s", symbol, exc)
        return {"error": "Unexpected error"}


def replace_order(
    config: AlpacaClientConfig,
    order_id: str,
    *,
    qty: float | None = None,
    stop_price: float | None = None,
    limit_price: float | None = None,
) -> dict[str, Any]:
    """Modify an existing order's qty and/or price via Alpaca's replace endpoint.

    Used for stop leg resizing after a scale-out level fills — avoids cancel+resubmit.
    At least one of qty, stop_price, or limit_price must be provided.
    """
    if qty is None and stop_price is None and limit_price is None:
        return {"error": "replace_order requires at least one of qty, stop_price, or limit_price"}
    try:
        _check_rate_limit(config.api_key)
        client = TradingClient(
            api_key=config.api_key,
            secret_key=config.secret_key,
            paper=config.mode == "paper",
            url_override=config.base_url,
        )
        req = ReplaceOrderRequest(
            qty=qty,
            stop_price=stop_price,
            limit_price=limit_price,
        )
        replaced = client.replace_order_by_id(order_id, req)
        return _fmt_order(replaced)
    except APIError as exc:
        logger.error("Failed to replace Alpaca order %s: %s", order_id, exc)
        return {"error": str(exc)}
    except AlpacaRateLimitError as exc:
        logger.warning("Alpaca rate limit hit: %s", exc)
        return {"error": str(exc)}
    except Exception as exc:
        logger.error("Unexpected error replacing order %s: %s", order_id, exc)
        return {"error": "Unexpected error"}


def place_oco_order(
    config: AlpacaClientConfig,
    symbol: str,
    qty: float,
    side: str,
    *,
    stop_price: float,
    take_profit_price: float,
    time_in_force: str = "gtc",
    client_order_id: str | None = None,
    program_name: str | None = None,
    deployment_id: str | None = None,
) -> dict[str, Any]:
    """Place an OCO (One-Cancels-Other) exit order after an entry fills.

    OCO = two resting exit orders (stop loss + take profit) where filling one
    cancels the other. Placed post-fill, not bundled with entry (unlike bracket).
    Used for scale-out: each scale level gets its own OCO for remaining qty.

    Returns the order dict; the stop leg ID is accessible via result['legs'].
    """
    try:
        _check_rate_limit(config.api_key)
        client = TradingClient(
            api_key=config.api_key,
            secret_key=config.secret_key,
            paper=config.mode == "paper",
            url_override=config.base_url,
        )
        coid = client_order_id or build_program_client_order_id(program_name, deployment_id, "sl")
        order_side = OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL
        tif = TIME_IN_FORCE_BY_NAME.get(time_in_force.lower(), TimeInForce.GTC)

        # OCO: parent is limit order (TP leg) + stop_loss dict (stop leg)
        req = LimitOrderRequest(
            symbol=symbol.upper(),
            qty=qty,
            side=order_side,
            time_in_force=tif,
            limit_price=take_profit_price,
            order_class=OrderClass.OCO,
            stop_loss={"stop_price": stop_price},
            client_order_id=coid,
        )
        submitted = client.submit_order(req)
        result = _fmt_order(submitted)
        result["order_class"] = "oco"
        result["stop_price"] = stop_price
        result["take_profit_price"] = take_profit_price
        # Include legs so callers can extract the stop leg order ID
        if hasattr(submitted, "legs") and submitted.legs:
            result["legs"] = [_fmt_order(leg) for leg in submitted.legs]
        return result
    except APIError as exc:
        logger.error("Failed to place Alpaca OCO order for %s: %s", symbol, exc)
        return {"error": str(exc)}
    except AlpacaRateLimitError as exc:
        logger.warning("Alpaca rate limit hit: %s", exc)
        return {"error": str(exc)}
    except Exception as exc:
        logger.error("Unexpected error placing OCO order for %s: %s", symbol, exc)
        return {"error": "Unexpected error"}


def get_latest_prices(symbols: list[str], api_key: str, secret_key: str) -> dict[str, float]:
    """Return the latest trade price for each symbol via Alpaca market data API.

    Uses StockHistoricalDataClient (data feed, not trading) so paper accounts
    without a funded live key still get real-time prices via the free data tier.
    Returns a dict of {symbol: price}. Missing symbols are omitted.
    """
    from alpaca.data.historical import StockHistoricalDataClient
    from alpaca.data.requests import StockLatestTradeRequest

    if not symbols or not api_key or not secret_key:
        return {}

    try:
        client = StockHistoricalDataClient(api_key=api_key, secret_key=secret_key)
        req = StockLatestTradeRequest(symbol_or_symbols=symbols)
        trades = client.get_stock_latest_trade(req)
        return {sym: float(trade.price) for sym, trade in trades.items() if trade and trade.price}
    except Exception as exc:
        logger.warning("get_latest_prices failed for %s: %s", symbols, exc)
        return {}


# ---- Helper factories to centralize alpaca-py SDK imports for data providers ----
_DATA_TIMEFRAME_MAP: dict[str, tuple[int, str]] = {
    "1m":  (1,  "Minute"),
    "5m":  (5,  "Minute"),
    "15m": (15, "Minute"),
    "30m": (30, "Minute"),
    "1h":  (1,  "Hour"),
    "4h":  (4,  "Hour"),
    "1d":  (1,  "Day"),
    "1wk": (1,  "Week"),
    "1mo": (1,  "Month"),
}


def build_stock_historical_client(api_key: str, secret_key: str):
    try:
        from alpaca.data import StockHistoricalDataClient
    except ImportError as e:
        raise RuntimeError("alpaca-py not installed. Run: pip install alpaca-py") from e
    return StockHistoricalDataClient(api_key=api_key, secret_key=secret_key)


def build_timeframe(tf_key: str):
    try:
        from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
    except ImportError as e:
        raise RuntimeError("alpaca-py not installed. Run: pip install alpaca-py") from e
    if tf_key not in _DATA_TIMEFRAME_MAP:
        raise ValueError(f"Unsupported timeframe: {tf_key}")
    mult, unit_str = _DATA_TIMEFRAME_MAP[tf_key]
    unit_map = {
        "Minute": TimeFrameUnit.Minute,
        "Hour":   TimeFrameUnit.Hour,
        "Day":    TimeFrameUnit.Day,
        "Week":   TimeFrameUnit.Week,
        "Month":  TimeFrameUnit.Month,
    }
    return TimeFrame(mult, unit_map[unit_str])


def build_stock_bars_request(symbol: str, timeframe_obj, start, end, adjustment: str = "all"):
    try:
        from alpaca.data.requests import StockBarsRequest
    except ImportError as e:
        raise RuntimeError("alpaca-py not installed. Run: pip install alpaca-py") from e
    return StockBarsRequest(symbol_or_symbols=symbol, timeframe=timeframe_obj, start=start, end=end, adjustment=adjustment)


def build_trading_client(api_key: str, secret_key: str, paper: bool = True, base_url: str | None = None):
    try:
        from alpaca.trading.client import TradingClient
    except ImportError as e:
        raise RuntimeError("alpaca-py not installed. Run: pip install alpaca-py") from e
    return TradingClient(api_key=api_key, secret_key=secret_key, paper=paper, url_override=base_url)


def search_assets(api_key: str, secret_key: str, query: str, max_results: int = 20) -> list[dict]:
    """Search Alpaca assets (US equities only) and return a minimal list of dicts.

    This centralises Alpaca SDK usage for symbol lookup.
    """
    try:
        client = build_trading_client(api_key, secret_key, paper=True)
        from alpaca.trading.requests import GetAssetsRequest
        from alpaca.trading.enums import AssetClass, AssetStatus

        request = GetAssetsRequest(asset_class=AssetClass.US_EQUITY, status=AssetStatus.ACTIVE)
        assets = client.get_all_assets(request)
        results = []
        q = (query or "").upper()
        for a in assets:
            if q and q not in a.symbol and (not a.name or q not in a.name.upper()):
                continue
            results.append({
                "symbol": a.symbol,
                "name": a.name or "",
                "exchange": a.exchange.value if hasattr(a.exchange, "value") else str(a.exchange),
                "tradable": bool(getattr(a, "tradable", False)),
            })
            if len(results) >= max_results:
                break
        return results
    except Exception as exc:
        logger.warning("search_assets failed: %s", exc)
        return []


async def create_account_stream_runner(
    callback: Callable[[dict], Awaitable[None]],
    api_key: str,
    secret_key: str,
    paper: bool,
    *,
    stream_factory: Callable[[str, str, bool], object] | None = None,
) -> None:
    """
    Create and run an Alpaca TradingStream and route `trade_updates` events
    to the provided async `callback`.

    - `callback` is an awaitable callable accepting a single `dict` (raw event).
    - `stream_factory` is optional and used for testing to supply a fake stream
      object with `subscribe_trade_updates(cb)` and `run()` methods.

    This runs `stream.run()` in a thread executor so the main event loop is not
    blocked. Events produced by the stream are scheduled back onto the event
    loop using `asyncio.run_coroutine_threadsafe`.
    """
    if stream_factory is None:
        from alpaca.trading.stream import TradingStream as _TradingStream

        def _factory(a: str, s: str, p: bool) -> object:
            return _TradingStream(api_key=a, secret_key=s, paper=p, raw_data=True)
    else:
        _factory = stream_factory

    loop = asyncio.get_running_loop()
    stream = _factory(api_key, secret_key, paper)

    def _sync_handler(data: dict) -> None:
        try:
            asyncio.run_coroutine_threadsafe(callback(data), loop)
        except Exception as exc:  # schedule errors must not crash the stream thread
            logger.warning("create_account_stream_runner: error scheduling callback: %s", exc)

    # Subscribe and run the (blocking) stream in an executor
    try:
        subscribe = getattr(stream, "subscribe_trade_updates", None)
        if not subscribe:
            raise AttributeError("stream object does not support subscribe_trade_updates()")
        subscribe(_sync_handler)
        logger.info("create_account_stream_runner: starting Alpaca TradingStream (paper=%s)", paper)
        await loop.run_in_executor(None, stream.run)
    finally:
        stop = getattr(stream, "stop", None)
        if stop:
            try:
                stop()
            except Exception:
                pass


@dataclass
class OrderAuditEntry:
    order_id: str
    client_order_id: str | None
    symbol: str
    side: str
    qty: float
    intent: str
    reason: str
    deployment_id: str | None


@dataclass
class CancellationResult:
    scope: str
    canceled: list[OrderAuditEntry] = field(default_factory=list)
    skipped_protective: list[OrderAuditEntry] = field(default_factory=list)
    skipped_has_position: list[OrderAuditEntry] = field(default_factory=list)
    skipped_unknown: list[OrderAuditEntry] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    dry_run: bool = False


def cancel_resting_open_orders_without_positions(
    config: AlpacaClientConfig,
    scope: str,
    deployment_id: str | None = None,
    dry_run: bool = False,
) -> CancellationResult:
    """
    Cancel only resting orders that are opening new exposure and have no backing position.

    Uses QueryOrderStatus.OPEN — bracket legs (status="held") are not returned
    by Alpaca for this query and cannot be canceled by this function. This is intentional:
    sl/tp legs are contingent and stay alive automatically.

    Steps:
    1. Fetch open orders via get_orders(config, "open")
    2. Fetch open positions via get_positions(config)
    3. For each open order:
       a. Parse intent from client_order_id
       b. scope="deployment": skip orders not belonging to target deployment
       c. intent != "open": skip as protective/reducing
       d. intent == "open" + position exists in symbol: skip (conservative)
       e. intent == "open" + no position: cancel via cancel_order(config, order["id"])
       f. intent == "unknown": skip and flag
    4. Return CancellationResult with all four buckets populated
    """
    result = CancellationResult(scope=scope, dry_run=dry_run)

    orders = get_orders(config, "open")
    positions = get_positions(config)
    open_symbols: set[str] = {p["symbol"].upper() for p in positions}

    for order in orders:
        coid = order.get("client_order_id")
        symbol = (order.get("symbol") or "").upper()
        order_id = order.get("id", "")
        side = order.get("side", "")
        qty = float(order.get("qty") or 0.0)
        intent = parse_order_intent(coid)
        order_deploy8 = parse_order_deployment_id(coid)

        entry = OrderAuditEntry(
            order_id=order_id,
            client_order_id=coid,
            symbol=symbol,
            side=side,
            qty=qty,
            intent=intent,
            reason="",
            deployment_id=order_deploy8,
        )

        # Scope filter for deployment-level cancellation
        if scope == "deployment":
            if deployment_id is None:
                entry.reason = "no deployment_id provided for deployment scope"
                result.skipped_unknown.append(entry)
                continue
            if order_deploy8 != deployment_id[:8]:
                # Not this deployment — skip entirely, don't log
                continue

        if intent == "unknown":
            entry.reason = "unattributed client_order_id — kept conservatively"
            result.skipped_unknown.append(entry)
            logger.info(
                "cancel_sweep: skipped_unknown order_id=%s symbol=%s coid=%s",
                order_id, symbol, coid,
            )
            continue

        if intent != "open":
            entry.reason = f"protective/reducing intent={intent} — kept"
            result.skipped_protective.append(entry)
            logger.info(
                "cancel_sweep: skipped_protective order_id=%s symbol=%s intent=%s",
                order_id, symbol, intent,
            )
            continue

        # intent == "open" from here
        if symbol in open_symbols:
            entry.reason = "open-intent but position exists in symbol — kept conservatively"
            result.skipped_has_position.append(entry)
            logger.info(
                "cancel_sweep: skipped_has_position order_id=%s symbol=%s",
                order_id, symbol,
            )
            continue

        # Safe to cancel
        entry.reason = "resting entry with no backing position"
        if dry_run:
            result.canceled.append(entry)
            logger.info(
                "cancel_sweep: DRY_RUN would cancel order_id=%s symbol=%s intent=%s",
                order_id, symbol, intent,
            )
        else:
            cancel_result = cancel_order(config, order_id)
            if cancel_result.get("cancelled"):
                result.canceled.append(entry)
                logger.info(
                    "cancel_sweep: canceled order_id=%s symbol=%s intent=%s scope=%s",
                    order_id, symbol, intent, scope,
                )
            else:
                err = cancel_result.get("error", "unknown error")
                result.errors.append(f"cancel failed for order_id={order_id} symbol={symbol}: {err}")
                logger.warning(
                    "cancel_sweep: cancel_failed order_id=%s symbol=%s error=%s",
                    order_id, symbol, err,
                )

    return result


def _fmt_position(position: Any) -> dict[str, Any]:
    def _float_or_none(value: Any) -> float | None:
        return float(value) if value is not None else None

    def _fmt_enum(value: Any) -> str:
        s = str(value)
        return s.split(".")[-1].lower() if "." in s else s.lower()

    return {
        "symbol": str(position.symbol).upper(),
        "qty": _float_or_none(position.qty),
        "side": _fmt_enum(position.side),
        "avg_entry_price": _float_or_none(position.avg_entry_price),
        "current_price": _float_or_none(position.current_price),
        "market_value": _float_or_none(position.market_value),
        "cost_basis": _float_or_none(position.cost_basis),
        "unrealized_pl": _float_or_none(position.unrealized_pl),
        "unrealized_plpc": _float_or_none(position.unrealized_plpc),
        "unrealized_intraday_pl": _float_or_none(position.unrealized_intraday_pl),
        "change_today": _float_or_none(position.change_today),
    }


def _fmt_order(order: Any) -> dict[str, Any]:
    def _float_or_none(value: Any) -> float | None:
        return float(value) if value is not None else None

    def _fmt_enum(value: Any) -> str:
        s = str(value)
        return s.split(".")[-1].lower() if "." in s else s.lower()

    return {
        "id": str(order.id),
        "client_order_id": str(order.client_order_id) if order.client_order_id else None,
        "symbol": str(order.symbol).upper(),
        "qty": _float_or_none(order.qty),
        "filled_qty": _float_or_none(order.filled_qty) or 0.0,
        "side": _fmt_enum(order.side),
        "type": _fmt_enum(order.type),
        "time_in_force": _fmt_enum(order.time_in_force),
        "limit_price": _float_or_none(order.limit_price),
        "stop_price": _float_or_none(order.stop_price),
        "filled_avg_price": _float_or_none(order.filled_avg_price),
        "status": _fmt_enum(order.status),
        "created_at": str(order.created_at) if order.created_at else None,
        "filled_at": str(order.filled_at) if order.filled_at else None,
    }
