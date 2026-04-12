"""Account management endpoints."""
from __future__ import annotations

import asyncio
import logging
import uuid
import re
from typing import Any
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import delete as sql_delete, select, update as sql_update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.account import Account
from app.models.deployment import Deployment, DeploymentApproval
from app.core.security import mask_broker_config
from app.services.alpaca_service import (
    AlpacaClientConfig,
    AlpacaConfigError,
    BASE_URL_BY_MODE,
    build_client_config,
    close_all_positions,
    get_account_status,
    get_orders,
    validate_credentials,
)

router = APIRouter(prefix="/accounts", tags=["accounts"])

logger = logging.getLogger(__name__)
ALPACA_BROKERS = {"alpaca", "alpaca_paper", "alpaca_live"}
ACTIVE_DEPLOYMENT_STATUSES = {"pending", "running", "paused"}


def _is_alpaca_account(account: Account) -> bool:
    """True if the account is Alpaca-backed — either by broker tag or having credentials stored."""
    return account.broker in ALPACA_BROKERS or bool(account.broker_config_encrypted)


def _build_alpaca_client_config(account: Account) -> AlpacaClientConfig:
    mode = str(account.mode).strip().lower()
    if mode not in BASE_URL_BY_MODE:
        raise AlpacaConfigError(f"Unsupported account mode '{mode}'. Expected one of: {', '.join(BASE_URL_BY_MODE.keys())}")
    mode_config = (account.broker_config or {}).get(mode, {})
    return build_client_config(
        api_key=mode_config.get("api_key", ""),
        secret_key=mode_config.get("secret_key", ""),
        mode=mode,
        base_url=mode_config.get("base_url") or BASE_URL_BY_MODE[mode],
    )


async def _fetch_alpaca_account_snapshot(account: Account) -> dict[str, Any] | None:
    try:
        from app.brokers.alpaca_broker import AlpacaBroker

        broker = AlpacaBroker.from_account(account)
        status = await broker.get_status()
        if status.get("error"):
            logger.warning("Alpaca snapshot failed for %s: %s", account.name, status.get("error"))
            return None
        account_data = status.get("account", {})
        positions = status.get("positions", [])
        unrealized_pnl = sum(float(p.get("unrealized_pl", 0) or 0) for p in positions)
        snapshot = {**account_data, "unrealized_pnl": unrealized_pnl}
        logger.debug("Alpaca snapshot OK for %s: equity=%.2f", account.name, snapshot.get("equity", 0))
        return snapshot
    except ValueError:
        # No credentials configured — skip silently
        return None
    except Exception as exc:
        logger.warning("Alpaca snapshot error for %s: %s", account.name, exc)
        return None


async def _refresh_alpaca_balances(accounts: list[Account], db: AsyncSession) -> None:
    refresh_accounts = [a for a in accounts if _is_alpaca_account(a)]
    if not refresh_accounts:
        return

    tasks = [_fetch_alpaca_account_snapshot(a) for a in refresh_accounts]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    updated = False
    for account, result in zip(refresh_accounts, results):
        if isinstance(result, Exception) or result is None:
            continue
        if "cash" not in result or "equity" not in result:
            continue

        account.current_balance = float(result["cash"])
        account.equity = float(result["equity"])
        # unrealized_pnl comes from positions, not equity-cash (which is market value)
        account.unrealized_pnl = float(result.get("unrealized_pnl", 0.0))
        account.is_connected = True
        updated = True

    if updated:
        await db.commit()


async def _get_account_activity(account: Account, db: AsyncSession) -> dict[str, Any]:
    dep_result = await db.execute(
        select(Deployment).where(Deployment.account_id == account.id).order_by(Deployment.created_at.desc())
    )
    deployments = dep_result.scalars().all()
    active_deployments = [d for d in deployments if d.status in ACTIVE_DEPLOYMENT_STATUSES]

    positions: list[dict[str, Any]] = []
    open_orders: list[dict[str, Any]] = []
    broker_error: str | None = None

    if _is_alpaca_account(account):
        try:
            from app.brokers.alpaca_broker import AlpacaBroker

            broker = AlpacaBroker.from_account(account)
            status_data, orders_data = await asyncio.gather(
                asyncio.wait_for(broker.get_status(), timeout=6),
                asyncio.wait_for(broker.get_orders("open"), timeout=6),
            )
            if isinstance(status_data, dict):
                broker_error = status_data.get("error")
                positions = status_data.get("positions", []) or []
            if isinstance(orders_data, list):
                open_orders = orders_data
        except Exception as exc:
            broker_error = str(exc)

    blockers: list[str] = []
    if active_deployments:
        blockers.append(f"{len(active_deployments)} active deployment(s)")
    if positions:
        blockers.append(f"{len(positions)} open position(s)")
    if open_orders:
        blockers.append(f"{len(open_orders)} open order(s)")

    return {
        "deployment_count": len(deployments),
        "active_deployments": len(active_deployments),
        "open_trades": len(positions),
        "open_positions": len(positions),
        "open_orders": len(open_orders),
        "position_symbols": [p.get("symbol") for p in positions if p.get("symbol")],
        "delete_blockers": blockers,
        "can_delete": len(blockers) == 0,
        "broker_error": broker_error,
    }


# ── Account CRUD ──────────────────────────────────────────────────────────────

@router.get("")
async def list_accounts(
    refresh: bool = False,
    include_activity: bool = False,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Account).order_by(Account.created_at))
    accounts = result.scalars().all()
    if refresh:
        await _refresh_alpaca_balances(accounts, db)
    if include_activity:
        activities = await asyncio.gather(*[_get_account_activity(a, db) for a in accounts])
        return [_fmt(a, activity=activity) for a, activity in zip(accounts, activities)]
    return [_fmt(a) for a in accounts]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_account(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    """Create an Account.

    This endpoint accepts JSON with keys case-insensitively (spaces/hyphens -> underscores).
    Input is validated via Pydantic; validation errors return HTTP 400 instead of a 500.
    """

    class AccountCreate(BaseModel):
        name: str = Field(..., min_length=1)
        mode: Literal["paper", "live"] = "paper"
        broker: str = "paper_broker"
        broker_config: dict[str, Any] = Field(default_factory=dict)
        data_service_id: str | None = None
        initial_balance: float = 0.0
        max_position_size_pct: float = 0.10
        max_daily_loss_pct: float = 0.03
        max_drawdown_lockout_pct: float = 0.10
        max_open_positions: int = 10
        leverage: float = 1.0
        allowed_symbols: list[str] = Field(default_factory=list)
        blocked_symbols: list[str] = Field(default_factory=list)

    # Normalize incoming keys to snake_case:
    # - case-insensitive
    # - spaces/hyphens -> underscores
    # - camelCase / PascalCase -> snake_case
    mapped: dict[str, Any] = {}
    def _to_snake(k: str) -> str:
        s = k.strip()
        s = s.replace(" ", "_").replace("-", "_")
        # Add underscore before capital letters (camelCase -> camel_case)
        s = re.sub(r'(?<!^)(?=[A-Z])', "_", s)
        s = s.lower()
        # Collapse repeated underscores
        s = re.sub(r"__+", "_", s)
        return s

    if isinstance(body, dict):
        for k, v in body.items():
            nk = _to_snake(k)
            mapped[nk] = v

    # Normalize mode to lowercase before validation
    if "mode" in mapped and isinstance(mapped["mode"], str):
        mapped["mode"] = mapped["mode"].strip().lower()

    try:
        payload = AccountCreate(**mapped)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.errors())

    account = Account(
        id=str(uuid.uuid4()),
        name=payload.name,
        mode=payload.mode.lower(),
        broker=payload.broker,
        broker_config=payload.broker_config,
        initial_balance=payload.initial_balance,
        current_balance=payload.initial_balance,
        equity=payload.initial_balance,
        max_position_size_pct=payload.max_position_size_pct,
        max_daily_loss_pct=payload.max_daily_loss_pct,
        max_drawdown_lockout_pct=payload.max_drawdown_lockout_pct,
        max_open_positions=payload.max_open_positions,
        leverage=payload.leverage,
        allowed_symbols=payload.allowed_symbols,
        blocked_symbols=payload.blocked_symbols,
        data_service_id=payload.data_service_id,
    )
    db.add(account)
    await db.flush()
    await db.commit()
    return _fmt(account)


@router.get("/{account_id}")
async def get_account(account_id: str, db: AsyncSession = Depends(get_db)):
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")
    return _fmt(a, activity=await _get_account_activity(a, db))


@router.put("/{account_id}")
async def update_account(account_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")

    previous_initial_balance = float(a.initial_balance or 0)
    update_values: dict[str, Any] = {}
    for field in ["name", "broker", "is_enabled", "leverage", "max_position_size_pct",
                  "max_daily_loss_pct", "max_open_positions", "allowed_symbols", "blocked_symbols",
                  "data_service_id"]:
        if field in body:
            update_values[field] = body[field]

    if "initial_balance" in body:
        new_initial_balance = float(body["initial_balance"])
        update_values["initial_balance"] = new_initial_balance

        # Keep manually managed accounts in sync with the updated starting balance.
        next_current_balance = float(a.current_balance or 0)
        next_equity = float(a.equity or 0)
        if abs(next_current_balance - previous_initial_balance) < 1e-9:
            next_current_balance = new_initial_balance
            update_values["current_balance"] = next_current_balance
        if abs(next_equity - previous_initial_balance) < 1e-9:
            next_equity = new_initial_balance
            update_values["equity"] = next_equity
        update_values["unrealized_pnl"] = next_equity - next_current_balance

    if update_values:
        await db.execute(
            sql_update(Account)
            .where(Account.id == account_id)
            .values(**update_values)
        )

    await db.commit()
    await db.refresh(a)
    return _fmt(a)


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db)):
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")

    activity = await _get_account_activity(a, db)
    if not activity["can_delete"]:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Cannot delete account while it still has active deployments, open positions, or open orders",
                "activity": activity,
            },
        )

    dep_result = await db.execute(select(Deployment.id).where(Deployment.account_id == account_id))
    deployment_ids = dep_result.scalars().all()

    try:
        if deployment_ids:
            await db.execute(
                sql_delete(DeploymentApproval).where(DeploymentApproval.deployment_id.in_(deployment_ids))
            )
            await db.execute(sql_delete(Deployment).where(Deployment.id.in_(deployment_ids)))

        await db.delete(a)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        logger.exception("Account delete integrity error for %s", account_id)
        raise HTTPException(
            status_code=409,
            detail=(
                "Cannot delete account because related records still exist. "
                "Stop deployments and clear linked activity, then try again."
            ),
        ) from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Account delete database error for %s", account_id)
        raise HTTPException(
            status_code=500,
            detail="Account delete failed due to a database error. Please try again.",
        ) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Halt / resume / flatten ───────────────────────────────────────────────────

@router.post("/{account_id}/kill")  # keep old path for backwards compat
@router.post("/{account_id}/halt")
async def halt_account(account_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    """Halt trading — block all new orders. Does not close existing positions."""
    from app.core.kill_switch import get_kill_switch
    from app.models.kill_switch import KillSwitchEvent
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")
    reason = body.get("reason", "Manual halt from UI")
    a.is_killed = True
    a.kill_reason = reason
    get_kill_switch().kill_account(account_id, reason)
    event = KillSwitchEvent(scope="account", scope_id=account_id, action="kill", reason=reason)
    db.add(event)
    await db.commit()
    return {"status": "halted", "account_id": account_id}


@router.post("/{account_id}/resume")
async def resume_account(account_id: str, db: AsyncSession = Depends(get_db)):
    """Resume trading — re-enable order placement."""
    from app.core.kill_switch import get_kill_switch
    from app.models.kill_switch import KillSwitchEvent
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")
    a.is_killed = False
    a.kill_reason = None
    get_kill_switch().resume_account(account_id)
    event = KillSwitchEvent(scope="account", scope_id=account_id, action="resume", reason=None)
    db.add(event)
    await db.commit()
    return {"status": "resumed", "account_id": account_id}


@router.post("/{account_id}/flatten")
async def flatten_account(account_id: str, db: AsyncSession = Depends(get_db)):
    """Close all open positions immediately via market orders. Does not halt trading."""
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")
    try:
        config = _build_alpaca_client_config(a)
    except AlpacaConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    results = await asyncio.get_running_loop().run_in_executor(
        None, lambda: close_all_positions(config)
    )
    errors = [r for r in results if r.get("error")]
    return {"flattened": True, "orders": results, "errors": errors}


@router.post("/{account_id}/emergency-exit")
async def emergency_exit_account(account_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    """Halt trading AND close all open positions atomically."""
    from app.core.kill_switch import get_kill_switch
    from app.models.kill_switch import KillSwitchEvent
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")
    reason = body.get("reason", "Emergency exit from UI")
    # 1. Halt first — block any new orders immediately
    a.is_killed = True
    a.kill_reason = reason
    get_kill_switch().kill_account(account_id, reason)
    event = KillSwitchEvent(scope="account", scope_id=account_id, action="kill", reason=reason)
    db.add(event)
    await db.commit()
    # 2. Flatten — close all positions
    flatten_results: list[dict[str, Any]] = []
    flatten_errors: list[dict[str, Any]] = []
    try:
        config = _build_alpaca_client_config(a)
        results = await asyncio.get_running_loop().run_in_executor(
            None, lambda: close_all_positions(config)
        )
        flatten_errors = [r for r in results if r.get("error")]
        flatten_results = results
    except (AlpacaConfigError, Exception) as exc:
        flatten_errors = [{"error": str(exc)}]
    return {
        "status": "emergency_exit",
        "halted": True,
        "flatten_orders": flatten_results,
        "flatten_errors": flatten_errors,
    }


# ── Credentials ───────────────────────────────────────────────────────────────

@router.get("/{account_id}/credentials")
async def get_account_credentials(account_id: str, db: AsyncSession = Depends(get_db)):
    """Return credentials with secrets masked — never returns plaintext keys."""
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")
    # Return masked config: api_key → first4****last4, secret_key → first4****last4
    masked = mask_broker_config(a.broker_config or {})
    return {"broker_config": masked}


@router.put("/{account_id}/credentials")
async def update_account_credentials(
    account_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)
):
    """
    Accept broker_config with plaintext keys and encrypt before storing.
    Masked values (containing '****') are treated as unchanged and not overwritten.
    """
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")

    incoming = body.get("broker_config", {})

    # If the frontend sends masked values back, merge with the existing plaintext config.
    existing_decrypted = a.broker_config or {}
    merged: dict[str, Any] = {}
    for mode, settings in incoming.items():
        if not isinstance(settings, dict):
            merged[mode] = settings
            continue
        existing_mode = existing_decrypted.get(mode, {})
        merged_mode: dict[str, Any] = dict(existing_mode)
        for field, value in settings.items():
            if isinstance(value, str) and "****" in value:
                # Masked — keep the existing plaintext value
                merged_mode[field] = existing_mode.get(field, "")
            else:
                merged_mode[field] = value
        normalized_mode = str(mode).strip().lower()
        if normalized_mode in BASE_URL_BY_MODE:
            merged_mode["base_url"] = merged_mode.get("base_url") or BASE_URL_BY_MODE[normalized_mode]
            has_any_secret = bool(merged_mode.get("api_key", "")) or bool(merged_mode.get("secret_key", ""))
            if has_any_secret:
                try:
                    build_client_config(
                        api_key=merged_mode.get("api_key", ""),
                        secret_key=merged_mode.get("secret_key", ""),
                        mode=normalized_mode,
                        base_url=merged_mode["base_url"],
                    )
                except AlpacaConfigError as exc:
                    raise HTTPException(status_code=400, detail=str(exc))
        merged[normalized_mode] = merged_mode

    # Store — the model setter handles encryption automatically
    a.broker_config = merged

    # Auto-tag the account as alpaca if real keys were provided for its mode
    mode_keys = merged.get(str(a.mode).strip().lower(), {})
    has_keys = bool(mode_keys.get("api_key", "")) and bool(mode_keys.get("secret_key", ""))
    if has_keys and a.broker not in ALPACA_BROKERS:
        a.broker = "alpaca"

    await db.commit()
    return {"status": "updated"}


@router.post("/{account_id}/credentials/validate")
async def validate_account_credentials(account_id: str, db: AsyncSession = Depends(get_db)):
    """Decrypt credentials and validate against Alpaca API."""
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")

    try:
        config = _build_alpaca_client_config(a)
    except AlpacaConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        result = await asyncio.get_running_loop().run_in_executor(
            None, lambda: validate_credentials(config)
        )
    except Exception as exc:
        logger.exception("Credential validation error for account %s: %s", account_id, exc)
        raise HTTPException(status_code=400, detail="Credential validation failed. Check your API key and secret.")

    # Auto-sync initial_balance (if still at default) and leverage from Alpaca
    if result.get("valid"):
        DEFAULT_BALANCE = 100_000.0
        portfolio_value = float(result.get("equity") or result.get("portfolio_value") or 0)
        multiplier = int(result.get("multiplier") or 1)
        changed = False
        if portfolio_value > 0 and abs(float(a.initial_balance or 0) - DEFAULT_BALANCE) < 1e-9:
            a.initial_balance = portfolio_value
            a.current_balance = portfolio_value
            a.equity = portfolio_value
            changed = True
        if multiplier != float(a.leverage or 1):
            a.leverage = float(multiplier)
            changed = True
        if changed:
            await db.commit()
            result["synced_initial_balance"] = a.initial_balance
            result["synced_leverage"] = a.leverage

    return result


@router.post("/{account_id}/sync-from-broker")
async def sync_account_from_broker(account_id: str, db: AsyncSession = Depends(get_db)):
    """Sync initial_balance and leverage from live Alpaca account data."""
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")

    try:
        config = _build_alpaca_client_config(a)
    except AlpacaConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        result = await asyncio.get_running_loop().run_in_executor(
            None, lambda: validate_credentials(config)
        )
    except Exception as exc:
        logger.exception("Broker sync error for account %s: %s", account_id, exc)
        raise HTTPException(status_code=400, detail="Failed to connect to Alpaca. Check credentials.")

    if not result.get("valid"):
        raise HTTPException(status_code=400, detail=result.get("error", "Credentials invalid"))

    portfolio_value = float(result.get("equity") or result.get("portfolio_value") or 0)
    multiplier = int(result.get("multiplier") or 1)

    if portfolio_value > 0:
        a.initial_balance = portfolio_value
        a.current_balance = portfolio_value
        a.equity = portfolio_value
    a.leverage = float(multiplier)
    await db.commit()

    return {
        "synced": True,
        "initial_balance": a.initial_balance,
        "leverage": a.leverage,
        "equity": portfolio_value,
        "multiplier": multiplier,
    }


# ── Broker live status ────────────────────────────────────────────────────────

@router.get("/{account_id}/broker/status")
async def get_account_broker_status(account_id: str, db: AsyncSession = Depends(get_db)):
    """Fetch live account info and positions from Alpaca (or return simulated status for paper accounts)."""
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")

    # Paper accounts without Alpaca credentials get a synthetic connected status
    # so the UI shows the account as operational rather than "credentials required".
    mode = str(a.mode).strip().lower()
    mode_config = (a.broker_config or {}).get(mode, {})
    has_credentials = bool(mode_config.get("api_key") and mode_config.get("secret_key"))
    if mode == "paper" and not has_credentials:
        equity = float(a.equity or a.current_balance or 100_000.0)
        return {
            "connected": True,
            "broker": "paper_simulated",
            "account": {
                "equity": equity,
                "cash": equity,
                "buying_power": equity * 2,
                "currency": "USD",
                "status": "ACTIVE",
                "pattern_day_trader": False,
            },
            "positions": [],
        }

    try:
        config = _build_alpaca_client_config(a)
    except AlpacaConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    result = await asyncio.get_running_loop().run_in_executor(
        None, lambda: get_account_status(config)
    )

    account_data = result.get("account") if isinstance(result, dict) else None
    positions_data = result.get("positions") if isinstance(result, dict) else []
    if isinstance(account_data, dict) and "cash" in account_data and "equity" in account_data:
        a.current_balance = float(account_data["cash"])
        a.equity = float(account_data["equity"])
        # Sum unrealized_pl from individual positions (equity-cash is market value, not PnL)
        a.unrealized_pnl = sum(float(p.get("unrealized_pl", 0) or 0) for p in (positions_data or []))
        a.is_connected = True
        await db.commit()

    return result


@router.post("/{account_id}/refresh")
async def refresh_account(account_id: str, db: AsyncSession = Depends(get_db)):
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")
    if not _is_alpaca_account(a):
        raise HTTPException(status_code=400, detail="Account broker is not Alpaca")

    await _refresh_alpaca_balances([a], db)
    await db.refresh(a)
    return _fmt(a)


@router.get("/{account_id}/broker/orders")
async def get_account_orders(
    account_id: str,
    status_filter: str = "open",
    db: AsyncSession = Depends(get_db),
):
    """Fetch open or recent orders from Alpaca."""
    a = await db.get(Account, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Account not found")

    try:
        config = _build_alpaca_client_config(a)
    except AlpacaConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    result = await asyncio.get_running_loop().run_in_executor(
        None, lambda: get_orders(config, status_filter)
    )
    return result


# ── Formatting ────────────────────────────────────────────────────────────────

def _fmt(a: Account, activity: dict[str, Any] | None = None) -> dict:
    data = {
        "id": a.id,
        "name": a.name,
        "mode": a.mode,
        "broker": a.broker,
        "initial_balance": a.initial_balance,
        "current_balance": a.current_balance,
        "equity": a.equity,
        "unrealized_pnl": a.unrealized_pnl,
        "leverage": a.leverage,
        "max_position_size_pct": a.max_position_size_pct,
        "max_daily_loss_pct": a.max_daily_loss_pct,
        "max_drawdown_lockout_pct": a.max_drawdown_lockout_pct,  # required by AccountMonitor
        "max_open_positions": a.max_open_positions,
        "is_connected": a.is_connected,
        "is_enabled": a.is_enabled,
        "is_killed": a.is_killed,
        "kill_reason": a.kill_reason,
        "allowed_symbols": a.allowed_symbols or [],
        "blocked_symbols": a.blocked_symbols or [],
        "data_service_id": a.data_service_id,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }
    if activity is not None:
        data["activity"] = activity
    return data


# ── Cleanup ───────────────────────────────────────────────────────────────────

@router.delete("/cleanup/no-credentials", status_code=200)
async def delete_accounts_without_credentials(db: AsyncSession = Depends(get_db)):
    """Delete accounts that have no Alpaca credentials and no active deployments."""
    result = await db.execute(select(Account))
    accounts = list(result.scalars().all())

    deleted: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []

    for a in accounts:
        if a.has_alpaca_credentials():
            continue  # has credentials — keep

        # Check for deployments
        dep_result = await db.execute(
            select(Deployment).where(Deployment.account_id == a.id)
        )
        deps = list(dep_result.scalars().all())
        if deps:
            skipped.append({"id": a.id, "name": a.name, "reason": f"{len(deps)} deployment(s)"})
            continue

        deleted.append({"id": a.id, "name": a.name})
        await db.delete(a)

    await db.commit()
    return {"deleted": deleted, "skipped": skipped}
