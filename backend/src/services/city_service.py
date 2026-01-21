"""
City/Airport search and suggestions using Amadeus API
"""

import os
import logging
from typing import List, Dict, Any, Optional
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv()

# Configure logger
logger = logging.getLogger(__name__)


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
    """
    try:
        amadeus = get_amadeus_client()
        if not amadeus:
            # Graceful degradation - return empty list if Amadeus not configured
            return []

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
        except Exception:
            # Fallback if subType is not supported
            response = amadeus.reference_data.locations.get(
                keyword=query,
                max=api_max,
            )

        if not response.data:
            return []

        # Import airport filter to validate commercial airports
        try:
            from ..handlers.airport_filter import (
                is_commercial_airport,
                load_commercial_iata_set_from_web,
            )

            commercial_set = load_commercial_iata_set_from_web()
        except Exception:
            # If airport filter fails, continue without filtering
            commercial_set = None
            logger.warning(
                "Could not load commercial airport filter, showing all airports"
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

        # Prioritize: airports grouped by city first, then cities, then standalone airports
        # Group airports by city and format as "City Name (AIRPORT)"
        for city_name_lower, airports in city_groups.items():
            if city_name_lower not in seen_cities:
                seen_cities.add(city_name_lower)

                # Get the city name from first airport (they should all have same city)
                city_name = airports[0].get("cityName", city_name_lower.title())
                country = airports[0].get("countryName", "")

                # Sort airports by IATA code
                airports_sorted = sorted(airports, key=lambda x: x.get("iataCode", ""))

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

        return results[:max_results]

    except Exception as e:
        # Log error details for debugging
        logger.error(f"City search error for query '{query}': {e}", exc_info=True)
        # Return empty list on error to allow graceful degradation
        return []
