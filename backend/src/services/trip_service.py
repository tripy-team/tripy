import uuid
from typing import Dict, Any, Optional, List
from src.repos import trip_repo, trip_member_repo
from src.models.group_trip import PoolingScope, get_default_pooling_scope


def create_trip(
    user_id: str,
    title: str,
    start_date: str,
    end_date: str,
    include_hotels: bool = False,  # Default to False (flight-only mode)
    max_budget: Optional[int] = None,
    duration_days: Optional[int] = None,
    pooling_scope: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a new trip.
    
    Args:
        user_id: The ID of the user creating the trip
        title: Trip title
        start_date: Start date in ISO format
        end_date: End date in ISO format
        include_hotels: Whether to include hotels (default False - flight-only mode)
        max_budget: Maximum budget in dollars
        duration_days: Trip duration in days (for flexible dates)
        pooling_scope: How points can be pooled across members.
            Values: individual_only, household_only, full_group, sponsors_only
            Default: individual_only (safest default)
    """
    trip_id = str(uuid.uuid4())
    invite_code = str(uuid.uuid4())[:8]
    
    # Validate and set pooling_scope
    if pooling_scope:
        try:
            validated_scope = PoolingScope(pooling_scope)
        except ValueError:
            validated_scope = PoolingScope.INDIVIDUAL_ONLY
    else:
        validated_scope = get_default_pooling_scope(has_households=False)

    trip = {
        "tripId": trip_id,
        "createdBy": user_id,
        "title": title,
        "startDate": start_date,
        "endDate": end_date,
        "inviteCode": invite_code,
        "status": "active",
        "includeHotels": include_hotels,
        "maxBudget": max_budget,
        "durationDays": duration_days,
        "poolingScope": validated_scope.value,
    }
    trip_repo.put_trip(trip)

    trip_member_repo.add_member(
        {
            "tripId": trip_id,
            "userId": user_id,
            "role": "owner",
            "status": "active",
        }
    )

    return trip


def get_trip(trip_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Get a trip by ID.
    
    Backfills poolingScope with default value if missing (for existing trips).
    """
    trip = trip_repo.get_trip(trip_id)
    if trip:
        # Backfill poolingScope for existing trips that don't have it
        if "poolingScope" not in trip:
            trip["poolingScope"] = PoolingScope.INDIVIDUAL_ONLY.value
    return trip


def update_pooling_scope(
    trip_id: str,
    user_id: str,
    pooling_scope: str,
) -> Dict[str, Any]:
    """
    Update the pooling scope for a trip.
    
    Only the trip owner can change pooling scope.
    Changing pooling scope invalidates any existing plan.
    
    Args:
        trip_id: Trip ID
        user_id: User making the request (must be owner)
        pooling_scope: New pooling scope value
        
    Returns:
        Dict with ok, pooling_scope, and plan_invalidated
    """
    trip = get_trip(trip_id)
    if not trip:
        raise ValueError("Trip not found")
    
    # Verify user is the trip owner
    if trip.get("createdBy") != user_id:
        raise ValueError("Only trip owner can change pooling scope")
    
    # Validate pooling_scope
    try:
        validated_scope = PoolingScope(pooling_scope)
    except ValueError:
        raise ValueError(f"Invalid pooling_scope: {pooling_scope}. "
                        f"Valid values: {[s.value for s in PoolingScope]}")
    
    # Check if plan exists and needs invalidation
    plan_invalidated = False
    if trip.get("currentPlanId") or trip.get("planDraftId"):
        # Mark plan as invalidated
        trip["planInvalidated"] = True
        plan_invalidated = True
    
    # Update trip
    trip["poolingScope"] = validated_scope.value
    trip_repo.put_trip(trip)
    
    return {
        "ok": True,
        "poolingScope": validated_scope.value,
        "planInvalidated": plan_invalidated,
    }


def get_trip_by_invite(invite_code: str) -> Optional[Dict[str, Any]]:
    return trip_repo.get_trip_by_invite_code(invite_code)


def regenerate_invite_code(trip_id: str, user_id: str) -> Dict[str, Any]:
    """Regenerate invite code for a trip (admin only)"""
    trip = get_trip(trip_id)
    if not trip:
        raise ValueError("Trip not found")
    
    # Verify user is the trip creator
    if trip.get("createdBy") != user_id:
        raise ValueError("Only trip creator can regenerate invite code")
    
    # Generate new invite code
    new_invite_code = str(uuid.uuid4())[:8]
    
    # Update trip with new invite code
    trip["inviteCode"] = new_invite_code
    trip_repo.put_trip(trip)
    
    return {"inviteCode": new_invite_code}


def list_trips_for_user(user_id: str) -> List[Dict[str, Any]]:
    """List all trips for a user (both owned and joined)"""
    from .destination_service import list_destinations, get_display_destinations_for_trip
    from .trip_member_service import list_members
    
    # Get trip memberships
    memberships = trip_member_repo.list_trips_for_user(user_id)
    
    # Get trip details for each membership
    trips = []
    for membership in memberships:
        trip_id = membership.get("tripId")
        if trip_id:
            trip = trip_repo.get_trip(trip_id)
            if trip:
                # Add membership info to trip
                trip["role"] = membership.get("role", "member")
                trip["memberStatus"] = membership.get("status", "active")
                
                # Get member count
                members = list_members(trip_id)
                trip["memberCount"] = len(members) if members else 1
                
                # Get destinations (first destination name for display).
                # Start/end are origin/return (like flight booking); only "visiting" destinations are shown.
                destinations = list_destinations(trip_id)
                trip["destinations"], trip["firstDestination"] = get_display_destinations_for_trip(destinations or [])

                trips.append(trip)
    
    # Sort by startDate descending (most recent first)
    trips.sort(key=lambda x: x.get("startDate", ""), reverse=True)
    return trips


def delete_trip(trip_id: str, user_id: str) -> bool:
    """Delete a trip (owner only)"""
    trip = get_trip(trip_id)
    if not trip:
        raise ValueError("Trip not found")
    
    # Verify user is the trip creator
    if trip.get("createdBy") != user_id:
        raise ValueError("Only trip creator can delete the trip")
    
    # Delete the trip
    success = trip_repo.delete_trip(trip_id)
    if not success:
        raise ValueError("Failed to delete trip")
    
    return success
