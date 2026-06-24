"""
AwardQuote — the canonical output of the self-hosted AwardPricingEngine.

Every layer (chart / cash-derived / scrape / dummy) returns an AwardQuote so the
optimizer and UI can prefer higher-confidence numbers and label "exact (chart)"
vs "estimated". The fields map onto the raw rows that
``handlers/flights.py:_merge_award_edges`` and ``handlers/hotels.py:_normalize_row``
already consume, so the engine drops into existing call sites unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Source + confidence taxonomy (see docs/AWARD_POINTS_EXACT_PRICING_PLAN.md)
# ---------------------------------------------------------------------------

SOURCE_CHART = "chart"            # deterministic published chart — bookable-exact
SOURCE_CASH_DERIVED = "cash_derived"  # points ≈ cash ÷ peg — free estimate
SOURCE_SCRAPE = "scrape"          # live award page scrape — near-exact (not built by default)
SOURCE_DUMMY = "dummy"            # promoted heuristic floor — rough estimate

# Confidence anchors per source. The engine prefers the highest-confidence quote.
CONFIDENCE = {
    SOURCE_CHART: 0.95,
    SOURCE_SCRAPE: 0.85,
    SOURCE_CASH_DERIVED: 0.60,
    SOURCE_DUMMY: 0.30,
}


@dataclass
class AwardQuote:
    """A single award price for one (program, route/property, cabin/room) tuple."""

    program_code: str
    award_points: int
    cabin_or_room_type: str
    source: str
    confidence: float
    surcharge: float = 0.0
    cash_equivalent: Optional[float] = None
    as_of: Optional[str] = None
    # Optional chart context — populated when the date's demand tier is unknown
    # (BA peak/off-peak, Hyatt Lowest..Top) so the UI can show a range.
    points_min: Optional[int] = None
    points_max: Optional[int] = None
    tier_unknown: bool = False
    transfer_options: List[Dict[str, Any]] = field(default_factory=list)
    notes: Optional[str] = None

    def is_better_than(self, other: Optional["AwardQuote"]) -> bool:
        """Higher confidence wins; ties broken by lower points."""
        if other is None:
            return True
        if self.confidence != other.confidence:
            return self.confidence > other.confidence
        return self.award_points < other.award_points
