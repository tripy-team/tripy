"""
Trip Schemas for Solo Booking Flow

These schemas define the API contracts for trip creation, retrieval, and management.
All responses use snake_case; frontend converts to camelCase via serializers.
"""
from pydantic import BaseModel
from typing import Optional, List, Literal
from enum import Enum


class TripType(str, Enum):
    """Trip type enum - replaces conflicting booleans (P0-3 fix)"""
    ONE_WAY = "one_way"
    ROUND_TRIP = "round_trip"


class DateMode(str, Enum):
    """Date mode enum - replaces conflicting booleans (P0-3 fix)"""
    FIXED = "fixed"
    FLEXIBLE = "flexible"


class OptimizationMode(str, Enum):
    """Optimization strategy"""
    OOP = "oop"          # Minimize out-of-pocket
    CPP = "cpp"          # Maximize cents-per-point
    BALANCED = "balanced"
    MONEY_SAVING = "money_saving"  # Ultra-aggressive: use points at any CPP to minimize cash


class CreateTripRequest(BaseModel):
    """Request to create a new solo trip"""
    title: str
    trip_type: TripType = TripType.ROUND_TRIP
    date_mode: DateMode = DateMode.FIXED
    
    # REQUIRED: Origin and destinations (P0-9 fix)
    origin: str                          # IATA code, e.g., "JFK"
    destinations: List[str]              # IATA codes for cities to visit
    final_destination: Optional[str] = None  # For one-way; defaults to origin for round-trip
    
    # Only required if date_mode == "fixed"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    # Only used if date_mode == "flexible"
    duration_days: Optional[int] = None
    
    # Multi-city leg dates: departure date for each flight segment
    # Leg 0: origin → destinations[0], Leg 1: destinations[0] → destinations[1], etc.
    leg_dates: Optional[List[str]] = None
    
    include_hotels: bool = True
    max_budget: Optional[float] = None
    
    adults: int = 1
    children: int = 0
    bags: int = 0
    flight_class: Literal["basic_economy", "economy", "premium", "business", "first"] = "economy"
    hotel_class: Literal["3", "4", "5"] = "4"
    optimization_mode: OptimizationMode = OptimizationMode.BALANCED
    departure_time_preference: Literal["any", "morning", "afternoon", "evening", "night"] = "any"
    arrival_time_preference: Literal["any", "morning", "afternoon", "evening", "night"] = "any"
    
    # Advanced flight filters (Google Flights parity)
    include_budget_airlines: bool = True  # If True, sort by price (includes all airlines); if False, sort by "best flights"
    max_stops: int = 0  # 0=Any, 1=Nonstop only, 2=1 stop or fewer, 3=2 stops or fewer
    departure_hour_range: Optional[List[int]] = None  # [startHour, endHour] e.g. [6, 18]
    arrival_hour_range: Optional[List[int]] = None  # [startHour, endHour] e.g. [8, 22]


class TripResponse(BaseModel):
    """
    API response model for trips.
    Does NOT include DynamoDB internals (PK, SK, etc.) - P0-1 fix.
    """
    trip_id: str
    title: str
    trip_type: str  # TripType value
    date_mode: str  # DateMode value
    origin: str
    destinations: List[str]
    final_destination: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    duration_days: Optional[int] = None
    leg_dates: Optional[List[str]] = None  # Multi-city leg dates
    include_hotels: bool
    max_budget: Optional[float] = None
    adults: int
    children: int
    bags: int
    flight_class: str
    hotel_class: str
    optimization_mode: str  # OptimizationMode value
    departure_time_preference: str
    arrival_time_preference: str
    include_budget_airlines: bool = True
    max_stops: int = 0
    departure_hour_range: Optional[List[int]] = None
    arrival_hour_range: Optional[List[int]] = None
    status: str
    created_at: str
    created_by: str
    invite_code: Optional[str] = None


class UpdateTripStatusRequest(BaseModel):
    """Request to update trip status"""
    status: Literal["draft", "optimized", "selected", "instructions_unlocked", "booked", "completed", "cancelled"]
    # Optional: payment proof when unlocking instructions
    payment_proof: Optional[dict] = None


class StatusUpdateResponse(BaseModel):
    """Response after status update"""
    ok: bool
    status: str


class UpdateTripRequest(BaseModel):
    """Request to update an existing solo trip's parameters (all fields optional)."""
    title: Optional[str] = None
    trip_type: Optional[TripType] = None
    date_mode: Optional[DateMode] = None
    origin: Optional[str] = None
    destinations: Optional[List[str]] = None
    final_destination: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    duration_days: Optional[int] = None
    leg_dates: Optional[List[str]] = None
    max_budget: Optional[float] = None
    adults: Optional[int] = None
    children: Optional[int] = None
    bags: Optional[int] = None
    flight_class: Optional[Literal["basic_economy", "economy", "premium", "business", "first"]] = None
    optimization_mode: Optional[OptimizationMode] = None
    include_budget_airlines: Optional[bool] = None
    max_stops: Optional[int] = None
    departure_hour_range: Optional[List[int]] = None
    arrival_hour_range: Optional[List[int]] = None


class SelectItineraryRequest(BaseModel):
    """Request to select an itinerary for booking"""
    itinerary_id: str
    # Full snapshot for reproducibility (award availability changes)
    itinerary_snapshot: dict
    cash_price_at_selection: float
    out_of_pocket_at_selection: float


class SelectionResponse(BaseModel):
    """Response containing selection information"""
    ok: bool = True
    itinerary_id: Optional[str] = None
    itinerary_snapshot: Optional[dict] = None
    cash_price_at_selection: Optional[float] = None
    out_of_pocket_at_selection: Optional[float] = None
    selected_at: Optional[str] = None
