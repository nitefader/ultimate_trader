"""Market event calendar endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.event import MarketEvent, EventFilter

router = APIRouter(prefix="/events", tags=["events"])


@router.get("")
async def list_events(
    symbol: str | None = None,
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(MarketEvent).order_by(MarketEvent.event_time)
    if symbol:
        q = q.where(MarketEvent.symbol == symbol)
    if category:
        q = q.where(MarketEvent.category == category)
    result = await db.execute(q)
    events = result.scalars().all()
    return [
        {
            "id": e.id,
            "name": e.name,
            "category": e.category,
            "symbol": e.symbol,
            "event_time": e.event_time.isoformat(),
            "impact": e.impact,
            "source": e.source,
        }
        for e in events
    ]


@router.post("")
async def create_event(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    event = MarketEvent(
        id=str(uuid.uuid4()),
        name=body["name"],
        category=body.get("category", "custom"),
        symbol=body.get("symbol"),
        event_time=datetime.fromisoformat(body["event_time"]),
        impact=body.get("impact", "high"),
        source="manual",
    )
    db.add(event)
    await db.flush()
    return {"id": event.id}


@router.post("/seed-sample")
async def seed_sample_events(db: AsyncSession = Depends(get_db)):
    """Seed some example macro events for demonstration."""
    sample_events = [
        {"name": "FOMC Rate Decision", "category": "fed", "event_time": "2024-01-31T19:00:00", "impact": "high"},
        {"name": "CPI Release", "category": "cpi", "event_time": "2024-02-13T13:30:00", "impact": "high"},
        {"name": "NFP Release", "category": "nfp", "event_time": "2024-02-02T13:30:00", "impact": "high"},
        {"name": "GDP Q4", "category": "gdp", "event_time": "2024-01-25T13:30:00", "impact": "medium"},
    ]
    created = []
    for e in sample_events:
        event = MarketEvent(
            id=str(uuid.uuid4()),
            name=e["name"],
            category=e["category"],
            event_time=datetime.fromisoformat(e["event_time"]),
            impact=e["impact"],
            source="seed",
        )
        db.add(event)
        created.append(event.id)
    await db.flush()
    return {"created": len(created)}


@router.get("/filters")
async def list_event_filters(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(EventFilter))
    filters = result.scalars().all()
    return [
        {
            "id": f.id,
            "strategy_version_id": f.strategy_version_id,
            "categories": f.categories,
            "impact_levels": f.impact_levels,
            "minutes_before": f.minutes_before,
            "minutes_after": f.minutes_after,
            "close_positions_before": f.close_positions_before,
            "disable_entries": f.disable_entries,
            "is_active": f.is_active,
        }
        for f in filters
    ]


@router.post("/filters")
async def create_event_filter(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    f = EventFilter(
        id=str(uuid.uuid4()),
        strategy_version_id=body["strategy_version_id"],
        categories=body.get("categories", ["fomc", "cpi", "nfp"]),
        impact_levels=body.get("impact_levels", ["high"]),
        minutes_before=body.get("minutes_before", 30),
        minutes_after=body.get("minutes_after", 30),
        close_positions_before=body.get("close_positions_before", False),
        disable_entries=body.get("disable_entries", True),
    )
    db.add(f)
    await db.flush()
    return {"id": f.id}
