"""
Data models for the agentic optimization system.
"""

from pydantic import BaseModel
from typing import Optional, Literal
from datetime import datetime, date


# =============================================================================
# FLIGHT MODELS
# =============================================================================

class FlightSearchRequest(BaseModel):
    """Request for flight search."""
    origin: str
    destination: str
    date: str  # YYYY-MM-DD
    cabin_classes: list[str] = ["Economy", "Business"]
    travelers: int = 1
    user_points: dict[str, int] = {}  # program -> balance


class FlightOption(BaseModel):
    """Unified flight option from any source."""
    id: str
    source: Literal["awardtool", "serpapi", "dummy"]
    
    # Route
    origin: str
    destination: str
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    stops: int = 0
    
    # Flight details
    airline: str
    operating_airline: Optional[str] = None
    flight_numbers: list[str] = []
    
    # Cabin
    cabin_class: str = "Economy"
    
    # Pricing - Cash
    cash_price: Optional[float] = None
    
    # Pricing - Award
    award_program: Optional[str] = None
    award_points: Optional[int] = None
    award_surcharge: Optional[float] = None
    award_available: bool = False
    
    # Calculated
    cpp: Optional[float] = None  # Cents per point
    oop_if_award: Optional[float] = None  # Out-of-pocket if using award
    
    # Metadata
    booking_url: Optional[str] = None
    seats_remaining: Optional[int] = None


class FlightSearchResult(BaseModel):
    """Result from flight search."""
    origin: str
    destination: str
    date: str
    options: list[FlightOption] = []
    programs_searched: list[str] = []
    cabins_searched: list[str] = []
    search_duration_ms: int = 0
    errors: list[str] = []


# =============================================================================
# HOTEL MODELS
# =============================================================================

class HotelSearchRequest(BaseModel):
    """Request for hotel search."""
    city: str
    check_in: str  # YYYY-MM-DD
    check_out: str  # YYYY-MM-DD
    guests: int = 1
    star_ratings: list[int] = [4, 5]
    user_points: dict[str, int] = {}


class HotelOption(BaseModel):
    """Unified hotel option from any source."""
    id: str
    source: Literal["awardtool", "serpapi", "dummy"]
    
    # Property
    name: str
    brand: Optional[str] = None
    star_rating: int = 4
    address: Optional[str] = None
    city: str
    
    # Dates
    check_in: str
    check_out: str
    nights: int
    
    # Room
    room_type: Optional[str] = None
    guests: int = 1
    
    # Pricing - Cash
    cash_price_per_night: Optional[float] = None
    cash_price_total: Optional[float] = None
    
    # Pricing - Award
    award_program: Optional[str] = None
    award_points_per_night: Optional[int] = None
    award_points_total: Optional[int] = None
    award_surcharge: Optional[float] = None
    award_available: bool = False
    
    # Calculated
    cpp: Optional[float] = None
    oop_if_award: Optional[float] = None
    
    # Metadata
    booking_url: Optional[str] = None
    amenities: list[str] = []


class HotelSearchResult(BaseModel):
    """Result from hotel search."""
    city: str
    check_in: str
    check_out: str
    options: list[HotelOption] = []
    programs_searched: list[str] = []
    star_ratings_searched: list[int] = []
    search_duration_ms: int = 0
    errors: list[str] = []


# =============================================================================
# PAYMENT & TRANSFER MODELS
# =============================================================================

class TransferInstruction(BaseModel):
    """Instructions for transferring points."""
    from_program: str  # e.g., "Chase UR"
    to_program: str  # e.g., "United MileagePlus"
    points_to_transfer: int
    ratio: float = 1.0
    portal_url: str
    transfer_time: str = "Instant"
    steps: list[str] = []
    warning: Optional[str] = None


class CashPayment(BaseModel):
    """Cash payment for a segment."""
    method: Literal["cash"] = "cash"
    amount: float
    payer: Optional[str] = None
    reason: Optional[str] = None


class PointsPayment(BaseModel):
    """Points payment for a segment."""
    method: Literal["points"] = "points"
    program: str
    points_used: int
    surcharge: float = 0.0
    cpp_achieved: Optional[float] = None
    cash_saved: Optional[float] = None
    transfer: Optional[TransferInstruction] = None
    payer: Optional[str] = None
    reason: Optional[str] = None


# =============================================================================
# OOP METRICS
# =============================================================================

class OOPMetrics(BaseModel):
    """Out-of-pocket metrics for an itinerary."""
    total_cash_price: float  # If paid all cash
    total_out_of_pocket: float  # Actual cash paid
    total_points_used: int
    cash_saved: float
    savings_percentage: float
    average_cpp: float
    points_breakdown: dict[str, int] = {}  # program -> points


# =============================================================================
# SEGMENT MODELS
# =============================================================================

class FlightSegment(BaseModel):
    """A flight segment in the itinerary."""
    id: str
    type: Literal["flight"] = "flight"
    
    origin: str
    destination: str
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    
    airline: str
    flight_number: Optional[str] = None
    cabin_class: str = "Economy"
    
    cash_price: float
    payment: CashPayment | PointsPayment
    
    booking_url: Optional[str] = None


class HotelSegment(BaseModel):
    """A hotel segment in the itinerary."""
    id: str
    type: Literal["hotel"] = "hotel"
    
    name: str
    brand: Optional[str] = None
    star_rating: int = 4
    city: str
    
    check_in: str
    check_out: str
    nights: int
    
    cash_price_per_night: float
    cash_price_total: float
    payment: CashPayment | PointsPayment
    
    booking_url: Optional[str] = None


# =============================================================================
# RANKED ITINERARY
# =============================================================================

class RankedItinerary(BaseModel):
    """A ranked itinerary optimized for OOP."""
    id: str
    rank: int  # 1 = best OOP
    name: str
    
    route: list[str]  # ["JFK", "CDG", "FCO", "JFK"]
    segments: list[FlightSegment | HotelSegment]
    
    oop_metrics: OOPMetrics
    transfers: list[TransferInstruction] = []
    
    within_budget: bool = True
    within_points: bool = True
    
    summary: Optional[str] = None  # AI-generated summary


# =============================================================================
# GROUP-SPECIFIC MODELS
# =============================================================================

class GroupMemberCost(BaseModel):
    """Cost breakdown for a group member."""
    member_id: str
    member_name: str
    base_cost: float
    points_contribution: float
    final_cost: float
    points_used: int
    programs_used: list[str] = []


class Settlement(BaseModel):
    """Settlement between group members."""
    from_member: str
    from_name: str
    to_member: str
    to_name: str
    amount: float
    reason: str


class GroupOOPMetrics(OOPMetrics):
    """OOP metrics for group trips."""
    member_costs: list[GroupMemberCost] = []
    settlements: list[Settlement] = []
    per_person_average: float = 0.0


# =============================================================================
# API REQUEST/RESPONSE MODELS
# =============================================================================

class OptimizeSoloRequest(BaseModel):
    """Request for solo trip optimization."""
    trip_id: str
    points: dict[str, int]  # program -> balance
    budget: float
    cabin_classes: Optional[list[str]] = None
    hotel_stars: Optional[list[int]] = None
    include_hotels: Optional[bool] = True


class OptimizeGroupRequest(OptimizeSoloRequest):
    """Request for group trip optimization."""
    member_points: dict[str, dict[str, int]] = {}  # member_id -> program -> balance
    member_budgets: dict[str, float] = {}
    split_method: Optional[Literal["equal", "by_usage", "proportional"]] = "by_usage"


class OptimizeSoloResponse(BaseModel):
    """Response for solo trip optimization."""
    trip_id: str
    itineraries: list[RankedItinerary]
    best_option: dict
    warnings: list[str] = []


class OptimizeGroupResponse(BaseModel):
    """Response for group trip optimization."""
    trip_id: str
    itineraries: list[RankedItinerary]
    group_metrics: Optional[GroupOOPMetrics] = None
    best_option: dict
    warnings: list[str] = []


# =============================================================================
# COST BREAKDOWN
# =============================================================================

class SegmentBreakdown(BaseModel):
    """Detailed breakdown for a segment."""
    segment: str  # "JFK → CDG (Business)"
    type: Literal["flight", "hotel"]
    cash_price: float
    payment_method: Literal["cash", "points"]
    amount: Optional[float] = None  # For cash
    program: Optional[str] = None  # For points
    points_used: Optional[int] = None
    surcharge: Optional[float] = None
    cpp_achieved: Optional[float] = None
    reason: Optional[str] = None
    transfer: Optional[TransferInstruction] = None


class CostBreakdown(BaseModel):
    """Complete cost breakdown from AI agent."""
    trip_summary: dict
    segments: list[SegmentBreakdown]
    transfer_summary: dict
    payment_breakdown: dict
    value_analysis: dict
