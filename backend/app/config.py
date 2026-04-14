"""
Platform configuration — environment-aware, cloud-ready.
SQLite by default; switch to PostgreSQL via DATABASE_URL env var.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Application ────────────────────────────────────────────────────────────
    APP_NAME: str = "UltraTrader 2026"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    # Set SQL_ECHO=true to enable per-statement SQLAlchemy logging (very noisy).
    # Intentionally separate from DEBUG so you can run DEBUG without log flooding.
    SQL_ECHO: bool = False
    SECRET_KEY: str = "change-me-in-production-use-a-long-random-string"
    ENV: Literal["dev", "test", "prod"] = "dev"

    # ── Database ───────────────────────────────────────────────────────────────
    DATABASE_URL: str = "sqlite+aiosqlite:///./ultratrader.db"
    # For PostgreSQL:  postgresql+asyncpg://user:pass@host:5432/ultratrader

    # ── Data storage ───────────────────────────────────────────────────────────
    DATA_DIR: Path = Path("./data")
    CACHE_DIR: Path = Path("./data/cache")
    MODELS_DIR: Path = Path("./data/models")
    LOGS_DIR: Path = Path("./logs")

    # ── CORS ───────────────────────────────────────────────────────────────────
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000", "http://localhost:80"]

    # ── Broker defaults (paper) ────────────────────────────────────────────────
    DEFAULT_PAPER_BALANCE: float = 100_000.0
    DEFAULT_COMMISSION_PER_SHARE: float = 0.005
    DEFAULT_SLIPPAGE_TICKS: int = 1

    # ── Security ──────────────────────────────────────────────────────────────
    ENCRYPTION_KEY: str = "default-encryption-key-change-in-production"

    # ── Mode ───────────────────────────────────────────────────────────────────
    PLATFORM_MODE: Literal["backtest", "paper", "live"] = "backtest"

    @field_validator("DEBUG", mode="before")
    @classmethod
    def _parse_debug(cls, v):  # noqa: ANN001
        """
        Accept common non-boolean env values (e.g. DEBUG=release) without crashing.
        """
        if isinstance(v, bool):
            return v
        if v is None:
            return False
        if isinstance(v, (int, float)):
            return bool(v)
        s = str(v).strip().lower()
        if s in {"1", "true", "t", "yes", "y", "on", "debug"}:
            return True
        if s in {"0", "false", "f", "no", "n", "off", "release", "prod", "production"}:
            return False
        # Fallback: anything unknown is treated as False to keep boot predictable.
        return False

    def model_post_init(self, __context):  # noqa: ANN001
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self.MODELS_DIR.mkdir(parents=True, exist_ok=True)
        self.LOGS_DIR.mkdir(parents=True, exist_ok=True)
        
        # Validate required production settings
        # Fail fast for real-money mode (or explicit prod env) even if ENV is misconfigured.
        must_be_strong = (self.ENV == "prod") or (self.PLATFORM_MODE == "live")
        if must_be_strong and (not self.DEBUG) and len(self.SECRET_KEY) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters in production/live mode")
        if must_be_strong and self.SECRET_KEY.startswith("change-me-"):
            raise ValueError("SECRET_KEY is not set (still using default placeholder)")
        if len(self.ENCRYPTION_KEY) < 16:
            raise ValueError("ENCRYPTION_KEY must be at least 16 characters")
        if (not self.DEBUG) and self.ENCRYPTION_KEY.startswith("default-encryption-key"):
            raise ValueError(
                "ENCRYPTION_KEY is set to the default placeholder. "
                "Set a unique ENCRYPTION_KEY env var before starting the server outside DEBUG mode."
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
