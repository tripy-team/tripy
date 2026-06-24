"""
Self-hosted AwardPricingEngine — public API.

Replaces the paid AwardTool Enterprise API as the source of "how many points does
this flight/hotel cost". See docs/AWARD_POINTS_EXACT_PRICING_PLAN.md.

The three search_* functions return the EXACT legacy dict shapes that the current
call sites already parse (handlers/flights.py:_merge_award_edges,
handlers/hotels.py:_normalize_row, handlers/award_calendar.py), so they drop in
behind is_awardtool_dummy_mode() with no downstream changes. Each row is upgraded
with engine-computed points and tagged with source/confidence/as_of.

Resolution per row: chart (exact) -> cash-derived (estimate) -> dummy (floor).
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from . import engine
from .models import CONFIDENCE, SOURCE_CASH_DERIVED, SOURCE_CHART, SOURCE_DUMMY

logger = logging.getLogger(__name__)

__all__ = [
    "search_award_flights",
    "search_award_hotels",
    "search_award_calendar",
    "is_engine_enabled",
]


def is_engine_enabled() -> bool:
    """
    The self-hosted engine is the default non-AwardTool source. Set
    AWARD_ENGINE_DISABLE=true to fall back to the raw random dummy generators
    (e.g. for A/B comparison in the backtest).
    """
    return os.environ.get("AWARD_ENGINE_DISABLE", "false").lower() != "true"


def _tag(row: Dict[str, Any], source: str, confidence: float, quote=None) -> None:
    row["source"] = source
    row["confidence"] = confidence
    if quote is not None:
        row["as_of"] = quote.as_of
        if quote.points_min is not None:
            row["award_points_min"] = quote.points_min
        if quote.points_max is not None:
            row["award_points_max"] = quote.points_max
        if quote.tier_unknown:
            row["tier_unknown"] = True
        if quote.notes:
            row["pricing_note"] = quote.notes


# ---------------------------------------------------------------------------
# Flights
# ---------------------------------------------------------------------------

def search_award_flights(
    origin: str,
    destination: str,
    date: str,
    cabins: List[str],
    programs: List[str],
    pax: int = 1,
    cash_by_cabin: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """
    Returns the AwardTool-compatible flight response dict
    ({"data": [...], "error": None, ...}) with engine-priced points.

    cash_by_cabin: optional {normalized_cabin -> cash_usd} so the cash-derived
    layer can use the real in-request SerpAPI price; falls back to a deterministic
    estimate when absent (no extra API call).
    """
    from src.handlers.awardtool_dummy import generate_dummy_flight_data

    body = generate_dummy_flight_data(origin, destination, date, cabins, programs, int(pax))
    if not is_engine_enabled():
        for row in body.get("data", []):
            _tag(row, SOURCE_DUMMY, CONFIDENCE[SOURCE_DUMMY])
        return body

    cash_by_cabin = cash_by_cabin or {}
    upgraded = chart_n = cash_n = dummy_n = 0
    from .charts import normalize_cabin

    for row in body.get("data", []):
        prog = (row.get("program_code") or row.get("airline_code") or "").upper()
        cabin = row.get("cabin") or "Economy"
        cash_usd = cash_by_cabin.get(normalize_cabin(cabin))
        q = engine.quote_flight(prog, origin, destination, cabin, cash_usd=cash_usd)
        if q is None:
            _tag(row, SOURCE_DUMMY, CONFIDENCE[SOURCE_DUMMY])
            dummy_n += 1
            continue
        row["award_points"] = int(q.award_points)
        row["surcharge"] = float(q.surcharge)
        if q.cash_equivalent is not None:
            row["cash_equivalent"] = q.cash_equivalent
        _tag(row, q.source, q.confidence, q)
        upgraded += 1
        chart_n += q.source == SOURCE_CHART
        cash_n += q.source == SOURCE_CASH_DERIVED

    # Re-sort (points may have changed) to keep "cheapest first" contract.
    body.get("data", []).sort(key=lambda x: (x.get("cabin", ""), x.get("award_points", 0)))
    body["_engine"] = True
    logger.info(
        "[AwardEngine] flights %s->%s: %d rows (chart=%d, cash=%d, dummy=%d)",
        origin, destination, upgraded + dummy_n, chart_n, cash_n, dummy_n,
    )
    return body


# ---------------------------------------------------------------------------
# Hotels
# ---------------------------------------------------------------------------

def search_award_hotels(
    destination: str,
    check_in: str,
    check_out: str,
    programs: List[str],
    guests: int = 2,
    hotel_class: Optional[str] = None,
) -> Dict[str, Any]:
    """AwardTool-compatible hotel response dict with engine-priced points."""
    from src.handlers.awardtool_dummy import generate_dummy_hotel_data

    body = generate_dummy_hotel_data(destination, check_in, check_out, programs, guests, hotel_class)
    if not is_engine_enabled():
        for row in body.get("data", []):
            _tag(row, SOURCE_DUMMY, CONFIDENCE[SOURCE_DUMMY])
        return body

    nights = _nights(check_in, check_out)
    chart_n = cash_n = dummy_n = 0
    for row in body.get("data", []):
        prog = (row.get("program_code") or row.get("program") or "").upper()
        name = row.get("name") or row.get("hotel_name") or ""
        q = engine.quote_hotel(prog, name, destination, nights)
        if q is None:
            _tag(row, SOURCE_DUMMY, CONFIDENCE[SOURCE_DUMMY])
            dummy_n += 1
            continue
        # Mirror the engine total points into every total/per-night field the
        # downstream normalizers read.
        total = int(q.award_points)
        row["award_points"] = total
        row["points"] = total
        row["points_required"] = total
        row["surcharge"] = float(q.surcharge)
        row["tax"] = float(q.surcharge)
        if q.cash_equivalent is not None:
            row["cash_cost"] = q.cash_equivalent
            row["cash_rate"] = round(q.cash_equivalent / max(1, nights), 2)
        _tag(row, q.source, q.confidence, q)
        chart_n += q.source == SOURCE_CHART
        cash_n += q.source == SOURCE_CASH_DERIVED

    body.get("data", []).sort(key=lambda x: x.get("points", 0))
    body["hotels"] = body.get("data", [])
    body["_engine"] = True
    logger.info(
        "[AwardEngine] hotels %s: chart=%d, cash=%d, dummy=%d",
        destination, chart_n, cash_n, dummy_n,
    )
    return body


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------

def search_award_calendar(origin: str, destination: str) -> List[Dict[str, Any]]:
    """
    Panorama-compatible calendar list with chart programs' per-cabin points
    overridden by exact chart values (date-independent for chart programs;
    dynamic programs keep the dummy estimate).
    """
    from src.handlers.awardtool_dummy import generate_dummy_calendar_data

    data = generate_dummy_calendar_data(origin, destination)
    if not is_engine_enabled():
        return data

    cabin_keys = {"y": "economy", "w": "premium_economy", "j": "business", "f": "first"}
    for entry in data:
        prog = (entry.get("program") or "").upper()
        from .charts import is_chart_flight_program

        if not is_chart_flight_program(prog):
            continue
        pts = entry.get("points") or {}
        for short, cabin in cabin_keys.items():
            if pts.get(short) is None:
                continue  # respect dummy's availability decision
            q = engine.quote_flight(prog, origin, destination, cabin)
            if q is not None and q.source == SOURCE_CHART:
                pts[short] = q.award_points
    return data


def _nights(check_in: str, check_out: str) -> int:
    from datetime import datetime

    try:
        ci = datetime.strptime(check_in, "%Y-%m-%d")
        co = datetime.strptime(check_out, "%Y-%m-%d")
        return max(1, (co - ci).days)
    except (ValueError, TypeError):
        return 1
