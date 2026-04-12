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
from dataclasses import dataclass
from typing import Any, Literal

from alpaca.common.exceptions import APIError
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, QueryOrderStatus, TimeInForce
from alpaca.trading.requests import GetOrdersRequest, LimitOrderRequest, MarketOrderRequest

logger = logging.getLogger(__name__)

PaperOrLive = Literal["paper", "live"]
OrderType = Literal["market", "limit"]
AssetClass = Literal["us_equity"]

PAPER_BASE_URL = "https://paper-api.alpaca.markets"
LIVE_BASE_URL = "https://api.alpaca.markets"
BASE_URL_BY_MODE: dict[PaperOrLive, str] = {
    "paper": PAPER_BASE_URL,
    "live": LIVE_BASE_URL,
}

SUPPORTED_ORDER_TIFS: dict[AssetClass, dict[OrderType, set[str]]] = {
    "us_equity": {
        "market": {"day", "gtc", "opg", "cls", "ioc", "fok"},
        "limit": {"day", "gtc", "opg", "cls", "ioc", "fok"},
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
    client_order_id: str | None = None


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
        raise AlpacaOrderValidationError("limit_price is only valid for limit orders")


def _build_order_request(order: AlpacaOrderRequest) -> MarketOrderRequest | LimitOrderRequest:
    _validate_order_request(order)

    common = {
        "symbol": order.symbol,
        "qty": order.qty,
        "side": OrderSide.BUY if order.side == "buy" else OrderSide.SELL,
        "time_in_force": TIME_IN_FORCE_BY_NAME[order.time_in_force.strip().lower()],
        "client_order_id": order.client_order_id,
    }
    if order.order_type == "market":
        return MarketOrderRequest(**common)

    return LimitOrderRequest(limit_price=order.limit_price, **common)


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
        if order.client_order_id is None:
            order = AlpacaOrderRequest(
                symbol=order.symbol,
                qty=order.qty,
                side=order.side,
                order_type=order.order_type,
                time_in_force=order.time_in_force,
                asset_class=order.asset_class,
                limit_price=order.limit_price,
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
) -> dict[str, Any]:
    return place_order(
        config,
        AlpacaOrderRequest(
            symbol=symbol,
            qty=qty,
            side=side,  # type: ignore[arg-type]
            order_type="market",
            time_in_force=time_in_force,
            asset_class=asset_class,
            client_order_id=client_order_id,
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
) -> dict[str, Any]:
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
            client_order_id=client_order_id,
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


def _fmt_position(position: Any) -> dict[str, Any]:
    def _float_or_none(value: Any) -> float | None:
        return float(value) if value is not None else None

    def _fmt_enum(value: Any) -> str:
        s = str(value)
        return s.split(".")[-1].lower() if "." in s else s.lower()

    return {
        "symbol": str(position.symbol),
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
        "symbol": str(order.symbol),
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
