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
    # Organizer member preferences (same as join_trip)
    adults: int = 1,
    children: int = 0,
    leg_dates: Optional[List[str]] = None,
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
    if leg_dates:
        trip["legDates"] = leg_dates
    trip_repo.put_trip(trip)

    # Owner is automatically approved for planning
    from src.models.group_trip import MemberLifecycleState
    from decimal import Decimal
    
    owner_member = {
        "tripId": trip_id,
        "userId": user_id,
        "role": "owner",
        "status": "complete",  # Owner is auto-approved
        "lifecycle_state": MemberLifecycleState.APPROVED_FOR_PLANNING.value,
        # Store owner's budget in member record (same as joined members)
        "adults": max(1, adults),
        "children": max(0, children),
        "party_size": max(1, adults) + max(0, children),
    }
    
    # Store budget in member record (DynamoDB requires Decimal)
    if max_budget is not None:
        owner_member["max_cash_budget"] = Decimal(str(max_budget))
    
    trip_member_repo.add_member(owner_member)

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


def list_trips_for_user(
    user_id: str,
    limit: Optional[int] = None,
    offset: int = 0,
    include_details: bool = False
) -> List[Dict[str, Any]]:
    """
    List trips for a user (both owned and joined).
    
    Args:
        user_id: User ID
        limit: Maximum number of trips to return (None = all)
        offset: Number of trips to skip (for pagination)
        include_details: If True, fetch destinations and member counts (slower)
                        If False, return minimal trip data (faster)
    
    Returns:
        List of trips with basic info. Use include_details=True for full data.
    """
    from .destination_service import list_destinations, get_display_destinations_for_trip
    from .trip_member_service import list_members
    
    # Get trip memberships
    memberships = trip_member_repo.list_trips_for_user(user_id)
    
    # Sort memberships by tripId to ensure consistent ordering for pagination
    # We'll re-sort by date after fetching trip data
    
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
                
                # Include user's own flight preferences from membership
                # This allows displaying "SEA → Paris" style trip titles
                trip["userDepartureAirport"] = membership.get("departure_airport")
                trip["userArrivalAirport"] = membership.get("arrival_airport")
                trip["userIsRoundTrip"] = membership.get("is_round_trip", True)
                
                if include_details:
                    # Get member count (expensive - extra DB call)
                    members = list_members(trip_id)
                    trip["memberCount"] = len(members) if members else 1
                    
                    # Get destinations (expensive - extra DB call)
                    destinations = list_destinations(trip_id)
                    trip["destinations"], trip["firstDestination"] = get_display_destinations_for_trip(destinations or [])
                else:
                    # Fast mode: use cached/default values
                    # memberCount can be updated when viewing trip details
                    trip["memberCount"] = trip.get("memberCount", 1)
                    trip["destinations"] = trip.get("destinations", [])
                    trip["firstDestination"] = trip.get("firstDestination", trip.get("title", ""))

                trips.append(trip)
    
    # Sort by startDate descending (most recent first)
    trips.sort(key=lambda x: x.get("startDate", ""), reverse=True)
    
    # Apply pagination
    if offset > 0:
        trips = trips[offset:]
    if limit is not None:
        trips = trips[:limit]
    
    return trips


def get_trips_count_for_user(user_id: str) -> int:
    """Get total number of trips for a user (fast count without fetching details)."""
    memberships = trip_member_repo.list_trips_for_user(user_id)
    return len(memberships)


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


def mark_strategy_paid(trip_id: str, user_id: str, payment_info: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Mark a trip's optimization strategy as paid.
    
    Any group member can pay for the strategy.
    Once paid, all group members can access the transfer instructions.
    
    Args:
        trip_id: Trip ID
        user_id: User making the payment (must be a trip member)
        payment_info: Optional payment details (amount, method, reference, etc.)
        
    Returns:
        Dict with ok, strategy_paid, and paid_at
    """
    from datetime import datetime
    
    trip = get_trip(trip_id)
    if not trip:
        raise ValueError("Trip not found")
    
    # Verify user is a member of the trip (owner or joined member)
    is_owner = trip.get("createdBy") == user_id
    is_member = False
    if not is_owner:
        # Check if user is a trip member
        members = trip_member_repo.list_members(trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
    
    if not is_owner and not is_member:
        raise ValueError("Only trip members can mark strategy as paid")
    
    # If already paid, just return success (idempotent)
    if trip.get("strategyPaid"):
        return {
            "ok": True,
            "strategy_paid": True,
            "paid_at": trip.get("strategyPaidAt", ""),
            "already_paid": True,
        }
    
    # Update trip with payment status
    trip["strategyPaid"] = True
    trip["strategyPaidAt"] = datetime.utcnow().isoformat() + "Z"
    trip["strategyPaidBy"] = user_id
    
    if payment_info:
        trip["strategyPaymentInfo"] = {
            "amount": payment_info.get("amount"),
            "currency": payment_info.get("currency", "USD"),
            "method": payment_info.get("method"),
            "reference": payment_info.get("reference"),
        }
    
    trip_repo.put_trip(trip)
    
    return {
        "ok": True,
        "strategy_paid": True,
        "paid_at": trip["strategyPaidAt"],
    }


def is_strategy_paid(trip_id: str) -> bool:
    """
    Check if a trip's optimization strategy has been paid for.
    
    Returns:
        True if strategy is paid, False otherwise
    """
    trip = get_trip(trip_id)
    if not trip:
        return False
    
    return trip.get("strategyPaid", False)


def mark_optimization_generated(trip_id: str) -> bool:
    """
    Mark a trip's optimization as generated to prevent multiple runs.
    
    This is called after a successful optimization to ensure users cannot
    keep calling the optimization endpoint.
    
    Args:
        trip_id: Trip ID
        
    Returns:
        True if successfully marked, False if trip not found
    """
    from datetime import datetime
    
    trip = get_trip(trip_id)
    if not trip:
        return False
    
    # Set the optimization generated flag with timestamp
    trip["optimizationGenerated"] = True
    trip["optimizationGeneratedAt"] = datetime.utcnow().isoformat() + "Z"
    
    trip_repo.put_trip(trip)
    return True


def is_optimization_generated(trip_id: str) -> bool:
    """
    Check if a trip's optimization has already been generated.
    
    Returns:
        True if optimization was already generated, False otherwise
    """
    trip = get_trip(trip_id)
    if not trip:
        return False
    
    return trip.get("optimizationGenerated", False)
