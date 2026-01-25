import uuid
import re
import logging
from datetime import datetime
from typing import Dict, Any, List, Tuple, Optional
from src.repos import destination_repo, destination_vote_repo

logger = logging.getLogger(__name__)


def _normalize_city_name(name: str) -> str:
    """Extract just the city name, stripping airport codes if present."""
    # Handle "Paris (CDG,ORY)" -> "Paris"
    match = re.match(r'^([^(]+)', name)
    if match:
        return match.group(1).strip()
    return name.strip()


def _extract_airport_codes(name: str) -> List[str]:
    """Extract airport codes from name like 'Tokyo (NRT, HND)'."""
    match = re.search(r'\(([A-Z]{3}(?:,\s*[A-Z]{3})*)\)', name.upper())
    if match:
        return [code.strip() for code in match.group(1).split(',')]
    return []


def enrich_destination_with_display(dest: Dict[str, Any]) -> Dict[str, Any]:
    """Add display fields to a destination for frontend consumption."""
    enriched = dict(dest)
    
    name = dest.get("name", "")
    city_name = _normalize_city_name(name)
    airport_codes = _extract_airport_codes(name)
    
    # Display name: "Tokyo (NRT, HND)" or just "Paris"
    if airport_codes:
        enriched["displayName"] = f"{city_name} ({', '.join(airport_codes)})"
    else:
        enriched["displayName"] = city_name
    
    # Airports list
    enriched["airports"] = [
        {"iataCode": code, "isPrimary": i == 0}
        for i, code in enumerate(airport_codes)
    ]
    
    # City code (first 3 letters uppercase if no airport codes)
    if airport_codes:
        enriched["cityCode"] = airport_codes[0]
    else:
        enriched["cityCode"] = None
    
    return enriched


def get_destinations_response(
    trip_id: str,
    destinations: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Build a full destinations response with computed fields for frontend.
    
    Returns:
    {
        "tripId": str,
        "destinations": [...],  # All destinations with display fields
        "startDestination": {...} | null,  # Pre-computed start
        "endDestination": {...} | null,    # Pre-computed end
        "visitDestinations": [...],        # Excludes start/end
        "totalCount": int,
        "includedCount": int,
        "excludedCount": int,
    }
    """
    if not destinations:
        return {
            "tripId": trip_id,
            "destinations": [],
            "startDestination": None,
            "endDestination": None,
            "visitDestinations": [],
            "totalCount": 0,
            "includedCount": 0,
            "excludedCount": 0,
        }
    
    # Enrich all destinations with display fields
    enriched = [enrich_destination_with_display(d) for d in destinations]
    
    # Find start and end
    start_dest = next((d for d in enriched if d.get("isStart")), None)
    end_dest = next((d for d in enriched if d.get("isEnd")), None)
    
    # Fallback: use mustInclude order
    must_include = [d for d in enriched if d.get("mustInclude", False)]
    if not start_dest and must_include:
        start_dest = must_include[0]
    if not end_dest and must_include:
        end_dest = must_include[-1]
    
    # Final fallback: first and last destinations
    if not start_dest and enriched:
        start_dest = enriched[0]
    if not end_dest and enriched:
        end_dest = enriched[-1] if len(enriched) > 1 else enriched[0]
    
    # Visit destinations: all destinations that are not start/end
    start_id = start_dest.get("destinationId") if start_dest else None
    end_id = end_dest.get("destinationId") if end_dest else None
    visit_dests = [
        d for d in enriched
        if d.get("destinationId") not in (start_id, end_id)
        and not d.get("excluded", False)
    ]
    
    # Counts
    excluded_count = len([d for d in enriched if d.get("excluded", False)])
    included_count = len(enriched) - excluded_count
    
    return {
        "tripId": trip_id,
        "destinations": enriched,
        "startDestination": start_dest,
        "endDestination": end_dest,
        "visitDestinations": visit_dests,
        "totalCount": len(enriched),
        "includedCount": included_count,
        "excludedCount": excluded_count,
    }


def get_display_destinations_for_trip(destinations: List[Dict[str, Any]]) -> Tuple[List[str], str]:
    """
    For trip display (firstDestination, "Visiting X, Y, Z"): exclude origin/departure (mustInclude).
    Start and end are where the dates start/end—like booking an airline ticket (fly from A on
    startDate, arrive at B on endDate). They are not "destinations" for the total trip.
    - If there are middle cities (stays): use those only.
    - If simple A→B (no middle): the place you visit is the end.
    Returns (list of destination names for "Visiting", first destination name).
    """
    if not destinations:
        return ([], "")
    must_include = [d for d in destinations if d.get("mustInclude", False)]
    stay_dests = [d for d in destinations if not d.get("mustInclude", False)]
    end_dest = must_include[-1] if must_include else None
    display = stay_dests if stay_dests else ([end_dest] if end_dest else [])
    names = [
        (d.get("name") or d.get("destinationId") or "").strip()
        for d in display
        if (d.get("name") or d.get("destinationId"))
    ]
    names = [n for n in names if n]
    first = names[0] if names else ""
    return (names, first)


def add_destination(
    trip_id: str,
    user_id: str,
    name: str,
    must_include: bool,
    excluded: bool,
    *,
    is_start: bool = False,
    is_end: bool = False,
) -> Dict[str, Any]:
    dest_id = str(uuid.uuid4())
    item = {
        "tripId": trip_id,
        "destinationId": dest_id,
        "name": name,
        "mustInclude": must_include,
        "excluded": excluded,
        "isStart": is_start,
        "isEnd": is_end,
        "createdBy": user_id,
        "createdAt": datetime.utcnow().isoformat(),
    }
    destination_repo.add_destination(item)
    return item


def list_destinations(trip_id: str) -> List[Dict[str, Any]]:
    return destination_repo.list_destinations(trip_id)


def cast_vote(
    trip_id: str, destination_id: str, user_id: str, vote: int
) -> Dict[str, Any]:
    key = f"{destination_id}#{user_id}"
    item = {
        "tripId": trip_id,
        "destinationUser": key,
        "destinationId": destination_id,
        "userId": user_id,
        "vote": vote,
    }
    destination_vote_repo.put_vote(item)
    return item


def scores(trip_id: str) -> Dict[str, Any]:
    votes = destination_vote_repo.list_votes_for_trip(trip_id)
    totals: Dict[str, int] = {}
    for v in votes:
        d = v["destinationId"]
        totals[d] = totals.get(d, 0) + int(v.get("vote", 0))
    return {"tripId": trip_id, "scores": totals}
