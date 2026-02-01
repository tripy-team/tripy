"""
Data models for the agentic optimization system.
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal, Any
from datetime import datetime, date


# =============================================================================
# POLICY TYPES (inline for Pydantic compatibility)
# =============================================================================

class PolicyMessageModel(BaseModel):
    """Policy message for API responses."""
    code: str
    severity: Literal["info", "warn", "block"]
    title: str
    detail: str
    context: dict[str, Any] = {}
    requires_ack: bool = False
    ack_text: Optional[str] = None


class PolicyEvaluationModel(BaseModel):
    """Policy evaluation for API responses."""
    blocks: list[PolicyMessageModel] = []
    warnings: list[PolicyMessageModel] = []
    info: list[PolicyMessageModel] = []
    requires_ack: list[str] = []
    is_blocked: bool = False
    risk_score: int = 0
    explanations: list[str] = []


# Risk mode type
RiskMode = Literal["safe", "balanced", "aggressive"]


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
    
    # Data freshness
    fetched_at: Optional[str] = None  # ISO timestamp when data was fetched
    is_verified: bool = False  # Whether flight was cross-verified with Google Flights
    verification_status: Optional[str] = None  # "verified", "unverified", "stale"


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

class FlightLeg(BaseModel):
    """A single flight leg (one takeoff and landing) within a flight segment.
    
    For connecting flights, each leg represents one individual flight.
    Users need this information to book and board each flight.
    """
    flight_number: str  # e.g., "DL 2055"
    marketing_carrier: str  # Airline selling the ticket (e.g., "Delta")
    operating_carrier: Optional[str] = None  # Actual operator if codeshare (e.g., "Air France")
    
    origin: str  # Airport code (e.g., "SEA")
    origin_terminal: Optional[str] = None  # Terminal (e.g., "A")
    destination: str  # Airport code (e.g., "CDG")
    destination_terminal: Optional[str] = None
    
    departure_time: str  # ISO format datetime
    arrival_time: str  # ISO format datetime
    duration_minutes: int
    
    aircraft: Optional[str] = None  # e.g., "Boeing 777-300ER"
    cabin_class: str = "Economy"
    
    # Codeshare info for display
    is_codeshare: bool = False
    codeshare_info: Optional[str] = None  # e.g., "Operated by Air France as AF 1234"


class FlightSegment(BaseModel):
    """A flight segment in the itinerary (may include connecting flights)."""
    id: str
    type: Literal["flight"] = "flight"
    
    # Overall journey info
    origin: str  # First departure airport
    destination: str  # Final arrival airport
    departure_time: Optional[str] = None  # First departure
    arrival_time: Optional[str] = None  # Final arrival
    duration_minutes: Optional[int] = None  # Total journey time
    
    # Primary airline (marketing carrier for first leg)
    airline: str
    flight_number: Optional[str] = None  # Summary: "DL 2055" or "DL 2055 → SK 944"
    cabin_class: str = "Economy"
    # Operating airline for codeshare flights (may differ from marketing carrier)
    operating_airline: Optional[str] = None
    
    # Connection details
    stops: int = 0  # Number of stops (0 = nonstop)
    legs: list[FlightLeg] = []  # Detailed info for each flight leg
    layovers: list[dict] = []  # Layover info: [{"airport": "JFK", "duration_minutes": 90}]
    
    cash_price: float
    payment: CashPayment | PointsPayment
    
    # Booking verification
    booking_url: Optional[str] = None
    booking_reference: Optional[str] = None  # Confirmation number if available
    google_flights_url: Optional[str] = None  # Link to verify on Google Flights
    verification_note: Optional[str] = None  # Note about data freshness
    data_source: Optional[str] = None  # "google_flights", "award_program", etc.
    fetched_at: Optional[str] = None  # ISO timestamp when flight data was fetched
    is_verified: bool = False  # Whether flight was verified against Google Flights
    verification_status: Optional[str] = None  # "verified", "unverified", "stale", "not_found"
    
    # Policy evaluation
    policy_evaluation: Optional[PolicyEvaluationModel] = None
    disabled: bool = False
    disable_reason: Optional[str] = None


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
    
    # Policy evaluation
    policy_evaluation: Optional[PolicyEvaluationModel] = None
    disabled: bool = False
    disable_reason: Optional[str] = None


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
    
    # Policy evaluation for the entire itinerary
    policy_evaluation: Optional[PolicyEvaluationModel] = None
    disabled: bool = False
    disable_reason: Optional[str] = None
    
    # Booking structure recommendation
    booking_structure_recommendation: Optional[Literal["two_one_ways", "round_trip"]] = None


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
    
    # Policy settings
    risk_mode: RiskMode = "balanced"  # safe, balanced, aggressive
    include_basic_economy: bool = False  # Include basic economy fares?
    flexibility_priority: Literal["low", "medium", "high"] = "medium"
    acknowledged_policy_codes: list[str] = []  # Codes user has acknowledged


class OptimizeGroupRequest(OptimizeSoloRequest):
    """Request for group trip optimization."""
    member_points: dict[str, dict[str, int]] = {}  # member_id -> program -> balance
    member_budgets: dict[str, float] = {}
    split_method: Optional[Literal["equal", "by_usage", "proportional"]] = "by_usage"


class PolicySummaryModel(BaseModel):
    """Summary of policy evaluation across all options."""
    total_options: int = 0
    blocked_count: int = 0
    warning_count: int = 0
    code_counts: dict[str, int] = {}
    risk_mode: str = "balanced"


class OptimizeSoloResponse(BaseModel):
    """Response for solo trip optimization."""
    trip_id: str
    itineraries: list[RankedItinerary]
    best_option: dict
    warnings: list[str] = []
    
    # Policy summary
    policy_summary: Optional[PolicySummaryModel] = None
    risk_mode: RiskMode = "balanced"


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
