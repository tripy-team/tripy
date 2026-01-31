"""
Trip specification models for V3 optimization.

This module defines the trip structure that serves as INPUT to the optimizer.
Stay segments and legs are USER-PROVIDED, not derived from flights.

MVP Constraints:
- group_mode = TOGETHER only (all travelers on same flights/hotels)
- No points pooling (each payer uses only their own balances)
- Fixed dates (no flexible date optimization)
"""

from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional, Dict
from enum import Enum


class GroupTravelMode(Enum):
    """How the group travels together."""
    TOGETHER = "together"  # All travelers on same flights/hotels (MVP)
    # INDEPENDENT = "independent"  # V4+: Each traveler can have different itinerary
    # SHARED_HOTELS = "shared_hotels"  # V4+: Same hotels, potentially different flights


class TimeOfDay(Enum):
    """Time-of-day preference for flights."""
    ANY = "any"           # No preference
    MORNING = "morning"   # 5:00 AM - 12:00 PM
    AFTERNOON = "afternoon"  # 12:00 PM - 5:00 PM
    EVENING = "evening"   # 5:00 PM - 9:00 PM
    NIGHT = "night"       # 9:00 PM - 5:00 AM (redeye)
    
    def get_hour_range(self) -> tuple[int, int]:
        """Get (start_hour, end_hour) for this time-of-day window."""
        ranges = {
            TimeOfDay.ANY: (0, 24),
            TimeOfDay.MORNING: (5, 12),
            TimeOfDay.AFTERNOON: (12, 17),
            TimeOfDay.EVENING: (17, 21),
            TimeOfDay.NIGHT: (21, 5),  # Wraps around midnight
        }
        return ranges.get(self, (0, 24))
    
    def matches_hour(self, hour: int) -> bool:
        """Check if an hour (0-23) falls within this time window."""
        if self == TimeOfDay.ANY:
            return True
        start, end = self.get_hour_range()
        if start < end:
            return start <= hour < end
        else:  # Night wraps around midnight
            return hour >= start or hour < end


@dataclass
class Traveler:
    """
    A person in the trip.
    
    Each traveler has their own points/bank balances.
    In MVP, no pooling - payer can only use their own balances.
    """
    
    traveler_id: str
    name: str
    home_airport: str
    
    # Points balances by program (normalized keys: "united", "hyatt", etc.)
    points_balances: Dict[str, int] = field(default_factory=dict)
    
    # Bank balances by bank (normalized keys: "chase", "amex", etc.)
    bank_balances: Dict[str, int] = field(default_factory=dict)
    
    # Soft preferences (used for warnings/pruning, not hard constraints)
    preferred_airlines: List[str] = field(default_factory=list)
    avoided_airlines: List[str] = field(default_factory=list)
    preferred_cabin: Optional[str] = None  # "economy", "business", "first"
    
    def total_points(self) -> int:
        """Total points across all programs."""
        return sum(self.points_balances.values())
    
    def total_bank_points(self) -> int:
        """Total bank/transferable points."""
        return sum(self.bank_balances.values())
    
    def has_usable_points(self) -> bool:
        """Check if traveler has any usable points."""
        return self.total_points() > 0 or self.total_bank_points() > 0


@dataclass
class OrderedLeg:
    """
    A required flight leg in the trip.
    
    This is an INPUT from the user, not derived.
    The optimizer chooses WHICH flight to take, within the date window.
    """
    
    leg_id: int  # Order in trip (0, 1, 2, ...)
    origin_city: str  # Can be airport code (JFK) or city name (NYC)
    destination_city: str
    
    # Date window (user provides this)
    earliest_departure: date
    latest_departure: date
    
    # Time-of-day preferences (optional, for filtering/scoring flights)
    preferred_departure_time: Optional[TimeOfDay] = None  # When to depart
    preferred_arrival_time: Optional[TimeOfDay] = None    # When to arrive
    
    # Which travelers are on this leg (usually all in MVP)
    traveler_ids: List[str] = field(default_factory=list)
    
    # MULTI-AIRPORT SUPPORT: Optional allowlists for airports
    # When set, only flights from/to these airports are considered
    # E.g., for "Seattle" leg: allowed_origin_airports=["SEA", "PAE"]
    allowed_origin_airports: Optional[List[str]] = None
    allowed_destination_airports: Optional[List[str]] = None
    
    def __post_init__(self):
        if self.latest_departure < self.earliest_departure:
            raise ValueError(
                f"Leg {self.leg_id}: latest_departure ({self.latest_departure}) "
                f"cannot be before earliest_departure ({self.earliest_departure})"
            )
    
    def matches_departure_time(self, hour: int) -> bool:
        """Check if a departure hour matches the preferred departure time."""
        if self.preferred_departure_time is None:
            return True
        return self.preferred_departure_time.matches_hour(hour)
    
    def matches_arrival_time(self, hour: int) -> bool:
        """Check if an arrival hour matches the preferred arrival time."""
        if self.preferred_arrival_time is None:
            return True
        return self.preferred_arrival_time.matches_hour(hour)


@dataclass
class StaySegment:
    """
    A required hotel stay in the trip.
    
    This is an INPUT from the user, not derived from flights.
    The optimizer chooses WHICH hotel, not WHEN to stay.
    
    Dates are FIXED - the optimizer cannot move them.
    """
    
    segment_id: int  # Order in trip (0, 1, 2, ...)
    city: str  # Where to stay
    
    # Fixed dates (user provides this)
    check_in: date
    check_out: date
    
    # Which travelers stay here (usually all in MVP)
    traveler_ids: List[str] = field(default_factory=list)
    
    # Room preferences (optional)
    min_rooms: Optional[int] = None  # e.g., couples want 2 rooms for 4 people
    max_occupancy_per_room: Optional[int] = None
    min_star_rating: Optional[float] = None  # e.g., 4.0
    preferred_chains: List[str] = field(default_factory=list)  # ["HYATT", "MAR"]
    
    @property
    def nights(self) -> int:
        """Number of nights in this stay."""
        return (self.check_out - self.check_in).days
    
    def __post_init__(self):
        if self.check_out <= self.check_in:
            raise ValueError(
                f"Segment {self.segment_id}: check_out ({self.check_out}) "
                f"must be after check_in ({self.check_in})"
            )


@dataclass
class TripPlanSpec:
    """
    Complete trip specification.
    
    This is the PRIMARY INPUT to the optimizer.
    Legs and segments are USER-PROVIDED, not derived.
    
    MVP Constraints:
    - group_mode = TOGETHER only
    - No points pooling (each payer uses own balances only)
    - No fairness constraints
    """
    
    trip_id: str
    travelers: List[Traveler]
    
    # Ordered sequence of flights (user defines this)
    legs: List[OrderedLeg]
    
    # Ordered sequence of stays (user defines this)
    # stay[i] is between leg[i] arrival and leg[i+1] departure
    stay_segments: List[StaySegment]
    
    # MVP: locked to TOGETHER
    group_mode: GroupTravelMode = GroupTravelMode.TOGETHER
    
    # Global time-of-day preferences (applied to all legs unless overridden)
    default_departure_time: Optional[TimeOfDay] = None
    default_arrival_time: Optional[TimeOfDay] = None
    
    # Note: These are removed in MVP
    # allow_points_pooling: bool = False  # Always False in MVP
    # max_payer_imbalance: float = None   # V4+
    
    def get_departure_preference(self, leg_id: int) -> Optional[TimeOfDay]:
        """Get departure time preference for a leg (leg-specific or default)."""
        if leg_id < len(self.legs):
            leg = self.legs[leg_id]
            if leg.preferred_departure_time is not None:
                return leg.preferred_departure_time
        return self.default_departure_time
    
    def get_arrival_preference(self, leg_id: int) -> Optional[TimeOfDay]:
        """Get arrival time preference for a leg (leg-specific or default)."""
        if leg_id < len(self.legs):
            leg = self.legs[leg_id]
            if leg.preferred_arrival_time is not None:
                return leg.preferred_arrival_time
        return self.default_arrival_time
    
    def validate(self) -> List[str]:
        """
        Validate the spec is internally consistent.
        
        Returns list of errors (empty if valid).
        """
        errors = []
        
        # Check we have travelers
        if not self.travelers:
            errors.append("No travelers specified")
        
        # Check we have legs
        if not self.legs:
            errors.append("No legs specified")
        
        # Check leg/segment count alignment
        expected_segments = len(self.legs) - 1 if self.legs else 0
        if len(self.stay_segments) != expected_segments:
            errors.append(
                f"Expected {expected_segments} stay segments for {len(self.legs)} legs, "
                f"got {len(self.stay_segments)}"
            )
        
        # Check leg IDs are sequential
        for i, leg in enumerate(self.legs):
            if leg.leg_id != i:
                errors.append(f"Leg at index {i} has leg_id {leg.leg_id}, expected {i}")
        
        # Check segment IDs are sequential
        for i, seg in enumerate(self.stay_segments):
            if seg.segment_id != i:
                errors.append(f"Segment at index {i} has segment_id {seg.segment_id}, expected {i}")
        
        # Check city alignment between legs and segments
        for i, seg in enumerate(self.stay_segments):
            # Leg i arrives at the segment's city
            if i < len(self.legs):
                if self.legs[i].destination_city != seg.city:
                    errors.append(
                        f"Leg {i} arrives at {self.legs[i].destination_city} "
                        f"but segment {i} is in {seg.city}"
                    )
            
            # Leg i+1 departs from the segment's city
            if i + 1 < len(self.legs):
                if self.legs[i + 1].origin_city != seg.city:
                    errors.append(
                        f"Segment {i} is in {seg.city} but leg {i + 1} "
                        f"departs from {self.legs[i + 1].origin_city}"
                    )
        
        # Check date ordering
        for i, seg in enumerate(self.stay_segments):
            # Check-in should be on or after leg[i] earliest arrival
            if i < len(self.legs):
                leg = self.legs[i]
                # Note: We can't check exact arrival date without flight data,
                # but check-in shouldn't be before leg's earliest departure
                if seg.check_in < leg.earliest_departure:
                    errors.append(
                        f"Segment {i} check_in ({seg.check_in}) is before "
                        f"leg {i} earliest_departure ({leg.earliest_departure})"
                    )
            
            # Check-out should be on or before leg[i+1] latest departure
            if i + 1 < len(self.legs):
                leg = self.legs[i + 1]
                if seg.check_out > leg.latest_departure:
                    errors.append(
                        f"Segment {i} check_out ({seg.check_out}) is after "
                        f"leg {i + 1} latest_departure ({leg.latest_departure})"
                    )
        
        # Check traveler IDs exist
        all_traveler_ids = set(self.all_traveler_ids)
        for leg in self.legs:
            for tid in leg.traveler_ids:
                if tid not in all_traveler_ids:
                    errors.append(f"Leg {leg.leg_id} references unknown traveler {tid}")
        
        for seg in self.stay_segments:
            for tid in seg.traveler_ids:
                if tid not in all_traveler_ids:
                    errors.append(f"Segment {seg.segment_id} references unknown traveler {tid}")
        
        return errors
    
    @property
    def all_traveler_ids(self) -> List[str]:
        """Get all traveler IDs."""
        return [t.traveler_id for t in self.travelers]
    
    def get_traveler(self, traveler_id: str) -> Traveler:
        """Get traveler by ID."""
        for t in self.travelers:
            if t.traveler_id == traveler_id:
                return t
        raise ValueError(f"Unknown traveler: {traveler_id}")
    
    @property
    def num_travelers(self) -> int:
        """Number of travelers."""
        return len(self.travelers)
    
    @property
    def num_legs(self) -> int:
        """Number of flight legs."""
        return len(self.legs)
    
    @property
    def num_segments(self) -> int:
        """Number of hotel stay segments."""
        return len(self.stay_segments)
    
    @property
    def total_nights(self) -> int:
        """Total number of hotel nights."""
        return sum(seg.nights for seg in self.stay_segments)
    
    def get_segment_for_leg(self, leg_id: int) -> Optional[StaySegment]:
        """Get the stay segment after a leg (if any)."""
        if leg_id < len(self.stay_segments):
            return self.stay_segments[leg_id]
        return None
    
    def get_leg_before_segment(self, segment_id: int) -> Optional[OrderedLeg]:
        """Get the leg arriving at a segment."""
        if segment_id < len(self.legs):
            return self.legs[segment_id]
        return None
    
    def get_leg_after_segment(self, segment_id: int) -> Optional[OrderedLeg]:
        """Get the leg departing from a segment."""
        if segment_id + 1 < len(self.legs):
            return self.legs[segment_id + 1]
        return None
