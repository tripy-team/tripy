"""
Data models for group booking allocation.

CRITICAL: Points are per-member, NOT poolable.
Each member can only use their OWN points for segments they book.
"""

from typing import Literal, Optional
from enum import Enum
from dataclasses import dataclass, field
from pydantic import BaseModel, Field


# =============================================================================
# ENUMS
# =============================================================================

class SettlementSplitMethod(str, Enum):
    """Methods for splitting costs among group members."""
    EQUAL = "equal"                              # Everyone pays same amount
    PROPORTIONAL_TRAVELERS = "proportional_travelers"  # Based on # of travelers
    PROPORTIONAL_POINTS = "proportional_points"        # Based on points contributed
    CUSTOM = "custom"                            # User-defined percentages


# =============================================================================
# VALIDATION RESULT
# =============================================================================

@dataclass
class AllocationValidationResult:
    """Result of input validation."""
    valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# =============================================================================
# MEMBER STATE TRACKING
# =============================================================================

@dataclass
class MemberState:
    """
    Tracks a member's remaining resources during allocation.
    
    This is used internally to ensure budget and points constraints
    are tracked cumulatively across multiple segment assignments.
    """
    member_id: str
    remaining_points: dict[str, int]  # program -> balance
    remaining_budget: Optional[float]  # None = unlimited
    cash_spent: float = 0.0
    points_spent: dict[str, int] = field(default_factory=dict)
    
    def can_afford_cash(self, amount: float) -> bool:
        """Check if member can afford additional cash expense."""
        if self.remaining_budget is None:
            return True
        return self.remaining_budget >= amount
    
    def spend_cash(self, amount: float) -> None:
        """Record cash spending."""
        if self.remaining_budget is not None:
            if amount > self.remaining_budget + 0.01:  # Allow small float errors
                raise ValueError(f"Cash {amount} exceeds remaining budget {self.remaining_budget}")
            self.remaining_budget -= amount
        self.cash_spent += amount
    
    def can_afford_points(self, program: str, points: int) -> bool:
        """Check if member can afford points expense."""
        return self.remaining_points.get(program, 0) >= points
    
    def spend_points(self, program: str, points: int) -> None:
        """Record points spending."""
        available = self.remaining_points.get(program, 0)
        if points > available:
            raise ValueError(f"Points {points} exceeds available {available} for {program}")
        self.remaining_points[program] = available - points
        self.points_spent[program] = self.points_spent.get(program, 0) + points
    
    def copy(self) -> 'MemberState':
        """Create a deep copy for simulation."""
        return MemberState(
            member_id=self.member_id,
            remaining_points=dict(self.remaining_points),
            remaining_budget=self.remaining_budget,
            cash_spent=self.cash_spent,
            points_spent=dict(self.points_spent),
        )


# =============================================================================
# TRANSFER OPTION
# =============================================================================

@dataclass
class TransferOption:
    """A possible transfer source for points."""
    source_program: str
    target_program: str
    ratio: float
    transfer_time: str
    source_balance: int
    effective_points: int  # How many target points this provides
    
    @property
    def priority_score(self) -> float:
        """
        Higher score = more valuable to preserve.
        We want to use LOWER priority sources first.
        
        Factors:
        - Ratio (1:1 is more valuable than 1:2)
        - Balance (preserve larger balances)
        - Transfer time (instant is more flexible)
        """
        ratio_score = self.ratio  # Higher ratio = more valuable
        balance_score = min(self.source_balance / 100000, 1.0)  # Normalize to 0-1
        time_score = 1.0 if "instant" in self.transfer_time.lower() else 0.5
        
        return ratio_score * 0.5 + balance_score * 0.3 + time_score * 0.2


# =============================================================================
# TRANSFER DETAIL (for tracking actual transfers)
# =============================================================================

@dataclass
class TransferDetail:
    """
    Details about a point transfer from a bank to an airline/hotel program.
    
    This captures the actual transfer that needs to happen, not just
    the possibility of a transfer.
    """
    # Source (bank)
    source_program: str           # "Chase UR", "Amex MR"
    source_program_name: str      # "Chase Ultimate Rewards"
    source_points: int            # Bank points to transfer (before ratio)
    
    # Target (airline/hotel)
    target_program: str           # "UA", "HH", "HYATT"
    target_program_name: str      # "United MileagePlus"
    target_program_type: str      # "airline" or "hotel"
    target_points: int            # Points received (after ratio)
    
    # Transfer details
    ratio: float                  # 1.0 or 2.0 (for Hilton)
    ratio_display: str            # "1:1" or "1:2"
    transfer_time: str            # "Instant", "1-2 business days"
    
    # URLs
    portal_url: str               # Where to make transfer
    booking_url: str              # Where to book after transfer
    
    # For grouping
    for_segment_id: Optional[str] = None
    for_member_id: Optional[str] = None


class TransferSummary(BaseModel):
    """
    Consolidated transfer for API response.
    Groups transfers by (member, source, target).
    """
    member_id: str
    member_name: str
    
    # Source bank
    from_program: str             # "Chase UR"
    from_program_name: str        # "Chase Ultimate Rewards"
    
    # Target program
    to_program: str               # "UA"
    to_program_name: str          # "United MileagePlus"
    to_program_type: str          # "airline" or "hotel"
    
    # Transfer details
    total_source_points: int      # Total bank points to transfer
    total_target_points: int      # Total points received
    ratio: float
    ratio_display: str            # "1:1"
    transfer_time: str            # "Instant"
    
    # URLs for action
    portal_url: str
    booking_url: str
    
    # Step-by-step instructions
    steps: list[str] = Field(default_factory=list)
    
    # Which segments this transfer covers
    covers_segments: list[str] = Field(default_factory=list)


# =============================================================================
# TRIP STRUCTURE
# =============================================================================

@dataclass
class TripStructure:
    """Understanding of trip's outbound/return structure."""
    origin: str
    destination_count: int
    outbound_segments: list[str]  # segment IDs
    return_segments: list[str]    # segment IDs
    hotel_segments: list[str]     # segment IDs


# =============================================================================
# MEMBER BOOKING CAPABILITY
# =============================================================================

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
    
    # For proportional settlement splits
    traveler_count: int = Field(
        default=1,
        description="How many people this member is booking for"
    )
    
    # For custom settlement splits
    custom_split_percentage: Optional[float] = Field(
        default=None,
        description="Custom split percentage (0-100) for custom settlement method"
    )


class BookingAssignment(BaseModel):
    """
    Assignment of ONE segment to ONE member.
    
    The assigned member will:
    1. Transfer points if needed (using transfer_* fields)
    2. Make the actual booking (login to their account)
    3. Use their own points (if uses_points=True)
    4. Pay the cash amount from their card
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
    points_program: Optional[str] = None       # Target program: "UA", "HH"
    points_program_name: Optional[str] = None  # "United MileagePlus"
    points_used: Optional[int] = None          # Target points used
    cash_amount: float                          # Cash they pay (surcharge or full price)
    
    # === NEW: Transfer details (if points come from bank transfer) ===
    requires_transfer: bool = False
    transfer_from: Optional[str] = None              # Source bank: "Chase UR"
    transfer_from_name: Optional[str] = None         # "Chase Ultimate Rewards"
    transfer_points_from_source: Optional[int] = None  # Bank points to transfer
    transfer_ratio: Optional[float] = None           # 1.0 or 2.0
    transfer_ratio_display: Optional[str] = None     # "1:1" or "1:2"
    transfer_time: Optional[str] = None              # "Instant", "1-2 days"
    transfer_portal_url: Optional[str] = None        # URL to make transfer
    booking_url: Optional[str] = None                # URL to book after transfer
    
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
    split_method_used: str = "equal"
    
    # All segment assignments
    assignments: list[BookingAssignment]
    
    # === NEW: Consolidated transfer instructions ===
    transfers_needed: list[TransferSummary] = Field(
        default_factory=list,
        description="Consolidated transfers grouped by member/source/target"
    )
    
    # Per-member summaries
    member_summaries: list[MemberBookingSummary]
    
    # Money transfers needed
    settlements: list[Settlement]
    
    # Overall metrics
    total_group_oop: float           # Total cash paid by group
    total_points_used: int           # Total points used across all members
    per_person_effective_cost: float # After settlement, each pays this
    
    # === NEW: Transfer metrics ===
    total_transfers_needed: int = 0
    total_source_points_transferred: int = 0
    
    # Validation
    all_segments_assigned: bool
    all_members_within_budget: bool
    all_members_within_points: bool
    
    # Warnings from validation
    warnings: list[str] = Field(default_factory=list)
