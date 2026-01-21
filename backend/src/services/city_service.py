"""
City/Airport search and suggestions using Amadeus API
"""
import os
import logging
from typing import List, Dict, Any, Optional
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
        raise ImportError("amadeus package not installed. Install with: pip install amadeus")
    
    client_id = os.getenv("AMADEUS_CLIENT_ID")
    client_secret = os.getenv("AMADEUS_CLIENT_SECRET")
    
    if not client_id or not client_secret:
        # Return None if credentials not available - allow graceful degradation
        logger.warning("AMADEUS_CLIENT_ID or AMADEUS_CLIENT_SECRET not set in environment variables")
        return None
    
    try:
        return Amadeus(client_id=client_id, client_secret=client_secret)
    except Exception as e:
        logger.error(f"Failed to create Amadeus client: {e}")
        raise


def search_cities(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search for cities/airports using Amadeus Airport & City Search API
    
    Args:
        query: Search query (city name, airport code, or partial name)
        max_results: Maximum number of results to return
        
    Returns:
        List of city/airport dictionaries with id, name, iataCode, etc.
    """
    try:
        amadeus = get_amadeus_client()
        if not amadeus:
            # Graceful degradation - return empty list if Amadeus not configured
            return []
        
        # Use Amadeus Airport & City Search API
        # Search for both cities and airports
        response = amadeus.reference_data.locations.get(
            keyword=query,
            max=max_results,
        )
        
        if not response.data:
            return []
        
        # Format results
        results = []
        for item in response.data:
            formatted = {
                "id": item.get("iataCode") or item.get("id", ""),
                "name": item.get("name", ""),
                "iataCode": item.get("iataCode", ""),
                "type": item.get("type", "location"),
            }
            
            # Add address information if available
            if "address" in item:
                address = item["address"]
                formatted["cityName"] = address.get("cityName", "")
                formatted["countryName"] = address.get("countryName", "")
                formatted["regionCode"] = address.get("regionCode", "")
            
            results.append(formatted)
        
        return results
    
    except Exception as e:
        # Log error details for debugging
        logger.error(f"City search error for query '{query}': {e}", exc_info=True)
        # Return empty list on error to allow graceful degradation
        return []
