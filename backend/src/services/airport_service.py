"""
Airport Service - CSV-based airport search and autocomplete
Reads from airports.csv file and provides search functionality.
Uses is_commercial_airport to exclude non-commercial airports (e.g. FXL).

OPTIMIZED: Pre-built search indexes for fast prefix matching and response caching.
"""
import csv
import os
import threading
from collections import defaultdict
from functools import lru_cache
from typing import List, Dict, Any, Optional, Set, Tuple
from pathlib import Path
import logging
import time

from ..handlers.airport_filter import is_commercial_airport, get_commercial_airport_set

logger = logging.getLogger(__name__)

# Path to airports.csv file
AIRPORTS_CSV_PATH = Path(__file__).parent.parent.parent / "files" / "airports.csv"

# Cache for loaded airports
_airports_cache: Optional[List[Dict[str, Any]]] = None

# Optimized search indexes - built once at startup
_iata_index: Dict[str, Dict[str, Any]] = {}  # IATA code -> airport
_city_prefix_index: Dict[str, List[Dict[str, Any]]] = defaultdict(list)  # City prefix -> airports
_airport_name_prefix_index: Dict[str, List[Dict[str, Any]]] = defaultdict(list)  # Airport name prefix -> airports
_indexes_built = False
_index_lock = threading.Lock()

# Response cache with TTL
_response_cache: Dict[str, Tuple[List[Dict[str, Any]], float]] = {}
_CACHE_TTL_SECONDS = 300  # 5 minutes


def normalize_query(query: str) -> str:
    """Normalize search query for matching"""
    return query.strip().upper()


def load_airports_from_csv() -> List[Dict[str, Any]]:
    """
    Load airports from CSV file and cache them
    Returns list of airport dictionaries
    """
    global _airports_cache
    
    if _airports_cache is not None:
        return _airports_cache
    
    airports = []
    
    if not AIRPORTS_CSV_PATH.exists():
        logger.error(f"Airports CSV file not found at {AIRPORTS_CSV_PATH}")
        logger.error(f"Current working directory: {os.getcwd()}")
        logger.error(f"__file__ location: {__file__}")
        logger.error(f"Resolved path: {AIRPORTS_CSV_PATH.resolve()}")
        return []
    
    try:
        with open(AIRPORTS_CSV_PATH, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                iata_code = (row.get("iata_code") or "").strip().upper()

                # Only include airports with valid IATA codes (3 letters)
                if not iata_code or len(iata_code) != 3:
                    continue

                # Keep all airports with an IATA code – we'll rely on scoring
                # to surface the most relevant ones rather than filtering here.
                airport_type = (row.get("type") or "").strip().lower()

                airport = {
                    "iata_code": iata_code,
                    "airport_name": (row.get("name") or "").strip(),
                    "city": (row.get("municipality") or "").strip(),
                    "state": (row.get("iso_region") or "").strip().replace("US-", ""),
                    "country": (row.get("iso_country") or "").strip(),
                    "country_name": _get_country_name(row.get("iso_country") or ""),
                    "latitude": _safe_float(row.get("latitude_deg")),
                    "longitude": _safe_float(row.get("longitude_deg")),
                    "type": airport_type,
                }
                airports.append(airport)
        
        logger.info(f"Loaded {len(airports)} airports from CSV at {AIRPORTS_CSV_PATH}")
        if len(airports) == 0:
            logger.warning("No airports loaded from CSV - check file format and filters")
        _airports_cache = airports
        return airports
    
    except Exception as e:
        logger.error(f"Error loading airports from CSV: {e}", exc_info=True)
        return []


def _build_search_indexes():
    """
    Build optimized search indexes for fast prefix matching.
    Called once at startup.
    """
    global _iata_index, _city_prefix_index, _airport_name_prefix_index, _indexes_built
    
    if _indexes_built:
        return
    
    with _index_lock:
        if _indexes_built:
            return
        
        airports = load_airports_from_csv()
        commercial_set = get_commercial_airport_set()
        
        start_time = time.time()
        
        for airport in airports:
            iata = airport.get("iata_code", "").upper()
            city = (airport.get("city") or "").upper()
            airport_name = (airport.get("airport_name") or "").upper()
            
            # Skip non-commercial airports in index
            if commercial_set and not is_commercial_airport(iata, commercial_set):
                continue
            
            # Index by IATA code (exact lookup)
            _iata_index[iata] = airport
            
            # Index by city prefixes (for fast prefix search)
            for i in range(1, min(len(city) + 1, 8)):  # Index prefixes up to 7 chars
                prefix = city[:i]
                _city_prefix_index[prefix].append(airport)
            
            # Also index words within city names (e.g., "YORK" for "NEW YORK")
            for word in city.split():
                if len(word) >= 2:
                    for i in range(1, min(len(word) + 1, 6)):
                        prefix = word[:i]
                        if prefix not in _city_prefix_index or airport not in _city_prefix_index[prefix]:
                            _city_prefix_index[prefix].append(airport)
            
            # Index by airport name prefixes
            for i in range(1, min(len(airport_name) + 1, 6)):
                prefix = airport_name[:i]
                _airport_name_prefix_index[prefix].append(airport)
        
        _indexes_built = True
        elapsed = time.time() - start_time
        logger.info(f"Built search indexes in {elapsed:.3f}s: {len(_iata_index)} airports, {len(_city_prefix_index)} city prefixes")


def preload_airport_data():
    """
    Preload airport data and build search indexes.
    Call this at app startup.
    """
    def _preload():
        load_airports_from_csv()
        _build_search_indexes()
    
    thread = threading.Thread(target=_preload, daemon=True)
    thread.start()
    logger.info("Started background preload of airport data")


def _get_cached_response(cache_key: str) -> Optional[List[Dict[str, Any]]]:
    """Get response from cache if not expired."""
    if cache_key in _response_cache:
        results, timestamp = _response_cache[cache_key]
        if time.time() - timestamp < _CACHE_TTL_SECONDS:
            return results
        # Expired, remove from cache
        del _response_cache[cache_key]
    return None


def _set_cached_response(cache_key: str, results: List[Dict[str, Any]]):
    """Store response in cache with timestamp."""
    # Limit cache size to prevent memory issues
    if len(_response_cache) > 1000:
        # Remove oldest entries
        sorted_keys = sorted(_response_cache.keys(), key=lambda k: _response_cache[k][1])
        for key in sorted_keys[:500]:
            del _response_cache[key]
    
    _response_cache[cache_key] = (results, time.time())


def _safe_float(value: Optional[str]) -> Optional[float]:
    """Safely convert string to float"""
    if not value:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _get_country_name(country_code: str) -> str:
    """Get country name from ISO country code"""
    # Common country codes mapping
    country_map = {
        "US": "United States",
        "CA": "Canada",
        "GB": "United Kingdom",
        "FR": "France",
        "DE": "Germany",
        "IT": "Italy",
        "ES": "Spain",
        "NL": "Netherlands",
        "BE": "Belgium",
        "CH": "Switzerland",
        "AT": "Austria",
        "SE": "Sweden",
        "NO": "Norway",
        "DK": "Denmark",
        "FI": "Finland",
        "PL": "Poland",
        "CZ": "Czech Republic",
        "GR": "Greece",
        "PT": "Portugal",
        "IE": "Ireland",
        "AU": "Australia",
        "NZ": "New Zealand",
        "JP": "Japan",
        "CN": "China",
        "KR": "South Korea",
        "IN": "India",
        "BR": "Brazil",
        "MX": "Mexico",
        "AR": "Argentina",
        "CL": "Chile",
        "CO": "Colombia",
        "PE": "Peru",
        "ZA": "South Africa",
        "EG": "Egypt",
        "AE": "United Arab Emirates",
        "SA": "Saudi Arabia",
        "TR": "Turkey",
        "RU": "Russia",
        "TH": "Thailand",
        "SG": "Singapore",
        "MY": "Malaysia",
        "ID": "Indonesia",
        "PH": "Philippines",
        "VN": "Vietnam",
    }
    return country_map.get(country_code.upper(), country_code.upper())


def score_airport(airport: Dict[str, Any], query: str) -> float:
    """
    Score an airport based on how well it matches the query.
    Higher score = better match.
    Handles both city names and IATA codes with high sensitivity.
    """
    query_upper = normalize_query(query)
    iata = airport.get("iata_code", "").upper()
    airport_name = (airport.get("airport_name") or "").upper()
    city = (airport.get("city") or "").upper()
    country = (airport.get("country_name") or "").upper()
    state = (airport.get("state") or "").upper()
    
    score = 0.0
    
    # Exact IATA code match (highest priority)
    if query_upper == iata:
        score += 10000.0
    
    # Exact city name match (very high priority)
    elif query_upper == city:
        score += 9000.0
    
    # IATA code starts with query (e.g., "JF" matches "JFK")
    elif len(query_upper) >= 2 and iata.startswith(query_upper):
        score += 8000.0
    
    # City name starts with query (e.g., "San Fr" matches "San Francisco")
    elif city.startswith(query_upper):
        score += 7000.0
    
    # Airport name starts with query
    elif airport_name.startswith(query_upper):
        score += 6000.0
    
    # Query is contained in IATA code
    if query_upper in iata and len(query_upper) >= 2:
        score += 500.0
    
    # Query is contained in city name (case-insensitive word boundary matching)
    # This handles queries like "york" matching "New York"
    if query_upper in city:
        # Check if it's a word boundary match (more valuable)
        city_words = city.split()
        if any(word.startswith(query_upper) for word in city_words):
            score += 400.0
        else:
            score += 300.0
    
    # Query is contained in airport name
    if query_upper in airport_name:
        score += 250.0
    
    # Query matches country or state
    if query_upper in country:
        score += 100.0
    if query_upper in state:
        score += 80.0
    
    # Boost for large airports (more popular/useful)
    airport_type = airport.get("type", "")
    if airport_type == "large_airport":
        score += 100.0
    elif airport_type == "medium_airport":
        score += 50.0
    elif airport_type == "small_airport":
        score += 20.0
    
    return score


# Common city abbreviations/nicknames mapped to city names
CITY_NICKNAMES = {
    "NYC": "New York",
    "LA": "Los Angeles",
    "SF": "San Francisco",
    "DC": "Washington",
    "CHI": "Chicago",
    "PHX": "Phoenix",
    "PHI": "Philadelphia",
    "BOS": "Boston",
    "DFW": "Dallas",
    "SEA": "Seattle",
    "MIA": "Miami",
    "ATL": "Atlanta",
    "DEN": "Denver",
    "MSP": "Minneapolis",
    "DTW": "Detroit",
    "PDX": "Portland",
    "SAN": "San Diego",
    "TPA": "Tampa",
    "STL": "St. Louis",
    "BAL": "Baltimore",
    "LV": "Las Vegas",
    "NOLA": "New Orleans",
}

# City nickname expansions for multi-city searches
# When searching for a key, also include airports from the listed cities
# Note: Values must be <= 7 chars to match city prefix index (or exact city names <= 6 chars)
CITY_NICKNAME_EXPANSIONS = {
    "NYC": ["NEW YOR", "NEWARK"],  # NEW YOR matches "New York" airports (7 char index limit)
    "NEW YORK": ["NEW YOR", "NEWARK"],  # Include Newark (EWR) when searching "New York"
    "NEW YOR": ["NEW YOR", "NEWARK"],  # Handle partial typing
    "LA": ["LOS ANG"],  # Truncated to match index
    "SF": ["SAN FRANCISCO"],
    "DC": ["WASHINGTON"],
    "CHI": ["CHICAGO"],
    "PHX": ["PHOENIX"],
    "PHI": ["PHILADELPHIA"],
    "DFW": ["DALLAS", "FORT WORTH"],
    "BOS": ["BOSTON"],
    "SEA": ["SEATTLE"],
    "MIA": ["MIAMI"],
    "ATL": ["ATLANTA"],
    "DEN": ["DENVER"],
    "MSP": ["MINNEAPOLIS", "ST PAUL"],
    "DTW": ["DETROIT"],
    "PDX": ["PORTLAND"],
    "SAN": ["SAN DIEGO"],
    "TPA": ["TAMPA"],
    "STL": ["ST LOUIS", "SAINT LOUIS"],
    "BAL": ["BALTIMORE"],
    "LV": ["LAS VEGAS"],
    "NOLA": ["NEW ORLEANS"],
}

# Metro area airport mappings - airports that should be grouped under a different city name
# Key: IATA code, Value: city name to use for grouping
METRO_AREA_AIRPORT_CITY = {
    "EWR": "New York",  # Newark Liberty -> group with New York
}


def _format_airport_result(airport: Dict[str, Any]) -> Dict[str, Any]:
    """Format an airport dict into the standard result format."""
    iata_code = airport["iata_code"]
    # Use metro area city name if this airport should be grouped with a metro
    city = METRO_AREA_AIRPORT_CITY.get(iata_code, airport["city"])
    
    result = {
        "airport_id": f"{iata_code},{airport.get('city', '')},{airport.get('country_name', '')}",
        "iata_code": iata_code,
        "airport_name": airport["airport_name"],
        "city": city,  # Use mapped city for grouping
        "country": airport["country_name"],
        "region": airport.get("state") or airport.get("country", ""),
        "display_name": f"{iata_code} - {airport['airport_name']}",
    }
    if airport.get("city"):
        result["display_name"] += f" ({airport['city']})"  # Keep original city in display name
    return result


def _fast_search_with_indexes(query_upper: str, max_results: int) -> List[Dict[str, Any]]:
    """
    FAST PATH: Use pre-built indexes for quick results.
    Returns airports found via index lookup, scored and sorted.
    """
    # Ensure indexes are built
    if not _indexes_built:
        _build_search_indexes()
    
    candidates: Set[str] = set()  # Track by IATA to avoid duplicates
    candidate_airports: List[Dict[str, Any]] = []
    
    # 1. Exact IATA match (highest priority)
    if query_upper in _iata_index:
        candidate_airports.append(_iata_index[query_upper])
        candidates.add(query_upper)
    
    # 2. IATA prefix match
    for iata, airport in _iata_index.items():
        if iata.startswith(query_upper) and iata not in candidates:
            candidate_airports.append(airport)
            candidates.add(iata)
            if len(candidates) >= max_results * 2:
                break
    
    # 3. City prefix match (expand nicknames/metro areas)
    search_prefixes = [query_upper]
    
    # Check for exact match in expansions
    if query_upper in CITY_NICKNAME_EXPANSIONS:
        search_prefixes.extend(CITY_NICKNAME_EXPANSIONS[query_upper])
    else:
        # Also check if query is a prefix of any expansion key (e.g., "NEW YO" matches "NEW YORK")
        for key, expansions in CITY_NICKNAME_EXPANSIONS.items():
            if key.startswith(query_upper) and len(query_upper) >= 4:
                # Query is a prefix of a key - add the expansions
                for exp in expansions:
                    if exp not in search_prefixes:
                        search_prefixes.append(exp)
    
    for prefix in search_prefixes:
        if prefix in _city_prefix_index:
            for airport in _city_prefix_index[prefix]:
                iata = airport.get("iata_code", "")
                if iata not in candidates:
                    candidate_airports.append(airport)
                    candidates.add(iata)
                    if len(candidates) >= max_results * 3:
                        break
    
    # 4. Airport name prefix match
    if query_upper in _airport_name_prefix_index:
        for airport in _airport_name_prefix_index[query_upper]:
            iata = airport.get("iata_code", "")
            if iata not in candidates:
                candidate_airports.append(airport)
                candidates.add(iata)
                if len(candidates) >= max_results * 3:
                    break
    
    return candidate_airports


def search_airports(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search airports based on query string - handles both city names and IATA codes.
    Returns list of commercial airport dictionaries matching the query.
    
    OPTIMIZED: Uses pre-built indexes and response caching for fast results.
    """
    if not query or not query.strip():
        return []
    
    query_normalized = query.strip()
    query_upper = query_normalized.upper()
    
    # Check response cache first
    cache_key = f"search:{query_upper}:{max_results}"
    cached = _get_cached_response(cache_key)
    if cached is not None:
        return cached
    
    start_time = time.time()
    
    # FAST PATH: Try index-based search first
    try:
        # Use fast index lookup to get candidates
        candidate_airports = _fast_search_with_indexes(query_upper, max_results)
        
        if candidate_airports:
            # Score and sort candidates
            search_terms = [query_upper]
            if query_upper in CITY_NICKNAME_EXPANSIONS:
                search_terms.extend(CITY_NICKNAME_EXPANSIONS[query_upper])
            else:
                # Also check if query is a prefix of any expansion key
                for key, expansions in CITY_NICKNAME_EXPANSIONS.items():
                    if key.startswith(query_upper) and len(query_upper) >= 4:
                        for exp in expansions:
                            if exp not in search_terms:
                                search_terms.append(exp)
            
            scored_airports = []
            for airport in candidate_airports:
                max_score = 0.0
                for search_term in search_terms:
                    score = score_airport(airport, search_term)
                    max_score = max(max_score, score)
                if max_score > 0:
                    scored_airports.append((max_score, airport))
            
            # Sort by score (descending)
            scored_airports.sort(key=lambda x: (-x[0], x[1]["iata_code"]))
            
            results = [_format_airport_result(airport) for _, airport in scored_airports[:max_results]]
            
            if results:
                elapsed = time.time() - start_time
                logger.info(f"Fast index search found {len(results)} airports in {elapsed*1000:.1f}ms for '{query_normalized}'")
                _set_cached_response(cache_key, results)
                return results
    except Exception as e:
        logger.warning(f"Fast index search failed: {e}")
    
    # FALLBACK: Full scan with scoring (slower but more thorough)
    try:
        commercial_set = get_commercial_airport_set()
        airports = load_airports_from_csv()
        if not airports:
            logger.warning(f"No airports loaded from CSV")
            return []
        
        search_terms = [query_upper]
        if query_upper in CITY_NICKNAME_EXPANSIONS:
            search_terms.extend(CITY_NICKNAME_EXPANSIONS[query_upper])
        else:
            # Also check if query is a prefix of any expansion key
            for key, expansions in CITY_NICKNAME_EXPANSIONS.items():
                if key.startswith(query_upper) and len(query_upper) >= 4:
                    for exp in expansions:
                        if exp not in search_terms:
                            search_terms.append(exp)
        
        scored_airports = []
        for airport in airports:
            iata_code = airport.get("iata_code", "")
            # Skip non-commercial airports
            if commercial_set and not is_commercial_airport(iata_code, commercial_set):
                continue

            # Score against all search terms
            max_score = 0.0
            for search_term in search_terms:
                score = score_airport(airport, search_term)
                max_score = max(max_score, score)
            
            if max_score > 0:
                scored_airports.append((max_score, airport))
        
        scored_airports.sort(key=lambda x: (-x[0], x[1]["iata_code"]))
        
        if scored_airports:
            results = [_format_airport_result(airport) for _, airport in scored_airports[:max_results]]
            elapsed = time.time() - start_time
            logger.info(f"Full scan found {len(results)} airports in {elapsed*1000:.1f}ms for '{query_normalized}'")
            _set_cached_response(cache_key, results)
            return results
        
        logger.info(f"CSV search found no results for '{query_normalized}'")
        
    except Exception as e:
        logger.warning(f"CSV search failed for query '{query}': {e}")
    
    # No results found in CSV - return empty list
    # The CSV contains 40,000+ airports which covers all commercial airports with IATA codes
    # No need for OpenAI fallback which is slow, expensive, and can return incorrect results
    return []


def fuzzy_search_destinations(query: str, max_results: int = 10, commercial_only: bool = False) -> List[Dict[str, Any]]:
    """
    Fuzzy destination search over CSV airports. Use as fallback when SerpAPI autocomplete is empty.
    If commercial_only=True, only returns airports in the commercial set (scheduled_service + large/medium/small).
    Returns: [{ name, type, id, city, country, airports: [{ id, name, city }] }]
    """
    q = (query or "").strip()
    if not q:
        return []

    try:
        from rapidfuzz import fuzz, process
    except ImportError:
        return []

    airports = load_airports_from_csv()
    if not airports:
        return []

    commercial_set = None
    if commercial_only:
        try:
            from ..handlers.airport_filter import load_commercial_iata_set_from_web
            commercial_set = load_commercial_iata_set_from_web()
        except Exception:
            commercial_set = set()

    def _is_commercial(iata: str) -> bool:
        return bool(commercial_set and is_commercial_airport(iata, commercial_set))

    def choice_text(a: Dict) -> str:
        return " ".join(
            filter(None, [a.get("airport_name"), a.get("iata_code"), a.get("city"), a.get("country_name")])
        )

    choices = {choice_text(a): a for a in airports if choice_text(a)}
    if not choices:
        return []

    matches = process.extract(q, list(choices.keys()), scorer=fuzz.token_set_ratio, limit=max_results * 2)
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for _text, score, _ in matches:
        if score < 40:
            continue
        a = choices[_text]
        iata = (a.get("iata_code") or "").strip().upper()
        if iata in seen:
            continue
        if commercial_only and not _is_commercial(iata):
            continue
        seen.add(iata)
        out.append({
            "name": a.get("airport_name") or "",
            "type": "airport",
            "id": iata,
            "description": (a.get("city") or "") + ", " + (a.get("country_name") or ""),
            "airports": [{"id": iata, "name": a.get("airport_name") or "", "city": a.get("city") or ""}],
        })
        if len(out) >= max_results:
            break
    return out[:max_results]
