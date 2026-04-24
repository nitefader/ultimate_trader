"""
Seed golden watchlist and risk profile templates.

Run from the backend directory:
    python -m scripts.seed_golden_templates
"""
from __future__ import annotations

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import AsyncSessionLocal
from app.models.watchlist import Watchlist, WatchlistMembership
from app.models.risk_profile import RiskProfile


GOLDEN_WATCHLISTS = [
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

GOLDEN_RISK_PROFILES = [
    {
        "name": "Day Trader — Conservative",
        "description": "Tight intraday risk: max 3 long positions, 2% daily loss limit, 5% drawdown lockout.",
        "tags": ["day_trading"],
        "max_open_positions_long": 3,
        "max_open_positions_short": 1,
        "max_daily_loss_pct": 0.02,
        "max_drawdown_lockout_pct": 0.05,
        "max_leverage": 1.0,
        "max_portfolio_heat_long": 0.04,
        "max_portfolio_heat_short": 0.02,
        "max_position_size_pct_long": 0.08,
        "max_position_size_pct_short": 0.05,
        "max_correlated_exposure_long": 0.8,
        "max_correlated_exposure_short": 0.5,
    },
    {
        "name": "Swing Trader — Standard",
        "description": "Balanced swing parameters: max 5 long / 2 short, 3% daily loss, 10% drawdown lockout.",
        "tags": ["swing"],
        "max_open_positions_long": 5,
        "max_open_positions_short": 2,
        "max_daily_loss_pct": 0.03,
        "max_drawdown_lockout_pct": 0.10,
        "max_leverage": 1.5,
        "max_portfolio_heat_long": 0.06,
        "max_portfolio_heat_short": 0.04,
        "max_position_size_pct_long": 0.10,
        "max_position_size_pct_short": 0.08,
        "max_correlated_exposure_long": 1.0,
        "max_correlated_exposure_short": 0.8,
    },
    {
        "name": "Swing Trader — Aggressive",
        "description": "Higher exposure swing: max 8 long / 3 short, 5% daily loss, 15% drawdown lockout, 1.5x leverage.",
        "tags": ["swing"],
        "max_open_positions_long": 8,
        "max_open_positions_short": 3,
        "max_daily_loss_pct": 0.05,
        "max_drawdown_lockout_pct": 0.15,
        "max_leverage": 1.5,
        "max_portfolio_heat_long": 0.08,
        "max_portfolio_heat_short": 0.05,
        "max_position_size_pct_long": 0.12,
        "max_position_size_pct_short": 0.10,
        "max_correlated_exposure_long": 1.2,
        "max_correlated_exposure_short": 0.9,
    },
    {
        "name": "Position Trader",
        "description": "Long-horizon positions: max 10 long / 3 short, 8% daily loss, 20% drawdown lockout.",
        "tags": ["position"],
        "max_open_positions_long": 10,
        "max_open_positions_short": 3,
        "max_daily_loss_pct": 0.08,
        "max_drawdown_lockout_pct": 0.20,
        "max_leverage": 1.0,
        "max_portfolio_heat_long": 0.10,
        "max_portfolio_heat_short": 0.06,
        "max_position_size_pct_long": 0.15,
        "max_position_size_pct_short": 0.10,
        "max_correlated_exposure_long": 1.5,
        "max_correlated_exposure_short": 1.0,
    },
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        # Seed golden watchlists
        for spec in GOLDEN_WATCHLISTS:
            from sqlalchemy import select
            result = await db.execute(
                select(Watchlist).where(Watchlist.name == spec["name"], Watchlist.is_golden == True)  # noqa: E712
            )
            existing = result.scalar_one_or_none()
            if existing:
                print(f"  watchlist already exists: {spec['name']}")
                continue
            wl = Watchlist(
                name=spec["name"],
                watchlist_type="manual",
                is_golden=True,
                tags=spec["tags"],
            )
            db.add(wl)
            await db.flush()
            for symbol in spec["symbols"]:
                db.add(WatchlistMembership(
                    watchlist_id=wl.id,
                    symbol=symbol,
                    state="active",
                ))
            print(f"  created watchlist: {spec['name']} ({len(spec['symbols'])} symbols)")

        # Seed golden risk profiles
        for spec in GOLDEN_RISK_PROFILES:
            from sqlalchemy import select
            result = await db.execute(
                select(RiskProfile).where(RiskProfile.name == spec["name"], RiskProfile.is_golden == True)  # noqa: E712
            )
            existing = result.scalar_one_or_none()
            if existing:
                print(f"  risk profile already exists: {spec['name']}")
                continue
            profile = RiskProfile(
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
            )
            db.add(profile)
            print(f"  created risk profile: {spec['name']}")

        await db.commit()
        print("Done.")


if __name__ == "__main__":
    asyncio.run(seed())
