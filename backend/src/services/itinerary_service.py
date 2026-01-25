import asyncio
import heapq
import os
import uuid
import logging
import re
from datetime import datetime
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

logger = logging.getLogger(__name__)

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
    bank_mapping = {
        "amex": "amex",
        "amex membership rewards": "amex",
        "membership rewards": "amex",
        "chase": "chase",
        "chase ultimate rewards": "chase",
        "ultimate rewards": "chase",
        "citi": "citi",
        "citi thankyou": "citi",
        "citi thankyou points": "citi",
        "thankyou": "citi",
        "thankyou points": "citi",
        "capital one": "capitalone",
        "capital one miles": "capitalone",
        "capitalone": "capitalone",
        "venture": "capitalone",
        "bilt": "bilt",
        "bilt rewards": "bilt",
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


def _calculate_minimum_budget(num_cities: int, total_days: int, include_hotels: bool = True) -> int:
    """
    Calculate the absolute minimum budget needed for a trip.
    Used to provide realistic budget suggestions when user's budget is too low.
    
    Args:
        num_cities: Number of cities to visit (stays, not including origin/transit)
        total_days: Total trip duration in days
        include_hotels: Whether hotels are included in the trip cost
    
    Returns:
        Minimum budget in dollars
    """
    base_cost_per_day = 200 if include_hotels else 120
    base_cost_per_city = 300 if include_hotels else 200
    
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

    # Align with user's includeHotels: lower costs when hotels excluded (flights + activities only)
    include_hotels = trip.get("includeHotels", True) is not False
    base_cost_per_day = 200 if include_hotels else 120
    base_cost_per_city = 300 if include_hotels else 200
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
    min_budget_needed = _calculate_minimum_budget(len(stay_names), total_days, include_hotels)
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
                f"We recommend at least ${min_budget_needed:,} for {len(stay_names)} cities over {total_days} days "
                f"({'with hotels' if include_hotels else 'without hotels'}). "
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
    """
    city_name = city_name.strip()
    
    # If it's already an airport code, return it
    if _is_airport_code(city_name):
        return city_name.upper()
    
    # Check if it's in format "City (CODE1,CODE2,CODE3)" and extract first code
    import re
    code_match = re.search(r'\(([A-Z]{3}(?:,[A-Z]{3})*)\)', city_name.upper())
    if code_match:
        # Extract first airport code from comma-separated list
        codes = code_match.group(1).split(',')
        first_code = codes[0].strip()
        if _is_airport_code(first_code):
            return first_code.upper()
    
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

    # Fallback: try OpenAI for small/remote cities not in our static/Amadeus data
    try:
        from src.handlers.openAI import find_commercial_airports_for_city
        ai_airports = find_commercial_airports_for_city(search_name, max_results=3)
        for a in ai_airports:
            code = (a.get("iata_code") or "").upper().strip()
            if code and _is_airport_code(code):
                return code
    except Exception as e:
        logger.debug(f"OpenAI airport lookup for {city_name}: {e}")
    
    # If search fails, try to extract code from name (e.g., "New York (JFK)" or "New York (JFK,LGA,EWR)")
    # Handle both single code and multiple codes
    match = re.search(r'\(([A-Z]{3}(?:,[A-Z]{3})*)\)', city_name.upper())
    if match:
        # Extract first airport code from comma-separated list
        codes = match.group(1).split(',')
        first_code = codes[0].strip()
        if _is_airport_code(first_code):
            return first_code.upper()
    
    return None


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
    
    # Build transfer summary
    transfers = totals.get("transfers", {})
    transfer_summary = []
    
    for traveler, by_source in transfers.items():
        for source, by_airline in (by_source or {}).items():
            for airline, data in (by_airline or {}).items():
                source_points = data.get("source_points", 0)
                delivered_points = data.get("delivered_airline_points", 0)
                
                if source_points > 0:
                    # Get bank metadata
                    bank_name = _HUMANIZE_BANK.get(source.lower(), source)
                    airline_name = _HUMANIZE_AIRLINE.get(airline.upper(), airline)
                    
                    transfer_summary.append({
                        "from_bank": source.lower(),
                        "from_bank_name": bank_name,
                        "to_program": airline.upper(),
                        "to_program_name": airline_name,
                        "points_to_transfer": source_points,
                        "points_received": int(delivered_points),
                        "transfer_ratio": f"1:{int(delivered_points/source_points)}" if source_points else "1:1",
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
    
    # Generate booking order instructions
    booking_order = []
    step = 1
    
    # Step 1: Transfers (do first)
    for xfer in transfer_summary:
        booking_order.append({
            "step": step,
            "type": "transfer",
            "action": f"Transfer {xfer['points_to_transfer']:,} points from {xfer['from_bank_name']} to {xfer['to_program_name']}",
            "details": f"You'll receive {xfer['points_received']:,} {xfer['to_program_name']} points",
            "timing": _get_transfer_timing(xfer['from_bank']),
        })
        step += 1
    
    # Step 2: Book flights
    for payment in payment_breakdown:
        if payment["payment_type"] == "points":
            booking_order.append({
                "step": step,
                "type": "book_flight",
                "action": f"Book {payment['segment']} with {payment['points_used']:,} {payment.get('program_name', '')} miles",
                "details": f"Pay ${payment['cash_paid']:.2f} in taxes/fees",
            })
        else:
            booking_order.append({
                "step": step,
                "type": "book_flight",
                "action": f"Book {payment['segment']} with cash",
                "details": f"Pay ${payment['cash_paid']:.2f}",
            })
        step += 1
    
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
        "transfer_summary": transfer_summary,
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


async def generate_optimized_itinerary(trip_id: str) -> Dict[str, Any]:
    """
    Generate optimized itinerary using points maximization algorithm.
    
    This function:
    1. Gets trip data (dates, destinations, members)
    2. Gets points for all members
    3. Converts city names to airport codes
    4. Fetches flight edges for all routes
    5. Runs ILP optimization to maximize points value
    6. Saves and returns the optimized itinerary
    
    Raises:
        ValueError: If trip data is invalid, missing required fields, or optimization fails
    """
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
    logger.info(f"Converting city names to airport codes: start={start_dest_name}, end={end_dest_name}, cities={cities}")
    
    # Build list of all city names to resolve
    names_to_resolve = [start_dest_name]
    if end_dest_name and end_dest_name != start_dest_name:
        names_to_resolve.append(end_dest_name)
    names_to_resolve.extend(cities)
    
    # Resolve all in parallel (each _normalize_city_to_code can hit city_service or OpenAI)
    code_results = await asyncio.gather(
        *[asyncio.to_thread(_normalize_city_to_code, name) for name in names_to_resolve],
        return_exceptions=True,
    )
    
    # Map results back
    idx = 0
    start_dest_code = code_results[idx] if not isinstance(code_results[idx], Exception) else None
    idx += 1
    
    if end_dest_name and end_dest_name != start_dest_name:
        end_dest_code = code_results[idx] if not isinstance(code_results[idx], Exception) else None
        idx += 1
    else:
        end_dest_code = start_dest_code
    
    city_codes = []
    for i, city_name in enumerate(cities):
        result = code_results[idx + i]
        if isinstance(result, Exception):
            logger.warning(f"Error resolving '{city_name}': {result}")
        elif result:
            city_codes.append(result)
        else:
            logger.warning(f"Could not find airport code for '{city_name}', skipping")
    
    # Validate start/end codes
    if not start_dest_code:
        logger.info(f"No airport code for start '{start_dest_name}'; using OpenAI to suggest routes for small/remote city")
        return _save_and_return_ai_route_suggestions(
            trip_id, start_dest_name, end_dest_name or start_dest_name, cities, start_date, end_date, failed_routes=None
        )
    if not end_dest_code:
        logger.info(f"No airport code for end '{end_dest_name}'; using OpenAI to suggest routes for small/remote city")
        return _save_and_return_ai_route_suggestions(
            trip_id, start_dest_name, end_dest_name or start_dest_name, cities, start_date, end_date, failed_routes=None
        )
    
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
    
    travelers = [m.get("userId", "") for m in members if m.get("status") == "active"]
    if not travelers:
        raise ValueError("No active members found. Please ensure at least one member has active status.")
    
    if len(travelers) == 0:
        raise ValueError("No active travelers found for optimization")
    
    logger.info(f"Found {len(travelers)} active travelers: {travelers}")

    # Start OOP and hotels optimization as background tasks (run in parallel with flight fetch)
    # Out-of-pocket optimizer for simple A->B round-trips (SerpAPI cash + AwardTool points/surcharge)
    oop_task = None
    if (
        start_dest_code
        and end_dest_code
        and start_dest_code != end_dest_code
        and not city_codes
        and start_date
        and end_date
        and travelers
    ):
        from src.services.serp_api_functions import optimize_itinerary_out_of_pocket
        oop_task = asyncio.create_task(asyncio.to_thread(
            optimize_itinerary_out_of_pocket,
            origin=start_dest_code,
            destination=end_dest_code,
            outbound_date=start_date.strip(),
            return_date=end_date.strip(),
            programs=get_award_programs_for_api(),
            cabins=["Economy"],
            pax=len(travelers),
        ))

    # Hotel out-of-pocket: AwardTool (cash + points) + SerpAPI Google Hotels (cash) for simple trips
    # Only when trip has includeHotels=True (default); allows excluding hotels from calculations
    oop_hotels_task = None
    if (
        trip.get("includeHotels", True)
        and (end_dest_name or end_dest_code)
        and start_date
        and end_date
        and travelers
        and not city_codes
    ):
        from src.services.serp_api_functions import optimize_hotels_out_of_pocket
        oop_hotels_task = asyncio.create_task(asyncio.to_thread(
            optimize_hotels_out_of_pocket,
            destination=(end_dest_name or end_dest_code or "").strip(),
            check_in=start_date.strip(),
            check_out=end_date.strip(),
            programs=None,
            guests=len(travelers),
            hotel_class=None,
        ))

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
    
    # 5. Build start/end city mapping using airport codes (for now, all travelers use same start/end)
    start_city_by_trav = {t: start_dest_code for t in travelers}
    end_city_by_trav = {t: end_dest_code for t in travelers}
    
    # 6. Fetch flight edges using airport codes
    # Build all possible routes: start -> city1 -> city2 -> ... -> end
    # For round-trip (start==end with cities), include the return leg so we fetch e.g. ITH->CDG and CDG->ITH
    all_cities = [start_dest_code] + city_codes
    if end_dest_code != start_dest_code or city_codes:
        all_cities = all_cities + [end_dest_code]
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
    logger.info(f"Optimizing route over {nodes} (start={start_dest_code}, end={end_dest_code}); order flexible for {len(city_codes)} cities")
    
    edges_all = {}
    transfer_graph = DEFAULT_TRANSFER_GRAPH
    successful_routes = 0
    failed_routes = []
    pairs = [(o, d) for o in nodes for d in nodes if o != d]

    # Combined points from all travelers (same for every O-D pair)
    combined_points = {}
    for user_id, points in user_points_by_trav.items():
        for prog, bal in points.items():
            combined_points[prog] = combined_points.get(prog, 0) + bal

    # Fetch all O-D pairs in parallel to avoid sequential SERP/AwardTool latency
    sem = asyncio.Semaphore(6)

    async def _bounded_fetch(o: str, d: str) -> Tuple[Dict[Tuple[str, str, str], Dict[str, Any]], bool]:
        async with sem:
            leg_date = end_date.strip() if (d == start_dest_code and end_date) else start_date.strip()
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

    # Await OOP and hotels tasks (they ran in parallel with flight fetch)
    oop_result: Optional[Dict[str, Any]] = None
    if oop_task is not None:
        try:
            oop_result = await oop_task
        except Exception as e:
            logger.warning("optimize_itinerary_out_of_pocket failed: %s", e)
            oop_result = None
    
    oop_hotels_result: Optional[Dict[str, Any]] = None
    if oop_hotels_task is not None:
        try:
            oop_hotels_result = await oop_hotels_task
        except Exception as e:
            logger.warning("optimize_hotels_out_of_pocket failed: %s", e)
            oop_hotels_result = None

    if not edges_all:
        # No flight data for any route (small/remote cities or API limits). Use OpenAI to suggest routes.
        logger.info(
            f"No flight edges for any route (failed: {failed_routes}); using OpenAI to suggest routes for small/remote cities"
        )
        return _save_and_return_ai_route_suggestions(
            trip_id,
            start_dest_name or start_dest_code,
            end_dest_name or end_dest_code,
            cities,
            start_date,
            end_date,
            failed_routes=failed_routes,
            points_programs=list({p for u in user_points_by_trav.values() for p in u}),
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

    # 7. Run ILP optimization using OOP (Out-Of-Pocket) mode
    # plan_maximize_points_value (points_maximizer.py) with optimization_mode="oop":
    # - Prioritizes minimizing total cash paid (cash bookings + surcharges)
    # - Uses points whenever they reduce out-of-pocket costs (no CPP threshold)
    # - Differs from "cpp" mode which only uses points if CPP >= 1.0 cent
    # When benefit_airlines is set, also adds W_benefit * bag_fee per passenger when payer's card gives free bags on that flight.
    relaxed_message: Optional[str] = None
    try:
        solution = run_ilp_from_edges(
            edges_all,
            travelers,
            start_city_by_trav,
            end_city_by_trav,
            user_points_by_trav,
            plan_maximize_points_value,  # OOP mode: minimize out-of-pocket, use points aggressively
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
            optimization_mode="oop",  # Minimize out-of-pocket (not CPP)
        )
        
        status = solution.get("status", "Unknown")
        if status != "Optimal":
            if status == "Infeasible":
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
                
                # 1) Retry with smart budget first, then fallback to multipliers
                budget_attempts = []
                if smart_budget and smart_budget > max_budget:
                    budget_attempts.append(("smart", smart_budget))
                # Add multiplier attempts
                for mult in [2, 3, 5, 10]:
                    mult_budget = (max_budget * mult) if max_budget else None
                    if mult_budget:
                        budget_attempts.append((f"{mult}x", mult_budget))
                
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
                                optimization_mode="oop",  # Minimize out-of-pocket
                            )
                            if sol_retry.get("status") == "Optimal" and any((sol_retry.get("path") or {}).values()):
                                relaxed_solution = sol_retry
                                tot = sol_retry.get("totals", {}).get("cash", 0) or 0
                                relaxed_message = (
                                    f"Your budget of ${max_budget:,} is too low for this trip. "
                                    f"We found a route with a budget of ${int(try_total_budget):,} (total cash: ${tot:,.0f}). "
                                    f"Consider increasing your budget to at least ${int(try_total_budget):,} or adding more points."
                                )
                                logger.info("Infeasible: found solution with %s budget (${:,.0f})", attempt_label, try_total_budget)
                                break
                        except Exception as retry_err:
                            logger.debug("Relaxed budget retry (%s, $%s) failed: %s", attempt_label, try_total_budget, retry_err)
                
                # 2) Best-effort: minimum cash path from graph (may exceed budget/points)
                if relaxed_solution is None:
                    relaxed_solution, relaxed_message = _best_effort_path_from_edges(
                        edges_all, start_city_by_trav, end_city_by_trav, travelers
                    )
                    if relaxed_solution and relaxed_message and max_budget:
                        # Enhance message with budget recommendation
                        tot = relaxed_solution.get("totals", {}).get("cash", 0) or 0
                        if tot > max_budget:
                            relaxed_message = (
                                f"Your budget of ${max_budget:,} is insufficient. "
                                f"The lowest-cost route we found costs ${tot:,.0f}. "
                                f"We recommend a budget of at least ${int(tot * 1.2):,}."
                            )
                
                # 3) Use relaxed solution or raise explicit error (NO FALLBACKS)
                if relaxed_solution and any((relaxed_solution.get("path") or {}).values()):
                    solution = relaxed_solution
                    logger.info("Using relaxed/best-effort solution: %s", relaxed_message[:80] if relaxed_message else "")
                else:
                    # NO FALLBACK - Raise explicit error with actionable guidance
                    logger.info(
                        "No feasible optimized solution found - raising explicit error"
                    )
                    raise ValueError(
                        "Unable to find a valid route with the given constraints. "
                        "This may be because: (1) Your budget is too low for available flights, "
                        "(2) No flights are available on your selected dates, or "
                        "(3) No routes exist between your chosen destinations. "
                        "Try increasing your budget, choosing different dates, or modifying your destinations."
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
            if len(path) >= 2 and (path[-1] or "").upper() != (path[0] or "").upper():
                requested.add((path[-1] or "").upper())
            # Stays = path nodes after origin that are in requested (path order). Transit stops are excluded.
            stays = [c for c in path[1:] if (c or "").upper() in requested]
            transit = [c for c in path[1:] if (c or "").upper() not in requested]
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
            item = {
                "tripId": trip_id,
                "itemId": f"path_{traveler_id}",
                "type": "path",
                "travelerId": traveler_id,
                "path": path,
                "route": path,  # full sequence for Route display (origin -> ... -> end)
                "cities": city_objs,  # stays only, with days (origin/return get 0 days)
                "totalCost": int(totals_for_path.get("cash") or 0),
                "pointsCost": int(totals_for_path.get("airline_points") or 0),
                "name": "Optimized route",
            }
            itinerary_items.append(item)
    
    # Save payment modes (add mode: flight|bus|car from edge[2] for frontend)
    for traveler_id, payments in solution.get("pay_mode", {}).items():
        if payments:
            enriched = []
            for rec in payments:
                r = dict(rec)
                edge = r.get("edge")
                fn = edge[2] if isinstance(edge, (list, tuple)) and len(edge) >= 3 else None
                r["mode"] = "bus" if fn == "BUS" else "car" if fn == "CAR" else "flight"
                enriched.append(r)
            item = {
                "tripId": trip_id,
                "itemId": f"payments_{traveler_id}",
                "type": "payments",
                "travelerId": traveler_id,
                "payments": enriched,
            }
            itinerary_items.append(item)
    
    # Save totals (enrich transfers with operating_carriers and segment_description for codeshare details)
    totals = dict(totals_for_path)
    totals["transfers"] = dict(totals.get("transfers") or {})
    for q, by_src in (totals_for_path.get("transfers") or {}).items():
        totals["transfers"][q] = dict(by_src or {})
        for s, by_al in (by_src or {}).items():
            totals["transfers"][q][s] = dict(by_al or {})
            for a, data in (by_al or {}).items():
                data = dict(data)
                edges_for_sa = []
                for _p, recs in (solution.get("pay_mode") or {}).items():
                    for rec in (recs or []):
                        if rec.get("type") != "points" or rec.get("payer") != q:
                            continue
                        v = rec.get("via") or {}
                        if (v.get("source") or "").lower().strip() != s or (v.get("airline") or "").upper().strip() != a:
                            continue
                        edge = rec.get("edge")
                        if isinstance(edge, (list, tuple)) and len(edge) >= 3:
                            edges_for_sa.append(tuple(edge))
                op_carriers = []
                for e in edges_for_sa:
                    if e in edges_all:
                        op = (edges_all[e].get("operating_airline") or "").strip().upper()
                        if op and len(op) >= 2 and op[:2] not in op_carriers:
                            op_carriers.append(op[:2])
                data["operating_carriers"] = op_carriers
                seg_desc = None
                if op_carriers:
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

    # When we used relaxed budget or best-effort path, add an info item and flag the response
    if relaxed_message:
        relaxed_info = {
            "tripId": trip_id,
            "itemId": "itinerary_relaxed_info",
            "type": "itinerary_relaxed_info",
            "message": relaxed_message,
            "original_budget": max_budget,
            "suggested_cash": solution.get("totals", {}).get("cash"),
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
        "oop_optimization": oop_optimization_summary,  # Enhanced OOP data
    }
    if oop_hotels_payload is not None:
        out["out_of_pocket_hotels"] = oop_hotels_payload
    if relaxed_message:
        out["relaxed_constraints"] = True
        out["relaxed_message"] = relaxed_message
    return out


async def generate_guaranteed_booking_plan(
    trip_id: str,
    include_hotels: bool = True,
) -> Dict[str, Any]:
    """
    Generate a guaranteed booking plan with detailed instructions.
    
    This function ALWAYS returns a bookable plan, even if the user needs to pay cash.
    It prioritizes out-of-pocket minimization when points are available.
    
    Key features:
    - Always provides at least a cash option for every segment
    - Includes step-by-step booking instructions
    - Provides transfer instructions with portal URLs
    - Shows savings compared to all-cash booking
    
    Args:
        trip_id: The trip ID to generate a booking plan for
        include_hotels: Whether to include hotels in the optimization
        
    Returns:
        Dict with:
        - status: "Optimal", "Fallback", or "Error"
        - booking_plan: Complete booking plan with instructions
        - summary: Cost summary and savings
        - flights: List of flight options with booking details
        - hotels: List of hotel options (if included)
    """
    try:
        # Import the optimized itinerary generator
        from src.handlers.optimized_itinerary_generator import (
            generate_optimized_itinerary,
            itinerary_to_dict,
        )
        from src.handlers.booking_instructions import (
            generate_complete_booking_plan,
            booking_plan_to_dict,
        )
        
        # Get trip data
        trip = trip_service.get_trip(trip_id)
        if not trip:
            raise ValueError(f"Trip {trip_id} not found")
        
        start_date = trip.get("startDate", "")
        end_date = trip.get("endDate", "")
        
        # Get destinations
        destinations = destination_service.list_destinations(trip_id)
        if not destinations:
            raise ValueError("No destinations found for trip")
        
        valid_destinations = [d for d in destinations if not d.get("excluded", False)]
        if not valid_destinations:
            raise ValueError("All destinations are excluded")
        
        # Find start and end destinations
        start_dest = next((d for d in valid_destinations if d.get("isStart", False)), None)
        end_dest = next((d for d in valid_destinations if d.get("isEnd", False)), None)
        
        if not start_dest:
            start_dest = valid_destinations[0]
        if not end_dest:
            end_dest = valid_destinations[-1] if len(valid_destinations) > 1 else start_dest
        
        # Get intermediate destinations
        intermediate = [
            d for d in valid_destinations
            if d != start_dest and d != end_dest
        ]
        
        # Convert to airport codes
        start_code = _normalize_city_to_code(start_dest.get("name", ""))
        end_code = _normalize_city_to_code(end_dest.get("name", ""))
        
        if not start_code or not end_code:
            raise ValueError("Could not find airport codes for destinations")
        
        # Build flight segments
        segments = []
        prev_code = start_code
        
        for dest in intermediate:
            dest_code = _normalize_city_to_code(dest.get("name", ""))
            if dest_code:
                segments.append({
                    "origin": prev_code,
                    "destination": dest_code,
                    "date": start_date,
                })
                prev_code = dest_code
        
        # Add final segment to end destination
        if prev_code != end_code:
            segments.append({
                "origin": prev_code,
                "destination": end_code,
                "date": start_date,
            })
        
        # Add return segment if round-trip
        if end_code != start_code:
            segments.append({
                "origin": end_code,
                "destination": start_code,
                "date": end_date,
            })
        
        # Get user points
        points_summary = points_service.trip_points_summary(trip_id)
        user_points = {}
        for item in points_summary.get("items", []):
            program = item.get("program", "")
            balance = int(item.get("balance", 0)) if item.get("balance") else 0
            if program and balance > 0:
                program_normalized = _normalize_program_to_transfer_key(program)
                user_points[program_normalized] = user_points.get(program_normalized, 0) + balance
        
        # Get hotels if needed
        hotels = []
        if include_hotels and trip.get("includeHotels", True):
            # TODO: Fetch hotel options for each destination
            pass
        
        # Get max budget
        max_budget = trip.get("maxBudget") or trip.get("max_budget")
        try:
            max_budget = float(max_budget) if max_budget is not None else None
        except (TypeError, ValueError):
            max_budget = None
        
        # Generate optimized itinerary with guaranteed routes
        optimized = await generate_optimized_itinerary(
            segments=segments,
            user_points=user_points,
            hotels=hotels,
            include_hotels=include_hotels,
            max_cash_budget=max_budget,
        )
        
        # Generate complete booking plan with instructions
        from src.handlers.min_oop_optimizer import MinOOPSolution, PaymentInstruction
        
        # Create a mock solution for the booking plan generator
        payment_plan = []
        for flight in optimized.flights:
            if flight.segments:
                seg = flight.segments[0]
                if flight.has_points_option and seg.points_cost:
                    payment_plan.append(PaymentInstruction(
                        item_id=flight.route_id,
                        item_type="flight",
                        description=f"{seg.origin} → {seg.destination}",
                        payment_type="points",
                        cash_paid=seg.points_surcharge or 0,
                        points_used=seg.points_cost,
                        program_used=seg.points_program,
                        program_name=PROGRAM_METADATA.get(seg.points_program or "", {}).get("name", seg.points_program),
                    ))
                else:
                    payment_plan.append(PaymentInstruction(
                        item_id=flight.route_id,
                        item_type="flight",
                        description=f"{seg.origin} → {seg.destination}",
                        payment_type="cash",
                        cash_paid=flight.total_cash_cost,
                    ))
        
        # Calculate days until travel
        days_until_travel = 14
        if start_date:
            try:
                travel_date = datetime.strptime(start_date.strip(), "%Y-%m-%d")
                days_until_travel = max(0, (travel_date - datetime.now()).days)
            except ValueError:
                pass
        
        # Build the solution object
        solution = MinOOPSolution(
            status=optimized.status,
            payment_plan=payment_plan,
            transfer_plan=[],  # Transfer plan is built from optimized.transfers
            total_out_of_pocket=optimized.total_out_of_pocket,
            total_points_used=optimized.total_points_used,
            all_cash_cost=optimized.all_cash_cost,
            savings=optimized.savings,
            savings_percentage=optimized.savings_percentage,
            points_breakdown=optimized.points_breakdown,
            points_remaining=optimized.points_remaining,
        )
        
        booking_plan = generate_complete_booking_plan(
            solution=solution,
            days_until_travel=days_until_travel,
            include_tips=True,
        )
        
        # Build response
        result = {
            "status": optimized.status,
            "booking_plan": booking_plan_to_dict(booking_plan),
            "summary": {
                "total_out_of_pocket": optimized.total_out_of_pocket,
                "all_cash_cost": optimized.all_cash_cost,
                "savings": optimized.savings,
                "savings_percentage": optimized.savings_percentage,
                "total_points_used": optimized.total_points_used,
            },
            "flights": itinerary_to_dict(optimized).get("flights", []),
            "booking_instructions": [
                {
                    "step": instr.step_number,
                    "type": instr.item_type,
                    "action": instr.action,
                    "description": instr.description,
                    "url": instr.booking_url or instr.portal_url,
                    "payment_type": instr.payment_type,
                    "cash_to_pay": instr.cash_to_pay,
                    "points_to_use": instr.points_to_use,
                }
                for instr in optimized.booking_instructions
            ],
            "warnings": optimized.warnings,
            "notes": optimized.notes,
        }
        
        if include_hotels:
            result["hotels"] = optimized.hotels
        
        # Save to DB
        booking_plan_item = {
            "tripId": trip_id,
            "itemId": "guaranteed_booking_plan",
            "type": "guaranteed_booking_plan",
            **result,
        }
        itinerary_repo.put_item(booking_plan_item)
        
        return result
        
    except Exception as e:
        logger.error(f"Error generating guaranteed booking plan: {e}", exc_info=True)
        
        # Return a fallback response with error details
        return {
            "status": "Error",
            "error": str(e),
            "booking_plan": None,
            "summary": {
                "total_out_of_pocket": 0,
                "all_cash_cost": 0,
                "savings": 0,
                "savings_percentage": 0,
                "total_points_used": 0,
            },
            "flights": [],
            "booking_instructions": [],
            "warnings": [f"Failed to generate booking plan: {str(e)}"],
            "notes": ["Please try again or contact support if the issue persists."],
        }
