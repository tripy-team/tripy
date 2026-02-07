"""
Input normalization for the v2 itinerary pipeline.

Loads trip + destinations + points and produces a normalized InputBundle.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Dict, List, Optional, Any

from .schemas import TripConstraints, InputBundle, PointsByProgram
from .providers.http_logging import log_run_start, log_points_summary

logger = logging.getLogger(__name__)


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
        # Fixed-value banks (no airline transfer partners)
        "bank of america": "bank_of_america",
        "bank of america points": "bank_of_america",
        "bank_of_america": "bank_of_america",
        "bank_of_america_points": "bank_of_america",
        "boa": "bank_of_america",
        "wells fargo": "wells_fargo",
        "wells fargo points": "wells_fargo",
        "wells_fargo": "wells_fargo",
        "wells_fargo_points": "wells_fargo",
        "discover": "discover",
        "discover miles": "discover",
        "discover_miles": "discover",
        "us bank": "us_bank",
        "us bank rewards": "us_bank",
        "us_bank": "us_bank",
        "us_bank_rewards": "us_bank",
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
    
    # Fallback: check if it's already a short code
    original_stripped = program.strip()
    if len(original_stripped) <= 3 and original_stripped.isupper():
        return original_stripped
    if len(original_stripped) <= 10 and original_stripped.islower():
        return original_stripped
    
    return s


def _parse_date(date_str: str) -> Optional[date]:
    """Parse date string to date object."""
    if not date_str or not str(date_str).strip():
        return None
    try:
        return datetime.strptime(str(date_str).strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def _normalize_city_to_code(city_name: str) -> Optional[str]:
    """
    Convert city name to airport code.
    If already a code, return it. Otherwise, try to find the primary airport.
    """
    import re
    
    city_name = city_name.strip()
    
    # If it's already an airport code, return it
    if re.match(r'^[A-Z]{3}$', city_name):
        return city_name
    
    # Check if it's in format "City (CODE1,CODE2,CODE3)" and extract first code
    code_match = re.search(r'\(([A-Z]{3}(?:,[A-Z]{3})*)\)', city_name.upper())
    if code_match:
        codes = code_match.group(1).split(',')
        return codes[0].strip()
    
    # Strip airport codes from name for searching
    search_name = re.sub(r'\s*\([A-Z]{3}(?:,[A-Z]{3})*\)', '', city_name).strip()
    
    # Try Amadeus city service search (primary)
    try:
        from src.services import city_service
        results = city_service.search_cities(search_name, max_results=5)
        if results:
            for result in results:
                iata_code = result.get("iataCode", "")
                if iata_code and re.match(r'^[A-Z]{3}$', iata_code):
                    return iata_code.upper()
    except Exception as e:
        logger.debug(f"City search for {city_name} failed: {e}")
    
    # Fallback to CSV-based airport search (comprehensive, fast)
    # The CSV contains 40,000+ airports - no need for OpenAI
    try:
        from src.services.airport_service import search_airports
        airport_results = search_airports(search_name, max_results=5)
        if airport_results:
            for result in airport_results:
                iata_code = result.get("iata_code", "")
                if iata_code and re.match(r'^[A-Z]{3}$', iata_code):
                    logger.info(f"Found airport code {iata_code} for '{city_name}' via CSV lookup")
                    return iata_code.upper()
    except Exception as e:
        logger.debug(f"CSV airport lookup for {city_name}: {e}")
    
    return None


async def load_input_bundle(trip_id: str, run_id: str) -> InputBundle:
    """
    Load trip + destinations + points and produce a normalized InputBundle.
    
    Args:
        trip_id: The trip ID to load
        run_id: Correlation ID for logging
        
    Returns:
        InputBundle with normalized constraints and points
        
    Raises:
        ValueError: If trip data is invalid or missing required fields
    """
    import asyncio
    from src.services import (
        trip_service,
        destination_service,
        trip_member_service,
        points_service,
    )
    
    # 1. Load trip
    trip = trip_service.get_trip(trip_id)
    if not trip:
        raise ValueError(f"Trip {trip_id} not found")
    
    # 2. Load destinations
    destinations = destination_service.list_destinations(trip_id)
    if not destinations:
        raise ValueError("No destinations found for trip")
    
    valid_destinations = [d for d in destinations if not d.get("excluded", False)]
    if not valid_destinations:
        raise ValueError("All destinations are excluded")
    
    # Find start/end destinations
    must_include = [d for d in valid_destinations if d.get("mustInclude", False)]
    start_d = next((d for d in valid_destinations if d.get("isStart", False)), None)
    end_d = next((d for d in valid_destinations if d.get("isEnd", False)), None)
    
    if start_d is None:
        start_d = must_include[0] if must_include else valid_destinations[0]
    if end_d is None:
        end_d = must_include[-1] if must_include else (
            valid_destinations[-1] if len(valid_destinations) > 1 else valid_destinations[0]
        )
    
    start_dest_name = (start_d.get("name") or "").strip()
    end_dest_name = (end_d.get("name") or "").strip()
    
    # Get start/end destination IDs for robust filtering
    start_dest_id = start_d.get("destinationId")
    end_dest_id = end_d.get("destinationId")
    
    # Collect intermediate cities (not start/end) - use IDs for comparison, not names
    # This handles cases where start and end might have the same name (e.g., round trip)
    city_names = []
    for d in valid_destinations:
        dest_id = d.get("destinationId")
        name = (d.get("name") or "").strip()
        if name and dest_id not in (start_dest_id, end_dest_id):
            city_names.append(name)
    
    # Resolve all names to airport codes in parallel
    all_names = [start_dest_name, end_dest_name] + city_names
    codes = await asyncio.gather(
        *[asyncio.to_thread(_normalize_city_to_code, name) for name in all_names],
        return_exceptions=True,
    )
    
    start_code = codes[0] if not isinstance(codes[0], Exception) else None
    end_code = codes[1] if not isinstance(codes[1], Exception) else None
    
    city_codes = []
    for i, name in enumerate(city_names):
        result = codes[i + 2]
        if isinstance(result, Exception):
            logger.warning(f"Error resolving '{name}': {result}")
        elif result:
            city_codes.append(result)
        else:
            logger.warning(f"Could not find airport code for '{name}', skipping")
    
    if not start_code:
        raise ValueError(f"Could not find airport code for start destination: {start_dest_name}")
    if not end_code:
        raise ValueError(f"Could not find airport code for end destination: {end_dest_name}")
    
    # 3. Load members
    members = trip_member_service.list_members(trip_id)
    if not members:
        raise ValueError("No members found for trip")
    
    travelers = [m.get("userId", "") for m in members if m.get("status") == "active"]
    if not travelers:
        raise ValueError("No active travelers found")
    
    # 4. Load points
    points_summary = points_service.trip_points_summary(trip_id)
    points_items = points_summary.get("items", [])
    
    points_by_traveler: Dict[str, Dict[str, int]] = {}
    total_points = 0
    program_totals: Dict[str, int] = {}
    
    for item in points_items:
        user_id = item.get("userId", "")
        program = item.get("program", "")
        try:
            balance = int(item.get("balance", 0))
        except (ValueError, TypeError):
            continue
        
        if user_id and program and balance > 0:
            if user_id not in points_by_traveler:
                points_by_traveler[user_id] = {}
            program_normalized = _normalize_program_to_transfer_key(program)
            points_by_traveler[user_id][program_normalized] = balance
            total_points += balance
            program_totals[program_normalized] = program_totals.get(program_normalized, 0) + balance
    
    # 5. Build constraints
    start_date = _parse_date(trip.get("startDate", ""))
    end_date = _parse_date(trip.get("endDate", ""))
    
    duration_days = None
    if start_date and end_date:
        duration_days = (end_date - start_date).days
    elif trip.get("durationDays"):
        try:
            duration_days = int(trip.get("durationDays"))
        except (TypeError, ValueError):
            pass
    
    max_budget = None
    if trip.get("maxBudget"):
        try:
            max_budget = int(trip.get("maxBudget"))
        except (TypeError, ValueError):
            pass
    
    constraints = TripConstraints(
        start_airport=start_code,
        end_airport=end_code,
        must_visit_airports=tuple(city_codes),
        start_date=start_date,
        end_date=end_date,
        duration_days=duration_days,
        max_budget_usd=max_budget,
    )
    
    # 6. Log inputs
    log_run_start(
        run_id=run_id,
        trip_id=trip_id,
        user_id=trip.get("createdBy"),
        constraints={
            "start_airport": start_code,
            "end_airport": end_code,
            "must_visit": list(city_codes),
            "start_date": str(start_date) if start_date else None,
            "end_date": str(end_date) if end_date else None,
            "duration_days": duration_days,
            "max_budget_usd": max_budget,
        },
        traveler_count=len(travelers),
    )
    
    # Log points summary
    top_programs = sorted(program_totals.items(), key=lambda x: -x[1])[:5]
    log_points_summary(
        run_id=run_id,
        total_points=total_points,
        top_programs=top_programs,
        traveler_count=len(travelers),
    )
    
    return InputBundle(
        trip_id=trip_id,
        constraints=constraints,
        travelers=travelers,
        points_by_traveler=points_by_traveler,
        trip_title=trip.get("title"),
        user_id=trip.get("createdBy"),
    )
