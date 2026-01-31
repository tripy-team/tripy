# Implementation Action Plan V2 (Revised)

**Changes from V1:**
- Added Step 0: TripPlanSpec (state representation first)
- Stay segments are INPUTS, not derived from flights
- Added payer layer for group travel
- Fixed OOP hotel cost (from room vars, not constant)
- Mode-aware multi-criteria pruning
- Deferred global next-best (rebuild approach)
- Threads=1 for determinism tests
- Pre-check feasibility at data layer
- Added connecting flight airline/codeshare validation
- Defined clear MVP scope

---

## MVP Scope for V3 (Locked)

To avoid infinite expansion, V3 MVP includes:

| In Scope | Out of Scope (V4+) |
|----------|-------------------|
| Fixed stay segments from user | Flexible date optimization |
| Group travels together | Split group itineraries |
| One hotel per segment + room allocation | Hotel splitting across segments |
| Integer-safe transfers | Complex transfer timing optimization |
| Two-pass solve | Multi-objective Pareto |
| Local alternatives | Global next-best (behind flag) |
| Payer assignment | Fairness optimization |
| Codeshare validation for connections | Self-connecting itineraries |

---

## Phase 0: State Representation (Steps 0-1)

### Step 0: Define TripPlanSpec (THE FOUNDATION)

**Why this comes first:** Everything else depends on how we represent the trip state. Without this, `StaySegment` and `FlightItineraryEdge` have circular dependencies.

**Files to create:** `backend/src/optimization/trip_spec.py`

**What I'll do:**

```python
from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional, Dict
from enum import Enum


class GroupTravelMode(Enum):
    """How the group travels."""
    TOGETHER = "together"           # All travelers on same flights/hotels
    INDEPENDENT = "independent"     # Each traveler can have different itinerary
    SHARED_HOTELS = "shared_hotels" # Same hotels, potentially different flights


@dataclass
class Traveler:
    """A person in the trip."""
    traveler_id: str
    name: str
    home_airport: str
    
    # This traveler's points balances (for payer assignment)
    points_balances: Dict[str, int]  # program -> balance
    bank_balances: Dict[str, int]    # bank -> balance
    
    # Preferences
    preferred_airlines: List[str] = field(default_factory=list)
    avoided_airlines: List[str] = field(default_factory=list)
    preferred_cabin: Optional[str] = None


@dataclass
class OrderedLeg:
    """
    A required flight leg in the trip.
    
    This is an INPUT from the user, not derived.
    """
    leg_id: int
    origin_city: str              # Can be airport code or city
    destination_city: str
    
    # Date window (user provides this)
    earliest_departure: date
    latest_departure: date
    
    # Which travelers are on this leg
    traveler_ids: List[str]       # Usually all, but can be subset


@dataclass
class StaySegment:
    """
    A required hotel stay.
    
    This is an INPUT from the user, not derived from flights.
    The optimizer chooses WHICH hotel, not WHEN to stay.
    """
    segment_id: int
    city: str
    
    # Fixed dates (user provides this)
    check_in: date
    check_out: date
    
    @property
    def nights(self) -> int:
        return (self.check_out - self.check_in).days
    
    # Which travelers stay here
    traveler_ids: List[str]       # Usually all
    
    # Room preferences (optional)
    min_rooms: Optional[int] = None      # e.g., couples want 2 rooms for 4 people
    max_occupancy_per_room: Optional[int] = None


@dataclass
class TripPlanSpec:
    """
    Complete trip specification.
    
    This is the PRIMARY INPUT to the optimizer.
    Legs and segments are USER-PROVIDED, not derived.
    """
    
    trip_id: str
    travelers: List[Traveler]
    
    # Ordered sequence of flights (user defines this)
    legs: List[OrderedLeg]
    
    # Ordered sequence of stays (user defines this)
    # NOTE: Stays are between legs. stay[i] is between leg[i] arrival and leg[i+1] departure
    stay_segments: List[StaySegment]
    
    # Group travel mode
    group_mode: GroupTravelMode = GroupTravelMode.TOGETHER
    
    # Payment configuration
    allow_points_pooling: bool = True   # Can one traveler use another's points?
    max_payer_imbalance: Optional[float] = None  # Max $ difference in who pays
    
    def validate(self) -> List[str]:
        """Validate the spec is internally consistent."""
        errors = []
        
        # Check leg/segment alignment
        if len(self.stay_segments) != len(self.legs) - 1:
            errors.append(
                f"Expected {len(self.legs) - 1} stay segments between "
                f"{len(self.legs)} legs, got {len(self.stay_segments)}"
            )
        
        # Check date ordering
        for i, seg in enumerate(self.stay_segments):
            if i < len(self.legs) - 1:
                # Leg i arrives at seg.city, seg stays there, leg i+1 departs
                if self.legs[i].destination_city != seg.city:
                    errors.append(
                        f"Leg {i} arrives at {self.legs[i].destination_city} "
                        f"but segment {i} is in {seg.city}"
                    )
                if self.legs[i+1].origin_city != seg.city:
                    errors.append(
                        f"Segment {i} is in {seg.city} but leg {i+1} "
                        f"departs from {self.legs[i+1].origin_city}"
                    )
        
        # Check segment dates fit between leg dates
        for i, seg in enumerate(self.stay_segments):
            if seg.check_in < self.legs[i].earliest_departure:
                errors.append(f"Segment {i} check-in before leg {i} can depart")
            if seg.check_out > self.legs[i+1].latest_departure:
                errors.append(f"Segment {i} check-out after leg {i+1} latest departure")
        
        return errors
    
    @property
    def all_traveler_ids(self) -> List[str]:
        return [t.traveler_id for t in self.travelers]
    
    def get_traveler(self, traveler_id: str) -> Traveler:
        for t in self.travelers:
            if t.traveler_id == traveler_id:
                return t
        raise ValueError(f"Unknown traveler: {traveler_id}")
```

**Test:** Create a sample TripPlanSpec for JFK→TYO (3 nights)→KYO (2 nights)→TYO→JFK, validate passes.

---

### Step 1: Define Payer-Aware Booking Models

**Why payer matters:** In group travel, WHO pays affects feasibility (their balances) and fairness.

**Files to modify:** `backend/src/optimization/models.py`

**What I'll do:**

```python
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
from datetime import datetime


# ════════════════════════════════════════════════════════════════════════════
# AWARD OPTION: What the program charges (separated from funding source)
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class AwardOption:
    """
    A specific award booking option for a flight or hotel.
    
    This is the PROGRAM'S price (miles + surcharge).
    HOW you fund it (native vs transfer) is separate.
    """
    
    option_id: str              # Unique identifier
    program: str                # "united", "hyatt", etc.
    
    # Program cost
    miles_required: int
    surcharge: float            # Cash component (taxes/fees)
    
    # Cabin/room type (for flights: economy/business/first)
    cabin_or_room_type: str
    
    # Value metrics (raw, not normalized)
    cash_equivalent: float      # What cash booking would cost
    raw_value: float            # cash_equivalent - surcharge
    cpp: float                  # (raw_value * 100) / miles_required
    
    # PRECOMPUTED soft values (filled by precompute step)
    soft_value_oop: float = 0.0
    soft_value_cpp: float = 0.0
    soft_value_balanced: float = 0.0
    
    # Availability / risk
    availability_score: float = 1.0   # 0-1, likelihood available
    is_waitlisted: bool = False


@dataclass 
class FundingSource:
    """
    A way to pay for an award option.
    
    Either native points OR bank transfer.
    """
    
    source_type: str            # "native" or "transfer"
    
    # For native: which traveler's balance
    traveler_id: Optional[str] = None
    program: Optional[str] = None       # Native program balance
    
    # For transfer: bank -> program path
    from_bank: Optional[str] = None
    to_program: Optional[str] = None
    transfer_path_id: Optional[str] = None
    
    @property
    def key(self) -> Tuple:
        if self.source_type == "native":
            return ("native", self.traveler_id, self.program)
        else:
            return ("transfer", self.traveler_id, self.from_bank, self.to_program)


# ════════════════════════════════════════════════════════════════════════════
# FLIGHT ITINERARY EDGE: Complete itinerary as single decision unit
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class FlightSegment:
    """One flight within an itinerary."""
    
    flight_number: str
    operating_carrier: str
    marketing_carrier: str
    
    origin: str
    destination: str
    departure: datetime
    arrival: datetime
    
    aircraft: Optional[str] = None
    cabin: Optional[str] = None


@dataclass
class FlightItineraryEdge:
    """
    A complete flight itinerary as a single edge.
    
    For leg_id=0 (JFK→TYO), this might be:
    - JFK→ORD→TYO (United via Chicago)
    - JFK→NRT (ANA direct)
    
    Each is ONE edge, even if multi-segment.
    """
    
    edge_key: str               # Unique identifier
    leg_id: int                 # Which leg this serves
    
    # Route summary
    origin: str                 # First departure airport
    destination: str            # Final arrival airport
    
    # Segments (in order)
    segments: List[FlightSegment]
    
    # Computed from segments
    departure_datetime: datetime
    arrival_datetime: datetime
    total_time_minutes: int
    num_stops: int
    
    # Cash booking option
    cash_cost: float
    
    # Award options (multiple programs may offer this itinerary)
    award_options: List[AwardOption] = field(default_factory=list)
    
    # Connection quality flags
    is_redeye: bool = False
    has_long_layover: bool = False
    has_short_connection: bool = False
    
    # CRITICAL: Connection airline validation
    connection_warnings: List[str] = field(default_factory=list)
    is_interline: bool = False          # Different airlines, need re-check bags
    is_codeshare_protected: bool = True # If miss connection, airline rebooks
    
    def validate_connections(self) -> List[str]:
        """
        Validate connecting flights are same airline or codeshare.
        
        Returns list of warnings.
        """
        warnings = []
        
        if len(self.segments) <= 1:
            return warnings
        
        for i in range(len(self.segments) - 1):
            seg1 = self.segments[i]
            seg2 = self.segments[i + 1]
            
            # Check if same marketing carrier
            if seg1.marketing_carrier != seg2.marketing_carrier:
                # Check if codeshare partners
                if not self._are_codeshare_partners(seg1.marketing_carrier, seg2.marketing_carrier):
                    warnings.append(
                        f"Connection {seg1.destination}: "
                        f"{seg1.marketing_carrier} → {seg2.marketing_carrier} "
                        f"is interline (not protected, must re-check bags)"
                    )
                    self.is_interline = True
                    self.is_codeshare_protected = False
            
            # Check operating vs marketing
            if seg1.operating_carrier != seg1.marketing_carrier:
                warnings.append(
                    f"{seg1.flight_number} operated by {seg1.operating_carrier} "
                    f"(marketed by {seg1.marketing_carrier})"
                )
        
        self.connection_warnings = warnings
        return warnings
    
    def _are_codeshare_partners(self, airline1: str, airline2: str) -> bool:
        """Check if two airlines are alliance/codeshare partners."""
        # This should use the actual alliance data from constants
        from .constants import ALLIANCE_PARTNERS
        
        # Same airline
        if airline1 == airline2:
            return True
        
        # Check alliances
        for alliance, members in ALLIANCE_PARTNERS.items():
            if airline1 in members and airline2 in members:
                return True
        
        # Check specific codeshare agreements
        # (Would need a more complete database)
        return False


# ════════════════════════════════════════════════════════════════════════════
# HOTEL OPTION: Per-segment hotel with room types
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class RoomType:
    """A room type at a hotel."""
    
    room_type_id: str
    name: str                   # "Standard King", "Suite", etc.
    capacity: int               # Max occupants
    
    # Cash pricing
    cash_per_night: float
    
    # Award pricing (if available)
    award_program: Optional[str] = None
    points_per_night: Optional[int] = None
    award_surcharge_per_night: float = 0.0


@dataclass
class HotelOption:
    """
    A hotel option for a specific stay segment.
    
    NOTE: We do NOT store total_cash_cost as a constant.
    Cost is computed from room selection * nights.
    """
    
    hotel_id: str
    segment_id: int             # Which stay segment
    
    # Hotel info
    hotel_name: str
    chain: str                  # "HYATT", "MARRIOTT", etc.
    star_rating: float
    location_score: float       # 0-1, proximity to attractions
    
    # Room types available
    room_types: List[RoomType]
    
    # Award options (by program)
    # NOTE: Points cost comes from room_types, this is just availability metadata
    award_programs_available: List[str] = field(default_factory=list)
    
    # Quality metrics
    review_score: float = 0.0
    amenities: List[str] = field(default_factory=list)
    
    def cheapest_cash_per_night(self) -> float:
        """Cheapest room per night (for pruning heuristics only)."""
        if not self.room_types:
            return float('inf')
        return min(rt.cash_per_night for rt in self.room_types)
    
    def best_award_value_per_night(self) -> float:
        """Best award value per night (for pruning heuristics only)."""
        best = 0.0
        for rt in self.room_types:
            if rt.points_per_night and rt.points_per_night > 0:
                value = rt.cash_per_night - rt.award_surcharge_per_night
                if value > best:
                    best = value
        return best


# ════════════════════════════════════════════════════════════════════════════
# TRANSFER PATH: Integer-safe transfer modeling
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class TransferPath:
    """
    A transfer path from bank to program.
    
    Integer-safe: effective_delivered_per_block is precomputed as floor().
    """
    
    path_id: str
    from_bank: str              # "AMEX", "CHASE", etc.
    to_program: str             # "united", "hyatt", etc.
    
    # Transfer parameters
    min_increment: int          # e.g., 1000
    ratio: float                # e.g., 1.0 or 0.75
    current_bonus: float        # e.g., 1.25 for 25% promo
    
    # PRECOMPUTED integer-safe delivery
    effective_delivered_per_block: int = 0  # floor(increment * ratio * bonus)
    
    # Timing
    is_instant: bool = True
    typical_hours: int = 0
    max_hours: int = 0
    
    # Promo info
    bonus_expiry_date: Optional[date] = None
    
    def __post_init__(self):
        """Precompute integer-safe delivered points."""
        import math
        raw = self.min_increment * self.ratio * self.current_bonus
        self.effective_delivered_per_block = int(math.floor(raw))
    
    def bank_points_needed(self, target_miles: int) -> int:
        """Compute bank points needed for target miles (ceiling to increment)."""
        import math
        if self.effective_delivered_per_block <= 0:
            return float('inf')
        
        blocks_needed = math.ceil(target_miles / self.effective_delivered_per_block)
        return blocks_needed * self.min_increment


# ════════════════════════════════════════════════════════════════════════════
# PAYER ASSIGNMENT: Who pays for what
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class PayerAssignment:
    """
    Assignment of a payer to a booking.
    
    This is a DECISION in the model, not an input.
    """
    
    booking_key: str            # Flight edge key or hotel segment+id
    booking_type: str           # "flight" or "hotel"
    
    payer_id: str               # Which traveler pays
    payment_method: str         # "cash", "native_points", "transfer_points"
    
    # For points payment
    funding_source: Optional[FundingSource] = None
    
    # Cost to this payer
    cash_amount: float = 0.0
    points_amount: int = 0


# ════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class SlackConfig:
    """Two-pass slack configuration."""
    rel_eps_cash: float = 0.01       # 1% relative slack
    rel_eps_value: float = 0.01
    abs_eps_cash: float = 25.0       # $25 absolute slack
    abs_eps_value: float = 25.0


@dataclass
class BalancedModeConfig:
    """Configuration for balanced mode scoring."""
    
    # Category importance (user-tunable)
    flight_importance: float = 1.0
    hotel_importance: float = 1.0
    
    # Time/convenience penalties
    baseline_hours: float = 8.0      # No penalty up to this
    time_penalty_per_hour: float = 0.03
    connection_penalty: float = 0.25
    redeye_penalty: float = 0.15
    interline_penalty: float = 0.10  # For non-codeshare connections
    
    # Hotel quality bonuses
    star_rating_bonus: Dict[float, float] = field(default_factory=lambda: {
        5.0: 1.2,
        4.5: 1.1,
        4.0: 1.0,
        3.5: 0.95,
        3.0: 0.9,
    })
    
    # Cash term weight (so balanced doesn't ignore cash entirely)
    cash_weight: float = 0.3        # Include cash savings in utility
    
    # Normalization
    min_samples_for_median: int = 5
    outlier_percentile: float = 0.1
    default_density_prior: float = 100.0


@dataclass
class SolverConfig:
    """Solver configuration."""
    
    time_limit_seconds: float = 30.0
    mip_gap: float = 0.01
    
    # For production: allow parallelism
    threads_production: int = 4
    
    # For determinism tests: force single thread
    threads_determinism: int = 1
    
    # Fallback
    enable_heuristic_fallback: bool = True


@dataclass
class PruningConfig:
    """
    Mode-aware multi-criteria pruning.
    
    Keep candidates by MULTIPLE criteria, then union.
    """
    
    # Per O-D limits
    max_flights_per_od_by_cash: int = 10      # Top 10 by lowest cash
    max_flights_per_od_by_time: int = 5       # Top 5 by shortest time
    max_flights_per_od_by_award: int = 10     # Top 10 by best award value
    
    # After union, cap total
    max_flights_per_od_total: int = 20
    
    # Hotels: same multi-criteria approach
    max_hotels_per_seg_by_cash: int = 8
    max_hotels_per_seg_by_award: int = 8
    max_hotels_per_seg_by_rating: int = 5
    max_hotels_per_seg_total: int = 15
    
    # Award programs per edge
    max_award_programs_per_edge: int = 3
    
    # Hard limits
    max_stops: int = 2
    max_duration_hours: float = 36.0
```

**Test:** Create models with sample data, verify `TransferPath` computes integer blocks correctly.

---

## Phase 1: Pre-Solve Validation (Steps 2-3)

### Step 2: Add Alliance/Codeshare Data and Connection Validator

**Files to modify:** `backend/src/optimization/constants.py`

**What I'll do:**

```python
# Add to constants.py

ALLIANCE_PARTNERS = {
    "star_alliance": [
        "UA", "NH", "LH", "SQ", "AC", "TK", "SK", "OS", "LO", "TP", 
        "SA", "ET", "AI", "CA", "ZH", "NZ", "OZ", "BR", "MS", "A3"
    ],
    "oneworld": [
        "AA", "BA", "QF", "CX", "JL", "AY", "IB", "MH", "QR", "RJ",
        "S7", "UL", "AT", "FJ"
    ],
    "skyteam": [
        "DL", "AF", "KL", "KE", "AM", "CI", "CZ", "MU", "OK", "RO",
        "SU", "UX", "VN", "AR", "SV", "ME", "GA"
    ],
}

# Specific codeshare agreements outside alliances
CODESHARE_AGREEMENTS = {
    ("AS", "AA"),  # Alaska - American
    ("B6", "AA"),  # JetBlue - American
    ("HA", "AA"),  # Hawaiian - American
    ("EK", "QF"),  # Emirates - Qantas
    # ... add more as needed
}


def are_codeshare_partners(airline1: str, airline2: str) -> bool:
    """Check if two airlines are partners (alliance or codeshare)."""
    
    if airline1 == airline2:
        return True
    
    # Normalize to 2-letter codes
    a1 = airline1.upper()[:2]
    a2 = airline2.upper()[:2]
    
    # Check alliances
    for alliance, members in ALLIANCE_PARTNERS.items():
        if a1 in members and a2 in members:
            return True
    
    # Check specific agreements
    pair = tuple(sorted([a1, a2]))
    return pair in CODESHARE_AGREEMENTS or (a2, a1) in CODESHARE_AGREEMENTS
```

**Files to create:** `backend/src/optimization/validators.py`

```python
from typing import List, Tuple
from .models import FlightItineraryEdge, TripPlanSpec, HotelOption


def validate_flight_connections(edge: FlightItineraryEdge) -> List[str]:
    """
    Validate connecting flights are same airline or codeshare.
    
    Returns warnings (not errors - interline is allowed but warned).
    """
    return edge.validate_connections()


def validate_trip_spec(spec: TripPlanSpec) -> Tuple[bool, List[str]]:
    """
    Validate TripPlanSpec is internally consistent.
    
    Returns (is_valid, errors).
    """
    errors = spec.validate()
    return len(errors) == 0, errors


def pre_check_feasibility(
    spec: TripPlanSpec,
    flights_by_leg: Dict[int, List[FlightItineraryEdge]],
    hotels_by_segment: Dict[int, List[HotelOption]],
) -> Tuple[bool, List[str]]:
    """
    Pre-check feasibility at data layer (before building MILP).
    
    This is FAST and catches obvious problems.
    """
    issues = []
    
    # Check: Do we have flights for each leg?
    for leg in spec.legs:
        if leg.leg_id not in flights_by_leg or not flights_by_leg[leg.leg_id]:
            issues.append(f"No flights found for leg {leg.leg_id}: {leg.origin_city} → {leg.destination_city}")
    
    # Check: Do we have hotels for each segment?
    for seg in spec.stay_segments:
        if seg.segment_id not in hotels_by_segment or not hotels_by_segment[seg.segment_id]:
            issues.append(f"No hotels found for segment {seg.segment_id}: {seg.city}")
    
    # Check: Do any travelers have enough points for ANY award?
    has_any_usable_points = False
    for traveler in spec.travelers:
        total_points = sum(traveler.points_balances.values())
        total_bank = sum(traveler.bank_balances.values())
        if total_points > 1000 or total_bank > 1000:  # Minimum useful
            has_any_usable_points = True
            break
    
    if not has_any_usable_points:
        issues.append("No travelers have usable points/bank balances")
    
    # Check: Flight dates align with stay dates
    for i, seg in enumerate(spec.stay_segments):
        if i < len(spec.legs):
            leg_flights = flights_by_leg.get(i, [])
            # At least one flight should arrive by check-in
            arrivals_before_checkin = [
                f for f in leg_flights 
                if f.arrival_datetime.date() <= seg.check_in
            ]
            if not arrivals_before_checkin:
                issues.append(
                    f"No flights for leg {i} arrive by segment {seg.segment_id} check-in ({seg.check_in})"
                )
    
    return len(issues) == 0, issues
```

**Test:** Create spec with missing leg flights → verify pre_check catches it.

---

### Step 3: Add Multi-Criteria Pruning

**Files to create:** `backend/src/optimization/pruning.py`

**What I'll do:**

```python
from typing import List, Dict, Set
from collections import defaultdict
from .models import FlightItineraryEdge, HotelOption, PruningConfig


def prune_flights_multi_criteria(
    flights: List[FlightItineraryEdge],
    config: PruningConfig,
) -> List[FlightItineraryEdge]:
    """
    Prune flights using MULTIPLE criteria, then union.
    
    This ensures CPP mode doesn't lose good awards just because cash is high.
    """
    
    # Hard filters first
    filtered = [
        f for f in flights
        if f.num_stops <= config.max_stops
        and f.total_time_minutes / 60 <= config.max_duration_hours
    ]
    
    # Group by (leg_id, origin, destination, date)
    by_od = defaultdict(list)
    for f in filtered:
        key = (f.leg_id, f.origin, f.destination, f.departure_datetime.date())
        by_od[key].append(f)
    
    pruned = []
    
    for od_key, od_flights in by_od.items():
        selected: Set[str] = set()
        
        # Criterion 1: Top K by lowest cash
        by_cash = sorted(od_flights, key=lambda f: f.cash_cost)
        for f in by_cash[:config.max_flights_per_od_by_cash]:
            selected.add(f.edge_key)
        
        # Criterion 2: Top K by shortest time
        by_time = sorted(od_flights, key=lambda f: f.total_time_minutes)
        for f in by_time[:config.max_flights_per_od_by_time]:
            selected.add(f.edge_key)
        
        # Criterion 3: Top K by best award value
        by_award = sorted(
            od_flights, 
            key=lambda f: max((opt.raw_value for opt in f.award_options), default=0),
            reverse=True
        )
        for f in by_award[:config.max_flights_per_od_by_award]:
            selected.add(f.edge_key)
        
        # Collect selected, cap total
        od_selected = [f for f in od_flights if f.edge_key in selected]
        if len(od_selected) > config.max_flights_per_od_total:
            # Score by combined heuristic and take top
            od_selected.sort(key=lambda f: _combined_score(f), reverse=True)
            od_selected = od_selected[:config.max_flights_per_od_total]
        
        pruned.extend(od_selected)
    
    return pruned


def _combined_score(f: FlightItineraryEdge) -> float:
    """Combined heuristic score for final tie-breaking."""
    
    cash_score = 1.0 - min(1.0, f.cash_cost / 5000)
    time_score = 1.0 - min(1.0, f.total_time_minutes / (24 * 60))
    
    best_award = max((opt.raw_value for opt in f.award_options), default=0)
    award_score = min(1.0, best_award / 2000)
    
    # Penalize interline connections
    interline_penalty = 0.1 if f.is_interline else 0
    
    return 0.3 * cash_score + 0.3 * award_score + 0.3 * time_score - interline_penalty


def prune_hotels_multi_criteria(
    hotels: List[HotelOption],
    config: PruningConfig,
) -> List[HotelOption]:
    """
    Prune hotels using multiple criteria.
    """
    
    by_segment = defaultdict(list)
    for h in hotels:
        by_segment[h.segment_id].append(h)
    
    pruned = []
    
    for seg_id, seg_hotels in by_segment.items():
        selected: Set[str] = set()
        
        # Criterion 1: Top K by lowest cash
        by_cash = sorted(seg_hotels, key=lambda h: h.cheapest_cash_per_night())
        for h in by_cash[:config.max_hotels_per_seg_by_cash]:
            selected.add(h.hotel_id)
        
        # Criterion 2: Top K by best award value
        by_award = sorted(
            seg_hotels,
            key=lambda h: h.best_award_value_per_night(),
            reverse=True
        )
        for h in by_award[:config.max_hotels_per_seg_by_award]:
            selected.add(h.hotel_id)
        
        # Criterion 3: Top K by rating
        by_rating = sorted(seg_hotels, key=lambda h: h.star_rating, reverse=True)
        for h in by_rating[:config.max_hotels_per_seg_by_rating]:
            selected.add(h.hotel_id)
        
        # Collect and cap
        seg_selected = [h for h in seg_hotels if h.hotel_id in selected]
        if len(seg_selected) > config.max_hotels_per_seg_total:
            seg_selected.sort(key=lambda h: _hotel_combined_score(h), reverse=True)
            seg_selected = seg_selected[:config.max_hotels_per_seg_total]
        
        pruned.extend(seg_selected)
    
    return pruned


def _hotel_combined_score(h: HotelOption) -> float:
    """Combined heuristic for hotels."""
    
    cash_score = 1.0 - min(1.0, h.cheapest_cash_per_night() / 500)
    award_score = min(1.0, h.best_award_value_per_night() / 300)
    rating_score = (h.star_rating - 3.0) / 2.0  # 3-star=0, 5-star=1
    
    return 0.3 * cash_score + 0.3 * award_score + 0.4 * rating_score
```

**Test:** 100 flights with varying cash/award/time → verify union keeps diverse options.

---

## Phase 2: Core Solver (Steps 4-8)

### Step 4: Create Solver V3 Skeleton

**Files to create:** `backend/src/optimization/solver_v3.py`

**What I'll do:**

```python
"""
V3 Optimization Solver

Key design decisions:
- Stay segments are INPUTS (from TripPlanSpec)
- Payer assignment is a DECISION
- Hotel cost comes from room vars * nights (not constant)
- Two-pass solve with robust slack
- Integer-safe transfers
"""

from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
from enum import Enum
import logging
import time

from pulp import (
    LpProblem, LpMinimize, LpMaximize, LpVariable, LpBinary, LpInteger,
    lpSum, value, LpStatusOptimal, PULP_CBC_CMD
)

from .models import (
    TripPlanSpec, FlightItineraryEdge, HotelOption, TransferPath,
    AwardOption, RoomType, PayerAssignment, FundingSource,
    SlackConfig, SolverConfig, BalancedModeConfig, PruningConfig,
)
from .pruning import prune_flights_multi_criteria, prune_hotels_multi_criteria
from .precompute import precompute_all_soft_values
from .validators import pre_check_feasibility, validate_flight_connections

logger = logging.getLogger(__name__)


class OptimizationMode(Enum):
    OOP = "oop"
    CPP = "cpp"
    BALANCED = "balanced"


class OptimizationStatus(Enum):
    OPTIMAL = "optimal"
    FEASIBLE_SUBOPTIMAL = "feasible_suboptimal"
    INFEASIBLE_PREFERENCES = "infeasible_preferences"
    INFEASIBLE_DATA_MISSING = "infeasible_data_missing"
    INFEASIBLE_TRANSFERS = "infeasible_transfers"
    TIMEOUT = "timeout"
    ERROR = "error"


@dataclass
class OptimizationResult:
    status: OptimizationStatus
    solution: Optional["Solution"]
    
    solve_time_seconds: float
    num_variables: int
    num_constraints: int
    
    warnings: List[str]
    relaxations_applied: List[str]
    suggestions: List[str]
    
    infeasibility_reason: Optional[str] = None
    missing_data: List[str] = None


class OptimizationSolverV3:
    """
    V3 Solver with:
    - Payer-aware decisions
    - Stay segments as inputs
    - Integer-safe transfers
    - Two-pass optimization
    - Multi-criteria pruning
    """
    
    def __init__(
        self,
        mode: OptimizationMode,
        solver_config: SolverConfig = None,
        slack_config: SlackConfig = None,
        balanced_config: BalancedModeConfig = None,
        pruning_config: PruningConfig = None,
        determinism_mode: bool = False,
    ):
        self.mode = mode
        self.solver_config = solver_config or SolverConfig()
        self.slack_config = slack_config or SlackConfig()
        self.balanced_config = balanced_config or BalancedModeConfig()
        self.pruning_config = pruning_config or PruningConfig()
        self.determinism_mode = determinism_mode
        
        # Decision variables (set during build)
        self.model: Optional[LpProblem] = None
        self.vars: Dict = {}
        
        # Data (set during solve)
        self.spec: Optional[TripPlanSpec] = None
        self.flights: List[FlightItineraryEdge] = []
        self.hotels: List[HotelOption] = []
        self.transfers: List[TransferPath] = []
    
    def solve(
        self,
        spec: TripPlanSpec,
        flights: List[FlightItineraryEdge],
        hotels: List[HotelOption],
        transfers: List[TransferPath],
    ) -> OptimizationResult:
        """
        Main solve method.
        """
        
        start_time = time.time()
        warnings = []
        
        # Store data
        self.spec = spec
        
        # ════════════════════════════════════════════════════════════════
        # STEP 1: Validate inputs
        # ════════════════════════════════════════════════════════════════
        
        is_valid, errors = pre_check_feasibility(
            spec,
            self._group_flights_by_leg(flights),
            self._group_hotels_by_segment(hotels),
        )
        
        if not is_valid:
            return OptimizationResult(
                status=OptimizationStatus.INFEASIBLE_DATA_MISSING,
                solution=None,
                solve_time_seconds=time.time() - start_time,
                num_variables=0,
                num_constraints=0,
                warnings=[],
                relaxations_applied=[],
                suggestions=errors,
                infeasibility_reason="Missing required data",
                missing_data=errors,
            )
        
        # ════════════════════════════════════════════════════════════════
        # STEP 2: Validate flight connections
        # ════════════════════════════════════════════════════════════════
        
        for f in flights:
            conn_warnings = validate_flight_connections(f)
            if conn_warnings:
                warnings.extend(conn_warnings)
        
        # ════════════════════════════════════════════════════════════════
        # STEP 3: Prune candidates
        # ════════════════════════════════════════════════════════════════
        
        self.flights = prune_flights_multi_criteria(flights, self.pruning_config)
        self.hotels = prune_hotels_multi_criteria(hotels, self.pruning_config)
        self.transfers = transfers
        
        logger.info(
            f"After pruning: {len(self.flights)} flights, {len(self.hotels)} hotels"
        )
        
        # ════════════════════════════════════════════════════════════════
        # STEP 4: Precompute soft values
        # ════════════════════════════════════════════════════════════════
        
        precompute_all_soft_values(
            self.flights, 
            self.hotels, 
            self.balanced_config,
        )
        
        # ════════════════════════════════════════════════════════════════
        # STEP 5: Build MILP
        # ════════════════════════════════════════════════════════════════
        
        self._build_model()
        
        # ════════════════════════════════════════════════════════════════
        # STEP 6: Two-pass solve
        # ════════════════════════════════════════════════════════════════
        
        result = self._solve_two_pass()
        
        result.solve_time_seconds = time.time() - start_time
        result.warnings.extend(warnings)
        
        return result
    
    def _group_flights_by_leg(self, flights: List[FlightItineraryEdge]) -> Dict[int, List]:
        from collections import defaultdict
        by_leg = defaultdict(list)
        for f in flights:
            by_leg[f.leg_id].append(f)
        return dict(by_leg)
    
    def _group_hotels_by_segment(self, hotels: List[HotelOption]) -> Dict[int, List]:
        from collections import defaultdict
        by_seg = defaultdict(list)
        for h in hotels:
            by_seg[h.segment_id].append(h)
        return dict(by_seg)
    
    def _build_model(self):
        """Build the MILP model. Implemented in Step 5."""
        raise NotImplementedError("Implemented in Step 5")
    
    def _solve_two_pass(self) -> OptimizationResult:
        """Two-pass solve. Implemented in Step 6."""
        raise NotImplementedError("Implemented in Step 6")
```

**Test:** Instantiate solver, verify it accepts valid TripPlanSpec.

---

### Step 5: Build MILP Variables and Constraints

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**

```python
def _build_model(self):
    """
    Build the MILP model.
    
    Decision variables:
    - x_flight[leg][edge]: binary, select this itinerary for leg
    - x_hotel[seg][hotel]: binary, select this hotel for segment
    - n_rooms[seg][hotel][room_type]: integer, how many rooms
    - z_cash_flight[leg][edge][payer]: binary, payer pays cash for flight
    - y_points_flight[leg][edge][payer][source]: binary, payer pays with this source
    - z_cash_hotel[seg][hotel][payer]: binary, payer pays cash for hotel
    - y_points_hotel[seg][hotel][payer][source]: binary, payer pays with source
    - t_blocks[payer][bank][program]: integer, transfer blocks
    """
    
    self.model = LpProblem("TripOptimizationV3", LpMinimize)  # Sense set later
    
    travelers = self.spec.all_traveler_ids
    
    # ════════════════════════════════════════════════════════════════════
    # FLIGHT SELECTION VARIABLES
    # ════════════════════════════════════════════════════════════════════
    
    # x_flight[leg][edge] = 1 if this itinerary is chosen for this leg
    self.vars["x_flight"] = {}
    for f in self.flights:
        self.vars["x_flight"][(f.leg_id, f.edge_key)] = LpVariable(
            f"x_f_{f.leg_id}_{f.edge_key}", cat=LpBinary
        )
    
    # ════════════════════════════════════════════════════════════════════
    # HOTEL SELECTION AND ROOM ALLOCATION VARIABLES
    # ════════════════════════════════════════════════════════════════════
    
    # x_hotel[seg][hotel] = 1 if this hotel is chosen
    self.vars["x_hotel"] = {}
    # n_rooms[seg][hotel][room_type] = number of rooms
    self.vars["n_rooms"] = {}
    
    for h in self.hotels:
        key = (h.segment_id, h.hotel_id)
        self.vars["x_hotel"][key] = LpVariable(
            f"x_h_{h.segment_id}_{h.hotel_id}", cat=LpBinary
        )
        
        for rt in h.room_types:
            rt_key = (h.segment_id, h.hotel_id, rt.room_type_id)
            self.vars["n_rooms"][rt_key] = LpVariable(
                f"n_r_{h.segment_id}_{h.hotel_id}_{rt.room_type_id}",
                lowBound=0,
                cat=LpInteger
            )
    
    # ════════════════════════════════════════════════════════════════════
    # PAYMENT VARIABLES (PAYER-AWARE)
    # ════════════════════════════════════════════════════════════════════
    
    self._build_payment_variables()
    
    # ════════════════════════════════════════════════════════════════════
    # TRANSFER VARIABLES
    # ════════════════════════════════════════════════════════════════════
    
    self._build_transfer_variables()
    
    # ════════════════════════════════════════════════════════════════════
    # CONSTRAINTS
    # ════════════════════════════════════════════════════════════════════
    
    self._add_flight_selection_constraints()
    self._add_hotel_selection_constraints()
    self._add_room_allocation_constraints()
    self._add_payment_constraints()
    self._add_transfer_constraints()
    self._add_balance_constraints()


def _build_payment_variables(self):
    """Build payer-aware payment decision variables."""
    
    travelers = self.spec.all_traveler_ids
    
    # For each flight, each payer can pay cash or points
    self.vars["z_cash_flight"] = {}    # Payer pays cash
    self.vars["y_points_flight"] = {}  # Payer pays with points source
    
    for f in self.flights:
        fkey = (f.leg_id, f.edge_key)
        
        for payer in travelers:
            # Cash payment option
            self.vars["z_cash_flight"][(fkey, payer)] = LpVariable(
                f"zf_{f.leg_id}_{f.edge_key}_{payer}", cat=LpBinary
            )
            
            # Points payment options (one per funding source)
            for opt in f.award_options:
                for source in self._get_funding_sources(payer, opt.program):
                    skey = (fkey, payer, source.key)
                    self.vars["y_points_flight"][skey] = LpVariable(
                        f"yf_{f.leg_id}_{f.edge_key}_{payer}_{source.key}",
                        cat=LpBinary
                    )
    
    # Same for hotels
    self.vars["z_cash_hotel"] = {}
    self.vars["y_points_hotel"] = {}
    
    for h in self.hotels:
        hkey = (h.segment_id, h.hotel_id)
        
        for payer in travelers:
            self.vars["z_cash_hotel"][(hkey, payer)] = LpVariable(
                f"zh_{h.segment_id}_{h.hotel_id}_{payer}", cat=LpBinary
            )
            
            for prog in h.award_programs_available:
                for source in self._get_funding_sources(payer, prog):
                    skey = (hkey, payer, source.key)
                    self.vars["y_points_hotel"][skey] = LpVariable(
                        f"yh_{h.segment_id}_{h.hotel_id}_{payer}_{source.key}",
                        cat=LpBinary
                    )


def _get_funding_sources(self, payer_id: str, program: str) -> List[FundingSource]:
    """Get all funding sources a payer can use for a program."""
    
    traveler = self.spec.get_traveler(payer_id)
    sources = []
    
    # Native points
    if program in traveler.points_balances and traveler.points_balances[program] > 0:
        sources.append(FundingSource(
            source_type="native",
            traveler_id=payer_id,
            program=program,
        ))
    
    # Transfer paths from this payer's banks
    for tp in self.transfers:
        if tp.to_program == program and tp.from_bank in traveler.bank_balances:
            sources.append(FundingSource(
                source_type="transfer",
                traveler_id=payer_id,
                from_bank=tp.from_bank,
                to_program=program,
                transfer_path_id=tp.path_id,
            ))
    
    # If pooling allowed, include other travelers' sources
    if self.spec.allow_points_pooling:
        for other in self.spec.travelers:
            if other.traveler_id == payer_id:
                continue
            
            if program in other.points_balances and other.points_balances[program] > 0:
                sources.append(FundingSource(
                    source_type="native",
                    traveler_id=other.traveler_id,
                    program=program,
                ))
            
            for tp in self.transfers:
                if tp.to_program == program and tp.from_bank in other.bank_balances:
                    sources.append(FundingSource(
                        source_type="transfer",
                        traveler_id=other.traveler_id,
                        from_bank=tp.from_bank,
                        to_program=program,
                        transfer_path_id=tp.path_id,
                    ))
    
    return sources
```

**Test:** Build model for simple 1-leg, 1-segment trip, verify var count.

---

### Step 6: Add Constraints

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**

```python
def _add_flight_selection_constraints(self):
    """Exactly one flight per leg."""
    
    flights_by_leg = self._group_flights_by_leg(self.flights)
    
    for leg in self.spec.legs:
        leg_flights = flights_by_leg.get(leg.leg_id, [])
        
        self.model += lpSum(
            self.vars["x_flight"][(leg.leg_id, f.edge_key)]
            for f in leg_flights
        ) == 1, f"one_flight_leg_{leg.leg_id}"


def _add_hotel_selection_constraints(self):
    """Exactly one hotel per stay segment."""
    
    hotels_by_seg = self._group_hotels_by_segment(self.hotels)
    
    for seg in self.spec.stay_segments:
        seg_hotels = hotels_by_seg.get(seg.segment_id, [])
        
        self.model += lpSum(
            self.vars["x_hotel"][(seg.segment_id, h.hotel_id)]
            for h in seg_hotels
        ) == 1, f"one_hotel_seg_{seg.segment_id}"


def _add_room_allocation_constraints(self):
    """Room allocation for group travel."""
    
    hotels_by_seg = self._group_hotels_by_segment(self.hotels)
    
    for seg in self.spec.stay_segments:
        # How many travelers need rooms in this segment
        num_travelers = len(seg.traveler_ids)
        
        for h in hotels_by_seg.get(seg.segment_id, []):
            hkey = (seg.segment_id, h.hotel_id)
            
            # Total capacity from selected rooms
            total_capacity = lpSum(
                self.vars["n_rooms"][(seg.segment_id, h.hotel_id, rt.room_type_id)] * rt.capacity
                for rt in h.room_types
            )
            
            # Capacity >= travelers if hotel selected
            self.model += (
                total_capacity >= num_travelers * self.vars["x_hotel"][hkey]
            ), f"room_cap_{seg.segment_id}_{h.hotel_id}"
            
            # Rooms only if hotel selected
            for rt in h.room_types:
                rt_key = (seg.segment_id, h.hotel_id, rt.room_type_id)
                # Upper bound: at most num_travelers rooms (one per person max)
                self.model += (
                    self.vars["n_rooms"][rt_key] <= num_travelers * self.vars["x_hotel"][hkey]
                ), f"room_sel_{seg.segment_id}_{h.hotel_id}_{rt.room_type_id}"
            
            # Minimum rooms if specified
            if seg.min_rooms:
                total_rooms = lpSum(
                    self.vars["n_rooms"][(seg.segment_id, h.hotel_id, rt.room_type_id)]
                    for rt in h.room_types
                )
                self.model += (
                    total_rooms >= seg.min_rooms * self.vars["x_hotel"][hkey]
                ), f"min_rooms_{seg.segment_id}_{h.hotel_id}"


def _add_payment_constraints(self):
    """
    Payment constraints:
    - If flight selected, exactly one payer+method must pay
    - If hotel selected, exactly one payer+method must pay
    """
    
    # Flights
    for f in self.flights:
        fkey = (f.leg_id, f.edge_key)
        
        # All payment options for this flight
        cash_vars = [
            self.vars["z_cash_flight"][(fkey, p)]
            for p in self.spec.all_traveler_ids
        ]
        
        points_vars = [
            v for k, v in self.vars["y_points_flight"].items()
            if k[0] == fkey
        ]
        
        # If flight selected, exactly one payment
        self.model += (
            lpSum(cash_vars) + lpSum(points_vars) == self.vars["x_flight"][fkey]
        ), f"one_payment_flight_{f.leg_id}_{f.edge_key}"
    
    # Hotels
    for h in self.hotels:
        hkey = (h.segment_id, h.hotel_id)
        
        cash_vars = [
            self.vars["z_cash_hotel"][(hkey, p)]
            for p in self.spec.all_traveler_ids
        ]
        
        points_vars = [
            v for k, v in self.vars["y_points_hotel"].items()
            if k[0] == hkey
        ]
        
        self.model += (
            lpSum(cash_vars) + lpSum(points_vars) == self.vars["x_hotel"][hkey]
        ), f"one_payment_hotel_{h.segment_id}_{h.hotel_id}"


def _add_transfer_constraints(self):
    """
    Transfer constraints with INTEGER delivery.
    """
    
    # t_blocks[payer][bank][program] = transfer blocks used
    self.vars["t_blocks"] = {}
    
    for payer in self.spec.all_traveler_ids:
        traveler = self.spec.get_traveler(payer)
        
        for tp in self.transfers:
            if tp.from_bank in traveler.bank_balances:
                tkey = (payer, tp.from_bank, tp.to_program)
                self.vars["t_blocks"][tkey] = LpVariable(
                    f"tb_{payer}_{tp.from_bank}_{tp.to_program}",
                    lowBound=0,
                    cat=LpInteger
                )
    
    # For each (payer, program), miles used <= delivered
    for payer in self.spec.all_traveler_ids:
        for tp in self.transfers:
            tkey = (payer, tp.from_bank, tp.to_program)
            
            if tkey not in self.vars["t_blocks"]:
                continue
            
            # Miles used via this transfer path
            miles_used = self._compute_miles_used(payer, tp)
            
            # Delivered (INTEGER coefficient!)
            delivered = self.vars["t_blocks"][tkey] * tp.effective_delivered_per_block
            
            self.model += (
                miles_used <= delivered
            ), f"transfer_int_{payer}_{tp.from_bank}_{tp.to_program}"


def _compute_miles_used(self, payer: str, tp: TransferPath):
    """Compute miles used by payer via this transfer path."""
    
    prog = tp.to_program
    source_key = ("transfer", payer, tp.from_bank, prog)
    
    # Flights
    flight_miles = lpSum(
        self.vars["y_points_flight"][(fkey, payer, source_key)] * opt.miles_required
        for f in self.flights
        for opt in f.award_options
        if opt.program == prog
        for fkey in [(f.leg_id, f.edge_key)]
        if (fkey, payer, source_key) in self.vars["y_points_flight"]
    )
    
    # Hotels (per night * nights)
    hotel_points = lpSum(
        self.vars["y_points_hotel"][(hkey, payer, source_key)] * self._hotel_points_cost(h, prog)
        for h in self.hotels
        if prog in h.award_programs_available
        for hkey in [(h.segment_id, h.hotel_id)]
        if (hkey, payer, source_key) in self.vars["y_points_hotel"]
    )
    
    return flight_miles + hotel_points


def _hotel_points_cost(self, h: HotelOption, program: str) -> int:
    """Get points cost for hotel (uses cheapest award room)."""
    
    seg = next(s for s in self.spec.stay_segments if s.segment_id == h.segment_id)
    
    for rt in h.room_types:
        if rt.award_program == program and rt.points_per_night:
            return rt.points_per_night * seg.nights
    
    return 0


def _add_balance_constraints(self):
    """
    Balance constraints:
    - Native points used <= balance
    - Bank points used (via transfers) <= balance
    """
    
    for traveler in self.spec.travelers:
        payer = traveler.traveler_id
        
        # Native program balances
        for prog, balance in traveler.points_balances.items():
            native_source = ("native", payer, prog)
            
            native_used = self._compute_native_miles_used(payer, prog, native_source)
            
            self.model += (
                native_used <= balance
            ), f"native_balance_{payer}_{prog}"
        
        # Bank balances (sum of blocks * increment)
        for bank, balance in traveler.bank_balances.items():
            bank_used = lpSum(
                self.vars["t_blocks"][(payer, bank, tp.to_program)] * tp.min_increment
                for tp in self.transfers
                if tp.from_bank == bank and (payer, bank, tp.to_program) in self.vars["t_blocks"]
            )
            
            self.model += (
                bank_used <= balance
            ), f"bank_balance_{payer}_{bank}"


def _compute_native_miles_used(self, payer: str, program: str, source_key: Tuple):
    """Compute native miles used by payer for program."""
    
    # Similar to _compute_miles_used but for native sources
    flight_miles = lpSum(
        self.vars["y_points_flight"][(fkey, payer, source_key)] * opt.miles_required
        for f in self.flights
        for opt in f.award_options
        if opt.program == program
        for fkey in [(f.leg_id, f.edge_key)]
        if (fkey, payer, source_key) in self.vars["y_points_flight"]
    )
    
    hotel_points = lpSum(
        self.vars["y_points_hotel"][(hkey, payer, source_key)] * self._hotel_points_cost(h, program)
        for h in self.hotels
        if program in h.award_programs_available
        for hkey in [(h.segment_id, h.hotel_id)]
        if (hkey, payer, source_key) in self.vars["y_points_hotel"]
    )
    
    return flight_miles + hotel_points
```

**Test:** Build constraints for 2-person trip, verify payer variables exist.

---

### Step 7: Implement Objectives (OOP, CPP, Balanced)

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**

```python
def _build_primary_objective(self):
    """Build primary objective based on mode."""
    
    if self.mode == OptimizationMode.OOP:
        return self._build_oop_objective()
    elif self.mode == OptimizationMode.CPP:
        return self._build_cpp_objective()
    elif self.mode == OptimizationMode.BALANCED:
        return self._build_balanced_objective()
    else:
        raise ValueError(f"Unknown mode: {self.mode}")


def _build_oop_objective(self):
    """
    OOP: Minimize out-of-pocket cash.
    
    Cash = Σ(flight_cash) + Σ(hotel_cash_from_rooms) + Σ(surcharges)
    """
    
    # Flight cash payments
    flight_cash = lpSum(
        self.vars["z_cash_flight"][(fkey, payer)] * f.cash_cost
        for f in self.flights
        for fkey in [(f.leg_id, f.edge_key)]
        for payer in self.spec.all_traveler_ids
    )
    
    # Flight award surcharges
    flight_surcharges = lpSum(
        self.vars["y_points_flight"][(fkey, payer, source)] * opt.surcharge
        for f in self.flights
        for fkey in [(f.leg_id, f.edge_key)]
        for opt in f.award_options
        for payer in self.spec.all_traveler_ids
        for source in self._get_funding_sources(payer, opt.program)
        if (fkey, payer, source.key) in self.vars["y_points_flight"]
    )
    
    # Hotel cash: FROM ROOM VARIABLES (not constant total_cash_cost!)
    hotel_cash = lpSum(
        self.vars["z_cash_hotel"][(hkey, payer)] * self._compute_hotel_cash_cost(h)
        for h in self.hotels
        for hkey in [(h.segment_id, h.hotel_id)]
        for payer in self.spec.all_traveler_ids
    )
    
    # Actually, hotel cash depends on WHICH rooms are selected
    # This is more complex - need to link room selection to cost
    hotel_room_cash = self._compute_hotel_room_cash_objective()
    
    # Hotel award surcharges
    hotel_surcharges = lpSum(
        self.vars["y_points_hotel"][(hkey, payer, source)] * self._hotel_surcharge(h)
        for h in self.hotels
        for hkey in [(h.segment_id, h.hotel_id)]
        for payer in self.spec.all_traveler_ids
        for source_key, var in self.vars["y_points_hotel"].items()
        if source_key[0] == hkey and source_key[1] == payer
    )
    
    return flight_cash + flight_surcharges + hotel_room_cash + hotel_surcharges


def _compute_hotel_room_cash_objective(self):
    """
    Compute hotel cash cost from room variables.
    
    Cash cost = Σ n_rooms[rt] * cash_per_night * nights * z_cash_hotel
    
    But this is n_rooms * z_cash which is a product of two variables!
    
    Linearization: We need auxiliary variables.
    """
    
    # For simplicity in MVP, assume cash payment uses cheapest room config
    # that satisfies capacity. This avoids the bilinear term.
    
    # More accurate: add auxiliary vars w[seg][hotel][rt][payer] = n_rooms * z_cash
    # with linearization constraints.
    
    # MVP approach: if paying cash, cost is based on room allocation
    # Room allocation is determined by constraints, not payment choice
    
    total = 0
    
    for h in self.hotels:
        seg = next(s for s in self.spec.stay_segments if s.segment_id == h.segment_id)
        
        for rt in h.room_types:
            rt_key = (seg.segment_id, h.hotel_id, rt.room_type_id)
            
            # Room cost if paying cash
            # n_rooms[rt] * rate * nights  (contributed when paying cash)
            # But we only pay this if z_cash_hotel is 1
            
            # This requires: if z_cash_hotel, then cost = Σ n_rooms * rate * nights
            # Which is: total += n_rooms * rate * nights * z_cash_hotel
            
            # Linearization: introduce w_rt = n_rooms[rt] * z_cash_hotel
            # w_rt <= n_rooms[rt]
            # w_rt <= M * z_cash_hotel
            # w_rt >= n_rooms[rt] - M * (1 - z_cash_hotel)
            
            # For MVP, assume room allocation is independent of payment
            # and cash cost is simply what the rooms cost
            
            # Actually, simpler: rooms are allocated based on x_hotel, not payment
            # So room cost is incurred regardless of payment method
            # Payment method determines WHO pays, not what's paid
            
            # So: total cash = Σ n_rooms * rate * nights
            # Attribution to payer: when z_cash_hotel[payer] = 1
            
            pass
    
    # Simpler model: hotel cash cost = n_rooms * rate * nights
    # This is incurred if paying cash (any payer)
    
    hotel_room_cash = lpSum(
        self.vars["n_rooms"][(seg.segment_id, h.hotel_id, rt.room_type_id)] 
        * rt.cash_per_night 
        * seg.nights
        * lpSum(self.vars["z_cash_hotel"][((seg.segment_id, h.hotel_id), p)] for p in self.spec.all_traveler_ids)
        for h in self.hotels
        for seg in [next(s for s in self.spec.stay_segments if s.segment_id == h.segment_id)]
        for rt in h.room_types
    )
    
    # This is still bilinear (n_rooms * z_cash_hotel)
    # Need proper linearization or reformulation
    
    # For MVP: Introduce w_cash_room[seg][hotel][rt] variable
    # and linearize
    
    return self._linearized_hotel_cash_cost()


def _linearized_hotel_cash_cost(self):
    """
    Linearized hotel cash cost.
    
    Introduce: w[seg][hotel][rt] = n_rooms[rt] if paying cash, else 0
    """
    
    M = len(self.spec.travelers) + 5  # Big-M (max rooms)
    
    self.vars["w_cash_room"] = {}
    
    total = 0
    
    for h in self.hotels:
        seg = next(s for s in self.spec.stay_segments if s.segment_id == h.segment_id)
        hkey = (seg.segment_id, h.hotel_id)
        
        # Is anyone paying cash for this hotel?
        z_cash_any = lpSum(
            self.vars["z_cash_hotel"][(hkey, p)] 
            for p in self.spec.all_traveler_ids
        )
        
        for rt in h.room_types:
            rt_key = (seg.segment_id, h.hotel_id, rt.room_type_id)
            
            # w = n_rooms if paying cash
            w_key = (seg.segment_id, h.hotel_id, rt.room_type_id, "cash")
            self.vars["w_cash_room"][w_key] = LpVariable(
                f"w_cash_{seg.segment_id}_{h.hotel_id}_{rt.room_type_id}",
                lowBound=0,
                cat=LpInteger
            )
            
            w = self.vars["w_cash_room"][w_key]
            n = self.vars["n_rooms"][rt_key]
            
            # Linearization:
            # w <= n
            # w <= M * z_cash_any
            # w >= n - M * (1 - z_cash_any)
            
            self.model += w <= n, f"w_cash_ub1_{w_key}"
            self.model += w <= M * z_cash_any, f"w_cash_ub2_{w_key}"
            self.model += w >= n - M * (1 - z_cash_any), f"w_cash_lb_{w_key}"
            
            # Add to total
            total += w * rt.cash_per_night * seg.nights
    
    return total


def _build_cpp_objective(self):
    """
    CPP: Maximize redemption value using PRECOMPUTED soft values.
    """
    
    # Flight award value
    flight_value = lpSum(
        self.vars["y_points_flight"][(fkey, payer, source.key)] * opt.soft_value_cpp
        for f in self.flights
        for fkey in [(f.leg_id, f.edge_key)]
        for opt in f.award_options
        for payer in self.spec.all_traveler_ids
        for source in self._get_funding_sources(payer, opt.program)
        if (fkey, payer, source.key) in self.vars["y_points_flight"]
    )
    
    # Hotel award value
    hotel_value = lpSum(
        self.vars["y_points_hotel"][(hkey, payer, source.key)] * self._hotel_soft_value_cpp(h)
        for h in self.hotels
        for hkey in [(h.segment_id, h.hotel_id)]
        for payer in self.spec.all_traveler_ids
        for source_key, var in self.vars["y_points_hotel"].items()
        if source_key[0] == hkey and source_key[1] == payer
    )
    
    return flight_value + hotel_value


def _build_balanced_objective(self):
    """
    Balanced: Combine value + time + cash with SEPARATE normalization.
    """
    
    cfg = self.balanced_config
    
    # Compute K values for normalization
    K_flight = self._compute_k_flight()
    K_hotel = self._compute_k_hotel()
    
    # Flight utility (normalized value with time/connection penalties)
    flight_utility = lpSum(
        self.vars["y_points_flight"][(fkey, payer, source.key)] 
        * (opt.soft_value_balanced / K_flight) 
        * cfg.flight_importance
        for f in self.flights
        for fkey in [(f.leg_id, f.edge_key)]
        for opt in f.award_options
        for payer in self.spec.all_traveler_ids
        for source in self._get_funding_sources(payer, opt.program)
        if (fkey, payer, source.key) in self.vars["y_points_flight"]
    )
    
    # Hotel utility
    hotel_utility = lpSum(
        self.vars["y_points_hotel"][(hkey, payer, source.key)]
        * (self._hotel_soft_value_balanced(h) / K_hotel)
        * cfg.hotel_importance
        for h in self.hotels
        for hkey in [(h.segment_id, h.hotel_id)]
        for payer in self.spec.all_traveler_ids
        for source_key, var in self.vars["y_points_hotel"].items()
        if source_key[0] == hkey and source_key[1] == payer
    )
    
    # Cash savings term (so balanced doesn't ignore cash entirely)
    # This is: baseline_cash - actual_cash
    baseline_cash = self._compute_baseline_cash()
    actual_cash = self._build_oop_objective()
    cash_savings = baseline_cash - actual_cash
    
    # Total utility = points_utility + cash_weight * cash_savings
    return flight_utility + hotel_utility + cfg.cash_weight * cash_savings
```

**Test:** Each mode produces different objective expression.

---

### Step 8: Implement Two-Pass Solve

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**

```python
def _solve_two_pass(self) -> OptimizationResult:
    """
    Two-pass lexicographic optimization with robust slack.
    """
    
    # Get solver (determinism-aware)
    threads = (
        self.solver_config.threads_determinism if self.determinism_mode
        else self.solver_config.threads_production
    )
    
    solver = PULP_CBC_CMD(
        msg=False,
        timeLimit=self.solver_config.time_limit_seconds,
        gapRel=self.solver_config.mip_gap,
        threads=threads,
    )
    
    # ════════════════════════════════════════════════════════════════════
    # PASS 1: Primary objective
    # ════════════════════════════════════════════════════════════════════
    
    primary_obj = self._build_primary_objective()
    
    if self.mode == OptimizationMode.OOP:
        self.model.setObjective(primary_obj, sense=LpMinimize)
    else:
        self.model.setObjective(primary_obj, sense=LpMaximize)
    
    status = self.model.solve(solver)
    
    if status != LpStatusOptimal:
        return self._handle_infeasibility()
    
    opt_primary = value(primary_obj)
    
    # ════════════════════════════════════════════════════════════════════
    # Compute robust slack: max(absolute, relative * opt)
    # ════════════════════════════════════════════════════════════════════
    
    if self.mode == OptimizationMode.OOP:
        slack = max(
            self.slack_config.abs_eps_cash,
            self.slack_config.rel_eps_cash * abs(opt_primary)
        )
        self.model += primary_obj <= opt_primary + slack, "pass1_bound"
    else:
        slack = max(
            self.slack_config.abs_eps_value,
            self.slack_config.rel_eps_value * abs(opt_primary)
        )
        self.model += primary_obj >= opt_primary - slack, "pass1_bound"
    
    logger.info(f"Pass 1: opt={opt_primary:.2f}, slack={slack:.2f}")
    
    # ════════════════════════════════════════════════════════════════════
    # PASS 2: Secondary objective (tie-breaking)
    # ════════════════════════════════════════════════════════════════════
    
    secondary_obj = self._build_secondary_objective(slack)
    self.model.setObjective(secondary_obj, sense=LpMinimize)
    
    status = self.model.solve(solver)
    
    if status != LpStatusOptimal:
        # Pass 2 failed - use pass 1 solution
        logger.warning("Pass 2 failed, using pass 1 solution")
        return OptimizationResult(
            status=OptimizationStatus.FEASIBLE_SUBOPTIMAL,
            solution=self._extract_solution(),
            num_variables=len(self.model.variables()),
            num_constraints=len(self.model.constraints),
            warnings=["Secondary optimization failed"],
            relaxations_applied=[],
            suggestions=[],
            solve_time_seconds=0,
        )
    
    return OptimizationResult(
        status=OptimizationStatus.OPTIMAL,
        solution=self._extract_solution(),
        num_variables=len(self.model.variables()),
        num_constraints=len(self.model.constraints),
        warnings=[],
        relaxations_applied=[],
        suggestions=[],
        solve_time_seconds=0,
    )


def _build_secondary_objective(self, primary_slack: float):
    """
    Build secondary objective with safe tie-breaking.
    """
    
    # Count edges for safe epsilon
    n_edges = len(self.flights) + len(self.hotels)
    safe_eps = self._compute_safe_epsilon(primary_slack, n_edges)
    
    # Secondary goals: prefer shorter flights, fewer stops, earlier departure
    time_penalty = lpSum(
        self.vars["x_flight"][(f.leg_id, f.edge_key)] * f.total_time_minutes
        for f in self.flights
    )
    
    stops_penalty = lpSum(
        self.vars["x_flight"][(f.leg_id, f.edge_key)] * f.num_stops * 60  # 60 min per stop
        for f in self.flights
    )
    
    interline_penalty = lpSum(
        self.vars["x_flight"][(f.leg_id, f.edge_key)] * (30 if f.is_interline else 0)
        for f in self.flights
    )
    
    # Deterministic tie-breaker
    sorted_flight_keys = sorted(self.vars["x_flight"].keys())
    sorted_hotel_keys = sorted(self.vars["x_hotel"].keys())
    all_keys = sorted_flight_keys + sorted_hotel_keys
    
    tie_breaker = lpSum(
        (self.vars["x_flight"][k] if k in self.vars["x_flight"] else self.vars["x_hotel"][k])
        * (i * safe_eps)
        for i, k in enumerate(all_keys)
    )
    
    return time_penalty + stops_penalty + interline_penalty + tie_breaker


def _compute_safe_epsilon(self, primary_slack: float, n_edges: int) -> float:
    """
    Compute epsilon that won't affect primary objective.
    """
    
    if n_edges <= 1 or abs(primary_slack) < 1e-10:
        return 1e-12
    
    max_sum = n_edges * (n_edges - 1) / 2
    if max_sum <= 0:
        return 1e-12
    
    safe_eps = (1e-6 * abs(primary_slack)) / max_sum
    return max(1e-15, min(1e-6, safe_eps))


def _handle_infeasibility(self) -> OptimizationResult:
    """
    Handle infeasible model.
    
    Use heuristic diagnosis, not re-solve.
    """
    
    # Heuristic checks
    suggestions = []
    
    # Check if any flights per leg
    for leg in self.spec.legs:
        leg_flights = [f for f in self.flights if f.leg_id == leg.leg_id]
        if not leg_flights:
            suggestions.append(f"No flights found for leg {leg.leg_id}")
    
    # Check if any hotels per segment
    for seg in self.spec.stay_segments:
        seg_hotels = [h for h in self.hotels if h.segment_id == seg.segment_id]
        if not seg_hotels:
            suggestions.append(f"No hotels found for segment {seg.segment_id}")
    
    if not suggestions:
        suggestions.append("Unable to find feasible solution. Try different dates or relax preferences.")
    
    return OptimizationResult(
        status=OptimizationStatus.INFEASIBLE_DATA_MISSING,
        solution=None,
        num_variables=len(self.model.variables()),
        num_constraints=len(self.model.constraints),
        warnings=[],
        relaxations_applied=[],
        suggestions=suggestions,
        infeasibility_reason="No feasible solution found",
        missing_data=suggestions,
        solve_time_seconds=0,
    )
```

**Test:** Two-pass solve on simple trip, verify slack applied correctly.

---

## Phase 3: Testing (Steps 9-10)

### Step 9: Add Unit Tests

**Files to create:** `backend/tests/test_optimization_v3.py`

**What I'll do:**

```python
import pytest
from datetime import date, datetime
from src.optimization.trip_spec import TripPlanSpec, Traveler, OrderedLeg, StaySegment, GroupTravelMode
from src.optimization.models import (
    FlightItineraryEdge, FlightSegment, AwardOption, HotelOption, RoomType, TransferPath
)
from src.optimization.solver_v3 import OptimizationSolverV3, OptimizationMode, OptimizationStatus
from src.optimization.pruning import prune_flights_multi_criteria, PruningConfig
from src.optimization.validators import validate_flight_connections, pre_check_feasibility


class TestTripSpec:
    """Test TripPlanSpec validation."""
    
    def test_valid_spec(self):
        spec = make_sample_spec()
        errors = spec.validate()
        assert len(errors) == 0
    
    def test_mismatched_legs_segments(self):
        spec = make_sample_spec()
        spec.stay_segments = []  # Remove segments
        errors = spec.validate()
        assert any("stay segments" in e for e in errors)


class TestConnectionValidation:
    """Test flight connection validation."""
    
    def test_same_airline_valid(self):
        edge = make_two_segment_flight("UA", "UA")
        warnings = validate_flight_connections(edge)
        assert len(warnings) == 0
        assert not edge.is_interline
    
    def test_alliance_partners_valid(self):
        # United and ANA (both Star Alliance)
        edge = make_two_segment_flight("UA", "NH")
        warnings = validate_flight_connections(edge)
        assert len(warnings) == 0 or "operated by" in warnings[0]  # Codeshare note
    
    def test_different_alliance_warning(self):
        # United and American (different alliances)
        edge = make_two_segment_flight("UA", "AA")
        warnings = validate_flight_connections(edge)
        assert any("interline" in w.lower() for w in warnings)
        assert edge.is_interline


class TestPruning:
    """Test multi-criteria pruning."""
    
    def test_keeps_cheap_flights(self):
        flights = [
            make_flight(cash=100),
            make_flight(cash=500),
            make_flight(cash=1000),
        ]
        pruned = prune_flights_multi_criteria(flights, PruningConfig(max_flights_per_od_by_cash=2))
        assert len([f for f in pruned if f.cash_cost <= 500]) >= 2
    
    def test_keeps_high_value_awards(self):
        flights = [
            make_flight(cash=1000, award_value=500),  # High cash but great award
            make_flight(cash=200, award_value=50),    # Cheap but poor award
        ]
        pruned = prune_flights_multi_criteria(flights, PruningConfig(max_flights_per_od_by_award=1))
        assert any(f.cash_cost == 1000 for f in pruned)  # Kept high-value award


class TestIntegerTransfers:
    """Test integer-safe transfer math."""
    
    def test_effective_delivered_is_integer(self):
        tp = TransferPath(
            path_id="test",
            from_bank="AMEX",
            to_program="united",
            min_increment=1000,
            ratio=0.75,
            current_bonus=1.25,
        )
        # 1000 * 0.75 * 1.25 = 937.5 -> floor = 937
        assert tp.effective_delivered_per_block == 937
        assert isinstance(tp.effective_delivered_per_block, int)
    
    def test_bank_points_needed_ceiling(self):
        tp = TransferPath(
            path_id="test",
            from_bank="AMEX",
            to_program="united",
            min_increment=1000,
            ratio=1.0,
            current_bonus=1.0,
        )
        # Need 1500 miles -> 2 blocks = 2000 bank points
        assert tp.bank_points_needed(1500) == 2000


class TestSolverDeterminism:
    """Test solver determinism with threads=1."""
    
    def test_same_input_same_output(self):
        spec = make_sample_spec()
        flights = make_sample_flights()
        hotels = make_sample_hotels()
        transfers = make_sample_transfers()
        
        solver1 = OptimizationSolverV3(
            mode=OptimizationMode.BALANCED,
            determinism_mode=True,  # threads=1
        )
        result1 = solver1.solve(spec, flights, hotels, transfers)
        
        solver2 = OptimizationSolverV3(
            mode=OptimizationMode.BALANCED,
            determinism_mode=True,
        )
        result2 = solver2.solve(spec, flights, hotels, transfers)
        
        assert result1.solution.selected_flights == result2.solution.selected_flights
        assert result1.solution.selected_hotels == result2.solution.selected_hotels


# Helper functions for test fixtures
def make_sample_spec() -> TripPlanSpec:
    return TripPlanSpec(
        trip_id="test_trip",
        travelers=[
            Traveler(
                traveler_id="alice",
                name="Alice",
                home_airport="JFK",
                points_balances={"united": 50000},
                bank_balances={"CHASE": 100000},
            ),
        ],
        legs=[
            OrderedLeg(leg_id=0, origin_city="NYC", destination_city="TYO",
                      earliest_departure=date(2025, 3, 1), latest_departure=date(2025, 3, 2),
                      traveler_ids=["alice"]),
            OrderedLeg(leg_id=1, origin_city="TYO", destination_city="NYC",
                      earliest_departure=date(2025, 3, 5), latest_departure=date(2025, 3, 6),
                      traveler_ids=["alice"]),
        ],
        stay_segments=[
            StaySegment(segment_id=0, city="TYO", check_in=date(2025, 3, 1),
                       check_out=date(2025, 3, 5), traveler_ids=["alice"]),
        ],
    )


def make_two_segment_flight(carrier1: str, carrier2: str) -> FlightItineraryEdge:
    return FlightItineraryEdge(
        edge_key="test_edge",
        leg_id=0,
        origin="JFK",
        destination="NRT",
        segments=[
            FlightSegment(
                flight_number=f"{carrier1}100",
                operating_carrier=carrier1,
                marketing_carrier=carrier1,
                origin="JFK", destination="ORD",
                departure=datetime(2025, 3, 1, 10, 0),
                arrival=datetime(2025, 3, 1, 12, 0),
            ),
            FlightSegment(
                flight_number=f"{carrier2}200",
                operating_carrier=carrier2,
                marketing_carrier=carrier2,
                origin="ORD", destination="NRT",
                departure=datetime(2025, 3, 1, 14, 0),
                arrival=datetime(2025, 3, 2, 18, 0),
            ),
        ],
        departure_datetime=datetime(2025, 3, 1, 10, 0),
        arrival_datetime=datetime(2025, 3, 2, 18, 0),
        total_time_minutes=32 * 60,
        num_stops=1,
        cash_cost=1500,
    )
```

**Test:** Run pytest, verify all pass.

---

### Step 10: Add Integration Test

**Files to modify:** `backend/tests/test_optimization_v3.py`

**What I'll do:**

```python
class TestEndToEnd:
    """End-to-end integration tests."""
    
    def test_oop_uses_awards_when_cheaper(self):
        """OOP should use awards that save cash."""
        spec = make_sample_spec()
        flights = [
            make_flight(cash=1500, award_miles=50000, surcharge=100),  # Award saves $1400
        ]
        hotels = [make_hotel(cash=200)]
        transfers = make_sample_transfers()
        
        solver = OptimizationSolverV3(mode=OptimizationMode.OOP)
        result = solver.solve(spec, flights, hotels, transfers)
        
        assert result.status == OptimizationStatus.OPTIMAL
        # Should use award (100 surcharge < 1500 cash)
        assert result.solution.total_points > 0
    
    def test_cpp_rejects_low_value_awards(self):
        """CPP should reject awards below threshold."""
        spec = make_sample_spec()
        # Award at 0.5 cpp (threshold is typically 1.5)
        flights = [
            make_flight(cash=1000, award_miles=100000, surcharge=500),  # 0.5 cpp
        ]
        hotels = [make_hotel(cash=200)]
        transfers = make_sample_transfers()
        
        solver = OptimizationSolverV3(mode=OptimizationMode.CPP)
        result = solver.solve(spec, flights, hotels, transfers)
        
        assert result.status == OptimizationStatus.OPTIMAL
        # Should pay cash rather than burn points at 0.5 cpp
        assert result.solution.total_points == 0
    
    def test_group_room_allocation(self):
        """Group of 4 should allocate rooms correctly."""
        spec = make_group_spec(num_travelers=4)
        flights = [make_flight()]
        hotels = [make_hotel(room_capacity=2)]  # 2-person rooms
        transfers = make_sample_transfers()
        
        solver = OptimizationSolverV3(mode=OptimizationMode.BALANCED)
        result = solver.solve(spec, flights, hotels, transfers)
        
        assert result.status == OptimizationStatus.OPTIMAL
        # Should book 2 rooms (not 4)
        assert result.solution.total_rooms == 2
    
    def test_interline_connection_warning(self):
        """Interline connections should produce warning."""
        spec = make_sample_spec()
        flights = [make_two_segment_flight("UA", "AA")]  # Different alliances
        hotels = [make_hotel()]
        transfers = make_sample_transfers()
        
        solver = OptimizationSolverV3(mode=OptimizationMode.OOP)
        result = solver.solve(spec, flights, hotels, transfers)
        
        assert any("interline" in w.lower() for w in result.warnings)
```

**Test:** Run pytest, verify integration tests pass.

---

## Summary: V2 Plan Changes

| Issue | V1 | V2 |
|-------|----|----|
| State graph first | Models first | **Step 0: TripPlanSpec** |
| Stay segment source | Derived from flights | **INPUT from user** |
| Group travel | Room allocation only | **Payer layer + balance constraints** |
| Hotel cost | `total_cash_cost` constant | **From room vars × nights** |
| Pruning | Top K by cash | **Multi-criteria union** |
| Determinism | threads=4 | **threads=1 for tests** |
| Infeasibility | Re-solve cascade | **Heuristic pre-check** |
| Global next-best | model.copy() | **Deferred (rebuild approach)** |
| Connecting flights | Not checked | **Alliance/codeshare validation** |
| MVP scope | Everything | **Locked scope list** |

---

Ready to start with **Step 0: TripPlanSpec**?
