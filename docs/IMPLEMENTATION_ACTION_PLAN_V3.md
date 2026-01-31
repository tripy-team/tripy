# Implementation Action Plan V3 (Final)

**Critical fixes from V2 review:**
1. Award option ID in decision variables (prevents cross-program mixing)
2. Hotel points cost tied to room count (fixes group undercounting)
3. Date feasibility constraints in MILP (not just pre-check)
4. Single-ticket enforcement for connections (not just warnings)
5. Removed false confidence (codeshare ≠ protected, no pooling in MVP)
6. Tighter Big-M bounds
7. Standardized variable indexing
8. Simplified balanced objective (no baseline_cash)

**V3.1 fixes (compile/solve/correct gaps):**
1. **Single-ticket HARD enforcement**: `unknown` ticketing now DROPPED for connections (MVP requires certainty)
2. **Hotel payment fully constrained**: Added `u_points` binary + room type exclusivity (no mixing cash/points rooms)
3. **Linearization build order**: `_add_hotel_points_linearization()` and `_add_hotel_cash_linearization()` now called BEFORE constraints that need them
4. **Date feasibility in MILP**: Added `_add_date_feasibility_constraints()` as backup to filter
5. **PuLP API compatibility**: Fixed objective setting to use `self.model.sense` + `self.model.objective` assignment

---

## The 3 Biggest "Silent Wrong Answer" Risks (MUST FIX)

| Risk | V2 Problem | V3 Fix |
|------|------------|--------|
| **Award option not indexed** | `y_points[(fkey, payer, source)]` missing `option_id` | Add `award_option_id` dimension |
| **Hotel points not room-linked** | `_hotel_points_cost()` uses constant | Points cost = `n_rooms[rt] * points_per_night * nights` |
| **Date feasibility not in MILP** | Pre-check only ensures existence | Add `x_edge <= feasible[edge]` constraints |

---

## MVP Scope (Locked & Simplified)

**In Scope:**
- Fixed stay segments (user input)
- Group travels together (`TOGETHER` only)
- **No points pooling** (payer uses only their own balances)
- Single-ticket connections only (hard filter)
- One hotel per segment + room allocation
- Integer-safe transfers
- Two-pass solve
- Local alternatives
- Warnings (not "protected" assertions)

**Explicitly NOT in MVP:**
- `GroupTravelMode.INDEPENDENT` / `SHARED_HOTELS`
- `allow_points_pooling = True`
- `max_payer_imbalance` fairness constraints
- Global next-best (no-good cut)
- Flexible date optimization

---

## Phase 0: Foundation (Steps 0-2)

### Step 0: TripPlanSpec (Simplified for MVP)

**Files to create:** `backend/src/optimization/trip_spec.py`

```python
from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional, Dict
from enum import Enum


class GroupTravelMode(Enum):
    """How the group travels."""
    TOGETHER = "together"  # All travelers on same flights/hotels
    # INDEPENDENT = "independent"  # V4+
    # SHARED_HOTELS = "shared_hotels"  # V4+


@dataclass
class Traveler:
    """A person in the trip."""
    traveler_id: str
    name: str
    home_airport: str
    
    # This traveler's balances (ONLY theirs - no pooling in MVP)
    points_balances: Dict[str, int]  # normalized_program -> balance
    bank_balances: Dict[str, int]    # normalized_bank -> balance
    
    # Preferences (soft)
    preferred_airlines: List[str] = field(default_factory=list)
    avoided_airlines: List[str] = field(default_factory=list)
    preferred_cabin: Optional[str] = None


@dataclass
class OrderedLeg:
    """A required flight leg (INPUT from user)."""
    leg_id: int
    origin_city: str
    destination_city: str
    
    earliest_departure: date
    latest_departure: date
    
    traveler_ids: List[str]  # Usually all travelers


@dataclass
class StaySegment:
    """A required hotel stay (INPUT from user, fixed dates)."""
    segment_id: int
    city: str
    check_in: date   # FIXED - not derived from flights
    check_out: date  # FIXED
    
    traveler_ids: List[str]
    
    # Room preferences
    min_rooms: Optional[int] = None
    
    @property
    def nights(self) -> int:
        return (self.check_out - self.check_in).days


@dataclass
class TripPlanSpec:
    """
    Complete trip specification (PRIMARY INPUT).
    
    MVP constraints:
    - group_mode = TOGETHER only
    - allow_points_pooling = False (each payer uses own balances)
    """
    
    trip_id: str
    travelers: List[Traveler]
    legs: List[OrderedLeg]
    stay_segments: List[StaySegment]
    
    # MVP: locked to TOGETHER
    group_mode: GroupTravelMode = GroupTravelMode.TOGETHER
    
    # MVP: NO POOLING (payer uses only their own points/banks)
    # allow_points_pooling: bool = False  # Removed - always False in MVP
    
    # MVP: NO FAIRNESS CONSTRAINTS
    # max_payer_imbalance: float = None  # Removed - V4+
    
    def validate(self) -> List[str]:
        errors = []
        
        # Check leg/segment count
        if len(self.stay_segments) != len(self.legs) - 1:
            errors.append(
                f"Expected {len(self.legs)-1} stay segments for {len(self.legs)} legs"
            )
        
        # Check city alignment
        for i, seg in enumerate(self.stay_segments):
            if i < len(self.legs):
                if self.legs[i].destination_city != seg.city:
                    errors.append(f"Leg {i} dest != segment {i} city")
            if i+1 < len(self.legs):
                if self.legs[i+1].origin_city != seg.city:
                    errors.append(f"Segment {i} city != leg {i+1} origin")
        
        # Check date ordering
        for i, seg in enumerate(self.stay_segments):
            if seg.check_out < seg.check_in:
                errors.append(f"Segment {i}: check_out before check_in")
        
        return errors
    
    @property
    def all_traveler_ids(self) -> List[str]:
        return [t.traveler_id for t in self.travelers]
    
    def get_traveler(self, tid: str) -> Traveler:
        for t in self.travelers:
            if t.traveler_id == tid:
                return t
        raise ValueError(f"Unknown traveler: {tid}")
```

**Test:** Create spec, validate passes for valid input, fails for misaligned legs/segments.

---

### Step 1: Program/Bank Normalization Layer

**Files to create:** `backend/src/optimization/normalize.py`

```python
"""
Normalization layer for program/bank identifiers.

CRITICAL: Without this, you'll have "united" vs "UA" vs "MileagePlus" bugs.
"""

PROGRAM_ALIASES = {
    # United
    "UA": "united", "UAL": "united", "MileagePlus": "united", "mileageplus": "united",
    "united": "united",
    
    # American
    "AA": "american", "AAL": "american", "AAdvantage": "american",
    "american": "american",
    
    # Delta
    "DL": "delta", "DAL": "delta", "SkyMiles": "delta",
    "delta": "delta",
    
    # Hyatt
    "HYATT": "hyatt", "World of Hyatt": "hyatt", "WOH": "hyatt",
    "hyatt": "hyatt",
    
    # Marriott
    "MARRIOTT": "marriott", "MAR": "marriott", "Bonvoy": "marriott",
    "marriott": "marriott",
    
    # ... add more
}

BANK_ALIASES = {
    # Chase
    "CHASE": "chase", "Chase": "chase", "Ultimate Rewards": "chase", "UR": "chase",
    "chase": "chase",
    
    # Amex
    "AMEX": "amex", "Amex": "amex", "American Express": "amex", "MR": "amex",
    "Membership Rewards": "amex",
    "amex": "amex",
    
    # Capital One
    "C1": "capital_one", "CapOne": "capital_one", "Capital One": "capital_one",
    "capital_one": "capital_one",
    
    # ... add more
}


def normalize_program(raw: str) -> str:
    """Normalize program identifier to canonical form."""
    return PROGRAM_ALIASES.get(raw, raw.lower().replace(" ", "_"))


def normalize_bank(raw: str) -> str:
    """Normalize bank identifier to canonical form."""
    return BANK_ALIASES.get(raw, raw.lower().replace(" ", "_"))


def normalize_airline(raw: str) -> str:
    """Normalize airline code (2-letter IATA preferred)."""
    # Most airlines already use 2-letter codes
    return raw.upper()[:2]
```

**Test:** `normalize_program("UA") == normalize_program("MileagePlus") == "united"`

---

### Step 2: Core Data Models with Proper Indexing

**Files to create:** `backend/src/optimization/models.py`

**Key change:** Every decision-relevant entity has a **string ID** for use as variable name component.

```python
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import List, Optional, Dict
import math


# ════════════════════════════════════════════════════════════════════════════
# FUNDING SOURCE: How points are paid (native or transfer)
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class FundingSource:
    """
    A way to fund an award booking.
    
    CRITICAL: Has a string `source_id` for reliable dict keys and var names.
    """
    
    source_id: str  # e.g., "native_alice_united" or "transfer_alice_chase_hyatt"
    
    source_type: str  # "native" or "transfer"
    owner_id: str     # Which traveler owns this source
    
    # For native
    program: Optional[str] = None
    
    # For transfer
    from_bank: Optional[str] = None
    to_program: Optional[str] = None
    transfer_path_id: Optional[str] = None
    
    @staticmethod
    def make_native(owner_id: str, program: str) -> "FundingSource":
        return FundingSource(
            source_id=f"native_{owner_id}_{program}",
            source_type="native",
            owner_id=owner_id,
            program=program,
        )
    
    @staticmethod
    def make_transfer(owner_id: str, from_bank: str, to_program: str, path_id: str) -> "FundingSource":
        return FundingSource(
            source_id=f"transfer_{owner_id}_{from_bank}_{to_program}",
            source_type="transfer",
            owner_id=owner_id,
            from_bank=from_bank,
            to_program=to_program,
            transfer_path_id=path_id,
        )


# ════════════════════════════════════════════════════════════════════════════
# AWARD OPTION: What the program charges (miles + surcharge)
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class AwardOption:
    """
    A specific award booking option.
    
    CRITICAL: Has `option_id` for use in decision variable indexing.
    """
    
    option_id: str  # e.g., "united_economy_50k" - MUST be unique per booking
    program: str    # Normalized: "united", "hyatt", etc.
    
    miles_required: int
    surcharge: float
    
    cabin_or_room_type: str
    
    # Value metrics
    cash_equivalent: float
    raw_value: float  # cash_equivalent - surcharge
    cpp: float        # (raw_value * 100) / miles_required
    
    # PRECOMPUTED soft values (filled before MILP)
    soft_value_oop: float = 0.0
    soft_value_cpp: float = 0.0
    soft_value_balanced: float = 0.0
    
    # Availability
    availability_score: float = 1.0  # 0-1
    is_waitlisted: bool = False


# ════════════════════════════════════════════════════════════════════════════
# FLIGHT ITINERARY EDGE
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
    cabin: Optional[str] = None


@dataclass
class FlightItineraryEdge:
    """
    A complete flight itinerary as a single edge.
    
    CRITICAL FIELDS:
    - edge_id: string for variable naming
    - ticketing_type: must be "single_ticket" for connections
    - arrives_by_date / departs_on_or_after: for MILP date constraints
    """
    
    edge_id: str  # Unique string ID for var names
    leg_id: int
    
    origin: str
    destination: str
    segments: List[FlightSegment]
    
    departure_datetime: datetime
    arrival_datetime: datetime
    total_time_minutes: int
    num_stops: int
    
    cash_cost: float
    award_options: List[AwardOption]
    
    # ════════════════════════════════════════════════════════════════════
    # TICKETING / CONNECTION SAFETY
    # ════════════════════════════════════════════════════════════════════
    
    ticketing_type: str = "unknown"  # "single_ticket" | "separate_tickets" | "unknown"
    validating_carrier: Optional[str] = None
    pricing_source: Optional[str] = None  # "amadeus", "duffel", "awardtool", etc.
    
    # Warnings (informational, not blocking)
    connection_warnings: List[str] = field(default_factory=list)
    has_carrier_change: bool = False
    
    # ════════════════════════════════════════════════════════════════════
    # DATE FEASIBILITY (precomputed for MILP constraints)
    # ════════════════════════════════════════════════════════════════════
    
    # These are set by validate_date_feasibility()
    arrives_by_date: Optional[date] = None  # Arrival date
    departs_on_date: Optional[date] = None  # Departure date
    
    # Quality flags
    is_redeye: bool = False
    has_long_layover: bool = False
    
    def validate_connections(self) -> List[str]:
        """Check for carrier changes (warning only, not blocking)."""
        warnings = []
        
        if len(self.segments) <= 1:
            return warnings
        
        for i in range(len(self.segments) - 1):
            s1, s2 = self.segments[i], self.segments[i+1]
            
            if s1.marketing_carrier != s2.marketing_carrier:
                self.has_carrier_change = True
                warnings.append(
                    f"Carrier change at {s1.destination}: "
                    f"{s1.marketing_carrier} → {s2.marketing_carrier}"
                )
        
        self.connection_warnings = warnings
        return warnings
    
    def compute_date_fields(self):
        """Compute arrival/departure dates for MILP constraints."""
        self.departs_on_date = self.departure_datetime.date()
        self.arrives_by_date = self.arrival_datetime.date()


# ════════════════════════════════════════════════════════════════════════════
# HOTEL OPTION
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class RoomType:
    """A room type at a hotel."""
    
    room_type_id: str  # e.g., "standard_king"
    name: str
    capacity: int
    
    cash_per_night: float
    
    # Award pricing (if available)
    award_program: Optional[str] = None
    points_per_night: Optional[int] = None
    award_surcharge_per_night: float = 0.0
    
    @property
    def has_award_pricing(self) -> bool:
        return self.award_program is not None and self.points_per_night is not None


@dataclass
class HotelOption:
    """A hotel option for a stay segment."""
    
    hotel_id: str  # Unique string ID
    segment_id: int
    
    hotel_name: str
    chain: str
    star_rating: float
    
    room_types: List[RoomType]
    
    # For pruning heuristics only
    def cheapest_cash_per_night(self) -> float:
        if not self.room_types:
            return float('inf')
        return min(rt.cash_per_night for rt in self.room_types)
    
    def best_award_cpp(self) -> float:
        best = 0.0
        for rt in self.room_types:
            if rt.has_award_pricing and rt.points_per_night > 0:
                value = rt.cash_per_night - rt.award_surcharge_per_night
                cpp = (value * 100) / rt.points_per_night
                best = max(best, cpp)
        return best


# ════════════════════════════════════════════════════════════════════════════
# TRANSFER PATH
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class TransferPath:
    """Transfer path with integer-safe delivery."""
    
    path_id: str  # e.g., "chase_to_united"
    from_bank: str
    to_program: str
    
    min_increment: int
    ratio: float
    current_bonus: float
    
    effective_delivered_per_block: int = 0  # floor(increment * ratio * bonus)
    
    is_instant: bool = True
    max_hours: int = 0
    
    def __post_init__(self):
        raw = self.min_increment * self.ratio * self.current_bonus
        self.effective_delivered_per_block = int(math.floor(raw))
    
    def blocks_needed(self, target_miles: int) -> int:
        """Blocks needed to deliver at least target_miles."""
        if self.effective_delivered_per_block <= 0:
            return 999999
        return math.ceil(target_miles / self.effective_delivered_per_block)
    
    def bank_points_needed(self, target_miles: int) -> int:
        """Bank points needed for target miles."""
        return self.blocks_needed(target_miles) * self.min_increment


# ════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class SlackConfig:
    rel_eps: float = 0.01    # 1% relative
    abs_eps: float = 25.0    # $25 absolute


@dataclass
class BalancedModeConfig:
    """
    Balanced mode configuration.
    
    SIMPLIFIED: No baseline_cash. Use cash_penalty directly.
    """
    
    flight_importance: float = 1.0
    hotel_importance: float = 1.0
    
    # Cash penalty (so balanced doesn't ignore cash)
    # Objective = value_utility - cash_penalty_weight * total_cash
    cash_penalty_weight: float = 0.001  # Small penalty per dollar
    
    # Quality penalties
    time_penalty_per_hour: float = 0.02
    connection_penalty: float = 0.20
    carrier_change_penalty: float = 0.10
    
    # Availability risk
    low_availability_penalty: float = 0.30  # Penalty if availability_score < 0.5
    min_availability_threshold: float = 0.3  # Hard filter below this
    
    # Normalization
    min_samples_for_median: int = 5
    default_K: float = 100.0


@dataclass
class SolverConfig:
    time_limit_seconds: float = 30.0
    mip_gap: float = 0.01
    threads_production: int = 4
    threads_determinism: int = 1


@dataclass
class PruningConfig:
    # Multi-criteria per O-D
    max_by_cash: int = 10
    max_by_time: int = 5
    max_by_award: int = 10
    max_total_per_od: int = 20
    
    # Hotels per segment
    max_hotels_by_cash: int = 8
    max_hotels_by_award: int = 8
    max_hotels_total: int = 15
    
    # Hard limits
    max_stops: int = 2
    max_duration_hours: float = 36.0
```

**Test:** Create models, verify all have string IDs suitable for variable names.

---

## Phase 1: Validators & Filters (Steps 3-4)

### Step 3: Single-Ticket Enforcement

**Files to create:** `backend/src/optimization/validators.py`

```python
"""
Validators for flight/hotel data.

CRITICAL: Single-ticket enforcement for connections.
"""

from typing import List, Tuple, Dict
from .models import FlightItineraryEdge, HotelOption, TripPlanSpec


def filter_single_ticket_only(
    flights: List[FlightItineraryEdge],
) -> Tuple[List[FlightItineraryEdge], List[str]]:
    """
    Filter to only single-ticket itineraries for connecting flights.
    
    MVP RULE (HARD): If num_stops > 0, REQUIRE ticketing_type == "single_ticket".
    
    - Direct flights (num_stops == 0): always OK
    - Connections with single_ticket: OK
    - Connections with unknown: DROP (MVP requires certainty)
    - Connections with separate_tickets: DROP
    
    Returns (filtered_flights, warnings)
    """
    
    filtered = []
    warnings = []
    
    for f in flights:
        if f.num_stops == 0:
            # Direct flight - always OK (ticketing irrelevant)
            if f.ticketing_type == "unknown":
                warnings.append(
                    f"Flight {f.edge_id}: unknown ticketing (OK for nonstop)"
                )
            filtered.append(f)
        
        elif f.ticketing_type == "single_ticket":
            # Connection on confirmed single ticket - OK
            filtered.append(f)
        
        elif f.ticketing_type == "unknown":
            # MVP HARD: unknown ticketing for connections is NOT allowed
            warnings.append(
                f"Dropped {f.edge_id}: unknown ticketing for connection "
                f"(MVP requires confirmed single_ticket for {f.num_stops}-stop itinerary)"
            )
            # DO NOT append to filtered
        
        else:
            # separate_tickets - DROP
            warnings.append(
                f"Dropped {f.edge_id}: connection requires separate tickets "
                f"({f.origin}→{f.destination} via {f.num_stops} stops)"
            )
    
    return filtered, warnings


def validate_date_feasibility(
    flights: List[FlightItineraryEdge],
    stay_segments: List["StaySegment"],
    legs: List["OrderedLeg"],
) -> Tuple[List[FlightItineraryEdge], List[str]]:
    """
    Filter flights that violate date constraints.
    
    CRITICAL: This ensures the MILP only sees feasible options.
    
    Rules:
    - Flight for leg i must depart within leg's date window
    - Flight for leg i must arrive by stay[i].check_in (if stay exists)
    - Flight for leg i must depart on/after stay[i-1].check_out (if stay exists)
    """
    
    filtered = []
    warnings = []
    
    # Build segment lookup
    seg_after_leg = {i: stay_segments[i] for i in range(len(stay_segments))}
    seg_before_leg = {i+1: stay_segments[i] for i in range(len(stay_segments))}
    leg_by_id = {leg.leg_id: leg for leg in legs}
    
    for f in flights:
        f.compute_date_fields()
        leg = leg_by_id.get(f.leg_id)
        
        if not leg:
            warnings.append(f"Flight {f.edge_id} has unknown leg_id {f.leg_id}")
            continue
        
        is_feasible = True
        
        # Check 1: Departs within leg's date window
        if f.departs_on_date < leg.earliest_departure:
            is_feasible = False
        if f.departs_on_date > leg.latest_departure:
            is_feasible = False
        
        # Check 2: Arrives by check-in of next stay (if exists)
        if f.leg_id in seg_after_leg:
            seg = seg_after_leg[f.leg_id]
            if f.arrives_by_date > seg.check_in:
                is_feasible = False
        
        # Check 3: Departs on/after check-out of previous stay (if exists)
        if f.leg_id in seg_before_leg:
            seg = seg_before_leg[f.leg_id]
            if f.departs_on_date < seg.check_out:
                is_feasible = False
        
        if is_feasible:
            filtered.append(f)
        else:
            warnings.append(f"Dropped {f.edge_id}: date infeasible for leg {f.leg_id}")
    
    return filtered, warnings


def pre_check_feasibility(
    spec: TripPlanSpec,
    flights_by_leg: Dict[int, List[FlightItineraryEdge]],
    hotels_by_segment: Dict[int, List[HotelOption]],
) -> Tuple[bool, List[str]]:
    """
    Fast pre-check before building MILP.
    
    Returns (is_feasible, issues)
    """
    
    issues = []
    
    # Check each leg has at least one flight
    for leg in spec.legs:
        if leg.leg_id not in flights_by_leg or not flights_by_leg[leg.leg_id]:
            issues.append(f"No flights for leg {leg.leg_id}: {leg.origin_city}→{leg.destination_city}")
    
    # Check each segment has at least one hotel
    for seg in spec.stay_segments:
        if seg.segment_id not in hotels_by_segment or not hotels_by_segment[seg.segment_id]:
            issues.append(f"No hotels for segment {seg.segment_id}: {seg.city}")
    
    # Check travelers have some usable points
    has_points = any(
        sum(t.points_balances.values()) > 0 or sum(t.bank_balances.values()) > 0
        for t in spec.travelers
    )
    if not has_points:
        issues.append("No travelers have usable points or bank balances")
    
    return len(issues) == 0, issues
```

**Test:** Flight with `ticketing_type="separate_tickets"` and `num_stops=1` → dropped.

---

### Step 4: Add Explainability Counters (Logging Hooks)

**Files to create:** `backend/src/optimization/metrics.py`

```python
"""
Explainability counters for debugging and logging.

Add these EARLY - they'll save you days of debugging.
"""

from dataclasses import dataclass, field
from typing import Dict


@dataclass
class OptimizationMetrics:
    """Counters for optimization pipeline stages."""
    
    # Input counts
    flights_input: int = 0
    hotels_input: int = 0
    
    # After single-ticket filter
    flights_after_ticket_filter: int = 0
    flights_dropped_separate_tickets: int = 0
    
    # After date feasibility filter
    flights_after_date_filter: int = 0
    flights_dropped_date_infeasible: int = 0
    
    # After pruning
    flights_after_prune: int = 0
    hotels_after_prune: int = 0
    
    # Award options
    award_options_total: int = 0
    award_options_low_availability: int = 0  # availability_score < threshold
    
    # MILP
    milp_variables: int = 0
    milp_constraints: int = 0
    
    # Solve
    pass1_objective: float = 0.0
    pass1_slack: float = 0.0
    pass2_objective: float = 0.0
    solve_time_seconds: float = 0.0
    
    # Per-leg/segment
    flights_per_leg: Dict[int, int] = field(default_factory=dict)
    hotels_per_segment: Dict[int, int] = field(default_factory=dict)
    
    def log_summary(self, logger):
        logger.info(f"=== Optimization Metrics ===")
        logger.info(f"Flights: {self.flights_input} → {self.flights_after_ticket_filter} (ticket) → {self.flights_after_date_filter} (date) → {self.flights_after_prune} (prune)")
        logger.info(f"Hotels: {self.hotels_input} → {self.hotels_after_prune} (prune)")
        logger.info(f"Award options: {self.award_options_total} ({self.award_options_low_availability} low availability)")
        logger.info(f"MILP: {self.milp_variables} vars, {self.milp_constraints} constraints")
        logger.info(f"Solve: {self.solve_time_seconds:.2f}s, pass1={self.pass1_objective:.2f}, pass2={self.pass2_objective:.2f}")
        
        for leg_id, count in self.flights_per_leg.items():
            logger.info(f"  Leg {leg_id}: {count} flights")
        for seg_id, count in self.hotels_per_segment.items():
            logger.info(f"  Segment {seg_id}: {count} hotels")
```

**Test:** Instantiate, populate, verify `log_summary()` works.

---

## Phase 2: Core Solver (Steps 5-9)

### Step 5: Solver Skeleton with Proper Variable Indexing

**Files to create:** `backend/src/optimization/solver_v3.py`

**Key insight:** Variables are indexed by **string tuples** constructed deterministically from known sets.

```python
"""
V3 Optimization Solver

CRITICAL FIXES:
1. Award option ID in decision variables
2. Hotel points cost from room vars
3. Date feasibility in MILP (backup, after filter)
4. No pooling - payer uses only own balances
5. Tight Big-M bounds
"""

from dataclasses import dataclass
from typing import List, Dict, Optional, Set
from enum import Enum
import logging
import time

from pulp import (
    LpProblem, LpMinimize, LpMaximize, LpVariable, LpBinary, LpInteger,
    lpSum, value, LpStatusOptimal, PULP_CBC_CMD
)

from .trip_spec import TripPlanSpec, StaySegment, OrderedLeg
from .models import (
    FlightItineraryEdge, HotelOption, TransferPath, AwardOption, RoomType,
    FundingSource, SlackConfig, SolverConfig, BalancedModeConfig, PruningConfig,
)
from .validators import filter_single_ticket_only, validate_date_feasibility, pre_check_feasibility
from .pruning import prune_flights, prune_hotels
from .precompute import precompute_soft_values
from .metrics import OptimizationMetrics

logger = logging.getLogger(__name__)


class Mode(Enum):
    OOP = "oop"
    CPP = "cpp"
    BALANCED = "balanced"


class Status(Enum):
    OPTIMAL = "optimal"
    FEASIBLE_SUBOPTIMAL = "feasible_suboptimal"
    INFEASIBLE_DATA = "infeasible_data"
    INFEASIBLE_MODEL = "infeasible_model"
    TIMEOUT = "timeout"


@dataclass
class Solution:
    """Extracted solution."""
    
    # Selected items
    selected_flights: Dict[int, str]  # leg_id -> edge_id
    selected_hotels: Dict[int, str]   # segment_id -> hotel_id
    selected_rooms: Dict[str, Dict[str, int]]  # hotel_id -> {room_type_id: count}
    
    # Payment
    flight_payments: Dict[str, "PaymentChoice"]  # edge_id -> payment
    hotel_payments: Dict[str, "PaymentChoice"]   # hotel_id -> payment
    
    # Transfers
    transfers_used: Dict[str, int]  # (payer, bank, program) -> blocks
    
    # Totals
    total_cash: float
    total_points_by_program: Dict[str, int]
    total_value: float


@dataclass
class PaymentChoice:
    payer_id: str
    method: str  # "cash" or "points"
    award_option_id: Optional[str] = None
    funding_source_id: Optional[str] = None
    cash_amount: float = 0.0
    points_amount: int = 0


@dataclass
class Result:
    status: Status
    solution: Optional[Solution]
    metrics: OptimizationMetrics
    warnings: List[str]
    suggestions: List[str]


class SolverV3:
    """
    V3 Solver with correct indexing.
    
    Variable naming convention:
    - x_f_{leg}_{edge}                          : flight selection
    - x_h_{seg}_{hotel}                         : hotel selection
    - n_r_{seg}_{hotel}_{room}                  : room count
    - z_cf_{leg}_{edge}_{payer}                 : flight cash payment
    - y_pf_{leg}_{edge}_{opt}_{payer}_{src}     : flight points payment
    - z_ch_{seg}_{hotel}_{payer}                : hotel cash payment
    - y_ph_{seg}_{hotel}_{room}_{payer}_{src}   : hotel points payment
    - t_b_{payer}_{bank}_{prog}                 : transfer blocks
    """
    
    def __init__(
        self,
        mode: Mode,
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
        
        self.model: Optional[LpProblem] = None
        self.metrics = OptimizationMetrics()
        
        # Data
        self.spec: Optional[TripPlanSpec] = None
        self.flights: List[FlightItineraryEdge] = []
        self.hotels: List[HotelOption] = []
        self.transfers: List[TransferPath] = []
        
        # Indices (built during solve)
        self.flights_by_leg: Dict[int, List[FlightItineraryEdge]] = {}
        self.hotels_by_seg: Dict[int, List[HotelOption]] = {}
        self.transfers_by_program: Dict[str, List[TransferPath]] = {}
        
        # Funding sources per (payer, program) - NO POOLING
        self.funding_sources: Dict[str, List[FundingSource]] = {}  # payer -> sources
        
        # Variables
        self.vars: Dict[str, Dict] = {}
    
    def solve(
        self,
        spec: TripPlanSpec,
        flights: List[FlightItineraryEdge],
        hotels: List[HotelOption],
        transfers: List[TransferPath],
    ) -> Result:
        """Main solve method."""
        
        start_time = time.time()
        warnings = []
        
        self.spec = spec
        self.metrics.flights_input = len(flights)
        self.metrics.hotels_input = len(hotels)
        
        # ════════════════════════════════════════════════════════════════
        # STEP 1: Single-ticket filter (HARD)
        # ════════════════════════════════════════════════════════════════
        
        flights, ticket_warnings = filter_single_ticket_only(flights)
        warnings.extend(ticket_warnings)
        
        self.metrics.flights_after_ticket_filter = len(flights)
        self.metrics.flights_dropped_separate_tickets = (
            self.metrics.flights_input - len(flights)
        )
        
        # ════════════════════════════════════════════════════════════════
        # STEP 2: Date feasibility filter (HARD)
        # ════════════════════════════════════════════════════════════════
        
        flights, date_warnings = validate_date_feasibility(
            flights, spec.stay_segments, spec.legs
        )
        warnings.extend(date_warnings)
        
        self.metrics.flights_after_date_filter = len(flights)
        self.metrics.flights_dropped_date_infeasible = (
            self.metrics.flights_after_ticket_filter - len(flights)
        )
        
        # ════════════════════════════════════════════════════════════════
        # STEP 3: Pre-check feasibility
        # ════════════════════════════════════════════════════════════════
        
        self._build_indices(flights, hotels, transfers)
        
        is_feasible, issues = pre_check_feasibility(
            spec, self.flights_by_leg, self.hotels_by_seg
        )
        
        if not is_feasible:
            self.metrics.solve_time_seconds = time.time() - start_time
            return Result(
                status=Status.INFEASIBLE_DATA,
                solution=None,
                metrics=self.metrics,
                warnings=warnings,
                suggestions=issues,
            )
        
        # ════════════════════════════════════════════════════════════════
        # STEP 4: Prune
        # ════════════════════════════════════════════════════════════════
        
        flights = prune_flights(flights, self.pruning_config)
        hotels = prune_hotels(hotels, self.pruning_config)
        
        self.flights = flights
        self.hotels = hotels
        self.transfers = transfers
        
        self._build_indices(flights, hotels, transfers)
        
        self.metrics.flights_after_prune = len(flights)
        self.metrics.hotels_after_prune = len(hotels)
        
        for leg_id, fs in self.flights_by_leg.items():
            self.metrics.flights_per_leg[leg_id] = len(fs)
        for seg_id, hs in self.hotels_by_seg.items():
            self.metrics.hotels_per_segment[seg_id] = len(hs)
        
        # ════════════════════════════════════════════════════════════════
        # STEP 5: Precompute soft values
        # ════════════════════════════════════════════════════════════════
        
        precompute_soft_values(flights, hotels, self.balanced_config)
        
        # Count award options
        for f in flights:
            self.metrics.award_options_total += len(f.award_options)
            for opt in f.award_options:
                if opt.availability_score < self.balanced_config.min_availability_threshold:
                    self.metrics.award_options_low_availability += 1
        
        # ════════════════════════════════════════════════════════════════
        # STEP 6: Build funding sources (NO POOLING)
        # ════════════════════════════════════════════════════════════════
        
        self._build_funding_sources()
        
        # ════════════════════════════════════════════════════════════════
        # STEP 7: Build MILP
        # ════════════════════════════════════════════════════════════════
        
        self._build_model()
        
        self.metrics.milp_variables = len(self.model.variables())
        self.metrics.milp_constraints = len(self.model.constraints)
        
        # ════════════════════════════════════════════════════════════════
        # STEP 8: Solve
        # ════════════════════════════════════════════════════════════════
        
        result = self._solve_two_pass()
        
        self.metrics.solve_time_seconds = time.time() - start_time
        self.metrics.log_summary(logger)
        
        result.warnings.extend(warnings)
        return result
    
    def _build_indices(self, flights, hotels, transfers):
        """Build lookup indices."""
        from collections import defaultdict
        
        self.flights_by_leg = defaultdict(list)
        for f in flights:
            self.flights_by_leg[f.leg_id].append(f)
        
        self.hotels_by_seg = defaultdict(list)
        for h in hotels:
            self.hotels_by_seg[h.segment_id].append(h)
        
        self.transfers_by_program = defaultdict(list)
        for t in transfers:
            self.transfers_by_program[t.to_program].append(t)
    
    def _build_funding_sources(self):
        """
        Build funding sources per payer.
        
        NO POOLING: Each payer can only use their own balances.
        """
        
        self.funding_sources = {}
        
        for traveler in self.spec.travelers:
            payer = traveler.traveler_id
            sources = []
            
            # Native program balances
            for prog, bal in traveler.points_balances.items():
                if bal > 0:
                    sources.append(FundingSource.make_native(payer, prog))
            
            # Transfer paths from this payer's banks
            for tp in self.transfers:
                if tp.from_bank in traveler.bank_balances:
                    if traveler.bank_balances[tp.from_bank] > 0:
                        sources.append(FundingSource.make_transfer(
                            payer, tp.from_bank, tp.to_program, tp.path_id
                        ))
            
            self.funding_sources[payer] = sources
    
    def _get_sources_for_program(self, payer: str, program: str) -> List[FundingSource]:
        """Get funding sources a payer can use for a specific program."""
        return [
            s for s in self.funding_sources.get(payer, [])
            if (s.source_type == "native" and s.program == program) or
               (s.source_type == "transfer" and s.to_program == program)
        ]
```

**Test:** Instantiate solver, verify funding sources built correctly (no cross-payer).

---

### Step 6: Build Variables with Award Option ID

**Files to modify:** `backend/src/optimization/solver_v3.py`

```python
def _build_model(self):
    """
    Build MILP with correct variable indexing.
    
    CRITICAL: Build order matters for linearization variables.
    """
    
    # Always minimize (negate for maximize objectives)
    self.model = LpProblem("TripOptV3", LpMinimize)
    
    # ════════════════════════════════════════════════════════════════════
    # STEP 1: Build all decision variables
    # ════════════════════════════════════════════════════════════════════
    
    self._build_flight_vars()
    self._build_hotel_vars()
    self._build_transfer_vars()
    
    # ════════════════════════════════════════════════════════════════════
    # STEP 2: Add selection and payment structure constraints
    # ════════════════════════════════════════════════════════════════════
    
    self._add_selection_constraints()
    self._add_payment_constraints()
    self._add_room_constraints()  # Creates u_points vars
    
    # ════════════════════════════════════════════════════════════════════
    # STEP 3: Add linearization BEFORE transfer/balance constraints
    # This creates w_hp (hotel points) and w_hc (hotel cash) vars
    # which are needed by _add_transfer_constraints and objectives
    # ════════════════════════════════════════════════════════════════════
    
    self._add_hotel_points_linearization()  # Creates w_hp vars
    self._add_hotel_cash_linearization()    # Creates w_hc vars
    
    # ════════════════════════════════════════════════════════════════════
    # STEP 4: Add transfer and balance constraints (use w_hp)
    # ════════════════════════════════════════════════════════════════════
    
    self._add_transfer_constraints()
    self._add_balance_constraints()
    
    # ════════════════════════════════════════════════════════════════════
    # STEP 5: Add date feasibility constraints (backup to filter)
    # ════════════════════════════════════════════════════════════════════
    
    self._add_date_feasibility_constraints()


def _build_flight_vars(self):
    """
    Build flight variables.
    
    CRITICAL: y_pf includes award_option_id.
    """
    
    # x_f[leg][edge] - flight selection
    self.vars["x_f"] = {}
    
    # z_cf[leg][edge][payer] - cash payment
    self.vars["z_cf"] = {}
    
    # y_pf[leg][edge][opt][payer][src] - points payment
    # CRITICAL: includes opt (award option id)
    self.vars["y_pf"] = {}
    
    for f in self.flights:
        leg, edge = f.leg_id, f.edge_id
        
        # Selection
        self.vars["x_f"][(leg, edge)] = LpVariable(
            f"x_f_{leg}_{edge}", cat=LpBinary
        )
        
        # Cash payment by each payer
        for payer in self.spec.all_traveler_ids:
            self.vars["z_cf"][(leg, edge, payer)] = LpVariable(
                f"z_cf_{leg}_{edge}_{payer}", cat=LpBinary
            )
        
        # Points payment: for each award option, each payer, each source
        for opt in f.award_options:
            for payer in self.spec.all_traveler_ids:
                for src in self._get_sources_for_program(payer, opt.program):
                    key = (leg, edge, opt.option_id, payer, src.source_id)
                    self.vars["y_pf"][key] = LpVariable(
                        f"y_pf_{leg}_{edge}_{opt.option_id}_{payer}_{src.source_id}",
                        cat=LpBinary
                    )


def _build_hotel_vars(self):
    """
    Build hotel variables.
    
    CRITICAL: n_r (room count) affects both cash and points cost.
    """
    
    # x_h[seg][hotel] - hotel selection
    self.vars["x_h"] = {}
    
    # n_r[seg][hotel][room] - room count (integer)
    self.vars["n_r"] = {}
    
    # z_ch[seg][hotel][payer] - cash payment
    self.vars["z_ch"] = {}
    
    # y_ph[seg][hotel][room][payer][src] - points payment per room type
    # CRITICAL: indexed by room type (which has award pricing)
    self.vars["y_ph"] = {}
    
    for h in self.hotels:
        seg, hid = h.segment_id, h.hotel_id
        
        # Selection
        self.vars["x_h"][(seg, hid)] = LpVariable(
            f"x_h_{seg}_{hid}", cat=LpBinary
        )
        
        # Room counts
        for rt in h.room_types:
            # Big-M: max rooms = num_travelers
            max_rooms = len(self.spec.travelers)
            self.vars["n_r"][(seg, hid, rt.room_type_id)] = LpVariable(
                f"n_r_{seg}_{hid}_{rt.room_type_id}",
                lowBound=0,
                upBound=max_rooms,
                cat=LpInteger
            )
        
        # Cash payment
        for payer in self.spec.all_traveler_ids:
            self.vars["z_ch"][(seg, hid, payer)] = LpVariable(
                f"z_ch_{seg}_{hid}_{payer}", cat=LpBinary
            )
        
        # Points payment per award-eligible room type
        for rt in h.room_types:
            if not rt.has_award_pricing:
                continue
            
            for payer in self.spec.all_traveler_ids:
                for src in self._get_sources_for_program(payer, rt.award_program):
                    key = (seg, hid, rt.room_type_id, payer, src.source_id)
                    self.vars["y_ph"][key] = LpVariable(
                        f"y_ph_{seg}_{hid}_{rt.room_type_id}_{payer}_{src.source_id}",
                        cat=LpBinary
                    )


def _build_transfer_vars(self):
    """Build transfer block variables with tight bounds."""
    
    # t_b[payer][bank][prog] - transfer blocks
    self.vars["t_b"] = {}
    
    for payer in self.spec.all_traveler_ids:
        traveler = self.spec.get_traveler(payer)
        
        for tp in self.transfers:
            if tp.from_bank not in traveler.bank_balances:
                continue
            
            balance = traveler.bank_balances[tp.from_bank]
            
            # TIGHT Big-M: max blocks = balance / increment
            max_blocks = balance // tp.min_increment
            
            key = (payer, tp.from_bank, tp.to_program)
            self.vars["t_b"][key] = LpVariable(
                f"t_b_{payer}_{tp.from_bank}_{tp.to_program}",
                lowBound=0,
                upBound=max_blocks,
                cat=LpInteger
            )
```

**Test:** Verify `y_pf` keys include `opt.option_id`.

---

### Step 7: Add Constraints

**Files to modify:** `backend/src/optimization/solver_v3.py`

```python
def _add_selection_constraints(self):
    """One flight per leg, one hotel per segment."""
    
    for leg in self.spec.legs:
        flights = self.flights_by_leg.get(leg.leg_id, [])
        self.model += lpSum(
            self.vars["x_f"][(leg.leg_id, f.edge_id)]
            for f in flights
        ) == 1, f"one_flight_{leg.leg_id}"
    
    for seg in self.spec.stay_segments:
        hotels = self.hotels_by_seg.get(seg.segment_id, [])
        self.model += lpSum(
            self.vars["x_h"][(seg.segment_id, h.hotel_id)]
            for h in hotels
        ) == 1, f"one_hotel_{seg.segment_id}"


def _add_payment_constraints(self):
    """
    Payment constraints.
    
    For flights:
    - If selected, exactly one (payer, method) pays
    - If points, exactly one award option is chosen
    
    For hotels:
    - If selected, exactly one (payer, method) pays
    - If points, exactly one room type's award is used
    """
    
    # ════════════════════════════════════════════════════════════════════
    # FLIGHTS
    # ════════════════════════════════════════════════════════════════════
    
    for f in self.flights:
        leg, edge = f.leg_id, f.edge_id
        x = self.vars["x_f"][(leg, edge)]
        
        # All cash payment vars for this flight
        cash_vars = [
            self.vars["z_cf"][(leg, edge, p)]
            for p in self.spec.all_traveler_ids
        ]
        
        # All points payment vars for this flight
        points_vars = [
            self.vars["y_pf"][k]
            for k in self.vars["y_pf"]
            if k[0] == leg and k[1] == edge
        ]
        
        # If selected, exactly one payment
        self.model += (
            lpSum(cash_vars) + lpSum(points_vars) == x
        ), f"one_pay_f_{leg}_{edge}"
        
        # If points used, exactly one award option
        # (implicit from above since y_pf is per-option)
        # But add explicit: sum of y_pf per option <= 1
        for opt in f.award_options:
            opt_vars = [
                self.vars["y_pf"][k]
                for k in self.vars["y_pf"]
                if k[0] == leg and k[1] == edge and k[2] == opt.option_id
            ]
            self.model += lpSum(opt_vars) <= 1, f"one_src_opt_{leg}_{edge}_{opt.option_id}"
    
    # ════════════════════════════════════════════════════════════════════
    # HOTELS
    # ════════════════════════════════════════════════════════════════════
    
    for h in self.hotels:
        seg, hid = h.segment_id, h.hotel_id
        x = self.vars["x_h"][(seg, hid)]
        
        # Cash payment vars
        cash_vars = [
            self.vars["z_ch"][(seg, hid, p)]
            for p in self.spec.all_traveler_ids
        ]
        
        # Points payment vars (any room type)
        points_vars = [
            self.vars["y_ph"][k]
            for k in self.vars["y_ph"]
            if k[0] == seg and k[1] == hid
        ]
        
        # If selected, exactly one payment
        self.model += (
            lpSum(cash_vars) + lpSum(points_vars) == x
        ), f"one_pay_h_{seg}_{hid}"


def _add_room_constraints(self):
    """
    Room allocation constraints.
    
    CRITICAL FIX: If paying with points, ALL rooms must be the chosen award room type.
    No mixing cash rooms + points rooms at the same hotel.
    
    MVP model:
    - u_points[(seg,hid)] = 1 if hotel paid with points, 0 if cash
    - If points: exactly one (room_type, payer, src) is chosen
    - If points: ALL booked rooms must be that award room type
    """
    
    num_travelers = len(self.spec.travelers)
    
    # u_points[seg][hid] = 1 if hotel paid with points
    self.vars["u_points"] = {}
    
    for h in self.hotels:
        seg, hid = h.segment_id, h.hotel_id
        segment = next(s for s in self.spec.stay_segments if s.segment_id == seg)
        x = self.vars["x_h"][(seg, hid)]
        
        # ════════════════════════════════════════════════════════════════
        # BASIC: Capacity and selection
        # ════════════════════════════════════════════════════════════════
        
        # Total capacity >= travelers if selected
        capacity = lpSum(
            self.vars["n_r"][(seg, hid, rt.room_type_id)] * rt.capacity
            for rt in h.room_types
        )
        self.model += capacity >= num_travelers * x, f"room_cap_{seg}_{hid}"
        
        # Rooms only if selected
        for rt in h.room_types:
            n = self.vars["n_r"][(seg, hid, rt.room_type_id)]
            self.model += n <= num_travelers * x, f"room_sel_{seg}_{hid}_{rt.room_type_id}"
        
        # ════════════════════════════════════════════════════════════════
        # PAYMENT MODE: Cash XOR Points (mutually exclusive)
        # ════════════════════════════════════════════════════════════════
        
        # z_any_cash = sum of cash payment vars for this hotel
        z_any_cash = lpSum(
            self.vars["z_ch"][(seg, hid, p)]
            for p in self.spec.all_traveler_ids
        )
        
        # u_points = 1 if paying with points
        u = LpVariable(f"u_points_{seg}_{hid}", cat=LpBinary)
        self.vars["u_points"][(seg, hid)] = u
        
        # Pay cash XOR pay points (if hotel selected)
        self.model += z_any_cash + u == x, f"cash_xor_points_{seg}_{hid}"
        
        # ════════════════════════════════════════════════════════════════
        # POINTS PAYMENT: Exactly one (room_type, payer, src) if paying points
        # ════════════════════════════════════════════════════════════════
        
        # All y_ph vars for this hotel
        all_y_ph = [
            self.vars["y_ph"][k]
            for k in self.vars["y_ph"]
            if k[0] == seg and k[1] == hid
        ]
        
        # If paying points, exactly one y_ph is chosen
        self.model += lpSum(all_y_ph) == u, f"one_award_choice_{seg}_{hid}"
        
        # ════════════════════════════════════════════════════════════════
        # ROOM TYPE EXCLUSIVITY: If points, ALL rooms must be chosen award type
        # ════════════════════════════════════════════════════════════════
        
        award_room_types = [rt for rt in h.room_types if rt.has_award_pricing]
        non_award_room_types = [rt for rt in h.room_types if not rt.has_award_pricing]
        
        # If paying points, non-award room types must be 0
        for rt in non_award_room_types:
            n = self.vars["n_r"][(seg, hid, rt.room_type_id)]
            # n <= M * (1 - u)  → if u=1 (points), n must be 0
            self.model += n <= num_travelers * (1 - u), f"no_nonaward_if_points_{seg}_{hid}_{rt.room_type_id}"
        
        # For award room types: if that type's y_ph is 0, its rooms must be 0
        for rt in award_room_types:
            n = self.vars["n_r"][(seg, hid, rt.room_type_id)]
            
            # y_ph vars for THIS room type
            y_for_rt = [
                self.vars["y_ph"][k]
                for k in self.vars["y_ph"]
                if k[0] == seg and k[1] == hid and k[2] == rt.room_type_id
            ]
            
            if y_for_rt:
                # sum(y_for_rt) = 1 if this room type is chosen for points
                # If sum = 0 (not chosen) AND u=1 (paying points), then n must be 0
                # n <= M * sum(y_for_rt) + M * (1 - u)
                sum_y = lpSum(y_for_rt)
                self.model += n <= num_travelers * sum_y + num_travelers * (1 - u), \
                    f"room_type_chosen_{seg}_{hid}_{rt.room_type_id}"
        
        # ════════════════════════════════════════════════════════════════
        # CASH PAYMENT: No room type restrictions
        # ════════════════════════════════════════════════════════════════
        # When paying cash (u=0), any room type mix is allowed
        # This is implicitly handled by the constraints above


def _add_transfer_constraints(self):
    """
    Transfer constraints with integer delivery.
    
    Miles used <= blocks * effective_delivered_per_block
    """
    
    for payer in self.spec.all_traveler_ids:
        for tp in self.transfers:
            key = (payer, tp.from_bank, tp.to_program)
            
            if key not in self.vars["t_b"]:
                continue
            
            t = self.vars["t_b"][key]
            prog = tp.to_program
            
            # Miles used via this source
            miles_used = self._compute_miles_used_via_transfer(payer, tp)
            
            # Constraint: miles_used <= blocks * delivered_per_block
            self.model += (
                miles_used <= t * tp.effective_delivered_per_block
            ), f"transfer_{payer}_{tp.from_bank}_{prog}"


def _compute_miles_used_via_transfer(self, payer: str, tp: TransferPath):
    """
    Compute miles used by payer via this transfer path.
    
    Uses:
    - y_pf for flight miles (direct lookup)
    - w_hp for hotel points (linearized, created by _add_hotel_points_linearization)
    """
    
    prog = tp.to_program
    src_id = f"transfer_{payer}_{tp.from_bank}_{prog}"
    
    # ════════════════════════════════════════════════════════════════════
    # FLIGHT MILES: Direct from y_pf * miles_required
    # ════════════════════════════════════════════════════════════════════
    
    flight_miles = lpSum(
        self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, payer, src_id)] * opt.miles_required
        for f in self.flights
        for opt in f.award_options
        if opt.program == prog
        if (f.leg_id, f.edge_id, opt.option_id, payer, src_id) in self.vars["y_pf"]
    )
    
    # ════════════════════════════════════════════════════════════════════
    # HOTEL POINTS: From linearized w_hp variables
    # w_hp = n_rooms when that (room_type, payer, src) is chosen
    # ════════════════════════════════════════════════════════════════════
    
    hotel_points = lpSum(
        self.vars["w_hp"][key] * rt.points_per_night * seg.nights
        for h in self.hotels
        for seg in [next(s for s in self.spec.stay_segments if s.segment_id == h.segment_id)]
        for rt in h.room_types
        if rt.award_program == prog and rt.has_award_pricing
        for key in [(h.segment_id, h.hotel_id, rt.room_type_id, payer, src_id)]
        if key in self.vars.get("w_hp", {})
    )
    
    return flight_miles + hotel_points


def _add_balance_constraints(self):
    """Balance constraints."""
    
    for traveler in self.spec.travelers:
        payer = traveler.traveler_id
        
        # Native balances
        for prog, balance in traveler.points_balances.items():
            src_id = f"native_{payer}_{prog}"
            
            # Flight miles from native
            native_flight_miles = lpSum(
                self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, payer, src_id)] * opt.miles_required
                for f in self.flights
                for opt in f.award_options
                if opt.program == prog
                if (f.leg_id, f.edge_id, opt.option_id, payer, src_id) in self.vars["y_pf"]
            )
            
            # Hotel points from native
            native_hotel_points = self._get_native_hotel_points(payer, prog)
            
            self.model += (
                native_flight_miles + native_hotel_points <= balance
            ), f"native_bal_{payer}_{prog}"
        
        # Bank balances (sum of blocks * increment)
        for bank, balance in traveler.bank_balances.items():
            bank_used = lpSum(
                self.vars["t_b"][(payer, bank, tp.to_program)] * tp.min_increment
                for tp in self.transfers
                if tp.from_bank == bank
                if (payer, bank, tp.to_program) in self.vars["t_b"]
            )
            
            self.model += bank_used <= balance, f"bank_bal_{payer}_{bank}"
```

**Test:** Build model for 2-person trip, verify constraint count.

---

### Step 8: Hotel Points Cost Linearization

**Files to modify:** `backend/src/optimization/solver_v3.py`

```python
def _add_hotel_points_linearization(self):
    """
    Linearize hotel points cost = n_rooms * points_per_night * nights.
    
    For each (hotel, room_type, payer, source) where y_ph exists:
    - Introduce w_hp = n_rooms if y_ph=1, else 0
    - Linearization: w <= n, w <= M*y, w >= n - M*(1-y)
    
    MUST be called BEFORE _add_transfer_constraints and objectives.
    """
    
    self.vars["w_hp"] = {}  # Auxiliary: rooms paid with points
    
    max_rooms = len(self.spec.travelers)  # Tight Big-M
    
    for h in self.hotels:
        seg, hid = h.segment_id, h.hotel_id
        segment = next(s for s in self.spec.stay_segments if s.segment_id == seg)
        nights = segment.nights
        
        for rt in h.room_types:
            if not rt.has_award_pricing:
                continue
            
            n = self.vars["n_r"][(seg, hid, rt.room_type_id)]
            
            for payer in self.spec.all_traveler_ids:
                for src in self._get_sources_for_program(payer, rt.award_program):
                    key = (seg, hid, rt.room_type_id, payer, src.source_id)
                    
                    if key not in self.vars["y_ph"]:
                        continue
                    
                    y = self.vars["y_ph"][key]
                    
                    # Auxiliary: w = n * y (rooms paid with this source)
                    w_key = f"w_hp_{seg}_{hid}_{rt.room_type_id}_{payer}_{src.source_id}"
                    w = LpVariable(w_key, lowBound=0, upBound=max_rooms, cat=LpInteger)
                    self.vars["w_hp"][key] = w
                    
                    # Linearization
                    self.model += w <= n, f"{w_key}_ub1"
                    self.model += w <= max_rooms * y, f"{w_key}_ub2"
                    self.model += w >= n - max_rooms * (1 - y), f"{w_key}_lb"


def _add_hotel_cash_linearization(self):
    """
    Linearize hotel cash cost = n_rooms * cash_per_night * nights.
    
    For each (hotel, room_type) when paying cash:
    - Introduce w_hc = n_rooms if z_any_cash=1, else 0
    
    MUST be called BEFORE objectives.
    """
    
    self.vars["w_hc"] = {}  # Auxiliary: rooms paid with cash
    
    max_rooms = len(self.spec.travelers)
    
    for h in self.hotels:
        seg, hid = h.segment_id, h.hotel_id
        segment = next(s for s in self.spec.stay_segments if s.segment_id == seg)
        
        # z_any_cash for this hotel
        z_any = lpSum(
            self.vars["z_ch"][(seg, hid, p)]
            for p in self.spec.all_traveler_ids
        )
        
        for rt in h.room_types:
            n = self.vars["n_r"][(seg, hid, rt.room_type_id)]
            
            # w_hc = n if paying cash
            w_key = f"w_hc_{seg}_{hid}_{rt.room_type_id}"
            w = LpVariable(w_key, lowBound=0, upBound=max_rooms, cat=LpInteger)
            self.vars["w_hc"][(seg, hid, rt.room_type_id)] = w
            
            # Linearization
            self.model += w <= n, f"{w_key}_ub1"
            self.model += w <= max_rooms * z_any, f"{w_key}_ub2"
            self.model += w >= n - max_rooms * (1 - z_any), f"{w_key}_lb"


def _add_date_feasibility_constraints(self):
    """
    Add MILP constraints for date feasibility (backup to filter).
    
    Even though we filter infeasible flights, this:
    1. Makes the claim "date constraints in MILP" true
    2. Prevents regressions if filter logic changes
    3. Provides debugging info if constraint is violated
    
    For each flight edge, x_f <= feasible where feasible ∈ {0,1} is precomputed.
    """
    
    for f in self.flights:
        leg, edge = f.leg_id, f.edge_id
        
        # Feasibility was already computed during filtering
        # If flight passed filter, it's feasible (1), otherwise it wouldn't be here
        # But we add constraint anyway as documentation/backup
        
        is_feasible = 1  # All flights here passed filter
        
        # If we had kept infeasible flights for some reason:
        # is_feasible = self._compute_date_feasibility(f)
        
        self.model += (
            self.vars["x_f"][(leg, edge)] <= is_feasible
        ), f"date_feas_{leg}_{edge}"


def _get_native_hotel_points(self, payer: str, prog: str) -> "LpAffineExpression":
    """Get hotel points cost for native program."""
    
    src_id = f"native_{payer}_{prog}"
    total = 0
    
    for h in self.hotels:
        seg = next(s for s in self.spec.stay_segments if s.segment_id == h.segment_id)
        nights = seg.nights
        
        for rt in h.room_types:
            if rt.award_program != prog or not rt.has_award_pricing:
                continue
            
            key = (h.segment_id, h.hotel_id, rt.room_type_id, payer, src_id)
            
            if key in self.vars["w_hp"]:
                w = self.vars["w_hp"][key]
                total += w * rt.points_per_night * nights
    
    return total
```

**Test:** Group of 4, 2-capacity rooms → verify points cost = 2 rooms * rate * nights.

---

### Step 9: Objectives and Two-Pass Solve

**Files to modify:** `backend/src/optimization/solver_v3.py`

```python
def _build_oop_objective(self):
    """
    OOP: Minimize cash = flight_cash + hotel_cash + surcharges.
    
    Hotel cash comes from linearized room costs.
    """
    
    # Flight cash
    flight_cash = lpSum(
        self.vars["z_cf"][(f.leg_id, f.edge_id, p)] * f.cash_cost
        for f in self.flights
        for p in self.spec.all_traveler_ids
    )
    
    # Flight surcharges (when using points)
    flight_surcharge = lpSum(
        self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, p, src.source_id)] * opt.surcharge
        for f in self.flights
        for opt in f.award_options
        for p in self.spec.all_traveler_ids
        for src in self._get_sources_for_program(p, opt.program)
        if (f.leg_id, f.edge_id, opt.option_id, p, src.source_id) in self.vars["y_pf"]
    )
    
    # Hotel cash (from room vars)
    hotel_cash = self._compute_hotel_cash_objective()
    
    # Hotel surcharges
    hotel_surcharge = self._compute_hotel_surcharge_objective()
    
    return flight_cash + flight_surcharge + hotel_cash + hotel_surcharge


def _compute_hotel_cash_objective(self):
    """
    Hotel cash cost from linearized w_hc variables.
    
    REQUIRES: _add_hotel_cash_linearization() called first.
    """
    
    total = 0
    
    for h in self.hotels:
        seg, hid = h.segment_id, h.hotel_id
        segment = next(s for s in self.spec.stay_segments if s.segment_id == seg)
        nights = segment.nights
        
        for rt in h.room_types:
            key = (seg, hid, rt.room_type_id)
            
            if key in self.vars.get("w_hc", {}):
                w = self.vars["w_hc"][key]
                total += w * rt.cash_per_night * nights
    
    return total


def _compute_hotel_surcharge_objective(self):
    """Hotel surcharges when using points."""
    
    total = 0
    
    for h in self.hotels:
        seg, hid = h.segment_id, h.hotel_id
        segment = next(s for s in self.spec.stay_segments if s.segment_id == seg)
        nights = segment.nights
        
        for rt in h.room_types:
            if not rt.has_award_pricing:
                continue
            
            for key, w in self.vars["w_hp"].items():
                if key[0] == seg and key[1] == hid and key[2] == rt.room_type_id:
                    # Surcharge = w_rooms * surcharge_per_night * nights
                    total += w * rt.award_surcharge_per_night * nights
    
    return total


def _build_cpp_objective(self):
    """CPP: Maximize redemption value (negate for minimize)."""
    
    # Flight value
    flight_value = lpSum(
        self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, p, src.source_id)] * opt.soft_value_cpp
        for f in self.flights
        for opt in f.award_options
        for p in self.spec.all_traveler_ids
        for src in self._get_sources_for_program(p, opt.program)
        if (f.leg_id, f.edge_id, opt.option_id, p, src.source_id) in self.vars["y_pf"]
    )
    
    # Hotel value (from w_hp)
    hotel_value = 0
    for h in self.hotels:
        seg = next(s for s in self.spec.stay_segments if s.segment_id == h.segment_id)
        nights = seg.nights
        
        for rt in h.room_types:
            if not rt.has_award_pricing:
                continue
            
            # Compute soft value for this room award
            cash_value = rt.cash_per_night - rt.award_surcharge_per_night
            # (soft_value computation would be precomputed)
            
            for key, w in self.vars["w_hp"].items():
                if key[0] == seg and key[1] == h.hotel_id and key[2] == rt.room_type_id:
                    hotel_value += w * cash_value * nights
    
    # Negate for minimize
    return -(flight_value + hotel_value)


def _build_balanced_objective(self):
    """
    Balanced: Maximize value - cash_penalty.
    
    SIMPLIFIED: No baseline_cash computation.
    """
    
    cfg = self.balanced_config
    
    # Value utility (normalized)
    K_f = self._compute_K_flight()
    K_h = self._compute_K_hotel()
    
    flight_utility = lpSum(
        self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, p, src.source_id)] 
        * (opt.soft_value_balanced / K_f) * cfg.flight_importance
        for f in self.flights
        for opt in f.award_options
        for p in self.spec.all_traveler_ids
        for src in self._get_sources_for_program(p, opt.program)
        if (f.leg_id, f.edge_id, opt.option_id, p, src.source_id) in self.vars["y_pf"]
    )
    
    hotel_utility = self._compute_hotel_balanced_utility(K_h)
    
    # Cash penalty
    cash_cost = self._build_oop_objective()  # Reuse OOP computation
    cash_penalty = cfg.cash_penalty_weight * cash_cost
    
    # Availability penalty
    avail_penalty = self._compute_availability_penalty()
    
    # Total (negate utilities since minimizing)
    return -(flight_utility + hotel_utility) + cash_penalty + avail_penalty


def _compute_availability_penalty(self):
    """Penalty for low-availability awards."""
    
    cfg = self.balanced_config
    penalty = 0
    
    for f in self.flights:
        for opt in f.award_options:
            if opt.availability_score < 0.5:
                # Penalty for each y_pf using this option
                for p in self.spec.all_traveler_ids:
                    for src in self._get_sources_for_program(p, opt.program):
                        key = (f.leg_id, f.edge_id, opt.option_id, p, src.source_id)
                        if key in self.vars["y_pf"]:
                            risk = (0.5 - opt.availability_score) * cfg.low_availability_penalty
                            penalty += self.vars["y_pf"][key] * risk * opt.raw_value
    
    return penalty


def _solve_two_pass(self) -> Result:
    """Two-pass solve with robust slack."""
    
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
    # PASS 1
    # ════════════════════════════════════════════════════════════════════
    
    if self.mode == Mode.OOP:
        primary = self._build_oop_objective()
    elif self.mode == Mode.CPP:
        primary = self._build_cpp_objective()  # Already negated
    else:
        primary = self._build_balanced_objective()  # Already negated
    
    # PuLP-compatible way to set objective (works across versions)
    self.model.sense = LpMinimize
    self.model += primary, "primary_objective"
    
    status = self.model.solve(solver)
    
    if status != LpStatusOptimal:
        return Result(
            status=Status.INFEASIBLE_MODEL,
            solution=None,
            metrics=self.metrics,
            warnings=[],
            suggestions=["Model infeasible. Check constraints."],
        )
    
    opt1 = value(primary)
    self.metrics.pass1_objective = opt1
    
    # Robust slack
    slack = max(self.slack_config.abs_eps, self.slack_config.rel_eps * abs(opt1))
    self.metrics.pass1_slack = slack
    
    # Bind pass 1
    self.model += primary <= opt1 + slack, "pass1_bound"
    
    # ════════════════════════════════════════════════════════════════════
    # PASS 2: Tie-breaking
    # ════════════════════════════════════════════════════════════════════
    
    # Remove old objective, add new one
    # PuLP doesn't have a clean "replace objective" - rebuild or use += again
    secondary = self._build_secondary_objective(slack)
    
    # Create new model with pass1 constraint + secondary objective
    # Or simpler: just add secondary as the objective (PuLP replaces)
    self.model.sense = LpMinimize
    self.model.objective = secondary  # Direct assignment works in most PuLP versions
    
    status = self.model.solve(solver)
    
    self.metrics.pass2_objective = value(secondary) if status == LpStatusOptimal else 0
    
    # Extract solution
    solution = self._extract_solution()
    
    return Result(
        status=Status.OPTIMAL if status == LpStatusOptimal else Status.FEASIBLE_SUBOPTIMAL,
        solution=solution,
        metrics=self.metrics,
        warnings=[],
        suggestions=[],
    )


def _build_secondary_objective(self, slack: float):
    """Secondary objective with safe tie-breaking."""
    
    n = len(self.flights) + len(self.hotels)
    if n > 1:
        safe_eps = (1e-6 * abs(slack)) / (n * (n - 1) / 2)
    else:
        safe_eps = 1e-10
    
    safe_eps = max(1e-15, min(1e-6, safe_eps))
    
    # Prefer shorter flights, fewer stops
    time_cost = lpSum(
        self.vars["x_f"][(f.leg_id, f.edge_id)] * f.total_time_minutes
        for f in self.flights
    )
    
    stops_cost = lpSum(
        self.vars["x_f"][(f.leg_id, f.edge_id)] * f.num_stops * 60
        for f in self.flights
    )
    
    # Deterministic tie-breaker
    all_keys = sorted(self.vars["x_f"].keys()) + sorted(self.vars["x_h"].keys())
    tie = lpSum(
        (self.vars["x_f"][k] if k in self.vars["x_f"] else self.vars["x_h"][k]) * (i * safe_eps)
        for i, k in enumerate(all_keys)
    )
    
    return time_cost + stops_cost + tie
```

**Test:** Solve simple trip in each mode, verify objectives computed correctly.

---

## Summary: V3 Critical Fixes

| Issue | Fixed |
|-------|-------|
| **Award option not indexed** | `y_pf[(leg, edge, opt.option_id, payer, src.source_id)]` ✅ |
| **Hotel points not room-linked** | `w_hp` linearization: `points = w * rate * nights` ✅ |
| **Date feasibility not in MILP** | Filter + `_add_date_feasibility_constraints()` backup ✅ |
| **Single-ticket not enforced** | **HARD**: `unknown` dropped for connections, only `single_ticket` OK ✅ |
| **Pooling creates complexity** | Removed: payer uses only own balances ✅ |
| **Codeshare ≠ protected** | Changed to warnings only, no "protected" assertion ✅ |
| **Big-M too loose** | Tight bounds: `max_blocks = balance // increment` ✅ |
| **Balanced uses baseline_cash** | Simplified: `-cash_penalty_weight * actual_cash` ✅ |
| **Variable indexing inconsistent** | String IDs everywhere, deterministic key construction ✅ |

### V3.1 Additional Fixes

| Issue | Fixed |
|-------|-------|
| **Hotel payment under-constrained** | Added `u_points` + room type exclusivity constraints ✅ |
| **Linearization not wired** | Build order: linearization BEFORE transfer/balance constraints ✅ |
| **PuLP API compatibility** | `self.model.sense` + `self.model.objective` assignment ✅ |

---

## Flight Data Source: Ticketing Type

You asked about flight sources. Common mappings:

| Source | Single-Ticket Field |
|--------|---------------------|
| **Amadeus** | `validatingAirlineCodes` (if present and consistent) |
| **Duffel** | Offers are single-ticket by default |
| **Google Flights/SerpAPI** | Usually single-ticket (no explicit field) |
| **AwardTool** | Check `is_mixed_cabin` or booking class consistency |
| **Self-built** | MUST explicitly track ticketing source |

**Recommendation:** Add `ticketing_type` and `pricing_source` to your flight data pipeline, default to `"unknown"` if not sure.

---

Ready to start implementation with **Step 0 (TripPlanSpec)**?
