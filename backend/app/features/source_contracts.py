"""Source arbitration and provenance contracts for feature warm-up."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

RuntimeMode = Literal["research", "simulation", "paper", "live"]

ALPACA_LIVE_PROVIDER = "alpaca"
YFINANCE_FALLBACK_PROVIDER = "yfinance"
ALPACA_STREAM_CONTINUATION = "alpaca_stream"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class WarmupSourceContract:
    runtime_mode: RuntimeMode
    selected_provider: str
    continuation_provider: str
    fallback_allowed: bool
    fallback_reason: str | None = None


@dataclass(frozen=True)
class FrameProvenance:
    runtime_mode: RuntimeMode
    warmup_provider: str | None = None
    continuation_provider: str | None = None
    fallback_reason: str | None = None
    warmed_at: datetime | None = None
    last_updated_at: datetime | None = None

    def with_continuation(self, source: str) -> "FrameProvenance":
        return FrameProvenance(
            runtime_mode=self.runtime_mode,
            warmup_provider=self.warmup_provider,
            continuation_provider=source,
            fallback_reason=self.fallback_reason,
            warmed_at=self.warmed_at,
            last_updated_at=utcnow(),
        )


def resolve_warmup_source_contract(
    *,
    runtime_mode: RuntimeMode,
    alpaca_credentials_configured: bool,
) -> WarmupSourceContract:
    if runtime_mode in {"paper", "live"}:
        if alpaca_credentials_configured:
            return WarmupSourceContract(
                runtime_mode=runtime_mode,
                selected_provider=ALPACA_LIVE_PROVIDER,
                continuation_provider=ALPACA_STREAM_CONTINUATION,
                fallback_allowed=False,
            )
        return WarmupSourceContract(
            runtime_mode=runtime_mode,
            selected_provider=YFINANCE_FALLBACK_PROVIDER,
            continuation_provider=ALPACA_STREAM_CONTINUATION,
            fallback_allowed=True,
            fallback_reason="alpaca_credentials_missing_for_live_default",
        )

    return WarmupSourceContract(
        runtime_mode=runtime_mode,
        selected_provider=YFINANCE_FALLBACK_PROVIDER,
        continuation_provider=YFINANCE_FALLBACK_PROVIDER,
        fallback_allowed=False,
    )


def make_warmup_provenance(contract: WarmupSourceContract) -> FrameProvenance:
    return FrameProvenance(
        runtime_mode=contract.runtime_mode,
        warmup_provider=contract.selected_provider,
        continuation_provider=contract.continuation_provider,
        fallback_reason=contract.fallback_reason,
        warmed_at=utcnow(),
    )


def resolve_requested_provider(
    *,
    requested_provider: str | None,
    runtime_mode: RuntimeMode,
    alpaca_credentials_configured: bool,
) -> str:
    normalized = (requested_provider or "auto").strip().lower()
    if normalized in {ALPACA_LIVE_PROVIDER, YFINANCE_FALLBACK_PROVIDER}:
        return normalized

    contract = resolve_warmup_source_contract(
        runtime_mode=runtime_mode,
        alpaca_credentials_configured=alpaca_credentials_configured,
    )
    return contract.selected_provider
