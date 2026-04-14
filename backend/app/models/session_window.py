"""
SessionWindowConfig — strategy timing rules shared by backtest replay and live execution.

This model bridges the gap between a strategy's entry/exit time constraints and the
execution engine (both BacktestEngine and live DeploymentRunner).  A single config
object drives both modes so paper and live behaviour are identical.

Fields
------
entry_start     : Earliest time-of-day for new entries (HH:MM, ET)
entry_cutoff    : No new entries after this time (HH:MM, ET)
exit_cutoff     : Close all positions by this time (HH:MM, ET)
                  None = no forced session close (swing / position mode)
liquidation_time: Hard liquidation time — market-on-close or aggressive limit (HH:MM, ET)
                  None = no intraday liquidation (swing / position mode)
allow_overnight : Whether positions may be held past session end
pre_market      : Allow entries before regular session open (requires broker support)
post_market     : Allow entries after regular session close (requires broker support)
timezone        : IANA timezone for all time fields (default America/New_York)

Duration mode rules (enforced by execution layer, not this model):
  DAY:      entry_cutoff = 15:30, exit_cutoff = 15:50, liquidation_time = 15:55,
            allow_overnight = False
  SWING:    entry_cutoff = None (any), exit_cutoff = None, liquidation_time = None,
            allow_overnight = True
  POSITION: same as SWING, allow_overnight = True
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time
from typing import Literal


@dataclass
class SessionWindowConfig:
    # Entry window (None = no restriction)
    entry_start: time | None = None        # e.g. time(9, 30)
    entry_cutoff: time | None = None       # e.g. time(15, 30)

    # Exit / liquidation (None = no forced close)
    exit_cutoff: time | None = None        # begin closing positions
    liquidation_time: time | None = None   # hard flatten deadline

    # Overnight and extended hours
    allow_overnight: bool = True
    pre_market: bool = False
    post_market: bool = False

    # Timezone for all time fields
    timezone: str = "America/New_York"

    # ── Factory presets ───────────────────────────────────────────────────────

    @classmethod
    def for_day_trading(cls) -> "SessionWindowConfig":
        """
        Standard day-trading session window.
        No new entries after 15:30 ET.
        Begin closing positions at 15:50 ET.
        Hard liquidation at 15:55 ET (MOC or aggressive limit).
        No overnight holds.
        """
        return cls(
            entry_start=time(9, 30),
            entry_cutoff=time(15, 30),
            exit_cutoff=time(15, 50),
            liquidation_time=time(15, 55),
            allow_overnight=False,
        )

    @classmethod
    def for_swing_trading(cls) -> "SessionWindowConfig":
        """
        Swing / multi-day holds.
        No intraday entry or exit restrictions.
        Overnight holds permitted.
        """
        return cls(
            entry_start=time(9, 30),
            entry_cutoff=None,
            exit_cutoff=None,
            liquidation_time=None,
            allow_overnight=True,
        )

    @classmethod
    def for_position_trading(cls) -> "SessionWindowConfig":
        """
        Long-duration position trading.
        Same as swing but intentionally labelled separately.
        """
        return cls.for_swing_trading()

    @classmethod
    def from_duration_mode(cls, duration_mode: str) -> "SessionWindowConfig":
        """Convenience: build from a StrategyVersion.duration_mode string."""
        if duration_mode == "day":
            return cls.for_day_trading()
        elif duration_mode == "swing":
            return cls.for_swing_trading()
        elif duration_mode == "position":
            return cls.for_position_trading()
        raise ValueError(f"Unknown duration_mode: {duration_mode!r}. Must be 'day', 'swing', or 'position'.")

    # ── Runtime checks ────────────────────────────────────────────────────────

    def can_enter(self, current_time: time) -> bool:
        """Return True if a new entry is allowed at current_time."""
        if self.entry_start and current_time < self.entry_start:
            return False
        if self.entry_cutoff and current_time >= self.entry_cutoff:
            return False
        return True

    def should_close_positions(self, current_time: time) -> bool:
        """Return True when the engine should begin closing open positions."""
        if self.exit_cutoff and current_time >= self.exit_cutoff:
            return True
        return False

    def should_liquidate_all(self, current_time: time) -> bool:
        """Return True when the engine must flatten ALL positions immediately."""
        if self.liquidation_time and current_time >= self.liquidation_time:
            return True
        return False

    def to_dict(self) -> dict:
        return {
            "entry_start": self.entry_start.strftime("%H:%M") if self.entry_start else None,
            "entry_cutoff": self.entry_cutoff.strftime("%H:%M") if self.entry_cutoff else None,
            "exit_cutoff": self.exit_cutoff.strftime("%H:%M") if self.exit_cutoff else None,
            "liquidation_time": self.liquidation_time.strftime("%H:%M") if self.liquidation_time else None,
            "allow_overnight": self.allow_overnight,
            "pre_market": self.pre_market,
            "post_market": self.post_market,
            "timezone": self.timezone,
        }
