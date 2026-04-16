"""
SerpAPI (Google Flights, Autocomplete) and AwardTool integration.
- Autocomplete: google_flights_autocomplete for destination suggestions.
- Flights: google_flights for cash prices; AwardTool search_real_time for points + surcharge.
- Optimizer: combine both to rank by out-of-pocket (min cash vs points surcharge).
"""
import os
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()

from serpapi import GoogleSearch

from src.config import SERP_API_KEY as _CONFIG_SERP, AWARDTOOL_API_KEY as _CONFIG_AWARDTOOL

SERP_URL = "https://serpapi.com/search.json"
AWARDTOOL_URL = "https://www.awardtool-api.com/search_real_time"


def _serp_key() -> str:
    return (
        (_CONFIG_SERP or os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY") or "").strip()
    )


def _award_key() -> str:
    return (
        (_CONFIG_AWARDTOOL or os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY") or "").strip()
    )


# --- Autocomplete (SerpAPI Google Flights Autocomplete) ---


def _get_commercial_set():
    from src.handlers.airport_filter import load_commercial_iata_set_from_web
    return load_commercial_iata_set_from_web()


def _is_commercial(iata: str, commercial_set: set) -> bool:
    from src.handlers.airport_filter import is_commercial_airport
    return is_commercial_airport(iata, commercial_set)


# Metro area airport groupings - airports that should be included when searching for a city
# Key: query patterns (lowercase), Value: dict with "primary_city" name pattern and "include_cities" to merge
METRO_AREA_GROUPINGS = {
    "new york": {
        "primary_city_pattern": "new york",
        "include_city_patterns": ["newark"],
        "include_airports": ["EWR"],  # Newark Liberty should be included with NYC
    },
    "nyc": {
        "primary_city_pattern": "new york",
        "include_city_patterns": ["newark"],
        "include_airports": ["EWR"],
    },
}


def _merge_metro_area_airports(query: str, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Merge airports from nearby cities into the primary metro city.
    E.g., when searching "New York", include Newark (EWR) in the New York airports list.
    """
    query_lower = query.lower().strip()
    
    # Check if query matches any metro area grouping
    grouping = None
    for pattern, config in METRO_AREA_GROUPINGS.items():
        if pattern in query_lower or query_lower.startswith(pattern):
            grouping = config
            break
    
    if not grouping:
        return results
    
    primary_pattern = grouping["primary_city_pattern"]
    include_patterns = grouping["include_city_patterns"]
    include_airports = grouping.get("include_airports", [])
    
    # Find the primary city entry and cities to merge
    primary_entry = None
    entries_to_merge = []
    other_entries = []
    
    for entry in results:
        name_lower = (entry.get("name") or "").lower()
        entry_type = (entry.get("type") or "").lower()
        
        # Check if this is the primary city (city type, not airport)
        if primary_pattern in name_lower and entry_type == "city":
            primary_entry = entry
        # Check if this should be merged (Newark for NYC)
        elif any(p in name_lower for p in include_patterns):
            entries_to_merge.append(entry)
        else:
            other_entries.append(entry)
    
    # If no primary entry found, return original results
    if not primary_entry:
        return results
    
    # Merge airports from secondary cities into primary
    existing_airport_ids = {a.get("id", "").upper() for a in primary_entry.get("airports", [])}
    
    for merge_entry in entries_to_merge:
        for airport in merge_entry.get("airports", []):
            airport_id = (airport.get("id") or "").upper()
            # Add if not already present
            if airport_id and airport_id not in existing_airport_ids:
                # Mark it as part of the metro area
                airport_copy = dict(airport)
                if "city" not in airport_copy or not airport_copy["city"]:
                    airport_copy["city"] = merge_entry.get("name", "")
                primary_entry.setdefault("airports", []).append(airport_copy)
                existing_airport_ids.add(airport_id)
    
    # Also check if there are standalone airport entries we should include
    final_other = []
    for entry in other_entries:
        entry_id = (entry.get("id") or "").upper()
        entry_type = (entry.get("type") or "").lower()
        
        # If this is an airport that should be included in the metro
        if entry_type == "airport" and entry_id in include_airports:
            if entry_id not in existing_airport_ids:
                airport_data = {
                    "id": entry_id,
                    "name": entry.get("name", ""),
                    "city": entry.get("description", "").split(",")[0] if entry.get("description") else "",
                    "city_id": entry.get("city_id", ""),
                    "distance": entry.get("distance", ""),
                }
                primary_entry.setdefault("airports", []).append(airport_data)
                existing_airport_ids.add(entry_id)
        else:
            final_other.append(entry)
    
    # Return primary entry first, then other entries (excluding merged ones)
    return [primary_entry] + final_other


def autocomplete_destinations(
    q: str,
    gl: str = "us",
    hl: str = "en",
    exclude_regions: bool = False,
    commercial_only: bool = False,
) -> List[Dict[str, Any]]:
    """
    Destination autocomplete via SerpAPI google_flights_autocomplete.
    If commercial_only=True, filters to commercial airports only (scheduled_service + large/medium/small).
    Returns: [{ name, type, description, id, airports: [{ id, name, city, city_id, distance }] }]
    """
    key = _serp_key()
    if not key or not (q or "").strip():
        return []

    params: Dict[str, Any] = {
        "engine": "google_flights_autocomplete",
        "q": (q or "").strip(),
        "gl": gl or "us",
        "hl": hl or "en",
        "api_key": key,
    }
    if exclude_regions:
        params["exclude_regions"] = "true"

    try:
        search = GoogleSearch(params)
        data = search.get_dict()
        raw = (data or {}).get("suggestions") or []
        commercial_set: Optional[set] = None
        if commercial_only:
            try:
                commercial_set = _get_commercial_set()
            except Exception:
                commercial_set = set()

        out: List[Dict[str, Any]] = []
        for s in raw:
            ap = s.get("airports") or []
            if commercial_only and commercial_set is not None:
                ap = [
                    a for a in ap
                    if _is_commercial((a.get("id") or "").strip(), commercial_set)
                ]
            entry: Dict[str, Any] = {
                "name": s.get("name") or "",
                "type": s.get("type") or "",
                "description": s.get("description") or "",
                "id": s.get("id") or "",
            }
            entry["airports"] = [
                {
                    "id": a.get("id") or "",
                    "name": a.get("name") or "",
                    "city": a.get("city") or "",
                    "city_id": a.get("city_id") or "",
                    "distance": a.get("distance") or "",
                }
                for a in ap
            ]
            if commercial_only and commercial_set is not None:
                sid = (s.get("id") or "").strip().upper()
                stype = (s.get("type") or "").strip().lower()
                if stype == "airport" and len(sid) == 3 and sid not in commercial_set:
                    continue
            out.append(entry)
        
        # Merge metro area airports (e.g., Newark into New York)
        out = _merge_metro_area_airports(q, out)
        return out
    except Exception:
        return []


# --- Flights: SerpAPI Google Flights ---


def get_google_flights(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: Optional[str] = None,
    travel_class: Optional[int] = None,
    commercial_only: bool = False,
    sort_by: Optional[int] = None,
    stops: Optional[int] = None,
    outbound_times: Optional[str] = None,
    best_only: bool = False,
    exclude_airlines: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Round-trip (type=2) or one-way (type=1) via SerpAPI google_flights.
    If commercial_only=True, returns [] when origin or destination is not a commercial airport.
    
    Advanced filters (Google Flights parity):
        sort_by: 1=Top flights (best), 2=Price, 3=Departure, 4=Arrival, 5=Duration
        stops: 0=Any, 1=Nonstop, 2=1 stop or fewer, 3=2 stops or fewer
        outbound_times: Hour ranges like "6,18" (depart 6AM-7PM) or "6,18,8,22" (depart+arrive)
        best_only: If True, only return SerpAPI's recommended "best_flights" (excludes other).
                   If False (default), return best_flights + other_flights combined.
        exclude_airlines: Comma-separated IATA airline codes to exclude (e.g. "NK,F9,G4").
    
    Returns: best_flights + other_flights (or best_flights only if best_only=True)
    """
    # Check if dummy mode is enabled
    from src.config import is_awardtool_dummy_mode
    if is_awardtool_dummy_mode():
        from src.handlers.awardtool_dummy import generate_dummy_serp_data
        import logging
        logging.getLogger(__name__).info("[DUMMY MODE] Returning dummy Google Flights data for %s->%s", origin, destination)
        body = generate_dummy_serp_data(origin, destination, outbound_date, travel_class)
        best = body.get("best_flights") or []
        other = body.get("other_flights") or []
        if best_only:
            if best:
                logging.getLogger(__name__).info(f"[DUMMY MODE] best_only=True: returning {len(best)} best flights (excluded {len(other)} other flights)")
                return list(best)
            else:
                # best_flights not always present in SerpAPI response - fall back to other_flights
                logging.getLogger(__name__).warning(f"[DUMMY MODE] best_only=True but no best_flights returned, falling back to all {len(other)} other_flights")
                return list(other)
        return list(best) + list(other)
    
    import logging
    logger = logging.getLogger(__name__)
    
    key = _serp_key()
    if not key:
        logger.warning("[SerpAPI] SERPAPI_KEY/SERP_API_KEY not configured - cannot fetch cash flight prices")
        return []
    if not origin or not destination or not outbound_date:
        logger.warning(f"[SerpAPI] Missing required params: origin={origin}, destination={destination}, date={outbound_date}")
        return []

    if commercial_only:
        try:
            commercial_set = _get_commercial_set()
            if not _is_commercial((origin or "").strip(), commercial_set) or not _is_commercial((destination or "").strip(), commercial_set):
                return []
        except Exception:
            pass

    params: Dict[str, Any] = {
        "engine": "google_flights",
        "departure_id": (origin or "").strip().upper(),
        "arrival_id": (destination or "").strip().upper(),
        "outbound_date": (outbound_date or "").strip(),
        # FIXED: type=1 is Round trip (requires return_date), type=2 is One-way
        "type": "1" if return_date else "2",
        "currency": "USD",
        "hl": "en",
        "api_key": key,
    }
    if return_date:
        params["return_date"] = (return_date or "").strip()
    if travel_class is not None and travel_class in (1, 2, 3, 4):
        params["travel_class"] = str(travel_class)
    # Advanced filters (Google Flights parity)
    if sort_by is not None and sort_by in (1, 2, 3, 4, 5, 6):
        params["sort_by"] = str(sort_by)
    if stops is not None and stops in (1, 2, 3):
        params["stops"] = str(stops)
    if outbound_times:
        params["outbound_times"] = outbound_times
    if exclude_airlines:
        params["exclude_airlines"] = exclude_airlines

    try:
        logger.info(f"[SerpAPI] Calling GoogleSearch with params: {params}")
        search = GoogleSearch(params)
        data = search.get_dict()
        
        # Log the full response structure for debugging
        if data:
            logger.info(f"[SerpAPI] Response keys: {list(data.keys())}")
            if "error" in data:
                logger.error(f"[SerpAPI] API error: {data.get('error')}")
            if "search_metadata" in data:
                sm = data.get("search_metadata", {})
                logger.info(f"[SerpAPI] Search metadata: status={sm.get('status')}, id={sm.get('id')}")
        else:
            logger.warning(f"[SerpAPI] Empty response from SerpAPI for {origin}->{destination}")
        
        best = (data or {}).get("best_flights") or []
        other = (data or {}).get("other_flights") or []
        if best_only:
            if best:
                logger.info(f"[SerpAPI] get_google_flights {origin}->{destination}: returning {len(best)} best flights only (excluded {len(other)} other flights)")
                return list(best)
            else:
                # best_flights is not always present in SerpAPI response - fall back to other_flights
                logger.warning(f"[SerpAPI] get_google_flights {origin}->{destination}: best_only=True but no best_flights returned, falling back to all {len(other)} other_flights")
                return list(other)
        all_flights = list(best) + list(other)
        logger.info(f"[SerpAPI] get_google_flights {origin}->{destination}: {len(all_flights)} flights returned (best={len(best)}, other={len(other)})")
        return all_flights
    except Exception as e:
        logger.error(f"[SerpAPI] get_google_flights {origin}->{destination} failed: {type(e).__name__}: {e}")
        import traceback
        logger.error(f"[SerpAPI] Traceback: {traceback.format_exc()}")
        return []


# --- AwardTool (points + surcharge) ---


def fetch_awardtool(
    origin: str,
    destination: str,
    date: str,
    programs: List[str],
    cabins: List[str],
    pax: int,
) -> Dict[str, Any]:
    """
    AwardTool search_real_time. Returns { status, data: [{ award_points, surcharge, cabin_type, fare, products }] }.
    """
    # Check if dummy mode is enabled
    from src.config import is_awardtool_dummy_mode
    if is_awardtool_dummy_mode():
        from src.handlers.awardtool_dummy import generate_dummy_flight_data
        import logging
        logging.getLogger(__name__).info("[DUMMY MODE] Returning dummy AwardTool data for %s->%s", origin, destination)
        return generate_dummy_flight_data(
            (origin or "").strip().upper(),
            (destination or "").strip().upper(),
            (date or "").strip(),
            cabins or ["Economy"],
            programs or ["UA", "DL", "AA"],
            int(pax) if pax is not None else 1
        )
    
    import requests

    key = _award_key()
    payload = {
        "origin": (origin or "").strip().upper(),
        "destination": (destination or "").strip().upper(),
        "date": (date or "").strip(),
        "programs": programs or ["UA", "DL", "AA"],
        "cabins": cabins or ["Economy"],
        "pax": str(int(pax) if pax is not None else 1),
        "api_key": key or "",
    }
    try:
        r = requests.post(AWARDTOOL_URL, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
        return r.json() if r.text else {"status": r.status_code, "data": []}
    except Exception:
        return {"status": 0, "data": []}


def _min_surcharge_and_points(data: List[Dict]) -> tuple:
    """From AwardTool data, return (min_surcharge, min_points) for Economy."""
    sur, pts = None, None
    for d in data or []:
        cp = (d.get("cabin_type") or "").strip()
        if cp and "economy" not in cp.lower() and "Economy" not in cp:
            continue
        s = d.get("surcharge")
        p = d.get("award_points")
        if s is not None and (sur is None or (isinstance(s, (int, float)) and s < sur)):
            sur = s
        if p is not None and (pts is None or (isinstance(p, (int, float)) and p < pts)):
            pts = p
    return (sur, pts)


# --- Out-of-pocket optimizer ---


def optimize_itinerary_out_of_pocket(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: str,
    programs: Optional[List[str]] = None,
    cabins: Optional[List[str]] = None,
    pax: int = 1,
    top_per_leg: int = 10,
    commercial_only: bool = False,
) -> Dict[str, Any]:
    """
    Round-trip: SerpAPI (cash) + AwardTool (points + surcharge). Rank by out-of-pocket.
    If commercial_only=True, returns an error when origin or destination is not a commercial airport.
    Out-of-pocket: cash (if pay cash) or surcharge (if use points). We pick the lower for each option when both exist.
    Returns: { best_by_cash, best_by_surcharge, best_overall, options }
    """
    prog = programs or ["UA", "DL", "AA"]
    cab = cabins or ["Economy"]

    if commercial_only:
        try:
            commercial_set = _get_commercial_set()
            if not _is_commercial((origin or "").strip(), commercial_set) or not _is_commercial((destination or "").strip(), commercial_set):
                return {
                    "best_by_cash": None,
                    "best_by_surcharge": None,
                    "best_overall": None,
                    "options": [],
                    "error": "Origin and destination must be commercial airports (scheduled service).",
                    "origin": (origin or "").strip().upper(),
                    "destination": (destination or "").strip().upper(),
                    "outbound_date": outbound_date,
                    "return_date": return_date,
                }
        except Exception:
            pass

    # 1) SerpAPI round-trip
    serp_all = get_google_flights(origin, destination, outbound_date, return_date, commercial_only=commercial_only)
    if not serp_all:
        return {
            "best_by_cash": None,
            "best_by_surcharge": None,
            "best_overall": None,
            "options": [],
            "error": "No flights from SerpAPI",
        }

    # 2) AwardTool for outbound and return (we use average surcharge/points as proxy for the round-trip combo)
    award_out = fetch_awardtool(origin, destination, outbound_date, prog, cab, pax)
    award_ret = fetch_awardtool(destination, origin, return_date, prog, cab, pax)
    sur_out, pts_out = _min_surcharge_and_points(award_out.get("data") or [])
    sur_ret, pts_ret = _min_surcharge_and_points(award_ret.get("data") or [])

    total_surcharge = None
    if sur_out is not None or sur_ret is not None:
        total_surcharge = (sur_out or 0) + (sur_ret or 0)
    total_points = None
    if pts_out is not None or pts_ret is not None:
        total_points = (pts_out or 0) + (pts_ret or 0)

    # 3) Build options from SerpAPI only (AwardTool doesn’t give per-option; we attach route-level award totals)
    options: List[Dict[str, Any]] = []
    for s in serp_all[:top_per_leg]:
        cash = s.get("price")
        if cash is None:
            continue
        c = int(cash) if isinstance(cash, (int, float)) else 0
        sur = total_surcharge if total_surcharge is not None else None
        pts = total_points if total_points else None
        oop = min(c, sur) if (c and sur is not None) else (c or sur)
        options.append({
            "price": c,
            "points": pts,
            "surcharge": sur,
            "out_of_pocket": oop if oop is not None else c,
            "flights": s.get("flights") or [],
            "total_duration": s.get("total_duration"),
            "type": s.get("type"),
        })

    if not options:
        return {
            "best_by_cash": None,
            "best_by_surcharge": None,
            "best_overall": None,
            "options": [],
        }

    by_cash = sorted(options, key=lambda x: (x["price"] or 0))
    by_surcharge = sorted(options, key=lambda x: (x["surcharge"] if x["surcharge"] is not None else 999999999, x["price"] or 0))
    by_oop = sorted(options, key=lambda x: (x["out_of_pocket"] or 999999999, x["price"] or 0))

    return {
        "origin": (origin or "").strip().upper(),
        "destination": (destination or "").strip().upper(),
        "outbound_date": outbound_date,
        "return_date": return_date,
        "best_by_cash": by_cash[0] if by_cash else None,
        "best_by_surcharge": by_surcharge[0] if by_surcharge and (by_surcharge[0].get("surcharge") is not None) else None,
        "best_overall": by_oop[0] if by_oop else None,
        "options": options,
    }


# --- Google Hotels (SerpAPI) ---


def _resolve_airport_code_to_city(code: str) -> str:
    """
    Convert an IATA airport code to a city name for hotel search queries.

    If the input is a 3-letter uppercase code, look it up in the programs config
    (airports data) or a built-in fallback map. Returns the city name if found,
    otherwise returns the input unchanged.
    """
    stripped = (code or "").strip()
    upper = stripped.upper()

    # Only attempt resolution for 3-letter codes that look like IATA codes
    if len(stripped) != 3 or not stripped.isalpha():
        return stripped

    # Built-in fallback map for common airports not in the programs config
    _AIRPORT_CITY_MAP = {
        "AMS": "Amsterdam", "ATH": "Athens", "ATL": "Atlanta",
        "AUS": "Austin", "BCN": "Barcelona", "BER": "Berlin",
        "BFI": "Seattle", "BKK": "Bangkok", "BNA": "Nashville",
        "BOM": "Mumbai", "BOS": "Boston", "BRU": "Brussels",
        "CAI": "Cairo", "CDG": "Paris", "CLT": "Charlotte",
        "CPH": "Copenhagen", "CUN": "Cancun", "DAL": "Dallas",
        "DCA": "Washington", "DEL": "Delhi", "DEN": "Denver",
        "DFW": "Dallas", "DOH": "Doha", "DUB": "Dublin",
        "DXB": "Dubai", "EWR": "New York", "EZE": "Buenos Aires",
        "FCO": "Rome", "FLL": "Fort Lauderdale", "FRA": "Frankfurt",
        "GIG": "Rio de Janeiro", "GRU": "Sao Paulo",
        "HKG": "Hong Kong", "HND": "Tokyo", "HNL": "Honolulu",
        "IAD": "Washington", "IAH": "Houston",
        "ICN": "Seoul", "IST": "Istanbul",
        "JFK": "New York", "JNB": "Johannesburg",
        "KEF": "Reykjavik",
        "KUL": "Kuala Lumpur", "LAS": "Las Vegas",
        "LAX": "Los Angeles", "LGA": "New York",
        "LGW": "London", "LHR": "London", "LIS": "Lisbon",
        "MAD": "Madrid", "MAN": "Manchester",
        "MCO": "Orlando", "MDW": "Chicago",
        "MEX": "Mexico City", "MIA": "Miami",
        "MNL": "Manila", "MSP": "Minneapolis",
        "MUC": "Munich", "MXP": "Milan",
        "NAP": "Naples", "NCE": "Nice", "NRT": "Tokyo",
        "OAK": "Oakland", "OGG": "Maui",
        "ORD": "Chicago", "ORY": "Paris", "OSL": "Oslo",
        "PDX": "Portland", "PEK": "Beijing",
        "PHL": "Philadelphia", "PHX": "Phoenix",
        "PMI": "Palma de Mallorca", "PRG": "Prague",
        "PTY": "Panama City", "PVG": "Shanghai",
        "RDU": "Raleigh", "SAN": "San Diego",
        "SAT": "San Antonio", "SCL": "Santiago",
        "SEA": "Seattle", "SFO": "San Francisco",
        "SIN": "Singapore", "SJC": "San Jose",
        "SLC": "Salt Lake City", "SNA": "Orange County",
        "STL": "St. Louis", "SYD": "Sydney",
        "TLV": "Tel Aviv", "TPA": "Tampa",
        "VIE": "Vienna", "YUL": "Montreal",
        "YVR": "Vancouver", "YYZ": "Toronto",
        "ZRH": "Zurich",
    }

    city = _AIRPORT_CITY_MAP.get(upper)
    if city:
        import logging
        logging.getLogger(__name__).info(
            "Resolved airport code %s → %s for hotel search", upper, city
        )
        return city

    # Try loading from programs config (has airline/airport data)
    try:
        from src.config.programs import get_airline_name
        name = get_airline_name(upper)
        if name and name != upper:
            return name
    except Exception:
        pass

    return stripped


def get_google_hotels(
    q: str,
    check_in_date: str,
    check_out_date: str,
    adults: int = 2,
    currency: str = "USD",
    gl: str = "us",
    hl: str = "en",
    sort_by: int = 3,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """
    SerpAPI engine=google_hotels. sort_by=3 is lowest price.
    Returns: [{ name, cash_total, cash_per_night, property_token, source }]
    """
    # Check if dummy mode is enabled
    from src.config import is_awardtool_dummy_mode
    if is_awardtool_dummy_mode():
        from src.handlers.awardtool_dummy import generate_dummy_hotel_data
        import logging
        logging.getLogger(__name__).info("[DUMMY MODE] Returning dummy Google Hotels data for %s", q)
        # Generate dummy hotel data and convert to Google Hotels format
        dummy = generate_dummy_hotel_data(q, check_in_date, check_out_date, ["HH", "MAR", "HYATT", "IHG"], adults)
        out = []
        for h in (dummy.get("data") or [])[:limit]:
            out.append({
                "name": h.get("name", ""),
                "cash_total": h.get("cash_cost"),
                "cash_per_night": h.get("cash_cost") / max(1, (h.get("nights") or 1)) if h.get("cash_cost") else None,
                "property_token": h.get("hotel_id"),
                "source": "google_hotels_dummy",
                "overall_rating": h.get("star_rating"),
            })
        return out
    
    # Resolve airport codes to city names (e.g., "KEF" → "Reykjavik")
    q = _resolve_airport_code_to_city(q)

    key = _serp_key()
    if not key or not (q or "").strip() or not check_in_date or not check_out_date:
        return []

    params: Dict[str, Any] = {
        "engine": "google_hotels",
        "q": (q or "").strip(),
        "check_in_date": (check_in_date or "").strip(),
        "check_out_date": (check_out_date or "").strip(),
        "adults": max(1, int(adults)) if adults is not None else 2,
        "currency": (currency or "USD").strip(),
        "gl": gl or "us",
        "hl": hl or "en",
        "sort_by": int(sort_by) if sort_by is not None else 3,
        "api_key": key,
    }

    try:
        search = GoogleSearch(params)
        data = search.get_dict()
        out: List[Dict[str, Any]] = []

        def _extract(prop: Dict) -> None:
            name = (prop.get("name") or "").strip()
            if not name:
                return
            total = None
            per_night = None
            tr = prop.get("total_rate") or {}
            if isinstance(tr, dict):
                total = tr.get("extracted_lowest")
            rpn = prop.get("rate_per_night") or {}
            if isinstance(rpn, dict):
                per_night = rpn.get("extracted_lowest")
            cash = total if total is not None else per_night
            if cash is None:
                return
            token = (prop.get("property_token") or "").strip()
            out.append({
                "name": name,
                "cash_total": float(cash) if total is not None else None,
                "cash_per_night": float(per_night) if per_night is not None else float(cash),
                "property_token": token or None,
                "source": "google_hotels",
                "overall_rating": prop.get("overall_rating"),
            })

        for prop in (data or {}).get("properties") or []:
            if isinstance(prop, dict):
                _extract(prop)
        for ad in (data or {}).get("ads") or []:
            if isinstance(ad, dict):
                pr = ad.get("extracted_price") or ad.get("price")
                if pr is not None and isinstance(pr, (int, float)):
                    out.append({
                        "name": (ad.get("name") or "").strip() or "Hotel",
                        "cash_total": None,
                        "cash_per_night": float(pr),
                        "property_token": (ad.get("property_token") or "").strip() or None,
                        "source": "google_hotels",
                        "overall_rating": ad.get("overall_rating"),
                    })

        return out[:limit]
    except Exception:
        return []


# --- Hotels out-of-pocket: AwardTool (cash + points) + SerpAPI (cash) ---


def optimize_hotels_out_of_pocket(
    destination: str,
    check_in: str,
    check_out: str,
    programs: Optional[List[str]] = None,
    guests: int = 1,
    hotel_class: Optional[str] = None,
    top: int = 15,
) -> Dict[str, Any]:
    """
    Minimize hotel out-of-pocket: AwardTool (cash + points + surcharge) and SerpAPI Google Hotels (cash).
    Out-of-pocket = min(cash, surcharge) when points available, else cash.
    Returns: { best_by_cash, best_by_points, best_overall, options, destination, check_in, check_out }
    """
    # Resolve airport codes to city names for hotel search
    destination = _resolve_airport_code_to_city(destination)

    options: List[Dict[str, Any]] = []

    # 1) AwardTool: cash, points, surcharge
    try:
        from src.handlers.hotels import search_hotels

        award_rows = search_hotels(
            destination=destination,
            check_in=check_in,
            check_out=check_out,
            programs=programs,
            guests=guests,
            hotel_class=hotel_class,
        )
        for h in award_rows or []:
            cash = h.get("cash_cost")
            pts = h.get("points_cost")
            sur = h.get("surcharge")
            c = float(cash) if cash is not None else None
            p = int(pts) if pts is not None else None
            s = float(sur) if sur is not None else None
            oop = None
            if c is not None and s is not None and p is not None:
                oop = min(c, s)
            elif c is not None:
                oop = c
            elif s is not None:
                oop = s
            options.append({
                "name": h.get("name") or "",
                "cash": c,
                "points": p,
                "surcharge": s,
                "out_of_pocket": oop,
                "brand": h.get("brand") or h.get("program_code") or "",
                "source": "awardtool",
                "hotel_id": h.get("hotel_id"),
            })
    except Exception:
        pass

    # 2) SerpAPI Google Hotels: cash only
    serp = get_google_hotels(
        q=destination,
        check_in_date=check_in,
        check_out_date=check_out,
        adults=guests,
        sort_by=3,
        limit=top,
    )
    for h in serp or []:
        cash = h.get("cash_total") or h.get("cash_per_night")
        if cash is None:
            continue
        c = float(cash)
        options.append({
            "name": h.get("name") or "",
            "cash": c,
            "points": None,
            "surcharge": None,
            "out_of_pocket": c,
            "brand": "",
            "source": "google_hotels",
            "hotel_id": h.get("property_token"),
        })

    if not options:
        return {
            "best_by_cash": None,
            "best_by_points": None,
            "best_overall": None,
            "options": [],
            "destination": (destination or "").strip(),
            "check_in": (check_in or "").strip(),
            "check_out": (check_out or "").strip(),
        }

    by_cash = sorted(options, key=lambda x: (x["cash"] if x["cash"] is not None else 999999999, x["out_of_pocket"] or 999999999))
    by_points = sorted(
        options,
        key=lambda x: (
            x["surcharge"] if x["surcharge"] is not None else 999999999,
            x["cash"] if x["cash"] is not None else 999999999,
        ),
    )
    by_oop = sorted(options, key=lambda x: (x["out_of_pocket"] or 999999999, x["cash"] or 999999999))

    return {
        "best_by_cash": by_cash[0] if by_cash else None,
        "best_by_points": by_points[0] if by_points and by_points[0].get("surcharge") is not None else None,
        "best_overall": by_oop[0] if by_oop else None,
        "options": options[:top],
        "destination": (destination or "").strip(),
        "check_in": (check_in or "").strip(),
        "check_out": (check_out or "").strip(),
    }


# --- Google Maps Directions (SerpAPI) - Route Validation ---


def get_directions(
    origin: str,
    destination: str,
    travel_mode: int = 0,
    gl: str = "us",
    hl: str = "en",
) -> Optional[Dict[str, Any]]:
    """
    Check if a ground route exists between two locations using SerpAPI Google Maps Directions.
    
    Args:
        origin: Starting point (airport code, city name, or address)
        destination: Ending point (airport code, city name, or address)
        travel_mode: 0=Driving (default), 3=Transit, 2=Walking, 1=Cycling
        gl: Country code for localization
        hl: Language code
    
    Returns:
        Dict with route info if route exists, None if no route possible or on error.
        Response includes: places_info, directions (list of route options), durations
    """
    import logging
    logger = logging.getLogger(__name__)
    
    key = _serp_key()
    if not key:
        logger.warning("get_directions: No SERPAPI_KEY configured")
        return None
    
    o = (origin or "").strip()
    d = (destination or "").strip()
    if not o or not d or o.upper() == d.upper():
        return None
    
    # Convert IATA codes to more descriptive names for better Google Maps results
    # e.g., "JFK" -> "JFK Airport, New York"
    def _enhance_location(loc: str) -> str:
        loc_upper = loc.upper()
        # If it looks like an IATA code (3 uppercase letters), append "Airport"
        if len(loc_upper) == 3 and loc_upper.isalpha():
            return f"{loc_upper} Airport"
        return loc
    
    origin_enhanced = _enhance_location(o)
    destination_enhanced = _enhance_location(d)
    
    params: Dict[str, Any] = {
        "engine": "google_maps_directions",
        "start_addr": origin_enhanced,
        "end_addr": destination_enhanced,
        "travel_mode": str(travel_mode),
        "gl": gl or "us",
        "hl": hl or "en",
        "api_key": key,
    }
    
    try:
        search = GoogleSearch(params)
        data = search.get_dict()
        
        # Check if we got valid directions
        if not data:
            logger.debug("get_directions [%s]->[%s]: No data returned", o, d)
            return None
        
        # Check for error in response
        if data.get("error"):
            logger.debug("get_directions [%s]->[%s]: API error: %s", o, d, data.get("error"))
            return None
        
        # Check if directions array exists and has content
        directions = data.get("directions") or []
        if not directions:
            logger.debug("get_directions [%s]->[%s]: No route found (empty directions)", o, d)
            return None
        
        # Filter out flight-only directions (travel_mode == 4 is Flight)
        # We only want ground routes (Driving, Transit, Walking, Cycling)
        ground_directions = [
            d for d in directions 
            if d.get("travel_mode", "").lower() not in ("flight",)
        ]
        
        if not ground_directions:
            logger.debug("get_directions [%s]->[%s]: Only flight routes available (no ground route)", o, d)
            return None
        
        logger.info("get_directions [%s]->[%s]: Found %d ground route(s)", o, d, len(ground_directions))
        
        return {
            "places_info": data.get("places_info") or [],
            "directions": ground_directions,
            "durations": data.get("durations") or [],
            "search_metadata": data.get("search_metadata") or {},
        }
        
    except Exception as e:
        logger.warning("get_directions [%s]->[%s]: Exception: %s", o, d, e)
        return None
