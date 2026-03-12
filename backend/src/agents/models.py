"""
Data models for the agentic optimization system.
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal, Any
from datetime import datetime, date


# =============================================================================
# BUDGET CONSTANTS
# =============================================================================

# Sentinel value representing "no budget limit" - use instead of None
# This prevents TypeError when comparing float <= None throughout the pipeline
NO_BUDGET_LIMIT: float = 1e9  # $1 billion - effectively unlimited


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
    
    # Advanced filters (Google Flights parity)
    include_budget_airlines: bool = True  # If True, sort_by=2 (price, includes all); if False, sort_by=1 (best quality)
    max_stops: int = 0  # 0=Any, 1=Nonstop, 2=1 stop or fewer, 3=2 stops or fewer
    departure_hour_range: Optional[list[int]] = None  # [startHour, endHour]
    arrival_hour_range: Optional[list[int]] = None  # [startHour, endHour]


class Layover(BaseModel):
    """Layover between flight legs."""
    airport: str                          # Connection airport code
    airport_name: Optional[str] = None    # Full name
    duration_minutes: int                 # Time between flights
    terminal_change: bool = False         # Requires terminal change
    
    @property
    def is_short(self) -> bool:
        """Less than 60 minutes is risky."""
        return self.duration_minutes < 60
    
    @property
    def is_long(self) -> bool:
        """More than 4 hours is a long layover."""
        return self.duration_minutes > 240


class FlightOption(BaseModel):
    """
    Unified flight option from any source.
    
    CRITICAL INVARIANT: If stops > 0, segments MUST have length >= 2.
    The adapter should NOT fabricate single segments for multi-stop flights.
    """
    id: str
    source: Literal["awardtool", "serpapi", "dummy"]
    
    # Route (top-level for quick access)
    origin: str                           # First departure airport
    destination: str                      # Final arrival airport
    departure_time: Optional[str] = None  # First leg departure
    arrival_time: Optional[str] = None    # Last leg arrival
    duration_minutes: Optional[int] = None  # Total journey time
    
    # CRITICAL: Per-leg segment data - this is where connections live!
    # Note: Using forward reference since FlightLeg is defined later in the file
    segments: list["FlightLeg"] = []
    layovers: list[Layover] = []
    
    @property
    def stops(self) -> int:
        """Number of stops - DERIVED from segments, not stored independently."""
        if self.segments:
            return max(0, len(self.segments) - 1)
        return self._stops_hint or 0
    
    # Fallback if segments not populated (legacy/AwardTool)
    _stops_hint: Optional[int] = None
    
    # Flight details (marketing carrier of first leg for display)
    airline: str
    operating_airline: Optional[str] = None  # Operating carrier if codeshare
    flight_numbers: list[str] = []           # All flight numbers for quick access
    
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
    
    # Ticketing info (defaults to UNKNOWN, not optimistic assumptions)
    ticketing_confirmed: bool = False  # True only if source explicitly confirms single ticket
    
    @property
    def has_carrier_change(self) -> bool:
        """True if MARKETING carriers change between legs (indicates separate booking risk).
        
        IMPORTANT: Different OPERATING carriers with the same MARKETING carrier is a
        codeshare, NOT a carrier change. Codeshare flights are on a single reservation.
        E.g., DL-marketed flights operated by AS + BF = single DL reservation.
        
        We check marketing carriers first. If all legs share the same marketing carrier,
        there's no carrier change. We also check if the top-level airline unifies the
        segments (the parent itinerary's marketing carrier).
        """
        if len(self.segments) < 2:
            return False
        
        # Normalize carrier code to 2-letter IATA
        def _normalize(code: str) -> str:
            return (code or "").strip().upper()[:2]
        
        # Collect marketing carriers across legs
        marketing_carriers = set()
        for s in self.segments:
            mkt = _normalize(s.marketing_carrier)
            if mkt:
                marketing_carriers.add(mkt)
        
        # If all legs share the same marketing carrier → codeshare, not carrier change
        if len(marketing_carriers) <= 1:
            return False
        
        # Check if the top-level airline (self.airline) unifies the segments.
        # When an itinerary is sold by DL but has segments showing AS/BF,
        # the top-level airline is the actual marketing/ticketing carrier.
        top_airline = _normalize(self.airline)
        if top_airline and top_airline not in marketing_carriers:
            # The parent airline differs from ALL segment carriers →
            # segments are codeshare under the parent airline, not a real carrier change
            return False
        
        # Marketing carriers genuinely differ (e.g., UA + AA interline)
        return True
    
    @property
    def has_short_connection(self) -> bool:
        """True if any layover is under 60 minutes."""
        return any(l.is_short for l in self.layovers)
    
    def validate_segments(self) -> list[str]:
        """
        Validate segment data consistency.
        Returns list of warnings/errors.
        """
        warnings = []
        
        # INVARIANT: stops > 0 requires segments
        if self._stops_hint and self._stops_hint > 0 and len(self.segments) < 2:
            warnings.append(
                f"Data error: {self._stops_hint} stops claimed but only {len(self.segments)} segments"
            )
        
        # Check segment chain continuity
        for i in range(len(self.segments) - 1):
            if self.segments[i].destination != self.segments[i + 1].origin:
                warnings.append(
                    f"Segment chain broken: {self.segments[i].destination} != {self.segments[i+1].origin}"
                )
        
        return warnings


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


class HotelRecommendation(BaseModel):
    """Normalized hotel recommendation for a single stay window.

    Shared across solo and group flows. One recommendation per
    destination stay segment.
    """
    hotel_id: str
    hotel_name: str
    destination: str
    check_in: str   # YYYY-MM-DD
    check_out: str  # YYYY-MM-DD
    price_total: float
    nightly_rate: float
    currency: str = "USD"
    booking_url: Optional[str] = None
    rating: Optional[float] = None
    star_level: int = 4
    amenities: list[str] = []
    recommendation_reason: Optional[str] = None
    traveler_count: int = 1
    room_count: int = 1
    # Points-based pricing
    loyalty_program: Optional[str] = None
    points_per_night: Optional[int] = None
    points_total: Optional[int] = None


# =============================================================================
# PAYMENT & TRANSFER MODELS
# =============================================================================

class TransferInstruction(BaseModel):
    """Instructions for transferring points or using existing miles."""
    from_program: str  # e.g., "Chase UR" or "Delta SkyMiles" (for direct use)
    to_program: str  # e.g., "United MileagePlus" or same as from_program (for direct use)
    points_to_transfer: int
    ratio: float = 1.0
    portal_url: str
    transfer_time: str = "Instant"
    steps: list[str] = []
    warning: Optional[str] = None
    # Multi-payer attribution: which payer performs this transfer
    payer_id: Optional[str] = None
    payer_name: Optional[str] = None
    # Direct usage flag: True when using native miles (no transfer needed)
    is_direct: bool = False


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
    transfer: Optional[TransferInstruction] = None  # Primary transfer (backward compat)
    transfers: list[TransferInstruction] = []  # All transfers (for multi-bank splits)
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
    bank_currencies_used: dict[str, int] = {}  # source bank -> points spent
    # Multi-payer: which payer contributed what
    payer_breakdown: Optional[dict[str, dict[str, int]]] = None


# =============================================================================
# SEGMENT MODELS
# =============================================================================

class FlightLeg(BaseModel):
    """
    A single flight leg (one takeoff and landing) within a flight segment.
    
    CRITICAL: This is where per-leg data lives - airports, times, carriers.
    Without this, connections appear as direct flights in the UI.
    
    For connecting flights, each leg represents one individual flight.
    Users need this information to book and board each flight.
    """
    flight_number: str = ""  # e.g., "DL 2055"
    marketing_carrier: str = ""  # Airline selling the ticket (e.g., "Delta", "DL")
    operating_carrier: Optional[str] = None  # Actual operator if codeshare (e.g., "Air France", "KL")
    
    origin: str = ""  # Airport code (e.g., "SEA")
    origin_terminal: Optional[str] = None  # Terminal (e.g., "A")
    destination: str = ""  # Airport code (e.g., "CDG")
    destination_terminal: Optional[str] = None
    
    # Times - Optional since not all sources provide them
    departure_time: Optional[str] = None  # ISO format datetime
    arrival_time: Optional[str] = None  # ISO format datetime
    duration_minutes: Optional[int] = None
    
    aircraft: Optional[str] = None  # e.g., "Boeing 777-300ER"
    cabin_class: str = "Economy"
    
    # Codeshare info for display
    is_codeshare: bool = False
    codeshare_info: Optional[str] = None  # e.g., "Operated by Air France as AF 1234"
    
    @property
    def computed_is_codeshare(self) -> bool:
        """True if operating carrier differs from marketing carrier."""
        return (
            self.operating_carrier is not None and 
            self.operating_carrier != self.marketing_carrier
        )


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
    ticketing_confirmed: bool = False  # True if confirmed single-ticket (no separate-ticket risk)
    
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
    
    # Budget warning message when itinerary exceeds user's budget
    # This is set when the original budget was infeasible and we return the closest option
    budget_warning: Optional[str] = None
    
    # For group trips: ID of the member this itinerary is for
    traveler_id: Optional[str] = None
    
    # Policy evaluation for the entire itinerary
    policy_evaluation: Optional[PolicyEvaluationModel] = None
    disabled: bool = False
    disable_reason: Optional[str] = None
    
    # Booking structure recommendation
    booking_structure_recommendation: Optional[Literal["two_one_ways", "round_trip"]] = None
    
    # Diagnostic: reasons why points were not used (populated when user has points but none were applied)
    no_points_reasons: Optional[list[str]] = None


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
    """
    Request for solo trip optimization.
    
    MULTI-CURRENCY SUPPORT:
    The `points` dict supports multiple credit card programs:
    - Bank currencies: "chase_ur", "amex_mr", "citi_typ", etc.
    - Direct airline miles: "UA", "DL", "AA", etc.
    
    Use currency control fields to customize optimization behavior.
    """
    trip_id: str
    points: dict[str, int]  # program -> balance
    budget: float = NO_BUDGET_LIMIT  # Use NO_BUDGET_LIMIT for unlimited (never None)
    cabin_classes: Optional[list[str]] = None
    hotel_stars: Optional[list[int]] = None
    include_hotels: Optional[bool] = True
    
    # MULTI-PAYER SUPPORT: When two people contribute points to a trip.
    # When provided, `points` is ignored in favor of per-payer breakdown.
    # Example: { "alice": {"amex_mr": 50000}, "bob": {"amex_mr": 75000, "chase_ur": 30000} }
    payer_points: Optional[dict[str, dict[str, int]]] = None
    
    # Optimization mode: oop (min cost), cpp (max value), balanced, money_saving (ultra-aggressive points usage)
    optimization_mode: Literal["oop", "cpp", "balanced", "money_saving"] = "oop"
    
    # Policy settings
    risk_mode: RiskMode = "balanced"  # safe, balanced, aggressive
    include_basic_economy: bool = False  # Include basic economy fares?
    flexibility_priority: Literal["low", "medium", "high"] = "medium"
    acknowledged_policy_codes: list[str] = []  # Codes user has acknowledged
    
    # Currency control settings (Task 07)
    allowed_currencies: Optional[list[str]] = None  # If set, only use these currencies
    max_points_by_currency: Optional[dict[str, int]] = None  # Per-currency caps
    max_cash_budget: Optional[float] = None  # Maximum cash OOP (overrides budget)
    
    # Advanced flight filters (Google Flights parity)
    include_budget_airlines: bool = True  # Sort by price (True, includes all) or best quality (False) in SerpAPI
    max_stops: int = 0  # 0=Any, 1=Nonstop, 2=1 stop or fewer, 3=2 stops or fewer
    departure_hour_range: Optional[list[int]] = None  # [startHour, endHour]
    arrival_hour_range: Optional[list[int]] = None  # [startHour, endHour]


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
