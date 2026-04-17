#!/usr/bin/env python3
"""Seed the `data_inventory` DB table from existing parquet cache files.

Run this from the `backend` folder using the project's virtualenv.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pandas as pd

from app.config import get_settings
from app.database import create_all_tables, AsyncSessionLocal
from app.services.market_data_service import upsert_inventory_db


async def seed() -> None:
    settings = get_settings()
    cache_dir = Path(settings.CACHE_DIR)
    if not cache_dir.exists():
        print(f"Cache directory does not exist: {cache_dir}")
        return

    print(f"Seeding DB from cache dir: {cache_dir}")
    await create_all_tables()

    files = sorted(list(cache_dir.glob("*.parquet")))
    if not files:
        print("No parquet files found in cache directory.")
        return

    async with AsyncSessionLocal() as db:
        upserted = 0
        for f in files:
            stem = f.stem
            provider = "yfinance"
            if stem.endswith("_alpaca"):
                provider = "alpaca"
                stem = stem[: -len("_alpaca")]

            parts = stem.rsplit("_", 1)
            if len(parts) != 2:
                print(f"Skipping file with unexpected name: {f.name}")
                continue
            symbol, timeframe = parts

            try:
                df = pd.read_parquet(f)
                if df is None or df.empty:
                    print(f"Skipping empty file: {f.name}")
                    continue
                idx = pd.to_datetime(df.index)
                first_date = str(idx[0].date())
                last_date = str(idx[-1].date())
                bar_count = len(df)

                await upsert_inventory_db(
                    db,
                    symbol=symbol.upper(),
                    timeframe=timeframe,
                    provider=provider,
                    file_path=str(f.resolve()),
                    first_date=first_date,
                    last_date=last_date,
                    bar_count=bar_count,
                )
                upserted += 1
                print(f"Upserted: {symbol.upper()} {timeframe} ({provider}) — {bar_count} bars")
            except Exception as exc:
                print(f"Failed to process {f.name}: {exc}")

        print(f"Done. Upserted {upserted} cache files into data_inventory.")


if __name__ == "__main__":
    try:
        asyncio.run(seed())
    except KeyboardInterrupt:
        sys.exit(1)
