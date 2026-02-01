"""
Trip Mapper - Converts DynamoDB storage models to API response models

P0-1 Fix: Never return raw DynamoDB items with PK, SK, GSI attributes.
Always use this mapper to produce clean API responses.

Storage uses camelCase (tripId, createdAt, etc.)
API responses use snake_case (trip_id, created_at, etc.)
"""
import re
from typing import Dict, Any


# Fields that should NEVER be returned in API responses
INTERNAL_FIELDS = {
    "PK",
    "SK",
    "GSI1PK",
    "GSI1SK",
    "GSI2PK",
    "GSI2SK",
    "ttl",
    "entity_type",
    "optimizationCache",  # Internal cache data
}


def camel_to_snake(name: str) -> str:
    """Convert camelCase to snake_case."""
    # Handle edge cases
    if not name:
        return name
    # Insert underscore before uppercase letters and convert to lowercase
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


def storage_to_api(item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert a DynamoDB storage item to a clean API response.
    
    Removes:
    - PK, SK (partition/sort keys)
    - GSI*PK, GSI*SK (global secondary index keys)
    - ttl (time-to-live)
    - entity_type (internal typing)
    
    Converts keys from camelCase to snake_case.
    
    This ensures API consumers never see DynamoDB implementation details.
    """
    if not item:
        return {}
    
    return {
        camel_to_snake(key): value
        for key, value in item.items()
        if key not in INTERNAL_FIELDS
    }


def trip_storage_to_response(item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert a trip storage item to TripResponse format.
    
    Handles the specific mapping from DynamoDB camelCase to API snake_case.
    """
    if not item:
        return {}
    
    return {
        "trip_id": item.get("tripId"),
        "title": item.get("title"),
        "trip_type": item.get("tripType"),
        "date_mode": item.get("dateMode"),
        "origin": item.get("origin"),
        "destinations": item.get("destinations", []),
        "final_destination": item.get("finalDestination"),
        "start_date": item.get("startDate"),
        "end_date": item.get("endDate"),
        "duration_days": item.get("durationDays"),
        "include_hotels": item.get("includeHotels", True),
        "max_budget": item.get("maxBudget"),
        "adults": item.get("adults", 1),
        "children": item.get("children", 0),
        "bags": item.get("bags", 0),
        "flight_class": item.get("flightClass", "economy"),
        "hotel_class": item.get("hotelClass", "4"),
        "optimization_mode": item.get("optimizationMode", "balanced"),
        "departure_time_preference": item.get("departureTimePreference", "any"),
        "arrival_time_preference": item.get("arrivalTimePreference", "any"),
        "status": item.get("status", "draft"),
        "created_at": item.get("createdAt"),
        "created_by": item.get("createdBy"),
        "invite_code": item.get("inviteCode"),
    }


def selection_to_api(item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert a selection storage item to API response.
    """
    if not item:
        return {}
    
    return {
        "itinerary_id": item.get("itinerary_id"),
        "itinerary_snapshot": item.get("itinerary_snapshot"),
        "selected_at": item.get("selected_at"),
        "cash_price_at_selection": item.get("cash_price_at_selection"),
        "out_of_pocket_at_selection": item.get("out_of_pocket_at_selection"),
    }
