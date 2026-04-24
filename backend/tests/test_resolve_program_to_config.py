"""Tests for resolve_program_to_config — the program-based backtest path (Phase 5)."""
from __future__ import annotations

import uuid
import pytest

from app.database import AsyncSessionLocal
from app.models.strategy import Strategy, StrategyVersion
from app.models.trading_program import TradingProgram
from app.models.watchlist import Watchlist, WatchlistMembership
from app.models.strategy_governor import StrategyControls as StrategyGovernor
from app.models.execution_style import ExecutionStyle
from app.models.risk_profile import RiskProfile
from app.services.backtest_service import resolve_program_to_config


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_strategy_version(
    strategy_id: str,
    config: dict | None = None,
) -> tuple[Strategy, StrategyVersion]:
    s = Strategy(
        id=strategy_id,
        name=f"Test Strategy {strategy_id[:8]}",
        category="momentum",
        status="active",
        tags=[],
    )
    sv = StrategyVersion(
        id=str(uuid.uuid4()),
        strategy_id=strategy_id,
        version=1,
        config=config or {
            "hypothesis": "EMA crossover test",
            "entry": {
                "directions": ["long"],
                "conditions": [
                    {
                        "type": "single",
                        "left": {"field": "close"},
                        "op": ">",
                        "right": {"indicator": "ema", "period": 20},
                    }
                ],
            },
            "stop_loss": {"method": "fixed_pct", "value": 2.0},
            "targets": [{"method": "r_multiple", "r": 2.0}],
        },
        notes="Test version",
        duration_mode="swing",
        promotion_status="backtest_only",
    )
    return s, sv


# ── tests ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_program_not_found():
    """resolve_program_to_config raises ValueError if program_id does not exist."""
    from app.database import create_all_tables
    await create_all_tables()

    async with AsyncSessionLocal() as db:
        with pytest.raises(ValueError, match="not found"):
            await resolve_program_to_config("nonexistent-program-id", db)


@pytest.mark.asyncio
async def test_resolve_program_no_strategy_version():
    """resolve_program_to_config raises ValueError if program has no strategy_version_id."""
    from app.database import create_all_tables
    await create_all_tables()

    prog_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        prog = TradingProgram(
            id=prog_id,
            name="No Strategy Program",
            status="draft",
            strategy_version_id=None,
        )
        db.add(prog)
        await db.commit()

    async with AsyncSessionLocal() as db:
        with pytest.raises(ValueError, match="no strategy version"):
            await resolve_program_to_config(prog_id, db)


@pytest.mark.asyncio
async def test_resolve_program_minimal():
    """
    A program with only a strategy version attached resolves to the strategy config.
    Symbols fall back to config['symbols'] if no watchlists attached.
    """
    from app.database import create_all_tables
    await create_all_tables()

    strat_id = str(uuid.uuid4())
    prog_id = str(uuid.uuid4())

    strategy_config = {
        "hypothesis": "Simple EMA test",
        "entry": {
            "directions": ["long"],
            "conditions": [
                {
                    "type": "single",
                    "left": {"field": "close"},
                    "op": ">",
                    "right": {"indicator": "ema", "period": 20},
                }
            ],
        },
        "stop_loss": {"method": "fixed_pct", "value": 2.0},
        "targets": [{"method": "r_multiple", "r": 2.0}],
        "symbols": ["SPY", "QQQ"],
    }

    async with AsyncSessionLocal() as db:
        s, sv = _make_strategy_version(strat_id, config=strategy_config)
        db.add(s)
        db.add(sv)
        prog = TradingProgram(
            id=prog_id,
            name="Minimal Program",
            status="draft",
            strategy_version_id=sv.id,
        )
        db.add(prog)
        await db.commit()

    async with AsyncSessionLocal() as db:
        sv_id, config, symbols = await resolve_program_to_config(prog_id, db)

    assert sv_id is not None, "strategy_version_id must be returned"
    assert isinstance(config, dict), "config must be a dict"
    assert "entry" in config, "config must include entry block"
    assert "stop_loss" in config, "config must include stop_loss block"
    assert "targets" in config, "config must include targets list"
    assert symbols == ["SPY", "QQQ"], "symbols should fall back to config['symbols']"


@pytest.mark.asyncio
async def test_resolve_program_with_all_five_components():
    """
    A program with all 5 components (strategy, governor, execution style,
    risk profile, watchlist) resolves to a merged config with correct fields.
    """
    from app.database import create_all_tables
    await create_all_tables()

    strat_id = str(uuid.uuid4())
    gov_id = str(uuid.uuid4())
    style_id = str(uuid.uuid4())
    rp_id = str(uuid.uuid4())
    wl_id = str(uuid.uuid4())
    prog_id = str(uuid.uuid4())

    strategy_config = {
        "hypothesis": "Full 5-component test",
        "entry": {
            "directions": ["long"],
            "conditions": [
                {
                    "type": "single",
                    "left": {"field": "close"},
                    "op": ">",
                    "right": {"indicator": "vwap"},
                }
            ],
        },
        "stop_loss": {"method": "fixed_pct", "value": 1.5},
        "targets": [{"method": "r_multiple", "r": 2.5}],
    }

    async with AsyncSessionLocal() as db:
        # Strategy + Version
        s, sv = _make_strategy_version(strat_id, config=strategy_config)
        db.add(s)
        db.add(sv)

        # Strategy Governor
        gov = StrategyGovernor(
            id=gov_id,
            name="Test Governor",
            timeframe="1d",
            duration_mode="swing",
            market_hours={"force_flat_by": "15:45"},
            source_type="manual",
        )
        db.add(gov)

        # Execution Style
        style = ExecutionStyle(
            id=style_id,
            name="Test Style",
            entry_order_type="market",
            bracket_mode="bracket",
            stop_order_type="market",
            take_profit_order_type="limit",
            fill_model="next_open",
            slippage_bps_assumption=5.0,
            commission_per_share=0.005,
            source_type="manual",
        )
        db.add(style)

        # Risk Profile
        rp = RiskProfile(
            id=rp_id,
            name="Test Risk Profile",
            max_open_positions_long=5,
            max_open_positions_short=2,
            max_daily_loss_pct=0.03,
            max_drawdown_lockout_pct=0.10,
            max_leverage=1.5,
            max_portfolio_heat_long=0.06,
            max_portfolio_heat_short=0.04,
            max_position_size_pct_long=0.10,
            max_position_size_pct_short=0.08,
            max_correlated_exposure_long=1.0,
            max_correlated_exposure_short=0.8,
            source_type="manual",
        )
        db.add(rp)

        # Watchlist with symbols
        wl = Watchlist(
            id=wl_id,
            name="Test Watchlist",
            watchlist_type="manual",
        )
        db.add(wl)
        await db.flush()

        import datetime as _dt
        _now = _dt.datetime.now(_dt.timezone.utc)
        for sym in ["AAPL", "MSFT", "NVDA"]:
            db.add(WatchlistMembership(
                id=str(uuid.uuid4()),
                watchlist_id=wl_id,
                symbol=sym,
                state="active",
                resolved_at=_now,
                active_since=_now,
            ))

        # Program with all 5 components
        prog = TradingProgram(
            id=prog_id,
            name="Full 5-Component Program",
            status="draft",
            strategy_version_id=sv.id,
            strategy_governor_id=gov_id,
            execution_style_id=style_id,
            risk_profile_id=rp_id,
            watchlist_subscriptions=[wl_id],
        )
        db.add(prog)
        await db.commit()

    async with AsyncSessionLocal() as db:
        sv_id, config, symbols = await resolve_program_to_config(prog_id, db)

    # Strategy fields
    assert sv_id is not None
    assert "entry" in config
    assert "stop_loss" in config
    assert "targets" in config

    # Governor overlay
    assert config.get("timeframe") == "1d", "governor should set timeframe"
    assert config.get("duration_mode") == "swing", "governor should set duration_mode"
    assert "market_hours" in config, "governor should add market_hours"

    # Execution style overlay
    assert "entry_module" in config, "execution style should add entry_module"
    assert config["entry_module"]["order_type"] == "market"
    assert config["entry_module"]["bracket_mode"] == "bracket"
    assert "fill_model" in config

    # Risk profile overlay
    assert "position_sizing" in config, "risk profile should add position_sizing"
    assert config["position_sizing"]["method"] == "risk_pct"
    assert "risk" in config
    assert config["risk"]["max_daily_loss_pct"] == pytest.approx(0.03)
    assert config["risk"]["max_open_positions"] == 5

    # Watchlist symbols
    assert set(symbols) == {"AAPL", "MSFT", "NVDA"}, "symbols should come from watchlist"
