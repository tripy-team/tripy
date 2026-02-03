"""
Passenger Service

Manages passengers (travelers) for group trips.
Each member can have multiple passengers (themselves + dependents like kids).
"""

import uuid
from typing import Dict, Any, List, Optional
from src.repos import trip_member_repo
from src.models.group_trip import PassengerType


# In-memory storage for passengers (would be DynamoDB in production)
# Key: trip_id, Value: list of passengers
_passengers_store: Dict[str, List[Dict[str, Any]]] = {}


def create_passenger(
    trip_id: str,
    guardian_user_id: str,
    first_name: str,
    last_name: str,
    passenger_type: str = "adult",
    date_of_birth: Optional[str] = None,
    loyalty_number: Optional[str] = None,
    seat_preference: Optional[str] = None,
    special_needs: Optional[str] = None,
    is_primary: bool = False,
) -> Dict[str, Any]:
    """
    Create a new passenger under a member.
    
    Args:
        trip_id: Trip ID
        guardian_user_id: User ID of the member responsible for this passenger
        first_name: Passenger's first name
        last_name: Passenger's last name
        passenger_type: adult, child, or infant
        date_of_birth: DOB in YYYY-MM-DD format
        loyalty_number: Frequent flyer number
        seat_preference: window/aisle/middle
        special_needs: Wheelchair, dietary, etc.
        is_primary: True if this is the member themselves
        
    Returns:
        Created passenger dict
    """
    # Validate guardian is a member of the trip
    members = trip_member_repo.list_members(trip_id)
    is_member = any(
        m.get("userId") == guardian_user_id or m.get("user_id") == guardian_user_id
        for m in members
    )
    if not is_member:
        raise ValueError(f"User {guardian_user_id} is not a member of trip {trip_id}")
    
    # Validate passenger type
    try:
        ptype = PassengerType(passenger_type)
    except ValueError:
        ptype = PassengerType.ADULT
    
    passenger_id = str(uuid.uuid4())
    
    passenger = {
        "passenger_id": passenger_id,
        "trip_id": trip_id,
        "guardian_user_id": guardian_user_id,
        "first_name": first_name.strip(),
        "last_name": last_name.strip(),
        "full_name": f"{first_name.strip()} {last_name.strip()}",
        "passenger_type": ptype.value,
        "date_of_birth": date_of_birth,
        "loyalty_number": loyalty_number,
        "seat_preference": seat_preference,
        "special_needs": special_needs,
        "is_primary": is_primary,
    }
    
    # Store the passenger
    if trip_id not in _passengers_store:
        _passengers_store[trip_id] = []
    _passengers_store[trip_id].append(passenger)
    
    return passenger


def get_passenger(trip_id: str, passenger_id: str) -> Optional[Dict[str, Any]]:
    """Get a specific passenger by ID."""
    passengers = _passengers_store.get(trip_id, [])
    for p in passengers:
        if p.get("passenger_id") == passenger_id:
            return p
    return None


def list_passengers(trip_id: str) -> List[Dict[str, Any]]:
    """List all passengers for a trip."""
    return _passengers_store.get(trip_id, [])


def list_passengers_for_member(trip_id: str, user_id: str) -> List[Dict[str, Any]]:
    """List all passengers under a specific member."""
    passengers = _passengers_store.get(trip_id, [])
    return [p for p in passengers if p.get("guardian_user_id") == user_id]


def update_passenger(
    trip_id: str,
    passenger_id: str,
    user_id: str,
    **updates
) -> Dict[str, Any]:
    """
    Update a passenger's details.
    
    Only the guardian can update their passengers.
    """
    passenger = get_passenger(trip_id, passenger_id)
    if not passenger:
        raise ValueError(f"Passenger {passenger_id} not found in trip {trip_id}")
    
    # Verify user is the guardian
    if passenger.get("guardian_user_id") != user_id:
        raise ValueError("Only the guardian can update this passenger")
    
    # Apply allowed updates
    allowed_fields = {
        "first_name", "last_name", "date_of_birth", 
        "loyalty_number", "seat_preference", "special_needs"
    }
    for field, value in updates.items():
        if field in allowed_fields and value is not None:
            passenger[field] = value
    
    # Update full_name if name changed
    if "first_name" in updates or "last_name" in updates:
        passenger["full_name"] = f"{passenger['first_name']} {passenger['last_name']}"
    
    return passenger


def delete_passenger(trip_id: str, passenger_id: str, user_id: str) -> Dict[str, Any]:
    """
    Delete a passenger.
    
    Only the guardian can delete their passengers.
    Primary passengers (the member themselves) cannot be deleted.
    """
    passenger = get_passenger(trip_id, passenger_id)
    if not passenger:
        raise ValueError(f"Passenger {passenger_id} not found in trip {trip_id}")
    
    # Verify user is the guardian
    if passenger.get("guardian_user_id") != user_id:
        raise ValueError("Only the guardian can delete this passenger")
    
    # Can't delete primary passenger
    if passenger.get("is_primary"):
        raise ValueError("Cannot delete primary passenger (the member themselves)")
    
    # Remove from store
    _passengers_store[trip_id] = [
        p for p in _passengers_store.get(trip_id, [])
        if p.get("passenger_id") != passenger_id
    ]
    
    return {"ok": True, "passenger_id": passenger_id}


def get_trip_passengers_summary(trip_id: str) -> Dict[str, Any]:
    """
    Get a summary of all passengers for a trip.
    
    Returns counts by type and grouped by member.
    """
    passengers = list_passengers(trip_id)
    
    # Count by type
    adults = sum(1 for p in passengers if p.get("passenger_type") == "adult")
    children = sum(1 for p in passengers if p.get("passenger_type") == "child")
    infants = sum(1 for p in passengers if p.get("passenger_type") == "infant")
    
    # Group by guardian
    by_member: Dict[str, List[Dict[str, Any]]] = {}
    for p in passengers:
        guardian = p.get("guardian_user_id", "unknown")
        if guardian not in by_member:
            by_member[guardian] = []
        by_member[guardian].append(p)
    
    return {
        "trip_id": trip_id,
        "total_passengers": len(passengers),
        "adults": adults,
        "children": children,
        "infants": infants,
        "passengers_by_member": by_member,
    }


def get_total_seat_count(trip_id: str) -> int:
    """
    Get the total number of seats needed for a trip.
    
    Note: Infants on lap don't need a separate seat.
    """
    passengers = list_passengers(trip_id)
    return sum(1 for p in passengers if p.get("passenger_type") != "infant")


def ensure_member_has_passenger(trip_id: str, user_id: str, user_name: str = "") -> Dict[str, Any]:
    """
    Ensure a member has at least their own passenger record.
    
    Creates a primary passenger for the member if one doesn't exist.
    Called when a member joins a trip.
    """
    existing = list_passengers_for_member(trip_id, user_id)
    primary = [p for p in existing if p.get("is_primary")]
    
    if primary:
        return primary[0]
    
    # Parse user name into first/last
    parts = (user_name or "Member").strip().split(" ", 1)
    first_name = parts[0] or "Member"
    last_name = parts[1] if len(parts) > 1 else user_id[:6]
    
    return create_passenger(
        trip_id=trip_id,
        guardian_user_id=user_id,
        first_name=first_name,
        last_name=last_name,
        passenger_type="adult",
        is_primary=True,
    )
