"""
Database setup — SQLite locally, PostgreSQL in cloud.
Uses async SQLAlchemy with a single session factory.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

_connect_args = {}
_is_sqlite = "sqlite" in settings.DATABASE_URL

if _is_sqlite:
    _connect_args = {
        "check_same_thread": False,
        "timeout": 30,  # seconds before sqlite3 raises OperationalError: database is locked
    }

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.SQL_ECHO,
    connect_args=_connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_all_tables() -> None:
    """Create all tables and configure DB pragmas — used on startup."""
    # Import all models so they register with Base.metadata
    import app.models  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if _is_sqlite:
            # WAL mode: allows concurrent reads during long write transactions
            # (prevents "database is locked" during backtest runs).
            await conn.execute(text("PRAGMA journal_mode=WAL"))
            await conn.execute(text("PRAGMA synchronous=NORMAL"))
            await conn.execute(text("PRAGMA busy_timeout=30000"))
