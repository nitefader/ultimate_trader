"""
Deployment service — manages the backtest → paper → live promotion workflow.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.kill_switch import get_kill_switch
from app.models.account import Account
from app.models.deployment import Deployment, DeploymentApproval
from app.models.strategy import StrategyVersion
from app.services.alpaca_stream_manager import get_alpaca_stream_manager


def _enforce_kill_switch(account_id: str, strategy_id: str) -> None:
    ok, reason = get_kill_switch().can_trade(account_id=account_id, strategy_id=strategy_id)
    if not ok:
        raise ValueError(reason)


def _deployment_symbols(strategy_config: dict, config_overrides: dict | None) -> list[str]:
    overrides = config_overrides or {}
    symbols_raw = overrides.get("symbols") or strategy_config.get("symbols", [])
    if isinstance(symbols_raw, str):
        symbols_raw = [item.strip() for item in symbols_raw.split(",")]
    symbols: list[str] = []
    seen: set[str] = set()
    for raw in symbols_raw:
        symbol = str(raw).strip().upper()
        if not symbol or symbol in seen:
            continue
        symbols.append(symbol)
        seen.add(symbol)
    return symbols


async def promote_to_paper(
    db: AsyncSession,
    strategy_version_id: str,
    account_id: str,
    config_overrides: dict | None = None,
    promoted_from_run_id: str | None = None,
    notes: str | None = None,
) -> Deployment:
    """Promote a backtest-ready strategy version to paper trading."""
    # Verify strategy version exists
    sv = await db.get(StrategyVersion, strategy_version_id)
    if not sv:
        raise ValueError(f"StrategyVersion {strategy_version_id} not found")

    # Verify account is a paper account
    account = await db.get(Account, account_id)
    if not account:
        raise ValueError(f"Account {account_id} not found")
    if account.mode != "paper":
        raise ValueError(f"Account {account_id} is not a paper account (mode={account.mode})")
    if not account.has_alpaca_credentials():
        raise ValueError(
            f"Account '{account.name}' has no Alpaca API credentials configured. "
            "Add API keys in the Security Center before deploying."
        )
    _enforce_kill_switch(account.id, sv.strategy_id)

    deployment = Deployment(
        id=str(uuid.uuid4()),
        strategy_id=sv.strategy_id,
        strategy_version_id=strategy_version_id,
        account_id=account_id,
        mode="paper",
        # "pending" until explicitly started. We do not have an execution engine
        # yet, so marking "running" would be misleading.
        status="pending",
        config_overrides=config_overrides or {},
        promoted_from_run_id=promoted_from_run_id,
        started_at=None,
    )
    db.add(deployment)

    # Record approval
    approval = DeploymentApproval(
        id=str(uuid.uuid4()),
        deployment_id=deployment.id,
        from_mode="backtest",
        to_mode="paper",
        notes=notes,
        safety_checklist={
            "backtest_reviewed": True,
            "risk_limits_set": True,
            "paper_account_verified": True,
        },
    )
    db.add(approval)

    # Update strategy version promotion status
    sv.promotion_status = "paper_approved"

    await db.flush()
    return deployment


async def promote_to_live(
    db: AsyncSession,
    paper_deployment_id: str,
    live_account_id: str,
    config_overrides: dict | None = None,
    notes: str | None = None,
    safety_checklist: dict | None = None,
) -> Deployment:
    """Promote a paper deployment to live trading. Requires explicit safety checklist."""
    paper_dep = await db.get(Deployment, paper_deployment_id)
    if not paper_dep:
        raise ValueError(f"Paper deployment {paper_deployment_id} not found")
    if paper_dep.mode != "paper":
        raise ValueError("Source deployment must be a paper deployment")

    # Verify live account
    live_account = await db.get(Account, live_account_id)
    if not live_account:
        raise ValueError(f"Live account {live_account_id} not found")
    if live_account.mode != "live":
        raise ValueError(f"Account {live_account_id} is not a live account")
    if not live_account.has_alpaca_credentials():
        raise ValueError(
            f"Account '{live_account.name}' has no Alpaca API credentials configured. "
            "Add API keys in the Security Center before deploying."
        )
    _enforce_kill_switch(live_account.id, paper_dep.strategy_id)

    # Safety checklist is mandatory for live promotion
    required_checks = [
        "paper_performance_reviewed",
        "risk_limits_confirmed",
        "live_account_verified",
        "broker_connection_tested",
        "compliance_acknowledged",
        "market_conditions_assessed",
    ]
    checklist = safety_checklist or {}
    missing = [c for c in required_checks if not checklist.get(c)]
    if missing:
        raise ValueError(f"Safety checklist incomplete. Missing: {missing}")

    live_deployment = Deployment(
        id=str(uuid.uuid4()),
        strategy_id=paper_dep.strategy_id,
        strategy_version_id=paper_dep.strategy_version_id,
        account_id=live_account_id,
        mode="live",
        # "pending" until explicitly started.
        status="pending",
        config_overrides=config_overrides or paper_dep.config_overrides,
        promoted_from_deployment_id=paper_deployment_id,
        started_at=None,
    )
    db.add(live_deployment)

    # Record approval
    approval = DeploymentApproval(
        id=str(uuid.uuid4()),
        deployment_id=live_deployment.id,
        from_mode="paper",
        to_mode="live",
        notes=notes,
        safety_checklist=checklist,
    )
    db.add(approval)

    # Update strategy version
    sv = await db.get(StrategyVersion, paper_dep.strategy_version_id)
    if sv:
        sv.promotion_status = "live_approved"

    await db.flush()
    return live_deployment


async def start_deployment(db: AsyncSession, deployment_id: str) -> Deployment:
    dep = await db.get(Deployment, deployment_id)
    if not dep:
        raise ValueError(f"Deployment {deployment_id} not found")
    if dep.status == "stopped":
        raise ValueError("Cannot start a stopped deployment")
    if dep.status == "failed":
        raise ValueError("Cannot start a failed deployment")
    if dep.status == "running":
        return dep
    if dep.status not in {"pending", "paused"}:
        raise ValueError(f"Cannot start deployment in status={dep.status}")
    _enforce_kill_switch(dep.account_id, dep.strategy_id)

    dep.status = "running"
    dep.started_at = datetime.now(timezone.utc)
    sv = await db.get(StrategyVersion, dep.strategy_version_id)
    strategy_config = sv.config if sv else {}
    symbols = _deployment_symbols(strategy_config, dep.config_overrides)
    if symbols:
        manager = await get_alpaca_stream_manager()
        await manager.register_runner(dep.id, symbols)
    await db.flush()
    return dep


async def pause_deployment(db: AsyncSession, deployment_id: str, reason: str = "manual") -> Deployment:
    dep = await db.get(Deployment, deployment_id)
    if not dep:
        raise ValueError(f"Deployment {deployment_id} not found")
    dep.status = "paused"
    manager = await get_alpaca_stream_manager()
    await manager.unregister_runner(dep.id)
    await db.flush()
    return dep


async def stop_deployment(db: AsyncSession, deployment_id: str, reason: str = "manual") -> Deployment:
    dep = await db.get(Deployment, deployment_id)
    if not dep:
        raise ValueError(f"Deployment {deployment_id} not found")
    dep.status = "stopped"
    dep.stopped_at = datetime.now(timezone.utc)
    dep.stop_reason = reason
    manager = await get_alpaca_stream_manager()
    await manager.unregister_runner(dep.id)
    await db.flush()
    return dep
