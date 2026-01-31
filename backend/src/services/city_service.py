"""
City/Airport search and suggestions using Amadeus API

OPTIMIZED: Added response caching to reduce Amadeus API calls.
"""

import os
import logging
import time
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv()

# Configure logger
logger = logging.getLogger(__name__)

# Response cache with TTL for city search results
_city_search_cache: Dict[str, Tuple[List[Dict[str, Any]], float]] = {}
_CITY_CACHE_TTL_SECONDS = 300  # 5 minutes


def _get_cached_city_response(cache_key: str) -> Optional[List[Dict[str, Any]]]:
    """Get city search response from cache if not expired."""
    if cache_key in _city_search_cache:
        results, timestamp = _city_search_cache[cache_key]
        if time.time() - timestamp < _CITY_CACHE_TTL_SECONDS:
            return results
        del _city_search_cache[cache_key]
    return None


def _set_cached_city_response(cache_key: str, results: List[Dict[str, Any]]):
    """Store city search response in cache."""
    if len(_city_search_cache) > 500:
        sorted_keys = sorted(_city_search_cache.keys(), key=lambda k: _city_search_cache[k][1])
        for key in sorted_keys[:250]:
            del _city_search_cache[key]
    _city_search_cache[cache_key] = (results, time.time())


def get_amadeus_client():
    """Get Amadeus API client"""
    try:
        from amadeus import Client as Amadeus
    except ImportError:
        logger.error("amadeus package not installed. Install with: pip install amadeus")
        raise ImportError(
            "amadeus package not installed. Install with: pip install amadeus"
        )

    client_id = os.getenv("AMADEUS_CLIENT_ID")
    client_secret = os.getenv("AMADEUS_CLIENT_SECRET")

    if not client_id or not client_secret:
        # Return None if credentials not available - allow graceful degradation
        logger.warning(
            "AMADEUS_CLIENT_ID or AMADEUS_CLIENT_SECRET not set in environment variables"
        )
        return None

    try:
        return Amadeus(client_id=client_id, client_secret=client_secret)
    except Exception as e:
        logger.error(f"Failed to create Amadeus client: {e}")
        raise


# Fallback popular cities/airports if Amadeus API is unavailable
FALLBACK_CITIES = [
    {
        "id": "JFK",
        "name": "New York (JFK)",
        "iataCode": "JFK",
        "type": "AIRPORT",
        "cityName": "New York",
        "countryName": "United States",
    },
    {
        "id": "LGA",
        "name": "New York (LGA)",
        "iataCode": "LGA",
        "type": "AIRPORT",
        "cityName": "New York",
        "countryName": "United States",
    },
    {
        "id": "CDG",
        "name": "Paris (CDG)",
        "iataCode": "CDG",
        "type": "AIRPORT",
        "cityName": "Paris",
        "countryName": "France",
    },
    {
        "id": "ORY",
        "name": "Paris (ORY)",
        "iataCode": "ORY",
        "type": "AIRPORT",
        "cityName": "Paris",
        "countryName": "France",
    },
    {
        "id": "LHR",
        "name": "London (LHR)",
        "iataCode": "LHR",
        "type": "AIRPORT",
        "cityName": "London",
        "countryName": "United Kingdom",
    },
    {
        "id": "LGW",
        "name": "London (LGW)",
        "iataCode": "LGW",
        "type": "AIRPORT",
        "cityName": "London",
        "countryName": "United Kingdom",
    },
    {
        "id": "LAX",
        "name": "Los Angeles (LAX)",
        "iataCode": "LAX",
        "type": "AIRPORT",
        "cityName": "Los Angeles",
        "countryName": "United States",
    },
    {
        "id": "SFO",
        "name": "San Francisco (SFO)",
        "iataCode": "SFO",
        "type": "AIRPORT",
        "cityName": "San Francisco",
        "countryName": "United States",
    },
    {
        "id": "NRT",
        "name": "Tokyo (NRT)",
        "iataCode": "NRT",
        "type": "AIRPORT",
        "cityName": "Tokyo",
        "countryName": "Japan",
    },
    {
        "id": "HND",
        "name": "Tokyo (HND)",
        "iataCode": "HND",
        "type": "AIRPORT",
        "cityName": "Tokyo",
        "countryName": "Japan",
    },
    {
        "id": "DXB",
        "name": "Dubai (DXB)",
        "iataCode": "DXB",
        "type": "AIRPORT",
        "cityName": "Dubai",
        "countryName": "United Arab Emirates",
    },
    {
        "id": "FCO",
        "name": "Rome (FCO)",
        "iataCode": "FCO",
        "type": "AIRPORT",
        "cityName": "Rome",
        "countryName": "Italy",
    },
    {
        "id": "BCN",
        "name": "Barcelona (BCN)",
        "iataCode": "BCN",
        "type": "AIRPORT",
        "cityName": "Barcelona",
        "countryName": "Spain",
    },
    {
        "id": "MAD",
        "name": "Madrid (MAD)",
        "iataCode": "MAD",
        "type": "AIRPORT",
        "cityName": "Madrid",
        "countryName": "Spain",
    },
    {
        "id": "AMS",
        "name": "Amsterdam (AMS)",
        "iataCode": "AMS",
        "type": "AIRPORT",
        "cityName": "Amsterdam",
        "countryName": "Netherlands",
    },
    {
        "id": "FRA",
        "name": "Frankfurt (FRA)",
        "iataCode": "FRA",
        "type": "AIRPORT",
        "cityName": "Frankfurt",
        "countryName": "Germany",
    },
    {
        "id": "MUC",
        "name": "Munich (MUC)",
        "iataCode": "MUC",
        "type": "AIRPORT",
        "cityName": "Munich",
        "countryName": "Germany",
    },
    {
        "id": "IST",
        "name": "Istanbul (IST)",
        "iataCode": "IST",
        "type": "AIRPORT",
        "cityName": "Istanbul",
        "countryName": "Turkey",
    },
    {
        "id": "SYD",
        "name": "Sydney (SYD)",
        "iataCode": "SYD",
        "type": "AIRPORT",
        "cityName": "Sydney",
        "countryName": "Australia",
    },
    {
        "id": "SIN",
        "name": "Singapore (SIN)",
        "iataCode": "SIN",
        "type": "AIRPORT",
        "cityName": "Singapore",
        "countryName": "Singapore",
    },
]


def _filter_fallback_cities(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """Filter fallback cities by query (for when Amadeus API is unavailable)"""
    query_lower = query.lower().strip()
    if not query_lower:
        return []

    results = []
    for city in FALLBACK_CITIES:
        city_name = city.get("cityName", "").lower()
        country_name = city.get("countryName", "").lower()
        iata_code = city.get("iataCode", "").lower()
        display_name = city.get("name", "").lower()

        if (
            query_lower in city_name
            or query_lower in country_name
            or query_lower in iata_code
            or query_lower in display_name
        ):
            results.append(city.copy())
            if len(results) >= max_results:
                break

    return results


def search_cities(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search for cities/airports using Amadeus Airport & City Search API
    Returns all airports for each city, so typing "Paris" shows CDG, ORY, etc.

    Args:
        query: Search query (city name, airport code, or partial name)
        max_results: Maximum number of results to return

    Returns:
        List of city/airport dictionaries with id, name, iataCode, etc.
        Grouped by city to show all airports for each city.
        
    OPTIMIZED: Results are cached for 5 minutes to reduce API calls.
    """
    # Check cache first
    cache_key = f"city:{query.lower().strip()}:{max_results}"
    cached = _get_cached_city_response(cache_key)
    if cached is not None:
        logger.debug(f"Cache hit for city search: '{query}'")
        return cached
    
    try:
        amadeus = get_amadeus_client()
        if not amadeus:
            # Graceful degradation - use fallback cities if Amadeus not configured
            logger.info(
                f"Amadeus not configured, using fallback cities for query '{query}'"
            )
            return _filter_fallback_cities(query, max_results)

        # Increase the API call limit to get more results, then filter/group
        # Amadeus API allows up to 100 results
        api_max = min(100, max_results * 3)  # Get more to account for grouping

        # Use Amadeus Airport & City Search API
        # Search for both cities and airports
        try:
            # Try with subType parameter first (if supported)
            response = amadeus.reference_data.locations.get(
                keyword=query,
                max=api_max,
                subType="AIRPORT,CITY",  # Explicitly request both airports and cities
            )
        except Exception as e:
            logger.warning(
                f"Amadeus API call with subType failed: {e}, trying without subType"
            )
            # Fallback if subType is not supported
            try:
                response = amadeus.reference_data.locations.get(
                    keyword=query,
                    max=api_max,
                )
            except Exception as e2:
                logger.error(f"Amadeus API call failed: {e2}, using fallback cities")
                # Use fallback if API fails
                return _filter_fallback_cities(query, max_results)

        if not response.data:
            logger.warning(
                f"Amadeus API returned no data for query '{query}', using fallback cities"
            )
            # Use fallback if API returns no data
            return _filter_fallback_cities(query, max_results)

        # Import airport filter to validate commercial airports
        # OPTIMIZED: Uses cached commercial set instead of loading on every request
        commercial_set = None
        try:
            from ..handlers.airport_filter import (
                is_commercial_airport,
                get_commercial_airport_set,
            )

            # Use the cached commercial set (loaded once at startup)
            if response.data:
                commercial_set = get_commercial_airport_set()
        except Exception as e:
            # If airport filter fails, continue without filtering
            commercial_set = None
            logger.warning(
                f"Could not load commercial airport filter, showing all airports: {e}"
            )

        # Group results by city name to collect all airports per city
        city_groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        airport_results = []
        city_results = []

        for item in response.data:
            item_type = item.get("type", "").upper()
            iata_code = item.get("iataCode", "")

            # Skip if it's an airport without a valid IATA code
            if item_type == "AIRPORT" and (not iata_code or len(iata_code) != 3):
                continue

            # Filter airports - only include commercial airports if filter is available
            if item_type == "AIRPORT" and commercial_set:
                if not is_commercial_airport(iata_code, commercial_set):
                    continue

            formatted = {
                "id": iata_code or item.get("id", ""),
                "name": item.get("name", ""),
                "iataCode": iata_code,
                "type": item.get("type", "location"),
            }

            # Add address information if available
            city_name = None
            if "address" in item:
                address = item["address"]
                city_name = address.get("cityName", "")
                formatted["cityName"] = city_name
                formatted["countryName"] = address.get("countryName", "")
                formatted["regionCode"] = address.get("regionCode", "")
            elif item_type == "CITY":
                # For cities, use the name as cityName
                city_name = item.get("name", "")
                formatted["cityName"] = city_name

            if item_type == "AIRPORT":
                # Group airports by city name
                if city_name:
                    city_groups[city_name.lower()].append(formatted)
                else:
                    # If no city name, add directly
                    airport_results.append(formatted)
            elif item_type == "CITY":
                city_results.append(formatted)

        # Build final results list
        results = []
        seen_cities = set()

        # If we have grouped airports, process them
        if city_groups:
            # Prioritize: airports grouped by city first, then cities, then standalone airports
            # Group airports by city and format as "City Name (AIRPORT)"
            for city_name_lower, airports in city_groups.items():
                if city_name_lower not in seen_cities:
                    seen_cities.add(city_name_lower)

                    # Get the city name from first airport (they should all have same city)
                    city_name = airports[0].get("cityName", city_name_lower.title())
                    country = airports[0].get("countryName", "")

                    # Sort airports by IATA code
                    airports_sorted = sorted(
                        airports, key=lambda x: x.get("iataCode", "")
                    )

                    # Add each airport as a separate result with city name prefix
                    for airport in airports_sorted:
                        iata = airport.get("iataCode", "")
                        airport_name = airport.get("name", "")

                        # Format as "City Name (IATA)" for display
                        display_name = f"{city_name} ({iata})" if iata else city_name

                        results.append(
                            {
                                "id": iata or airport.get("id", ""),
                                "name": display_name,
                                "iataCode": iata,
                                "type": "AIRPORT",
                                "cityName": city_name,
                                "countryName": country,
                                "regionCode": airport.get("regionCode", ""),
                                "originalName": airport_name,  # Keep original airport name for reference
                            }
                        )

                        if len(results) >= max_results:
                            break

                    if len(results) >= max_results:
                        break

        # Add city results if we haven't hit the limit
        for city in city_results:
            if len(results) >= max_results:
                break
            city_name_lower = city.get("cityName", city.get("name", "")).lower()
            if city_name_lower not in seen_cities:
                seen_cities.add(city_name_lower)
                results.append(city)

        # Add standalone airports if we haven't hit the limit
        for airport in airport_results:
            if len(results) >= max_results:
                break
            results.append(airport)

        # Fallback: If we have no grouped results but have raw response data,
        # format it simply without grouping (original behavior)
        if not results and response.data:
            logger.warning(
                f"Grouping produced no results, falling back to simple formatting for query '{query}'"
            )
            for item in response.data[:max_results]:
                iata_code = item.get("iataCode", "")
                formatted = {
                    "id": iata_code or item.get("id", ""),
                    "name": item.get("name", ""),
                    "iataCode": iata_code,
                    "type": item.get("type", "location"),
                }

                if "address" in item:
                    address = item["address"]
                    formatted["cityName"] = address.get("cityName", "")
                    formatted["countryName"] = address.get("countryName", "")
                    formatted["regionCode"] = address.get("regionCode", "")

                results.append(formatted)

        # Final fallback: If still no results, use fallback cities
        if not results:
            logger.info(
                f"No results from Amadeus API for query '{query}', using fallback cities"
            )
            fallback_results = _filter_fallback_cities(query, max_results)
            _set_cached_city_response(cache_key, fallback_results)
            return fallback_results

        final_results = results[:max_results]
        _set_cached_city_response(cache_key, final_results)
        return final_results

    except Exception as e:
        # Log error details for debugging
        logger.error(f"City search error for query '{query}': {e}", exc_info=True)
        # Use fallback cities on error instead of returning empty list
        logger.info(f"Using fallback cities due to error for query '{query}'")
        fallback_results = _filter_fallback_cities(query, max_results)
        _set_cached_city_response(cache_key, fallback_results)
        return fallback_results


def _normalize_city_key(city_name: str, country_name: str) -> str:
    """Create a stable city_id from city and country."""
    city = (city_name or "").strip()
    country = (country_name or "").strip()
    return f"{city},{country}" if city and country else city


def search_cities_for_autocomplete(
    query: str, max_results: int = 10
) -> List[Dict[str, Any]]:
    """
    Return city suggestions for autocomplete:
    [{ city_id, name, region, country, lat, lng }]

    This wraps search_cities() and groups results by city.
    """
    raw = search_cities(query, max_results * 3)
    if not raw:
        return []

    suggestions: Dict[str, Dict[str, Any]] = {}
    for item in raw:
        city_name = item.get("cityName") or item.get("name") or ""
        country = item.get("countryName") or ""
        region = item.get("regionCode") or ""
        if not city_name:
            continue

        key = _normalize_city_key(city_name, country)
        if key in suggestions:
            continue

        suggestions[key] = {
            "city_id": key,
            "name": city_name,
            "region": region,
            "country": country,
            "lat": None,
            "lng": None,
        }

        if len(suggestions) >= max_results:
            break

    return list(suggestions.values())


def get_nearby_airports(city_id: str, limit: int = 3) -> List[Dict[str, Any]]:
    """
    Return nearby airports for a city:
    [{ iata, name, lat, lng, distance_km }]

    For now we approximate by:
    - Parsing city_id as 'City,Country'
    - Taking airports from search_cities() whose cityName matches the city.
    """
    if not city_id:
        return []

    if "," in city_id:
        city_name, _country = [part.strip() for part in city_id.split(",", 1)]
    else:
        city_name = city_id.strip()

    if not city_name:
        return []

    raw = search_cities(city_name, max_results=50)
    if not raw:
        return []

    airports: List[Dict[str, Any]] = []
    city_lower = city_name.lower()

    for item in raw:
        if item.get("type", "").upper() != "AIRPORT":
            continue

        iata = item.get("iataCode") or item.get("id", "")
        if not iata or len(iata) != 3:
            continue

        item_city = (item.get("cityName") or "").strip().lower()
        if item_city and item_city != city_lower:
            continue

        airports.append(
            {
                "iata": iata,
                "name": item.get("name", ""),
                "lat": None,
                "lng": None,
                "distance_km": None,
            }
        )

    # Fallback to airports from fallback list if none matched (commercial only)
    if not airports:
        commercial_set = None
        try:
            from ..handlers.airport_filter import (
                is_commercial_airport,
                get_commercial_airport_set,
            )
            commercial_set = get_commercial_airport_set()
        except Exception as e:
            logger.warning(
                f"Could not load commercial airport filter for get_nearby_airports fallback: {e}"
            )
        for item in FALLBACK_CITIES:
            if (item.get("cityName") or "").strip().lower() != city_lower:
                continue
            iata = item.get("iataCode") or item.get("id", "")
            if not iata or len(iata) != 3:
                continue
            if commercial_set is not None and not is_commercial_airport(iata, commercial_set):
                continue
            airports.append(
                {
                    "iata": iata,
                    "name": item.get("name", ""),
                    "lat": None,
                    "lng": None,
                    "distance_km": None,
                }
            )

    return airports[:limit]
