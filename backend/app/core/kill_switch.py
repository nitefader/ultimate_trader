"""
Global kill switch — stops all trading immediately across all strategies/accounts.
Thread-safe singleton with event log.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any


class KillSwitch:
    """
    Platform-wide kill switch state.
    Any component must call can_open_new_position() before submitting an opening order.
    """

    def __init__(self):
        self._global_killed: bool = False
        self._global_kill_reason: str | None = None
        self._account_kills: dict[str, dict[str, Any]] = {}      # account_id → {killed, reason}
        self._strategy_kills: dict[str, dict[str, Any]] = {}     # strategy_id → {killed, reason} (deprecated scope)
        self._deployment_pauses: dict[str, dict[str, Any]] = {}  # deployment_id → {paused}
        self._event_log: list[dict[str, Any]] = []
        self._callbacks: list[Any] = []   # async coroutines to call on kill

    # ── Global kill ────────────────────────────────────────────────────────────

    def kill_all(self, reason: str = "manual", triggered_by: str = "user") -> None:
        self._global_killed = True
        self._global_kill_reason = reason
        self._log("global", None, "kill", reason, triggered_by)

    def unkill_all(self, triggered_by: str = "user") -> None:
        self._global_killed = False
        self._global_kill_reason = None
        self._log("global", None, "resume", None, triggered_by)

    @property
    def is_globally_killed(self) -> bool:
        return self._global_killed

    # ── Account-level kill ─────────────────────────────────────────────────────

    def kill_account(self, account_id: str, reason: str = "manual", triggered_by: str = "user") -> None:
        self._account_kills[account_id] = {"killed": True, "reason": reason}
        self._log("account", account_id, "kill", reason, triggered_by)

    def unkill_account(self, account_id: str, triggered_by: str = "user") -> None:
        self._account_kills[account_id] = {"killed": False, "reason": None}
        self._log("account", account_id, "resume", None, triggered_by)

    def is_account_killed(self, account_id: str) -> bool:
        return self._global_killed or self._account_kills.get(account_id, {}).get("killed", False)

    # ── Strategy-level kill (deprecated — use deployment scope for new code) ───

    def kill_strategy(self, strategy_id: str, reason: str = "manual", triggered_by: str = "user") -> None:
        self._strategy_kills[strategy_id] = {"killed": True, "reason": reason}
        self._log("strategy", strategy_id, "kill", reason, triggered_by)

    def pause_strategy(self, strategy_id: str, triggered_by: str = "user") -> None:
        import warnings
        warnings.warn(
            "pause_strategy() is deprecated — use pause_deployment(deployment_id) instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        self._strategy_kills[strategy_id] = {"killed": True, "reason": "paused"}
        self._log("strategy", strategy_id, "pause", "paused", triggered_by)

    def resume_strategy(self, strategy_id: str, triggered_by: str = "user") -> None:
        import warnings
        warnings.warn(
            "resume_strategy() is deprecated — use resume_deployment(deployment_id) instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        self._strategy_kills[strategy_id] = {"killed": False, "reason": None}
        self._log("strategy", strategy_id, "resume", None, triggered_by)

    def is_strategy_killed(self, strategy_id: str) -> bool:
        return self._global_killed or self._strategy_kills.get(strategy_id, {}).get("killed", False)

    # ── Deployment-level pause ─────────────────────────────────────────────────

    def pause_deployment(self, deployment_id: str, triggered_by: str = "user") -> None:
        self._deployment_pauses[deployment_id] = {"paused": True}
        self._log("deployment", deployment_id, "pause", "paused", triggered_by)

    def resume_deployment(self, deployment_id: str, triggered_by: str = "user") -> None:
        self._deployment_pauses[deployment_id] = {"paused": False}
        self._log("deployment", deployment_id, "resume", None, triggered_by)

    def is_deployment_paused(self, deployment_id: str) -> bool:
        return self._deployment_pauses.get(deployment_id, {}).get("paused", False)

    # ── Unified entry gate ─────────────────────────────────────────────────────

    def can_open_new_position(
        self,
        account_id: str,
        deployment_id: str,
        symbol: str = "",
        side: str = "",
    ) -> tuple[bool, str]:
        """
        Single gate for all position-opening order paths.
        Checks scopes in precedence order: global → account → deployment.

        Returns (True, "ok") or (False, reason_string).

        This is the ONLY function that should gate new position-opening orders.
        No code path may call alpaca_service.submit_order() for opening orders
        without first calling this.
        """
        if self._global_killed:
            return False, f"global_kill: {self._global_kill_reason}"
        if self._account_kills.get(account_id, {}).get("killed", False):
            return False, f"account_paused: {account_id}"
        if self._deployment_pauses.get(deployment_id, {}).get("paused", False):
            return False, f"program_paused: {deployment_id}"
        return True, "ok"

    # ── Legacy composite check (kept for backward compatibility) ───────────────

    def can_trade(self, account_id: str | None = None, strategy_id: str | None = None) -> tuple[bool, str]:
        if self._global_killed:
            return False, f"Global kill switch: {self._global_kill_reason}"
        if account_id and self._account_kills.get(account_id, {}).get("killed", False):
            return False, f"Account {account_id} is killed"
        if strategy_id and self.is_strategy_killed(strategy_id):
            return False, f"Strategy {strategy_id} is killed/paused"
        return True, "ok"

    # ── Event log ──────────────────────────────────────────────────────────────

    def _log(self, scope: str, scope_id: str | None, action: str, reason: str | None, triggered_by: str) -> None:
        self._event_log.append({
            "scope": scope,
            "scope_id": scope_id,
            "action": action,
            "reason": reason,
            "triggered_by": triggered_by,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    def get_events(self, limit: int = 100) -> list[dict]:
        return list(reversed(self._event_log[-limit:]))

    def get_status(self) -> dict:
        return {
            "global_killed": self._global_killed,
            "global_kill_reason": self._global_kill_reason,
            "killed_accounts": [k for k, v in self._account_kills.items() if v.get("killed")],
            "killed_strategies": [k for k, v in self._strategy_kills.items() if v.get("killed")],
            "paused_deployments": [k for k, v in self._deployment_pauses.items() if v.get("paused")],
        }


# Singleton instance shared across the application
_kill_switch = KillSwitch()


def get_kill_switch() -> KillSwitch:
    return _kill_switch
