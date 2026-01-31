"""
Itinerary fingerprinting for deduplication.

Computes deterministic fingerprints that identify "the same itinerary"
across different providers/sources.

Fingerprint includes:
- Ordered segment sequence (origin, destination)
- Operating carrier and flight number (when present)
- Departure date
- Floored departure time (to 5-minute granularity)

Fingerprint does NOT include:
- Price (cash or award)
- Provider name
- Exact timestamps (uses floored time)
"""

import hashlib
from typing import Any

from .datetime_utils import parse_dt, floor_to_minutes, DatetimeParseError
from .config_mvp import get_config


def compute_itinerary_fingerprint(segments: list[dict]) -> str:
    """
    Compute a deterministic fingerprint for a flight itinerary.
    
    The fingerprint identifies "the same physical itinerary" regardless
    of which provider returned it or at what price.
    
    Components:
    1. For each segment:
       - origin IATA code
       - destination IATA code
       - operating carrier (if present)
       - flight number (if present)
       - departure DATE (YYYY-MM-DD)
       - departure TIME floored to 5 minutes (HH:MM)
    
    Uses floor (not round) for time to reduce accidental merges of
    flights departing close together.
    
    Args:
        segments: List of segment dicts with origin, destination, dep_utc, etc.
    
    Returns:
        Hex string fingerprint (SHA-256 truncated to 16 chars)
    """
    config = get_config()
    components: list[str] = []
    
    for seg in segments:
        origin = seg.get("origin", "")
        destination = seg.get("destination", "")
        carrier = seg.get("operating_carrier") or seg.get("carrier", "")
        flight_num = seg.get("flight_number", "")
        
        # Parse and floor departure time
        dep_str = seg.get("dep_utc", "")
        dep_date = ""
        dep_time = ""
        
        if dep_str:
            try:
                dt = parse_dt(dep_str)
                dep_date = dt.strftime("%Y-%m-%d")
                
                # Floor to configured minutes
                floored = floor_to_minutes(dt, config.FINGERPRINT_TIME_FLOOR_MINUTES)
                dep_time = floored.strftime("%H:%M")
            except DatetimeParseError:
                # If we can't parse, use the raw string
                dep_date = dep_str[:10] if len(dep_str) >= 10 else dep_str
        
        # Build segment component
        # Format: "origin|destination|carrier|flight_num|date|time"
        seg_component = f"{origin}|{destination}|{carrier}|{flight_num}|{dep_date}|{dep_time}"
        components.append(seg_component)
    
    # Join all segments with "+"
    fingerprint_input = "+".join(components)
    
    # Hash and truncate
    hash_obj = hashlib.sha256(fingerprint_input.encode("utf-8"))
    return hash_obj.hexdigest()[:16]


def compute_property_fingerprint(property_data: dict) -> str:
    """
    Compute a deterministic fingerprint for a hotel property.
    
    Used to identify "the same hotel" across different providers.
    
    Components:
    - Provider property ID (if available and trusted)
    - OR fallback: name + lat/lon bucket + city
    
    Args:
        property_data: Dict with property_id, name, lat, lon, city, etc.
    
    Returns:
        Hex string fingerprint
    """
    components: list[str] = []
    
    # Prefer provider property ID if available
    property_id = property_data.get("property_id")
    provider = property_data.get("provider")
    
    if property_id and provider:
        # Use provider-specific ID
        components.append(f"provider:{provider}")
        components.append(f"id:{property_id}")
    else:
        # Fallback to name + location
        name = property_data.get("name", "").lower().strip()
        city = property_data.get("city", "").lower().strip()
        
        # Bucket lat/lon to ~1km precision
        lat = property_data.get("lat")
        lon = property_data.get("lon")
        lat_bucket = f"{lat:.2f}" if lat is not None else ""
        lon_bucket = f"{lon:.2f}" if lon is not None else ""
        
        components.extend([
            f"name:{name}",
            f"city:{city}",
            f"lat:{lat_bucket}",
            f"lon:{lon_bucket}",
        ])
    
    fingerprint_input = "|".join(components)
    hash_obj = hashlib.sha256(fingerprint_input.encode("utf-8"))
    return hash_obj.hexdigest()[:16]


def compute_room_quote_fingerprint(
    property_fingerprint: str,
    room_quote: dict,
) -> str:
    """
    Compute fingerprint for a specific room quote.
    
    Used to deduplicate room quotes across providers for the same property.
    
    Args:
        property_fingerprint: Parent property's fingerprint
        room_quote: Dict with room_type, cash_total, points, etc.
    
    Returns:
        Hex string fingerprint
    """
    components = [property_fingerprint]
    
    room_type = room_quote.get("room_type", "").lower().strip()
    cancel_policy = room_quote.get("cancel_policy", "").lower().strip()
    board_basis = room_quote.get("board_basis", "").lower().strip()
    
    components.extend([
        f"room:{room_type}",
        f"cancel:{cancel_policy}",
        f"board:{board_basis}",
    ])
    
    # Add pricing for exact match (different prices = different quotes)
    cash = room_quote.get("cash_total_all_in")
    if cash is not None:
        components.append(f"cash:{cash:.2f}")
    
    points = room_quote.get("points_per_night")
    if points is not None:
        components.append(f"points:{points}")
    
    fingerprint_input = "|".join(components)
    hash_obj = hashlib.sha256(fingerprint_input.encode("utf-8"))
    return hash_obj.hexdigest()[:16]


def fingerprints_match(fp1: str, fp2: str) -> bool:
    """
    Check if two fingerprints match.
    
    Simple string comparison, but could be extended for fuzzy matching.
    """
    return fp1 == fp2


def add_fingerprint_suffix(
    fingerprint: str,
    provider: str,
    candidate_id: str,
) -> str:
    """
    Add a unique suffix to a fingerprint.
    
    Used when merge gate fails - we keep both candidates but need
    unique fingerprints so dedup doesn't drop one.
    
    Args:
        fingerprint: Original fingerprint
        provider: Provider name
        candidate_id: Candidate ID
    
    Returns:
        New fingerprint with suffix: "{fingerprint}_{provider}_{candidate_id}"
    """
    return f"{fingerprint}_{provider}_{candidate_id}"
