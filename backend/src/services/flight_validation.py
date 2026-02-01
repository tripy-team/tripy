"""
Flight Validation Service - Cross-validates flights with Google Flights via SerpAPI.

This module ensures that flights shown to users actually exist by:
1. Cross-referencing award flights with cash flights from SerpAPI
2. Validating flight numbers exist on the given date
3. Providing verification status for each flight
"""

import logging
import re
from datetime import datetime, timezone
from typing import Optional, Tuple, List, Dict, Any

logger = logging.getLogger(__name__)


def normalize_flight_number(flight_num: str) -> Tuple[str, str]:
    """
    Normalize flight number to (airline_code, number).
    
    Examples:
        "DL 2055" -> ("DL", "2055")
        "UA100" -> ("UA", "100")
        "TK 204" -> ("TK", "204")
    """
    if not flight_num:
        return ("", "")
    
    # Remove spaces and normalize
    clean = flight_num.strip().upper()
    
    # Pattern: 2 letters followed by optional space then digits
    match = re.match(r'^([A-Z]{2})\s*(\d+)$', clean)
    if match:
        return (match.group(1), match.group(2))
    
    return ("", "")


def extract_flight_numbers_from_serpapi(serp_flights: List[Dict[str, Any]]) -> Dict[str, Dict]:
    """
    Extract all flight numbers from SerpAPI results into a lookup dict.
    
    Returns:
        Dict mapping normalized flight number (e.g., "DL2055") to flight data
    """
    flight_lookup = {}
    
    for flight_data in serp_flights:
        flights = flight_data.get("flights", [])
        for leg in flights:
            fn = leg.get("flight_number", "")
            airline, number = normalize_flight_number(fn)
            if airline and number:
                key = f"{airline}{number}"
                if key not in flight_lookup:
                    flight_lookup[key] = {
                        "flight_number": fn,
                        "airline": leg.get("airline", airline),
                        "departure_airport": leg.get("departure_airport", {}),
                        "arrival_airport": leg.get("arrival_airport", {}),
                        "duration": leg.get("duration"),
                        "price": flight_data.get("price"),
                        "total_duration": flight_data.get("total_duration"),
                    }
    
    return flight_lookup


def validate_flight_exists(
    flight_number: str,
    origin: str,
    destination: str,
    date: str,
    serp_flight_lookup: Dict[str, Dict],
) -> Tuple[bool, Optional[Dict], str]:
    """
    Validate that a flight exists by checking against SerpAPI data.
    
    Args:
        flight_number: Flight number to validate (e.g., "DL 2055")
        origin: Origin airport code
        destination: Destination airport code  
        date: Flight date (YYYY-MM-DD)
        serp_flight_lookup: Pre-built lookup from extract_flight_numbers_from_serpapi
    
    Returns:
        Tuple of (is_valid, matched_data, verification_status)
        - is_valid: True if flight was found in SerpAPI
        - matched_data: The matched flight data from SerpAPI, or None
        - verification_status: "verified", "unverified", or "partial_match"
    """
    airline, number = normalize_flight_number(flight_number)
    if not airline or not number:
        return (False, None, "unverified")
    
    key = f"{airline}{number}"
    
    if key in serp_flight_lookup:
        matched = serp_flight_lookup[key]
        
        # Verify origin/destination match
        dep_airport = matched.get("departure_airport", {}).get("id", "")
        arr_airport = matched.get("arrival_airport", {}).get("id", "")
        
        if dep_airport.upper() == origin.upper():
            return (True, matched, "verified")
        else:
            # Flight number exists but on different route - could be connecting
            return (True, matched, "partial_match")
    
    return (False, None, "unverified")


async def cross_validate_flights_with_serpapi(
    flights_to_validate: List[Dict[str, Any]],
    origin: str,
    destination: str,
    date: str,
    force_refresh: bool = False,
) -> List[Dict[str, Any]]:
    """
    Cross-validate a list of flights against fresh SerpAPI data.
    
    This function:
    1. Fetches fresh Google Flights data via SerpAPI
    2. Validates each flight exists
    3. Adds verification metadata to each flight
    
    Args:
        flights_to_validate: List of flight dicts with flight_number
        origin: Origin airport
        destination: Destination airport
        date: Flight date
        force_refresh: If True, bypass cache for fresh data
    
    Returns:
        Same list with added verification fields:
        - is_verified: bool
        - verification_status: str
        - verified_at: ISO timestamp
        - serpapi_match: dict or None
    """
    from src.services.serp_api_functions import get_google_flights
    
    logger.info(f"[FlightValidation] Cross-validating {len(flights_to_validate)} flights for {origin}->{destination} on {date}")
    
    # Fetch fresh SerpAPI data
    try:
        serp_flights = get_google_flights(
            origin=origin,
            destination=destination,
            outbound_date=date,
            return_date=None,
            travel_class=1,  # Economy
        )
        
        if not serp_flights:
            logger.warning(f"[FlightValidation] No SerpAPI flights found for {origin}->{destination} on {date}")
            # Mark all as unverified
            for flight in flights_to_validate:
                flight["is_verified"] = False
                flight["verification_status"] = "no_serpapi_data"
                flight["verified_at"] = datetime.now(timezone.utc).isoformat()
            return flights_to_validate
        
        logger.info(f"[FlightValidation] Got {len(serp_flights)} SerpAPI flights for cross-validation")
        
        # Build lookup
        serp_lookup = extract_flight_numbers_from_serpapi(serp_flights)
        logger.info(f"[FlightValidation] Built lookup with {len(serp_lookup)} unique flight numbers: {list(serp_lookup.keys())[:10]}...")
        
        # Validate each flight
        verified_count = 0
        for flight in flights_to_validate:
            flight_nums = flight.get("flight_numbers", [])
            if not flight_nums:
                fn = flight.get("flight_number", "")
                flight_nums = [fn] if fn else []
            
            # Check if ANY flight number in the itinerary is verified
            any_verified = False
            matched_data = None
            verification_status = "unverified"
            
            for fn in flight_nums:
                is_valid, match, status = validate_flight_exists(
                    fn, origin, destination, date, serp_lookup
                )
                if is_valid:
                    any_verified = True
                    matched_data = match
                    verification_status = status
                    break
            
            flight["is_verified"] = any_verified
            flight["verification_status"] = verification_status
            flight["verified_at"] = datetime.now(timezone.utc).isoformat()
            flight["serpapi_match"] = matched_data
            
            if any_verified:
                verified_count += 1
                logger.debug(f"[FlightValidation] Verified: {flight_nums} - status={verification_status}")
            else:
                logger.warning(f"[FlightValidation] UNVERIFIED: {flight_nums} not found in SerpAPI data")
        
        logger.info(f"[FlightValidation] Validation complete: {verified_count}/{len(flights_to_validate)} flights verified")
        
    except Exception as e:
        logger.error(f"[FlightValidation] Cross-validation failed: {e}", exc_info=True)
        # Mark all as unverified due to error
        for flight in flights_to_validate:
            flight["is_verified"] = False
            flight["verification_status"] = "validation_error"
            flight["verified_at"] = datetime.now(timezone.utc).isoformat()
    
    return flights_to_validate


def filter_verified_flights_only(flights: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter to only return flights that have been verified against SerpAPI.
    
    Use this when you want to ensure users only see flights that definitely exist.
    """
    return [f for f in flights if f.get("is_verified", False)]


def get_verification_summary(flights: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Get a summary of flight verification status.
    """
    total = len(flights)
    verified = sum(1 for f in flights if f.get("is_verified", False))
    unverified = total - verified
    
    statuses = {}
    for f in flights:
        status = f.get("verification_status", "unknown")
        statuses[status] = statuses.get(status, 0) + 1
    
    return {
        "total": total,
        "verified": verified,
        "unverified": unverified,
        "verification_rate": (verified / total * 100) if total > 0 else 0,
        "status_breakdown": statuses,
    }
