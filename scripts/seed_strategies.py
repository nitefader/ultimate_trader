"""
Seed the database with the two sample strategies from the YAML configs.
Run from the backend directory: python ../scripts/seed_strategies.py
"""
import asyncio
import sys
import os
import glob
import yaml
import uuid

from sqlalchemy import select

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app.database import AsyncSessionLocal, create_all_tables
from app.models.strategy import Strategy, StrategyVersion


async def seed():
    await create_all_tables()

    configs_dir = os.path.join(os.path.dirname(__file__), '..', 'backend', 'configs', 'strategies')
    config_paths = sorted(glob.glob(os.path.join(configs_dir, '*.yaml')))

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Strategy.name))
        existing_names = {row[0] for row in result.all()}

        for path in config_paths:
            with open(path) as f:
                config = yaml.safe_load(f)

            name = config.get('name', os.path.basename(path))
            if name in existing_names:
                print(f"Skipping existing strategy: {name}")
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
            print(f"Added strategy: {strategy.name}")

        await db.commit()

    print("Seeding complete!")


if __name__ == '__main__':
    asyncio.run(seed())
