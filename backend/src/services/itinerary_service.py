import os
import uuid
import logging
import re
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from src.repos import itinerary_repo
from src.handlers.flights import get_flights_award_first_with_points
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
from src.data.award_programs import DEFAULT_TRANSFER_GRAPH, get_award_programs_for_api
from src.repos import user_repo
from src.utils.card_benefits import build_benefit_airlines_for_travelers

logger = logging.getLogger(__name__)

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
    Falls back to a sensible default if dates are missing or invalid.
    """
    start_date = (trip or {}).get("startDate") or ""
    end_date = (trip or {}).get("endDate") or ""

    try:
        if start_date and end_date:
            start_dt = datetime.strptime(start_date.strip(), "%Y-%m-%d")
            end_dt = datetime.strptime(end_date.strip(), "%Y-%m-%d")
            days = (end_dt.date() - start_dt.date()).days or 1
            return max(days, 1)
    except Exception:
        # If parsing fails, ignore and use default below
        pass

    # Default duration if we can't infer it from dates
    return 7


def save_itinerary(trip_id: str, route: List[str]) -> Dict[str, Any]:
    # MVP: store one item that contains the chosen route as JSON
    item_id = "route"
    item = {"tripId": trip_id, "itemId": item_id, "type": "route", "route": route}
    itinerary_repo.put_item(item)
    return item


def get_itinerary(trip_id: str) -> List[Dict[str, Any]]:
    return itinerary_repo.list_items(trip_id)


def generate_simple_itineraries(trip_id: str) -> List[Dict[str, Any]]:
    """
    Lightweight, dependency‑free itinerary generator.

    This is purposely simple and avoids external flight vendors (Amadeus, etc.).
    It:
      - Reads the trip and its destinations
      - Builds a few reasonable city routes
      - Computes rough cost / points / score heuristics
      - Saves itineraries to DynamoDB via itinerary_repo

    The frontend then treats these as "routes" for display and comparison.
    """
    # Load trip + destinations
    trip = trip_service.get_trip(trip_id)
    if not trip:
        raise ValueError(f"Trip {trip_id} not found")

    destinations = destination_service.list_destinations(trip_id)
    if not destinations:
        raise ValueError("No destinations found for trip. Please add at least one destination.")

    # Filter out excluded destinations while preserving original order
    valid_dests: List[Dict[str, Any]] = [d for d in destinations if not d.get("excluded", False)]
    if not valid_dests:
        raise ValueError("All destinations are excluded. Please add at least one active destination.")

    # Determine start / end (mustInclude = True treated as anchors)
    must_include = [d for d in valid_dests if d.get("mustInclude", False)]
    if must_include:
        start_dest = must_include[0]
        end_dest = must_include[-1]
    else:
        start_dest = valid_dests[0]
        end_dest = valid_dests[-1] if len(valid_dests) > 1 else valid_dests[0]

    def _city_name(d: Dict[str, Any]) -> str:
        # Use stored name; if missing, fall back to ID
        return (d.get("name") or d.get("destinationId") or "").strip()

    # Build a base ordered list of cities (by display name) and IDs
    # Keep any intermediate cities in original order between the anchors.
    start_id = start_dest.get("destinationId")
    end_id = end_dest.get("destinationId")

    # Preserve input order; simply map to display objects
    ordered_dests = valid_dests

    ordered_city_names = [_city_name(d) for d in ordered_dests]
    ordered_city_ids = [d.get("destinationId") for d in ordered_dests]

    # If we only have one city, create a trivial "out and back" representation.
    if len(ordered_city_names) == 1:
        ordered_city_names = [ordered_city_names[0]]
        ordered_city_ids = [ordered_city_ids[0]]

    # Compute a coarse duration and derive per‑city "stay" in days
    total_days = _parse_trip_duration_days(trip)
    num_stops = max(len(ordered_city_names), 1)
    # At least 2 days per stop; spread remaining days roughly evenly
    base_days = max(total_days // num_stops, 2)

    def _build_city_objects(names: List[str]) -> List[Dict[str, Any]]:
        return [{"name": n, "days": base_days} for n in names if n]

    # Construct a couple of simple route variants for user choice
    routes: List[Dict[str, Any]] = []

    # Route 1: forward order (start → ... → end)
    routes.append(
        {
            "label": "Balanced route",
            "route_ids": ordered_city_ids,
            "cities": _build_city_objects(ordered_city_names),
            "weight_factor": 1.0,
        }
    )

    # Route 2: reverse order if it meaningfully differs
    if len(ordered_city_names) > 1:
        rev_names = list(reversed(ordered_city_names))
        rev_ids = list(reversed(ordered_city_ids))
        if rev_ids != ordered_city_ids:
            routes.append(
                {
                    "label": "Reverse route",
                    "route_ids": rev_ids,
                    "cities": _build_city_objects(rev_names),
                    "weight_factor": 0.95,  # slightly different score
                }
            )

    # Basic cost / points heuristics consistent with frontend expectations
    base_cost_per_day = 200
    base_cost_per_city = 300

    items: List[Dict[str, Any]] = []
    existing_items = itinerary_repo.list_items(trip_id) or []
    existing_ids = {i.get("itemId") for i in existing_items}

    def _next_item_id(idx: int) -> str:
        candidate = f"itinerary_{idx}"
        # Avoid collisions with any existing saved itineraries
        n = idx
        while candidate in existing_ids:
            n += 1
            candidate = f"itinerary_{n}"
        existing_ids.add(candidate)
        return candidate

    for idx, r in enumerate(routes, start=1):
        city_objs = r["cities"]
        total_stay_days = sum(c["days"] for c in city_objs) or total_days

        total_cost = int(total_stay_days * base_cost_per_day + len(city_objs) * base_cost_per_city)
        points_cost = int(total_cost * 25)  # rough valuation used elsewhere in the app

        # Simple score heuristic: favor more cities up to a point, and penalize very long trips
        score = 88
        if len(city_objs) >= 4:
            score += 4
        elif len(city_objs) >= 2:
            score += 2
        score = int(score * r.get("weight_factor", 1.0))
        score = max(75, min(score, 99))

        item = {
            "tripId": trip_id,
            "itemId": _next_item_id(idx),
            "type": "itinerary",
            "name": r["label"],
            # Keep both raw IDs and rich city objects so frontend can map either way
            "route": r["route_ids"],
            "cities": city_objs,
            "totalCost": total_cost,
            "pointsCost": points_cost,
            "score": score,
        }
        itinerary_repo.put_item(item)
        items.append(item)

    logger.info(
        f"Generated {len(items)} simple itineraries for trip {trip_id} "
        f"with destinations {[c['name'] for c in _build_city_objects(ordered_city_names)]}"
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


def generate_optimized_itinerary(trip_id: str) -> Dict[str, Any]:
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
    
    # Find start and end destinations (must_include=True destinations)
    start_dest_name = None
    end_dest_name = None
    cities = []
    
    for dest in valid_destinations:
        name = dest.get("name", "").strip()
        if not name:
            continue
        
        if dest.get("mustInclude", False):
            # First must_include is start, last is end
            if start_dest_name is None:
                start_dest_name = name
            end_dest_name = name
        else:
            cities.append(name)
    
    # If no must_include destinations, use first and last
    if start_dest_name is None and valid_destinations:
        start_dest_name = valid_destinations[0].get("name", "").strip()
        if len(valid_destinations) > 1:
            end_dest_name = valid_destinations[-1].get("name", "").strip()
        else:
            end_dest_name = start_dest_name
    
    if not start_dest_name:
        raise ValueError("No valid start destination found")
    
    # Convert city names to airport codes
    logger.info(f"Converting city names to airport codes: start={start_dest_name}, end={end_dest_name}, cities={cities}")
    
    start_dest_code = _normalize_city_to_code(start_dest_name)
    if not start_dest_code:
        logger.info(f"No airport code for start '{start_dest_name}'; using OpenAI to suggest routes for small/remote city")
        return _save_and_return_ai_route_suggestions(
            trip_id, start_dest_name, end_dest_name or start_dest_name, cities, start_date, end_date, failed_routes=None
        )

    end_dest_code = _normalize_city_to_code(end_dest_name) if end_dest_name else start_dest_code
    if not end_dest_code:
        logger.info(f"No airport code for end '{end_dest_name}'; using OpenAI to suggest routes for small/remote city")
        return _save_and_return_ai_route_suggestions(
            trip_id, start_dest_name, end_dest_name or start_dest_name, cities, start_date, end_date, failed_routes=None
        )
    
    # Convert intermediate cities
    city_codes = []
    for city_name in cities:
        city_code = _normalize_city_to_code(city_name)
        if city_code:
            city_codes.append(city_code)
        else:
            logger.warning(f"Could not find airport code for '{city_name}', skipping")
    
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
            # Normalize program name to lowercase for transfer graph matching
            program_lower = program.lower().strip()
            user_points_by_trav[user_id][program_lower] = balance
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
    
    logger.info(f"Optimizing route: {' -> '.join(all_cities)}")
    
    edges_all = {}
    
    # Transfer graph: which bank points can transfer to which airlines (all commercial airlines)
    transfer_graph = DEFAULT_TRANSFER_GRAPH
    
    # Fetch edges for all city pairs
    successful_routes = 0
    failed_routes = []
    
    for i in range(len(all_cities) - 1):
        origin = all_cities[i]
        dest = all_cities[i + 1]
        
        # Skip if origin and dest are the same
        if origin == dest:
            logger.info(f"Skipping self-loop: {origin} -> {dest}")
            continue
        
        # Use combined points from all travelers for fetching
        combined_points = {}
        for user_id, points in user_points_by_trav.items():
            for prog, bal in points.items():
                combined_points[prog] = combined_points.get(prog, 0) + bal
        
        # If no points, use empty dict (will fetch cash options)
        if not combined_points:
            combined_points = {}
        
        # Use end_date for return legs (back to origin) so we search the correct date
        leg_date = end_date.strip() if (dest == start_dest_code and end_date) else start_date.strip()
        filters = {
            "outbound_date": leg_date,
            "travel_class": "economy",
            "bags": 1,
            "pax": len(travelers),
            "award_programs": get_award_programs_for_api(),
        }

        serp_ok = "set" if (os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY")) else "missing"
        award_ok = "set" if (os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")) else "missing"
        logger.info("fetch_flights [%s]->[%s] date=%s pax=%s SERPAPI_KEY=%s AWARD_TOOL_API_KEY=%s", origin, dest, leg_date, len(travelers), serp_ok, award_ok)

        try:
            edges = get_flights_award_first_with_points(
                origin, dest, combined_points, filters
            )
            
            # If no edges found, try SERP-first strategy as fallback
            if not edges:
                logger.info(f"No edges from award-first strategy, trying SERP-first for {origin} -> {dest}")
                from src.handlers.flights import get_flights_serp_first_with_points
                edges = get_flights_serp_first_with_points(
                    origin, dest, combined_points, filters
                )
            # If still no edges, try sync serp_client.get_flights_between_airports (get_flights_serp_only)
            if not edges:
                logger.info(f"No edges from SERP-first, trying get_flights_serp_only (serp_client) for {origin} -> {dest}")
                from src.handlers.flights import get_flights_serp_only
                edges = get_flights_serp_only(origin, dest, leg_date, filters)
            
            # Note: We already allow multistop flights by default (no stops restriction in filters)
            # If still no edges found, the route may not exist or dates may be invalid
            
            if edges:
                edges_all.update(edges)
                successful_routes += 1
                logger.info("Fetched %d flight edges from %s to %s", len(edges), origin, dest)

            # Add bus and car options for this segment (AI-rover style multi-modal)
            try:
                from src.handlers.ground_transport import get_bus_and_car_options, ground_options_to_edges
                ground_opts = get_bus_and_car_options(origin, dest, date=leg_date)
                ground_edges = ground_options_to_edges(origin, dest, ground_opts)
                if ground_edges:
                    edges_all.update(ground_edges)
                    logger.info("Added %d ground edges (bus/car) from %s to %s", len(ground_edges), origin, dest)
            except Exception as g:
                logger.debug("Ground transport for [%s]->[%s]: %s", origin, dest, g)

            if not edges:
                # Try nearby major hub when origin is a small/regional airport (e.g. ITH, BGM)
                hub_used = False
                if origin in SMALL_AIRPORT_NEARBY_HUBS:
                    from src.handlers.flights import get_flights_serp_first_with_points, get_flights_serp_only
                    from src.handlers.ground_transport import get_bus_and_car_options, ground_options_to_edges
                    for hub in SMALL_AIRPORT_NEARBY_HUBS[origin]:
                        try:
                            hub_edges = get_flights_award_first_with_points(
                                hub, dest, combined_points, filters
                            )
                            if not hub_edges:
                                hub_edges = get_flights_serp_first_with_points(
                                    hub, dest, combined_points, filters
                                )
                            if not hub_edges:
                                hub_edges = get_flights_serp_only(hub, dest, leg_date, filters)
                            if hub_edges:
                                ground_opts = get_bus_and_car_options(origin, hub, date=leg_date)
                                ground_edges = ground_options_to_edges(origin, hub, ground_opts)
                                if ground_edges:
                                    edges_all.update(hub_edges)
                                    edges_all.update(ground_edges)
                                    successful_routes += 1
                                    logger.info(
                                        "Used nearby hub %s for %s->%s: %d flight + %d ground edges (drive/ride to hub first)",
                                        hub, origin, dest, len(hub_edges), len(ground_edges),
                                    )
                                    hub_used = True
                                    break
                        except Exception as h:
                            logger.debug("Hub %s fallback for %s->%s: %s", hub, origin, dest, h)
                if not hub_used:
                    failed_routes.append(f"{origin} -> {dest}")
                    logger.warning(
                        "No flight edges from %s to %s date=%s after award-first, SERP-first, get_flights_serp_only, and nearby-hub (if applicable). "
                        "Check SERPAPI_KEY, AWARD_TOOL_API_KEY, dates, and flights.SERP/AwardTool logs.",
                        origin, dest, leg_date,
                    )
        except Exception as e:
            failed_routes.append(f"{origin} -> {dest}")
            logger.warning(
                "Error fetching flights from %s to %s date=%s: %s. "
                "Check flights.SERP and flights.AwardTool logs.",
                origin, dest, leg_date, e, exc_info=True,
            )
            # Try SERP-first as fallback even on exception
            edges = {}
            try:
                logger.info(f"Trying SERP-first fallback after exception for {origin} -> {dest}")
                from src.handlers.flights import get_flights_serp_first_with_points
                edges = get_flights_serp_first_with_points(
                    origin, dest, combined_points, filters
                )
                if edges:
                    edges_all.update(edges)
                    successful_routes += 1
                    logger.info(f"Fallback SERP-first succeeded: {len(edges)} edges from {origin} to {dest}")
            except Exception as fallback_error:
                logger.warning(f"Fallback SERP-first also failed for {origin} -> {dest}: {fallback_error}")
            if not edges:
                try:
                    from src.handlers.flights import get_flights_serp_only
                    edges = get_flights_serp_only(origin, dest, leg_date, filters)
                    if edges:
                        edges_all.update(edges)
                        successful_routes += 1
                        logger.info(f"Fallback get_flights_serp_only succeeded: {len(edges)} edges from {origin} to {dest}")
                except Exception as serp_only_err:
                    logger.debug(f"get_flights_serp_only for {origin}->{dest}: {serp_only_err}")
            # If still no edges, try nearby hub for small/regional origin
            if not edges and origin in SMALL_AIRPORT_NEARBY_HUBS:
                from src.handlers.flights import get_flights_serp_first_with_points, get_flights_serp_only
                from src.handlers.ground_transport import get_bus_and_car_options, ground_options_to_edges
                for hub in SMALL_AIRPORT_NEARBY_HUBS[origin]:
                    try:
                        hub_edges = get_flights_award_first_with_points(hub, dest, combined_points, filters)
                        if not hub_edges:
                            hub_edges = get_flights_serp_first_with_points(hub, dest, combined_points, filters)
                        if not hub_edges:
                            hub_edges = get_flights_serp_only(hub, dest, leg_date, filters)
                        if hub_edges:
                            ground_opts = get_bus_and_car_options(origin, hub, date=leg_date)
                            ground_edges = ground_options_to_edges(origin, hub, ground_opts)
                            if ground_edges:
                                edges_all.update(hub_edges)
                                edges_all.update(ground_edges)
                                successful_routes += 1
                                failed_routes.pop()  # remove the append we did above
                                logger.info(
                                    "Exception path: used nearby hub %s for %s->%s: %d flight + %d ground edges",
                                    hub, origin, dest, len(hub_edges), len(ground_edges),
                                )
                                break
                    except Exception as h:
                        logger.debug("Hub %s fallback for %s->%s: %s", hub, origin, dest, h)
            # Still add bus/car so the segment is not missing when flights fail
            try:
                from src.handlers.ground_transport import get_bus_and_car_options, ground_options_to_edges
                ground_opts = get_bus_and_car_options(origin, dest, date=leg_date)
                ground_edges = ground_options_to_edges(origin, dest, ground_opts)
                if ground_edges:
                    edges_all.update(ground_edges)
            except Exception:
                pass
            continue
    
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
    
    # 7. Run ILP optimization using points maximization
    # plan_maximize_points_value (points_maximizer.py): maximizes cash saved by using points.
    # Objective: W1*points_value - W2*cash_paid - W3*time (W1=10^6, W2=10^3, W3=1; min 1 cpp).
    # When benefit_airlines is set, also adds W_benefit * bag_fee per passenger when payer's card gives free bags on that flight.
    try:
        solution = run_ilp_from_edges(
            edges_all,
            travelers,
            start_city_by_trav,
            end_city_by_trav,
            user_points_by_trav,
            plan_maximize_points_value,  # Point optimization: max points value, min cash, min time
            meetup_cities=[],  # No meetup cities for now
            require_meetup_in_graph=False,
            transfer_graph=transfer_graph,
            transfer_bonuses={},
            bank_block_size=1000,
            allow_all_payers=True,
            default_cash_if_missing=1e7,
            default_time_if_missing=1e6,
            benefit_airlines=benefit_airlines,
        )
        
        status = solution.get("status", "Unknown")
        if status != "Optimal":
            if status == "Infeasible":
                raise ValueError(
                    "Optimization found no feasible solution. This may be due to: "
                    "(1) Insufficient points for available routes, "
                    "(2) No valid routes between destinations, "
                    "(3) Budget constraints too tight. "
                    "Please check your destinations, dates, and points balances."
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
    
    # Save paths for each traveler
    for traveler_id, path in solution.get("path", {}).items():
        if path:
            item = {
                "tripId": trip_id,
                "itemId": f"path_{traveler_id}",
                "type": "path",
                "travelerId": traveler_id,
                "path": path,
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
    
    # Save totals
    totals = solution.get("totals", {})
    totals_item = {
        "tripId": trip_id,
        "itemId": "totals",
        "type": "totals",
        "totals": totals,
    }
    itinerary_items.append(totals_item)
    
    # Save all items
    for item in itinerary_items:
        itinerary_repo.put_item(item)

    # AI smart tips: transfer strategy, sample money-saving itineraries, holiday advice, practical (closing hours, transfer timing)
    from src.handlers.openAI import get_itinerary_smart_tips
    points_programs = list({p for u in user_points_by_trav.values() for p in u})
    tips = get_itinerary_smart_tips(
        origin=start_dest_name or start_dest_code,
        destination=end_dest_name or end_dest_code,
        city_names=cities if cities else None,
        start_date=start_date or None,
        end_date=end_date or None,
        points_programs=points_programs if points_programs else None,
    )
    tips_item = {
        "tripId": trip_id,
        "itemId": "itinerary_smart_tips",
        "type": "itinerary_smart_tips",
        "transfer_tips": tips.get("transfer_tips", []),
        "sample_itineraries": tips.get("sample_itineraries", []),
        "holiday_advice": tips.get("holiday_advice", []),
        "practical_tips": tips.get("practical_tips", []),
    }
    itinerary_repo.put_item(tips_item)
    itinerary_items.append(tips_item)
    
    return {
        "status": solution.get("status", "Unknown"),
        "solution": solution,
        "items": itinerary_items,
    }
