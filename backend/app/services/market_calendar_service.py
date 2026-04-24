"""Market calendar authority for session-aware feature computation."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time
from zoneinfo import ZoneInfo

import pandas as pd

_ET = ZoneInfo("America/New_York")

_US_MARKET_HOLIDAYS = {
    date(2024, 1, 1), date(2024, 1, 15), date(2024, 2, 19), date(2024, 3, 29),
    date(2024, 5, 27), date(2024, 6, 19), date(2024, 7, 4), date(2024, 9, 2),
    date(2024, 11, 28), date(2024, 12, 25),
    date(2025, 1, 1), date(2025, 1, 20), date(2025, 2, 17), date(2025, 4, 18),
    date(2025, 5, 26), date(2025, 6, 19), date(2025, 7, 4), date(2025, 9, 1),
    date(2025, 11, 27), date(2025, 12, 25),
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3),
    date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7),
    date(2026, 11, 26), date(2026, 12, 25),
}
_US_MARKET_HALF_DAYS = {
    date(2024, 7, 3), date(2024, 11, 29), date(2024, 12, 24),
    date(2025, 11, 28), date(2025, 12, 24),
    date(2026, 11, 27), date(2026, 12, 24),
}


@dataclass(frozen=True)
class MarketCalendarService:
    timezone: ZoneInfo = _ET
    regular_open: time = time(9, 30)
    regular_close: time = time(16, 0)
    half_day_close: time = time(13, 0)

    def trading_day_type(self, session_date: date) -> str:
        if session_date.weekday() >= 5:
            return "weekend"
        if session_date in _US_MARKET_HOLIDAYS:
            return "holiday"
        if session_date in _US_MARKET_HALF_DAYS:
            return "half_day"
        return "regular"

    def close_time_for(self, session_date: date) -> time:
        return self.half_day_close if self.trading_day_type(session_date) == "half_day" else self.regular_close

    def session_timestamp_index(self, index: pd.Index) -> pd.DatetimeIndex:
        dt_index = pd.DatetimeIndex(pd.to_datetime(index, utc=True))
        return dt_index.tz_convert(self.timezone)

    def session_date_series(self, index: pd.Index) -> pd.Series:
        session_index = self.session_timestamp_index(index)
        return pd.Series(session_index.date, index=index)

    def week_key_series(self, index: pd.Index) -> pd.Series:
        session_index = self.session_timestamp_index(index)
        return pd.Series(session_index.to_period("W-FRI"), index=index)

    def month_key_series(self, index: pd.Index) -> pd.Series:
        session_index = self.session_timestamp_index(index)
        return pd.Series(session_index.to_period("M"), index=index)

    def market_day_type_series(self, index: pd.Index) -> pd.Series:
        session_dates = self.session_date_series(index)
        return session_dates.map(self.trading_day_type)

    def in_regular_session_series(self, index: pd.Index) -> pd.Series:
        session_index = self.session_timestamp_index(index)
        session_dates = self.session_date_series(index)
        day_types = self.market_day_type_series(index)
        times = pd.Series(session_index.time, index=index)
        closes = session_dates.map(self.close_time_for)
        return day_types.isin({"regular", "half_day"}) & (times >= self.regular_open) & (times <= closes)


_default_service = MarketCalendarService()


def get_market_calendar_service() -> MarketCalendarService:
    return _default_service
