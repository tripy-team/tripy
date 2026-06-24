# backend/src/handlers/hotels.py
"""
AwardTool Hotel Search Handler

Wraps the AwardTool Hotel API (synchronous, single-request) with:
  - Dummy mode fallback when USE_AWARDTOOL_DUMMY_DATA=true or no API key is configured
  - Field normalization to the format expected by
    serp_api_functions.optimize_hotels_out_of_pocket:
      hotel_id, name, brand, program_code,
      cash_cost (total), points_cost (total), surcharge, star_rating, address
"""

import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

HOTEL_SEARCH_URL = "https://www.awardtool-api.com/search_hotel"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_nights(check_in: str, check_out: str) -> int:
    """Return the number of nights between check_in and check_out."""
    try:
        ci = datetime.strptime(check_in, "%Y-%m-%d")
        co = datetime.strptime(check_out, "%Y-%m-%d")
        return max(1, (co - ci).days)
    except ValueError:
        return 1


def _normalize_row(h: Dict[str, Any], nights: int) -> Dict[str, Any]:
    """
    Normalize a raw hotel row to the shape expected by
    optimize_hotels_out_of_pocket.

    The AwardTool API returns per-night rates; the dummy generator already
    returns totals.  We detect which case we're in by checking for
    'cash_rate' (API) vs 'cash_cost' (dummy).

    Output keys:
        hotel_id, name, brand, program_code,
        cash_cost (total $), points_cost (total pts), surcharge ($),
        star_rating, address
    """
    # --- Cash ---
    # API: cash_rate = per-night   Dummy: cash_cost / price = total
    cash_per_night = h.get("cash_rate") or h.get("cash_per_night")
    cash_total = h.get("cash_cost") or h.get("cash_total") or h.get("price")
    if cash_per_night is not None and cash_total is None:
        cash_total = float(cash_per_night) * nights
    cash_cost = float(cash_total) if cash_total is not None else None

    # --- Points ---
    # Dummy data always includes award_points / points_required (totals).
    # The real AwardTool API only returns "points" as a per-night value.
    # Priority: explicit total fields first, then fall back to per-night * nights.
    points_total = (
        h.get("award_points")
        or h.get("points_required")
        or h.get("points_cost")
    )
    if points_total is None:
        # Only "points" available — treat as per-night (real API response)
        points_per_night = h.get("points")
        if points_per_night is not None:
            points_total = int(points_per_night) * nights
    points_cost = int(points_total) if points_total is not None else None

    # --- Surcharge ---
    sur = h.get("surcharge") or h.get("tax") or 0
    surcharge = float(sur) if sur else 0.0

    return {
        "hotel_id": h.get("hotel_id") or h.get("id") or "",
        "name": h.get("name") or h.get("hotel_name") or "",
        "brand": h.get("brand") or "",
        "program_code": h.get("program_code") or h.get("program") or "",
        "cash_cost": cash_cost,
        "points_cost": points_cost,
        "surcharge": surcharge,
        "star_rating": h.get("star_rating") or h.get("stars"),
        "address": h.get("address") or h.get("location") or "",
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def search_hotels(
    destination: str,
    check_in: str,
    check_out: str,
    programs: Optional[List[str]] = None,
    guests: int = 2,
    hotel_class: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Search for award hotel availability via the AwardTool Hotel API.

    Returns a list of normalized hotel rows suitable for use in
    optimize_hotels_out_of_pocket.  Falls back to dummy data when
    is_awardtool_dummy_mode() is True.

    Args:
        destination:  City name (e.g. "London", "Paris")
        check_in:     YYYY-MM-DD
        check_out:    YYYY-MM-DD
        programs:     Hotel loyalty program codes, e.g. ["HH", "MAR", "HYATT", "IHG"]
        guests:       Number of guests
        hotel_class:  Optional star rating filter ("3", "4", "5")

    Returns:
        List of dicts with keys: hotel_id, name, brand, program_code,
        cash_cost, points_cost, surcharge, star_rating, address
    """
    from src.config import is_awardtool_dummy_mode, AWARDTOOL_API_KEY as CONFIG_KEY

    nights = _compute_nights(check_in, check_out)
    programs = programs or ["HH", "MAR", "HYATT", "IHG"]

    # --- No AwardTool key (or dummy mode): self-hosted AwardPricingEngine ---
    # Hyatt -> exact category chart; Marriott/Hilton/IHG -> cash-derived estimate.
    if is_awardtool_dummy_mode():
        logger.info("[AwardEngine] pricing hotels for %s (self-hosted)", destination)
        try:
            from src.award_pricing import search_award_hotels as _engine_hotels
            body = _engine_hotels(destination, check_in, check_out, programs, guests, hotel_class)
        except Exception as e:
            logger.error("[AwardEngine] hotel pricing failed (%s); falling back to dummy", e)
            from src.handlers.awardtool_dummy import generate_dummy_hotel_data
            body = generate_dummy_hotel_data(
                destination, check_in, check_out, programs, guests, hotel_class
            )
        rows = body.get("data") or []
        return [_normalize_row(h, nights) for h in rows]

    # --- Live API ---
    api_key = CONFIG_KEY or os.getenv("AWARDTOOL_API_KEY") or os.getenv("AWARD_TOOL_API_KEY", "")
    if not api_key or not api_key.strip():
        logger.warning(
            "No AWARDTOOL_API_KEY configured; returning empty hotel results for %s",
            destination,
        )
        return []

    payload: Dict[str, Any] = {
        "destination": destination,
        "check_in": check_in,
        "check_out": check_out,
        "guests": guests,
        "programs": programs,
        "api_key": api_key,
    }
    if hotel_class:
        payload["hotel_class"] = hotel_class

    try:
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(
                HOTEL_SEARCH_URL,
                json=payload,
                headers={"Content-Type": "application/json"},
            )

        if resp.status_code != 200:
            logger.warning(
                "AwardTool hotel API returned %d for %s: %s",
                resp.status_code,
                destination,
                resp.text[:300],
            )
            return []

        data = resp.json()
        rows = data.get("data") or data.get("hotels") or []
        return [
            _normalize_row(h, nights)
            for h in rows
            if h.get("name") or h.get("hotel_name")
        ]

    except httpx.TimeoutException:
        logger.warning("AwardTool hotel API timed out for %s", destination)
        return []
    except Exception as exc:
        logger.error("AwardTool hotel search error for %s: %s", destination, exc)
        return []


# ---------------------------------------------------------------------------
# Raw-response parser (used by tests and direct API callers)
# ---------------------------------------------------------------------------

def _sanitize_price(value: Any) -> Optional[float]:
    """Return None for missing or sentinel (-1) prices, otherwise float."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f < 0:
        return None
    return f


def _parse_hotel_results(body: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Parse and sanitize a raw AwardTool Hotel API response body.

    Converts sentinel values (-1 = "unknown") to None so that downstream
    code never sees negative prices.  Field mapping:
        cash_cost  → cash_cost  (sanitized)
        points     → points_cost (sanitized, integer)
        surcharge  → surcharge  (sanitized, 0.0 when unknown)
        ...all other fields are passed through.

    Args:
        body: Raw API response dict, expected to have a "data" key.

    Returns:
        List of normalized hotel dicts with clean numeric fields.
    """
    rows = body.get("data") or body.get("hotels") or []
    out: List[Dict[str, Any]] = []
    for h in rows:
        if not isinstance(h, dict):
            continue
        cash_cost = _sanitize_price(h.get("cash_cost") or h.get("cash_rate") or h.get("price"))
        points_raw = _sanitize_price(
            h.get("award_points") or h.get("points_required") or h.get("points")
        )
        points_cost = int(points_raw) if points_raw is not None else None
        surcharge_raw = _sanitize_price(h.get("surcharge") or h.get("tax"))
        surcharge = surcharge_raw if surcharge_raw is not None else 0.0
        out.append({
            "hotel_id": h.get("hotel_id") or h.get("id") or "",
            "name": h.get("name") or h.get("hotel_name") or "",
            "brand": h.get("brand") or "",
            "program_code": h.get("program_code") or h.get("program") or "",
            "cash_cost": cash_cost,
            "points_cost": points_cost,
            "surcharge": surcharge,
            "star_rating": h.get("star_rating") or h.get("stars"),
            "address": h.get("address") or h.get("location") or "",
        })
    return out


# ---------------------------------------------------------------------------
# Calendar-enriched search (async, used by itinerary_service)
# ---------------------------------------------------------------------------

async def search_hotels_with_calendar(
    destination: str,
    check_in: str,
    check_out: str,
    top_hotels: int = 3,
    programs: Optional[List[str]] = None,
    guests: int = 2,
) -> Dict[str, Any]:
    """
    Async hotel search with calendar enrichment for itinerary planning.

    Calls search_hotels synchronously (in an executor so it does not block
    the event loop) and formats the results for the itinerary service.

    Returns:
        {
            "recommendations": str,          # human-readable summary
            "calendar_enriched": [...],      # list of normalized hotel rows
            "error": None | str,
        }
    """
    import asyncio

    loop = asyncio.get_event_loop()
    try:
        rows: List[Dict[str, Any]] = await loop.run_in_executor(
            None,
            lambda: search_hotels(
                destination=destination,
                check_in=check_in,
                check_out=check_out,
                programs=programs or ["HH", "MAR", "HYATT", "IHG"],
                guests=guests,
            ),
        )
    except Exception as exc:
        logger.error("search_hotels_with_calendar failed for %s: %s", destination, exc)
        return {"recommendations": None, "calendar_enriched": [], "error": str(exc)}

    top = rows[:top_hotels]

    if top:
        summary_parts = [
            f"{h.get('name', 'Hotel')} ({h.get('program_code', '')})"
            for h in top
        ]
        recommendations = f"Top hotel options in {destination}: " + ", ".join(summary_parts)
    else:
        recommendations = None

    return {
        "recommendations": recommendations,
        "calendar_enriched": top,
        "error": None,
    }
