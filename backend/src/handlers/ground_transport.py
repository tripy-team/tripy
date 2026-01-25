# Ground transport: bus and car (self-drive) options for any city pair.
# Uses SerpAPI Google Maps Directions to validate route feasibility and get actual distances.
# Enables "AI rover" style multi-modal itineraries (flight + bus + car).

import logging
from typing import Any, Dict, List, Optional

from src.utils.cache_layer import get_json, set_json

logger = logging.getLogger(__name__)


def _cache_key(origin: str, destination: str) -> str:
    return f"ground:{origin.upper()}:{destination.upper()}"


# Cache TTLs
TTL_GROUND_POSITIVE = 7 * 86400  # 7 days for valid routes
TTL_GROUND_NEGATIVE = 30 * 86400  # 30 days for impossible routes (they don't change)

# Distance limits in miles
MAX_BUS_DISTANCE_MILES = 500
MAX_CAR_DISTANCE_MILES = 800

# Meters to miles conversion
METERS_TO_MILES = 1609.34


def estimate_bus_cost(distance_miles: float) -> float:
    """
    Estimate bus cost based on distance (FlixBus/Greyhound/Megabus style pricing).
    Base: $20 + $0.08 per mile
    """
    return max(15.0, 20.0 + distance_miles * 0.08)


def estimate_car_cost(distance_miles: float) -> float:
    """
    Estimate car cost: gas + tolls + wear.
    ~$0.25 per mile (gas at $3.50/gal, 30mpg + tolls + wear)
    """
    return max(20.0, distance_miles * 0.25)


def estimate_bus_duration(distance_miles: float) -> int:
    """
    Estimate bus duration in minutes.
    Assumes average speed of 45 mph (slower than driving due to stops).
    """
    if distance_miles <= 0:
        return 0
    return int((distance_miles / 45) * 60)


def estimate_car_duration(distance_miles: float) -> int:
    """
    Estimate car/driving duration in minutes.
    Assumes average speed of 55 mph (highway driving with some traffic).
    """
    if distance_miles <= 0:
        return 0
    return int((distance_miles / 55) * 60)


def _build_transport_option(
    mode: str,
    cash_cost: float,
    time_cost: int,
    distance_miles: Optional[float] = None,
) -> Dict[str, Any]:
    """Build a transport option dict with the standard structure."""
    return {
        "mode": mode,
        "cash_cost": round(cash_cost, 2),
        "time_cost": time_cost,
        "distance_miles": round(distance_miles, 1) if distance_miles else None,
        "departure_time": None,
        "arrival_time": None,
        "operating_airline": None,
        "points_cost": None,
        "points_program": None,
        "points_surcharge": None,
        "transfer_partners": [],
    }


def get_bus_and_car_options(
    origin: str,
    destination: str,
    date: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Get bus and car (self-drive) options between two places using SerpAPI Google Maps Directions.
    
    Returns list of transport options if a ground route exists and is within distance limits.
    Returns empty list if:
    - No route exists (trans-oceanic, island to mainland, etc.)
    - Distance exceeds limits (>500mi for bus, >800mi for car)
    - API error (fails safe - no ground transport suggested)
    
    Args:
        origin: IATA code or city name (e.g., "JFK", "Boston")
        destination: IATA code or city name (e.g., "BOS", "New York")
        date: Optional date (not used currently, for future transit schedules)
    
    Returns:
        List of dicts with: mode, cash_cost, time_cost, distance_miles, etc.
    """
    o = (origin or "").strip().upper()
    d = (destination or "").strip().upper()
    if not o or not d or o == d:
        return []

    cache_key = _cache_key(o, d)
    
    # Check cache first
    cached = get_json(cache_key)
    if cached is not None:
        if isinstance(cached, list):
            logger.debug("ground [%s]->[%s]: cache hit (%d options)", o, d, len(cached))
            return cached
        # Handle legacy cache format or explicit empty cache
        if cached == [] or cached == "NO_ROUTE":
            logger.debug("ground [%s]->[%s]: cache hit (no route)", o, d)
            return []

    # Call SerpAPI Directions to verify route exists
    try:
        from src.services.serp_api_functions import get_directions
        
        route = get_directions(origin, destination, travel_mode=0)  # 0 = Driving
        
        # If no route exists (trans-oceanic, etc.), cache and return empty
        if not route or not route.get("directions"):
            logger.info("ground [%s]->[%s]: No ground route available", o, d)
            set_json(cache_key, [], TTL_GROUND_NEGATIVE)
            return []
        
        # Extract distance and duration from the first (best) route
        first_direction = route["directions"][0]
        distance_meters = first_direction.get("distance", 0)
        duration_seconds = first_direction.get("duration", 0)
        
        # Convert to miles and minutes
        distance_miles = distance_meters / METERS_TO_MILES if distance_meters else 0
        duration_minutes = int(duration_seconds / 60) if duration_seconds else 0
        
        logger.info(
            "ground [%s]->[%s]: Route found - %.1f miles, %d min",
            o, d, distance_miles, duration_minutes
        )
        
        # Build transport options based on distance limits
        out: List[Dict[str, Any]] = []
        
        # Bus option (only if within 500 miles)
        if distance_miles <= MAX_BUS_DISTANCE_MILES:
            bus_cost = estimate_bus_cost(distance_miles)
            # Bus is slower than driving (use estimated duration or 1.2x driving time)
            bus_duration = estimate_bus_duration(distance_miles)
            if duration_minutes > 0:
                bus_duration = max(bus_duration, int(duration_minutes * 1.2))
            out.append(_build_transport_option("bus", bus_cost, bus_duration, distance_miles))
        
        # Car option (only if within 800 miles)
        if distance_miles <= MAX_CAR_DISTANCE_MILES:
            car_cost = estimate_car_cost(distance_miles)
            # Use actual driving duration from API, or estimate
            car_duration = duration_minutes if duration_minutes > 0 else estimate_car_duration(distance_miles)
            out.append(_build_transport_option("car", car_cost, car_duration, distance_miles))
        
        # Cache the result
        if out:
            set_json(cache_key, out, TTL_GROUND_POSITIVE)
            logger.info("ground [%s]->[%s]: %d options available", o, d, len(out))
        else:
            # Route exists but exceeds distance limits
            logger.info("ground [%s]->[%s]: Route too long (%.1f mi) - no options", o, d, distance_miles)
            set_json(cache_key, [], TTL_GROUND_POSITIVE)
        
        return out
        
    except ImportError as e:
        logger.error("ground [%s]->[%s]: Import error: %s", o, d, e)
        return []
    except Exception as e:
        # On any error, fail safe - don't suggest ground transport
        # This prevents impossible routes from being suggested
        logger.warning("ground [%s]->[%s]: SerpAPI error: %s - returning empty", o, d, e)
        return []


def ground_options_to_edges(
    origin: str,
    destination: str,
    options: List[Dict[str, Any]]
) -> Dict[tuple, Dict[str, Any]]:
    """
    Convert get_bus_and_car_options output into the same edge format as flights:
    (origin, dest, "BUS") and (origin, dest, "CAR") with cash_cost, time_cost, points_*=None, etc.
    """
    edges = {}
    for opt in options:
        mode = (opt.get("mode") or "").upper()
        if mode not in ("BUS", "CAR"):
            continue
        key = (origin.upper(), destination.upper(), mode)
        edges[key] = {
            "cash_cost": opt.get("cash_cost"),
            "time_cost": opt.get("time_cost"),
            "distance_miles": opt.get("distance_miles"),
            "points_cost": None,
            "points_program": None,
            "points_surcharge": None,
            "transfer_partners": [],
            "departure_time": opt.get("departure_time"),
            "arrival_time": opt.get("arrival_time"),
            "operating_airline": None,
            "mode": opt.get("mode", mode).lower(),
        }
    return edges
