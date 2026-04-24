from __future__ import annotations

from datetime import date

import pandas as pd

from app.features.computations.session import (
    compute_earnings_blackout_active,
    compute_opening_range,
    compute_prev_day_levels,
    compute_prev_month_levels,
    compute_prev_week_levels,
    compute_session_state_features,
)
from app.features.context.session_context import build_session_context
from app.services.earnings_calendar import EarningsCalendar
from app.services.market_calendar_service import get_market_calendar_service


def test_session_context_marks_half_day_and_regular_session_window() -> None:
    idx = pd.to_datetime(
        [
            "2024-11-29 14:00:00+00:00",
            "2024-11-29 15:30:00+00:00",
            "2024-11-29 18:30:00+00:00",
        ],
        utc=True,
    )

    context = build_session_context(idx)

    assert list(context.market_day_types) == ["half_day", "half_day", "half_day"]
    assert list(context.in_regular_session) == [False, True, False]


def test_market_calendar_service_marks_holiday_and_weekend() -> None:
    service = get_market_calendar_service()

    assert service.trading_day_type(date(2024, 7, 4)) == "holiday"
    assert service.trading_day_type(date(2024, 7, 6)) == "weekend"
    assert service.trading_day_type(date(2024, 7, 5)) == "regular"


def test_compute_opening_range_ignores_premarket_and_half_day_close() -> None:
    idx = pd.to_datetime(
        [
            "2024-11-29 14:00:00+00:00",
            "2024-11-29 14:30:00+00:00",
            "2024-11-29 14:35:00+00:00",
            "2024-11-29 14:40:00+00:00",
            "2024-11-29 18:30:00+00:00",
        ],
        utc=True,
    )
    df = pd.DataFrame(
        {
            "open": [99, 100, 101, 102, 103],
            "high": [100, 101, 105, 103, 104],
            "low": [98, 99, 100, 101, 102],
            "close": [99.5, 100.5, 104.0, 102.5, 103.5],
            "volume": [50, 100, 110, 120, 90],
        },
        index=idx,
    )

    opening_range = compute_opening_range(df, bars=2)

    assert pd.isna(opening_range.iloc[0]["opening_range_high"])
    assert pd.isna(opening_range.iloc[1]["opening_range_high"])
    assert opening_range.iloc[2]["opening_range_high"] == 105.0
    assert opening_range.iloc[2]["opening_range_low"] == 99.0
    assert pd.isna(opening_range.iloc[4]["opening_range_high"])


def test_prev_day_and_prev_week_levels_respect_trading_sessions() -> None:
    idx = pd.to_datetime(
        [
            "2024-07-03 14:30:00+00:00",
            "2024-07-03 16:00:00+00:00",
            "2024-07-05 14:30:00+00:00",
            "2024-07-08 14:30:00+00:00",
        ],
        utc=True,
    )
    df = pd.DataFrame(
        {
            "open": [10, 11, 20, 30],
            "high": [11, 12, 21, 31],
            "low": [9, 10, 19, 29],
            "close": [10, 11, 20, 30],
            "volume": [100, 100, 100, 100],
        },
        index=idx,
    )

    prev_day = compute_prev_day_levels(df)
    prev_week = compute_prev_week_levels(df)

    assert pd.isna(prev_day.iloc[0]["prev_day_high"])
    assert prev_day.iloc[2]["prev_day_high"] == 12.0
    assert prev_day.iloc[2]["prev_day_low"] == 9.0
    assert prev_day.iloc[2]["prev_day_close"] == 11.0
    assert prev_week.iloc[3]["prev_week_high"] == 21.0
    assert prev_week.iloc[3]["prev_week_low"] == 9.0
    assert prev_week.iloc[3]["prev_week_close"] == 20.0


def test_prev_month_levels_roll_only_after_completed_month() -> None:
    idx = pd.to_datetime(
        [
            "2024-06-28 14:30:00+00:00",
            "2024-07-01 14:30:00+00:00",
            "2024-07-15 14:30:00+00:00",
        ],
        utc=True,
    )
    df = pd.DataFrame(
        {
            "open": [10, 20, 30],
            "high": [11, 21, 31],
            "low": [9, 19, 29],
            "close": [10, 20, 30],
            "volume": [100, 100, 100],
        },
        index=idx,
    )

    prev_month = compute_prev_month_levels(df)

    assert pd.isna(prev_month.iloc[0]["prev_month_high"])
    assert prev_month.iloc[1]["prev_month_high"] == 11.0
    assert prev_month.iloc[1]["prev_month_low"] == 9.0
    assert prev_month.iloc[1]["prev_month_close"] == 10.0
    assert prev_month.iloc[2]["prev_month_high"] == 11.0


def test_session_state_features_expose_day_type_and_regular_session_flag() -> None:
    idx = pd.to_datetime(
        [
            "2024-11-29 14:00:00+00:00",
            "2024-11-29 15:30:00+00:00",
        ],
        utc=True,
    )
    df = pd.DataFrame(
        {
            "open": [99, 100],
            "high": [100, 101],
            "low": [98, 99],
            "close": [99.5, 100.5],
            "volume": [50, 100],
        },
        index=idx,
    )

    state = compute_session_state_features(df)

    assert list(state["market_day_type"]) == ["half_day", "half_day"]
    assert list(state["in_regular_session"]) == [0.0, 1.0]


def test_earnings_blackout_active_marks_bars_in_exclusion_window() -> None:
    idx = pd.to_datetime(
        [
            "2024-07-29 14:30:00+00:00",
            "2024-07-31 14:30:00+00:00",
            "2024-08-02 14:30:00+00:00",
            "2024-08-05 14:30:00+00:00",
        ],
        utc=True,
    )
    df = pd.DataFrame(
        {
            "open": [10, 11, 12, 13],
            "high": [11, 12, 13, 14],
            "low": [9, 10, 11, 12],
            "close": [10, 11, 12, 13],
            "volume": [100, 100, 100, 100],
        },
        index=idx,
    )
    calendar = EarningsCalendar(days_before=1, days_after=1)
    calendar.add_event("AAPL", date(2024, 7, 31))

    blackout = compute_earnings_blackout_active(df, symbol="AAPL", earnings_calendar=calendar)

    assert list(blackout["earnings_blackout_active"]) == [0.0, 1.0, 0.0, 0.0]
