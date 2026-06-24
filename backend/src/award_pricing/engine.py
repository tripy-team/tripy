"""
The layered AwardPricingEngine resolution.

Per (program, route/property, cabin/room) it tries layers in order and returns
the first confident AwardQuote:

  L1 chart        -> bookable-exact, $0           (Avios family, AS/AC/NH/VS, Hyatt)
  L2 cash-derived -> free estimate from cash       (dynamic programs)
  (L3 scrape)     -> not built by default; see plan §5 / backtest gate §8
  L4 dummy floor  -> handled by the response assembler so we never return empty

Higher-confidence quotes win. Every quote carries source/confidence/as_of.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from . import charts, cash_derived
from .models import (
    AwardQuote,
    CONFIDENCE,
    SOURCE_CASH_DERIVED,
    SOURCE_CHART,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _surcharge_for(program: str, origin: str, destination: str, cabin: str) -> float:
    """
    Deterministic surcharge estimate: route-type/cabin base (dummy table midpoint)
    × the program's surcharge_multiplier from programs.yml. Captures the BA/LH
    fuel-surcharge reality without an API call.
    """
    try:
        from src.handlers.awardtool_dummy import AWARD_PRICING, _classify_route
        from src.config.programs import AIRLINE_PROGRAMS_FULL

        route_type = _classify_route(origin, destination)
        cabin_key = {
            "economy": "Economy", "premium_economy": "Premium Economy",
            "business": "Business", "first": "First",
        }.get(charts.normalize_cabin(cabin), "Economy")
        rng = AWARD_PRICING.get(route_type, AWARD_PRICING["transatlantic"]).get(
            cabin_key, AWARD_PRICING["transatlantic"]["Economy"]
        )["surcharge_range"]
        base = (rng[0] + rng[1]) / 2.0
        mult = AIRLINE_PROGRAMS_FULL.get(program.upper(), {}).get("surcharge_multiplier", 1.0)
        return round(base * float(mult), 2)
    except Exception:  # pragma: no cover - defensive
        return 0.0


def _transfer_options(program: str) -> list:
    """Banks that transfer into this program (from programs.yml reverse map)."""
    try:
        from src.config.programs import AIRLINE_PROGRAMS_FULL, HOTEL_PROGRAMS_FULL

        info = AIRLINE_PROGRAMS_FULL.get(program.upper()) or HOTEL_PROGRAMS_FULL.get(program.upper())
        if not info:
            return []
        return [{"program": b, "points": None} for b in info.get("transfer_partners", [])]
    except Exception:  # pragma: no cover
        return []


# ---------------------------------------------------------------------------
# Flights
# ---------------------------------------------------------------------------

def quote_flight(
    program: str,
    origin: str,
    destination: str,
    cabin: str,
    peak: Optional[bool] = None,
    cash_usd: Optional[float] = None,
) -> Optional[AwardQuote]:
    """Best available AwardQuote for one flight segment, or None if no layer fires."""
    p = (program or "").upper()
    cab = charts.normalize_cabin(cabin)

    # L1 — chart (exact)
    if charts.is_chart_flight_program(p):
        c = charts.quote_chart_flight(p, origin, destination, cabin, peak=peak)
        if c:
            return AwardQuote(
                program_code=p,
                award_points=c["points"],
                cabin_or_room_type=cab,
                source=SOURCE_CHART,
                confidence=CONFIDENCE[SOURCE_CHART],
                surcharge=_surcharge_for(p, origin, destination, cab),
                cash_equivalent=cash_usd,
                as_of=_now_iso(),
                points_min=c.get("points_min"),
                points_max=c.get("points_max"),
                tier_unknown=c.get("tier_unknown", False),
                transfer_options=_transfer_options(p),
                notes=_chart_note(c),
            )

    # L2 — cash-derived (estimate)
    cd = cash_derived.cash_derived_flight_points(p, cab, origin, destination, cash_usd=cash_usd)
    if cd:
        return AwardQuote(
            program_code=p,
            award_points=cd["points"],
            cabin_or_room_type=cab,
            source=SOURCE_CASH_DERIVED,
            confidence=CONFIDENCE[SOURCE_CASH_DERIVED],
            surcharge=_surcharge_for(p, origin, destination, cab),
            cash_equivalent=cd.get("cash_equivalent"),
            as_of=_now_iso(),
            transfer_options=_transfer_options(p),
            notes=f"cash-derived @ {cd['peg']}¢/pt",
        )
    return None


# ---------------------------------------------------------------------------
# Hotels
# ---------------------------------------------------------------------------

def quote_hotel(
    program: str,
    hotel_name: str,
    city: str,
    nights: int,
    tier: Optional[str] = None,
    category: Optional[int] = None,
    cash_usd: Optional[float] = None,
) -> Optional[AwardQuote]:
    """Best available AwardQuote for a hotel stay (TOTAL points for `nights`)."""
    p = (program or "").upper()
    nights = max(1, int(nights))

    # L1 — Hyatt category chart (exact)
    if charts.is_chart_hotel_program(p):
        cat = category if category is not None else charts.resolve_hyatt_category(hotel_name, city)
        h = charts.quote_hyatt(cat, tier=tier)
        if h:
            return AwardQuote(
                program_code=p,
                award_points=h["points"] * nights,
                cabin_or_room_type="standard",
                source=SOURCE_CHART,
                confidence=CONFIDENCE[SOURCE_CHART],
                surcharge=0.0,  # Hyatt has no award surcharges
                cash_equivalent=cash_usd,
                as_of=_now_iso(),
                points_min=h.get("points_min", 0) * nights,
                points_max=h.get("points_max", 0) * nights,
                tier_unknown=h.get("tier_unknown", False),
                transfer_options=_transfer_options(p),
                notes=f"Hyatt Cat {h['category']} × {nights}n",
            )

    # L2 — cash-derived (estimate)
    cd = cash_derived.cash_derived_hotel_points(p, city, nights, cash_usd=cash_usd)
    if cd:
        return AwardQuote(
            program_code=p,
            award_points=cd["points"],
            cabin_or_room_type="standard",
            source=SOURCE_CASH_DERIVED,
            confidence=CONFIDENCE[SOURCE_CASH_DERIVED],
            surcharge=0.0,
            cash_equivalent=cd.get("cash_equivalent"),
            as_of=_now_iso(),
            transfer_options=_transfer_options(p),
            notes=f"cash-derived @ {cd['peg']}¢/pt",
        )
    return None


def _chart_note(c: dict) -> str:
    if "band" in c:
        note = f"Avios band {c['band']} ({c.get('miles')}mi)"
    elif "region_pair" in c:
        note = f"partner chart {c['region_pair']}"
    else:
        note = "chart"
    if c.get("tier_unknown"):
        note += " — off-peak shown; peak date unknown"
    return note
