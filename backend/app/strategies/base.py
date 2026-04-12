"""
Base strategy class — minimal interface that all strategy implementations must satisfy.
The BacktestEngine drives execution; strategies are defined as config dicts, not class subclasses.
This module provides utilities for loading and validating strategy configs.
"""
from __future__ import annotations

import yaml
import json
from pathlib import Path
from typing import Any


def load_strategy_config(path: str | Path) -> dict[str, Any]:
    """Load a strategy config from YAML or JSON file."""
    path = Path(path)
    with open(path) as f:
        if path.suffix in (".yaml", ".yml"):
            return yaml.safe_load(f)
        else:
            return json.load(f)


def validate_strategy_config(config: dict[str, Any]) -> tuple[bool, list[str], list[str]]:
    """
    Validate a strategy config dict.
    Returns (valid, errors, warnings).
    """
    errors = []
    warnings = []

    if not config.get("entry"):
        errors.append("Missing 'entry' configuration")
    else:
        entry = config["entry"]
        if not entry.get("conditions"):
            errors.append("Entry has no conditions defined")
        if not entry.get("directions"):
            warnings.append("No 'directions' specified — defaulting to ['long']")

    if not config.get("stop_loss"):
        warnings.append("No stop_loss configured — trades will have unbounded risk")

    if not config.get("targets") and not config.get("exit", {}).get("conditions"):
        warnings.append("No profit targets or exit conditions — positions will only exit at stop or time_exit")

    if not config.get("position_sizing"):
        warnings.append("No position_sizing configured — using defaults (1% risk)")

    risk = config.get("risk", {})
    if risk.get("max_portfolio_heat", 1.0) > 0.20:
        warnings.append("Portfolio heat > 20% — consider reducing for risk management")

    return len(errors) == 0, errors, warnings
