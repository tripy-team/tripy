from typing import Dict, Any, List, Optional
from decimal import Decimal
from src.repos import trip_member_repo
from src.models.group_trip import (
    MemberLifecycleState,
    DelegationScope,
    is_valid_lifecycle_transition,
    PointsUsagePreference,
)
from .trip_service import get_trip_by_invite


def join_trip(
    user_id: str,
    invite_code: str,
    *,
    willing_to_share_points: bool = True,
    points_usage: str = "freely",
    departure_airport: Optional[str] = None,
    arrival_airport: Optional[str] = None,
    is_round_trip: bool = True,
    flight_class: str = "economy",
    max_cash_budget: Optional[float] = None,
    adults: int = 1,
    children: int = 0,
    max_settlement_owed: Optional[float] = None,
    include_settlement_in_budget: bool = False,
) -> Dict[str, Any]:
    """
    Join a trip by invite code.
    
    Sets initial lifecycle_state to JOINED_NO_WALLET.
    Optionally store member preferences (pooling workflow, flight preferences, budget, party size, and settlement constraints).
    """
    trip = get_trip_by_invite(invite_code)
    if not trip:
        return {"error": "Invalid invite code"}

    item = {
        "tripId": trip["tripId"],
        "userId": user_id,
        "role": "member",
        "status": "active",
        "lifecycle_state": MemberLifecycleState.JOINED_NO_WALLET.value,
    }
    if willing_to_share_points is not None:
        item["willing_to_share_points"] = willing_to_share_points
    if points_usage in ("freely", "ask_before", "do_not_use"):
        item["points_usage"] = points_usage
    
    # Store flight preferences for "Same as Friend?" feature
    if departure_airport:
        item["departure_airport"] = departure_airport
    if arrival_airport:
        item["arrival_airport"] = arrival_airport
    item["is_round_trip"] = is_round_trip
    item["flight_class"] = flight_class
    
    # Store budget (DynamoDB requires Decimal, not float)
    if max_cash_budget is not None:
        item["max_cash_budget"] = Decimal(str(max_cash_budget))
    
    # Store party size (travelers in this member's booking)
    item["adults"] = max(1, adults)  # At least 1 adult
    item["children"] = max(0, children)
    # party_size is the total for optimizer calculations
    item["party_size"] = item["adults"] + item["children"]
    
    # Store settlement constraints (Issue 2: Settlement-aware budgets)
    if max_settlement_owed is not None:
        item["max_settlement_owed"] = Decimal(str(max_settlement_owed))
    item["include_settlement_in_budget"] = include_settlement_in_budget

    trip_member_repo.add_member(item)
    return {"tripId": trip["tripId"], "lifecycle_state": item["lifecycle_state"]}


def list_members(trip_id: str) -> List[Dict[str, Any]]:
    """
    List all members of a trip.
    
    Backfills lifecycle_state for existing members that don't have it.
    """
    members = trip_member_repo.list_members(trip_id)
    for member in members:
        _backfill_member_lifecycle_state(member)
    return members


def get_member(trip_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Get a specific member of a trip."""
    members = list_members(trip_id)
    for member in members:
        if member.get("userId") == user_id or member.get("user_id") == user_id:
            return member
    return None


def _backfill_member_lifecycle_state(member: Dict[str, Any]) -> None:
    """
    Backfill lifecycle_state for existing members that don't have it.
    
    Infers state based on existing data:
    - If wallet balances exist: wallet_connected
    - Otherwise: joined_no_wallet
    """
    if "lifecycle_state" not in member:
        # Check if member has wallet data (indicated by having points balances)
        if member.get("points") or member.get("wallet_connected"):
            member["lifecycle_state"] = MemberLifecycleState.WALLET_CONNECTED.value
        else:
            member["lifecycle_state"] = MemberLifecycleState.JOINED_NO_WALLET.value


def update_member_preferences(
    trip_id: str,
    user_id: str,
    *,
    willing_to_share_points: Optional[bool] = None,
    points_usage: Optional[str] = None,
) -> bool:
    """Update current user's preferences for a trip (pooling workflow). Returns True if updated."""
    attrs = {}
    if willing_to_share_points is not None:
        attrs["willing_to_share_points"] = willing_to_share_points
    if points_usage in ("freely", "ask_before", "do_not_use"):
        attrs["points_usage"] = points_usage
    if not attrs:
        return True
    return trip_member_repo.update_member(trip_id, user_id, attrs)


def update_member_lifecycle_state(
    trip_id: str,
    user_id: str,
    new_state: str,
    *,
    requesting_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update a member's lifecycle state.
    
    Validates that the transition is allowed.
    
    Args:
        trip_id: Trip ID
        user_id: User ID of the member to update
        new_state: New lifecycle state
        requesting_user_id: User making the request (for authorization)
        
    Returns:
        Dict with ok, lifecycle_state, previous_state
        
    Raises:
        ValueError: If transition is invalid or user not found
    """
    # Get current member state
    member = get_member(trip_id, user_id)
    if not member:
        raise ValueError(f"Member {user_id} not found in trip {trip_id}")
    
    # Validate new state
    try:
        new_lifecycle = MemberLifecycleState(new_state)
    except ValueError:
        raise ValueError(f"Invalid lifecycle state: {new_state}. "
                        f"Valid values: {[s.value for s in MemberLifecycleState]}")
    
    # Get current state
    current_state_str = member.get("lifecycle_state", MemberLifecycleState.JOINED_NO_WALLET.value)
    try:
        current_state = MemberLifecycleState(current_state_str)
    except ValueError:
        current_state = MemberLifecycleState.JOINED_NO_WALLET
    
    # Validate transition
    if not is_valid_lifecycle_transition(current_state, new_lifecycle):
        raise ValueError(
            f"Invalid lifecycle transition: {current_state.value} -> {new_lifecycle.value}. "
            f"Valid transitions from {current_state.value}: "
            f"{[s.value for s in MemberLifecycleState if is_valid_lifecycle_transition(current_state, s)]}"
        )
    
    # Update the member
    success = trip_member_repo.update_member(
        trip_id, 
        user_id, 
        {"lifecycle_state": new_lifecycle.value}
    )
    
    if not success:
        raise ValueError(f"Failed to update lifecycle state for member {user_id}")
    
    return {
        "ok": True,
        "lifecycle_state": new_lifecycle.value,
        "previous_state": current_state.value,
    }


def on_wallet_connected(trip_id: str, user_id: str) -> Dict[str, Any]:
    """
    Called when a member connects their wallet (adds point balances).
    
    Automatically transitions from joined_no_wallet to wallet_connected.
    """
    member = get_member(trip_id, user_id)
    if not member:
        raise ValueError(f"Member {user_id} not found in trip {trip_id}")
    
    current_state = member.get("lifecycle_state", MemberLifecycleState.JOINED_NO_WALLET.value)
    
    # Only transition if in joined_no_wallet state
    if current_state == MemberLifecycleState.JOINED_NO_WALLET.value:
        return update_member_lifecycle_state(
            trip_id, 
            user_id, 
            MemberLifecycleState.WALLET_CONNECTED.value
        )
    
    return {
        "ok": True,
        "lifecycle_state": current_state,
        "previous_state": current_state,
    }


def get_trip_members(trip_id: str) -> List[Dict[str, Any]]:
    """
    Alias for list_members for backward compatibility with group_api.
    """
    return list_members(trip_id)


def check_booking_ready(trip_id: str) -> Dict[str, Any]:
    """
    Check if all required members are approved_for_booking.
    
    Returns status info about which members are ready and which are blocking.
    """
    members = list_members(trip_id)
    
    ready = []
    not_ready = []
    
    for member in members:
        state = member.get("lifecycle_state", MemberLifecycleState.JOINED_NO_WALLET.value)
        member_info = {
            "userId": member.get("userId") or member.get("user_id"),
            "role": member.get("role"),
            "lifecycle_state": state,
        }
        
        if state == MemberLifecycleState.APPROVED_FOR_BOOKING.value:
            ready.append(member_info)
        elif state != MemberLifecycleState.INACTIVE.value:
            # Inactive members don't block
            not_ready.append(member_info)
    
    all_ready = len(not_ready) == 0
    
    return {
        "all_ready": all_ready,
        "ready_count": len(ready),
        "not_ready_count": len(not_ready),
        "ready_members": ready,
        "blocking_members": not_ready,
    }


# =============================================================================
# HOUSEHOLD AND DELEGATION FUNCTIONS
# =============================================================================

def set_household(
    trip_id: str,
    user_id: str,
    household_id: str,
) -> Dict[str, Any]:
    """
    Set the household_id for a member.
    
    Members with the same household_id are treated as one unit for pooling
    (when pooling_scope is household_only).
    
    Args:
        trip_id: Trip ID
        user_id: User ID of the member
        household_id: Household identifier (e.g., "smith-family", or auto-generated)
        
    Returns:
        Dict with ok and household_id
    """
    member = get_member(trip_id, user_id)
    if not member:
        raise ValueError(f"Member {user_id} not found in trip {trip_id}")
    
    if not household_id or not household_id.strip():
        raise ValueError("household_id cannot be empty")
    
    # Update the member
    success = trip_member_repo.update_member(
        trip_id,
        user_id,
        {"household_id": household_id.strip()}
    )
    
    if not success:
        raise ValueError(f"Failed to set household for member {user_id}")
    
    return {
        "ok": True,
        "household_id": household_id.strip(),
    }


def remove_household(trip_id: str, user_id: str) -> Dict[str, Any]:
    """
    Remove the household_id from a member.
    """
    member = get_member(trip_id, user_id)
    if not member:
        raise ValueError(f"Member {user_id} not found in trip {trip_id}")
    
    # Update the member to remove household_id
    success = trip_member_repo.update_member(
        trip_id,
        user_id,
        {"household_id": None}
    )
    
    if not success:
        raise ValueError(f"Failed to remove household for member {user_id}")
    
    return {"ok": True}


def get_household_members(trip_id: str, household_id: str) -> List[Dict[str, Any]]:
    """
    Get all members in a specific household.
    """
    all_members = list_members(trip_id)
    return [m for m in all_members if m.get("household_id") == household_id]


def set_delegation(
    trip_id: str,
    delegator_user_id: str,
    delegate_user_id: str,
    scope: str = "planning",
) -> Dict[str, Any]:
    """
    Set booking authority delegation from delegator to delegate.
    
    The delegate can approve planning/booking using the delegator's points.
    Only allowed within the same household.
    
    Args:
        trip_id: Trip ID
        delegator_user_id: User who is delegating authority
        delegate_user_id: User receiving delegation
        scope: "planning" (can approve plan) or "booking" (can book)
        
    Returns:
        Dict with ok and delegation details
    """
    # Validate scope
    try:
        delegation_scope = DelegationScope(scope)
    except ValueError:
        raise ValueError(f"Invalid delegation scope: {scope}. "
                        f"Valid values: {[s.value for s in DelegationScope]}")
    
    # Get both members
    delegator = get_member(trip_id, delegator_user_id)
    if not delegator:
        raise ValueError(f"Delegator {delegator_user_id} not found in trip {trip_id}")
    
    delegate = get_member(trip_id, delegate_user_id)
    if not delegate:
        raise ValueError(f"Delegate {delegate_user_id} not found in trip {trip_id}")
    
    # Validate same household
    delegator_household = delegator.get("household_id")
    delegate_household = delegate.get("household_id")
    
    if not delegator_household or not delegate_household:
        raise ValueError("Both delegator and delegate must be in a household to use delegation")
    
    if delegator_household != delegate_household:
        raise ValueError("Delegation is only allowed within the same household")
    
    # Store delegation on the delegator's record
    delegation = {
        "delegate_user_id": delegate_user_id,
        "scope": delegation_scope.value,
    }
    
    success = trip_member_repo.update_member(
        trip_id,
        delegator_user_id,
        {"delegated_booking_authority": delegation}
    )
    
    if not success:
        raise ValueError(f"Failed to set delegation for member {delegator_user_id}")
    
    return {
        "ok": True,
        "delegator_user_id": delegator_user_id,
        "delegate_user_id": delegate_user_id,
        "scope": delegation_scope.value,
    }


def remove_delegation(trip_id: str, delegator_user_id: str) -> Dict[str, Any]:
    """
    Remove delegation from a member.
    """
    member = get_member(trip_id, delegator_user_id)
    if not member:
        raise ValueError(f"Member {delegator_user_id} not found in trip {trip_id}")
    
    success = trip_member_repo.update_member(
        trip_id,
        delegator_user_id,
        {"delegated_booking_authority": None}
    )
    
    if not success:
        raise ValueError(f"Failed to remove delegation for member {delegator_user_id}")
    
    return {"ok": True}


def can_user_act_for_member(
    trip_id: str,
    acting_user_id: str,
    target_user_id: str,
    required_scope: str = "planning",
) -> bool:
    """
    Check if acting_user can act on behalf of target_user.
    
    Returns True if:
    1. acting_user == target_user (self)
    2. target_user has delegated to acting_user with sufficient scope
    
    Args:
        trip_id: Trip ID
        acting_user_id: User trying to act
        target_user_id: User being acted for
        required_scope: Minimum scope needed ("planning" or "booking")
    """
    # Self is always allowed
    if acting_user_id == target_user_id:
        return True
    
    # Check delegation
    target = get_member(trip_id, target_user_id)
    if not target:
        return False
    
    delegation = target.get("delegated_booking_authority")
    if not delegation:
        return False
    
    # Check if acting_user is the delegate
    if delegation.get("delegate_user_id") != acting_user_id:
        return False
    
    # Check scope
    delegation_scope = delegation.get("scope", "planning")
    
    # "booking" scope includes "planning"
    if required_scope == "planning":
        return delegation_scope in ("planning", "booking")
    elif required_scope == "booking":
        return delegation_scope == "booking"
    
    return False


def set_sponsor_flag(
    trip_id: str,
    user_id: str,
    can_pay_for_others: bool,
    *,
    requesting_user_id: str,
) -> Dict[str, Any]:
    """
    Set or unset the can_pay_for_others (sponsor) flag for a member.
    
    Only the trip owner can grant/revoke sponsor permission.
    
    Args:
        trip_id: Trip ID
        user_id: User to update
        can_pay_for_others: Whether the user can pay for others
        requesting_user_id: User making the request (must be owner)
        
    Returns:
        Dict with ok and can_pay_for_others
    """
    from .trip_service import get_trip
    
    trip = get_trip(trip_id)
    if not trip:
        raise ValueError("Trip not found")
    
    # Only owner can change sponsor status
    if trip.get("createdBy") != requesting_user_id:
        raise ValueError("Only the trip owner can change sponsor status")
    
    member = get_member(trip_id, user_id)
    if not member:
        raise ValueError(f"Member {user_id} not found in trip {trip_id}")
    
    success = trip_member_repo.update_member(
        trip_id,
        user_id,
        {"can_pay_for_others": can_pay_for_others}
    )
    
    if not success:
        raise ValueError(f"Failed to update sponsor flag for member {user_id}")
    
    return {
        "ok": True,
        "can_pay_for_others": can_pay_for_others,
    }
