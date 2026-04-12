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
from app.api.routes.bi import router as bi_router
from app.api.routes.backlog import router as backlog_router
from app.api.routes.services import router as services_router

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
    ]

    async with engine.begin() as conn:
        for table, column, col_type in migrations:
            try:
                await conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
                )
                logger.info(f"Migration: added {table}.{column}")
            except Exception:
                # Column already exists — this is expected on subsequent startups
                pass


async def lifespan(app: FastAPI):
    # Startup
    await create_all_tables()
    await _run_schema_migrations()
    await seed_default_data()
    await _restore_kill_switch_state()
    from app.services.paper_broker import start_paper_broker_loop
    start_paper_broker_loop()
    yield
    # Shutdown (graceful)
    from app.services.paper_broker import stop_paper_broker_loop
    stop_paper_broker_loop()


async def _restore_kill_switch_state():
    """Reload halted accounts from DB into the in-memory kill switch on startup."""
    from app.database import AsyncSessionLocal
    from app.models.account import Account
    from app.core.kill_switch import get_kill_switch
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Account).where(Account.is_killed == True))
        halted = result.scalars().all()
        ks = get_kill_switch()
        for account in halted:
            ks.kill_account(account.id, account.kill_reason or "restored_on_startup", triggered_by="system")
        if halted:
            logger.info("Kill switch: restored %d halted account(s) from DB on startup", len(halted))


async def seed_default_data():
    """Create default paper account and seed sample strategies on first run."""
    from app.database import AsyncSessionLocal
    from app.models.account import Account
    from app.models.strategy import Strategy, StrategyVersion
    from sqlalchemy import select
    import uuid
    import os
    import glob
    import yaml
    
    async with AsyncSessionLocal() as db:
        # Seed default paper account
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
        
        # Seed sample strategies from YAML configs
        result = await db.execute(select(Strategy.name))
        existing_names = {row[0] for row in result.all()}
        
        configs_dir = os.path.join(os.path.dirname(__file__), '..', 'configs', 'strategies')
        if os.path.exists(configs_dir):
            config_paths = sorted(glob.glob(os.path.join(configs_dir, '*.yaml')))
            for path in config_paths:
                try:
                    with open(path) as f:
                        config = yaml.safe_load(f)
                    if not config:
                        continue
                    
                    name = config.get('name', os.path.basename(path))
                    if name in existing_names:
                        continue
                    
                    strategy = Strategy(
                        id=str(uuid.uuid4()),
                        name=name,
                        description=config.get('description', '').strip(),
                        category=config.get('category', 'custom'),
                        status='active',
                    )
                    db.add(strategy)
                    
                    version = StrategyVersion(
                        id=str(uuid.uuid4()),
                        strategy_id=strategy.id,
                        version=1,
                        config=config,
                        notes='Sample strategy — loaded from YAML',
                        promotion_status='backtest_only',
                    )
                    db.add(version)
                    existing_names.add(name)
                    logger.info(f"Seeded strategy: {name}")
                except Exception as exc:
                    logger.warning(f"Failed to seed strategy from {path}: {exc}")
            
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
app.include_router(bi_router, prefix="/api/v1")
app.include_router(backlog_router, prefix="/api/v1")
app.include_router(services_router, prefix="/api/v1")


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}


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


# ── Global exception handler ──────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logging.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
