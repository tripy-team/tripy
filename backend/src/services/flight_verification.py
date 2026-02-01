"""
Flight Verification Service - Cross-references flights with Google Flights via SerpAPI.

This service verifies that flights returned from AwardTool or cached data actually
exist on Google Flights by making a fresh SerpAPI query and comparing results.
"""

import logging
from datetime import datetime, timezone
from typing import Optional, Dict, List, Tuple
import re

logger = logging.getLogger(__name__)


def normalize_flight_number(fn: str) -> str:
    """Normalize flight number for comparison (e.g., 'DL 2055' -> 'DL2055')."""
    if not fn:
        return ""
    return re.sub(r'\s+', '', fn.upper())


def parse_time(time_str: str) -> Optional[Tuple[int, int]]:
    """Parse time string to (hour, minute) tuple. Handles various formats."""
    if not time_str:
        return None
    try:
        # Handle ISO format like "2026-02-11T08:30:00"
        if 'T' in time_str:
            time_part = time_str.split('T')[1].split('+')[0].split('Z')[0]
            # Handle potential timezone offset like "-08:00"
            if '-' in time_part and time_part.count(':') > 1:
                time_part = time_part.rsplit('-', 1)[0]
            parts = time_part.split(':')
            return (int(parts[0]), int(parts[1]))
        
        # Handle "YYYY-MM-DD HH:MM" format (Google Flights format)
        if ' ' in time_str and '-' in time_str:
            # Split by space to get date and time parts
            parts = time_str.split(' ')
            if len(parts) >= 2:
                time_part = parts[-1]  # Get the last part (time)
                if ':' in time_part:
                    time_parts = time_part.split(':')
                    return (int(time_parts[0]), int(time_parts[1]))
        
        # Handle simple time like "8:30 AM" or "08:30"
        time_str = time_str.replace(' AM', '').replace(' PM', '').replace('AM', '').replace('PM', '')
        if ':' in time_str:
            parts = time_str.split(':')
            return (int(parts[0]), int(parts[1]))
    except Exception as e:
        logger.debug(f"[parse_time] Error parsing '{time_str}': {e}")
    return None


def times_match(time1: str, time2: str, tolerance_minutes: int = 30) -> bool:
    """Check if two times are within tolerance of each other."""
    t1 = parse_time(time1)
    t2 = parse_time(time2)
    
    # If we can't parse times, assume they match (don't reject valid flights)
    if not t1 or not t2:
        logger.debug(f"[times_match] Could not parse times: '{time1}' -> {t1}, '{time2}' -> {t2}")
        return True
    
    # Convert to minutes since midnight
    min1 = t1[0] * 60 + t1[1]
    min2 = t2[0] * 60 + t2[1]
    
    diff = abs(min1 - min2)
    matches = diff <= tolerance_minutes
    logger.debug(f"[times_match] {time1} ({min1}min) vs {time2} ({min2}min) -> diff={diff}min, matches={matches}")
    
    return matches


async def verify_flight_exists(
    origin: str,
    destination: str,
    date: str,
    flight_numbers: List[str],
    departure_time: Optional[str] = None,
    airline: Optional[str] = None,
) -> Dict:
    """
    Verify a flight exists on Google Flights.
    
    Returns:
        {
            "verified": bool,
            "status": "verified" | "not_found" | "time_mismatch" | "error",
            "message": str,
            "google_flights": [...] if verified,
            "fetched_at": ISO timestamp,
        }
    """
    from .serp_api_functions import get_google_flights
    import asyncio
    
    result = {
        "verified": False,
        "status": "error",
        "message": "",
        "google_flights": [],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    
    if not flight_numbers:
        result["status"] = "not_found"
        result["message"] = "No flight numbers provided"
        return result
    
    try:
        # Fetch fresh data from Google Flights
        loop = asyncio.get_event_loop()
        fresh_flights = await loop.run_in_executor(
            None,
            lambda: get_google_flights(
                origin=origin,
                destination=destination,
                outbound_date=date,
                travel_class=1,  # Economy
            )
        )
        
        if not fresh_flights:
            result["status"] = "not_found"
            result["message"] = f"No flights found on Google Flights for {origin}->{destination} on {date}"
            return result
        
        # Normalize the flight numbers we're looking for
        target_flight_nums = [normalize_flight_number(fn) for fn in flight_numbers]
        first_target = target_flight_nums[0] if target_flight_nums else ""
        
        logger.info(f"[Verify] Looking for flights: {target_flight_nums} on {origin}->{destination}")
        logger.info(f"[Verify] Google Flights returned {len(fresh_flights)} options")
        
        # Search through Google Flights results
        for gf in fresh_flights:
            gf_legs = gf.get("flights", [])
            gf_flight_nums = []
            for leg in gf_legs:
                fn = leg.get("flight_number", "")
                if fn:
                    gf_flight_nums.append(normalize_flight_number(fn))
            
            # Check if flight numbers match
            if first_target and first_target in gf_flight_nums:
                # Found a match!
                gf_departure = ""
                if gf_legs:
                    dep_airport = gf_legs[0].get("departure_airport", {})
                    gf_departure = dep_airport.get("time", "")
                
                # Verify departure time if provided
                if departure_time and gf_departure:
                    if times_match(departure_time, gf_departure, tolerance_minutes=30):
                        result["verified"] = True
                        result["status"] = "verified"
                        result["message"] = f"Flight {first_target} verified on Google Flights"
                        result["google_flights"] = [gf]
                        logger.info(f"[Verify] VERIFIED: {first_target} departing ~{gf_departure}")
                        return result
                    else:
                        # Flight exists but time doesn't match
                        result["status"] = "time_mismatch"
                        result["message"] = f"Flight {first_target} found but departure time differs (expected {departure_time}, found {gf_departure})"
                        result["google_flights"] = [gf]
                        logger.warning(f"[Verify] TIME MISMATCH: {first_target} expected {departure_time}, got {gf_departure}")
                        # Don't return - keep searching for exact match
                else:
                    # No time to verify, just check flight number exists
                    result["verified"] = True
                    result["status"] = "verified"
                    result["message"] = f"Flight {first_target} found on Google Flights"
                    result["google_flights"] = [gf]
                    return result
        
        # If we got here, flight not found
        if result["status"] != "time_mismatch":
            result["status"] = "not_found"
            result["message"] = f"Flight {first_target} not found on Google Flights for {date}"
            
            # Log available flights for debugging
            available = []
            for gf in fresh_flights[:5]:
                gf_legs = gf.get("flights", [])
                for leg in gf_legs:
                    fn = leg.get("flight_number", "")
                    if fn:
                        available.append(fn)
            logger.warning(f"[Verify] NOT FOUND: {first_target}. Available flights: {available[:10]}")
        
        return result
        
    except Exception as e:
        logger.error(f"[Verify] Error verifying flight: {e}", exc_info=True)
        result["status"] = "error"
        result["message"] = f"Verification error: {str(e)}"
        return result


async def get_verified_flights(
    origin: str,
    destination: str, 
    date: str,
    cabin_class: str = "Economy",
) -> Dict:
    """
    Get flights from Google Flights with verification metadata.
    
    Returns fresh data directly from SerpAPI with timestamps.
    """
    from .serp_api_functions import get_google_flights
    import asyncio
    
    fetched_at = datetime.now(timezone.utc).isoformat()
    
    try:
        loop = asyncio.get_event_loop()
        
        # Map cabin class to SerpAPI code
        cabin_codes = {
            "Economy": 1,
            "Premium Economy": 2, 
            "Business": 3,
            "First": 4,
        }
        cabin_code = cabin_codes.get(cabin_class, 1)
        
        flights = await loop.run_in_executor(
            None,
            lambda: get_google_flights(
                origin=origin,
                destination=destination,
                outbound_date=date,
                travel_class=cabin_code,
            )
        )
        
        # Add metadata to each flight
        for f in flights:
            f["_fetched_at"] = fetched_at
            f["_verified"] = True
            f["_source"] = "google_flights_fresh"
        
        return {
            "flights": flights,
            "fetched_at": fetched_at,
            "origin": origin,
            "destination": destination,
            "date": date,
            "count": len(flights),
        }
        
    except Exception as e:
        logger.error(f"[GetVerified] Error: {e}", exc_info=True)
        return {
            "flights": [],
            "fetched_at": fetched_at,
            "origin": origin,
            "destination": destination,
            "date": date,
            "count": 0,
            "error": str(e),
        }


def build_google_flights_url(origin: str, destination: str, date: str) -> str:
    """Build a Google Flights search URL for the given route and date."""
    # Format: https://www.google.com/travel/flights/search?tfs=...
    # For simplicity, use a readable format
    return (
        f"https://www.google.com/travel/flights/search"
        f"?q=flights%20from%20{origin}%20to%20{destination}%20on%20{date}"
    )
