"""
UltraTrader 2026 — Backend entry point.
"""
from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import create_all_tables
from app.api.routes.strategies import router as strategies_router
from app.api.routes.backtests import router as backtests_router
from app.api.routes.accounts import router as accounts_router
from app.api.routes.deployments import router as deployments_router
from app.api.routes.data import router as data_router
from app.api.routes.control import router as control_router
from app.api.routes.events import router as events_router
from app.api.routes.ml import router as ml_router
from app.api.routes.monitor import router as monitor_router
from app.api.routes.optimizations import router as optimizations_router
from app.api.routes.universes import router as universes_router
from app.api.routes.bi import router as bi_router
from app.api.routes.backlog import router as backlog_router
from app.api.routes.services import router as services_router
from app.api.routes.programs import router as programs_router
from app.api.routes.watchlists import router as watchlists_router
from app.api.routes.simulations import router as simulations_router
from app.api.routes.risk_profiles import router as risk_profiles_router
from app.api.routes.strategy_governors import router as strategy_controls_router
from app.api.routes.execution_styles import router as execution_styles_router
from app.api.routes.governor import router as governor_router
from app.api.routes.admin import router as admin_router

settings = get_settings()
logger = logging.getLogger(__name__)

# ── Structured logging setup ──────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.add_log_level,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

logging.basicConfig(
    format="%(message)s",
    stream=sys.stdout,
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
)

# SQLAlchemy, aiosqlite, and asyncio loggers are extremely noisy at DEBUG level
# (one line per cursor operation). Suppress them unless SQL_ECHO is explicitly enabled.
if not settings.SQL_ECHO:
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine.Engine").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)
    logging.getLogger("aiosqlite").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)


# ── App lifecycle ─────────────────────────────────────────────────────────────

async def _run_schema_migrations() -> None:
    """
    Apply incremental schema changes that create_all cannot handle (ALTER TABLE).
    Safe to call on every startup — each statement is guarded by a column existence check.
    """
    from app.database import engine
    from sqlalchemy import text

    migrations = [
        # Added in session 2: trade performance fields
        ("trades", "return_pct",  "REAL"),
        ("trades", "r_multiple",  "REAL"),
        # Accounts table: encrypted credentials + later risk controls
        ("accounts", "broker_config_encrypted", "TEXT"),
        ("accounts", "max_drawdown_lockout_pct", "REAL DEFAULT 0.15"),
        ("accounts", "allowed_symbols",  "TEXT DEFAULT '[]'"),
        ("accounts", "blocked_symbols",  "TEXT DEFAULT '[]'"),
        ("program_backlog_items", "order_index", "INTEGER DEFAULT 0"),
        ("program_backlog_items", "blocked_by_ids", "TEXT DEFAULT '[]'"),
        ("accounts", "data_service_id", "TEXT"),
        ("accounts", "is_killed", "BOOLEAN DEFAULT 0"),
        ("accounts", "kill_reason", "TEXT"),
        ("accounts", "account_mode", "TEXT DEFAULT 'margin'"),
        ("strategy_versions", "duration_mode", "TEXT DEFAULT 'swing'"),
        ("watchlist_memberships", "candidate_since", "DATETIME"),
        ("watchlist_memberships", "active_since", "DATETIME"),
        ("watchlist_memberships", "pending_removal_since", "DATETIME"),
        ("watchlist_memberships", "inactive_until", "DATETIME"),
        ("watchlist_memberships", "suspended_at", "DATETIME"),
        ("optimization_profiles", "strategy_version_id", "TEXT"),
        ("optimization_profiles", "validation_evidence_id", "TEXT"),
        ("optimization_profiles", "symbol_universe_snapshot_id", "TEXT"),
        ("optimization_profiles", "engine_version", "TEXT DEFAULT '1'"),
        ("optimization_profiles", "status", "TEXT DEFAULT 'draft'"),
        ("optimization_profiles", "objective_config", "TEXT DEFAULT '{}'"),
        ("optimization_profiles", "covariance_model", "TEXT DEFAULT '{}'"),
        ("optimization_profiles", "constraints", "TEXT DEFAULT '{}'"),
        ("optimization_profiles", "notes", "TEXT"),
        ("weight_profiles", "parent_weight_profile_id", "TEXT"),
        ("weight_profiles", "engine_version", "TEXT DEFAULT '1'"),
        ("weight_profiles", "evidence_id", "TEXT"),
        ("weight_profiles", "symbol_universe_snapshot_id", "TEXT"),
        ("weight_profiles", "metadata_version_id", "TEXT"),
        ("weight_profiles", "objective_used", "TEXT DEFAULT '{}'"),
        ("weight_profiles", "constraints_used", "TEXT DEFAULT '{}'"),
        ("weight_profiles", "covariance_model_used", "TEXT DEFAULT '{}'"),
        ("weight_profiles", "input_universe_snapshot", "TEXT DEFAULT '[]'"),
        ("weight_profiles", "output_weights", "TEXT DEFAULT '{}'"),
        ("weight_profiles", "explain_output", "TEXT DEFAULT '{}'"),
        ("market_metadata_symbols", "adv_usd_30d", "REAL"),
        ("market_metadata_symbols", "spread_proxy_bps_30d", "REAL"),
        ("market_metadata_symbols", "regime_tag", "TEXT DEFAULT 'unknown'"),
        ("market_metadata_snapshots", "provider_requested", "TEXT DEFAULT 'auto'"),
        ("market_metadata_snapshots", "provider_used", "TEXT DEFAULT 'yfinance'"),
        ("market_metadata_snapshots", "fetch_start_date", "TEXT"),
        ("market_metadata_snapshots", "fetch_end_date", "TEXT"),
        # RiskProfile FK on accounts
        ("accounts", "risk_profile_id", "TEXT"),
        # Governor fields on deployments
        ("deployments", "governor_label", "TEXT"),
        ("deployments", "governor_status", "TEXT DEFAULT 'active'"),
        ("deployments", "risk_profile_id", "TEXT"),
        ("deployments", "poll_config", "TEXT DEFAULT '{}'"),
        ("deployments", "collision_state_snapshot", "TEXT DEFAULT '{}'"),
        ("deployments", "correlation_data_refreshed_at", "DATETIME"),
        ("deployments", "session_realized_pnl", "REAL DEFAULT 0.0"),
        ("deployments", "daily_loss_lockout_triggered", "INTEGER DEFAULT 0"),
        ("deployments", "halt_trigger", "TEXT"),
        ("deployments", "halt_at", "DATETIME"),
        ("deployments", "last_governor_tick_at", "DATETIME"),
        # TradingProgram universe fields
        ("trading_programs", "universe_mode", "TEXT DEFAULT 'snapshot'"),
        ("trading_programs", "watchlist_subscriptions", "TEXT DEFAULT '[]'"),
        ("trading_programs", "watchlist_combination_rule", "TEXT DEFAULT 'union'"),
        ("trading_programs", "live_universe_deny_list", "TEXT DEFAULT '[]'"),
        ("trading_programs", "live_universe_top_n", "INTEGER"),
        ("trading_programs", "live_universe_resolved_symbols", "TEXT DEFAULT '[]'"),
        ("trading_programs", "live_universe_resolved_at", "DATETIME"),
        ("trading_programs", "universe_poll_override_seconds", "INTEGER"),
        # AccountAllocation governor link
        ("account_allocations", "governor_id", "TEXT"),
        # Golden templates for watchlists and risk profiles
        ("watchlists", "is_golden", "BOOLEAN DEFAULT 0"),
        ("watchlists", "tags", "TEXT DEFAULT '[]'"),
        ("risk_profiles", "is_golden", "BOOLEAN DEFAULT 0"),
        ("risk_profiles", "tags", "TEXT DEFAULT '[]'"),
        # AI default flag on data_services
        ("data_services", "is_default_ai", "BOOLEAN DEFAULT 0"),
        # Five-component architecture — new FK columns on trading_programs
        ("trading_programs", "strategy_governor_id", "TEXT"),
        ("trading_programs", "execution_style_id",   "TEXT"),
        ("trading_programs", "risk_profile_id",       "TEXT"),
        ("trading_programs", "notes", "TEXT"),
        # Execution style — persist breakeven-stop flag and stop progression config
        ("execution_styles", "move_stop_to_be_after_t1", "BOOLEAN DEFAULT 0"),
        ("execution_styles", "stop_progression_targets", "JSON DEFAULT '[]'"),
        ("execution_styles", "breakeven_atr_pad", "REAL DEFAULT 0.1"),
        # Execution style v2 — breakeven trigger level + final runner config
        ("execution_styles", "breakeven_trigger_level", "INTEGER"),
        ("execution_styles", "breakeven_atr_offset", "REAL DEFAULT 0.0"),
        ("execution_styles", "final_runner_exit_mode", "TEXT DEFAULT 'internal'"),
        ("execution_styles", "final_runner_trail_type", "TEXT"),
        ("execution_styles", "final_runner_trail_value", "REAL"),
        ("execution_styles", "final_runner_time_in_force", "TEXT"),
        # Execution style v3 — ATR source override
        ("execution_styles", "atr_source", "TEXT DEFAULT 'strategy'"),
        ("execution_styles", "atr_length", "INTEGER"),
        ("execution_styles", "atr_timeframe", "TEXT"),
        # DeploymentTrade v2 — stop ownership tracking
        ("deployment_trades", "stop_control", "TEXT DEFAULT 'internal'"),
        ("deployment_trades", "alpaca_stop_order_id", "TEXT"),
    ]

    async with engine.begin() as conn:
        # ── Table renames (idempotent) ────────────────────────────────────────
        table_renames = [
            # Canonical rename: strategy_governors → strategy_controls (2026-04-22)
            ("strategy_governors", "strategy_controls"),
        ]
        for old_name, new_name in table_renames:
            try:
                # Check if old table exists before renaming
                result = await conn.execute(
                    text(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{old_name}'")
                )
                if result.fetchone():
                    await conn.execute(text(f"ALTER TABLE {old_name} RENAME TO {new_name}"))
                    logger.info(f"Migration: renamed table {old_name} → {new_name}")
                else:
                    logger.debug(f"Migration skipped: table {old_name} does not exist (already renamed or never created)")
            except Exception as exc:
                logger.debug(f"Migration skipped (table rename {old_name} → {new_name}): {exc}")

        # ── Column additions (idempotent) ─────────────────────────────────────
        for table, column, col_type in migrations:
            try:
                await conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
                )
                logger.info(f"Migration: added {table}.{column}")
            except Exception as exc:
                # Column already exists — this is expected on subsequent startups
                logger.debug(f"Migration skipped (likely already exists): {table}.{column} - {exc}")

        # ── Data migrations (idempotent) ──────────────────────────────────────
        data_migrations = [
            # Migrate move_stop_to_be_after_t1 bool → breakeven_trigger_level int
            "UPDATE execution_styles SET breakeven_trigger_level = 1 WHERE move_stop_to_be_after_t1 = 1 AND breakeven_trigger_level IS NULL",
            # Carry over breakeven_atr_pad → breakeven_atr_offset
            "UPDATE execution_styles SET breakeven_atr_offset = breakeven_atr_pad WHERE (breakeven_atr_offset IS NULL OR breakeven_atr_offset = 0.0) AND breakeven_atr_pad IS NOT NULL AND breakeven_atr_pad != 0.0",
        ]
        for sql in data_migrations:
            try:
                await conn.execute(text(sql))
            except Exception as exc:
                logger.debug(f"Data migration skipped: {exc}")


async def lifespan(app: FastAPI):
    # Startup
    await create_all_tables()
    await _run_schema_migrations()
    await seed_default_data()
    await _restore_kill_switch_state()
    from app.services.watchlist_scheduler import start_watchlist_scheduler
    from app.services.account_governor_loop import start_account_governor_loop, stop_account_governor_loop
    from app.services.alpaca_account_stream import start_alpaca_account_stream
    start_watchlist_scheduler()
    start_account_governor_loop()
    # Start Alpaca account event stream (fills/orders → ws_manager.broadcast)
    # Runs as a background task; auto-reconnects. Silently skipped if no credentials configured.
    import asyncio as _asyncio
    _alpaca_stream_task = _asyncio.create_task(start_alpaca_account_stream())
    yield
    # Shutdown (graceful)
    from app.services.watchlist_scheduler import stop_watchlist_scheduler
    stop_watchlist_scheduler()
    stop_account_governor_loop()
    _alpaca_stream_task.cancel()
    try:
        await _alpaca_stream_task
    except _asyncio.CancelledError:
        pass


async def _restore_kill_switch_state():
    """
    Reload kill/pause state from DB into the in-memory kill switch on startup.

    Order:
      a. Global kill — from most recent KillSwitchEvent with scope="global"
      b. Account kills — from Account.is_killed (already implemented)
      c. Deployment pauses — from Deployment.status="paused"

    No order submission can occur before this function completes.
    """
    from app.database import AsyncSessionLocal
    from app.models.account import Account
    from app.models.deployment import Deployment
    from app.models.kill_switch import KillSwitchEvent
    from app.core.kill_switch import get_kill_switch
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        ks = get_kill_switch()

        # a. Global kill — find last global event; apply if it was a kill with no subsequent resume
        global_result = await db.execute(
            select(KillSwitchEvent)
            .where(KillSwitchEvent.scope == "global")
            .order_by(KillSwitchEvent.triggered_at.desc())
            .limit(1)
        )
        last_global = global_result.scalar_one_or_none()
        if last_global and last_global.action == "kill":
            ks.kill_all(reason=last_global.reason or "restored_on_startup", triggered_by="system")
            logger.info("Kill switch: global kill restored from DB on startup (reason=%s)", last_global.reason)
        elif last_global and last_global.action == "resume":
            # Explicitly ensure clean state after a resume
            if ks.is_globally_killed:
                ks.unkill_all(triggered_by="system")

        # b. Account kills
        acct_result = await db.execute(select(Account).where(Account.is_killed == True))  # noqa: E712
        halted_accounts = acct_result.scalars().all()
        for account in halted_accounts:
            ks.kill_account(account.id, account.kill_reason or "restored_on_startup", triggered_by="system")
        if halted_accounts:
            logger.info("Kill switch: restored %d halted account(s) from DB on startup", len(halted_accounts))

        # c. Deployment pauses
        dep_result = await db.execute(
            select(Deployment).where(Deployment.status == "paused")
        )
        paused_deployments = dep_result.scalars().all()
        for dep in paused_deployments:
            ks.pause_deployment(dep.id, triggered_by="system")
        if paused_deployments:
            logger.info("Kill switch: restored %d paused deployment(s) from DB on startup", len(paused_deployments))


async def seed_default_data():
    """Create default paper account, seed sample strategies, watchlists, and golden templates on first run."""
    from app.database import AsyncSessionLocal
    from app.models.account import Account
    from app.models.strategy import Strategy, StrategyVersion
    from app.models.watchlist import Watchlist, WatchlistMembership
    from app.models.risk_profile import RiskProfile
    from sqlalchemy import select
    import uuid
    import os
    import glob
    import yaml

    _VALID_DURATION_MODES = {"day", "swing", "position"}

    async with AsyncSessionLocal() as db:
        # ── Default paper account ────────────────────────────────────────────
        result = await db.execute(select(Account).limit(1))
        if not result.scalar_one_or_none():
            paper_account = Account(
                id=str(uuid.uuid4()),
                name="Default Paper Account",
                mode="paper",
                broker="paper_broker",
                initial_balance=100_000.0,
                current_balance=100_000.0,
                equity=100_000.0,
                is_connected=True,
                is_enabled=True,
            )
            db.add(paper_account)
            await db.commit()

        # ── Sample strategies from YAML configs ──────────────────────────────
        result = await db.execute(select(Strategy.name))
        existing_names = {row[0] for row in result.all()}

        configs_dir = os.path.join(os.path.dirname(__file__), '..', 'configs', 'strategies')
        if os.path.exists(configs_dir):
            config_paths = sorted(glob.glob(os.path.join(configs_dir, '*.yaml')))
            for path in config_paths:
                try:
                    with open(path, encoding='utf-8') as f:
                        raw = yaml.safe_load(f)
                    if not raw:
                        continue

                    name = raw.get('name', os.path.basename(path))
                    if name in existing_names:
                        continue

                    # Pull top-level metadata fields out before storing config
                    duration_mode = raw.get('duration_mode', 'swing')
                    if duration_mode not in _VALID_DURATION_MODES:
                        duration_mode = 'swing'

                    tags = raw.get('tags', [])
                    if not isinstance(tags, list):
                        tags = []

                    strategy = Strategy(
                        id=str(uuid.uuid4()),
                        name=name,
                        description=(raw.get('description') or '').strip(),
                        category=raw.get('category', 'custom'),
                        status='active',
                        tags=tags,
                    )
                    db.add(strategy)

                    version = StrategyVersion(
                        id=str(uuid.uuid4()),
                        strategy_id=strategy.id,
                        version=1,
                        config=raw,
                        notes='Sample strategy — loaded from YAML',
                        duration_mode=duration_mode,
                        promotion_status='backtest_only',
                    )
                    db.add(version)
                    existing_names.add(name)
                    logger.info(f"Seeded strategy: {name} (duration_mode={duration_mode})")
                except Exception as exc:
                    logger.warning(f"Failed to seed strategy from {path}: {exc}")

            await db.commit()

        # ── Watchlists from YAML configs ──────────────────────────────────────
        result = await db.execute(select(Watchlist.name))
        existing_watchlists = {row[0] for row in result.all()}

        watchlist_dir = os.path.join(os.path.dirname(__file__), '..', 'configs', 'watchlists')
        if os.path.exists(watchlist_dir):
            wl_paths = sorted(glob.glob(os.path.join(watchlist_dir, '*.yaml')))
            for path in wl_paths:
                try:
                    with open(path, encoding='utf-8') as f:
                        wl_raw = yaml.safe_load(f)
                    if not wl_raw:
                        continue

                    wl_name = wl_raw.get('name', os.path.basename(path))
                    if wl_name in existing_watchlists:
                        continue

                    watchlist = Watchlist(
                        id=str(uuid.uuid4()),
                        name=wl_name,
                        watchlist_type=wl_raw.get('watchlist_type', 'manual'),
                        refresh_cron=wl_raw.get('refresh_cron'),
                        min_refresh_interval_minutes=wl_raw.get('min_refresh_interval_minutes', 5),
                        config=wl_raw.get('config', {}),
                    )
                    db.add(watchlist)

                    symbols = wl_raw.get('symbols', [])
                    for sym in symbols:
                        sym = str(sym).strip().upper()
                        if not sym:
                            continue
                        import datetime as _dt
                        now = _dt.datetime.now(_dt.timezone.utc)
                        membership = WatchlistMembership(
                            id=str(uuid.uuid4()),
                            watchlist_id=watchlist.id,
                            symbol=sym,
                            state='active',
                            resolved_at=now,
                            active_since=now,
                        )
                        db.add(membership)

                    existing_watchlists.add(wl_name)
                    logger.info(f"Seeded watchlist: {wl_name} ({len(symbols)} symbols)")
                except Exception as exc:
                    logger.warning(f"Failed to seed watchlist from {path}: {exc}")

            await db.commit()

        # ── Golden watchlist templates ────────────────────────────────────────
        import datetime as _dt
        _now = _dt.datetime.now(_dt.timezone.utc)

        _golden_watchlists = [
            {
                "name": "Mag-7 + AI Leaders",
                "tags": ["large_cap", "momentum"],
                "symbols": ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA", "PLTR", "ARM", "AVGO"],
            },
            {
                "name": "Liquid Mid-Cap Movers",
                "tags": ["day_trading", "volatile"],
                "symbols": ["COIN", "MARA", "RIOT", "SMCI", "HOOD", "RBLX", "SOFI", "UPST", "AFRM", "IONQ"],
            },
            {
                "name": "Sector ETFs",
                "tags": ["swing", "diversified"],
                "symbols": ["XLK", "XLF", "XLE", "XLV", "XLU", "XLI", "XLRE", "XLC", "XLP", "XLY"],
            },
            {
                "name": "SPY 500 Core",
                "tags": ["position", "macro"],
                "symbols": ["SPY", "QQQ", "IWM", "DIA", "VTI", "GLD", "SLV", "TLT", "HYG", "USO"],
            },
        ]
        result = await db.execute(select(Watchlist.name).where(Watchlist.is_golden == True))  # noqa: E712
        existing_golden_wl = {row[0] for row in result.all()}
        for spec in _golden_watchlists:
            if spec["name"] in existing_golden_wl:
                continue
            wl = Watchlist(
                id=str(uuid.uuid4()),
                name=spec["name"],
                watchlist_type="manual",
                is_golden=True,
                tags=spec["tags"],
            )
            db.add(wl)
            await db.flush()
            for sym in spec["symbols"]:
                db.add(WatchlistMembership(
                    id=str(uuid.uuid4()),
                    watchlist_id=wl.id,
                    symbol=sym,
                    state="active",
                    resolved_at=_now,
                    active_since=_now,
                ))
            logger.info(f"Seeded golden watchlist: {spec['name']}")
        await db.commit()

        # ── Golden risk profile templates ─────────────────────────────────────
        _golden_profiles = [
            {
                "name": "Day Trader — Conservative",
                "description": "Tight intraday risk: max 3 long, 2% daily loss, 5% drawdown lockout.",
                "tags": ["day_trading"],
                "max_open_positions_long": 3, "max_open_positions_short": 1,
                "max_daily_loss_pct": 0.02, "max_drawdown_lockout_pct": 0.05, "max_leverage": 1.0,
                "max_portfolio_heat_long": 0.04, "max_portfolio_heat_short": 0.02,
                "max_position_size_pct_long": 0.08, "max_position_size_pct_short": 0.05,
                "max_correlated_exposure_long": 0.8, "max_correlated_exposure_short": 0.5,
            },
            {
                "name": "Swing Trader — Standard",
                "description": "Balanced swing: max 5 long / 2 short, 3% daily loss, 10% drawdown lockout.",
                "tags": ["swing"],
                "max_open_positions_long": 5, "max_open_positions_short": 2,
                "max_daily_loss_pct": 0.03, "max_drawdown_lockout_pct": 0.10, "max_leverage": 1.5,
                "max_portfolio_heat_long": 0.06, "max_portfolio_heat_short": 0.04,
                "max_position_size_pct_long": 0.10, "max_position_size_pct_short": 0.08,
                "max_correlated_exposure_long": 1.0, "max_correlated_exposure_short": 0.8,
            },
            {
                "name": "Swing Trader — Aggressive",
                "description": "Higher exposure swing: max 8 long / 3 short, 5% daily loss, 15% drawdown lockout.",
                "tags": ["swing"],
                "max_open_positions_long": 8, "max_open_positions_short": 3,
                "max_daily_loss_pct": 0.05, "max_drawdown_lockout_pct": 0.15, "max_leverage": 1.5,
                "max_portfolio_heat_long": 0.08, "max_portfolio_heat_short": 0.05,
                "max_position_size_pct_long": 0.12, "max_position_size_pct_short": 0.10,
                "max_correlated_exposure_long": 1.2, "max_correlated_exposure_short": 0.9,
            },
            {
                "name": "Position Trader",
                "description": "Long-horizon: max 10 long / 3 short, 8% daily loss, 20% drawdown lockout.",
                "tags": ["position"],
                "max_open_positions_long": 10, "max_open_positions_short": 3,
                "max_daily_loss_pct": 0.08, "max_drawdown_lockout_pct": 0.20, "max_leverage": 1.0,
                "max_portfolio_heat_long": 0.10, "max_portfolio_heat_short": 0.06,
                "max_position_size_pct_long": 0.15, "max_position_size_pct_short": 0.10,
                "max_correlated_exposure_long": 1.5, "max_correlated_exposure_short": 1.0,
            },
        ]
        from app.models.strategy_governor import StrategyControls
        from app.models.execution_style import ExecutionStyle

        # ── Golden strategy controls templates ────────────────────────────────
        _golden_controls = [
            {
                "name": "Day Trade NYSE 5m",
                "description": "Intraday NYSE session — two entry windows, flat by 15:45.",
                "tags": ["day_trading"],
                "timeframe": "5m",
                "duration_mode": "day",
                "market_hours": {
                    "entry_windows": [
                        {"start": "09:35", "end": "11:00"},
                        {"start": "13:30", "end": "15:00"},
                    ],
                    "force_flat_by": "15:45",
                    "timezone": "America/New_York",
                    "skip_first_bar": True,
                },
                "pdt": {
                    "enforce": True,
                    "max_day_trades_per_window": 3,
                    "window_sessions": 5,
                    "equity_threshold": 25000,
                    "on_limit_reached": "pause_entries",
                },
            },
            {
                "name": "Swing Daily 1d",
                "description": "Standard swing-trade controls — daily bars, no session restrictions.",
                "tags": ["swing"],
                "timeframe": "1d",
                "duration_mode": "swing",
                "market_hours": {},
            },
            {
                "name": "Position Weekly 1d",
                "description": "Long-horizon controls — daily bars, earnings blackout, weekend positions allowed.",
                "tags": ["position"],
                "timeframe": "1d",
                "duration_mode": "position",
                "earnings_blackout_enabled": True,
                "gap_risk": {
                    "earnings_blackout": True,
                    "earnings_blackout_days_before": 1,
                    "weekend_position_allowed": True,
                },
            },
        ]
        result = await db.execute(select(StrategyControls.name).where(StrategyControls.is_golden == True))  # noqa: E712
        existing_golden_gov = {row[0] for row in result.all()}
        for spec in _golden_controls:
            if spec["name"] in existing_golden_gov:
                continue
            db.add(StrategyControls(
                id=str(uuid.uuid4()),
                name=spec["name"],
                description=spec.get("description"),
                is_golden=True,
                tags=spec.get("tags", []),
                timeframe=spec.get("timeframe", "1d"),
                duration_mode=spec.get("duration_mode", "swing"),
                market_hours=spec.get("market_hours", {}),
                pdt=spec.get("pdt", {}),
                gap_risk=spec.get("gap_risk", {}),
                regime_filter=spec.get("regime_filter", {}),
                cooldown_rules=spec.get("cooldown_rules", []),
                earnings_blackout_enabled=spec.get("earnings_blackout_enabled", False),
                source_type="manual",
            ))
            logger.info(f"Seeded golden strategy controls: {spec['name']}")
        await db.commit()

        # ── Golden execution style templates ──────────────────────────────────
        _golden_styles = [
            {
                "name": "Bracket Market Entry",
                "description": "Market entry + bracket order (stop + limit TP). Default fill assumption: next open.",
                "tags": ["standard"],
                "entry_order_type": "market",
                "bracket_mode": "bracket",
                "stop_order_type": "market",
                "take_profit_order_type": "limit",
                "fill_model": "next_open",
            },
            {
                "name": "Limit Pullback Entry",
                "description": "Limit entry 0.5 ATR below trigger — cancel after 3 bars if unfilled.",
                "tags": ["limit"],
                "entry_order_type": "limit",
                "bracket_mode": "bracket",
                "entry_limit_offset_method": "atr",
                "entry_limit_offset_value": 0.5,
                "entry_cancel_after_bars": 3,
            },
            {
                "name": "Stop-Limit Breakout",
                "description": "Stop-limit entry for breakout confirmation — 0.1% offset above trigger.",
                "tags": ["breakout"],
                "entry_order_type": "stop_limit",
                "bracket_mode": "bracket",
                "entry_limit_offset_method": "pct",
                "entry_limit_offset_value": 0.1,
            },
            {
                "name": "Trailing Stop Exit",
                "description": "Market entry, trailing stop exit at 2% trail — no fixed TP.",
                "tags": ["trailing"],
                "entry_order_type": "market",
                "bracket_mode": "trailing_stop",
                "trailing_stop_type": "percent",
                "trailing_stop_value": 2.0,
            },
        ]
        result = await db.execute(select(ExecutionStyle.name).where(ExecutionStyle.is_golden == True))  # noqa: E712
        existing_golden_es = {row[0] for row in result.all()}
        for spec in _golden_styles:
            if spec["name"] in existing_golden_es:
                continue
            db.add(ExecutionStyle(
                id=str(uuid.uuid4()),
                name=spec["name"],
                description=spec.get("description"),
                is_golden=True,
                tags=spec.get("tags", []),
                entry_order_type=spec.get("entry_order_type", "market"),
                entry_time_in_force=spec.get("entry_time_in_force", "day"),
                entry_limit_offset_method=spec.get("entry_limit_offset_method"),
                entry_limit_offset_value=spec.get("entry_limit_offset_value"),
                entry_cancel_after_bars=spec.get("entry_cancel_after_bars"),
                bracket_mode=spec.get("bracket_mode", "bracket"),
                stop_order_type=spec.get("stop_order_type", "market"),
                take_profit_order_type=spec.get("take_profit_order_type", "limit"),
                trailing_stop_type=spec.get("trailing_stop_type"),
                trailing_stop_value=spec.get("trailing_stop_value"),
                scale_out=spec.get("scale_out", []),
                fill_model=spec.get("fill_model", "next_open"),
                slippage_bps_assumption=spec.get("slippage_bps_assumption", 5.0),
                commission_per_share=spec.get("commission_per_share", 0.005),
                source_type="manual",
            ))
            logger.info(f"Seeded golden execution style: {spec['name']}")
        await db.commit()

        result = await db.execute(select(RiskProfile.name).where(RiskProfile.is_golden == True))  # noqa: E712
        existing_golden_rp = {row[0] for row in result.all()}
        for spec in _golden_profiles:
            if spec["name"] in existing_golden_rp:
                continue
            db.add(RiskProfile(
                id=str(uuid.uuid4()),
                name=spec["name"],
                description=spec.get("description"),
                is_golden=True,
                tags=spec["tags"],
                max_open_positions_long=spec["max_open_positions_long"],
                max_open_positions_short=spec["max_open_positions_short"],
                max_daily_loss_pct=spec["max_daily_loss_pct"],
                max_drawdown_lockout_pct=spec["max_drawdown_lockout_pct"],
                max_leverage=spec["max_leverage"],
                max_portfolio_heat_long=spec["max_portfolio_heat_long"],
                max_portfolio_heat_short=spec["max_portfolio_heat_short"],
                max_position_size_pct_long=spec["max_position_size_pct_long"],
                max_position_size_pct_short=spec["max_position_size_pct_short"],
                max_correlated_exposure_long=spec["max_correlated_exposure_long"],
                max_correlated_exposure_short=spec["max_correlated_exposure_short"],
                source_type="manual",
            ))
            logger.info(f"Seeded golden risk profile: {spec['name']}")
        await db.commit()


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="UltraTrader 2026",
    version=settings.APP_VERSION,
    description="Production-grade algorithmic trading platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(strategies_router, prefix="/api/v1")
app.include_router(backtests_router, prefix="/api/v1")
app.include_router(accounts_router, prefix="/api/v1")
app.include_router(deployments_router, prefix="/api/v1")
app.include_router(data_router, prefix="/api/v1")
app.include_router(control_router, prefix="/api/v1")
app.include_router(events_router, prefix="/api/v1")
app.include_router(ml_router, prefix="/api/v1")
app.include_router(monitor_router, prefix="/api/v1")
app.include_router(optimizations_router, prefix="/api/v1")
app.include_router(universes_router, prefix="/api/v1")
app.include_router(bi_router, prefix="/api/v1")
app.include_router(backlog_router, prefix="/api/v1")
app.include_router(services_router, prefix="/api/v1")
app.include_router(programs_router, prefix="/api/v1")
app.include_router(watchlists_router, prefix="/api/v1")
app.include_router(simulations_router, prefix="/api/v1")
app.include_router(risk_profiles_router, prefix="/api/v1")
app.include_router(strategy_controls_router, prefix="/api/v1")
app.include_router(execution_styles_router, prefix="/api/v1")
app.include_router(governor_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/v1")

# Register simulation WebSocket directly on the app to avoid route collision
# with the /{simulation_id} catch-all pattern on the REST router.
from app.api.routes.simulations import simulation_websocket
app.websocket("/ws/simulation/{simulation_id}")(simulation_websocket)


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    from app.database import engine
    from sqlalchemy import text
    db_ok = False
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass
    return {"status": "ok" if db_ok else "degraded", "version": settings.APP_VERSION, "database": "connected" if db_ok else "error"}


@app.get("/api/v1/platform/info")
async def platform_info():
    from app.core.kill_switch import get_kill_switch
    ks = get_kill_switch()
    return {
        "service": "ultratrader-2026",
        "version": settings.APP_VERSION,
        "mode": settings.PLATFORM_MODE,
        "kill_switch_active": ks.is_globally_killed,
    }


# ── WebSocket for live updates ────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws) if hasattr(self.active, "discard") else None
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict):
        for ws in list(self.active):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(ws)


ws_manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Echo heartbeat
            await websocket.send_json({"type": "pong", "data": data})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)




@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logging.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
