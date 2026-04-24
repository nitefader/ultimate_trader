"""CorrelationGuard — enforces correlation-based position limits using 60d pairwise data."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from app.models.risk_profile import RiskProfile

logger = logging.getLogger(__name__)

_REFRESH_INTERVAL_HOURS = 24


class CorrelationGuard:
    """
    Uses avg_pairwise_correlation_60d from MarketMetadataSnapshot to enforce
    per-direction correlation limits defined in the account RiskProfile.

    Approximation: corr(A, B) ≈ (avg_corr[A] + avg_corr[B]) / 2
    This is the Elton-Gruber mean correlation estimate — directionally correct
    for a risk guard without requiring the full N×N matrix.
    """

    def __init__(self, account_id: str) -> None:
        self.account_id = account_id
        self._corr_map: dict[str, float] = {}  # symbol → avg_pairwise_correlation_60d
        self._loaded_at: datetime | None = None

    def needs_refresh(self) -> bool:
        if self._loaded_at is None:
            return True
        age = datetime.now(timezone.utc) - self._loaded_at
        return age > timedelta(hours=_REFRESH_INTERVAL_HOURS)

    async def refresh(self, db: AsyncSession) -> None:
        try:
            from sqlalchemy import select
            from app.models.market_metadata import MarketMetadataSnapshot, MarketMetadataSymbol

            result = await db.execute(
                select(MarketMetadataSnapshot)
                .order_by(MarketMetadataSnapshot.created_at.desc())
                .limit(1)
            )
            snapshot = result.scalars().first()
            if snapshot is None:
                logger.warning("CorrelationGuard: no MarketMetadataSnapshot found")
                return

            sym_result = await db.execute(
                select(MarketMetadataSymbol)
                .where(MarketMetadataSymbol.snapshot_id == snapshot.id)
            )
            symbols = sym_result.scalars().all()
            self._corr_map = {
                s.symbol.upper(): float(s.avg_pairwise_correlation_60d)
                for s in symbols
                if s.avg_pairwise_correlation_60d is not None
            }
            self._loaded_at = datetime.now(timezone.utc)
            logger.info("CorrelationGuard: loaded corr data for %d symbols (snapshot %s)",
                        len(self._corr_map), snapshot.id[:8])
        except Exception as exc:
            logger.warning("CorrelationGuard: refresh failed: %s", exc)

    def check_entry(
        self,
        proposed_symbol: str,
        proposed_direction: str,
        open_positions: dict[str, str],   # symbol → direction
        risk_profile: "RiskProfile",
    ) -> tuple[bool, str]:
        """
        Returns (approved, reason).
        Checks if adding proposed_symbol would push portfolio-weighted avg correlation
        above the RiskProfile directional limit.
        """
        sym = proposed_symbol.upper()
        direction = proposed_direction.lower()

        # Peers: open positions in same direction
        peers = [s for s, d in open_positions.items() if d.lower() == direction and s != sym]

        if not peers:
            return True, "approved — no peers"

        proposed_avg_corr = self._corr_map.get(sym)
        if proposed_avg_corr is None:
            logger.debug("CorrelationGuard: no corr data for %s — allowing entry", sym)
            return True, "approved — no correlation data"

        # Compute portfolio-weighted avg pairwise correlation estimate
        estimates = []
        for peer in peers:
            peer_avg = self._corr_map.get(peer.upper())
            if peer_avg is not None:
                estimates.append((proposed_avg_corr + peer_avg) / 2.0)

        if not estimates:
            return True, "approved — no peer correlation data"

        weighted_avg = sum(estimates) / len(estimates)

        if direction == "long":
            limit = getattr(risk_profile, "max_correlated_exposure_long", 1.0)
        else:
            limit = getattr(risk_profile, "max_correlated_exposure_short", 0.80)

        # max_correlated_exposure on RiskProfile is stored as fraction of equity (e.g. 1.0 = 100%)
        # For correlation check we use it as a correlation coefficient threshold (0.0–1.0)
        # Values > 1.0 effectively disable the check
        if limit >= 1.0:
            return True, "approved — correlation limit disabled"

        if weighted_avg > limit:
            return False, (
                f"Correlation guard: {sym} estimated portfolio correlation "
                f"{weighted_avg:.2f} exceeds {direction} limit {limit:.2f}"
            )

        return True, f"approved — correlation {weighted_avg:.2f} within limit {limit:.2f}"

    @property
    def corr_map_size(self) -> int:
        return len(self._corr_map)
