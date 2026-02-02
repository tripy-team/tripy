"""
Optimization Schemas for Solo Booking Flow

These schemas define the API contracts for optimization results.
All responses use snake_case; frontend converts to camelCase via serializers.
"""
from pydantic import BaseModel
from typing import Optional, Dict, List, Literal, Any

from .programs import PointsProgram


class OptimizeSoloRequest(BaseModel):
    """Request to optimize a solo trip"""
    trip_id: str
    points: Dict[str, int]  # { "chase_ur": 50000, "amex_mr": 30000 }
    # Optional: override trip's optimization_mode for comparison
    optimization_mode_override: Optional[Literal["oop", "cpp", "balanced"]] = None
    # Force bypass cache and run fresh optimization
    force_refresh: bool = False


class TransferInsight(BaseModel):
    """Insight about a transfer or optimization strategy"""
    type: Literal["transfer_bonus", "sweet_spot", "multi_hop", "cross_program"]
    description: str
    # Trust scaffolding (no fake dollar amounts)
    evidence: Optional[str] = None      # e.g., "Cash fare from Google Flights"
    as_of: Optional[str] = None         # ISO timestamp
    confidence: Literal["high", "medium", "low"] = "high"


class TransferInstruction(BaseModel):
    """Typed transfer instruction for BookingGuide"""
    step_number: int
    source_program: str  # PointsProgram value
    target_program: str  # PointsProgram value
    points_to_transfer: int
    transfer_ratio: float               # e.g., 1.0 or 1.3 for 30% bonus
    expected_transfer_time: str         # e.g., "instant", "1-2 days"
    portal_url: str
    warning: Optional[str] = None       # e.g., "Transfer bonus expires March 15"


class FlightLegDetail(BaseModel):
    """
    Per-leg detail for connecting flights.
    
    CRITICAL: This enables the UI to show:
    - "SEA → AMS → CDG" instead of just "SEA → CDG"
    - Per-leg carriers for codeshare display
    - Layover airports and durations
    """
    origin: str                         # Departure airport (e.g., "SEA")
    destination: str                    # Arrival airport (e.g., "AMS")
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    
    flight_number: str                  # e.g., "DL 2055"
    marketing_carrier: str              # Who sells the ticket (e.g., "DL")
    operating_carrier: Optional[str] = None  # Who flies the plane (e.g., "KL")
    
    aircraft: Optional[str] = None
    cabin: Optional[str] = None


class LayoverDetail(BaseModel):
    """Layover detail between flight legs."""
    airport: str                        # Connection airport code
    airport_name: Optional[str] = None  # Full airport name
    duration_minutes: int               # Minutes between flights
    is_short: bool = False              # Under 60 minutes (risky)
    is_long: bool = False               # Over 4 hours


class SegmentBreakdown(BaseModel):
    """Breakdown for a single segment (flight or hotel)"""
    segment: str                        # e.g., "JFK → LAX" or "JFK → AMS → LAX"
    type: Literal["flight", "hotel"]
    payment_method: Literal["cash", "points"]
    cash_price: float                   # Real cash price for this segment
    # If points:
    points_used: Optional[int] = None
    surcharge: Optional[float] = None
    cpp_achieved: Optional[float] = None  # Computed as: (cash_price - surcharge) / points_used * 100
    transfer_from: Optional[str] = None
    transfer_to: Optional[str] = None
    transfer_ratio: Optional[float] = None
    program: Optional[str] = None       # Loyalty program used for booking
    
    # Flight-specific details (top-level for quick access)
    origin: Optional[str] = None
    destination: Optional[str] = None
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    airline: Optional[str] = None
    operating_airline: Optional[str] = None  # For codeshare flights
    flight_number: Optional[str] = None      # First leg's flight number
    cabin_class: Optional[str] = None
    duration_minutes: Optional[int] = None
    booking_url: Optional[str] = None
    
    # CRITICAL: Per-leg details for connections
    # If this is a connecting flight, legs[] has the per-leg breakdown
    stops: int = 0                      # Number of stops (0 = direct)
    legs: List[FlightLegDetail] = []    # Per-leg details (empty for direct flights)
    layovers: List[LayoverDetail] = []  # Layover details between legs
    
    # Connection safety info
    ticketing_confirmed: bool = False   # True if single-ticket confirmed
    has_carrier_change: bool = False    # True if operating carriers differ between legs
    has_short_connection: bool = False  # True if any layover < 60 min
    
    # Hotel-specific details
    hotel_name: Optional[str] = None
    brand: Optional[str] = None
    city: Optional[str] = None
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    nights: Optional[int] = None


class OOPMetrics(BaseModel):
    """Out-of-pocket metrics for an itinerary"""
    total_cash_price: float             # What it would cost in cash
    total_out_of_pocket: float          # What user actually pays
    cash_saved: float                   # total_cash_price - total_out_of_pocket
    savings_percentage: float           # (cash_saved / total_cash_price) * 100
    total_points_used: int
    average_cpp: float                  # Average cents-per-point achieved


class RankedItinerary(BaseModel):
    """A ranked itinerary option from the optimizer"""
    id: str                             # Unique identifier for selection
    rank: int                           # 1 = best for chosen mode
    route: List[str]                    # e.g., ["JFK", "LAX", "JFK"]
    display_name: str                   # e.g., "JFK → LAX Round Trip"

    # Policy evaluation (optional; wired through by /solo/optimize)
    policy_evaluation: Optional[Dict[str, Any]] = None
    disabled: Optional[bool] = None
    disable_reason: Optional[str] = None
    
    # Bundled breakdown (no separate API call needed) - P1-4 fix
    segments: List[SegmentBreakdown]
    oop_metrics: OOPMetrics
    
    # Transfer instructions if applicable
    transfers: List[TransferInstruction]
    
    # Insights about this itinerary
    insights: List[TransferInsight]


class OptimizeSoloResponse(BaseModel):
    """Response from solo optimization"""
    itineraries: List[RankedItinerary]
    best_option: Optional[str] = None   # ID of recommended itinerary
    warnings: List[str] = []
    global_insights: List[TransferInsight] = []
    risk_mode: Optional[str] = None
    
    # Staleness metadata (no underscore prefixes - P0-4 fix)
    cached: bool = False
    computed_at: str                    # ISO timestamp
    expires_at: str                     # ISO timestamp - use for "valid until" UX


class TransferStrategyRequest(BaseModel):
    """Request for transfer strategy/booking instructions"""
    trip_id: str
    itinerary_id: str


# Issue #11 FIX: BookingStep MUST be defined BEFORE TransferStrategyResponse
class BookingStep(BaseModel):
    """A booking action in the transfer strategy"""
    step_number: int
    type: Literal["flight", "hotel"]
    airline: Optional[str] = None
    hotel_chain: Optional[str] = None
    
    # booking_url may be:
    # - Direct deep link to award booking page (ideal)
    # - Generic search landing page (need to specify what to search)
    # If generic, segment_reference MUST explain what to search for
    booking_url: str
    
    # Human-readable reference to what this step books
    # E.g., "JFK → NRT Business Class United Polaris"
    segment_reference: str
    
    # Flight-specific details (top-level for the overall journey)
    origin: Optional[str] = None
    destination: Optional[str] = None
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    cabin_class: Optional[str] = None
    flight_number: Optional[str] = None
    operating_airline: Optional[str] = None  # For codeshare (e.g., "Operated by Air France")
    duration_minutes: Optional[int] = None
    
    # CRITICAL: Connection details for multi-leg flights
    # These enable the UI to show layover airports and durations
    stops: int = 0                          # Number of stops (0 = nonstop)
    legs: List[FlightLegDetail] = []        # Per-leg details (empty for direct flights)
    layovers: List[LayoverDetail] = []      # Layover info between legs
    
    # Hotel-specific details
    city: Optional[str] = None
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    nights: Optional[int] = None
    
    # Payment details
    payment_method: Literal["points", "cash"] = "points"
    points_used: Optional[int] = None
    cash_price: Optional[float] = None
    surcharge: Optional[float] = None
    program: Optional[str] = None  # Loyalty program for the booking
    payment_reason: Optional[str] = None  # Explains why this payment method was chosen


class TransferStrategyResponse(BaseModel):
    """Response for /transfer-strategy/optimize"""
    transfers: List[TransferInstruction]
    bookings: List[BookingStep]
    total_points_to_transfer: int
    estimated_total_time: str           # e.g., "2-3 days"
    warnings: List[str] = []
