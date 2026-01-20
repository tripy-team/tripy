import uuid
import logging
import re
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from src.repos import itinerary_repo
from src.handlers.flights import get_flights_award_first_with_points
from src.handlers.ilp_adapter import run_ilp_from_edges
from src.handlers.planTrip import plan_non_pooled_multi_itineraries_with_native
from src.services import destination_service, trip_service, points_service, trip_member_service, city_service

logger = logging.getLogger(__name__)


def save_itinerary(trip_id: str, route: List[str]) -> Dict[str, Any]:
    # MVP: store one item that contains the chosen route as JSON
    item_id = "route"
    item = {"tripId": trip_id, "itemId": item_id, "type": "route", "route": route}
    itinerary_repo.put_item(item)
    return item


def get_itinerary(trip_id: str) -> List[Dict[str, Any]]:
    return itinerary_repo.list_items(trip_id)


def _is_airport_code(name: str) -> bool:
    """Check if a string looks like an airport code (3 uppercase letters)"""
    return bool(re.match(r'^[A-Z]{3}$', name.strip().upper()))


def _normalize_city_to_code(city_name: str) -> Optional[str]:
    """
    Convert city name to airport code.
    If already a code, return it. Otherwise, try to find the primary airport.
    """
    city_name = city_name.strip()
    
    # If it's already an airport code, return it
    if _is_airport_code(city_name):
        return city_name.upper()
    
    # Try to find airport code using city search
    try:
        results = city_service.search_cities(city_name, max_results=5)
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
    
    # If search fails, try to extract code from name (e.g., "New York (JFK)")
    match = re.search(r'\(([A-Z]{3})\)', city_name.upper())
    if match:
        return match.group(1)
    
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
        raise ValueError(
            f"Could not find airport code for start destination '{start_dest_name}'. "
            f"Please use airport codes (e.g., 'JFK', 'CDG') or city names with codes (e.g., 'New York (JFK)')."
        )
    
    end_dest_code = _normalize_city_to_code(end_dest_name) if end_dest_name else start_dest_code
    if not end_dest_code:
        raise ValueError(
            f"Could not find airport code for end destination '{end_dest_name}'. "
            f"Please use airport codes (e.g., 'JFK', 'CDG') or city names with codes (e.g., 'New York (JFK)')."
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
    all_cities = [start_dest_code] + city_codes + ([end_dest_code] if end_dest_code != start_dest_code else [])
    all_cities = list(dict.fromkeys(all_cities))  # Remove duplicates while preserving order
    
    if len(all_cities) < 2:
        raise ValueError(
            f"Need at least 2 distinct destinations for optimization. "
            f"Found: {all_cities}. Please add more destinations or use different start/end locations."
        )
    
    logger.info(f"Optimizing route: {' -> '.join(all_cities)}")
    
    edges_all = {}
    
    # Default transfer graph (can be made configurable)
    transfer_graph = {
        "amex": {"AF": 1.0, "KL": 1.0, "DL": 1.0, "BA": 1.0, "VS": 1.0, "AC": 1.0, "TK": 1.0, "UA": 1.0},
        "chase": {"AF": 1.0, "KL": 1.0, "BA": 1.0, "VS": 1.0, "UA": 1.0, "AC": 1.0},
        "citi": {"AF": 1.0, "KL": 1.0, "VS": 1.0, "TK": 1.0, "BA": 1.0},
        "capitalone": {"AF": 1.0, "KL": 1.0, "BA": 1.0, "VS": 1.0, "TK": 1.0, "AC": 1.0},
        "bilt": {"AF": 1.0, "KL": 1.0, "BA": 1.0, "AA": 1.0, "UA": 1.0, "AC": 1.0, "TK": 1.0, "VS": 1.0},
    }
    
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
        
        filters = {
            "outbound_date": start_date.strip(),
            "travel_class": "economy",
            "stops": 1,
            "bags": 1,
            "pax": len(travelers),  # Use actual number of travelers
            "award_programs": ["AF", "KL", "DL", "BA", "AA", "AS", "UA", "VS", "AC", "TK"],
        }
        
        try:
            edges = get_flights_award_first_with_points(
                origin, dest, combined_points, filters
            )
            if edges:
                edges_all.update(edges)
                successful_routes += 1
                logger.info(f"Fetched {len(edges)} flight edges from {origin} to {dest}")
            else:
                failed_routes.append(f"{origin} -> {dest}")
                logger.warning(f"No flight edges found from {origin} to {dest}")
        except Exception as e:
            failed_routes.append(f"{origin} -> {dest}")
            logger.warning(f"Error fetching flights from {origin} to {dest}: {e}", exc_info=True)
            continue
    
    if not edges_all:
        error_msg = (
            f"No flight edges found for any route. "
            f"Failed routes: {', '.join(failed_routes) if failed_routes else 'all routes'}. "
            f"Please check: (1) Airport codes are valid (e.g., JFK, CDG), "
            f"(2) Dates are in the future, (3) Routes exist between destinations."
        )
        raise ValueError(error_msg)
    
    if successful_routes == 0:
        raise ValueError(
            f"Failed to fetch flights for all routes. "
            f"Failed: {', '.join(failed_routes)}. "
            f"Please verify airport codes and dates are correct."
        )
    
    if failed_routes:
        logger.warning(f"Some routes failed to fetch flights: {', '.join(failed_routes)}. Continuing with available routes.")
    
    logger.info(f"Running ILP optimization with {len(edges_all)} edges for {len(travelers)} travelers")
    
    # 7. Run ILP optimization using points maximization
    # The function plan_non_pooled_multi_itineraries_with_native (from planTrip.py) 
    # already includes points maximization logic (maximizes cash saved by using points)
    # This is the same function used in main.py demo file
    # It uses default weights: W1=10^6 (points value), W2=10^3 (cash), W3=1.0 (time)
    # Objective: Maximize (points_value - cash_paid - time_penalty)
    try:
        solution = run_ilp_from_edges(
            edges_all,
            travelers,
            start_city_by_trav,
            end_city_by_trav,
            user_points_by_trav,
            plan_non_pooled_multi_itineraries_with_native,  # Uses points maximization (same as main.py)
            meetup_cities=[],  # No meetup cities for now
            require_meetup_in_graph=False,
            transfer_graph=transfer_graph,
            transfer_bonuses={},
            bank_block_size=1000,
            allow_all_payers=True,
            default_cash_if_missing=1e7,
            default_time_if_missing=1e6,
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
    
    # Save payment modes
    for traveler_id, payments in solution.get("pay_mode", {}).items():
        if payments:
            item = {
                "tripId": trip_id,
                "itemId": f"payments_{traveler_id}",
                "type": "payments",
                "travelerId": traveler_id,
                "payments": payments,
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
    
    return {
        "status": solution.get("status", "Unknown"),
        "solution": solution,
        "items": itinerary_items,
    }
