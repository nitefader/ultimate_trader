"""Canonical feature specifications and compatibility adapters."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True)
class FeatureSpec:
    """Canonical identity for one computed feature requirement."""

    kind: str
    timeframe: str
    source: str = "close"
    params: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class FeatureRequirement:
    """A concrete feature request emitted by a program or runtime consumer."""

    spec: FeatureSpec
    requested_by: str | None = None

