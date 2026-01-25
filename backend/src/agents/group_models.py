"""
Data models for group booking allocation.

CRITICAL: Points are per-member, NOT poolable.
Each member can only use their OWN points for segments they book.
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field


class MemberBookingCapability(BaseModel):
    """
    A group member's ability to make bookings.
    
    IMPORTANT: points dict represents THIS MEMBER's balances only.
    Points cannot be shared or transferred between members.
    """
    member_id: str
    member_name: str
    
    # This member's points balances (not pooled with others)
    points: dict[str, int] = Field(
        default_factory=dict,
        description="Program name -> balance. E.g., {'Chase UR': 100000, 'United': 50000}"
    )
    
    # Optional budget constraint for this member
    max_cash_budget: Optional[float] = Field(
        default=None,
        description="Maximum cash this member is willing to pay upfront"
    )
    
    # Credit cards this member has (for earning recommendations)
    credit_cards: list[str] = Field(
        default_factory=list,
        description="Card names for booking recommendations"
    )


class BookingAssignment(BaseModel):
    """
    Assignment of ONE segment to ONE member.
    
    The assigned member will:
    1. Make the actual booking (login to their account)
    2. Use their own points (if uses_points=True)
    3. Pay the cash amount from their card
    """
    segment_id: str
    segment_type: Literal["flight", "hotel"]
    
    # Who books this segment
    assigned_to: str  # member_id
    assigned_to_name: str
    
    # Why this assignment was made
    reason: str
    
    # Payment details (from this member's resources)
    uses_points: bool
    points_program: Optional[str] = None  # Which program (from their account)
    points_used: Optional[int] = None     # How many points (from their balance)
    cash_amount: float                     # Cash they pay (surcharge or full price)
    
    # Segment details for display
    segment_summary: Optional[str] = None  # "JFK → CDG, United 123"


class Settlement(BaseModel):
    """
    A money transfer between two members to balance costs.
    
    After all bookings, each member should pay their fair share.
    If Alice paid $300 and Bob paid $100 for a 2-person trip,
    Bob owes Alice $100 (so each effectively paid $200).
    """
    from_member: str  # member_id who owes money
    from_name: str
    to_member: str    # member_id who is owed money
    to_name: str
    amount: float     # Amount to transfer
    reason: str = "Settlement for group trip bookings"


class MemberBookingSummary(BaseModel):
    """Summary of what one member books and pays."""
    member_id: str
    member_name: str
    
    # Segments this member books
    segments_to_book: list[str]  # segment_ids
    segment_count: int
    
    # What they pay upfront (before settlement)
    total_cash_upfront: float
    total_points_used: int
    programs_used: list[str]
    
    # After settlement
    fair_share: float        # What they should pay
    settlement_amount: float  # Positive = they owe, Negative = they're owed
    final_cost: float        # fair_share (what they effectively pay)


class BookingAllocationStrategy(BaseModel):
    """Strategy for allocating bookings."""
    strategy_type: Literal[
        "optimize",        # ILP finds optimal assignment
        "by_segment_type", # One person books flights, another hotels
        "by_direction",    # One books outbound, another return
        "manual",          # User specifies each assignment
    ]
    
    # For by_segment_type strategy
    flight_booker: Optional[str] = None  # member_id
    hotel_booker: Optional[str] = None   # member_id
    
    # For by_direction strategy
    outbound_booker: Optional[str] = None
    return_booker: Optional[str] = None
    
    # For manual strategy
    manual_assignments: dict[str, str] = Field(
        default_factory=dict,
        description="segment_id -> member_id"
    )


class GroupBookingPlan(BaseModel):
    """
    Complete booking plan for a group trip.
    
    This is the main output of GroupBookingAllocator.
    """
    trip_id: str
    strategy_used: str
    
    # All segment assignments
    assignments: list[BookingAssignment]
    
    # Per-member summaries
    member_summaries: list[MemberBookingSummary]
    
    # Money transfers needed
    settlements: list[Settlement]
    
    # Overall metrics
    total_group_oop: float           # Total cash paid by group
    total_points_used: int           # Total points used across all members
    per_person_effective_cost: float # After settlement, each pays this
    
    # Validation
    all_segments_assigned: bool
    all_members_within_budget: bool
    all_members_within_points: bool
