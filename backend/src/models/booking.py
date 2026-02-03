"""
Booking Models (Flight-Only)

Defines data models for flight booking allocation artifacts:
- SeatAllocation: Assigns a passenger to a flight with payment source
- Ticket: Contains fare breakdown and PNR reference
- PNR: Booking reference grouping passengers and segments

These models align with docs/GROUP_TRIP_WORKFLOW.md spec.
"""

from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class PaymentType(str, Enum):
    """How a seat is paid for."""
    POINTS = "points"
    CASH = "cash"
    MIXED = "mixed"  # Points for base fare, cash for taxes


class BookingStatus(str, Enum):
    """Status of a booking artifact."""
    PLANNED = "planned"       # In the plan, not yet executed
    PENDING = "pending"       # Execution started
    CONFIRMED = "confirmed"   # Booking complete
    FAILED = "failed"        # Booking failed
    CANCELLED = "cancelled"  # Booking cancelled


class SeatAllocation(BaseModel):
    """
    Assigns a passenger to a flight segment with payment source.
    
    This is the core allocation artifact from the optimizer.
    """
    allocation_id: str = Field(..., description="Unique allocation ID")
    
    # What/who
    passenger_id: str = Field(..., description="Passenger getting the seat")
    flight_id: str = Field(..., description="Flight segment ID")
    
    # Payment source
    payer_user_id: str = Field(..., description="Member paying for this seat")
    payment_type: PaymentType = PaymentType.CASH
    
    # Points payment details (if payment_type is POINTS or MIXED)
    points_source_wallet_id: Optional[str] = Field(None, description="Wallet providing points")
    points_program: Optional[str] = Field(None, description="Loyalty program code (e.g., UA, AA)")
    points_used: Optional[int] = Field(None, description="Points used for base fare")
    
    # Booking details
    cabin_class: str = Field(default="Economy")
    booking_class: Optional[str] = Field(None, description="Fare class code (e.g., Y, J, F)")
    
    # Status
    status: BookingStatus = BookingStatus.PLANNED
    
    # Metadata
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class Ticket(BaseModel):
    """
    Represents a ticket for a passenger, with fare breakdown.
    
    A ticket is created after booking and contains the actual costs.
    """
    ticket_id: str = Field(..., description="Unique ticket ID")
    seat_allocation_id: str = Field(..., description="Reference to seat allocation")
    
    # Passenger/flight reference
    passenger_id: str
    pnr_id: Optional[str] = Field(None, description="Reference to PNR")
    
    # Fare breakdown
    base_fare_type: PaymentType = Field(..., description="How base fare is paid")
    base_fare_points: Optional[int] = Field(None, description="Points for base fare")
    base_fare_cash: Optional[float] = Field(None, description="Cash for base fare")
    
    # Taxes and fees (always cash)
    taxes_fees_cash: float = Field(default=0.0)
    taxes_fees_payer_user_id: str = Field(..., description="Who pays taxes/fees")
    
    # Total
    total_out_of_pocket: float = Field(..., description="Total cash paid")
    
    # Booking reference
    ticket_number: Optional[str] = Field(None, description="Airline ticket number")
    
    # Status
    status: BookingStatus = BookingStatus.PLANNED
    
    # Timestamps
    issued_at: Optional[str] = None


class FlightSegmentRef(BaseModel):
    """Reference to a flight segment within a PNR."""
    segment_id: str
    origin: str
    destination: str
    departure_date: str
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    flight_number: str
    airline: str
    operating_airline: Optional[str] = None
    cabin_class: str = "Economy"


class PassengerRef(BaseModel):
    """Reference to a passenger within a PNR."""
    passenger_id: str
    first_name: str
    last_name: str
    passenger_type: str = "adult"
    ticket_number: Optional[str] = None


class PNR(BaseModel):
    """
    Passenger Name Record - booking reference grouping passengers and segments.
    
    Multiple passengers may share a PNR if booked together.
    A single flight may have multiple PNRs if different payers/programs are used.
    """
    pnr_id: str = Field(..., description="Internal PNR ID")
    trip_id: str = Field(..., description="Trip this PNR belongs to")
    
    # Booking reference
    booking_reference: Optional[str] = Field(None, description="Airline confirmation code")
    airline: str = Field(..., description="Marketing carrier")
    
    # What's in this PNR
    passengers: List[PassengerRef] = Field(default_factory=list)
    segments: List[FlightSegmentRef] = Field(default_factory=list)
    
    # Payment summary
    payer_user_id: str = Field(..., description="Primary payer for this PNR")
    total_cost: float = Field(default=0.0)
    points_used: Optional[int] = None
    program_used: Optional[str] = None
    
    # Status
    status: BookingStatus = BookingStatus.PLANNED
    
    # Timestamps
    created_at: Optional[str] = None
    confirmed_at: Optional[str] = None
    
    # Metadata
    notes: Optional[str] = None


class PlanDraftAllocation(BaseModel):
    """
    Summary of allocations in a plan draft.
    
    This is what the optimizer outputs for each itinerary.
    """
    plan_id: str = Field(..., description="Plan draft ID")
    trip_id: str = Field(..., description="Trip ID")
    itinerary_id: str = Field(..., description="Selected itinerary ID")
    
    # Allocations
    seat_allocations: List[SeatAllocation] = Field(default_factory=list)
    
    # Proposed tickets (not yet issued)
    proposed_tickets: List[Ticket] = Field(default_factory=list)
    
    # PNR grouping (how passengers will be ticketed together)
    pnr_groups: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Grouping of passengers into PNRs"
    )
    
    # Summary
    total_out_of_pocket: float = Field(default=0.0)
    total_points_used: int = Field(default=0)
    points_by_program: Dict[str, int] = Field(default_factory=dict)
    
    # Risk/warnings
    risk_score: Optional[float] = None
    risk_level: Optional[str] = None  # low, medium, high
    warnings: List[str] = Field(default_factory=list)
    
    # Status
    status: str = Field(default="draft")  # draft, approved, locked, executed
    
    # Timestamps
    created_at: Optional[str] = None
    locked_at: Optional[str] = None


# =============================================================================
# LEDGER MODELS
# =============================================================================

class LedgerEntryType(str, Enum):
    """Type of ledger entry."""
    POINTS_CONTRIBUTION = "points_contribution"
    CASH_PAYMENT = "cash_payment"
    TAXES_FEES = "taxes_fees"
    SETTLEMENT = "settlement"


class LedgerEntry(BaseModel):
    """
    A single entry in the trip ledger.
    
    Tracks all financial movements for reconciliation.
    """
    entry_id: str
    trip_id: str
    ticket_id: Optional[str] = None
    
    # What
    entry_type: LedgerEntryType
    description: str
    
    # Who
    payer_user_id: str
    beneficiary_passenger_id: Optional[str] = None
    
    # Amount
    points_amount: Optional[int] = None
    points_program: Optional[str] = None
    cash_amount: Optional[float] = None
    
    # Status
    status: str = "pending"  # pending, confirmed
    
    # Timestamps
    created_at: Optional[str] = None


class LedgerSummary(BaseModel):
    """
    Summary of the trip ledger.
    
    Can be grouped by traveler, household, or payer.
    """
    trip_id: str
    grouping: str = "traveler"  # traveler, household, payer
    
    entries: List[LedgerEntry] = Field(default_factory=list)
    
    # Totals
    total_points_used: Dict[str, int] = Field(default_factory=dict)  # program -> points
    total_cash_paid: float = Field(default=0.0)
    total_taxes_fees: float = Field(default=0.0)
    
    # Per-group summaries
    by_group: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
