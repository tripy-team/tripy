import asyncio
import heapq
import os
import uuid
import logging
import re
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from src.repos import itinerary_repo
from src.handlers.flights import (
    get_flights_award_first_with_points_async,
    get_flights_serp_first_with_points_async,
    get_flights_serp_only,
)
from src.handlers.ilp_adapter import run_ilp_from_edges
try:
    from src.handlers.points_maximizer import plan_maximize_points_value
except ImportError:
    # Optional dependency (pulp) not installed; advanced ILP optimization will be unavailable
    plan_maximize_points_value = None  # type: ignore
    logger = logging.getLogger(__name__)
    logger.warning(
        "pulp / points_maximizer not available. Advanced optimized itineraries will be disabled. "
        "Install 'pulp' and ensure 'src.handlers.points_maximizer' is importable to enable it."
    )
from src.services import (
    destination_service,
    trip_service,
    points_service,
    trip_member_service,
    city_service,
)
from src.handlers.airport_filter import is_commercial_airport, load_commercial_iata_set_from_web
from src.utils.award_programs import DEFAULT_TRANSFER_GRAPH, get_award_programs_for_api
from src.repos import user_repo
from src.utils.card_benefits import build_benefit_airlines_for_travelers
from src.handlers.transfer_strategy import (
    BANK_METADATA,
    PROGRAM_METADATA,
    build_transfer_instruction,
    get_program_name,
    get_bank_name,
)
from src.contracts.sentinel import scrub_sentinels
from src.contracts.validate import assert_no_negative_numbers, find_negative_numbers

logger = logging.getLogger(__name__)


def _strict_contracts_enabled() -> bool:
    return (os.getenv("TRIPY_STRICT_CONTRACTS") or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _enforce_no_negative_numbers(payload: Dict[str, Any], context: str) -> Dict[str, Any]:
    """
    Enforce the global sentinel contract at the legacy itinerary API boundary.
    """
    negatives = find_negative_numbers(payload)
    if negatives:
        if _strict_contracts_enabled():
            assert_no_negative_numbers(payload, context=context)
        logger.warning(
            "[CONTRACT] Negative numeric values detected (%s). Scrubbing to None. Sample=%s",
            context,
            negatives[:5],
        )
        return scrub_sentinels(payload)
    return scrub_sentinels(payload)

def _normalize_airport_code(airport_value: str) -> str:
    """
    Normalize airport value to a proper IATA code.
    Handles formats like:
    - "SEA" -> "SEA"
    - "SEATTLE (SEA,BFI)" -> "SEA" (extracts first code)
    - "Seattle (SEA)" -> "SEA"
    - "sea" -> "SEA"
    """
    if not airport_value:
        return ""
    
    value = airport_value.strip().upper()
    
    # If it's already a 3-letter IATA code, return it
    if re.match(r'^[A-Z]{3}$', value):
        return value
    
    # Try to extract airport codes from parentheses like "SEATTLE (SEA,BFI)" or "Paris (CDG)"
    match = re.search(r'\(([A-Z]{3}(?:,\s*[A-Z]{3})*)\)', value)
    if match:
        # Return the first airport code (primary)
        codes = [c.strip() for c in match.group(1).split(',')]
        if codes:
            return codes[0]
    
    # If no parentheses, check if the whole string is a valid-looking code
    # Remove any numbers and take first 3 uppercase letters
    letters_only = re.sub(r'[^A-Z]', '', value)
    if len(letters_only) >= 3:
        return letters_only[:3]
    
    # Return original stripped value as fallback
    return value


# Feature flag for v2 itinerary generation (can be overridden by env var or request header)
ITINERARY_GENERATION_VERSION = os.getenv("ITINERARY_GENERATION_VERSION", "v2")

# Display names for transfer_tips (aligned with frontend transfer-instructions.ts)
_HUMANIZE_BANK: Dict[str, str] = {
    "amex": "Amex Membership Rewards",
    "chase": "Chase Ultimate Rewards",
    "citi": "Citi ThankYou Points",
    "capitalone": "Capital One Miles",
    "bilt": "Bilt Rewards",
}

def _normalize_program_to_transfer_key(program: str) -> str:
    """
    Normalize program name to transfer graph key.
    Banks: "Chase Ultimate Rewards" -> "chase", "Amex Membership Rewards" -> "amex"
    Airlines: "United MileagePlus" -> "UA", "Delta SkyMiles" -> "DL"
    Hotels: "Marriott Bonvoy" -> "MAR", "Hilton Honors" -> "HH"
    """
    s = (program or "").strip().lower()
    
    # Bank mappings (lowercase short codes for transfer graph)
    # Include underscore variants for stored program names like "chase_ultimate_rewards"
    bank_mapping = {
        "amex": "amex",
        "amex membership rewards": "amex",
        "amex_membership_rewards": "amex",
        "membership rewards": "amex",
        "membership_rewards": "amex",
        "amex_mr": "amex",
        "chase": "chase",
        "chase ultimate rewards": "chase",
        "chase_ultimate_rewards": "chase",
        "ultimate rewards": "chase",
        "ultimate_rewards": "chase",
        "chase_ur": "chase",
        "citi": "citi",
        "citi thankyou": "citi",
        "citi_thankyou": "citi",
        "citi thankyou points": "citi",
        "citi_thankyou_points": "citi",
        "thankyou": "citi",
        "thankyou points": "citi",
        "thankyou_points": "citi",
        "citi_typ": "citi",
        "capital one": "capitalone",
        "capital one miles": "capitalone",
        "capital_one": "capitalone",
        "capital_one_miles": "capitalone",
        "capitalone": "capitalone",
        "venture": "capitalone",
        "c1": "capitalone",
        "bilt": "bilt",
        "bilt rewards": "bilt",
        "bilt_rewards": "bilt",
    }
    
    # Airline mappings (uppercase 2-letter codes)
    airline_mapping = {
        "united": "UA",
        "united mileageplus": "UA",
        "mileageplus": "UA",
        "american": "AA",
        "american airlines": "AA",
        "american airlines aadvantage": "AA",
        "aadvantage": "AA",
        "american aadvantage": "AA",
        "delta": "DL",
        "delta skymiles": "DL",
        "skymiles": "DL",
        "alaska": "AS",
        "alaska mileage plan": "AS",
        "alaska mileage": "AS",
        "mileage plan": "AS",
        "jetblue": "B6",
        "jetblue trueblue": "B6",
        "trueblue": "B6",
        "southwest": "WN",
        "southwest rapid rewards": "WN",
        "rapid rewards": "WN",
        "air canada": "AC",
        "aeroplan": "AC",
        "british airways": "BA",
        "avios": "BA",
        "british airways avios": "BA",
        "air france": "AF",
        "air france-klm": "AF",
        "air france / klm flying blue": "AF",
        "flying blue": "AF",
        "klm": "KL",
        "lufthansa": "LH",
        "lufthansa miles & more": "LH",
        "miles & more": "LH",
        "swiss": "LX",
        "virgin atlantic": "VS",
        "virgin atlantic flying club": "VS",
        "singapore": "SQ",
        "singapore airlines": "SQ",
        "krisflyer": "SQ",
        "cathay": "CX",
        "cathay pacific": "CX",
        "cathay pacific asia miles": "CX",
        "asia miles": "CX",
        "ana": "NH",
        "all nippon airways": "NH",
        "all nippon airways mileage club": "NH",
        "jal": "JL",
        "japan airlines": "JL",
        "japan airlines mileage bank": "JL",
        "emirates": "EK",
        "emirates skywards": "EK",
        "skywards": "EK",
        "qatar": "QR",
        "qatar privilege club": "QR",
        "privilege club": "QR",
        "etihad": "EY",
        "etihad guest": "EY",
        "turkish": "TK",
        "turkish airlines": "TK",
        "turkish airlines miles&smiles": "TK",
        "avianca": "AV",
        "avianca lifemiles": "AV",
        "lifemiles": "AV",
        "iberia": "IB",
        "iberia avios": "IB",
        "qantas": "QF",
        "qantas frequent flyer": "QF",
    }
    
    # Hotel mappings (uppercase program codes)
    hotel_mapping = {
        "marriott": "MAR",
        "marriott bonvoy": "MAR",
        "bonvoy": "MAR",
        "hilton": "HH",
        "hilton honors": "HH",
        "hyatt": "HYATT",
        "hyatt world of hyatt": "HYATT",
        "world of hyatt": "HYATT",
        "ihg": "IHG",
        "ihg rewards": "IHG",
        "ihg rewards club": "IHG",
    }
    
    # Check mappings in order: bank, airline, hotel
    if s in bank_mapping:
        return bank_mapping[s]
    if s in airline_mapping:
        return airline_mapping[s]
    if s in hotel_mapping:
        return hotel_mapping[s]
    
    # Fallback: check if it's already a short code (2-3 letter airline code or lowercase bank)
    original_stripped = program.strip()
    if len(original_stripped) <= 3 and original_stripped.isupper():
        # Likely an airline code like "UA", "AA", "DL"
        return original_stripped
    if len(original_stripped) <= 10 and original_stripped.islower():
        # Likely a bank code like "amex", "chase"
        return original_stripped
    
    # Last resort: return lowercase stripped (for unrecognized programs)
    return s

_HUMANIZE_AIRLINE: Dict[str, str] = {
    "UA": "United MileagePlus", "AA": "American AAdvantage", "DL": "Delta SkyMiles",
    "AS": "Alaska Mileage Plan", "B6": "JetBlue TrueBlue", "AC": "Aeroplan",
    "BA": "British Airways Avios", "AF": "Air France / KLM Flying Blue", "KL": "KLM Flying Blue",
    "LH": "Lufthansa Miles & More", "LX": "Swiss Miles & More",
    "SQ": "Singapore KrisFlyer", "CX": "Cathay Asia Miles", "NH": "ANA Mileage Club", "JL": "JAL Mileage Bank",
    "EK": "Emirates Skywards", "QR": "Qatar Privilege Club", "EY": "Etihad Guest", "TK": "Turkish Miles&Smiles",
    "AV": "Avianca LifeMiles", "IB": "Iberia Avios", "QF": "Qantas Frequent Flyer", "VS": "Virgin Atlantic Flying Club",
    "KE": "Korean Air", "OZ": "Asiana", "CI": "China Airlines", "BR": "EVA Air",
}

# Transfer portal URLs and transfer details
# Use the enhanced BANK_METADATA from transfer_strategy.py and supplement with additional details
_TRANSFER_DETAILS: Dict[str, Dict[str, str]] = {
    "amex": {
        "portal_url": BANK_METADATA.get("amex", {}).get("portal_url", "https://global.americanexpress.com/rewards"),
        "transfer_time": BANK_METADATA.get("amex", {}).get("default_transfer_time", "1-2 business days"),
        "ratio": "1:1",
        "min_transfer": "1,000 points",
        "full_name": BANK_METADATA.get("amex", {}).get("name", "American Express Membership Rewards"),
    },
    "chase": {
        "portal_url": BANK_METADATA.get("chase", {}).get("portal_url", "https://ultimaterewardspoints.chase.com"),
        "transfer_time": BANK_METADATA.get("chase", {}).get("default_transfer_time", "instant"),
        "ratio": "1:1",
        "min_transfer": "1,000 points",
        "full_name": BANK_METADATA.get("chase", {}).get("name", "Chase Ultimate Rewards"),
    },
    "citi": {
        "portal_url": BANK_METADATA.get("citi", {}).get("portal_url", "https://thankyou.citi.com"),
        "transfer_time": BANK_METADATA.get("citi", {}).get("default_transfer_time", "instant to 24 hours"),
        "ratio": "1:1",
        "min_transfer": "1,000 points",
        "full_name": BANK_METADATA.get("citi", {}).get("name", "Citi ThankYou Points"),
    },
    "capitalone": {
        "portal_url": BANK_METADATA.get("capitalone", {}).get("portal_url", "https://www.capitalone.com/credit-cards/benefits/travel/"),
        "transfer_time": BANK_METADATA.get("capitalone", {}).get("default_transfer_time", "instant to 2 days"),
        "ratio": "varies by partner",
        "min_transfer": "100 miles",
        "full_name": BANK_METADATA.get("capitalone", {}).get("name", "Capital One Miles"),
    },
    "bilt": {
        "portal_url": BANK_METADATA.get("bilt", {}).get("portal_url", "https://www.biltrewards.com"),
        "transfer_time": BANK_METADATA.get("bilt", {}).get("default_transfer_time", "instant"),
        "ratio": "1:1",
        "min_transfer": "1,000 points",
        "full_name": BANK_METADATA.get("bilt", {}).get("name", "Bilt Rewards"),
        "special_note": "Best value: Transfer on rent payment day (1st of month)",
    },
}

# Airline booking portal URLs - use PROGRAM_METADATA from transfer_strategy.py
def _get_airline_booking_url(airline_code: str) -> str:
    """Get booking URL for an airline from PROGRAM_METADATA."""
    meta = PROGRAM_METADATA.get(airline_code.upper(), {})
    return meta.get("booking_url", "")

# Fallback URLs for airlines not in PROGRAM_METADATA
_AIRLINE_BOOKING_URLS: Dict[str, str] = {
    code: PROGRAM_METADATA.get(code, {}).get("booking_url", url)
    for code, url in {
        "UA": "https://www.united.com",
        "AA": "https://www.aa.com",
        "DL": "https://www.delta.com",
        "AS": "https://www.alaskaair.com",
        "B6": "https://www.jetblue.com",
        "AC": "https://www.aircanada.com",
        "BA": "https://www.britishairways.com",
        "AF": "https://www.airfrance.com",
        "KL": "https://www.klm.com",
        "LH": "https://www.lufthansa.com",
        "LX": "https://www.swiss.com",
        "SQ": "https://www.singaporeair.com",
        "CX": "https://www.cathaypacific.com",
        "NH": "https://www.ana.co.jp",
        "JL": "https://www.jal.co.jp",
        "EK": "https://www.emirates.com",
        "QR": "https://www.qatarairways.com",
        "EY": "https://www.etihad.com",
        "TK": "https://www.turkishairlines.com",
        "AV": "https://www.lifemiles.com",
        "IB": "https://www.iberia.com",
        "QF": "https://www.qantas.com",
        "VS": "https://www.virginatlantic.com",
        "KE": "https://www.koreanair.com",
    }.items()
}

# Small/regional airports that often lack direct long-haul flight data in SERP/AwardTool.
# When flight search returns no edges for origin->dest, we try (origin->hub) ground + (hub->dest) flights.
# Map: IATA -> list of nearby major hubs to try (closest first).
SMALL_AIRPORT_NEARBY_HUBS: Dict[str, List[str]] = {
    "ITH": ["SYR", "BUF", "ALB", "EWR", "JFK"],   # Ithaca, NY
    "BGM": ["SYR", "ALB", "EWR", "JFK"],           # Binghamton, NY
    "ELM": ["SYR", "ITH", "BGM", "EWR", "JFK"],   # Elmira, NY
    "SYR": ["BUF", "ALB", "EWR", "JFK"],           # Syracuse (if no CDG etc.)
}


def _parse_trip_duration_days(trip: Dict[str, Any]) -> int:
    """
    Best‑effort calculation of trip duration (in days) from start/end dates.
    When dates are empty (flexible), uses trip.durationDays / duration_days from user input.
    Falls back to 7 if missing.
    """
    start_date = (trip or {}).get("startDate") or ""
    end_date = (trip or {}).get("endDate") or ""

    try:
        if start_date and end_date and str(start_date).strip() and str(end_date).strip():
            start_dt = datetime.strptime(str(start_date).strip(), "%Y-%m-%d")
            end_dt = datetime.strptime(str(end_date).strip(), "%Y-%m-%d")
            days = (end_dt.date() - start_dt.date()).days or 1
            return max(days, 1)
    except Exception:
        pass

    # When dates are flexible/empty: use user-provided duration_days
    d = (trip or {}).get("durationDays") or (trip or {}).get("duration_days")
    if d is not None:
        try:
            n = int(d)
            if 1 <= n <= 365:
                return n
        except (TypeError, ValueError):
            pass
    return 7


def _calculate_minimum_budget(num_cities: int, total_days: int) -> int:
    """
    Calculate the absolute minimum budget needed for a trip.
    Used to provide realistic budget suggestions when user's budget is too low.
    
    Args:
        num_cities: Number of cities to visit (stays, not including origin/transit)
        total_days: Total trip duration in days
    
    Returns:
        Minimum budget in dollars
    """
    # Fixed costs (flights + activities only, no hotels)
    base_cost_per_day = 120
    base_cost_per_city = 200
    
    # Minimum: 1 day per city
    min_days = max(num_cities, total_days // 2)  # Use at least half the total days
    min_budget = int(min_days * base_cost_per_day + num_cities * base_cost_per_city)
    
    # Add 20% buffer for flight costs and contingency
    return int(min_budget * 1.2)


def _generate_minimal_fallback_itinerary(trip_id: str, reason: str = "Unknown error") -> List[Dict[str, Any]]:
    """
    Generate a minimal fallback itinerary when all else fails.
    This is the absolute last resort to ensure we always return something.
    
    Args:
        trip_id: Trip ID
        reason: Reason for fallback
    
    Returns:
        List with one minimal itinerary item and a warning
    """
    logger.warning(f"Generating minimal fallback itinerary for trip {trip_id}: {reason}")
    
    items = [
        {
            "tripId": trip_id,
            "itemId": "fallback_itinerary_1",
            "type": "itinerary",
            "name": "Basic route estimate",
            "route": [],
            "cities": [{"name": "Your destination", "days": 7}],
            "totalCost": 3000,  # Reasonable default estimate
            "pointsCost": 75000,  # Reasonable default estimate
            "score": 75,
            "withinBudget": False,  # Mark as uncertain
            "withinPoints": False,
        },
        {
            "tripId": trip_id,
            "itemId": "fallback_warning",
            "type": "fallback_warning",
            "message": (
                f"We encountered an issue generating your itinerary: {reason}. "
                "Please ensure your trip has valid destinations, dates, and budget settings. "
                "The estimate shown above is a placeholder."
            ),
        },
    ]
    
    # Try to save to DB (but don't fail if this fails)
    try:
        itinerary_repo.batch_write_items(items)
    except Exception as e:
        logger.error(f"Failed to save fallback itinerary: {e}")
    
    return items


def save_itinerary(trip_id: str, route: List[str]) -> Dict[str, Any]:
    # MVP: store one item that contains the chosen route as JSON
    item_id = "route"
    item = {"tripId": trip_id, "itemId": item_id, "type": "route", "route": route}
    itinerary_repo.put_item(item)
    return item


def get_itinerary(trip_id: str) -> List[Dict[str, Any]]:
    return itinerary_repo.list_items(trip_id)


def generate_simple_itineraries(trip_id: str, safe_mode: bool = False) -> List[Dict[str, Any]]:
    """
    Lightweight, dependency‑free itinerary generator.

    Generates 1–5 itineraries within budget and points constraints. It:
      - Reads the trip (including maxBudget), destinations, and points summary
      - Builds route variants: Balanced, Reverse, Budget (fits max_budget), Explorer (more cities if under budget)
      - Ensures totalCost <= max_budget and pointsCost <= total_points when set
      - Adds withinBudget and withinPoints to each item for UI badges

    The frontend treats these as "routes" for display and comparison.
    
    Args:
        trip_id: Trip ID to generate itineraries for
        safe_mode: If True, returns a minimal default itinerary instead of raising errors
    """
    # Load trip + destinations
    trip = trip_service.get_trip(trip_id)
    if not trip:
        if safe_mode:
            # Return minimal default itinerary instead of failing
            logger.warning(f"Trip {trip_id} not found in safe_mode; returning default itinerary")
            return _generate_minimal_fallback_itinerary(trip_id, "Trip not found")
        raise ValueError(f"Trip {trip_id} not found")

    max_budget = trip.get("maxBudget") or trip.get("max_budget")
    if max_budget is not None:
        try:
            max_budget = int(max_budget)
        except (TypeError, ValueError):
            max_budget = None

    # Total points available for the trip
    total_points = 0
    try:
        summary = points_service.trip_points_summary(trip_id)
        total_points = int(summary.get("totalPoints") or 0)
    except Exception:
        pass

    destinations = destination_service.list_destinations(trip_id)
    if not destinations:
        if safe_mode:
            logger.warning(f"No destinations for trip {trip_id} in safe_mode; returning default itinerary")
            return _generate_minimal_fallback_itinerary(trip_id, "No destinations found")
        raise ValueError("No destinations found for trip. Please add at least one destination.")

    # Filter out excluded destinations while preserving original order
    valid_dests: List[Dict[str, Any]] = [d for d in destinations if not d.get("excluded", False)]
    if not valid_dests:
        if safe_mode:
            logger.warning(f"All destinations excluded for trip {trip_id} in safe_mode; returning default itinerary")
            return _generate_minimal_fallback_itinerary(trip_id, "All destinations are excluded")
        raise ValueError("All destinations are excluded. Please add at least one active destination.")

    # Determine start / end. Prefer explicit isStart/isEnd so the route uses the correct
    # start/end regardless of add order. Fallback: mustInclude order, then first/last.
    must_include = [d for d in valid_dests if d.get("mustInclude", False)]
    start_dest = next((d for d in valid_dests if d.get("isStart", False)), None)
    end_dest = next((d for d in valid_dests if d.get("isEnd", False)), None)
    if start_dest is None:
        start_dest = must_include[0] if must_include else valid_dests[0]
    if end_dest is None:
        end_dest = must_include[-1] if must_include else (valid_dests[-1] if len(valid_dests) > 1 else valid_dests[0])

    def _city_name(d: Dict[str, Any]) -> str:
        return (d.get("name") or d.get("destinationId") or "").strip()

    # When must_include exists: Start/End are departure/return airports (transit only, no days).
    # Stays = only "Destinations" (mustInclude: false). Route = start -> stays -> end.
    # When no must_include: first/last are inferred; all dests are stays. Route = valid_dests order.
    if must_include:
        stay_dests = [d for d in valid_dests if not d.get("mustInclude", False)]
        route_dests = [start_dest] + stay_dests + [end_dest]
    else:
        stay_dests = list(valid_dests)
        route_dests = list(valid_dests)

    stay_names = [_city_name(d) for d in stay_dests if _city_name(d)]
    stay_ids = [d.get("destinationId") for d in stay_dests if _city_name(d)]
    route_names = [_city_name(d) for d in route_dests if _city_name(d)]
    route_ids = [d.get("destinationId") for d in route_dests if _city_name(d)]

    total_days = _parse_trip_duration_days(trip)
    num_stops = max(len(stay_names), 1)
    base_days = max(total_days // num_stops, 2)

    # Fixed costs (flights + activities only, no hotels)
    base_cost_per_day = 120
    base_cost_per_city = 200
    points_per_dollar = 25  # rough valuation

    def _build_city_objects(
        names: List[str],
        ids: List[Any],
        days_per: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        d = days_per if days_per is not None else base_days
        return [{"name": n, "days": d} for n in names if n]

    def _cost(city_objs: List[Dict[str, Any]]) -> int:
        stay = sum(c.get("days", base_days) for c in city_objs) or total_days
        return int(stay * base_cost_per_day + len(city_objs) * base_cost_per_city)

    def _points(cost: int) -> int:
        return int(cost * points_per_dollar)

    # ---- Build 1–10 route variants ----
    routes: List[Dict[str, Any]] = []

    # 1. Balanced (forward order): route = start -> stays -> end; only stays get days
    bal_cities = _build_city_objects(stay_names, stay_ids)
    routes.append({
        "label": "Balanced route",
        "route_ids": route_ids,
        "cities": bal_cities,
        "weight_factor": 1.0,
    })
    
    # Calculate base cost from the balanced route (used for budget checks below)
    bal_cost = _cost(routes[0]["cities"])

    # 2. Reverse (if different): reverse only the stay order; start/end stay at path ends
    if len(stay_names) > 1:
        rev_route_ids = [route_ids[0]] + list(reversed(route_ids[1:-1])) + [route_ids[-1]]
        if rev_route_ids != route_ids:
            routes.append({
                "label": "Reverse route",
                "route_ids": rev_route_ids,
                "cities": _build_city_objects(list(reversed(stay_names)), list(reversed(stay_ids))),
                "weight_factor": 0.95,
            })

    # 3. Budget: keep all user destinations; only reduce days to fit max_budget (stays only)
    # This variant always succeeds even with very low budgets (minimum 1 day per city)
    if max_budget is not None and max_budget > 0:
        n = max(len(stay_names), 1)
        room = max_budget - n * base_cost_per_city
        if room > 0:
            max_stay = room // base_cost_per_day
            budget_days = max(1, min(base_days, max(1, max_stay // n)))  # Minimum 1 day per city
        else:
            # Even with zero room, create a minimal variant (1 day per city)
            budget_days = 1
        budget_cities = _build_city_objects(stay_names, stay_ids, days_per=budget_days)
        routes.append({
            "label": "Budget pick",
            "route_ids": route_ids,
            "cities": budget_cities,
            "weight_factor": 0.92,
        })

    # 4. Extended stay: add more days to longest city (when budget allows)
    if max_budget is None or max_budget > bal_cost * 1.3:
        extended_cities = _build_city_objects(stay_names, stay_ids, days_per=base_days + 2)
        routes.append({
            "label": "Extended stay",
            "route_ids": route_ids,
            "cities": extended_cities,
            "weight_factor": 0.98,
        })

    # 5. Quick trip: shorter days per city (minimum 2 days each)
    if len(stay_names) >= 2:
        quick_cities = _build_city_objects(stay_names, stay_ids, days_per=max(2, base_days - 1))
        routes.append({
            "label": "Quick trip",
            "route_ids": route_ids,
            "cities": quick_cities,
            "weight_factor": 0.90,
        })

    # 6. Explorer: more cities only if we're well under budget and have more stay destinations
    if (
        len(stay_names) >= 3
        and (max_budget is None or bal_cost <= (max_budget * 0.7))
        and len(routes) < 10
    ):
        expl_cities = _build_city_objects(stay_names, stay_ids)
        routes.append({
            "label": "Explorer",
            "route_ids": route_ids,
            "cities": expl_cities,
            "weight_factor": 1.02,
        })

    # 7-10. Variations with different day distributions (when we have 3+ destinations)
    if len(stay_names) >= 3 and len(routes) < 10:
        # Focus on first city
        focus_first = _build_city_objects(stay_names, stay_ids)
        if len(focus_first) >= 3:
            focus_first[0]["days"] = base_days + 2
            focus_first[-1]["days"] = max(2, base_days - 1)
            routes.append({
                "label": "Focus on arrival city",
                "route_ids": route_ids,
                "cities": focus_first,
                "weight_factor": 0.93,
            })
        
        # Focus on last city
        focus_last = _build_city_objects(stay_names, stay_ids)
        if len(focus_last) >= 3:
            focus_last[0]["days"] = max(2, base_days - 1)
            focus_last[-1]["days"] = base_days + 2
            routes.append({
                "label": "Focus on final city",
                "route_ids": route_ids,
                "cities": focus_last,
                "weight_factor": 0.93,
            })
        
        # Even split (all cities get equal days)
        even_days = max(2, total_days // len(stay_names))
        even_cities = _build_city_objects(stay_names, stay_ids, days_per=even_days)
        routes.append({
            "label": "Even split",
            "route_ids": route_ids,
            "cities": even_cities,
            "weight_factor": 0.96,
        })
        
        # Mixed pace (alternate between longer and shorter stays)
        if len(stay_names) >= 4:
            mixed_cities = _build_city_objects(stay_names, stay_ids)
            for i in range(len(mixed_cities)):
                mixed_cities[i]["days"] = (base_days + 1) if i % 2 == 0 else max(2, base_days - 1)
            routes.append({
                "label": "Mixed pace",
                "route_ids": route_ids,
                "cities": mixed_cities,
                "weight_factor": 0.94,
            })

    # Cap at 10
    routes = routes[:10]

    # ---- Build items with withinBudget / withinPoints ----
    items: List[Dict[str, Any]] = []
    existing_items = itinerary_repo.list_items(trip_id) or []
    existing_ids = {i.get("itemId") for i in existing_items}

    def _next_item_id(idx: int) -> str:
        candidate = f"itinerary_{idx}"
        n = idx
        while candidate in existing_ids:
            n += 1
            candidate = f"itinerary_{n}"
        existing_ids.add(candidate)
        return candidate

    # Calculate minimum budget needed and check if user's budget is too low
    min_budget_needed = _calculate_minimum_budget(len(stay_names), total_days)
    budget_too_low = max_budget is not None and max_budget > 0 and max_budget < min_budget_needed
    
    for idx, r in enumerate(routes, start=1):
        city_objs = r["cities"]
        total_cost = _cost(city_objs)
        points_cost = _points(total_cost)

        within_budget = max_budget is None or max_budget <= 0 or total_cost <= max_budget
        within_points = total_points <= 0 or points_cost <= total_points

        score = 88
        if len(city_objs) >= 4:
            score += 4
        elif len(city_objs) >= 2:
            score += 2
        score = int(score * r.get("weight_factor", 1.0))
        if within_budget and within_points:
            score = min(99, score + 3)
        score = max(75, min(score, 99))

        item = {
            "tripId": trip_id,
            "itemId": _next_item_id(idx),
            "type": "itinerary",
            "name": r["label"],
            "route": r["route_ids"],
            "cities": city_objs,
            "totalCost": total_cost,
            "pointsCost": points_cost,
            "score": score,
            "withinBudget": within_budget,
            "withinPoints": within_points,
        }
        items.append(item)

    # Add budget warning item if user's budget is too low
    if budget_too_low and max_budget is not None:
        warning_item = {
            "tripId": trip_id,
            "itemId": "budget_warning",
            "type": "budget_warning",
            "message": (
                f"Your budget of ${max_budget:,} may be too low for this trip. "
                f"We recommend at least ${min_budget_needed:,} for {len(stay_names)} cities over {total_days} days. "
                f"The itineraries shown above may exceed your budget."
            ),
            "user_budget": max_budget,
            "recommended_budget": min_budget_needed,
        }
        items.append(warning_item)

    # Write all items in a single batch (more efficient than individual put_item calls)
    itinerary_repo.batch_write_items(items)

    dest_names = [c["name"] for c in (routes[0]["cities"] if routes else [])]
    logger.info(
        f"Generated {len(items)} simple itineraries for trip {trip_id} "
        f"(max_budget={max_budget}, total_points={total_points}, min_budget_needed={min_budget_needed}); "
        f"destinations={dest_names}"
    )
    return items


def _is_airport_code(name: str) -> bool:
    """Check if a string looks like an airport code (3 uppercase letters)"""
    return bool(re.match(r'^[A-Z]{3}$', name.strip().upper()))


def _normalize_city_to_code(city_name: str) -> Optional[str]:
    """
    Convert city name to airport code.
    If already a code, return it. Otherwise, try to find the primary airport.
    Handles formats like:
    - "JFK" -> "JFK"
    - "New York" -> searches for airport
    - "New York (JFK,LGA,EWR)" -> extracts "JFK" (first code)
    - "Seoul (GMP,ICN)" -> extracts "ICN" (prefers main international airport)
    """
    city_name = city_name.strip()
    
    # If it's already an airport code, return it
    if _is_airport_code(city_name):
        return city_name.upper()
    
    # Check if it's in format "City (CODE1,CODE2,CODE3)" and extract best code
    import re
    code_match = re.search(r'\(([A-Z]{3}(?:,[A-Z]{3})*)\)', city_name.upper())
    if code_match:
        # Extract all airport codes from comma-separated list
        codes = [c.strip() for c in code_match.group(1).split(',')]
        
        # Prefer main international airports over domestic/secondary
        # This mapping helps select the best airport for international travel
        PREFERRED_AIRPORTS = {
            # Seoul: ICN (Incheon) is main international, GMP (Gimpo) is domestic
            'ICN': 10, 'GMP': 1,
            # Tokyo: NRT (Narita) and HND (Haneda) both international
            'NRT': 10, 'HND': 9,
            # London: LHR (Heathrow) is main, others secondary
            'LHR': 10, 'LGW': 7, 'STN': 5, 'LTN': 4, 'SEN': 3,
            # New York: JFK is main international
            'JFK': 10, 'EWR': 8, 'LGA': 6,
            # Paris: CDG is main international
            'CDG': 10, 'ORY': 7,
            # Dubai: DXB is main
            'DXB': 10, 'DWC': 5,
            # Shanghai: PVG is international, SHA is domestic
            'PVG': 10, 'SHA': 5,
            # Beijing: PEK and PKX both international
            'PEK': 10, 'PKX': 9,
            # San Francisco: SFO is main
            'SFO': 10, 'OAK': 6, 'SJC': 5,
            # Los Angeles: LAX is main
            'LAX': 10, 'BUR': 5, 'SNA': 5, 'ONT': 4, 'LGB': 3,
            # Chicago: ORD is main international
            'ORD': 10, 'MDW': 6,
            # Washington DC: IAD (Dulles) for international
            'IAD': 10, 'DCA': 7, 'BWI': 6,
            # Milan: MXP is main international
            'MXP': 10, 'LIN': 5, 'BGY': 4,
            # Rome: FCO is main
            'FCO': 10, 'CIA': 4,
        }
        
        # Sort by preference (highest first), then by original order for ties
        def get_priority(code):
            return (-PREFERRED_AIRPORTS.get(code, 5), codes.index(code))
        
        sorted_codes = sorted(codes, key=get_priority)
        best_code = sorted_codes[0]
        
        if _is_airport_code(best_code):
            return best_code.upper()
    
    # Try to find airport code using city search
    # Remove the airport codes part if present for searching
    search_name = re.sub(r'\s*\([A-Z]{3}(?:,[A-Z]{3})*\)', '', city_name).strip()
    
    try:
        results = city_service.search_cities(search_name, max_results=5)
        if results:
            # Prefer airport type results
            for result in results:
                iata_code = result.get("iataCode", "")
                if iata_code and _is_airport_code(iata_code):
                    return iata_code.upper()
            
            # Fallback to first result with IATA code
            for result in results:
                iata_code = result.get("iataCode", "")
                if iata_code:
                    return iata_code.upper()
    except Exception as e:
        logger.warning(f"Error searching for airport code for {city_name}: {e}")

    # Fallback 2: Try direct CSV lookup using airport_service
    # This ensures we find airports like Vienna (VIE) and Prague (PRG) even if Amadeus is unavailable
    # The CSV contains 40,000+ airports - comprehensive coverage without needing OpenAI
    try:
        from src.services.airport_service import search_airports
        airport_results = search_airports(search_name, max_results=5)
        if airport_results:
            for result in airport_results:
                iata_code = result.get("iata_code", "")
                if iata_code and _is_airport_code(iata_code):
                    logger.info(f"Found airport code {iata_code} for '{city_name}' via CSV lookup")
                    return iata_code.upper()
    except Exception as e:
        logger.debug(f"CSV airport lookup for {city_name}: {e}")
    
    # Fallback 3: try to extract code from name (e.g., "New York (JFK)" or "New York (JFK,LGA,EWR)")
    # Handle both single code and multiple codes - prefer main international airport
    match = re.search(r'\(([A-Z]{3}(?:,[A-Z]{3})*)\)', city_name.upper())
    if match:
        codes = [c.strip() for c in match.group(1).split(',')]
        # Use same preference logic as above
        PREFERRED_AIRPORTS = {
            'ICN': 10, 'GMP': 1, 'NRT': 10, 'HND': 9, 'LHR': 10, 'LGW': 7,
            'JFK': 10, 'EWR': 8, 'LGA': 6, 'CDG': 10, 'ORY': 7,
            'DXB': 10, 'DWC': 5, 'PVG': 10, 'SHA': 5, 'SFO': 10, 'OAK': 6,
            'LAX': 10, 'ORD': 10, 'MDW': 6, 'IAD': 10, 'DCA': 7, 'MXP': 10,
        }
        def get_priority(code):
            return (-PREFERRED_AIRPORTS.get(code, 5), codes.index(code))
        sorted_codes = sorted(codes, key=get_priority)
        best_code = sorted_codes[0]
        if _is_airport_code(best_code):
            logger.info(f"Extracted airport code {best_code} from '{city_name}' via name parsing")
            return best_code.upper()
    
    # If all lookups fail, log a warning
    logger.warning(f"FAILED to resolve airport code for city '{city_name}' - all lookups exhausted")
    return None


def _get_all_airports_for_city(city_name: str) -> List[str]:
    """
    Get ALL airport codes for a city (not just the primary one).
    This is used when the optimization should consider flights from multiple airports.
    
    Examples:
    - "Seattle" -> ["SEA", "PAE"] (Seattle-Tacoma and Paine Field)
    - "New York (JFK,LGA,EWR)" -> ["JFK", "LGA", "EWR"]
    - "Paris (CDG,ORY)" -> ["CDG", "ORY"]
    - "JFK" -> ["JFK"] (already a code)
    
    Returns list of airport codes, or empty list if none found.
    """
    import re
    city_name = city_name.strip()
    
    # If it's already an airport code, return it as a list
    if _is_airport_code(city_name):
        return [city_name.upper()]
    
    # Check if it's in format "City (CODE1,CODE2,CODE3)"
    code_match = re.search(r'\(([A-Z]{3}(?:,[A-Z]{3})*)\)', city_name.upper())
    if code_match:
        codes = [c.strip() for c in code_match.group(1).split(',') if c.strip()]
        return [c for c in codes if _is_airport_code(c)]
    
    # For cities without codes in name, try to find airports via city service
    search_name = re.sub(r'\s*\([A-Z]{3}(?:,[A-Z]{3})*\)', '', city_name).strip()
    
    # Known metro areas with multiple airports
    METRO_AIRPORTS = {
        "seattle": ["SEA", "PAE"],
        "new york": ["JFK", "EWR", "LGA"],
        "nyc": ["JFK", "EWR", "LGA"],
        "los angeles": ["LAX", "BUR", "SNA", "ONT", "LGB"],
        "la": ["LAX", "BUR", "SNA", "ONT", "LGB"],
        "san francisco": ["SFO", "OAK", "SJC"],
        "sf": ["SFO", "OAK", "SJC"],
        "bay area": ["SFO", "OAK", "SJC"],
        "chicago": ["ORD", "MDW"],
        "washington": ["IAD", "DCA", "BWI"],
        "washington dc": ["IAD", "DCA", "BWI"],
        "dc": ["IAD", "DCA", "BWI"],
        "london": ["LHR", "LGW", "STN", "LTN"],
        "paris": ["CDG", "ORY"],
        "tokyo": ["NRT", "HND"],
        "seoul": ["ICN", "GMP"],
        "miami": ["MIA", "FLL"],
        "dallas": ["DFW", "DAL"],
        "houston": ["IAH", "HOU"],
        "boston": ["BOS", "PVD"],
        "detroit": ["DTW", "FNT"],
        "milan": ["MXP", "LIN", "BGY"],
        "rome": ["FCO", "CIA"],
        "shanghai": ["PVG", "SHA"],
        "beijing": ["PEK", "PKX"],
        "dubai": ["DXB", "DWC"],
    }
    
    # Check known metro areas
    search_lower = search_name.lower()
    for metro, airports in METRO_AIRPORTS.items():
        if metro in search_lower or search_lower in metro:
            return airports
    
    # Try city service for single airport
    try:
        results = city_service.search_cities(search_name, max_results=10)
        airports = []
        for result in results:
            iata_code = result.get("iataCode", "")
            if iata_code and _is_airport_code(iata_code):
                code = iata_code.upper()
                if code not in airports:
                    airports.append(code)
        if airports:
            return airports[:5]  # Return up to 5 airports
    except Exception as e:
        logger.debug(f"Error searching airports for {city_name}: {e}")
    
    # Fallback: return single code from normalize function
    single = _normalize_city_to_code(city_name)
    return [single] if single else []


def _validate_date(date_str: str, field_name: str = "date") -> None:
    """Validate date format and ensure it's in the future"""
    if not date_str or not date_str.strip():
        raise ValueError(f"{field_name} is required")
    
    try:
        # Try common date formats
        for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y"]:
            try:
                date_obj = datetime.strptime(date_str.strip(), fmt)
                # Check if date is in the future (allow today)
                if date_obj.date() < datetime.now().date():
                    raise ValueError(f"{field_name} must be today or in the future")
                return
            except ValueError:
                continue
        raise ValueError(f"{field_name} format is invalid. Use YYYY-MM-DD format")
    except ValueError as e:
        if "must be today" in str(e) or "format is invalid" in str(e):
            raise
        raise ValueError(f"{field_name} format is invalid. Use YYYY-MM-DD format")


def _best_effort_path_from_edges(
    edges_dict: Dict[Tuple[str, str, str], Dict[str, Any]],
    start_city_by_trav: Dict[str, str],
    end_city_by_trav: Dict[str, str],
    travelers: List[str],
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Find the minimum cash-cost path from start to end in the graph.
    Returns (solution_dict, message) or (None, None) if no path exists.
    Used when ILP is infeasible to suggest a route that may exceed budget/points.
    """
    if not travelers:
        return (None, None)
    start = start_city_by_trav.get(travelers[0]) or ""
    end = end_city_by_trav.get(travelers[0]) or ""
    if not start or not end:
        return (None, None)

    # For each (i,j) keep the edge with minimum cash_cost
    best: Dict[Tuple[str, str], Tuple[Tuple[str, str, str], float]] = {}
    for (i, j, k), d in edges_dict.items():
        try:
            cost = float(d.get("cash_cost") or 1e7)
        except (TypeError, ValueError):
            cost = 1e7
        if (i, j) not in best or cost < best[(i, j)][1]:
            best[(i, j)] = ((i, j, k), cost)

    adj: Dict[str, List[Tuple[str, float, Tuple[str, str, str]]]] = {}
    for (i, j), (edge, cost) in best.items():
        adj.setdefault(i, []).append((j, cost, edge))

    # Dijkstra
    INF = 10 ** 9
    dist: Dict[str, float] = {start: 0.0}
    parent: Dict[str, Tuple[str, Tuple[str, str, str]]] = {}
    heap: List[Tuple[float, str]] = [(0.0, start)]
    while heap:
        d, u = heapq.heappop(heap)
        if u == end:
            break
        if d > dist.get(u, INF):
            continue
        for v, cost, edge in adj.get(u, []):
            nd = d + cost
            if nd < dist.get(v, INF):
                dist[v] = nd
                parent[v] = (u, edge)
                heapq.heappush(heap, (nd, v))

    if end not in parent:
        return (None, None)

    # Recover path edges
    path_edges: List[Tuple[str, str, str]] = []
    cur = end
    while cur in parent:
        u, e = parent[cur]
        path_edges.append(e)
        cur = u
    path_edges.reverse()
    path_nodes = [start] + [e[1] for e in path_edges]

    # Build pay_mode (all cash) and totals
    total_cash = 0.0
    total_time = 0.0
    payer = travelers[0]
    pay_list: List[Dict[str, Any]] = []
    for e in path_edges:
        d = edges_dict.get(e, {})
        try:
            cash = float(d.get("cash_cost") or 0)
        except (TypeError, ValueError):
            cash = 0.0
        try:
            total_time += float(d.get("time_cost") or 0)
        except (TypeError, ValueError):
            pass
        total_cash += cash
        pay_list.append({
            "edge": [e[0], e[1], e[2]],
            "type": "cash",
            "payer": payer,
            "fare": cash,
        })

    solution: Dict[str, Any] = {
        "status": "Optimal",
        "path": {t: list(path_nodes) for t in travelers},
        "edges": {t: [[e[0], e[1], e[2]] for e in path_edges] for t in travelers},
        "pay_mode": {t: list(pay_list) for t in travelers},
        "totals": {
            "airline_points": 0.0,
            "cash": total_cash,
            "time": total_time,
            "points_value": 0.0,
            "transfers": {q: {} for q in travelers},
            "native_used": {q: {} for q in travelers},
        },
    }
    msg = (
        "No feasible solution within your budget and points. "
        "Shown below is the lowest-cost route we found; it may exceed your limits. "
        "Consider increasing your budget, adding more points, or reducing destinations/days."
    )
    return (solution, msg)


def _best_effort_path_multi_traveler(
    edges_dict: Dict[Tuple[str, str, str], Dict[str, Any]],
    start_city_by_trav: Dict[str, str],
    end_city_by_trav: Dict[str, str],
    travelers: List[str],
    must_visit: Optional[List[str]] = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Find minimum cash-cost paths for each traveler independently.
    This handles group trips where members have different start/end airports.
    Returns partial solutions if some travelers have valid routes but others don't.
    """
    logger.info(f"BEST-EFFORT MULTI-TRAVELER: Starting for {len(travelers)} travelers, must_visit={must_visit}")
    logger.info(f"BEST-EFFORT MULTI-TRAVELER: start_cities={list(start_city_by_trav.values())}, end_cities={list(end_city_by_trav.values())}")
    logger.info(f"BEST-EFFORT MULTI-TRAVELER: {len(edges_dict)} edges available")
    
    if not travelers:
        logger.info("BEST-EFFORT MULTI-TRAVELER: No travelers, returning None")
        return (None, None)
    
    # Build adjacency list once
    best: Dict[Tuple[str, str], Tuple[Tuple[str, str, str], float]] = {}
    for (i, j, k), d in edges_dict.items():
        try:
            cost = float(d.get("cash_cost") or 1e7)
        except (TypeError, ValueError):
            cost = 1e7
        if (i, j) not in best or cost < best[(i, j)][1]:
            best[(i, j)] = ((i, j, k), cost)
    
    adj: Dict[str, List[Tuple[str, float, Tuple[str, str, str]]]] = {}
    for (i, j), (edge, cost) in best.items():
        adj.setdefault(i, []).append((j, cost, edge))
    
    def _dijkstra(start: str, end: str, must_pass: Optional[List[str]] = None) -> Optional[Tuple[List[str], List[Tuple[str, str, str]], float]]:
        """Find shortest path from start to end, optionally passing through must_pass cities."""
        if not start or not end:
            return None
        
        # If must_pass is specified, we need to find path through those cities
        if must_pass and len(must_pass) > 0:
            # Try: start -> must_pass[0] -> must_pass[1] -> ... -> end
            waypoints = [start] + list(must_pass) + [end]
            total_path_edges: List[Tuple[str, str, str]] = []
            total_cost = 0.0
            
            for i in range(len(waypoints) - 1):
                segment = _dijkstra(waypoints[i], waypoints[i+1], None)
                if segment is None:
                    return None
                path_nodes, path_edges, cost = segment
                total_path_edges.extend(path_edges)
                total_cost += cost
            
            full_path = [start] + [e[1] for e in total_path_edges]
            return (full_path, total_path_edges, total_cost)
        
        INF = 10 ** 9
        dist: Dict[str, float] = {start: 0.0}
        parent: Dict[str, Tuple[str, Tuple[str, str, str]]] = {}
        heap: List[Tuple[float, str]] = [(0.0, start)]
        
        while heap:
            d, u = heapq.heappop(heap)
            if u == end:
                break
            if d > dist.get(u, INF):
                continue
            for v, cost, edge in adj.get(u, []):
                nd = d + cost
                if nd < dist.get(v, INF):
                    dist[v] = nd
                    parent[v] = (u, edge)
                    heapq.heappush(heap, (nd, v))
        
        if end not in parent and start != end:
            return None
        
        # Recover path
        path_edges: List[Tuple[str, str, str]] = []
        cur = end
        while cur in parent:
            u, e = parent[cur]
            path_edges.append(e)
            cur = u
        path_edges.reverse()
        path_nodes = [start] + [e[1] for e in path_edges]
        
        return (path_nodes, path_edges, dist.get(end, 0.0))
    
    # Try to find paths for each traveler
    paths_by_trav: Dict[str, List[str]] = {}
    edges_by_trav: Dict[str, List[List[str]]] = {}
    pay_mode_by_trav: Dict[str, List[Dict[str, Any]]] = {}
    total_cash = 0.0
    total_time = 0.0
    failed_travelers: List[str] = []
    
    for trav in travelers:
        start = start_city_by_trav.get(trav, "")
        end = end_city_by_trav.get(trav, "")
        
        if not start or not end:
            failed_travelers.append(trav)
            continue
        
        result = _dijkstra(start, end, must_visit)
        if result is None:
            failed_travelers.append(trav)
            logger.warning(f"No path found for traveler {trav[-8:]}: {start} -> {end}")
            continue
        
        path_nodes, path_edges, cost = result
        paths_by_trav[trav] = path_nodes
        edges_by_trav[trav] = [[e[0], e[1], e[2]] for e in path_edges]
        
        # Build pay_mode for this traveler
        pay_list: List[Dict[str, Any]] = []
        trav_cost = 0.0
        for e in path_edges:
            d = edges_dict.get(e, {})
            try:
                cash = float(d.get("cash_cost") or 0)
            except (TypeError, ValueError):
                cash = 0.0
            try:
                total_time += float(d.get("time_cost") or 0)
            except (TypeError, ValueError):
                pass
            trav_cost += cash
            pay_list.append({
                "edge": [e[0], e[1], e[2]],
                "type": "cash",
                "payer": trav,
                "fare": cash,
            })
        
        pay_mode_by_trav[trav] = pay_list
        total_cash += trav_cost
        logger.info(f"Found path for traveler {trav[-8:]}: {start} -> {end}, cost=${trav_cost:.0f}")
    
    # If no travelers have valid paths, return None
    if not paths_by_trav:
        return (None, None)
    
    # Build solution with whatever paths we found
    solution: Dict[str, Any] = {
        "status": "Optimal",
        "path": paths_by_trav,
        "edges": edges_by_trav,
        "pay_mode": pay_mode_by_trav,
        "totals": {
            "airline_points": 0.0,
            "cash": total_cash,
            "time": total_time,
            "points_value": 0.0,
            "transfers": {q: {} for q in travelers if q in paths_by_trav},
            "native_used": {q: {} for q in travelers if q in paths_by_trav},
        },
    }
    
    # Build message
    if failed_travelers:
        msg = (
            f"Found routes for {len(paths_by_trav)} of {len(travelers)} travelers. "
            f"{len(failed_travelers)} member(s) could not be routed - they may need to choose different airports. "
            "The shown route exceeds your budget but is the lowest cost option available."
        )
    else:
        msg = (
            "No feasible solution within your budget and points. "
            "Shown below is the lowest-cost route we found; it may exceed your limits. "
            "Consider increasing your budget, adding more points, or reducing destinations/days."
        )
    
    return (solution, msg)


def build_transfer_tips_from_solution(
    solution: Dict[str, Any],
    _edges_all: Optional[Dict[Any, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    Build transfer_tips from the optimized solution's pay_mode, using AwardTool-derived
    award_points and program. Each tip: where to transfer, how many points, for which segment.
    When edges_all is provided, includes operating carrier (e.g. Korean Air codeshare via Delta).
    Replaces generic AI transfer advice with data-driven amounts and partners.
    Also includes strategy_reason explaining why this transfer strategy was selected.
    Enhanced with detailed transfer instructions including portal URLs, timing, and booking steps.
    """
    out: List[Dict[str, Any]] = []
    pay_mode = solution.get("pay_mode") or {}
    edges_all = _edges_all or {}
    
    # Build strategy reasoning from solution metadata
    strategy_reasons = []
    total_points = 0
    total_cash_saved = 0.0
    programs_used = set()
    partners_used = set()
    route_segments = []

    for _traveler, recs in pay_mode.items():
        for rec in (recs or []):
            if rec.get("type") != "points":
                continue
            via = rec.get("via") or {}
            miles = rec.get("miles")
            if miles is None:
                continue
            miles = int(float(miles))
            sur = rec.get("surcharge")
            try:
                sur_val = float(sur) if sur is not None else None
            except (TypeError, ValueError):
                sur_val = None

            # Calculate points value (cash saved)
            points_value = rec.get("points_value", 0.0)
            if points_value:
                total_cash_saved += float(points_value)
            
            # Calculate cents per point value
            cpp = rec.get("cents_per_point", 0.0)
            if not cpp and points_value and miles > 0:
                cpp = (float(points_value) * 100.0) / miles

            edge = rec.get("edge")
            dep, arr = None, None
            if isinstance(edge, (list, tuple)) and len(edge) >= 2:
                dep, arr = str(edge[0] or "").upper(), str(edge[1] or "").upper()
                best_for = f"{dep}→{arr}" if (dep and arr) else None
                if dep and arr:
                    route_segments.append(f"{dep}→{arr}")
            else:
                best_for = None

            # Operating carrier from AwardTool (codeshare): e.g. KE when booking via DL
            operating_airline = None
            e_tuple = tuple(edge) if isinstance(edge, (list, tuple)) and len(edge) >= 3 else None
            if e_tuple and e_tuple in edges_all:
                op = (edges_all[e_tuple].get("operating_airline") or "").strip().upper()
                if op and len(op) >= 2:
                    operating_airline = op[:2]
            booking_airline = (via.get("airline") or via.get("native") or "").upper().strip()
            
            # Build detailed transfer instructions
            src = None
            al = None
            from_program = None
            to_program = None
            transfer_needed = False
            
            if "source" in via and "airline" in via:
                src = (via.get("source") or "").lower().strip()
                al = (via.get("airline") or "").upper().strip()
                from_program = _HUMANIZE_BANK.get(src) or src or "Credit card points"
                to_program = _HUMANIZE_AIRLINE.get(al) or al or "Travel partner"
                transfer_needed = True
            elif "native" in via:
                al = (via.get("native") or "").upper().strip()
                to_program = _HUMANIZE_AIRLINE.get(al) or al or "Travel partner"
                from_program = "Existing miles"
                transfer_needed = False
            else:
                continue

            # Build detailed note with transfer/booking instructions
            note_parts = []
            
            # Codeshare information
            codeshare_note = ""
            if operating_airline and operating_airline != booking_airline:
                op_name = _HUMANIZE_AIRLINE.get(operating_airline) or operating_airline
                booking_name = _HUMANIZE_AIRLINE.get(booking_airline) or booking_airline
                codeshare_note = f" You'll book through {booking_name} to fly on {op_name} metal (codeshare)."
            
            if transfer_needed:
                # Transfer instructions
                transfer_details = _TRANSFER_DETAILS.get(src, {})
                transfer_time = transfer_details.get("transfer_time", "instant to 24 hours")
                portal_url = transfer_details.get("portal_url", "")
                min_transfer = transfer_details.get("min_transfer", "1,000 points")
                
                note_parts.append(f"Transfer {miles:,} points from {from_program} to {to_program}.")
                note_parts.append(f"Transfer time: {transfer_time}. Minimum: {min_transfer}.")
                
                if portal_url:
                    note_parts.append(f"Portal: {portal_url}")
                
                note_parts.append(f"Once transferred, book on {to_program}'s website.{codeshare_note}")
            else:
                # Native miles usage
                note_parts.append(f"Use {miles:,} existing {to_program} miles (no transfer needed).{codeshare_note}")
            
            # Add booking URL
            booking_url = _AIRLINE_BOOKING_URLS.get(al, "")
            if booking_url:
                note_parts.append(f"Book at: {booking_url}")
            
            # Add value information
            if cpp > 0:
                note_parts.append(f"Value: {cpp:.2f} cents per point.")
            
            # Add taxes/fees
            if sur_val is not None and sur_val > 0:
                note_parts.append(f"Pay ~${sur_val:,.0f} in taxes and fees.")
            
            note_parts.append("From AwardTool live award availability.")
            
            note = " ".join(note_parts)

            tip = {
                "from_program": from_program,
                "to_program": to_program,
                "best_for": best_for,
                "route_segment": best_for,  # Explicit route segment field
                "departure": dep,
                "arrival": arr,
                "note": note,
                "points": miles,
                "surcharge": sur_val,
                "cents_per_point": round(cpp, 2) if cpp else None,
                "points_value": round(points_value, 2) if points_value else None,
                "booking_airline": booking_airline,
                "booking_airline_name": _HUMANIZE_AIRLINE.get(booking_airline) or booking_airline,
                "transfer_needed": transfer_needed,
            }
            
            # Add transfer details
            if transfer_needed and src:
                transfer_details = _TRANSFER_DETAILS.get(src, {})
                tip["transfer_portal_url"] = transfer_details.get("portal_url", "")
                tip["transfer_time"] = transfer_details.get("transfer_time", "")
                tip["transfer_ratio"] = transfer_details.get("ratio", "1:1")
                tip["min_transfer"] = transfer_details.get("min_transfer", "")
            
            # Add booking URL
            if al:
                tip["booking_url"] = _AIRLINE_BOOKING_URLS.get(al, "")
            
            # Add codeshare details
            if operating_airline and operating_airline != booking_airline:
                tip["operating_carrier"] = operating_airline
                op_name = _HUMANIZE_AIRLINE.get(operating_airline) or operating_airline
                tip["operating_carrier_name"] = op_name
                tip["segment_description"] = f"{op_name} (codeshare)"
                tip["is_codeshare"] = True
            else:
                tip["is_codeshare"] = False
            
            # Add step-by-step transfer instructions
            if transfer_needed:
                tip["transfer_steps"] = [
                    f"1. Visit {from_program} portal: {tip.get('transfer_portal_url', 'your account portal')}",
                    f"2. Navigate to 'Transfer Points' or 'Transfer to Travel Partners' section",
                    f"3. Select {to_program} from the list of airline partners",
                    f"4. Enter your {to_program} frequent flyer number (create free account if needed)",
                    f"5. Transfer {miles:,} points (usually 1:1 ratio, {transfer_details.get('transfer_time', 'instant')})",
                    f"6. Once points arrive in {to_program} account, visit {tip.get('booking_url', 'airline website')}",
                    f"7. Search for award flights from {dep} to {arr}",
                    f"8. Book using {miles:,} miles + ~${sur_val:,.0f} in taxes/fees" if sur_val else f"8. Book using {miles:,} miles",
                ]
            else:
                tip["transfer_steps"] = [
                    f"1. Visit {to_program} booking portal: {tip.get('booking_url', 'airline website')}",
                    f"2. Log in to your {to_program} account",
                    f"3. Search for award flights from {dep} to {arr}",
                    f"4. Book using {miles:,} existing miles + ~${sur_val:,.0f} in taxes/fees" if sur_val else f"4. Book using {miles:,} existing miles",
                ]
            
            out.append(tip)
            
            # Track for strategy summary
            total_points += miles
            if from_program and from_program != "Existing miles":
                programs_used.add(from_program)
            partners_used.add(to_program)

    # Build comprehensive strategy reasoning
    if out:
        # Route summary
        unique_segments = list(dict.fromkeys(route_segments))
        if len(unique_segments) == 1:
            strategy_reasons.append(f"For your {unique_segments[0]} route")
        elif len(unique_segments) > 1:
            strategy_reasons.append(f"For your multi-city route ({' → '.join(unique_segments[:3])}{'...' if len(unique_segments) > 3 else ''})")
        
        # Program usage summary
        if len(programs_used) == 1:
            strategy_reasons.append(f"using {list(programs_used)[0]} as your primary points source")
        elif len(programs_used) > 1:
            strategy_reasons.append(f"optimizing across {len(programs_used)} credit card programs")
        
        # Partner summary
        if len(partners_used) == 1:
            strategy_reasons.append(f"transferring to {list(partners_used)[0]} for best award availability")
        elif len(partners_used) > 1:
            strategy_reasons.append(f"leveraging {len(partners_used)} airline partners for optimal routing")
        
        # Value summary
        if total_cash_saved > 0:
            avg_cpp = (total_cash_saved * 100.0) / total_points if total_points > 0 else 0
            strategy_reasons.append(f"saving ${total_cash_saved:,.0f} ({avg_cpp:.2f} cpp)")
        
        strategy_reasons.append("based on live award availability from AwardTool")
        
        # Add strategy_reason to first tip (will be used for overview display)
        if strategy_reasons and out:
            out[0]["strategy_reason"] = ", ".join(strategy_reasons) + "."
            out[0]["total_points_used"] = total_points
            out[0]["total_cash_saved"] = round(total_cash_saved, 2)
            out[0]["average_cpp"] = round((total_cash_saved * 100.0) / total_points, 2) if total_points > 0 else 0

    return out


def build_oop_optimization_summary(
    solution: Dict[str, Any],
    user_points: Dict[str, int],
) -> Dict[str, Any]:
    """
    Build a comprehensive OOP optimization summary from the ILP solution.
    
    This provides:
    - Total out-of-pocket cost breakdown
    - Savings vs all-cash booking
    - Transfer plan with timing estimates
    - Step-by-step booking instructions
    - Credit card recommendations
    
    Args:
        solution: The ILP optimization solution
        user_points: User's available point balances
        
    Returns:
        Dict with comprehensive OOP optimization data
    """
    totals = solution.get("totals", {})
    pay_mode = solution.get("pay_mode", {})
    
    # Extract OOP metrics
    total_oop = totals.get("cash", 0.0)
    cash_fares = totals.get("cash_fares", 0.0)
    surcharges = totals.get("surcharges", 0.0)
    all_cash_would_be = totals.get("all_cash_would_be", 0.0)
    savings = totals.get("savings", 0.0)
    savings_pct = totals.get("savings_percentage", 0.0)
    total_points = totals.get("airline_points", 0)
    optimization_mode = totals.get("optimization_mode", "oop")
    
    # Build transfer summary with detailed instructions
    transfers = totals.get("transfers", {})
    transfer_summary = []
    
    # Bank portal URLs for detailed instructions
    BANK_PORTAL_URLS = {
        "chase": "https://ultimaterewardspoints.chase.com/",
        "amex": "https://global.americanexpress.com/rewards",
        "citi": "https://www.citi.com/rewards",
        "capitalone": "https://www.capitalone.com/credit-cards/rewards/",
        "bilt": "https://www.biltrewards.com/",
    }
    
    # Airline booking URLs
    AIRLINE_BOOKING_URLS = {
        "UA": "https://www.united.com/en/us/book-flight/united-awards",
        "AA": "https://www.aa.com/booking/find-flights",
        "DL": "https://www.delta.com/flight-search/book-a-flight",
        "EK": "https://www.emirates.com/us/english/book/",
        "EY": "https://www.etihad.com/en-us/book/",
        "SQ": "https://www.singaporeair.com/en_UK/us/plan-travel/your-booking/",
        "QR": "https://www.qatarairways.com/en-us/book-trip/flights.html",
        "AC": "https://www.aircanada.com/us/en/aco/home/aeroplan/book.html",
        "AV": "https://www.avianca.com/us/en/lifemiles/",
        "VS": "https://www.virginatlantic.com/us/en/book-manage/search-flights.html",
    }
    
    # Transfer time estimates
    TRANSFER_TIMES_DETAILED = {
        "chase": {"time": "Instant", "note": "Points typically post within minutes"},
        "amex": {"time": "1-2 business days", "note": "First-time transfers may take longer"},
        "citi": {"time": "Instant to 24 hours", "note": "Most transfers are instant"},
        "capitalone": {"time": "Instant to 2 days", "note": "Partner dependent"},
        "bilt": {"time": "Instant", "note": "Points post immediately"},
    }
    
    for traveler, by_source in transfers.items():
        for source, by_airline in (by_source or {}).items():
            for airline, data in (by_airline or {}).items():
                source_points = data.get("source_points", 0)
                delivered_points = data.get("delivered_airline_points", 0)
                
                if source_points > 0:
                    # Get bank metadata
                    bank_name = _HUMANIZE_BANK.get(source.lower(), source)
                    airline_name = _HUMANIZE_AIRLINE.get(airline.upper(), airline)
                    bank_lower = source.lower()
                    airline_upper = airline.upper()
                    
                    # Get URLs and timing
                    portal_url = BANK_PORTAL_URLS.get(bank_lower, "")
                    booking_url = AIRLINE_BOOKING_URLS.get(airline_upper, "")
                    transfer_timing = TRANSFER_TIMES_DETAILED.get(bank_lower, {"time": "1-2 business days", "note": ""})
                    
                    # Calculate transfer ratio string
                    if source_points > 0:
                        ratio_val = delivered_points / source_points
                        if abs(ratio_val - 1.0) < 0.01:
                            ratio_str = "1:1"
                        elif ratio_val >= 1.0:
                            ratio_str = f"1:{ratio_val:.1f}" if ratio_val != int(ratio_val) else f"1:{int(ratio_val)}"
                        else:
                            ratio_str = f"{1/ratio_val:.1f}:1"
                    else:
                        ratio_str = "1:1"
                    
                    # Build step-by-step transfer instructions
                    transfer_steps = [
                        f"1. Log in to your {bank_name} account at {portal_url}" if portal_url else f"1. Log in to your {bank_name} account",
                        f"2. Navigate to 'Transfer Points' or 'Transfer to Partners'",
                        f"3. Select '{airline_name}' from the list of transfer partners",
                        f"4. Enter your {airline_name} membership number (create a free account if you don't have one)",
                        f"5. Enter {source_points:,} points to transfer",
                        f"6. Confirm the transfer - you will receive {int(delivered_points):,} {airline_name} points ({ratio_str} ratio)",
                        f"7. Wait for transfer to complete ({transfer_timing['time']})",
                    ]
                    if booking_url:
                        transfer_steps.append(f"8. Once points arrive, book at {booking_url}")
                    
                    transfer_summary.append({
                        "from_bank": bank_lower,
                        "from_bank_name": bank_name,
                        "to_program": airline_upper,
                        "to_program_name": airline_name,
                        "points_to_transfer": source_points,
                        "points_received": int(delivered_points),
                        "transfer_ratio": ratio_str,
                        "portal_url": portal_url,
                        "booking_url": booking_url,
                        "transfer_time": transfer_timing["time"],
                        "transfer_note": transfer_timing["note"],
                        "transfer_steps": transfer_steps,
                        "for_traveler": traveler,
                    })
    
    # Build payment breakdown
    payment_breakdown = []
    flights_with_points = 0
    flights_with_cash = 0
    
    for traveler, payments in pay_mode.items():
        for payment in (payments or []):
            payment_type = payment.get("type", "unknown")
            edge = payment.get("edge", [])
            
            if len(edge) >= 2:
                origin = edge[0]
                dest = edge[1]
                
                if payment_type == "cash":
                    flights_with_cash += 1
                    payment_breakdown.append({
                        "segment": f"{origin} → {dest}",
                        "payment_type": "cash",
                        "cash_paid": payment.get("fare", 0),
                        "points_used": 0,
                    })
                else:
                    flights_with_points += 1
                    via = payment.get("via", {})
                    program = via.get("airline") or via.get("native", "")
                    program_name = _HUMANIZE_AIRLINE.get(program.upper(), program)
                    
                    payment_breakdown.append({
                        "segment": f"{origin} → {dest}",
                        "payment_type": "points",
                        "cash_paid": payment.get("surcharge", 0),
                        "points_used": payment.get("miles", 0),
                        "program": program.upper(),
                        "program_name": program_name,
                        "cpp_value": payment.get("cents_per_point", 0),
                        "cash_alternative": payment.get("cash_alternative", 0),
                    })
    
    # Generate booking order instructions with detailed steps
    booking_order = []
    step = 1
    
    # Step 1: Transfers (do first, before booking flights)
    if transfer_summary:
        # Add a header explaining why transfers come first
        booking_order.append({
            "step": step,
            "type": "header",
            "action": "STEP 1: Transfer Points (do this first!)",
            "details": f"Transfer points from your credit card programs to airline partners. Total: {sum(x['points_to_transfer'] for x in transfer_summary):,} points across {len(transfer_summary)} transfer(s).",
            "timing": "Do this 1-2 days before booking to ensure points arrive",
        })
        step += 1
    
    for xfer in transfer_summary:
        # Build detailed transfer instruction
        points_to_transfer = xfer['points_to_transfer']
        points_received = xfer['points_received']
        bank_name = xfer['from_bank_name']
        program_name = xfer['to_program_name']
        ratio = xfer['transfer_ratio']
        transfer_time = xfer.get('transfer_time', '1-2 business days')
        portal_url = xfer.get('portal_url', '')
        
        booking_order.append({
            "step": step,
            "type": "transfer",
            "action": f"Transfer {points_to_transfer:,} {bank_name} points → {points_received:,} {program_name} miles",
            "details": f"Transfer ratio: {ratio}. Log in at {portal_url}" if portal_url else f"Transfer ratio: {ratio}",
            "timing": transfer_time,
            "transfer_steps": xfer.get('transfer_steps', []),
            "points_summary": {
                "source_program": bank_name,
                "target_program": program_name,
                "points_to_transfer": points_to_transfer,
                "points_received": points_received,
                "ratio": ratio,
            }
        })
        step += 1
    
    # Add a header for flight bookings
    if payment_breakdown:
        booking_order.append({
            "step": step,
            "type": "header",
            "action": "STEP 2: Book Flights",
            "details": f"After transfers complete, book your {len(payment_breakdown)} flight segment(s).",
            "timing": "After transfer points arrive in your account",
        })
        step += 1
    
    # Step 2: Book flights with detailed instructions
    for payment in payment_breakdown:
        segment = payment['segment']
        
        if payment["payment_type"] == "points":
            points_used = payment['points_used']
            program = payment.get('program', '')
            program_name = payment.get('program_name', '')
            cash_paid = payment['cash_paid']
            cash_alternative = payment.get('cash_alternative', 0)
            cpp_value = payment.get('cpp_value', 0)
            
            # Calculate value gained from using points
            value_gained = cash_alternative - cash_paid if cash_alternative > cash_paid else 0
            
            booking_order.append({
                "step": step,
                "type": "book_flight",
                "action": f"Book {segment} with {points_used:,} {program_name} miles + ${cash_paid:.2f} taxes",
                "details": f"This would cost ${cash_alternative:.2f} in cash. You're saving ${value_gained:.2f} ({cpp_value:.2f} cents/point value)." if cash_alternative > 0 else f"Pay ${cash_paid:.2f} in taxes/fees",
                "points_summary": {
                    "miles_required": points_used,
                    "program": program_name,
                    "taxes_fees": round(cash_paid, 2),
                    "cash_alternative": round(cash_alternative, 2),
                    "savings": round(value_gained, 2),
                    "cpp_value": round(cpp_value, 2),
                }
            })
        else:
            cash_paid = payment['cash_paid']
            booking_order.append({
                "step": step,
                "type": "book_flight",
                "action": f"Book {segment} with cash: ${cash_paid:.2f}",
                "details": f"Pay ${cash_paid:.2f} (cash booking was more cost-effective for this segment)",
            })
        step += 1
    
    # Build consolidated transfer plan with totals
    transfer_plan = {
        "total_transfers": len(transfer_summary),
        "total_points_to_transfer": sum(x['points_to_transfer'] for x in transfer_summary),
        "total_miles_received": sum(x['points_received'] for x in transfer_summary),
        "by_source": {},  # Grouped by source bank
        "estimated_total_time": "Instant" if all(
            x.get('transfer_time', '').lower() == 'instant' for x in transfer_summary
        ) else "1-2 business days",
        "transfers": transfer_summary,
    }
    
    # Group transfers by source bank for easy display
    for xfer in transfer_summary:
        bank = xfer['from_bank_name']
        if bank not in transfer_plan['by_source']:
            transfer_plan['by_source'][bank] = {
                "total_points": 0,
                "transfers_to": [],
            }
        transfer_plan['by_source'][bank]['total_points'] += xfer['points_to_transfer']
        transfer_plan['by_source'][bank]['transfers_to'].append({
            "program": xfer['to_program_name'],
            "points": xfer['points_to_transfer'],
            "miles_received": xfer['points_received'],
            "ratio": xfer['transfer_ratio'],
        })
    
    # Generate human-readable transfer strategy text
    if transfer_summary:
        strategy_parts = []
        for bank, data in transfer_plan['by_source'].items():
            transfers_desc = ", ".join([
                f"{t['points']:,} → {t['program']} ({t['miles_received']:,} miles)" 
                for t in data['transfers_to']
            ])
            strategy_parts.append(f"From {bank}: Transfer {data['total_points']:,} points ({transfers_desc})")
        transfer_plan['strategy_text'] = " | ".join(strategy_parts)
    else:
        transfer_plan['strategy_text'] = "No transfers needed - using existing airline miles or cash only"
    
    # NEW: Build explicit transfer action items with credit card, points, and destination
    transfer_action_items = []
    for xfer in transfer_summary:
        from_bank = xfer.get('from_bank', '')
        from_bank_name = xfer.get('from_bank_name', from_bank)
        to_program = xfer.get('to_program', '')
        to_program_name = xfer.get('to_program_name', to_program)
        pts = xfer.get('points_to_transfer', 0)
        miles_received = xfer.get('points_received', 0)
        ratio = xfer.get('transfer_ratio', '1:1')
        portal_url = xfer.get('portal_url', '')
        transfer_time = xfer.get('transfer_time', 'varies')
        
        # Determine if this is airline or hotel
        program_type = "airline"
        if to_program.upper() in ['HYATT', 'HH', 'MAR', 'IHG', 'ACC', 'WYNDHAM']:
            program_type = "hotel"
        
        # Get credit card name suggestion
        credit_card_suggestion = {
            'chase': 'Chase Sapphire Preferred/Reserve or Chase Ink Preferred',
            'amex': 'Amex Platinum, Amex Gold, or Amex Business Platinum',
            'citi': 'Citi Premier or Citi Custom Cash',
            'capitalone': 'Capital One Venture X or Venture',
            'bilt': 'Bilt Mastercard',
        }.get(from_bank.lower(), from_bank_name)
        
        transfer_action_items.append({
            # Clear, explicit fields
            "credit_card": credit_card_suggestion,
            "bank_program": from_bank_name,
            "points_to_transfer": pts,
            "destination_program": to_program_name,
            "destination_code": to_program.upper(),
            "miles_received": miles_received,
            "transfer_ratio": ratio,
            "program_type": program_type,  # "airline" or "hotel"
            "transfer_time": transfer_time,
            "portal_url": portal_url,
            # Human-readable summary
            "action_text": f"Transfer {pts:,} points from {credit_card_suggestion} to {to_program_name}",
            "details_text": f"You will receive {miles_received:,} {to_program_name} miles (ratio: {ratio}, time: {transfer_time})",
        })
    
    # Build a consolidated transfer strategy summary text
    if transfer_action_items:
        transfer_strategy_detailed = []
        for item in transfer_action_items:
            transfer_strategy_detailed.append(
                f"• {item['action_text']} ({item['transfer_ratio']} ratio, {item['transfer_time']})"
            )
        transfer_plan['detailed_strategy'] = "\n".join(transfer_strategy_detailed)
        
        # Grand total summary
        total_pts = sum(x['points_to_transfer'] for x in transfer_action_items)
        total_miles = sum(x['miles_received'] for x in transfer_action_items)
        transfer_plan['grand_total_text'] = f"TOTAL: Transfer {total_pts:,} credit card points → Receive {total_miles:,} airline/hotel miles"
    else:
        transfer_plan['detailed_strategy'] = "No transfers needed"
        transfer_plan['grand_total_text'] = "No point transfers required for this trip"
    
    return {
        "optimization_mode": optimization_mode,
        "summary": {
            "total_out_of_pocket": round(total_oop, 2),
            "cash_fares": round(cash_fares, 2),
            "surcharges": round(surcharges, 2),
            "all_cash_would_be": round(all_cash_would_be, 2),
            "savings": round(savings, 2),
            "savings_percentage": round(savings_pct, 1),
            "total_points_used": int(total_points),
        },
        "metrics": {
            "flights_with_points": flights_with_points,
            "flights_with_cash": flights_with_cash,
            "points_usage_rate": flights_with_points / (flights_with_points + flights_with_cash) if (flights_with_points + flights_with_cash) > 0 else 0,
        },
        "transfer_plan": transfer_plan,  # Consolidated transfer plan
        "transfer_action_items": transfer_action_items,  # NEW: Explicit transfer actions with credit card details
        "transfer_summary": transfer_summary,  # Keep for backwards compatibility
        "payment_breakdown": payment_breakdown,
        "booking_order": booking_order,
        "user_points_remaining": _calculate_remaining_points(user_points, transfer_summary),
    }


def _get_transfer_timing(bank: str) -> str:
    """Get transfer timing for a bank."""
    TRANSFER_TIMES = {
        "chase": "Instant",
        "amex": "1-2 business days",
        "citi": "Instant to 24 hours",
        "capitalone": "Instant to 2 days",
        "bilt": "Instant",
    }
    return TRANSFER_TIMES.get(bank.lower(), "1-2 business days")


def _calculate_remaining_points(
    user_points: Dict[str, int],
    transfer_summary: List[Dict[str, Any]],
) -> Dict[str, int]:
    """Calculate remaining points after transfers."""
    remaining = dict(user_points)
    
    for xfer in transfer_summary:
        bank = xfer.get("from_bank", "")
        points = xfer.get("points_to_transfer", 0)
        
        for key in [bank, bank.lower(), bank.upper()]:
            if key in remaining:
                remaining[key] = max(0, remaining[key] - points)
                break
    
    return remaining


async def _get_transfer_tips_from_panorama(
    origin: str,
    destination: str,
    start_date: str,
    end_date: str,
    user_banks: List[str],
) -> List[Dict[str, Any]]:
    """
    Fallback: use AwardTool Panorama (calendar) to get program + points for the route,
    then suggest where to transfer. Used when the optimizer has no points bookings.
    """
    import httpx
    api_key = os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")
    if not api_key or not origin or not destination:
        return []

    url = "https://www.awardtool-api.com/panorama/panorama_calendar_data"
    payload = {"id": f"{str(origin).upper()}-{str(destination).upper()}", "api_key": api_key}
    try:
        async with httpx.AsyncClient(http2=True, timeout=httpx.Timeout(20.0)) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            data = r.json().get("data") or []
    except Exception as e:
        logger.debug("Panorama calendar for transfer tips %s->%s: %s", origin, destination, e)
        return []

    banks_set = {b.lower().strip() for b in user_banks}
    best_pts, best_prog = None, None
    for row in data:
        d = row.get("date") or ""
        if start_date and d < start_date:
            continue
        if end_date and d > end_date:
            continue
        prog = (row.get("program") or "").upper()
        if not prog:
            continue
        pts_obj = row.get("points") or {}
        pts = pts_obj.get("y") if isinstance(pts_obj.get("y"), (int, float)) else None
        if pts is None:
            continue
        if best_pts is None or pts < best_pts:
            if DEFAULT_TRANSFER_GRAPH and any(
                DEFAULT_TRANSFER_GRAPH.get(b, {}).get(prog) is not None
                for b in banks_set
            ):
                best_pts, best_prog = int(pts), prog

    if best_pts is None or best_prog is None:
        return []

    from_bank = None
    for b in banks_set:
        if DEFAULT_TRANSFER_GRAPH.get(b, {}).get(best_prog) is not None:
            from_bank = b
            break
    if not from_bank:
        return []

    from_program = _HUMANIZE_BANK.get(from_bank) or from_bank
    to_program = _HUMANIZE_AIRLINE.get(best_prog) or best_prog
    best_for = f"{str(origin).upper()}→{str(destination).upper()}"
    note = f"Transfer {best_pts:,} points to {to_program} (AwardTool Panorama economy for your dates)."
    return [{
        "from_program": from_program,
        "to_program": to_program,
        "best_for": best_for,
        "note": note,
        "points": best_pts,
        "surcharge": None,
    }]


def _save_and_return_ai_route_suggestions(
    trip_id: str,
    origin: str,
    destination: str,
    city_names: List[str],
    start_date: str,
    end_date: str,
    failed_routes: Optional[List[str]] = None,
    points_programs: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """When flight search has no data (small/remote cities), use OpenAI to suggest routes and smart tips; return that instead of failing."""
    from src.handlers.openAI import suggest_routes_for_remote_or_small_cities, get_itinerary_smart_tips

    suggestions = suggest_routes_for_remote_or_small_cities(
        origin=origin,
        destination=destination,
        city_names=city_names if city_names else None,
        start_date=start_date or None,
        end_date=end_date or None,
        failed_routes=failed_routes,
    )
    tips = get_itinerary_smart_tips(
        origin=origin,
        destination=destination,
        city_names=city_names if city_names else None,
        start_date=start_date or None,
        end_date=end_date or None,
        points_programs=points_programs or None,
    )
    item = {
        "tripId": trip_id,
        "itemId": "ai_route_suggestions",
        "type": "ai_route_suggestions",
        "suggestions": suggestions,
        "transfer_tips": tips.get("transfer_tips", []),
        "sample_itineraries": tips.get("sample_itineraries", []),
        "holiday_advice": tips.get("holiday_advice", []),
        "practical_tips": tips.get("practical_tips", []),
    }
    itinerary_repo.put_item(item)
    return {
        "status": "ai_suggested",
        "ai_suggested_routes": True,
        "suggestions": suggestions,
        "items": [item],
        "solution": {},
    }


async def _fetch_edges_for_route(
    origin: str,
    dest: str,
    leg_date: str,
    combined_points: Dict[str, int],
    travelers: List[str],
    start_dest_code: str,
) -> Tuple[Dict[Tuple[str, str, str], Dict[str, Any]], bool]:
    """
    Fetch flight and ground edges for a single origin->dest pair.
    Returns (edges_dict, had_any_flight_edges).
    """
    from src.handlers.ground_transport import get_bus_and_car_options, ground_options_to_edges

    filters = {
        "outbound_date": leg_date,
        "travel_class": "economy",
        "bags": 1,
        "pax": len(travelers),
        "award_programs": get_award_programs_for_api(),
    }
    collected: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    had_flight = False

    def _add_ground(o: str, d: str, date: str) -> None:
        try:
            opts = get_bus_and_car_options(o, d, date=date)
            ge = ground_options_to_edges(o, d, opts)
            if ge:
                collected.update(ge)
        except Exception as g:
            logger.debug("Ground transport for [%s]->[%s]: %s", o, d, g)

    try:
        edges = await get_flights_award_first_with_points_async(
            origin, dest, combined_points, filters
        )
        if not edges:
            edges = await get_flights_serp_first_with_points_async(
                origin, dest, combined_points, filters
            )
        if not edges:
            edges = await asyncio.to_thread(
                get_flights_serp_only, origin, dest, leg_date, filters
            )
        if edges:
            collected.update(edges)
            had_flight = True
        _add_ground(origin, dest, leg_date)
        if not had_flight and origin in SMALL_AIRPORT_NEARBY_HUBS:
            for hub in SMALL_AIRPORT_NEARBY_HUBS[origin]:
                try:
                    hub_edges = await get_flights_award_first_with_points_async(
                        hub, dest, combined_points, filters
                    )
                    if not hub_edges:
                        hub_edges = await get_flights_serp_first_with_points_async(
                            hub, dest, combined_points, filters
                        )
                    if not hub_edges:
                        hub_edges = await asyncio.to_thread(
                            get_flights_serp_only, hub, dest, leg_date, filters
                        )
                    if hub_edges:
                        collected.update(hub_edges)
                        _add_ground(origin, hub, leg_date)
                        had_flight = True
                        break
                except Exception as h:
                    logger.debug("Hub %s fallback for %s->%s: %s", hub, origin, dest, h)
        return (collected, had_flight)
    except Exception as e:
        logger.warning(
            "Error fetching flights from %s to %s date=%s: %s",
            origin, dest, leg_date, e, exc_info=True,
        )
        edges = {}
        try:
            edges = await get_flights_serp_first_with_points_async(
                origin, dest, combined_points, filters
            )
        except Exception as fe:
            logger.warning("SERP-first fallback for %s -> %s: %s", origin, dest, fe)
        if not edges:
            try:
                edges = await asyncio.to_thread(
                    get_flights_serp_only, origin, dest, leg_date, filters
                )
            except Exception as se:
                logger.debug("get_flights_serp_only for %s->%s: %s", origin, dest, se)
        if edges:
            collected.update(edges)
            had_flight = True
        _add_ground(origin, dest, leg_date)
        if not had_flight and origin in SMALL_AIRPORT_NEARBY_HUBS:
            for hub in SMALL_AIRPORT_NEARBY_HUBS[origin]:
                try:
                    hub_edges = await get_flights_award_first_with_points_async(
                        hub, dest, combined_points, filters
                    )
                    if not hub_edges:
                        hub_edges = await get_flights_serp_first_with_points_async(
                            hub, dest, combined_points, filters
                        )
                    if not hub_edges:
                        hub_edges = await asyncio.to_thread(
                            get_flights_serp_only, hub, dest, leg_date, filters
                        )
                    if hub_edges:
                        collected.update(hub_edges)
                        _add_ground(origin, hub, leg_date)
                        had_flight = True
                        break
                except Exception as h:
                    logger.debug("Hub %s fallback for %s->%s: %s", hub, origin, dest, h)
        return (collected, had_flight)


async def generate_optimized_itinerary(
    trip_id: str, 
    optimization_mode: str = "money_saving"
) -> Dict[str, Any]:
    """
    Generate optimized itinerary using points maximization algorithm.
    
    This function:
    1. Gets trip data (dates, destinations, members)
    2. Gets points for all members
    3. Converts city names to airport codes
    4. Fetches flight edges for all routes (SERP for cash, AwardTool for points)
    5. Runs ILP optimization to maximize points value
    6. Saves and returns the optimized itinerary
    
    Args:
        trip_id: The trip ID to optimize
        optimization_mode: One of:
            - "cpp_focused": Only use points when cpp > 1.0 (above market value)
            - "money_saving": Use points whenever cpp > 0 (prioritize cash reduction)
            - "balanced": Optimize cpp adjusted by travel time and stops
            - "oop": Legacy alias for "money_saving"
            - "cpp": Legacy alias for "cpp_focused"
    
    Raises:
        ValueError: If trip data is invalid, missing required fields, or optimization fails
    """
    # Validate optimization mode
    valid_modes = {"cpp_focused", "money_saving", "balanced", "oop", "cpp"}
    if optimization_mode not in valid_modes:
        raise ValueError(f"Invalid optimization_mode '{optimization_mode}'. Must be one of: {valid_modes}")
    if plan_maximize_points_value is None:
        raise ValueError(
            "Optimized itineraries are not available in this environment because the "
            "'pulp' dependency (used by points_maximizer) is not installed. "
            "You can still use the basic itinerary generator."
        )
    # 1. Get trip data with validation
    trip = trip_service.get_trip(trip_id)
    if not trip:
        raise ValueError(f"Trip {trip_id} not found")

    start_date = trip.get("startDate", "")
    end_date = trip.get("endDate", "")
    leg_dates = trip.get("legDates") or []  # Multi-city leg dates from frontend
    
    # Validate dates
    try:
        _validate_date(start_date, "startDate")
        _validate_date(end_date, "endDate")
    except ValueError as e:
        raise ValueError(f"Invalid trip dates: {str(e)}")
    
    # Ensure end date is after start date
    try:
        start_dt = datetime.strptime(start_date.strip(), "%Y-%m-%d")
        end_dt = datetime.strptime(end_date.strip(), "%Y-%m-%d")
        if end_dt < start_dt:
            raise ValueError("endDate must be after or equal to startDate")
    except ValueError as e:
        if "must be after" in str(e):
            raise
        # If date parsing fails, continue (already validated above)
    
    # 2. Get destinations with validation
    destinations = destination_service.list_destinations(trip_id)
    if not destinations:
        raise ValueError("No destinations found for trip. Please add at least one destination.")
    
    # Filter out excluded destinations
    valid_destinations = [d for d in destinations if not d.get("excluded", False)]
    if not valid_destinations:
        raise ValueError("All destinations are excluded. Please add at least one active destination.")
    
    # Find start and end destinations. Prefer explicit isStart/isEnd so the route uses
    # the correct start/end regardless of add order. Fallback: must_include order
    # (first=start, last=end), then first/last of valid_destinations.
    start_dest_name = None
    end_dest_name = None
    must_include = [d for d in valid_destinations if d.get("mustInclude", False)]

    start_d = next((d for d in valid_destinations if d.get("isStart", False)), None)
    end_d = next((d for d in valid_destinations if d.get("isEnd", False)), None)
    if start_d:
        start_dest_name = (start_d.get("name") or "").strip()
    if end_d:
        end_dest_name = (end_d.get("name") or "").strip()

    if start_dest_name is None:
        if must_include:
            start_dest_name = must_include[0].get("name", "").strip()
        if start_dest_name is None and valid_destinations:
            start_dest_name = valid_destinations[0].get("name", "").strip()
    if end_dest_name is None:
        if must_include:
            end_dest_name = must_include[-1].get("name", "").strip()
        if end_dest_name is None and valid_destinations:
            end_dest_name = (
                valid_destinations[-1].get("name", "").strip()
                if len(valid_destinations) > 1
                else start_dest_name
            )

    if not start_dest_name:
        raise ValueError("No valid start destination found")
    if not end_dest_name:
        end_dest_name = start_dest_name

    # Cities = all destinations between start and end (in valid_destinations order).
    # This includes middle must_include destinations so Paris->Amsterdam->Berlin all appear when all are requested.
    cities = []
    for d in valid_destinations:
        name = (d.get("name") or "").strip()
        if name and name not in (start_dest_name, end_dest_name):
            cities.append(name)
    
    # Convert city names to airport codes (in parallel to save time on API calls)
    # MULTI-AIRPORT SUPPORT: Get ALL airports for each city for comprehensive search
    logger.info(f"Converting city names to airport codes: start={start_dest_name}, end={end_dest_name}, cities={cities}")
    
    # Build list of all city names to resolve
    names_to_resolve = [start_dest_name]
    if end_dest_name and end_dest_name != start_dest_name:
        names_to_resolve.append(end_dest_name)
    names_to_resolve.extend(cities)
    
    # Resolve all in parallel - get BOTH primary code AND all airports
    code_results = await asyncio.gather(
        *[asyncio.to_thread(_normalize_city_to_code, name) for name in names_to_resolve],
        return_exceptions=True,
    )
    all_airports_results = await asyncio.gather(
        *[asyncio.to_thread(_get_all_airports_for_city, name) for name in names_to_resolve],
        return_exceptions=True,
    )
    
    # Map results back
    idx = 0
    start_dest_code = code_results[idx] if not isinstance(code_results[idx], Exception) else None
    start_all_airports = all_airports_results[idx] if not isinstance(all_airports_results[idx], Exception) else []
    idx += 1
    
    if end_dest_name and end_dest_name != start_dest_name:
        end_dest_code = code_results[idx] if not isinstance(code_results[idx], Exception) else None
        end_all_airports = all_airports_results[idx] if not isinstance(all_airports_results[idx], Exception) else []
        idx += 1
    else:
        end_dest_code = start_dest_code
        end_all_airports = start_all_airports
    
    # Build mapping from primary code to all airports for multi-airport search
    # This allows the optimizer to search from/to all airports for each city
    city_to_all_airports: Dict[str, List[str]] = {}
    if start_dest_code and start_all_airports:
        city_to_all_airports[start_dest_code] = start_all_airports
    if end_dest_code and end_all_airports:
        city_to_all_airports[end_dest_code] = end_all_airports
    
    city_codes = []
    for i, city_name in enumerate(cities):
        result = code_results[idx + i]
        all_airports = all_airports_results[idx + i] if not isinstance(all_airports_results[idx + i], Exception) else []
        if isinstance(result, Exception):
            logger.warning(f"Error resolving '{city_name}': {result}")
        elif result:
            logger.info(f"Resolved destination '{city_name}' -> airport code '{result}'")
            city_codes.append(result)
            if all_airports:
                city_to_all_airports[result] = all_airports
        else:
            logger.warning(f"Could not find airport code for '{city_name}', skipping")
    
    # Log comprehensive destination resolution summary
    logger.info(
        f"DESTINATION RESOLUTION SUMMARY: "
        f"start='{start_dest_name}'->{start_dest_code}, "
        f"end='{end_dest_name}'->{end_dest_code}, "
        f"cities={dict(zip(cities, [code_results[idx + i] if not isinstance(code_results[idx + i], Exception) else 'ERROR' for i in range(len(cities))]))}"
    )
    
    # Log multi-airport mappings for debugging
    multi_airport_cities = {k: v for k, v in city_to_all_airports.items() if len(v) > 1}
    if multi_airport_cities:
        logger.info(f"Multi-airport cities detected: {multi_airport_cities}")
    
    # Validate start/end codes
    if not start_dest_code:
        raise ValueError(f"Could not find airport code for start destination: {start_dest_name}")
    if not end_dest_code:
        raise ValueError(f"Could not find airport code for end destination: {end_dest_name}")
    
    # For single destination trips, ensure we have at least start and end
    if not city_codes and start_dest_code == end_dest_code:
        logger.info(f"Single destination trip: {start_dest_code}")
        # For round trips, we still need at least 2 cities for the optimizer
        # Use the same city as both start and end
        city_codes = [start_dest_code]
    
    # 3. Get trip members with validation
    members = trip_member_service.list_members(trip_id)
    if not members:
        raise ValueError("No members found for trip. Please add at least one member.")
    
    # Include all members as travelers (not just "active" status)
    # This ensures point balancing works for all group members
    travelers = [m.get("userId", "") for m in members if m.get("userId")]
    
    # Log member statuses for debugging
    member_statuses = {m.get("userId", ""): m.get("status", "unknown") for m in members}
    logger.info(f"Member statuses: {member_statuses}")
    
    if not travelers:
        raise ValueError("No members found for optimization")
    
    logger.info(f"Found {len(travelers)} travelers: {travelers}")

    # 4. Get points for all members with validation
    points_summary = points_service.trip_points_summary(trip_id)
    points_items = points_summary.get("items", [])
    
    # Build user_points_by_trav: {userId: {program: balance}}
    user_points_by_trav = {}
    total_points = 0
    for item in points_items:
        user_id = item.get("userId", "")
        program = item.get("program", "")
        try:
            balance = int(item.get("balance", 0))
        except (ValueError, TypeError):
            logger.warning(f"Invalid points balance for user {user_id}, program {program}: {item.get('balance')}")
            continue
        
        if user_id and program and balance > 0:
            if user_id not in user_points_by_trav:
                user_points_by_trav[user_id] = {}
            # Normalize program name to SHORT CODE for transfer graph matching
            # Banks: "Chase Ultimate Rewards" -> "chase", "Amex Membership Rewards" -> "amex"
            # Airlines: "United MileagePlus" -> "UA", "Delta SkyMiles" -> "DL"
            program_normalized = _normalize_program_to_transfer_key(program)
            user_points_by_trav[user_id][program_normalized] = balance
            total_points += balance
    
    # Warn if no points found, but don't fail (optimization can still work with cash)
    if not user_points_by_trav or total_points == 0:
        logger.warning(
            f"No points found for trip {trip_id}. Optimization will prioritize cash bookings. "
            f"Consider adding points to maximize value."
        )
    else:
        logger.info(f"Total points available: {total_points:,} across {len(user_points_by_trav)} users")
    
    # 5. Build start/end city mapping using per-member airport codes if available
    # Members can have different departure/arrival airports (e.g., User from SEA, Eric from SFO)
    member_airports = {m.get("userId", ""): m for m in members}
    
    start_city_by_trav = {}
    end_city_by_trav = {}
    unique_start_airports = set()
    
    for t in travelers:
        member = member_airports.get(t, {})
        # Use member's departure_airport if set, otherwise fall back to trip-level start
        # Normalize airport codes to handle formats like "SEATTLE (SEA,BFI)" -> "SEA"
        member_departure = _normalize_airport_code(member.get("departure_airport") or "")
        member_arrival = _normalize_airport_code(member.get("arrival_airport") or "")
        
        # For departure: use member's airport or trip default
        if member_departure:
            start_city_by_trav[t] = member_departure
            unique_start_airports.add(member_departure)
            logger.info(f"Member {t[-8:]} using custom departure airport: {member_departure}")
        else:
            start_city_by_trav[t] = start_dest_code
            unique_start_airports.add(start_dest_code)
        
        # For arrival: use member's airport, or same as departure (round trip), or trip default
        if member_arrival:
            end_city_by_trav[t] = member_arrival
        elif member_departure:
            # If member has custom departure but no arrival, assume round trip to same airport
            end_city_by_trav[t] = member_departure
        else:
            end_city_by_trav[t] = end_dest_code
    
    # Log the per-member routing
    if len(unique_start_airports) > 1:
        logger.info(f"Group trip with multiple origins: {unique_start_airports}")
        for t in travelers:
            logger.info(f"  {t[-8:]}: {start_city_by_trav[t]} -> destination -> {end_city_by_trav[t]}")
    
    # 6. Fetch flight edges using airport codes
    # Build all possible routes: start -> city1 -> city2 -> ... -> end
    # For round-trip (start==end with cities), include the return leg so we fetch e.g. ITH->CDG and CDG->ITH
    # 
    # IMPORTANT: When members have different origins (e.g., User from SEA, Eric from SFO),
    # we need to include ALL unique start/end airports in the nodes
    all_cities = [start_dest_code] + city_codes
    if end_dest_code != start_dest_code or city_codes:
        all_cities = all_cities + [end_dest_code]
    
    # Add unique member-specific start/end airports to the route
    unique_end_airports = set(end_city_by_trav.values())
    for airport in unique_start_airports:
        if airport and airport not in all_cities:
            all_cities.insert(0, airport)  # Add alternate origins at the start
            logger.info(f"Added member origin airport to route: {airport}")
    for airport in unique_end_airports:
        if airport and airport not in all_cities:
            all_cities.append(airport)  # Add alternate return airports at the end
            logger.info(f"Added member return airport to route: {airport}")
    
    # Deduplicate only when not a round-trip (avoid collapsing ITH->CDG->ITH into ITH->CDG)
    if not (len(all_cities) > 1 and all_cities[0] == all_cities[-1]):
        all_cities = list(dict.fromkeys(all_cities))
    
    if len(all_cities) < 2:
        raise ValueError(
            f"Need at least 2 distinct destinations for optimization. "
            f"Found: {all_cities}. Please add more destinations or use different start/end locations."
        )
    
    # Fetch edges for all O–D pairs so the optimizer can choose the cheapest ordering of
    # destinations (start/end fixed; middle cities can reorder to reduce cost).
    nodes = list(dict.fromkeys(all_cities))
    logger.info(f"Optimizing route over {nodes} with {len(unique_start_airports)} unique origins: {unique_start_airports}; order flexible for {len(city_codes)} cities")
    
    edges_all = {}
    transfer_graph = DEFAULT_TRANSFER_GRAPH
    successful_routes = 0
    failed_routes = []
    
    # MULTI-AIRPORT SUPPORT: Expand pairs to search all airport combinations
    # For each city pair (O, D), search flights from all O airports to all D airports
    pairs: List[Tuple[str, str]] = []
    pair_to_city: Dict[Tuple[str, str], Tuple[str, str]] = {}  # Maps (actual_origin, actual_dest) -> (city_origin, city_dest)
    
    for o in nodes:
        for d in nodes:
            if o == d:
                continue
            # Get all airports for origin and destination cities
            o_airports = city_to_all_airports.get(o, [o])
            d_airports = city_to_all_airports.get(d, [d])
            
            # Add all combinations
            for o_apt in o_airports:
                for d_apt in d_airports:
                    if (o_apt, d_apt) not in pair_to_city:
                        pairs.append((o_apt, d_apt))
                        pair_to_city[(o_apt, d_apt)] = (o, d)  # Track which city pair this serves
    
    logger.info(f"Multi-airport expansion: {len(nodes)} cities -> {len(pairs)} airport pairs")

    # Build city -> departure_date mapping from leg_dates
    # leg_dates[0] = departure from origin, leg_dates[1] = departure from cities[0], etc.
    # This allows us to search for award flights on the correct dates for each city
    city_departure_dates: Dict[str, str] = {}
    
    if leg_dates and len(leg_dates) > 0:
        # Use explicit leg dates from frontend
        # leg_dates[0] = departure from start, leg_dates[1] = departure from city_codes[0], etc.
        city_departure_dates[start_dest_code] = leg_dates[0] if len(leg_dates) > 0 else start_date.strip()
        for i, city_code in enumerate(city_codes):
            if i + 1 < len(leg_dates):
                city_departure_dates[city_code] = leg_dates[i + 1]
            else:
                # Fallback: compute approximate date if not enough leg_dates
                logger.warning(f"Missing leg_date for city index {i+1} ({city_code}), using computed date")
        logger.info(f"Using explicit leg_dates: {city_departure_dates}")
    else:
        # Compute progressive dates based on trip duration
        # Distribute days evenly across cities
        total_days = (datetime.strptime(end_date.strip(), "%Y-%m-%d") - datetime.strptime(start_date.strip(), "%Y-%m-%d")).days
        num_segments = len(city_codes) + 1  # segments between cities + return
        days_per_segment = max(1, total_days // max(num_segments, 1))
        
        city_departure_dates[start_dest_code] = start_date.strip()
        current_date = datetime.strptime(start_date.strip(), "%Y-%m-%d")
        for i, city_code in enumerate(city_codes):
            current_date += timedelta(days=days_per_segment)
            city_departure_dates[city_code] = current_date.strftime("%Y-%m-%d")
        logger.info(f"Computed leg dates (no explicit leg_dates): {city_departure_dates}")

    # Combined points from all travelers (same for every O-D pair)
    combined_points = {}
    for user_id, points in user_points_by_trav.items():
        for prog, bal in points.items():
            combined_points[prog] = combined_points.get(prog, 0) + bal

    # Fetch all O-D pairs in parallel to avoid sequential SERP/AwardTool latency
    sem = asyncio.Semaphore(8)  # Increased from 6 to handle more airport pairs

    async def _bounded_fetch(o: str, d: str) -> Tuple[Dict[Tuple[str, str, str], Dict[str, Any]], bool]:
        async with sem:
            # Determine the search date for this leg
            # Use the departure date for the origin city from our mapping
            city_o, city_d = pair_to_city.get((o, d), (o, d))
            
            # Check if this is a return leg:
            # 1. Destination is the trip's start city (round trip back to origin)
            # 2. Destination is any member's end airport (group trips with different return airports)
            # 3. Origin is a must-visit city and destination is a member's end airport
            is_return_leg = (
                (city_d == start_dest_code) or
                (city_d in unique_end_airports) or
                (d in unique_end_airports) or  # Check actual airport too
                (city_o in city_codes and (city_d in unique_end_airports or d in unique_end_airports))
            )
            
            if is_return_leg and end_date:
                leg_date = end_date.strip()
                logger.debug(f"Return leg {o}->{d}: using end_date {leg_date}")
            elif city_o in city_departure_dates:
                # Use the departure date for this origin city
                leg_date = city_departure_dates[city_o]
                logger.debug(f"Outbound leg {o}->{d}: using city date {leg_date}")
            else:
                # Fallback to start_date if city not in mapping
                leg_date = start_date.strip()
                logger.debug(f"Fallback leg {o}->{d}: using start_date {leg_date}")
                
            return await _fetch_edges_for_route(
                o, d, leg_date, combined_points, travelers, start_dest_code
            )

    logger.info("Fetching flight edges for %d O-D pairs in parallel", len(pairs))
    results = await asyncio.gather(
        *[_bounded_fetch(o, d) for o, d in pairs],
        return_exceptions=True,
    )
    for i, r in enumerate(results):
        o, d = pairs[i]
        if isinstance(r, Exception):
            logger.warning("fetch_edges_for_route %s -> %s failed: %s", o, d, r)
            failed_routes.append(f"{o} -> {d}")
            continue
        edges, had_flight = r
        edges_all.update(edges)
        if had_flight:
            successful_routes += 1
        else:
            failed_routes.append(f"{o} -> {d}")
            logger.warning(
                "No flight edges from %s to %s after award-first, SERP-first, get_flights_serp_only, and nearby-hub (if applicable).",
                o, d,
            )

    if not edges_all:
        # No flight data for any route (small/remote cities or API limits)
        raise ValueError(
            f"No flight data found for any route. Failed routes: {', '.join(failed_routes) if failed_routes else 'all'}. "
            "Please try different airports or dates."
        )
    
    if successful_routes == 0:
        logger.warning(
            "No flight edges for any segment (failed: %s); optimizing with bus/car only where available.",
            ", ".join(failed_routes) if failed_routes else "all",
        )
    
    if failed_routes:
        logger.warning(f"Some routes failed to fetch flights: {', '.join(failed_routes)}. Continuing with available routes.")
    
    logger.info(f"Running ILP optimization with {len(edges_all)} edges for {len(travelers)} travelers")

    # Card benefits: travelers with cards that give free bags on specific airlines (e.g. Delta Gold) get lower effective cost
    traveler_profiles = {t: (user_repo.get_user_by_id(t) or {}) for t in travelers}
    benefit_airlines = build_benefit_airlines_for_travelers(traveler_profiles)
    if benefit_airlines and any(benefit_airlines.values()):
        logger.info("Card benefits for optimization: %s", {k: list(v) for k, v in benefit_airlines.items() if v})
    
    # Apply trip max_budget as cash constraint: per-traveler budget so total <= max_budget
    max_budget = trip.get("maxBudget") or trip.get("max_budget")
    try:
        max_budget = int(max_budget) if max_budget is not None else None
    except (TypeError, ValueError):
        max_budget = None
    default_cash_budget = (max_budget // len(travelers)) if (max_budget and len(travelers)) else 1e9

    # 7. Run ILP optimization using the selected mode
    # plan_maximize_points_value (points_maximizer.py) supports three strategies:
    # - "cpp_focused": Only use points when cpp > 1.0 (above market value)
    # - "money_saving": Use points whenever cpp > 0 (prioritize cash reduction)  
    # - "balanced": Optimize cpp adjusted by travel time and stops
    # When benefit_airlines is set, also adds W_benefit * bag_fee per passenger when payer's card gives free bags on that flight.
    relaxed_message: Optional[str] = None
    try:
        solution = run_ilp_from_edges(
            edges_all,
            travelers,
            start_city_by_trav,
            end_city_by_trav,
            user_points_by_trav,
            plan_maximize_points_value,
            meetup_cities=[],  # No meetup cities for now
            require_meetup_in_graph=False,
            must_visit_cities=city_codes,  # Each visited exactly once; optimizer chooses order to reduce cost
            transfer_graph=transfer_graph,
            transfer_bonuses={},
            bank_block_size=1000,
            allow_all_payers=True,
            default_cash_if_missing=1e7,
            default_time_if_missing=1e6,
            default_cash_budget=default_cash_budget,
            benefit_airlines=benefit_airlines,
            optimization_mode=optimization_mode,  # User-selected optimization strategy
        )
        
        status = solution.get("status", "Unknown")
        if status != "Optimal":
            # Handle both Infeasible and Not Solved (timeout) statuses
            if status in ("Infeasible", "Not Solved"):
                relaxed_solution: Optional[Dict[str, Any]] = None
                # Calculate smart budget based on actual route costs if we have edges
                smart_budget: Optional[int] = None
                if edges_all and max_budget is not None and max_budget > 0:
                    # Find minimum cost path to estimate realistic budget
                    min_route_cost = None
                    for (i, j, k), d in edges_all.items():
                        cost = d.get("cash_cost")
                        if cost is not None:
                            try:
                                cost_val = float(cost)
                                if min_route_cost is None or cost_val < min_route_cost:
                                    min_route_cost = cost_val
                            except (TypeError, ValueError):
                                pass
                    
                    # Estimate based on number of segments (cities + 1)
                    num_segments = len(city_codes) + 1 if city_codes else 2
                    if min_route_cost is not None and min_route_cost < 1e6:
                        estimated_total = int(min_route_cost * num_segments * 1.3)  # 30% buffer
                        if estimated_total > max_budget:
                            smart_budget = estimated_total
                            logger.info(
                                "Calculated smart budget: ${:,.0f} (user budget: ${:,.0f}, min flight: ${:.0f}, segments: {})".format(
                                    smart_budget, max_budget, min_route_cost, num_segments
                                )
                            )
                
                # 1) Quick check: try ONE budget retry (2x) to determine if this is a budget issue
                # If that also fails, skip directly to unconstrained to save time
                consecutive_infeasible = 0
                max_consecutive_infeasible = 1  # Stop retrying after this many consecutive failures
                
                budget_attempts = []
                if smart_budget and smart_budget > max_budget:
                    budget_attempts.append(("smart", smart_budget))
                # Only try 2x multiplier - if unconstrained works, we know it's budget related
                # If unconstrained fails too, it's not a budget issue
                if max_budget:
                    budget_attempts.append(("2x", max_budget * 2))
                
                if len(travelers) > 0:
                    for attempt_label, try_total_budget in budget_attempts:
                        try_budget = min(int(1e9), int(try_total_budget) // len(travelers))
                        if max_budget and try_budget <= (max_budget // len(travelers)):
                            continue
                        try:
                            sol_retry = run_ilp_from_edges(
                                edges_all,
                                travelers,
                                start_city_by_trav,
                                end_city_by_trav,
                                user_points_by_trav,
                                plan_maximize_points_value,
                                meetup_cities=[],
                                require_meetup_in_graph=False,
                                must_visit_cities=city_codes,
                                transfer_graph=transfer_graph,
                                transfer_bonuses={},
                                bank_block_size=1000,
                                allow_all_payers=True,
                                default_cash_if_missing=1e7,
                                default_time_if_missing=1e6,
                                default_cash_budget=try_budget,
                                benefit_airlines=benefit_airlines,
                                optimization_mode=optimization_mode,  # Use same mode
                            )
                            if sol_retry.get("status") == "Optimal" and any((sol_retry.get("path") or {}).values()):
                                relaxed_solution = sol_retry
                                tot = sol_retry.get("totals", {}).get("cash", 0) or 0
                                relaxed_message = (
                                    f"Your budget of ${max_budget:,} is too low for this trip. "
                                    f"We found a route with a budget of ${int(try_total_budget):,} (total cash: ${tot:,.0f}). "
                                    f"Consider increasing your budget to at least ${int(try_total_budget):,} or adding more points."
                                )
                                logger.info(f"Infeasible: found solution with {attempt_label} budget (${try_total_budget:,.0f})")
                                break
                            elif sol_retry.get("status") == "Infeasible":
                                consecutive_infeasible += 1
                                logger.info(f"Budget retry ({attempt_label}) still infeasible - likely not a budget issue")
                                if consecutive_infeasible >= max_consecutive_infeasible:
                                    logger.info("Skipping remaining budget retries - problem is not budget-related")
                                    break
                        except Exception as retry_err:
                            logger.debug("Relaxed budget retry (%s, $%s) failed: %s", attempt_label, try_total_budget, retry_err)
                
                # 2) Try with NO budget constraint to find the minimum cost route
                if relaxed_solution is None:
                    logger.info("Trying unconstrained optimization (no budget limit) to find minimum cost route...")
                    try:
                        unconstrained_solution = run_ilp_from_edges(
                            edges_all,
                            travelers,
                            start_city_by_trav,
                            end_city_by_trav,
                            user_points_by_trav,
                            plan_maximize_points_value,
                            meetup_cities=[],
                            require_meetup_in_graph=False,
                            must_visit_cities=city_codes,
                            transfer_graph=transfer_graph,
                            transfer_bonuses={},
                            bank_block_size=1000,
                            allow_all_payers=True,
                            default_cash_if_missing=1e7,
                            default_time_if_missing=1e6,
                            default_cash_budget=1e9,  # Effectively no budget constraint
                            benefit_airlines=benefit_airlines,
                            optimization_mode=optimization_mode,
                        )
                        unconstrained_status = unconstrained_solution.get("status", "Unknown")
                        logger.info(f"Unconstrained optimization returned status: {unconstrained_status}")
                        if unconstrained_status == "Optimal" and any((unconstrained_solution.get("path") or {}).values()):
                            relaxed_solution = unconstrained_solution
                            tot = unconstrained_solution.get("totals", {}).get("cash", 0) or 0
                            suggested_budget = int(tot * 1.1)  # 10% buffer
                            relaxed_message = (
                                f"Your budget of ${max_budget:,} is too low for this trip. "
                                f"The minimum cost route we found is ${tot:,.0f}. "
                                f"We recommend setting your budget to at least ${suggested_budget:,}."
                            )
                            logger.info(f"Found unconstrained solution with total cash: ${tot:,.0f}")
                        else:
                            logger.info(f"Unconstrained optimization also infeasible - problem is NOT budget-related (likely time constraints)")
                    except Exception as e:
                        logger.warning(f"Unconstrained optimization failed: {e}")
                
                # 3) Best-effort: minimum cash path from graph (may exceed budget/points)
                # Use multi-traveler version for group trips with different origins
                if relaxed_solution is None:
                    logger.info("All ILP attempts failed - falling back to best-effort pathfinding...")
                    relaxed_solution, relaxed_message = _best_effort_path_multi_traveler(
                        edges_all, start_city_by_trav, end_city_by_trav, travelers, 
                        must_visit=city_codes
                    )
                    # Fallback to single-traveler version if multi-traveler fails
                    if relaxed_solution is None:
                        relaxed_solution, relaxed_message = _best_effort_path_from_edges(
                            edges_all, start_city_by_trav, end_city_by_trav, travelers
                        )
                    if relaxed_solution and relaxed_message and max_budget:
                        # Enhance message with budget recommendation
                        tot = relaxed_solution.get("totals", {}).get("cash", 0) or 0
                        if tot > max_budget:
                            suggested_budget = int(tot * 1.1)  # 10% buffer
                            relaxed_message = (
                                f"Your budget of ${max_budget:,} is too low for this trip. "
                                f"The minimum cost route we found is ${tot:,.0f}. "
                                f"We recommend setting your budget to at least ${suggested_budget:,}."
                            )
                
                # 4) Use relaxed solution - always return the closest itinerary if we found any route
                if relaxed_solution and any((relaxed_solution.get("path") or {}).values()):
                    solution = relaxed_solution
                    logger.info("Using closest available itinerary: %s", relaxed_message[:80] if relaxed_message else "")
                else:
                    # Only fail if NO routes exist at all (not a budget issue)
                    logger.info(
                        "No routes found between destinations - this is a routing issue, not budget"
                    )
                    raise ValueError(
                        "No routes found between your chosen destinations on the selected dates. "
                        "This is not a budget issue - no flights are available for this route. "
                        "Try choosing different dates or modifying your destinations."
                    )
            elif status == "Unbounded":
                logger.warning("Optimization is unbounded - this should not happen with proper constraints")
            else:
                logger.warning(f"ILP optimization status: {status}. Solution may not be optimal.")
        else:
            logger.info("ILP optimization completed successfully with optimal solution")
        
        # Validate solution has paths
        paths = solution.get("path", {})
        if not paths or not any(paths.values()):
            raise ValueError(
                "Optimization completed but no valid paths found. "
                "This may indicate no feasible routes exist between your destinations."
            )
            
    except ValueError:
        # Re-raise ValueError as-is (these are user-facing errors)
        raise
    except Exception as e:
        logger.error(f"Error running ILP optimization: {e}", exc_info=True)
        raise ValueError(f"Failed to optimize itinerary: {str(e)}. Please check your trip configuration.")
    
    # 8. Save itinerary
    # Convert solution to itinerary format
    itinerary_items = []
    
    # Initialize optional OOP results (these are populated in advanced optimization modes)
    oop_result: Optional[Dict[str, Any]] = None
    oop_hotels_result: Optional[Dict[str, Any]] = None
    
    # Totals (needed for path item costs); solution["totals"] is populated by the optimizer
    totals_for_path = solution.get("totals", {})
    
    # NOTE: Day allocation logic:
    # - Origin (path[0]) gets 0 days (departure only). Return-to-origin (path[-1]==path[0]) gets 0 days.
    # - Stays = cities in path[1:] that are in city_codes OR the end when it's a real destination (path[-1]!=path[0]).
    #   E.g. JFK→DOH→HKG with only HKG in city_codes: 9 days in HKG; Doha is transit (0 days).
    # - Days are split evenly among stay cities, with remainder to the last.
    # - To avoid splitting, only add destinations you actually want to stay in; connection cities will get 0 days.

    # Save paths for each traveler (include route, totalCost, pointsCost, name so frontend shows them as itineraries)
    total_days = _parse_trip_duration_days(trip)
    
    # User’s chosen destinations (city_codes, case-normalized). Transit/connection stops (e.g. Doha on JFK–DOH–HKG) are not in this set.
    _dest = set((c or "").upper() for c in (city_codes or []))
    logger.info(
        f"Allocating {total_days} days across destination cities: {list(_dest)}; start={start_dest_code}, end={end_dest_code}"
    )

    for traveler_id, path in solution.get("path", {}).items():
        if path:
            requested = set(_dest)
            # When the end is a real destination (not return-to-origin), include it so it gets stay days (e.g. JFK→DOH→HKG: 9 days in HKG).
            is_round_trip = len(path) >= 2 and (path[-1] or "").upper() == (path[0] or "").upper()
            if len(path) >= 2 and not is_round_trip:
                requested.add((path[-1] or "").upper())
            
            # For stay/transit calculation, exclude the return-to-origin in round trips
            # path[1:] for one-way: all cities after start
            # path[1:-1] for round trip: cities between start and return-to-start
            cities_to_consider = path[1:-1] if is_round_trip and len(path) > 2 else path[1:]
            
            # Stays = path nodes after origin that are in requested (path order). Transit stops are excluded.
            stays = [c for c in cities_to_consider if (c or "").upper() in requested]
            transit = [c for c in cities_to_consider if (c or "").upper() not in requested]
            if transit:
                logger.info(f"Route includes transit cities (0 days each): {transit}")

            if stays:
                num = len(stays)
                base = max(1, total_days // num)
                remainder = total_days - base * num
                day_list = [base] * num
                if remainder:
                    day_list[-1] += remainder
                city_objs = [{"name": c, "days": day_list[i]} for i, c in enumerate(stays)]
                logger.info(
                    f"Allocated days for traveler {traveler_id}: " + ", ".join([f"{c['name']}={c['days']}d" for c in city_objs])
                )
            else:
                city_objs = []
                logger.warning(f"No overnight stays allocated for traveler {traveler_id} (path={path})")
            # Calculate score based on optimization quality
            # - Base: 90 (optimized with real data beats simple generator's 88)
            # - Bonus for using points (+5 if points_value > 0)
            # - Bonus for staying within budget (+3)
            total_cash = int(totals_for_path.get("cash") or 0)
            points_value = float(totals_for_path.get("points_value") or 0)
            points_cost = int(totals_for_path.get("airline_points") or 0)
            
            score = 90
            if points_value > 0:
                score += 5  # Using points effectively
            if max_budget and total_cash <= max_budget:
                score += 3  # Within budget
            score = min(99, score)
            
            within_budget = max_budget is None or max_budget <= 0 or total_cash <= max_budget
            
            item = {
                "tripId": trip_id,
                "itemId": f"path_{traveler_id}",
                "type": "path",
                "travelerId": traveler_id,
                "path": path,
                "route": path,  # full sequence for Route display (origin -> ... -> end)
                "cities": city_objs,  # stays only, with days (origin/return get 0 days)
                "totalCost": total_cash,
                "pointsCost": points_cost,
                "score": score,  # Quality score for UI display
                "withinBudget": within_budget,
                "withinPoints": True,  # Points are auto-allocated by optimizer
                "name": "Optimized route",
            }
            itinerary_items.append(item)
            
            logger.info(
                f"Created optimized itinerary for {traveler_id}: "
                f"totalCost=${total_cash:,}, pointsCost={points_cost:,}, "
                f"score={score}, path={' -> '.join(path)}"
            )
    
    # Save payment modes (add mode: flight|bus|car and flight times from edge[2] for frontend)
    for traveler_id, payments in solution.get("pay_mode", {}).items():
        if payments:
            enriched = []
            for rec in payments:
                r = dict(rec)
                edge = r.get("edge")
                fn = edge[2] if isinstance(edge, (list, tuple)) and len(edge) >= 3 else None
                r["mode"] = "bus" if fn == "BUS" else "car" if fn == "CAR" else "flight"
                # Add departure/arrival times from edges_all if available
                if isinstance(edge, (list, tuple)) and len(edge) >= 3:
                    edge_key = tuple(edge)
                    edge_data = edges_all.get(edge_key, {})
                    if edge_data.get("departure_time"):
                        r["departure_time"] = edge_data["departure_time"]
                    if edge_data.get("arrival_time"):
                        r["arrival_time"] = edge_data["arrival_time"]
                    # Also add operating airline for codeshare detection
                    if edge_data.get("operating_airline"):
                        r["operating_airline"] = edge_data["operating_airline"]
                enriched.append(r)
            item = {
                "tripId": trip_id,
                "itemId": f"payments_{traveler_id}",
                "type": "payments",
                "travelerId": traveler_id,
                "payments": enriched,
            }
            itinerary_items.append(item)
    
    # Save totals (enrich transfers with operating_carriers, segment_description, route_segments, and hotel info)
    # Hotel program codes for detecting hotel transfers
    HOTEL_PROGRAMS = {"HYATT", "HH", "MAR", "IHG", "ACC", "WYNDHAM", "HILTON", "MARRIOTT", "BONVOY"}
    _HUMANIZE_HOTEL = {
        "HYATT": "World of Hyatt",
        "HH": "Hilton Honors",
        "MAR": "Marriott Bonvoy",
        "MARRIOTT": "Marriott Bonvoy",
        "BONVOY": "Marriott Bonvoy",
        "IHG": "IHG One Rewards",
        "HILTON": "Hilton Honors",
        "ACC": "Accor Live Limitless",
        "WYNDHAM": "Wyndham Rewards",
    }
    
    totals = dict(totals_for_path)
    totals["transfers"] = dict(totals.get("transfers") or {})
    for q, by_src in (totals_for_path.get("transfers") or {}).items():
        totals["transfers"][q] = dict(by_src or {})
        for s, by_al in (by_src or {}).items():
            totals["transfers"][q][s] = dict(by_al or {})
            for a, data in (by_al or {}).items():
                data = dict(data)
                
                # Detect if this is a hotel program transfer
                is_hotel = a.upper() in HOTEL_PROGRAMS or any(h in a.upper() for h in ["HYATT", "HILTON", "MARRIOTT", "IHG", "BONVOY"])
                data["is_hotel"] = is_hotel
                
                edges_for_sa = []
                hotel_names = []
                hotel_cities = []
                
                for _p, recs in (solution.get("pay_mode") or {}).items():
                    for rec in (recs or []):
                        if rec.get("type") != "points" or rec.get("payer") != q:
                            continue
                        v = rec.get("via") or {}
                        source_match = (v.get("source") or "").lower().strip() == s
                        
                        # Check for airline match (flights) or hotel match (hotels)
                        airline_match = (v.get("airline") or "").upper().strip() == a
                        hotel_match = (v.get("hotel") or "").upper().strip() == a
                        
                        if not source_match or not (airline_match or hotel_match):
                            continue
                        
                        # For flights: extract edge info
                        edge = rec.get("edge")
                        if isinstance(edge, (list, tuple)) and len(edge) >= 3:
                            edges_for_sa.append(tuple(edge))
                        
                        # For hotels: extract hotel name and city
                        if hotel_match or is_hotel:
                            h_name = rec.get("hotelName") or rec.get("hotel_name") or ""
                            h_city = rec.get("hotelCity") or rec.get("hotel_city") or rec.get("location") or ""
                            if h_name and h_name not in hotel_names:
                                hotel_names.append(h_name)
                            if h_city and h_city not in hotel_cities:
                                hotel_cities.append(h_city)
                
                op_carriers = []
                route_segments = []
                departures = []
                arrivals = []
                
                if is_hotel:
                    # Hotel transfer - add hotel-specific info
                    data["hotel_names"] = hotel_names
                    data["hotel_cities"] = hotel_cities
                    if hotel_names:
                        data["hotel_display"] = " + ".join(hotel_names)
                    if hotel_cities:
                        data["location_display"] = ", ".join(hotel_cities)
                    # Humanize hotel program name
                    data["partner_display"] = _HUMANIZE_HOTEL.get(a.upper(), a)
                else:
                    # Flight transfer - extract route segments
                    for e in edges_for_sa:
                        # Extract route segment info (departure → arrival)
                        if len(e) >= 2:
                            dep = str(e[0] or "").upper().strip()
                            arr = str(e[1] or "").upper().strip()
                            if dep and arr:
                                route_seg = f"{dep}→{arr}"
                                if route_seg not in route_segments:
                                    route_segments.append(route_seg)
                                if dep not in departures:
                                    departures.append(dep)
                                if arr not in arrivals:
                                    arrivals.append(arr)
                        # Extract operating carrier
                        if e in edges_all:
                            op = (edges_all[e].get("operating_airline") or "").strip().upper()
                            if op and len(op) >= 2 and op[:2] not in op_carriers:
                                op_carriers.append(op[:2])
                    
                    data["operating_carriers"] = op_carriers
                    # Add route segment information for frontend display
                    data["route_segments"] = route_segments
                    data["departures"] = departures
                    data["arrivals"] = arrivals
                    # Build display string for the frontend
                    if route_segments:
                        data["route_display"] = " + ".join(route_segments)
                
                seg_desc = None
                if op_carriers and not is_hotel:
                    diff = [c for c in op_carriers if c != a]
                    if diff:
                        names = [_HUMANIZE_AIRLINE.get(c) or c for c in diff]
                        seg_desc = " and ".join(names) + (" (codeshare)" if len(names) == 1 else " (codeshares)")
                data["segment_description"] = seg_desc
                totals["transfers"][q][s][a] = data
    totals_item = {
        "tripId": trip_id,
        "itemId": "totals",
        "type": "totals",
        "totals": totals,
    }
    itinerary_items.append(totals_item)

    # Post-optimization: run transfer tips and smart tips in parallel (saves 5-15s)
    from src.handlers.openAI import get_itinerary_smart_tips

    aw_tips = build_transfer_tips_from_solution(solution, edges_all)
    points_programs = list({p for u in user_points_by_trav.values() for p in u})
    
    # Start smart tips (always needed, runs in thread since it's sync OpenAI)
    smart_tips_task = asyncio.create_task(asyncio.to_thread(
        get_itinerary_smart_tips,
        origin=start_dest_name or start_dest_code,
        destination=end_dest_name or end_dest_code,
        city_names=cities if cities else None,
        start_date=start_date or None,
        end_date=end_date or None,
        points_programs=points_programs if points_programs else None,
    ))
    
    # Start Panorama fallback if AwardTool tips are empty (runs async)
    panorama_task = None
    if not aw_tips:
        user_banks = list({k for u in user_points_by_trav.values() for k in (u or {}) if isinstance(k, str) and (k or "").lower() in (DEFAULT_TRANSFER_GRAPH or {})})
        panorama_task = asyncio.create_task(_get_transfer_tips_from_panorama(
            origin=start_dest_code,
            destination=end_dest_code or start_dest_code,
            start_date=(start_date or "").strip(),
            end_date=(end_date or "").strip(),
            user_banks=user_banks,
        ))
    
    # Await both tasks
    tips = await smart_tips_task
    if panorama_task is not None:
        aw_tips = await panorama_task
    
    # Prefer AwardTool-derived transfer tips (exact amounts and partners) over generic AI
    if aw_tips:
        tips["transfer_tips"] = aw_tips

    tips_item = {
        "tripId": trip_id,
        "itemId": "itinerary_smart_tips",
        "type": "itinerary_smart_tips",
        "transfer_tips": tips.get("transfer_tips", []),
        "sample_itineraries": tips.get("sample_itineraries", []),
        "holiday_advice": tips.get("holiday_advice", []),
        "practical_tips": tips.get("practical_tips", []),
    }
    itinerary_items.append(tips_item)

    # Out-of-pocket: persist and attach to response for simple A->B round-trips
    oop_payload: Optional[Dict[str, Any]] = None
    if oop_result and not oop_result.get("error"):
        oop_payload = {
            "best_by_cash": oop_result.get("best_by_cash"),
            "best_by_surcharge": oop_result.get("best_by_surcharge"),
            "best_overall": oop_result.get("best_overall"),
            "origin": oop_result.get("origin"),
            "destination": oop_result.get("destination"),
            "outbound_date": oop_result.get("outbound_date"),
            "return_date": oop_result.get("return_date"),
        }
        oop_item = {
            "tripId": trip_id,
            "itemId": "out_of_pocket",
            "type": "out_of_pocket",
            **oop_payload,
        }
        itinerary_items.append(oop_item)

    # Hotel out-of-pocket: persist and attach for simple trips
    oop_hotels_payload: Optional[Dict[str, Any]] = None
    if oop_hotels_result and oop_hotels_result.get("options"):
        oop_hotels_payload = {
            "best_by_cash": oop_hotels_result.get("best_by_cash"),
            "best_by_points": oop_hotels_result.get("best_by_points"),
            "best_overall": oop_hotels_result.get("best_overall"),
            "destination": oop_hotels_result.get("destination"),
            "check_in": oop_hotels_result.get("check_in"),
            "check_out": oop_hotels_result.get("check_out"),
        }
        oop_h_item = {
            "tripId": trip_id,
            "itemId": "out_of_pocket_hotels",
            "type": "out_of_pocket_hotels",
            **oop_hotels_payload,
        }
        itinerary_items.append(oop_h_item)

    # Hotel calendar recommendations: fetch for each destination city (multi-city trips)
    # This provides accurate points/cash pricing using the hotel_calendar API
    hotel_recommendations_payload: Optional[Dict[str, Any]] = None
    if trip.get("includeHotels", True) and city_codes:
        try:
            from src.handlers.hotels import search_hotels_with_calendar
            
            # Calculate stay duration per city (from day allocation)
            path_cities = []
            for traveler_id, path in solution.get("path", {}).items():
                if path and len(path) > 1:
                    # For round trips, exclude start/end cities
                    is_round_trip = len(path) >= 2 and path[0] == path[-1]
                    path_cities = path[1:-1] if is_round_trip else path[1:]
                    break
            
            # Build hotel recommendations for each destination
            hotel_recs_by_city = {}
            total_trip_days = (datetime.strptime(end_date.strip(), "%Y-%m-%d") - datetime.strptime(start_date.strip(), "%Y-%m-%d")).days
            days_per_city = max(1, total_trip_days // max(len(city_codes), 1))
            
            # Get city names for hotel search
            dest_names = {d.get("code"): d.get("cityName") or d.get("name") for d in destinations if d.get("code")}
            
            for city_code in city_codes:
                city_name = dest_names.get(city_code, city_code)
                
                # Calculate check-in/check-out dates for this city
                # Simple allocation: distribute days evenly
                city_idx = city_codes.index(city_code)
                city_start = datetime.strptime(start_date.strip(), "%Y-%m-%d") + timedelta(days=city_idx * days_per_city)
                city_end = city_start + timedelta(days=days_per_city)
                
                try:
                    result = await search_hotels_with_calendar(
                        destination=city_name,
                        check_in=city_start.strftime("%Y-%m-%d"),
                        check_out=city_end.strftime("%Y-%m-%d"),
                        top_hotels=3,
                    )
                    
                    if result and not result.get("error"):
                        hotel_recs_by_city[city_code] = {
                            "city": city_name,
                            "check_in": city_start.strftime("%Y-%m-%d"),
                            "check_out": city_end.strftime("%Y-%m-%d"),
                            "nights": days_per_city,
                            "recommendations": result.get("recommendations"),
                            "hotels": result.get("calendar_enriched", []),
                        }
                        logger.info(f"Hotel recommendations for {city_name}: {len(result.get('calendar_enriched', []))} options")
                except Exception as e:
                    logger.warning(f"Failed to get hotel recommendations for {city_name}: {e}")
            
            if hotel_recs_by_city:
                hotel_recommendations_payload = {
                    "cities": hotel_recs_by_city,
                    "total_cities": len(hotel_recs_by_city),
                }
                
                hotel_recs_item = {
                    "tripId": trip_id,
                    "itemId": "hotel_recommendations",
                    "type": "hotel_recommendations",
                    **hotel_recommendations_payload,
                }
                itinerary_items.append(hotel_recs_item)
                logger.info(f"Added hotel recommendations for {len(hotel_recs_by_city)} cities")
        except Exception as e:
            logger.warning(f"Hotel calendar recommendations failed: {e}")

    # When we used relaxed budget or best-effort path, add an info item and flag the response
    if relaxed_message:
        actual_cost = solution.get("totals", {}).get("cash") or 0
        suggested_budget = int(actual_cost * 1.1) if actual_cost > 0 else None  # 10% buffer
        relaxed_info = {
            "tripId": trip_id,
            "itemId": "itinerary_relaxed_info",
            "type": "itinerary_relaxed_info",
            "message": relaxed_message,
            "original_budget": max_budget,
            "suggested_cash": actual_cost,
            "suggested_budget": suggested_budget,
            "budget_exceeded": max_budget is not None and actual_cost > max_budget,
        }
        itinerary_items.append(relaxed_info)

    # Write all itinerary items in a single batch (more efficient than individual put_item calls)
    itinerary_repo.batch_write_items(itinerary_items)

    # Build enhanced OOP optimization summary from ILP solution
    oop_optimization_summary = build_oop_optimization_summary(
        solution=solution,
        user_points={k: v for u in user_points_by_trav.values() for k, v in (u or {}).items()},
    )
    
    # Add OOP optimization item to itinerary
    oop_optimization_item = {
        "tripId": trip_id,
        "itemId": "oop_optimization",
        "type": "oop_optimization",
        **oop_optimization_summary,
    }
    itinerary_items.append(oop_optimization_item)
    itinerary_repo.put_item(oop_optimization_item)

    out: Dict[str, Any] = {
        "status": solution.get("status", "Unknown"),
        "solution": solution,
        "items": itinerary_items,
        "out_of_pocket": oop_payload,
    }
    if oop_hotels_payload is not None:
        out["out_of_pocket_hotels"] = oop_hotels_payload
    if hotel_recommendations_payload is not None:
        out["hotel_recommendations"] = hotel_recommendations_payload
    if relaxed_message:
        out["relaxed_constraints"] = True
        out["relaxed_message"] = relaxed_message
    return _enforce_no_negative_numbers(out, context="legacy itinerary generate_optimized_itinerary")
