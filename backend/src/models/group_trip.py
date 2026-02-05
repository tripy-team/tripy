"""
Group Trip Models

Defines data models for group trip functionality including:
- PoolingScope: Controls how points can be shared across travelers
- MemberLifecycleState: Tracks member onboarding state
- Household and delegation models

These models align with docs/GROUP_TRIP_WORKFLOW.md spec.
"""

from enum import Enum
from typing import Optional, Literal, Dict, List
from pydantic import BaseModel, Field


class PoolingScope(str, Enum):
    """
    Controls which wallets the optimizer can draw from and who can pay for whose seats.
    
    Values:
    - individual_only: No cross-person pooling; each pays for their own seats
    - household_only: Pool only within each household_id; no cross-family pooling  
    - full_group: Optimizer can use any willing member's points for any traveler
    - sponsors_only: Only members with can_pay_for_others (or Sponsor role) can pay for others' seats
    """
    INDIVIDUAL_ONLY = "individual_only"
    HOUSEHOLD_ONLY = "household_only"
    FULL_GROUP = "full_group"
    SPONSORS_ONLY = "sponsors_only"


class MemberLifecycleState(str, Enum):
    """
    Tracks member state through the onboarding workflow.
    
    States:
    - invited: Invite sent; not yet accepted
    - joined_no_wallet: Joined trip but has not linked wallets/balances
    - wallet_connected: Balances (or ranges) provided; not yet approved for planning
    - approved_for_planning: OK for Tripy to use in optimized plan (within their willingness)
    - approved_for_booking: Approved their allocation; ready for checklist
    - inactive: Dropped or paused; exclude from optimization
    """
    INVITED = "invited"
    JOINED_NO_WALLET = "joined_no_wallet"
    WALLET_CONNECTED = "wallet_connected"
    APPROVED_FOR_PLANNING = "approved_for_planning"
    APPROVED_FOR_BOOKING = "approved_for_booking"
    INACTIVE = "inactive"


class DelegationScope(str, Enum):
    """Scope of delegation for booking authority."""
    PLANNING = "planning"  # Can approve plan using my points
    BOOKING = "booking"    # Can book using my points (requires planning)


class DelegatedBookingAuthority(BaseModel):
    """
    Represents delegation of booking authority to another household member.
    
    E.g., "my spouse can approve and book using my points"
    """
    delegate_user_id: str = Field(..., description="User ID of the delegate")
    scope: DelegationScope = Field(
        default=DelegationScope.PLANNING,
        description="What the delegate can do: planning or booking"
    )


class TripMemberRole(str, Enum):
    """Member roles in a trip."""
    OWNER = "owner"
    MEMBER = "member"
    VIEWER = "viewer"
    SPONSOR = "sponsor"  # Can pay for others' seats


class PassengerType(str, Enum):
    """Type of passenger."""
    ADULT = "adult"
    CHILD = "child"     # 2-11 years
    INFANT = "infant"   # Under 2 years (lap)


class PointsUsagePreference(str, Enum):
    """How Tripy may use a member's points."""
    FREELY = "freely"           # Use my points freely for group bookings
    ASK_BEFORE = "ask_before"   # Ask me before using my points
    DO_NOT_USE = "do_not_use"   # Do not use my points (view only)


# =============================================================================
# TASK 17: SETTLEMENT POLICY + POINTS VALUATION CONFIG
# =============================================================================

class SettlementPolicy(str, Enum):
    """
    How costs should be split after booking.
    
    Values:
    - pay_your_own: Each member pays for their own passengers (no reimbursement)
    - equal_per_passenger: Total cost split equally per passenger
    - equal_per_household: Total cost split equally per household
    - sponsor_pays_all: Sponsor(s) cover everything, no reimbursement needed
    - custom: Manual/custom split (allows per-passenger overrides)
    """
    PAY_YOUR_OWN = "pay_your_own"
    EQUAL_PER_PASSENGER = "equal_per_passenger"
    EQUAL_PER_HOUSEHOLD = "equal_per_household"
    SPONSOR_PAYS_ALL = "sponsor_pays_all"
    CUSTOM = "custom"


class PointsValuationMode(str, Enum):
    """
    How to convert points to USD-equivalent for settlement.
    
    Values:
    - market_implied: Use Tripy's market-derived valuations (e.g., 1.8 cpp for Chase UR)
    - fixed_by_currency: Fixed rate per program (configured per-trip)
    - user_defined: Users specify their own valuations
    """
    MARKET_IMPLIED = "market_implied"
    FIXED_BY_CURRENCY = "fixed_by_currency"
    USER_DEFINED = "user_defined"


class PointsValuationConfig(BaseModel):
    """
    Configuration for how points are valued in settlement calculations.
    """
    mode: PointsValuationMode = PointsValuationMode.MARKET_IMPLIED
    
    # Fixed rates by program (used when mode is FIXED_BY_CURRENCY or USER_DEFINED)
    # Key: program code (e.g., "chase", "UA"), Value: cents per point
    fixed_rates_cpp: Dict[str, float] = Field(
        default_factory=dict,
        description="Fixed cents-per-point rates by program"
    )
    
    # Min/max caps (optional safety bounds)
    min_cpp: Optional[float] = Field(
        default=0.5,
        description="Minimum cents per point (floor)"
    )
    max_cpp: Optional[float] = Field(
        default=5.0,
        description="Maximum cents per point (ceiling)"
    )
    
    # Whether to reimburse points value in settlement
    reimburse_points_value: bool = Field(
        default=True,
        description="If True, points used count as contributions worth their USD value"
    )


class TripSettlementConfig(BaseModel):
    """
    Complete settlement configuration for a trip.
    """
    policy: SettlementPolicy = SettlementPolicy.PAY_YOUR_OWN
    valuation: PointsValuationConfig = Field(default_factory=PointsValuationConfig)
    
    # Custom overrides (used when policy is CUSTOM)
    custom_obligations: Dict[str, float] = Field(
        default_factory=dict,
        description="Custom obligation amounts per passenger_id (USD)"
    )
    
    # Additional options
    include_taxes_in_split: bool = Field(
        default=True,
        description="If True, taxes/fees are included in the split"
    )
    round_to_cents: bool = Field(
        default=True,
        description="Round settlement amounts to nearest cent"
    )


# Settlement policy descriptions for UI
SETTLEMENT_POLICY_DESCRIPTIONS = {
    SettlementPolicy.PAY_YOUR_OWN: {
        "name": "Pay Your Own",
        "short": "Each person pays for their own travelers",
        "description": "The member who is responsible for each passenger pays for their tickets. "
                      "If you used your points for someone else's ticket, they reimburse you the USD value."
    },
    SettlementPolicy.EQUAL_PER_PASSENGER: {
        "name": "Equal Per Passenger",
        "short": "Split total cost equally per traveler",
        "description": "The total trip cost is divided equally among all passengers. "
                      "Each member's share is the number of passengers they're responsible for × per-passenger cost. "
                      "Reimbursements settle any differences from who actually paid."
    },
    SettlementPolicy.EQUAL_PER_HOUSEHOLD: {
        "name": "Equal Per Household",
        "short": "Split total cost equally per household",
        "description": "The total trip cost is divided equally among households (families). "
                      "All passengers in a household share that household's portion. "
                      "Great for family trips where each family wants to pay an equal share."
    },
    SettlementPolicy.SPONSOR_PAYS_ALL: {
        "name": "Sponsor Pays All",
        "short": "Sponsor(s) cover the entire trip",
        "description": "The designated sponsor(s) cover all costs. No reimbursement is needed from other members. "
                      "Perfect for corporate trips or when someone is treating the group."
    },
    SettlementPolicy.CUSTOM: {
        "name": "Custom Split",
        "short": "Manually specify each person's share",
        "description": "Set custom amounts for each passenger. Useful for complex arrangements "
                      "like 'adults pay full price, kids pay half' or specific pre-agreed splits."
    },
}

POINTS_VALUATION_DESCRIPTIONS = {
    PointsValuationMode.MARKET_IMPLIED: {
        "name": "Market Value",
        "short": "Use Tripy's market-based valuations",
        "description": "Points are valued at their fair market rate based on typical redemption values. "
                      "Example: Chase Ultimate Rewards ≈ 1.8¢/point, United MileagePlus ≈ 1.3¢/point."
    },
    PointsValuationMode.FIXED_BY_CURRENCY: {
        "name": "Fixed Rate",
        "short": "Use a fixed cents-per-point rate",
        "description": "Apply a consistent rate across all point currencies. "
                      "Simple and predictable, but may over/under-value some programs."
    },
    PointsValuationMode.USER_DEFINED: {
        "name": "Custom Rates",
        "short": "Set your own per-program valuations",
        "description": "Specify exactly how much each point currency is worth for this trip. "
                      "Great when your group has agreed on specific values."
    },
}


# Pydantic models for API requests/responses

class UpdatePoolingScopeRequest(BaseModel):
    """Request to update a trip's pooling scope."""
    pooling_scope: PoolingScope


class UpdatePoolingScopeResponse(BaseModel):
    """Response after updating pooling scope."""
    ok: bool
    pooling_scope: PoolingScope
    plan_invalidated: bool = Field(
        default=False,
        description="True if existing plan was invalidated and needs re-optimization"
    )


class UpdateMemberLifecycleRequest(BaseModel):
    """Request to update a member's lifecycle state."""
    lifecycle_state: MemberLifecycleState


class UpdateMemberLifecycleResponse(BaseModel):
    """Response after updating member lifecycle state."""
    ok: bool
    lifecycle_state: MemberLifecycleState
    previous_state: Optional[MemberLifecycleState] = None


class SetHouseholdRequest(BaseModel):
    """Request to set a member's household."""
    household_id: str = Field(..., min_length=1, max_length=100)


class SetDelegationRequest(BaseModel):
    """Request to set booking authority delegation."""
    delegate_user_id: str = Field(..., description="User ID of the delegate")
    scope: DelegationScope = DelegationScope.PLANNING


# =============================================================================
# SETTLEMENT CONFIGURATION REQUESTS/RESPONSES
# =============================================================================

class UpdateSettlementPolicyRequest(BaseModel):
    """Request to update a trip's settlement policy."""
    policy: SettlementPolicy


class UpdateSettlementConfigRequest(BaseModel):
    """Request to update the full settlement configuration."""
    policy: Optional[SettlementPolicy] = None
    valuation_mode: Optional[PointsValuationMode] = None
    fixed_rates_cpp: Optional[Dict[str, float]] = None
    min_cpp: Optional[float] = None
    max_cpp: Optional[float] = None
    reimburse_points_value: Optional[bool] = None
    include_taxes_in_split: Optional[bool] = None
    custom_obligations: Optional[Dict[str, float]] = None


class SettlementConfigResponse(BaseModel):
    """Response with full settlement configuration."""
    trip_id: str
    policy: SettlementPolicy
    policy_name: str
    policy_description: str
    valuation: PointsValuationConfig
    valuation_name: str
    valuation_description: str
    include_taxes_in_split: bool
    custom_obligations: Dict[str, float]


# =============================================================================
# PASSENGER MODELS (for dependents)
# =============================================================================

class Passenger(BaseModel):
    """
    Represents an actual traveler who needs a seat.
    
    A Member may have multiple Passengers (e.g., themselves + kids).
    Seat allocation is done at the Passenger level, not Member level.
    """
    passenger_id: str = Field(..., description="Unique passenger ID")
    trip_id: str = Field(..., description="Trip this passenger is on")
    guardian_user_id: str = Field(..., description="Member responsible for this passenger")
    
    # Passenger details (for booking)
    first_name: str = Field(..., min_length=1)
    last_name: str = Field(..., min_length=1)
    passenger_type: PassengerType = PassengerType.ADULT
    date_of_birth: Optional[str] = Field(None, description="DOB in YYYY-MM-DD format")
    
    # Booking details
    loyalty_number: Optional[str] = Field(None, description="Frequent flyer number")
    seat_preference: Optional[str] = Field(None, description="window/aisle/middle")
    special_needs: Optional[str] = Field(None, description="Wheelchair, dietary, etc.")
    
    # Status
    is_primary: bool = Field(default=False, description="True if this is the member themselves")


class CreatePassengerRequest(BaseModel):
    """Request to create a passenger under a member."""
    trip_id: str = Field(..., min_length=1)
    first_name: str = Field(..., min_length=1)
    last_name: str = Field(..., min_length=1)
    passenger_type: str = Field(default="adult", description="adult, child, or infant")
    date_of_birth: Optional[str] = Field(None, description="DOB in YYYY-MM-DD format")
    loyalty_number: Optional[str] = None
    seat_preference: Optional[str] = None
    special_needs: Optional[str] = None


class PassengerResponse(BaseModel):
    """Response for a passenger."""
    passenger_id: str
    trip_id: str
    guardian_user_id: str
    first_name: str
    last_name: str
    full_name: str
    passenger_type: str
    date_of_birth: Optional[str] = None
    loyalty_number: Optional[str] = None
    seat_preference: Optional[str] = None
    special_needs: Optional[str] = None
    is_primary: bool


class TripPassengersSummary(BaseModel):
    """Summary of passengers for a trip."""
    trip_id: str
    total_passengers: int
    adults: int
    children: int
    infants: int
    passengers_by_member: Dict[str, List[PassengerResponse]]


# Helper functions for lifecycle state transitions

VALID_LIFECYCLE_TRANSITIONS = {
    MemberLifecycleState.INVITED: [MemberLifecycleState.JOINED_NO_WALLET, MemberLifecycleState.INACTIVE],
    # Allow direct approval from joined_no_wallet (admin can approve even without points)
    MemberLifecycleState.JOINED_NO_WALLET: [MemberLifecycleState.WALLET_CONNECTED, MemberLifecycleState.APPROVED_FOR_PLANNING, MemberLifecycleState.INACTIVE],
    MemberLifecycleState.WALLET_CONNECTED: [MemberLifecycleState.APPROVED_FOR_PLANNING, MemberLifecycleState.JOINED_NO_WALLET, MemberLifecycleState.INACTIVE],
    MemberLifecycleState.APPROVED_FOR_PLANNING: [MemberLifecycleState.APPROVED_FOR_BOOKING, MemberLifecycleState.WALLET_CONNECTED, MemberLifecycleState.INACTIVE],
    MemberLifecycleState.APPROVED_FOR_BOOKING: [MemberLifecycleState.APPROVED_FOR_PLANNING, MemberLifecycleState.INACTIVE],
    MemberLifecycleState.INACTIVE: [MemberLifecycleState.JOINED_NO_WALLET],  # Can rejoin
}


def is_valid_lifecycle_transition(from_state: MemberLifecycleState, to_state: MemberLifecycleState) -> bool:
    """Check if a lifecycle state transition is valid."""
    valid_next = VALID_LIFECYCLE_TRANSITIONS.get(from_state, [])
    return to_state in valid_next


def get_default_pooling_scope(has_households: bool = False) -> PoolingScope:
    """
    Get the default pooling scope for a new trip.
    
    If any members have household_id set, default to household_only.
    Otherwise, default to individual_only for safety.
    """
    return PoolingScope.HOUSEHOLD_ONLY if has_households else PoolingScope.INDIVIDUAL_ONLY
