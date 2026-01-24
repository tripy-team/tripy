"""
Airport Service - CSV-based airport search and autocomplete
Reads from airports.csv file and provides search functionality
"""
import csv
import os
from typing import List, Dict, Any, Optional
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

# Path to airports.csv file
AIRPORTS_CSV_PATH = Path(__file__).parent.parent.parent / "files" / "airports.csv"

# Cache for loaded airports
_airports_cache: Optional[List[Dict[str, Any]]] = None

# Cache for commercial airport set
_commercial_airport_set: Optional[set] = None


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
    Score an airport based on how well it matches the query
    Higher score = better match
    """
    query_upper = normalize_query(query)
    iata = airport.get("iata_code", "").upper()
    airport_name = (airport.get("airport_name") or "").upper()
    city = (airport.get("city") or "").upper()
    country = (airport.get("country_name") or "").upper()
    
    score = 0.0
    
    # Exact IATA code match (highest priority)
    if query_upper == iata:
        score += 1000.0
    
    # IATA code starts with query
    elif iata.startswith(query_upper):
        score += 700.0
    
    # Airport name starts with query
    elif airport_name.startswith(query_upper):
        score += 500.0
    
    # City name starts with query
    elif city.startswith(query_upper):
        score += 450.0
    
    # Contains matches
    if query_upper in iata:
        score += 300.0
    if query_upper in airport_name:
        score += 250.0
    if query_upper in city:
        score += 200.0
    if query_upper in country:
        score += 150.0
    
    # Boost for large airports (more popular)
    airport_type = airport.get("type", "")
    if airport_type == "large_airport":
        score += 50.0
    elif airport_type == "medium_airport":
        score += 25.0
    
    return score


def _get_commercial_airport_set() -> set:
    """
    Load and cache the set of commercial airport IATA codes.
    Uses the airport_filter module to determine commercial airports.
    """
    global _commercial_airport_set
    
    if _commercial_airport_set is not None:
        return _commercial_airport_set
    
    try:
        from ..handlers.airport_filter import load_commercial_iata_set_from_web
        _commercial_airport_set = load_commercial_iata_set_from_web()
        logger.info(f"Loaded {len(_commercial_airport_set)} commercial airports")
        return _commercial_airport_set
    except Exception as e:
        logger.warning(f"Failed to load commercial airport set: {e}. Showing all airports.")
        # Return empty set to disable filtering if loading fails
        _commercial_airport_set = set()
        return _commercial_airport_set


def search_airports(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search airports based on query string using OpenAI.
    Returns list of commercial airport dictionaries matching the query.
    For city queries (e.g., "nyc", "New York"), returns all airports for that city.
    Only includes commercial airports (with scheduled service).
    """
    if not query or not query.strip():
        logger.debug(f"Empty query provided to search_airports")
        return []
    
    query_normalized = query.strip()
    
    # Check if query looks like an airport code (3 letters, all caps or mixed)
    is_airport_code = len(query_normalized) == 3 and query_normalized.replace(" ", "").isalpha()
    
    try:
        # Use OpenAI to find airports for the query
        from ..handlers.openAI import find_commercial_airports_for_city, search_airports_with_openai
        
        # If it's a 3-letter code, try direct airport search first
        if is_airport_code:
            # Try direct airport code search
            airports = search_airports_with_openai(query_normalized.upper(), max_results=max_results)
            # Do NOT filter by commercial_set for explicit IATA queries: SerpAPI and AwardTool
            # support small/regional airports (e.g. ITH, BGM) with multistop and multi-airline;
            # filtering here would hide them in autocomplete.
            if airports:
                logger.info(f"Found {len(airports)} airports for code '{query_normalized}' (small airports allowed)")
                return airports[:max_results]
        
        # For city queries, use the city-based search
        airports = find_commercial_airports_for_city(query_normalized, max_results=max_results)
        
        if airports:
            logger.info(f"Found {len(airports)} commercial airports for city '{query_normalized}'")
            return airports[:max_results]
        else:
            # Fallback to general airport search
            airports = search_airports_with_openai(query_normalized, max_results=max_results)
            # Filter for commercial airports
            commercial_set = _get_commercial_airport_set()
            if commercial_set:
                airports = [a for a in airports if a.get("iata_code", "").upper() in commercial_set]
            
            logger.info(f"Found {len(airports)} commercial airports for query '{query_normalized}' (fallback)")
            return airports[:max_results]
            
    except Exception as e:
        logger.error(f"Error searching airports with OpenAI for query '{query}': {e}", exc_info=True)
        # Fallback to CSV-based search if OpenAI fails
        airports = load_airports_from_csv()
        if not airports:
            logger.warning(f"No airports loaded from CSV for query: {query}")
            return []
        
        commercial_set = _get_commercial_airport_set()
        query_normalized_upper = normalize_query(query)
        
        scored_airports = []
        for airport in airports:
            iata_code = airport.get("iata_code", "")
            # For explicit IATA queries, skip commercial filter so small airports (e.g. ITH) are findable
            if commercial_set and not is_airport_code and iata_code not in commercial_set:
                continue

            score = score_airport(airport, query_normalized_upper)
            if score > 0:
                scored_airports.append((score, airport))
        
        scored_airports.sort(key=lambda x: (-x[0], x[1]["iata_code"]))
        
        results = []
        for score, airport in scored_airports[:max_results]:
            result = {
                "airport_id": f"{airport['iata_code']},{airport.get('city', '')},{airport.get('country_name', '')}",
                "iata_code": airport["iata_code"],
                "airport_name": airport["airport_name"],
                "city": airport["city"],
                "country": airport["country_name"],
                "region": airport.get("state") or airport.get("country", ""),
                "display_name": f"{airport['iata_code']} - {airport['airport_name']}",
            }
            if airport.get("city"):
                result["display_name"] += f" ({airport['city']})"
            results.append(result)
        
        logger.info(f"Found {len(results)} commercial airports matching query '{query}' (CSV fallback)")
        return results


def fuzzy_search_destinations(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Fuzzy destination search over CSV airports. Use as fallback when SerpAPI autocomplete is empty.
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

    def choice_text(a: Dict) -> str:
        return " ".join(
            filter(None, [a.get("airport_name"), a.get("iata_code"), a.get("city"), a.get("country_name")])
        )

    choices = {choice_text(a): a for a in airports if choice_text(a)}
    if not choices:
        return []

    matches = process.extract(q, list(choices.keys()), scorer=fuzz.token_set_ratio, limit=max_results)
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for _text, score, _ in matches:
        if score < 40:
            continue
        a = choices[_text]
        iata = a.get("iata_code") or ""
        if iata in seen:
            continue
        seen.add(iata)
        out.append({
            "name": a.get("airport_name") or "",
            "type": "airport",
            "id": iata,
            "description": (a.get("city") or "") + ", " + (a.get("country_name") or ""),
            "airports": [{"id": iata, "name": a.get("airport_name") or "", "city": a.get("city") or ""}],
        })
    return out[:max_results]
