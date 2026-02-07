"""
Itinerary math utilities for policy evaluation.

Provides deterministic computation of:
- Layover durations
- MCT requirements
- International connection detection
- Timezone-safe time calculations

Usage:
    from policy.itinerary_math import compute_layovers, is_international_connection
    
    layovers = compute_layovers(segments)
    for layover in layovers:
        print(f"Layover at {layover.airport}: {layover.minutes} minutes")
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional, Any

logger = logging.getLogger(__name__)


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class LayoverInfo:
    """Information about a single layover."""
    airport: str
    minutes: int
    is_international: bool = False
    arrival_terminal: Optional[str] = None
    departure_terminal: Optional[str] = None
    terminal_change: bool = False
    arrival_time: Optional[datetime] = None
    departure_time: Optional[datetime] = None
    timing_invalid: bool = False


# =============================================================================
# COUNTRY/REGION DATA (for international detection)
# =============================================================================

# Common airport codes grouped by country/region
# This is a simplified mapping - production would use a proper database
AIRPORT_COUNTRIES = {
    # USA
    "ATL": "US", "ORD": "US", "DFW": "US", "DEN": "US", "LAX": "US",
    "JFK": "US", "LGA": "US", "EWR": "US", "SFO": "US", "MIA": "US",
    "SEA": "US", "BOS": "US", "PHX": "US", "IAH": "US", "HOU": "US",
    "MSP": "US", "DTW": "US", "CLT": "US", "MCO": "US", "SAN": "US",
    "SLC": "US", "MDW": "US", "DAL": "US", "FLL": "US", "BWI": "US",
    "DCA": "US", "IAD": "US", "BUR": "US", "OAK": "US", "SJC": "US",
    "SNA": "US", "ONT": "US", "LAS": "US", "BNA": "US", "RDU": "US",
    "SAT": "US", "TPA": "US", "PDX": "US", "STL": "US", "AUS": "US",
    "PHL": "US", "HNL": "US",
    
    # Canada
    "YYZ": "CA", "YVR": "CA", "YUL": "CA", "YYC": "CA", "YOW": "CA",
    
    # UK
    "LHR": "GB", "LGW": "GB", "STN": "GB", "MAN": "GB", "EDI": "GB",
    
    # France
    "CDG": "FR", "ORY": "FR", "NCE": "FR", "LYS": "FR",
    
    # Germany
    "FRA": "DE", "MUC": "DE", "TXL": "DE", "BER": "DE", "DUS": "DE",
    
    # Spain
    "MAD": "ES", "BCN": "ES",
    
    # Italy
    "FCO": "IT", "MXP": "IT", "VCE": "IT",
    
    # Netherlands
    "AMS": "NL",
    
    # Switzerland
    "ZRH": "CH", "GVA": "CH",
    
    # Japan
    "NRT": "JP", "HND": "JP", "KIX": "JP",
    
    # South Korea
    "ICN": "KR", "GMP": "KR",
    
    # China
    "PVG": "CN", "PEK": "CN", "HKG": "HK", "CAN": "CN",
    
    # Singapore
    "SIN": "SG",
    
    # Australia
    "SYD": "AU", "MEL": "AU", "BNE": "AU",
    
    # UAE
    "DXB": "AE", "AUH": "AE",
    
    # Qatar
    "DOH": "QA",
    
    # Turkey
    "IST": "TR",
    
    # Mexico
    "MEX": "MX", "CUN": "MX", "GDL": "MX",
}

# Schengen zone countries (no passport control between them)
SCHENGEN_COUNTRIES = {
    "AT", "BE", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
    "IS", "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL",
    "PT", "SK", "SI", "ES", "SE", "CH",
}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def parse_datetime(time_str: Any) -> Optional[datetime]:
    """
    Parse a datetime from various formats.
    
    Handles:
    - ISO format strings: "2024-01-15T08:30:00Z"
    - Date + time strings: "2024-01-15 08:30"
    - Already datetime objects
    """
    if not time_str:
        return None
    
    if isinstance(time_str, datetime):
        return time_str
    
    if not isinstance(time_str, str):
        return None
    
    # Try various formats
    formats = [
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ]
    
    # Handle +00:00 timezone format
    time_str_clean = time_str.replace("Z", "+00:00")
    
    for fmt in formats:
        try:
            return datetime.strptime(time_str_clean, fmt)
        except ValueError:
            continue
    
    # Try ISO format parser as fallback
    try:
        return datetime.fromisoformat(time_str_clean)
    except ValueError:
        logger.debug(f"Could not parse datetime: {time_str}")
        return None


def get_country(airport_code: str) -> Optional[str]:
    """Get the country code for an airport."""
    return AIRPORT_COUNTRIES.get(airport_code.upper())


def is_international_connection(
    arriving_airport: str,
    departing_airport: str,
) -> bool:
    """
    Determine if a connection is international.
    
    International means crossing a border that requires customs/immigration.
    Schengen-to-Schengen is NOT international (no passport control).
    """
    arriving_country = get_country(arriving_airport)
    departing_country = get_country(departing_airport)
    
    # If we don't know the countries, assume it could be international
    if not arriving_country or not departing_country:
        return True
    
    # Same country - definitely domestic
    if arriving_country == departing_country:
        return False
    
    # Check Schengen zone
    arriving_schengen = arriving_country in SCHENGEN_COUNTRIES
    departing_schengen = departing_country in SCHENGEN_COUNTRIES
    
    # Schengen to Schengen is treated as "domestic" for MCT purposes
    if arriving_schengen and departing_schengen:
        return False
    
    # Different countries, not both Schengen - international
    return True


# =============================================================================
# MAIN FUNCTIONS
# =============================================================================

def compute_layovers(segments: list[dict]) -> list[LayoverInfo]:
    """
    Compute layover information for all connections in an itinerary.
    
    Args:
        segments: List of flight segments with arrival_time, departure_time, etc.
    
    Returns:
        List of LayoverInfo objects for each connection
    """
    layovers = []
    
    for i in range(len(segments) - 1):
        current_segment = segments[i]
        next_segment = segments[i + 1]
        
        # Get connection airport (arrival of current = departure of next)
        connection_airport = (
            current_segment.get("destination") or 
            current_segment.get("arrival_airport") or
            next_segment.get("origin") or
            next_segment.get("departure_airport") or
            "UNKNOWN"
        )
        
        # Parse times
        arrival_time = parse_datetime(
            current_segment.get("arrival_time") or
            current_segment.get("arrival_datetime")
        )
        departure_time = parse_datetime(
            next_segment.get("departure_time") or
            next_segment.get("departure_datetime")
        )
        
        # Calculate layover minutes
        layover_minutes = 0
        timing_invalid = False
        if arrival_time and departure_time:
            # Handle timezone differences
            if arrival_time.tzinfo is None and departure_time.tzinfo is not None:
                departure_time = departure_time.replace(tzinfo=None)
            elif arrival_time.tzinfo is not None and departure_time.tzinfo is None:
                arrival_time = arrival_time.replace(tzinfo=None)
            
            delta = departure_time - arrival_time
            layover_minutes = int(delta.total_seconds() / 60)
            
            # Negative layover is inconsistent timing data (do not auto-correct).
            if layover_minutes < 0:
                timing_invalid = True
                logger.warning(
                    f"Inconsistent timing (negative layover) at {connection_airport}: "
                    f"{arrival_time} -> {departure_time}"
                )
                layover_minutes = 0
        else:
            # If we can't calculate, use the provided value if available
            try:
                layover_minutes = int(current_segment.get("layover_minutes", 0) or 0)
            except Exception:
                layover_minutes = 0
            if layover_minutes < 0:
                timing_invalid = True
                layover_minutes = 0
        
        # Get terminals
        arrival_terminal = current_segment.get("arrival_terminal")
        departure_terminal = next_segment.get("departure_terminal")
        terminal_change = (
            arrival_terminal and departure_terminal and 
            arrival_terminal != departure_terminal
        )
        
        # Determine if international
        # Look at the overall journey to determine if customs is needed
        current_origin = current_segment.get("origin", "")
        next_destination = next_segment.get("destination", "")
        
        is_intl = is_international_connection(current_origin, next_destination)
        
        layovers.append(LayoverInfo(
            airport=connection_airport,
            minutes=layover_minutes,
            is_international=is_intl,
            arrival_terminal=arrival_terminal,
            departure_terminal=departure_terminal,
            terminal_change=terminal_change,
            arrival_time=arrival_time,
            departure_time=departure_time,
            timing_invalid=timing_invalid,
        ))
    
    return layovers


def compute_total_duration(segments: list[dict]) -> int:
    """
    Compute total journey duration in minutes.
    
    Includes flight time + all layovers.
    """
    if not segments:
        return 0
    
    first_departure = parse_datetime(
        segments[0].get("departure_time") or 
        segments[0].get("departure_datetime")
    )
    last_arrival = parse_datetime(
        segments[-1].get("arrival_time") or
        segments[-1].get("arrival_datetime")
    )
    
    if first_departure and last_arrival:
        # Handle timezone
        if first_departure.tzinfo is None and last_arrival.tzinfo is not None:
            last_arrival = last_arrival.replace(tzinfo=None)
        elif first_departure.tzinfo is not None and last_arrival.tzinfo is None:
            first_departure = first_departure.replace(tzinfo=None)
        
        delta = last_arrival - first_departure
        return int(delta.total_seconds() / 60)
    
    # Fallback: sum segment durations + layovers
    total = 0
    for segment in segments:
        total += segment.get("duration_minutes", 0)
    
    layovers = compute_layovers(segments)
    for layover in layovers:
        total += layover.minutes
    
    return total


def required_mct_minutes(
    airport: str,
    is_international: bool = False,
    config=None,
) -> int:
    """
    Get the required MCT for an airport and connection type.
    
    Args:
        airport: IATA airport code
        is_international: Whether customs/immigration is involved
        config: Optional PolicyConfig (uses default if not provided)
    
    Returns:
        Required minimum connection time in minutes
    """
    if config is None:
        from .config import get_policy_config
        config = get_policy_config()
    
    return config.mct_for_airport(airport, is_international)
