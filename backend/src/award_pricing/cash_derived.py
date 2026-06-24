"""
Layer 2 — cash-derived estimate (free, reuses cash we already have).

For dynamic programs there is no chart, so we estimate:
    award_points ≈ round( cash_usd * 100 / peg_cents )

`cash_usd` is the cash price already fetched in the same request (SerpAPI). When
no cash is supplied, we fall back to a DETERMINISTIC route-type / city-tier cash
midpoint (no API call, no randomness) so the estimate is stable and reproducible.
Confidence is labeled lower than charts everywhere this is used.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger(__name__)

_PEGS_PATH = Path(__file__).resolve().parent / "charts" / "data" / "redemption_pegs.yml"


@lru_cache(maxsize=1)
def _pegs() -> dict:
    with open(_PEGS_PATH) as f:
        return yaml.safe_load(f)


def flight_peg(program: str) -> float:
    p = (program or "").upper()
    cfg = _pegs()
    return float(cfg.get("flights", {}).get(p, cfg.get("default_flight_peg", 1.3)))


def hotel_peg(program: str) -> float:
    p = (program or "").upper()
    cfg = _pegs()
    return float(cfg.get("hotels", {}).get(p, cfg.get("default_hotel_peg", 0.6)))


def _points_from_cash(cash_usd: float, peg_cents: float) -> int:
    if peg_cents <= 0:
        peg_cents = 1.0
    return max(1, int(round(cash_usd * 100.0 / peg_cents)))


# ---------------------------------------------------------------------------
# Deterministic cash fallbacks (used only when real cash isn't supplied).
# Midpoints of the dummy CASH_PRICES route-type table — deterministic, no random.
# ---------------------------------------------------------------------------

def estimate_flight_cash_usd(origin: str, destination: str, cabin: str) -> Optional[float]:
    from src.handlers.awardtool_dummy import CASH_PRICES, _classify_route

    route_type = _classify_route(origin, destination)
    table = CASH_PRICES.get(route_type, CASH_PRICES["transatlantic"])
    cabin_key = {
        "economy": "Economy", "premium_economy": "Premium Economy",
        "business": "Business", "first": "First",
    }.get(_norm(cabin), "Economy")
    lo, hi = table.get(cabin_key, table["Economy"])
    return (lo + hi) / 2.0


def estimate_hotel_cash_usd(destination: str, nights: int) -> Optional[float]:
    from src.handlers.awardtool_dummy import _get_city_tier

    tier = _get_city_tier(destination)
    per_night = {1: 450.0, 2: 280.0, 3: 160.0}.get(tier, 250.0)
    return per_night * max(1, nights)


def _norm(cabin: Optional[str]) -> str:
    from .charts import normalize_cabin
    return normalize_cabin(cabin)


def _award_range(origin: str, destination: str, cabin: str) -> Optional[tuple]:
    """Realistic award point range for this route-type/cabin (dummy heuristic table)."""
    try:
        from src.handlers.awardtool_dummy import AWARD_PRICING, _classify_route

        route_type = _classify_route(origin, destination)
        cabin_key = {
            "economy": "Economy", "premium_economy": "Premium Economy",
            "business": "Business", "first": "First",
        }.get(_norm(cabin), "Economy")
        row = AWARD_PRICING.get(route_type, AWARD_PRICING["transatlantic"]).get(cabin_key)
        if not row:
            return None
        return int(row["min_points"]), int(row["max_points"])
    except Exception:  # pragma: no cover
        return None


def cash_derived_flight_points(
    program: str, cabin: str, origin: str, destination: str, cash_usd: Optional[float] = None
) -> Optional[dict]:
    if cash_usd is None or cash_usd <= 0:
        cash_usd = estimate_flight_cash_usd(origin, destination, cabin)
    if cash_usd is None or cash_usd <= 0:
        return None
    pts = _points_from_cash(cash_usd, flight_peg(program))
    # Clamp the cash signal into the realistic award range. Airlines price premium
    # award cabins FAR below cash value, so an unclamped cash÷peg over-estimates
    # business/first badly; the route-type heuristic bounds it sanely.
    rng = _award_range(origin, destination, cabin)
    clamped = False
    if rng:
        lo, hi = rng
        if pts < lo:
            pts, clamped = lo, True
        elif pts > hi:
            pts, clamped = hi, True
    return {
        "points": pts,
        "cash_equivalent": round(float(cash_usd), 2),
        "peg": flight_peg(program),
        "clamped": clamped,
    }


def cash_derived_hotel_points(
    program: str, destination: str, nights: int, cash_usd: Optional[float] = None
) -> Optional[dict]:
    if cash_usd is None or cash_usd <= 0:
        cash_usd = estimate_hotel_cash_usd(destination, nights)
    if cash_usd is None or cash_usd <= 0:
        return None
    pts = _points_from_cash(cash_usd, hotel_peg(program))
    return {"points": pts, "cash_equivalent": round(float(cash_usd), 2), "peg": hotel_peg(program)}
