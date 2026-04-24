"""Session-aware context for feature computation."""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from app.services.market_calendar_service import MarketCalendarService, get_market_calendar_service


@dataclass(frozen=True)
class SessionContext:
    session_dates: pd.Series
    week_keys: pd.Series
    month_keys: pd.Series
    market_day_types: pd.Series
    in_regular_session: pd.Series


def build_session_context(
    index: pd.Index,
    calendar_service: MarketCalendarService | None = None,
) -> SessionContext:
    service = calendar_service or get_market_calendar_service()
    return SessionContext(
        session_dates=service.session_date_series(index),
        week_keys=service.week_key_series(index),
        month_keys=service.month_key_series(index),
        market_day_types=service.market_day_type_series(index),
        in_regular_session=service.in_regular_session_series(index),
    )
