"""
Pooling Scope Constraints for Group Flight Optimization

This module implements constraints based on the PoolingScope setting:
- individual_only: Each member uses only their own points
- household_only: Members can share within household
- full_group: All willing members can share points
- sponsors_only: Only designated sponsors can pay for others

Also implements:
- Seat atomicity: All passengers in a booking unit get seats together or none
- Single-ticket rule: Connecting flights booked as one ticket
"""

from typing import Dict, List, Set, Optional, Any, Tuple
from enum import Enum
import logging

try:
    import pulp as pl
except ModuleNotFoundError:
    pl = None

logger = logging.getLogger(__name__)


class PoolingScope(str, Enum):
    """Points pooling scope for a trip."""
    INDIVIDUAL_ONLY = "individual_only"
    HOUSEHOLD_ONLY = "household_only"
    FULL_GROUP = "full_group"
    SPONSORS_ONLY = "sponsors_only"


class PoolingConstraintBuilder:
    """
    Builds ILP constraints for point pooling based on scope.
    
    Works with the group_oop_optimizer to enforce who can pay for whom.
    """
    
    def __init__(
        self,
        model: "pl.LpProblem",
        pooling_scope: PoolingScope,
        members: List[Dict[str, Any]],
        passengers: List[Dict[str, Any]],
    ):
        """
        Initialize the pooling constraint builder.
        
        Args:
            model: PuLP model to add constraints to
            pooling_scope: The pooling scope for this trip
            members: List of member dicts with user_id, household_id, can_pay_for_others
            passengers: List of passenger dicts with passenger_id, guardian_user_id
        """
        self.model = model
        self.pooling_scope = pooling_scope
        self.members = members
        self.passengers = passengers
        
        # Build lookup maps
        self.member_by_id = {m.get("user_id") or m.get("userId"): m for m in members}
        self.household_members = self._build_household_map()
        self.sponsors = self._get_sponsors()
        self.passengers_by_guardian = self._build_passengers_map()
        
    def _build_household_map(self) -> Dict[str, Set[str]]:
        """Build map of household_id -> set of member user_ids."""
        households: Dict[str, Set[str]] = {}
        for m in self.members:
            uid = m.get("user_id") or m.get("userId")
            hid = m.get("household_id")
            if hid:
                if hid not in households:
                    households[hid] = set()
                households[hid].add(uid)
        return households
    
    def _get_sponsors(self) -> Set[str]:
        """Get set of user_ids who can pay for others."""
        return {
            m.get("user_id") or m.get("userId")
            for m in self.members
            if m.get("can_pay_for_others")
        }
    
    def _build_passengers_map(self) -> Dict[str, List[str]]:
        """Build map of guardian_user_id -> list of passenger_ids."""
        pax_map: Dict[str, List[str]] = {}
        for p in self.passengers:
            guardian = p.get("guardian_user_id")
            pax_id = p.get("passenger_id")
            if guardian:
                if guardian not in pax_map:
                    pax_map[guardian] = []
                pax_map[guardian].append(pax_id)
        return pax_map
    
    def can_user_pay_for(self, payer_id: str, beneficiary_id: str) -> bool:
        """
        Check if payer can pay for beneficiary under current pooling scope.
        
        Returns True if the payment is allowed.
        """
        # Self-payment always allowed
        if payer_id == beneficiary_id:
            return True
        
        payer = self.member_by_id.get(payer_id, {})
        beneficiary = self.member_by_id.get(beneficiary_id, {})
        
        # Check willingness
        if not payer.get("willing_to_share_points", True):
            return False
        
        if self.pooling_scope == PoolingScope.INDIVIDUAL_ONLY:
            # Only self-payment (already checked above)
            return False
        
        elif self.pooling_scope == PoolingScope.HOUSEHOLD_ONLY:
            # Must be in same household
            payer_hh = payer.get("household_id")
            beneficiary_hh = beneficiary.get("household_id")
            if not payer_hh or not beneficiary_hh:
                return False
            return payer_hh == beneficiary_hh
        
        elif self.pooling_scope == PoolingScope.FULL_GROUP:
            # Anyone willing can pay for anyone
            return True
        
        elif self.pooling_scope == PoolingScope.SPONSORS_ONLY:
            # Only sponsors can pay for others
            return payer_id in self.sponsors
        
        return False
    
    def get_allowed_payers(self, beneficiary_id: str) -> List[str]:
        """Get list of user_ids who can pay for a beneficiary."""
        return [
            m.get("user_id") or m.get("userId")
            for m in self.members
            if self.can_user_pay_for(
                m.get("user_id") or m.get("userId"),
                beneficiary_id
            )
        ]
    
    def add_pooling_constraints(
        self,
        use_points: Dict[Tuple, Any],  # (item_id, program, owner_id) -> LpVar
        booking_items: List[Dict[str, Any]],
    ) -> int:
        """
        Add constraints to enforce pooling scope on point usage.
        
        Returns the number of constraints added.
        """
        constraint_count = 0
        
        for item in booking_items:
            item_id = item.get("item_id")
            beneficiary_id = item.get("member_id") or item.get("beneficiary_user_id")
            
            for key, var in use_points.items():
                if key[0] != item_id:
                    continue
                
                owner_id = key[2]
                
                # If this payer cannot pay for beneficiary, force variable to 0
                if not self.can_user_pay_for(owner_id, beneficiary_id):
                    self.model += var == 0, f"pooling_block_{item_id}_{owner_id}"
                    constraint_count += 1
        
        logger.info(f"Added {constraint_count} pooling scope constraints ({self.pooling_scope.value})")
        return constraint_count


class SeatAtomicityBuilder:
    """
    Builds constraints for seat atomicity.
    
    Ensures all passengers in a booking unit (e.g., family) either
    all get seats on a flight or none do.
    """
    
    def __init__(
        self,
        model: "pl.LpProblem",
        passengers: List[Dict[str, Any]],
    ):
        self.model = model
        self.passengers = passengers
        
        # Group passengers by guardian
        self.pax_by_guardian: Dict[str, List[str]] = {}
        for p in passengers:
            guardian = p.get("guardian_user_id")
            pax_id = p.get("passenger_id")
            if guardian:
                if guardian not in self.pax_by_guardian:
                    self.pax_by_guardian[guardian] = []
                self.pax_by_guardian[guardian].append(pax_id)
    
    def add_atomicity_constraints(
        self,
        seat_vars: Dict[Tuple[str, str], Any],  # (passenger_id, flight_id) -> LpVar
        flights: List[str],
    ) -> int:
        """
        Add constraints: for each guardian's passengers on each flight,
        either all get seats or none do.
        
        If guardian has passengers [p1, p2, p3], then for flight F:
        seat[p1][F] = seat[p2][F] = seat[p3][F]
        
        Returns number of constraints added.
        """
        constraint_count = 0
        
        for guardian_id, pax_list in self.pax_by_guardian.items():
            if len(pax_list) < 2:
                continue  # No atomicity needed for single passenger
            
            for flight_id in flights:
                # Check if all passengers have seat vars for this flight
                relevant_vars = [
                    seat_vars.get((pax_id, flight_id))
                    for pax_id in pax_list
                    if (pax_id, flight_id) in seat_vars
                ]
                
                if len(relevant_vars) < 2:
                    continue
                
                # All must equal the first
                first_var = relevant_vars[0]
                for i, var in enumerate(relevant_vars[1:], 1):
                    self.model += first_var == var, \
                        f"atomicity_{guardian_id}_{flight_id}_{i}"
                    constraint_count += 1
        
        logger.info(f"Added {constraint_count} seat atomicity constraints")
        return constraint_count


class SingleTicketBuilder:
    """
    Builds constraints for single-ticket connections.
    
    Ensures connecting flights are booked as one ticket.
    """
    
    def __init__(self, model: "pl.LpProblem"):
        self.model = model
    
    def add_connection_constraints(
        self,
        itinerary_segments: List[Dict[str, Any]],
        segment_vars: Dict[str, Any],  # segment_id -> LpVar
    ) -> int:
        """
        Add constraints: if flight A connects to flight B within same itinerary,
        both must be selected together.
        
        Connection defined as: same passenger, arrival airport = departure airport,
        layover < 24 hours.
        
        Returns number of constraints added.
        """
        constraint_count = 0
        
        # Group segments by passenger
        by_passenger: Dict[str, List[Dict[str, Any]]] = {}
        for seg in itinerary_segments:
            pax_id = seg.get("passenger_id")
            if pax_id:
                if pax_id not in by_passenger:
                    by_passenger[pax_id] = []
                by_passenger[pax_id].append(seg)
        
        # Find connections within each passenger's segments
        for pax_id, segments in by_passenger.items():
            # Sort by departure time
            sorted_segs = sorted(
                segments,
                key=lambda s: (s.get("departure_date", ""), s.get("departure_time", ""))
            )
            
            for i in range(len(sorted_segs) - 1):
                seg_a = sorted_segs[i]
                seg_b = sorted_segs[i + 1]
                
                # Check if this is a connection
                if self._is_connection(seg_a, seg_b):
                    seg_a_id = seg_a.get("segment_id")
                    seg_b_id = seg_b.get("segment_id")
                    
                    if seg_a_id in segment_vars and seg_b_id in segment_vars:
                        # Both segments must be selected together
                        self.model += segment_vars[seg_a_id] == segment_vars[seg_b_id], \
                            f"connection_{pax_id}_{seg_a_id}_{seg_b_id}"
                        constraint_count += 1
        
        logger.info(f"Added {constraint_count} single-ticket connection constraints")
        return constraint_count
    
    def _is_connection(self, seg_a: Dict, seg_b: Dict) -> bool:
        """Check if two segments form a connection (same-ticket requirement)."""
        # Arrival of A must match departure of B
        if seg_a.get("arrival_airport") != seg_b.get("departure_airport"):
            return False
        
        # Check layover time (simple date comparison for now)
        # In production, would parse actual times
        arr_date = seg_a.get("arrival_date", seg_a.get("departure_date"))
        dep_date = seg_b.get("departure_date")
        
        # Same day or next day = connection
        # Beyond that = separate booking allowed
        if arr_date and dep_date:
            # Simple comparison (assumes YYYY-MM-DD format)
            if arr_date == dep_date:
                return True
            # Check if next day (crude check)
            try:
                from datetime import datetime, timedelta
                arr = datetime.strptime(arr_date, "%Y-%m-%d")
                dep = datetime.strptime(dep_date, "%Y-%m-%d")
                if (dep - arr).days <= 1:
                    return True
            except (ValueError, TypeError):
                pass
        
        return False


def build_group_optimizer_with_pooling(
    members: List[Dict[str, Any]],
    passengers: List[Dict[str, Any]],
    booking_items: List[Dict[str, Any]],
    pooling_scope: str,
    flights: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    High-level function to build group optimizer constraints with pooling.
    
    Returns a dict with constraint builders that can be used with the ILP model.
    
    Args:
        members: Trip members with user_id, household_id, can_pay_for_others, etc.
        passengers: Passengers with passenger_id, guardian_user_id
        booking_items: Items to book with item_id, member_id
        pooling_scope: One of individual_only, household_only, full_group, sponsors_only
        flights: Optional list of flight IDs for atomicity constraints
        
    Returns:
        Dict with:
        - pooling_scope: PoolingScope enum value
        - can_pay_for: function(payer_id, beneficiary_id) -> bool
        - allowed_payers: function(beneficiary_id) -> List[str]
        - household_members: Dict[household_id, Set[user_ids]]
        - sponsors: Set[user_ids who can sponsor]
        - passengers_per_guardian: Dict[user_id, List[passenger_ids]]
    """
    scope = PoolingScope(pooling_scope) if isinstance(pooling_scope, str) else pooling_scope
    
    # Create temporary builder just for logic (no model yet)
    temp_builder = PoolingConstraintBuilder(
        model=None,  # No model needed for logic queries
        pooling_scope=scope,
        members=members,
        passengers=passengers,
    )
    
    return {
        "pooling_scope": scope,
        "can_pay_for": temp_builder.can_user_pay_for,
        "allowed_payers": temp_builder.get_allowed_payers,
        "household_members": temp_builder.household_members,
        "sponsors": temp_builder.sponsors,
        "passengers_per_guardian": temp_builder.passengers_by_guardian,
    }


def validate_allocation_against_pooling(
    allocation: Dict[str, Any],
    pooling_scope: str,
    members: List[Dict[str, Any]],
) -> Tuple[bool, Optional[str]]:
    """
    Validate that an allocation respects the pooling scope.
    
    Args:
        allocation: Allocation dict with payer_user_id, beneficiary_user_id
        pooling_scope: The trip's pooling scope
        members: Trip members
        
    Returns:
        (is_valid, error_message)
    """
    payer = allocation.get("payer_user_id")
    beneficiary = allocation.get("beneficiary_user_id") or allocation.get("beneficiary_member")
    
    if not payer or not beneficiary:
        return True, None  # Can't validate without IDs
    
    if payer == beneficiary:
        return True, None  # Self-payment always allowed
    
    scope = PoolingScope(pooling_scope)
    
    member_lookup = {
        (m.get("user_id") or m.get("userId")): m
        for m in members
    }
    
    payer_info = member_lookup.get(payer, {})
    beneficiary_info = member_lookup.get(beneficiary, {})
    
    if scope == PoolingScope.INDIVIDUAL_ONLY:
        return False, f"Individual pooling: {payer} cannot pay for {beneficiary}"
    
    elif scope == PoolingScope.HOUSEHOLD_ONLY:
        payer_hh = payer_info.get("household_id")
        beneficiary_hh = beneficiary_info.get("household_id")
        if payer_hh != beneficiary_hh or not payer_hh:
            return False, f"Household pooling: {payer} and {beneficiary} not in same household"
    
    elif scope == PoolingScope.SPONSORS_ONLY:
        if not payer_info.get("can_pay_for_others"):
            return False, f"Sponsors only: {payer} is not a sponsor"
    
    return True, None
