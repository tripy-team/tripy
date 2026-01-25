"""
Canonical internal models for the v2 itinerary pipeline.

These dataclasses standardize what the pipeline consumes/produces,
making logging and optimization deterministic.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Literal, Mapping, Optional, Sequence, Dict, List, Any

# Type aliases
PointsByProgram = Mapping[str, int]  # normalized: banks lower-case, airlines UPPER
Mode = Literal["flight", "train", "bus", "car"]


@dataclass(frozen=True)
class TripConstraints:
    """Core trip constraints derived from trip data and destinations."""
    start_airport: str
    end_airport: str
    must_visit_airports: Sequence[str]
    start_date: Optional[date]
    end_date: Optional[date]
    duration_days: Optional[int]
    max_budget_usd: Optional[int]


@dataclass(frozen=True)
class ScheduledLeg:
    """A scheduled leg with origin, destination, and date."""
    origin: str
    destination: str
    date: date


@dataclass(frozen=True)
class EdgeOption:
    """
    A travel option for a single leg (edge) in the itinerary.
    
    Represents either a cash booking, an award booking, or both.
    For v2 first cut, award pricing is at the route level (not segment-level).
    """
    # Identity
    option_id: str
    origin: str
    destination: str
    date: date
    mode: Mode

    # Cash pricing
    cash_usd: Optional[float] = None

    # Award pricing (route-level for v2 first cut)
    award_program: Optional[str] = None      # e.g., "AF", "UA"
    award_miles: Optional[int] = None
    award_surcharge_usd: Optional[float] = None

    # Quality signals
    duration_min: Optional[int] = None
    stops: Optional[int] = None
    segments: Sequence[dict] = field(default_factory=list)
    
    # Additional metadata
    operating_airline: Optional[str] = None
    booking_url: Optional[str] = None

    def __hash__(self):
        return hash(self.option_id)


@dataclass
class InputBundle:
    """Normalized inputs for the v2 pipeline."""
    trip_id: str
    constraints: TripConstraints
    travelers: List[str]
    points_by_traveler: Dict[str, PointsByProgram]
    # Metadata for logging
    trip_title: Optional[str] = None
    user_id: Optional[str] = None


@dataclass
class RouteOrder:
    """A candidate route order produced by the ordering ILP."""
    order_id: str
    airports: List[str]  # Ordered list: [start, city1, city2, ..., end]
    estimated_cost: float
    score: float = 0.0


@dataclass
class ScheduledRoute:
    """A route with date assignments for each leg."""
    order: RouteOrder
    legs: List[ScheduledLeg]
    city_stays: Dict[str, int]  # airport -> days to stay


@dataclass
class LegOptions:
    """All options available for a single leg."""
    leg: ScheduledLeg
    options: List[EdgeOption]


@dataclass
class SolvedPayment:
    """Payment decision for a single leg."""
    edge: tuple  # (origin, dest, option_id)
    payment_type: Literal["cash", "points"]
    payer: str
    # Cash payment fields
    fare: Optional[float] = None
    # Points payment fields
    via_source: Optional[str] = None  # bank source e.g., "chase"
    via_airline: Optional[str] = None  # airline e.g., "UA"
    via_native: Optional[str] = None  # native airline miles
    miles: Optional[float] = None
    surcharge: Optional[float] = None
    points_value: Optional[float] = None
    cents_per_point: Optional[float] = None
    mode: Mode = "flight"


@dataclass
class SolvedItinerary:
    """The solved itinerary for all travelers."""
    status: str  # "Optimal", "Infeasible", etc.
    paths: Dict[str, List[str]]  # traveler_id -> airport sequence
    payments: Dict[str, List[SolvedPayment]]  # traveler_id -> payment list
    totals: Dict[str, Any]
    # Transfer instructions
    transfers: Dict[str, Dict[str, Dict[str, Any]]]  # payer -> source -> airline -> details
    native_used: Dict[str, Dict[str, float]]  # payer -> airline -> miles


@dataclass
class V2Result:
    """Final result from the v2 pipeline."""
    status: str
    solution: Dict[str, Any]
    items: List[Dict[str, Any]]
    relaxed_constraints: bool = False
    relaxed_message: Optional[str] = None
    run_id: str = ""
