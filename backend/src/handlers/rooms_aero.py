# backend/src/handlers/rooms_aero.py
"""
rooms.aero Hotel Provider — live seats.aero/rooms.aero adapter with a safe
award_pricing fallback.

Implements the `HotelProvider` interface from hotel_recommendation_service so it
drops in via `set_hotel_provider(...)` with no downstream changes. Returns the
full evaluated candidate set (via `candidates()`) so the categorized suggestion
engine can pick Best Value / Best Points / Best Stay.

Data source resolution per request:
    1. Live rooms.aero (seats.aero Pro key)  — only when configured AND the call
       succeeds. The seats.aero Pro API is documented as non-commercial/personal
       use and does NOT publicly document a hotel endpoint, so the request path
       below is a best-effort BEST GUESS and is wrapped to fail safe.
    2. In-repo award_pricing engine           — deterministic fallback used on any
       live failure, when the key is absent, or when USE_HOTEL_DUMMY_DATA=true.

IMPORTANT (see HOTEL_SUGGESTIONS_PLAN.md §1):
    - Confirm the real rooms.aero endpoint/params/response shape before enabling
      USE_LIVE_HOTEL_PROVIDER in production. `_fetch_live` is the ONLY place that
      needs to change once the contract is known.
    - Do not enable live/commercial use without written approval from seats.aero.
"""
from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional

import httpx
from dotenv import load_dotenv

from src.agents.models import HotelRecommendation
from src.services.hotel_recommendation_service import (
    StayWindow,
    evaluate_payment_and_budget,
)
from src.utils import cache_layer

load_dotenv()

logger = logging.getLogger(__name__)

# =============================================================================
# Configuration
# =============================================================================

SEATS_AERO_API_KEY = os.getenv("SEATS_AERO_API_KEY")
ROOMS_AERO_BASE_URL = os.getenv("ROOMS_AERO_BASE_URL", "https://rooms.aero/partnerapi").rstrip("/")
USE_HOTEL_DUMMY_DATA = os.getenv("USE_HOTEL_DUMMY_DATA", "false").lower() == "true"

# Cache live responses to stay well under the 1,000 calls/day Pro quota. A single
# optimize run touches many windows x candidates; without this we exhaust quota.
HOTEL_CACHE_TTL = int(os.getenv("HOTEL_CACHE_TTL", "21600"))  # 6 hours
HTTP_TIMEOUT = httpx.Timeout(connect=5.0, read=12.0, write=5.0, pool=5.0)

# Canonical hotel program codes the award_pricing engine + points lookup expect.
_ALL_HOTEL_PROGRAMS = ["MAR", "HH", "HYATT", "IHG"]

# Program code / loyalty display name → canonical chain used by _lookup_chain_points.
_CHAIN_DISPLAY = {
    "MAR": "Marriott", "HH": "Hilton", "HYATT": "Hyatt", "IHG": "IHG",
}
_LOYALTY_DISPLAY = {
    "MAR": "Marriott Bonvoy", "HH": "Hilton Honors",
    "HYATT": "World of Hyatt", "IHG": "IHG One Rewards",
}
# Substrings (lowercased) that identify a chain from a brand/program/name field.
_CHAIN_HINTS = {
    "Marriott": ("marriott", "bonvoy", "ritz", "st. regis", "westin", "sheraton", "w hotels", "renaissance"),
    "Hilton": ("hilton", "conrad", "waldorf", "doubletree", "honors"),
    "Hyatt": ("hyatt", "andaz", "park hyatt", "grand hyatt"),
    "IHG": ("ihg", "intercontinental", "kimpton", "crowne plaza", "holiday inn"),
}


# =============================================================================
# Helpers
# =============================================================================

def _programs_for(user_points: Optional[Dict[str, int]]) -> List[str]:
    """Pick hotel programs to query — those the traveler holds points in, else all."""
    if not user_points:
        return list(_ALL_HOTEL_PROGRAMS)
    held = {str(k).lower().replace("_", "").replace(" ", "") for k in user_points}
    hints = {
        "MAR": ("mar", "marriott", "bonvoy", "marriottbonvoy"),
        "HH": ("hh", "hilton", "honors", "hiltonhonors"),
        "HYATT": ("hyatt", "worldofhyatt"),
        "IHG": ("ihg", "ihgonerewards"),
    }
    chosen = [code for code, keys in hints.items() if any(k in held for k in keys)]
    return chosen or list(_ALL_HOTEL_PROGRAMS)


def _canonical_chain(row: dict) -> str:
    """Best-effort map a raw hotel row onto a canonical chain name."""
    code = str(row.get("program_code") or row.get("program") or "").upper()
    if code in _CHAIN_DISPLAY:
        return _CHAIN_DISPLAY[code]
    haystack = " ".join(str(row.get(f) or "") for f in ("brand", "name", "hotel_name", "loyalty")).lower()
    for chain, hints in _CHAIN_HINTS.items():
        if any(h in haystack for h in hints):
            return chain
    return "Marriott"


def _f(*vals) -> Optional[float]:
    """First value coercible to a positive float, else None."""
    for v in vals:
        try:
            if v is None:
                continue
            n = float(v)
            if n > 0:
                return n
        except (TypeError, ValueError):
            continue
    return None


def _i(*vals) -> Optional[int]:
    n = _f(*vals)
    return int(n) if n is not None else None


def _normalize_row(row: dict, window: StayWindow, code_hint: str = "") -> Optional[HotelRecommendation]:
    """Map a raw rooms.aero / award_pricing hotel row onto a HotelRecommendation.

    Tolerant of field-name variants across sources (mirrors awardtool's flexible
    key handling). Returns None when a row lacks any usable price/points signal.
    """
    nights = window.nights
    name = row.get("name") or row.get("hotel_name") or row.get("title")
    if not name:
        return None

    cash_total = _f(row.get("cash_cost"), row.get("cash_rate"), row.get("price"),
                    row.get("total_cash"), row.get("cash_price_total"))
    nightly = _f(row.get("nightly_rate"), row.get("cash_price_per_night"))
    if cash_total is None and nightly is not None:
        cash_total = round(nightly * nights, 2)
    if nightly is None and cash_total is not None:
        nightly = round(cash_total / max(1, nights), 2)
    # A hotel with neither cash nor points is unusable.
    points_total = _i(row.get("award_points"), row.get("points"), row.get("points_required"),
                      row.get("award_points_total"))
    if cash_total is None and points_total is None:
        return None
    cash_total = cash_total or 0.0
    nightly = nightly or 0.0

    ppn = _i(row.get("points_per_night"), row.get("award_points_per_night"))
    if ppn is None and points_total is not None:
        ppn = int(points_total / max(1, nights))

    code = (code_hint or str(row.get("program_code") or row.get("program") or "")).upper()
    loyalty = row.get("loyalty_program") or _LOYALTY_DISPLAY.get(code) or row.get("brand")
    star = _i(row.get("star_rating"), row.get("stars"), row.get("hotel_class")) or 4
    rating = _f(row.get("rating"), row.get("guest_rating"))
    amenities = row.get("amenities") if isinstance(row.get("amenities"), list) else []
    booking_url = row.get("booking_url") or row.get("url")

    return HotelRecommendation(
        hotel_id=str(row.get("hotel_id") or row.get("id") or f"{code}-{name}-{window.check_in}"),
        hotel_name=str(name),
        destination=window.destination,
        check_in=window.check_in,
        check_out=window.check_out,
        price_total=round(cash_total, 2),
        nightly_rate=round(nightly, 2),
        currency=row.get("currency") or "USD",
        booking_url=booking_url,
        rating=round(rating, 1) if rating is not None else None,
        star_level=int(star),
        amenities=amenities,
        traveler_count=window.traveler_count,
        room_count=window.room_count,
        loyalty_program=loyalty,
        points_per_night=ppn,
        points_total=points_total,
    )


# =============================================================================
# Data source fetchers
# =============================================================================

def _fetch_live(window: StayWindow, programs: List[str]) -> Optional[List[dict]]:
    """Query the live rooms.aero API. Returns raw rows, or None on any failure.

    NOTE: endpoint path + params are a best guess pending contract confirmation
    (HOTEL_SUGGESTIONS_PLAN.md §1.1). Wrapped to fail safe → award_pricing.
    """
    if not SEATS_AERO_API_KEY:
        return None

    cache_key = (
        f"rooms_aero:{window.destination}:{window.check_in}:{window.check_out}:"
        f"{window.traveler_count}:{','.join(sorted(programs))}"
    )
    cached = cache_layer.get_json(cache_key)
    if cached is not None:
        logger.debug("[rooms.aero] cache hit %s", cache_key)
        return cached

    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            resp = client.get(
                f"{ROOMS_AERO_BASE_URL}/search",
                params={
                    "destination": window.destination,
                    "check_in": window.check_in,
                    "check_out": window.check_out,
                    "guests": window.traveler_count,
                    "programs": ",".join(programs),
                },
                headers={
                    "Partner-Authorization": SEATS_AERO_API_KEY,
                    "Accept": "application/json",
                },
            )
        remaining = resp.headers.get("X-RateLimit-Remaining")
        if remaining is not None:
            logger.info("[rooms.aero] X-RateLimit-Remaining=%s", remaining)
        resp.raise_for_status()
        body = resp.json()
        rows = body.get("data") or body.get("hotels") or body.get("results") or []
        if not isinstance(rows, list):
            logger.warning("[rooms.aero] unexpected response shape; falling back")
            return None
        cache_layer.set_json(cache_key, rows, HOTEL_CACHE_TTL)
        return rows
    except Exception as exc:
        logger.warning("[rooms.aero] live fetch failed (%s); using award_pricing fallback", exc)
        return None


def _fetch_fallback(window: StayWindow, programs: List[str]) -> List[dict]:
    """Deterministic in-repo source: the award_pricing hotel engine."""
    from src.award_pricing import search_award_hotels

    body = search_award_hotels(
        destination=window.destination,
        check_in=window.check_in,
        check_out=window.check_out,
        programs=programs,
        guests=window.traveler_count,
    )
    rows = body.get("data") or body.get("hotels") or []
    return rows if isinstance(rows, list) else []


# =============================================================================
# Provider
# =============================================================================

class RoomsAeroHotelProvider:
    """Live rooms.aero provider with award_pricing fallback.

    Conforms to the HotelProvider protocol: `recommend()` returns the single best
    option for legacy per-window callers, while `candidates()` returns the full
    evaluated set for the categorized suggestion engine.
    """

    def candidates(
        self,
        window: StayWindow,
        *,
        cash_budget: Optional[float] = None,
        user_points: Optional[Dict[str, int]] = None,
    ) -> List[HotelRecommendation]:
        programs = _programs_for(user_points)

        rows: Optional[List[dict]] = None
        if not USE_HOTEL_DUMMY_DATA:
            rows = _fetch_live(window, programs)
        if rows is None:
            rows = _fetch_fallback(window, programs)

        recs: List[HotelRecommendation] = []
        for row in rows:
            rec = _normalize_row(row, window)
            if rec is None:
                continue
            evaluate_payment_and_budget(rec, _canonical_chain(row), cash_budget, user_points)
            recs.append(rec)

        # De-dupe by hotel_id (sources can repeat a property across programs);
        # keep the better-value instance (lower cash, more points value).
        best_by_id: Dict[str, HotelRecommendation] = {}
        for rec in recs:
            existing = best_by_id.get(rec.hotel_id)
            if existing is None or (rec.price_total or 0) < (existing.price_total or 0):
                best_by_id[rec.hotel_id] = rec
        return list(best_by_id.values())

    def recommend(
        self,
        window: StayWindow,
        *,
        cash_budget: Optional[float] = None,
        user_points: Optional[Dict[str, int]] = None,
    ) -> List[HotelRecommendation]:
        recs = self.candidates(window, cash_budget=cash_budget, user_points=user_points)
        if not recs:
            return []

        def _rank(rec: HotelRecommendation) -> tuple:
            fits = 0 if rec.fits_budget else 1
            if rec.recommended_payment == "points":
                return (fits, 0, -(rec.redemption_value_cpp or 0.0))
            return (fits, 1, rec.price_total or float("inf"))

        recs.sort(key=_rank)
        return [recs[0]]


def install_configured_provider() -> bool:
    """Swap in the live provider when USE_LIVE_HOTEL_PROVIDER=true.

    Safe to call at startup. Returns True if the live provider was installed.
    The provider itself still falls back to award_pricing per-request, so the
    pipeline degrades gracefully even with the flag on.
    """
    if os.getenv("USE_LIVE_HOTEL_PROVIDER", "false").lower() != "true":
        return False
    from src.services.hotel_recommendation_service import set_hotel_provider

    set_hotel_provider(RoomsAeroHotelProvider())
    logger.info(
        "[rooms.aero] live hotel provider installed (key=%s, dummy=%s)",
        "set" if SEATS_AERO_API_KEY else "MISSING",
        USE_HOTEL_DUMMY_DATA,
    )
    return True
