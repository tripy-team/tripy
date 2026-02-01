"""
Solo Trip Service - Handles solo booking trip operations

This service manages the solo trip lifecycle:
- Trip creation with proper schema validation
- Trip status management (draft → optimized → selected → instructions_unlocked → completed)
- Selection management with snapshots
- Points management per trip

Uses the existing TRIPS_TABLE and POINTS_TABLE from the tripy database.
"""
import uuid
import hashlib
import json
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types from DynamoDB."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            # Convert to int if whole number, else float
            if obj % 1 == 0:
                return int(obj)
            return float(obj)
        return super().default(obj)

from src.config import TRIPS_TABLE, POINTS_TABLE
from src.repos.ddb import table, get_item, put_item, sanitize_for_dynamodb
from src.mappers.trip_mapper import storage_to_api, selection_to_api
from src.schemas.trip import (
    CreateTripRequest,
    TripResponse,
    SelectItineraryRequest,
)
from src.schemas.points import PointsBalance, PointsSummaryResponse
from boto3.dynamodb.conditions import Key
from src.contracts.validate import find_negative_numbers
from fastapi import HTTPException
from src.solo.snapshot_schema import normalize_snapshot, validate_snapshot

import logging
logger = logging.getLogger(__name__)

# Constants
TRIP_STATUSES = ['draft', 'optimized', 'selected', 'instructions_unlocked', 'completed', 'cancelled']
OPTIMIZATION_CACHE_TTL_HOURS = 4

# Initialize table references
_trips_table = table(TRIPS_TABLE)
_points_table = table(POINTS_TABLE)


def get_solo_table():
    """Get the DynamoDB trips table."""
    return _trips_table


def get_points_table():
    """Get the DynamoDB points table."""
    return _points_table


# ============================================================================
# Trip CRUD Operations
# ============================================================================

def create_solo_trip(user_id: str, request: CreateTripRequest) -> Dict[str, Any]:
    """
    Create a new solo trip.
    
    Uses the existing TRIPS_TABLE schema with tripId as the primary key.
    """
    t = get_solo_table()
    trip_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    invite_code = str(uuid.uuid4())[:8]
    
    # Compute final_destination if not provided
    final_dest = request.final_destination
    if not final_dest:
        if request.trip_type.value == "round_trip":
            final_dest = request.origin
        elif request.destinations:
            final_dest = request.destinations[-1]
    
    # Use camelCase to match existing trip schema
    item = {
        "tripId": trip_id,
        "createdBy": user_id,
        "title": request.title,
        # Use enums, not booleans
        "tripType": request.trip_type.value,
        "dateMode": request.date_mode.value,
        
        # Origin/destinations
        "origin": request.origin,
        "destinations": request.destinations,
        "finalDestination": final_dest,
        
        "startDate": request.start_date or "",
        "endDate": request.end_date or "",
        "durationDays": request.duration_days,
        "includeHotels": request.include_hotels,
        "maxBudget": request.max_budget,
        "status": "draft",
        "createdAt": now,
        "inviteCode": invite_code,
        # Preferences
        "adults": request.adults,
        "children": request.children,
        "bags": request.bags,
        "flightClass": request.flight_class,
        "hotelClass": request.hotel_class,
        "optimizationMode": request.optimization_mode.value,
        "departureTimePreference": request.departure_time_preference,
        "arrivalTimePreference": request.arrival_time_preference,
    }
    
    put_item(t, item)
    
    return item


def get_solo_trip(trip_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Get a solo trip by ID.
    
    Optionally verifies ownership if user_id is provided.
    """
    t = get_solo_table()
    item = get_item(t, {"tripId": trip_id})
    
    if not item:
        return None
    
    # Verify ownership if user_id provided
    if user_id and item.get("createdBy") != user_id:
        raise PermissionError("Not authorized to access this trip")
    
    return item


def update_solo_trip_status(
    trip_id: str, 
    status: str, 
    user_id: str,
    payment_proof: Optional[dict] = None
) -> Dict[str, Any]:
    """
    Update trip status with optional payment proof.
    
    Status lifecycle: draft → optimized → selected → instructions_unlocked → completed
    """
    t = get_solo_table()
    
    # Get existing trip to verify ownership
    trip = get_solo_trip(trip_id, user_id)
    if not trip:
        raise ValueError("Trip not found")
    
    if status not in TRIP_STATUSES:
        raise ValueError(f"Invalid status: {status}")
    
    # Update trip with new status
    trip["status"] = status
    trip["updatedAt"] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    
    if payment_proof:
        trip["paymentProof"] = payment_proof
    
    put_item(t, trip)
    
    return {"ok": True, "status": status}


# ============================================================================
# Selection Management
# ============================================================================

def select_itinerary(
    trip_id: str, 
    user_id: str, 
    request: SelectItineraryRequest
) -> Dict[str, Any]:
    """
    Select an itinerary for a trip.
    
    Stores selection data in the trip record itself.
    """
    t = get_solo_table()
    
    # Verify ownership
    trip = get_solo_trip(trip_id, user_id)
    if not trip:
        raise ValueError("Trip not found")
    
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    # Enforce snapshot schema + no-negative contract before persisting (prevents sticky broken booking pages).
    snapshot = normalize_snapshot(request.itinerary_snapshot)
    errors = validate_snapshot(snapshot)
    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors})
    
    # Store selection in trip
    trip["selectedItineraryId"] = request.itinerary_id
    trip["itinerarySnapshot"] = snapshot
    trip["cashPriceAtSelection"] = request.cash_price_at_selection
    trip["outOfPocketAtSelection"] = request.out_of_pocket_at_selection
    trip["selectedAt"] = now
    trip["status"] = "selected"
    trip["updatedAt"] = now
    
    put_item(t, trip)
    
    return {"ok": True}


def get_selection(trip_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """
    Get the selected itinerary snapshot for a trip.
    """
    # Verify ownership and get trip
    trip = get_solo_trip(trip_id, user_id)
    if not trip:
        raise ValueError("Trip not found")
    
    if not trip.get("selectedItineraryId"):
        return None
    
    return {
        "ok": True,
        "itinerary_id": trip.get("selectedItineraryId"),
        "itinerary_snapshot": trip.get("itinerarySnapshot"),
        "selected_at": trip.get("selectedAt"),
        "cash_price_at_selection": trip.get("cashPriceAtSelection"),
        "out_of_pocket_at_selection": trip.get("outOfPocketAtSelection"),
    }


# ============================================================================
# Points Management
# ============================================================================

def get_points(trip_id: str, user_id: str) -> PointsSummaryResponse:
    """
    Get points balances for a trip.
    
    Uses the existing POINTS_TABLE schema.
    """
    t = get_points_table()
    
    # Verify ownership
    trip = get_solo_trip(trip_id, user_id)
    if not trip:
        raise ValueError("Trip not found")
    
    # Query all points for this trip
    result = t.query(KeyConditionExpression=Key("tripId").eq(trip_id))
    
    items = []
    total = 0
    for item in result.get("Items", []):
        balance = PointsBalance(
            program=item.get("program", ""),
            balance=int(item.get("balance", 0)),
            updated_at=item.get("updatedAt")
        )
        items.append(balance)
        total += int(item.get("balance", 0))
    
    return PointsSummaryResponse(trip_id=trip_id, items=items, total_points=total)


def upsert_points(
    trip_id: str, 
    user_id: str, 
    points: List[PointsBalance]
) -> PointsSummaryResponse:
    """
    Upsert points balances for a trip.
    
    Uses the existing POINTS_TABLE schema with tripId + userProgram as keys.
    """
    t = get_points_table()
    
    # Verify ownership
    trip = get_solo_trip(trip_id, user_id)
    if not trip:
        raise ValueError("Trip not found")
    
    for balance in points:
        # Get program value (string) for DynamoDB
        program_value = balance.program.value if hasattr(balance.program, 'value') else str(balance.program)
        
        # Use the existing schema: userProgram is composite key (user_id#program)
        user_program = f"{user_id}#{program_value}"
        
        item = {
            "tripId": trip_id,
            "userProgram": user_program,
            "userId": user_id,
            "program": program_value,
            "balance": balance.balance,
            "source": "manual",
        }
        
        t.put_item(Item=sanitize_for_dynamodb(item))
    
    return get_points(trip_id, user_id)


# ============================================================================
# Optimization Caching
# ============================================================================

def compute_cache_key(trip_id: str, trip_prefs: dict, points: dict, mode: str) -> str:
    """
    Compute deterministic cache key for optimization results.
    """
    key_data = {
        "trip_id": trip_id,
        "origin": trip_prefs.get("origin"),
        "destinations": trip_prefs.get("destinations", []),
        "date_mode": trip_prefs.get("dateMode"),
        "start_date": trip_prefs.get("startDate"),
        "end_date": trip_prefs.get("endDate"),
        "duration_days": trip_prefs.get("durationDays"),
        "optimization_mode": mode,
        "flight_class": trip_prefs.get("flightClass"),
        "hotel_class": trip_prefs.get("hotelClass"),
        "adults": trip_prefs.get("adults"),
        "children": trip_prefs.get("children"),
        "include_hotels": trip_prefs.get("includeHotels"),
        "points": dict(sorted(points.items())) if points else {},
    }
    
    key_json = json.dumps(key_data, sort_keys=True, cls=DecimalEncoder)
    return hashlib.sha256(key_json.encode()).hexdigest()[:16]


def get_cached_optimization(trip_id: str, cache_key: str) -> Optional[Dict[str, Any]]:
    """Get cached optimization result if valid."""
    trip = get_solo_trip(trip_id)
    if not trip:
        return None
    
    # Check if cache exists and matches
    cache = trip.get("optimizationCache", {}) or {}
    cached = cache.get(cache_key)
    if not cached:
        return None

    # Cache poisoning control: never allow negative numeric values to be served from cache.
    negatives = find_negative_numbers(cached)
    if negatives:
        logger.warning(
            "[CACHE_INVALID_SENTINEL_VALUES] trip_id=%s cache_key=%s sample=%s",
            trip_id,
            cache_key,
            negatives[:5],
        )
        # Delete the invalid cache entry and persist update.
        try:
            cache.pop(cache_key, None)
            trip["optimizationCache"] = cache
            trip["updatedAt"] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            t = get_solo_table()
            put_item(t, trip)
        except Exception:
            logger.warning("[CACHE_INVALID_SENTINEL_VALUES] failed to persist cache deletion", exc_info=True)
        return None

    return cached


def is_cache_expired(cached: Dict[str, Any]) -> bool:
    """Check if cached optimization has expired."""
    expires_at = cached.get("expires_at")
    if not expires_at:
        return True
    
    try:
        expires = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
        return datetime.now(timezone.utc) > expires
    except (ValueError, TypeError):
        return True


def cache_optimization(
    trip_id: str, 
    cache_key: str, 
    result: dict, 
    computed_at: str, 
    expires_at: str,
    ttl_epoch: int
) -> None:
    """Store optimization result in cache."""
    trip = get_solo_trip(trip_id)
    if not trip:
        return
    
    # Store cache in trip record
    if "optimizationCache" not in trip:
        trip["optimizationCache"] = {}
    
    trip["optimizationCache"][cache_key] = {
        "result": result,
        "computed_at": computed_at,
        "expires_at": expires_at,
    }
    trip["updatedAt"] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    
    t = get_solo_table()
    put_item(t, trip)
