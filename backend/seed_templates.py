"""Seed 4 clean template strategies aligned with the architecture."""
import asyncio
import uuid
import sys
sys.path.insert(0, '.')


async def seed():
    from app.database import create_all_tables, AsyncSessionLocal
    await create_all_tables()
    from app.models.strategy import Strategy, StrategyVersion
    from sqlalchemy import select

    strategies_to_seed = [
        {
            "name": "EMA Crossover Breakout",
            "description": "Long-only entry when EMA 20 crosses above EMA 50 with volume confirmation. Signal only.",
            "category": "momentum",
            "tags": ["long_only", "ema", "breakout"],
            "config": {
                "hypothesis": "When the 20-period EMA crosses above the 50-period EMA with expanding volume, the short-term trend is reversing upward.",
                "entry": {
                    "directions": ["long"],
                    "conditions": [
                        {
                            "type": "single",
                            "left": {"indicator": "ema", "period": 20, "column": "ema_20"},
                            "op": ">",
                            "right": {"indicator": "ema", "period": 50, "column": "ema_50"},
                        },
                        {
                            "type": "single",
                            "left": {"field": "volume"},
                            "op": ">",
                            "right": {"indicator": "volume_sma_20"},
                        },
                    ],
                },
                "stop_loss": {"method": "fixed_pct", "value": 2.0},
                "targets": [{"method": "r_multiple", "r": 2.0}],
            },
        },
        {
            "name": "RSI Mean Reversion",
            "description": "Long-only mean reversion entry when RSI is oversold and price is above EMA 200. Signal only.",
            "category": "mean_reversion",
            "tags": ["long_only", "rsi", "mean_reversion"],
            "config": {
                "hypothesis": "When RSI-14 drops below 30 (oversold) while price remains above the EMA-200 (uptrend intact), a bounce is likely.",
                "entry": {
                    "directions": ["long"],
                    "conditions": [
                        {
                            "type": "single",
                            "left": {"indicator": "rsi", "period": 14},
                            "op": "<",
                            "right": 30,
                        },
                        {
                            "type": "single",
                            "left": {"field": "close"},
                            "op": ">",
                            "right": {"indicator": "ema", "period": 200, "column": "ema_200"},
                        },
                    ],
                },
                "stop_loss": {"method": "fixed_pct", "value": 1.5},
                "targets": [{"method": "r_multiple", "r": 2.5}],
            },
        },
        {
            "name": "VWAP Reclaim",
            "description": "Long-only entry when price reclaims VWAP with volume confirmation. ATR-based stop. Signal only.",
            "category": "momentum",
            "tags": ["long_only", "vwap", "intraday"],
            "config": {
                "hypothesis": "When price closes above VWAP with above-average volume, institutional order flow is supportive for continuation.",
                "entry": {
                    "directions": ["long"],
                    "conditions": [
                        {
                            "type": "single",
                            "left": {"field": "close"},
                            "op": ">",
                            "right": {"indicator": "vwap"},
                        },
                        {
                            "type": "single",
                            "left": {"field": "volume"},
                            "op": ">",
                            "right": {"indicator": "volume_sma_20"},
                        },
                    ],
                },
                "stop_loss": {"method": "atr_multiple", "period": 14, "multiplier": 1.5},
                "targets": [{"method": "r_multiple", "r": 2.0}],
            },
        },
        {
            "name": "Opening Range Breakout",
            "description": "Long-only breakout above the opening range high with volume surge confirmation. Signal only.",
            "category": "momentum",
            "tags": ["long_only", "breakout", "opening_range"],
            "config": {
                "hypothesis": "When price breaks above the opening range high with above-average volume, strong directional momentum is likely to continue.",
                "entry": {
                    "directions": ["long"],
                    "conditions": [
                        {
                            "type": "single",
                            "left": {"field": "close"},
                            "op": ">",
                            "right": {"indicator": "opening_range_high"},
                        },
                        {
                            "type": "single",
                            "left": {"field": "volume"},
                            "op": ">",
                            "right": {"indicator": "volume_sma_20"},
                        },
                    ],
                },
                "stop_loss": {"method": "fixed_pct", "value": 1.0},
                "targets": [{"method": "r_multiple", "r": 3.0}],
            },
        },
    ]

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Strategy.name))
        existing_names = {row[0] for row in result.all()}

        seeded = []
        for spec in strategies_to_seed:
            if spec["name"] in existing_names:
                print(f"SKIP (already exists): {spec['name']}")
                continue

            strategy = Strategy(
                id=str(uuid.uuid4()),
                name=spec["name"],
                description=spec["description"],
                category=spec["category"],
                tags=spec["tags"],
                status="active",
            )
            db.add(strategy)

            version = StrategyVersion(
                id=str(uuid.uuid4()),
                strategy_id=strategy.id,
                version=1,
                config=spec["config"],
                notes="Golden template strategy — signal only, no sizing or session rules",
                duration_mode="swing",
                promotion_status="backtest_only",
            )
            db.add(version)
            seeded.append(spec["name"])

        await db.commit()
        for name in seeded:
            print(f"Seeded: {name}")
        print(f"Done. {len(seeded)} strategies seeded.")


if __name__ == "__main__":
    asyncio.run(seed())
