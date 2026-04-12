"""Pytest configuration and shared fixtures."""
import asyncio
import os
from pathlib import Path
import tempfile
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# Ensure tests use an isolated sqlite database file and test env config.
_tmp_db_dir = Path(tempfile.mkdtemp(prefix="ultratrader_tests_"))
os.environ.setdefault("ENV", "test")
os.environ.setdefault("PLATFORM_MODE", "backtest")
os.environ.setdefault("DEBUG", "false")
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{_tmp_db_dir / 'test.db'}")

from app.main import app
from app.database import AsyncSessionLocal


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def client():
    # Ensure tables exist for the isolated test DB (httpx ASGITransport in this repo
    # does not run FastAPI lifespan hooks).
    from app.database import create_all_tables
    await create_all_tables()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def db():
    """
    Provide a direct DB session for tests that need to seed records without going through the API.
    """
    async with AsyncSessionLocal() as session:
        yield session


async def seed_fake_credentials(client, account_id: str, mode: str = "paper"):
    """Set fake Alpaca API credentials on a test account so deployment promotion passes."""
    r = await client.put(
        f"/api/v1/accounts/{account_id}/credentials",
        json={
            "broker_config": {
                mode: {
                    "api_key": "FAKEPK00000000000000",
                    "secret_key": "fakesecret0000000000000000000000000000000",
                }
            }
        },
    )
    assert r.status_code == 200, f"seed_fake_credentials failed: {r.text}"
