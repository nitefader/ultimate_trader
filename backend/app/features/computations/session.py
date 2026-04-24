"""Session-aware feature computations."""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.features.context.session_context import build_session_context
from app.services.earnings_calendar import EarningsCalendar, get_earnings_calendar
from app.services.market_calendar_service import MarketCalendarService, get_market_calendar_service


def compute_prev_day_levels(
    df: pd.DataFrame,
    calendar_service: MarketCalendarService | None = None,
) -> pd.DataFrame:
    context = build_session_context(df.index, calendar_service)
    day_keys = context.session_dates

    day_high = df["high"].groupby(day_keys).max().shift(1)
    day_low = df["low"].groupby(day_keys).min().shift(1)
    day_close = df["close"].groupby(day_keys).last().shift(1)

    return pd.DataFrame(
        {
            "prev_day_high": day_keys.map(day_high.to_dict()).astype(float),
            "prev_day_low": day_keys.map(day_low.to_dict()).astype(float),
            "prev_day_close": day_keys.map(day_close.to_dict()).astype(float),
        },
        index=df.index,
    )


def compute_prev_week_levels(
    df: pd.DataFrame,
    calendar_service: MarketCalendarService | None = None,
) -> pd.DataFrame:
    context = build_session_context(df.index, calendar_service)
    week_keys = context.week_keys

    week_high = df["high"].groupby(week_keys).max().shift(1)
    week_low = df["low"].groupby(week_keys).min().shift(1)
    week_close = df["close"].groupby(week_keys).last().shift(1)

    return pd.DataFrame(
        {
            "prev_week_high": week_keys.map(week_high.to_dict()).astype(float),
            "prev_week_low": week_keys.map(week_low.to_dict()).astype(float),
            "prev_week_close": week_keys.map(week_close.to_dict()).astype(float),
        },
        index=df.index,
    )


def compute_prev_month_levels(
    df: pd.DataFrame,
    calendar_service: MarketCalendarService | None = None,
) -> pd.DataFrame:
    context = build_session_context(df.index, calendar_service)
    month_keys = context.month_keys

    month_high = df["high"].groupby(month_keys).max().shift(1)
    month_low = df["low"].groupby(month_keys).min().shift(1)
    month_close = df["close"].groupby(month_keys).last().shift(1)

    return pd.DataFrame(
        {
            "prev_month_high": month_keys.map(month_high.to_dict()).astype(float),
            "prev_month_low": month_keys.map(month_low.to_dict()).astype(float),
            "prev_month_close": month_keys.map(month_close.to_dict()).astype(float),
        },
        index=df.index,
    )


def compute_session_state_features(
    df: pd.DataFrame,
    calendar_service: MarketCalendarService | None = None,
) -> pd.DataFrame:
    context = build_session_context(df.index, calendar_service)
    return pd.DataFrame(
        {
            "market_day_type": context.market_day_types.astype(str),
            "in_regular_session": context.in_regular_session.astype(float),
        },
        index=df.index,
    )


def compute_earnings_blackout_active(
    df: pd.DataFrame,
    *,
    symbol: str,
    earnings_calendar: EarningsCalendar | None = None,
    calendar_service: MarketCalendarService | None = None,
) -> pd.DataFrame:
    context = build_session_context(df.index, calendar_service)
    calendar = earnings_calendar or get_earnings_calendar()
    active = context.session_dates.map(
        lambda session_date: float(calendar.is_excluded(symbol, session_date))
    )
    return pd.DataFrame({"earnings_blackout_active": active.astype(float)}, index=df.index)


def compute_opening_range(
    df: pd.DataFrame,
    bars: int,
    calendar_service: MarketCalendarService | None = None,
) -> pd.DataFrame:
    service = calendar_service or get_market_calendar_service()
    context = build_session_context(df.index, service)
    opening_range_high = pd.Series(np.nan, index=df.index, dtype=float)
    opening_range_low = pd.Series(np.nan, index=df.index, dtype=float)

    if not isinstance(df.index, pd.DatetimeIndex) or bars <= 0:
        return pd.DataFrame({"opening_range_high": opening_range_high, "opening_range_low": opening_range_low}, index=df.index)

    regular_df = df.loc[context.in_regular_session]
    regular_dates = context.session_dates.loc[context.in_regular_session]
    for _session_date, session_df in regular_df.groupby(regular_dates, sort=False):
        if len(session_df) < bars:
            continue
        first_window = session_df.iloc[:bars]
        high_val = float(first_window["high"].max())
        low_val = float(first_window["low"].min())
        opening_range_high.loc[session_df.index[bars - 1:]] = high_val
        opening_range_low.loc[session_df.index[bars - 1:]] = low_val

    return pd.DataFrame(
        {"opening_range_high": opening_range_high, "opening_range_low": opening_range_low},
        index=df.index,
    )
