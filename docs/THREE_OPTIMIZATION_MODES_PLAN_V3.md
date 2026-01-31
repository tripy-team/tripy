# Three Optimization Modes: Implementation Plan V3

**Revision Notes:** V3 addresses critical production issues:
- Two-pass slack with absolute + relative epsilon
- Precomputed soft CPP values (no sigmoid in MILP)
- Integer rounding for transfer points
- Booking deadline risk modeling
- Hotel stay segments (not date inequality sums)
- Time-expanded flight nodes for multi-city
- **Group lodging / room allocation**
- Stable balanced normalization
- Safe deterministic epsilon
- Next-best solution mechanism
- **Pre-ILP pruning + solver limits**
- Feasibility fallbacks and status states

---

## Table of Contents

1. [Critical Fixes from V2 Review](#critical-fixes-from-v2-review)
2. [Two-Pass Optimization: Robust Slack](#two-pass-optimization-robust-slack)
3. [CPP Soft Values: Precomputed Constants](#cpp-soft-values-precomputed-constants)
4. [Transfer Modeling: Integer Rounding](#transfer-modeling-integer-rounding)
5. [Transfer Timing and Booking Deadlines](#transfer-timing-and-booking-deadlines)
6. [Hotel Stay Segments Model](#hotel-stay-segments-model)
7. [Time-Expanded Flight Nodes](#time-expanded-flight-nodes)
8. [Group Lodging and Room Allocation](#group-lodging-and-room-allocation)
9. [Balanced Normalization: Stable Scaling](#balanced-normalization-stable-scaling)
10. [Deterministic Epsilon: Safe Bounds](#deterministic-epsilon-safe-bounds)
11. [Next-Best Solution Mechanism](#next-best-solution-mechanism)
12. [Pre-ILP Pruning and Performance](#pre-ilp-pruning-and-performance)
13. [Feasibility Handling and Status States](#feasibility-handling-and-status-states)
14. [Revised Implementation Phases](#revised-implementation-phases)

---

## Critical Fixes from V2 Review

### Summary of V2 → V3 Changes

| Issue | V2 | V3 |
|-------|----|----|
| Two-pass slack | `opt * (1±ε)` | `opt ± max(abs_ε, rel_ε * opt)` |
| CPP soft threshold | Sigmoid in code | **Precomputed coefficient** |
| Transfer delivered | `blocks * ratio * bonus` (float) | **Integer variable with floor** |
| Booking deadline | Timing penalty only | **Hard constraint + risk flag** |
| Hotel dates | `Σ x*checkout <= Σ x*checkin` | **Explicit stay segments** |
| Flight path | Single city nodes | **Time-expanded (city, day)** |
| Group lodging | Per-traveler hotels | **Room allocation model** |
| Balanced scale | `1/max(K_f, K_h)` | **Separate `score/K` per category** |
| Tie-break epsilon | Fixed 1e-6 | **`abs_slack / (1e6 * n_edges)`** |
| Next-best solution | Promised, not implemented | **No-good cut mechanism** |
| Performance | None | **Pruning + time limits + fallback** |
| Infeasibility | None | **Status states + relaxation** |

---

## Two-Pass Optimization: Robust Slack

### Problem: Percentage Slack Fails Near Zero

```python
# V2 (WRONG when opt ≈ 0):
model += value >= opt_value * (1 - epsilon)  # If opt_value = $0, forces value = 0 exactly!
```

### Solution: Combined Absolute + Relative Slack

```python
@dataclass
class SlackConfig:
    """Configuration for two-pass slack bounds."""
    
    # Relative slack (percentage)
    rel_eps_cash: float = 0.01       # 1% more cash allowed
    rel_eps_value: float = 0.01      # 1% less value allowed
    
    # Absolute slack (prevents issues near zero)
    abs_eps_cash: float = 25.0       # $25 absolute slack
    abs_eps_value: float = 25.0      # $25 utility slack
    
    # For normalized objectives [0, 100]
    abs_eps_normalized: float = 0.5  # 0.5 utility units


def solve_two_pass_robust(model, mode, variables, costs):
    """
    Two-pass lexicographic optimization with robust slack handling.
    """
    
    slack_config = SlackConfig()
    
    # ════════════════════════════════════════════════════════════════════
    # PASS 1: PRIMARY OBJECTIVE
    # ════════════════════════════════════════════════════════════════════
    
    primary_obj = build_primary_objective(mode, variables, costs)
    
    if mode == "oop":
        model.setObjective(primary_obj, sense=LpMinimize)
    else:
        model.setObjective(primary_obj, sense=LpMaximize)
    
    model.solve(SOLVER_WITH_LIMITS)
    
    if model.status != LpStatusOptimal:
        return handle_infeasibility(model, mode)
    
    opt_primary = value(primary_obj)
    
    # ════════════════════════════════════════════════════════════════════
    # COMPUTE ROBUST SLACK BOUND
    # ════════════════════════════════════════════════════════════════════
    
    if mode == "oop":
        # OOP: minimize cash, allow slightly more
        # slack = max(absolute, relative * optimal)
        slack = max(
            slack_config.abs_eps_cash,
            slack_config.rel_eps_cash * abs(opt_primary)
        )
        # Constraint: cash <= opt + slack
        model += primary_obj <= opt_primary + slack, "pass1_bound"
        
    else:  # cpp or balanced
        # CPP/Balanced: maximize value, allow slightly less
        slack = max(
            slack_config.abs_eps_value,
            slack_config.rel_eps_value * abs(opt_primary)
        )
        # Constraint: value >= opt - slack
        model += primary_obj >= opt_primary - slack, "pass1_bound"
    
    logger.info(
        f"Pass 1 complete: opt={opt_primary:.2f}, "
        f"slack={slack:.2f} (abs={slack_config.abs_eps_cash}, "
        f"rel={slack_config.rel_eps_cash * abs(opt_primary):.2f})"
    )
    
    # ════════════════════════════════════════════════════════════════════
    # PASS 2: SECONDARY OBJECTIVE (TIE-BREAKING)
    # ════════════════════════════════════════════════════════════════════
    
    secondary_obj = build_secondary_objective(variables, costs, opt_primary)
    model.setObjective(secondary_obj, sense=LpMinimize)
    
    model.solve(SOLVER_WITH_LIMITS)
    
    return extract_solution(model, variables)
```

---

## CPP Soft Values: Precomputed Constants

### Problem: Sigmoid is Non-Linear (Not ILP-Friendly)

```python
# V2 showed sigmoid:
penalty_factor = 1.0 / (1.0 + math.exp(-steepness * (cpp - threshold)))

# This is FINE if cpp is known per award option (it's a constant, not a variable)
# But must be computed BEFORE building MILP, not inside constraints
```

### Solution: Precompute All Soft Values Before MILP

```python
@dataclass
class AwardOption:
    """An award booking option with precomputed value coefficients."""
    
    edge_key: Tuple
    program: str
    miles_required: int
    surcharge: float
    
    # Raw values
    cash_cost: float           # Cash price of this flight/hotel
    raw_value: float           # cash_cost - surcharge
    cpp: float                 # (raw_value * 100) / miles_required
    
    # PRECOMPUTED soft values for each mode (constants, not variables!)
    soft_value_oop: float      # For OOP mode (any cpp > 0)
    soft_value_cpp: float      # For CPP mode (soft penalty below threshold)
    soft_value_balanced: float # For Balanced mode (time/connection adjusted)


def precompute_award_values(
    award_options: List[AwardOption],
    thresholds: Dict[str, float],
    balanced_config: BalancedModeConfig,
) -> List[AwardOption]:
    """
    Precompute all soft values BEFORE building the MILP.
    
    These become FIXED COEFFICIENTS in the objective, not decision variables.
    """
    
    for opt in award_options:
        # ════════════════════════════════════════════════════════════════
        # OOP MODE: Use if any savings (cpp > 0)
        # ════════════════════════════════════════════════════════════════
        
        if opt.raw_value > 0:
            opt.soft_value_oop = opt.raw_value
        else:
            opt.soft_value_oop = 0.0  # Don't use if surcharge > cash
        
        # ════════════════════════════════════════════════════════════════
        # CPP MODE: Soft penalty below threshold
        # ════════════════════════════════════════════════════════════════
        
        threshold = thresholds.get(opt.program, thresholds["default"])
        
        if opt.cpp >= threshold:
            # Above threshold: full value
            opt.soft_value_cpp = opt.raw_value
        elif opt.cpp > 0:
            # Below threshold: penalized value (piecewise linear)
            # Full value at threshold, 20% value at cpp=0
            penalty_factor = 0.2 + 0.8 * (opt.cpp / threshold)
            opt.soft_value_cpp = opt.raw_value * penalty_factor
        else:
            # Negative cpp: zero value
            opt.soft_value_cpp = 0.0
        
        # Alternative: Sigmoid (precomputed, so it's just a constant)
        # steepness = 5.0
        # sigmoid_factor = 1.0 / (1.0 + math.exp(-steepness * (opt.cpp - threshold)))
        # opt.soft_value_cpp = opt.raw_value * sigmoid_factor
        
        # ════════════════════════════════════════════════════════════════
        # BALANCED MODE: Time/connection adjusted
        # ════════════════════════════════════════════════════════════════
        
        if opt.raw_value > 0:
            # Get edge details for time/connection factors
            edge = edges_by_key[opt.edge_key]
            
            hours = edge.total_time_minutes / 60
            time_factor = 1.0 + max(0, hours - balanced_config.baseline_hours) * balanced_config.time_penalty_per_hour
            
            connection_factor = 1.0 + edge.num_stops * balanced_config.connection_penalty
            
            opt.soft_value_balanced = opt.raw_value / (time_factor * connection_factor)
        else:
            opt.soft_value_balanced = 0.0
    
    return award_options


def build_cpp_objective(variables, award_options):
    """
    Build CPP mode objective using PRECOMPUTED soft values.
    
    The soft_value_cpp is a CONSTANT (float), not a variable.
    So y_points[opt.edge_key] * opt.soft_value_cpp is perfectly linear.
    """
    
    return lpSum(
        y_points[opt.edge_key] * opt.soft_value_cpp  # Constant coefficient!
        for opt in award_options
        if opt.soft_value_cpp > 0
    )
```

---

## Transfer Modeling: Integer Rounding

### Problem: Delivered Points Must Be Integers

```python
# V2 (WRONG - can produce fractional miles):
delivered = blocks * 1000 * 1.0 * 1.3  # = 1300.0 per block, fine
# But what if ratio = 0.75?
delivered = blocks * 1000 * 0.75 * 1.0  # = 750.0, fine
# What if bonus = 1.25?
delivered = blocks * 1000 * 0.75 * 1.25  # = 937.5 per block -- WRONG!
```

### Solution: Precompute Effective Increment (Integer)

```python
@dataclass
class TransferPath:
    """Transfer path with integer-safe computations."""
    
    from_bank: str
    to_program: str
    
    # Raw parameters
    min_increment: int      # e.g., 1000
    ratio: float            # e.g., 0.75 for CapOne → BA
    current_bonus: float    # e.g., 1.25 for 25% promo
    
    # PRECOMPUTED integer-safe values
    effective_delivered_per_block: int  # floor(increment * ratio * bonus)
    bank_points_per_delivered: float    # For computing bank points needed
    
    def __post_init__(self):
        # Precompute integer-safe delivered points per block
        # Programs always floor, not round
        raw_delivered = self.min_increment * self.ratio * self.current_bonus
        self.effective_delivered_per_block = int(math.floor(raw_delivered))
        
        # Inverse for computing bank points needed
        if self.effective_delivered_per_block > 0:
            self.bank_points_per_delivered = self.min_increment / self.effective_delivered_per_block
        else:
            self.bank_points_per_delivered = float('inf')
    
    def compute_delivered(self, bank_points: int) -> int:
        """Compute delivered points (integer) from bank points."""
        blocks = bank_points // self.min_increment
        return blocks * self.effective_delivered_per_block
    
    def compute_bank_points_needed(self, target_miles: int) -> int:
        """Compute bank points needed to achieve target miles (ceiling to increment)."""
        if self.effective_delivered_per_block <= 0:
            return float('inf')
        
        # How many blocks needed?
        blocks_needed = math.ceil(target_miles / self.effective_delivered_per_block)
        
        # Bank points = blocks * increment
        return blocks_needed * self.min_increment


def build_transfer_constraints_integer_safe(model, transfer_paths, source_balances, variables):
    """
    Build transfer constraints with integer-safe delivered points.
    """
    
    t_blocks = variables["t_blocks"]
    y_flight = variables["y_flight"]
    y_hotel = variables["y_hotel"]
    
    for tp in transfer_paths:
        s, prog = tp.from_bank, tp.to_program
        
        # ════════════════════════════════════════════════════════════════
        # KEY: Use precomputed INTEGER effective_delivered_per_block
        # ════════════════════════════════════════════════════════════════
        
        # Points used for flights via this path
        flight_miles_used = lpSum(
            y_flight[(s, prog)][e] * award_miles[prog][e]
            for e in flight_edges
            if (s, prog) in y_flight and prog in award_miles
        )
        
        # Points used for hotels via this path
        hotel_points_used = lpSum(
            y_hotel[(s, prog)][h] * award_points[prog][h]
            for h in hotel_edges
            if (s, prog) in y_hotel and prog in award_points
        )
        
        # Delivered points (INTEGER coefficient!)
        # delivered = t_blocks[s][prog] * tp.effective_delivered_per_block
        # Constraint: miles_used <= delivered
        model += (
            flight_miles_used + hotel_points_used 
            <= t_blocks[s][prog] * tp.effective_delivered_per_block
        ), f"transfer_integer_{s}_{prog}"
        
        # ════════════════════════════════════════════════════════════════
        # Bank points used = blocks * increment (always integer)
        # ════════════════════════════════════════════════════════════════
        
        # This is handled in the source balance constraint below
    
    # ════════════════════════════════════════════════════════════════════
    # SOURCE BALANCE: total blocks * increment <= balance
    # ════════════════════════════════════════════════════════════════════
    
    for source in sources:
        source_paths = [tp for tp in transfer_paths if tp.from_bank == source]
        
        # Bank points used = Σ blocks * increment
        bank_points_used = lpSum(
            t_blocks[source][tp.to_program] * tp.min_increment
            for tp in source_paths
        )
        
        # Must not exceed balance
        model += bank_points_used <= source_balances[source], f"source_balance_{source}"
```

---

## Transfer Timing and Booking Deadlines

### Problem: Transfer Lag Can Make Awards Unbookable

An optimizer might select an award that:
- Requires Amex transfer (up to 48h)
- But award space is volatile (might disappear in 3h)
- Or booking deadline is in 12h

### Solution: Booking Deadline Risk Model

```python
@dataclass
class AwardAvailability:
    """Award option with availability and timing metadata."""
    
    # Core award info
    award_option: AwardOption
    
    # Timing constraints
    booking_deadline_hours: Optional[int]  # Must book within this time
    estimated_holdability_hours: int       # How long award likely stays available
    
    # Risk assessment
    availability_confidence: float         # 0-1, likelihood still available
    is_volatile: bool                      # True if historically disappears fast
    
    def compute_risk_score(self, transfer_path: TransferPath) -> float:
        """
        Compute risk score based on transfer timing vs booking deadline.
        
        Returns 0.0 (no risk) to 1.0 (very high risk / likely unbookable)
        """
        
        if transfer_path.is_instant:
            return 0.0
        
        # Worst-case transfer time
        transfer_hours = transfer_path.max_hours
        
        # Time available to book
        deadline = self.booking_deadline_hours or self.estimated_holdability_hours
        
        if transfer_hours >= deadline:
            # Transfer won't complete in time - very high risk
            return 1.0
        elif transfer_hours >= deadline * 0.7:
            # Cutting it close - moderate risk
            return 0.5
        elif transfer_hours >= deadline * 0.5:
            # Some risk
            return 0.2
        else:
            return 0.0


def apply_booking_deadline_constraints(
    model, 
    award_options, 
    transfer_paths, 
    variables,
    user_accepts_risk: bool = False,
):
    """
    Apply constraints and penalties for booking deadline risk.
    """
    
    y_points = variables["y_points"]
    t_blocks = variables["t_blocks"]
    
    risk_penalties = []
    
    for opt in award_options:
        if not hasattr(opt, 'availability') or opt.availability is None:
            continue
        
        for tp in transfer_paths:
            if tp.to_program != opt.program:
                continue
            
            risk_score = opt.availability.compute_risk_score(tp)
            
            if risk_score >= 1.0 and not user_accepts_risk:
                # ════════════════════════════════════════════════════════
                # HARD CONSTRAINT: Transfer won't complete in time
                # ════════════════════════════════════════════════════════
                
                # Forbid using this transfer path for this award
                model += (
                    y_points[(tp.from_bank, tp.to_program)][opt.edge_key] == 0
                ), f"deadline_block_{tp.from_bank}_{opt.edge_key}"
                
                logger.warning(
                    f"Blocking {tp.from_bank}→{tp.to_program} for {opt.edge_key}: "
                    f"transfer takes {tp.max_hours}h but deadline is "
                    f"{opt.availability.booking_deadline_hours}h"
                )
                
            elif risk_score > 0:
                # ════════════════════════════════════════════════════════
                # SOFT PENALTY: Risky but possible
                # ════════════════════════════════════════════════════════
                
                # Add penalty proportional to risk
                # Penalty in "equivalent dollars" of risk
                risk_penalty_dollars = risk_score * opt.raw_value * 0.5  # 50% of value at risk
                
                risk_penalties.append(
                    y_points[(tp.from_bank, tp.to_program)][opt.edge_key] * risk_penalty_dollars
                )
    
    return lpSum(risk_penalties)
```

---

## Hotel Stay Segments Model

### Problem: Date Inequalities Don't Work with Multiple Candidates

```python
# V2 (WRONG):
# Σ x_hotel[h] * h.check_out <= Σ x_hotel[h] * h.check_in
# This doesn't make sense when summing over multiple hotels!
```

### Solution: Explicit Stay Segments with Exactly-One Selection

```python
@dataclass
class StaySegment:
    """
    A required hotel stay segment in the itinerary.
    
    The trip is decomposed into ordered stay segments.
    Each segment has exactly one hotel selected.
    Continuity is enforced by construction (segment order).
    """
    
    segment_id: int              # Order in trip (0, 1, 2, ...)
    city: str                    # Where to stay
    check_in: date               # Required check-in date
    check_out: date              # Required check-out date
    nights: int
    
    # Which flights this aligns with
    arriving_flight_date: date   # Must arrive on or before check_in
    departing_flight_date: date  # Must depart on or after check_out
    
    # Candidate hotels for this segment
    hotel_options: List[HotelOption]


@dataclass
class HotelOption:
    """A candidate hotel for a stay segment."""
    
    segment_id: int              # Which segment this belongs to
    hotel_id: str
    hotel_name: str
    chain: str                   # "HYATT", "MAR", etc.
    star_rating: float
    
    # Pricing
    cash_cost: float             # Total for all nights
    cash_per_night: float
    award_options: List[HotelAwardOption]


def decompose_trip_into_stay_segments(
    destinations: List[Destination],
    flight_itineraries: List[FlightItinerary],
) -> List[StaySegment]:
    """
    Decompose a trip into ordered stay segments.
    
    Example trip: JFK → TYO (3 nights) → KYO (2 nights) → TYO (1 night) → JFK
    
    Segments:
      0: TYO, Mar 1-4, 3 nights (after arrival, before KYO)
      1: KYO, Mar 4-6, 2 nights (after TYO, before return to TYO)
      2: TYO, Mar 6-7, 1 night (before departure)
    """
    
    segments = []
    
    for i, dest in enumerate(destinations):
        # Determine dates from flight constraints
        arriving_flights = find_arriving_flights(dest.city, flight_itineraries)
        departing_flights = find_departing_flights(dest.city, flight_itineraries)
        
        if not arriving_flights or not departing_flights:
            raise ValueError(f"No flights to/from {dest.city}")
        
        # Check-in: day of arrival (or next day if arriving late)
        earliest_arrival = min(f.arrival_datetime for f in arriving_flights)
        check_in = earliest_arrival.date()
        if earliest_arrival.hour >= 22:  # Late arrival
            check_in = check_in + timedelta(days=1)
        
        # Check-out: day of departure
        earliest_departure = min(f.departure_datetime for f in departing_flights)
        check_out = earliest_departure.date()
        
        nights = (check_out - check_in).days
        if nights <= 0:
            raise ValueError(f"Invalid stay at {dest.city}: {check_in} to {check_out}")
        
        segment = StaySegment(
            segment_id=i,
            city=dest.city,
            check_in=check_in,
            check_out=check_out,
            nights=nights,
            arriving_flight_date=earliest_arrival.date(),
            departing_flight_date=earliest_departure.date(),
            hotel_options=[],  # Filled by hotel search
        )
        
        segments.append(segment)
    
    return segments


def build_hotel_segment_constraints(model, stay_segments, variables):
    """
    Build hotel constraints using explicit stay segments.
    
    Key insight: Continuity is enforced by construction (segment order),
    NOT by date inequality constraints.
    """
    
    x_hotel = variables["x_hotel"]
    
    for segment in stay_segments:
        # ════════════════════════════════════════════════════════════════
        # CONSTRAINT: Exactly one hotel per segment
        # ════════════════════════════════════════════════════════════════
        
        model += lpSum(
            x_hotel[segment.segment_id][opt.hotel_id]
            for opt in segment.hotel_options
        ) == 1, f"one_hotel_segment_{segment.segment_id}"
    
    # ════════════════════════════════════════════════════════════════════
    # NOTE: No date inequality constraints needed!
    # 
    # Continuity is guaranteed because:
    # 1. Segments are ordered by construction
    # 2. Each segment has fixed check_in/check_out dates
    # 3. Flight alignment is handled separately (see below)
    # ════════════════════════════════════════════════════════════════════


def build_flight_hotel_alignment_constraints(model, stay_segments, flight_edges, variables):
    """
    Ensure selected flights align with hotel segments.
    
    This is simpler than V2 because segments have fixed dates.
    """
    
    x_flight = variables["x_flight"]
    x_hotel = variables["x_hotel"]
    
    for segment in stay_segments:
        # ════════════════════════════════════════════════════════════════
        # Find flights that can serve as "arrival" for this segment
        # ════════════════════════════════════════════════════════════════
        
        valid_arrivals = [
            f for f in flight_edges
            if f.destination in CITY_TO_AIRPORTS.get(segment.city, [segment.city])
            and f.arrival_datetime.date() <= segment.check_in
        ]
        
        if valid_arrivals:
            # At least one valid arrival must be selected
            # (This is a "linking" constraint, not coverage)
            # Actually, this should be handled by flight path constraints
            pass
        
        # ════════════════════════════════════════════════════════════════
        # Forbid flights that conflict with segment dates
        # ════════════════════════════════════════════════════════════════
        
        # Flights departing from this city BEFORE checkout are invalid
        conflicting_departures = [
            f for f in flight_edges
            if f.origin in CITY_TO_AIRPORTS.get(segment.city, [segment.city])
            and f.departure_datetime.date() < segment.check_out
        ]
        
        for f in conflicting_departures:
            # If this flight is selected, no hotel in this segment can be selected
            # But since exactly one hotel must be selected, this flight is forbidden
            for opt in segment.hotel_options:
                model += (
                    x_flight[f.edge_key] + x_hotel[segment.segment_id][opt.hotel_id] <= 1
                ), f"no_early_depart_{f.edge_key}_{segment.segment_id}"
```

---

## Time-Expanded Flight Nodes

### Problem: Single City Nodes Allow Impossible Sequences

With city-only nodes, the model might allow:
- Arrive TYO March 1
- Depart TYO March 1 (but arriving flight hasn't landed yet!)

### Solution: Time-Expanded Nodes (City, Day)

```python
@dataclass
class TimeExpandedNode:
    """
    A node in the time-expanded flight graph.
    
    Node = (city, day) rather than just (city)
    This enforces temporal feasibility.
    """
    
    city: str
    day: date
    
    @property
    def key(self) -> Tuple[str, date]:
        return (self.city, self.day)


def build_time_expanded_graph(
    flight_itineraries: List[FlightItinerary],
    stay_segments: List[StaySegment],
) -> Tuple[List[TimeExpandedNode], Dict]:
    """
    Build a time-expanded graph for flight path constraints.
    
    Nodes: (city, day)
    Edges: Flight itineraries that go from (origin, depart_day) to (dest, arrive_day)
    """
    
    nodes = set()
    edge_to_nodes = {}
    
    # Create nodes for all flight arrival/departure (city, day) pairs
    for f in flight_itineraries:
        depart_node = (f.origin, f.departure_datetime.date())
        arrive_node = (f.destination, f.arrival_datetime.date())
        
        nodes.add(depart_node)
        nodes.add(arrive_node)
        
        edge_to_nodes[f.edge_key] = {
            "depart_node": depart_node,
            "arrive_node": arrive_node,
        }
    
    # Create nodes for stay segment boundaries
    for seg in stay_segments:
        nodes.add((seg.city, seg.check_in))
        nodes.add((seg.city, seg.check_out))
    
    return list(nodes), edge_to_nodes


def build_time_expanded_path_constraints(model, nodes, edge_to_nodes, flight_edges, variables, trip_spec):
    """
    Build path constraints on time-expanded graph.
    
    This ensures temporal feasibility: can't depart before arriving.
    """
    
    x_flight = variables["x_flight"]
    
    # Group flights by their time-expanded node connections
    flights_departing_from = defaultdict(list)  # node -> [flight edges]
    flights_arriving_at = defaultdict(list)
    
    for f in flight_edges:
        nodes_info = edge_to_nodes[f.edge_key]
        flights_departing_from[nodes_info["depart_node"]].append(f)
        flights_arriving_at[nodes_info["arrive_node"]].append(f)
    
    # ════════════════════════════════════════════════════════════════════
    # START CONSTRAINT: Exactly one flight departs from (start_city, start_day)
    # ════════════════════════════════════════════════════════════════════
    
    start_node = (trip_spec.start_city, trip_spec.start_date)
    
    model += lpSum(
        x_flight[f.edge_key] for f in flights_departing_from.get(start_node, [])
    ) == 1, "start_constraint"
    
    # ════════════════════════════════════════════════════════════════════
    # END CONSTRAINT: Exactly one flight arrives at (end_city, end_day range)
    # ════════════════════════════════════════════════════════════════════
    
    # End can be a range of days
    valid_end_nodes = [
        (trip_spec.end_city, d) 
        for d in date_range(trip_spec.earliest_return, trip_spec.latest_return)
    ]
    
    model += lpSum(
        x_flight[f.edge_key] 
        for node in valid_end_nodes 
        for f in flights_arriving_at.get(node, [])
    ) == 1, "end_constraint"
    
    # ════════════════════════════════════════════════════════════════════
    # FLOW CONSERVATION: At intermediate nodes
    # ════════════════════════════════════════════════════════════════════
    
    for node in nodes:
        if node == start_node or node[0] == trip_spec.end_city:
            continue
        
        inflow = lpSum(
            x_flight[f.edge_key] for f in flights_arriving_at.get(node, [])
        )
        outflow = lpSum(
            x_flight[f.edge_key] for f in flights_departing_from.get(node, [])
        )
        
        # Flow conservation: inflow == outflow
        # But we need to account for "staying" at a city (hotel)
        # This is where stay segments connect
        
        # ... (more complex flow logic for multi-city)
```

---

## Group Lodging and Room Allocation

### Problem: Per-Traveler Hotels Double-Count or Under-Count

V2 indexed hotels by traveler `p`, which:
- Duplicates hotel costs if 2 people share a room
- Doesn't model room capacity

### Solution: Room Allocation Model

```python
@dataclass
class RoomType:
    """A room type available at a hotel."""
    
    room_type_id: str           # e.g., "standard_double"
    hotel_id: str
    capacity: int               # Max occupants
    
    # Pricing
    cash_per_night: float
    award_per_night: Optional[int]
    award_program: Optional[str]


@dataclass
class RoomAllocation:
    """
    Room allocation for a group stay.
    
    Models: how many rooms of each type, who stays where.
    """
    
    segment_id: int
    hotel_id: str
    room_types: List[RoomType]
    
    # Decision: how many of each room type
    # Variables: n_rooms[room_type_id] ∈ Z⁺


def build_group_lodging_constraints(
    model, 
    stay_segments, 
    travelers: List[str],
    variables,
):
    """
    Build room allocation constraints for group travel.
    
    Key insight: Rooms are the decision, not per-person hotels.
    """
    
    n_rooms = variables["n_rooms"]         # n_rooms[segment_id][hotel_id][room_type_id] ∈ Z⁺
    x_hotel = variables["x_hotel"]         # x_hotel[segment_id][hotel_id] ∈ {0,1}
    traveler_in_hotel = variables["t_in_h"]  # t_in_h[segment_id][traveler][hotel_id] ∈ {0,1}
    
    for segment in stay_segments:
        num_travelers = len(travelers)
        
        for hotel_opt in segment.hotel_options:
            hotel_id = hotel_opt.hotel_id
            
            # ════════════════════════════════════════════════════════════
            # CONSTRAINT 1: If hotel selected, must have enough room capacity
            # ════════════════════════════════════════════════════════════
            
            total_capacity = lpSum(
                n_rooms[segment.segment_id][hotel_id][rt.room_type_id] * rt.capacity
                for rt in hotel_opt.room_types
            )
            
            # Capacity >= travelers if hotel is selected
            # Use big-M: capacity >= num_travelers * x_hotel[hotel]
            M = num_travelers + 10  # Big-M
            
            model += (
                total_capacity >= num_travelers * x_hotel[segment.segment_id][hotel_id]
            ), f"room_capacity_{segment.segment_id}_{hotel_id}"
            
            # ════════════════════════════════════════════════════════════
            # CONSTRAINT 2: Rooms only if hotel selected
            # ════════════════════════════════════════════════════════════
            
            for rt in hotel_opt.room_types:
                # n_rooms <= M * x_hotel (can only have rooms if hotel selected)
                model += (
                    n_rooms[segment.segment_id][hotel_id][rt.room_type_id] 
                    <= M * x_hotel[segment.segment_id][hotel_id]
                ), f"rooms_if_selected_{segment.segment_id}_{hotel_id}_{rt.room_type_id}"
            
            # ════════════════════════════════════════════════════════════
            # CONSTRAINT 3: Each traveler assigned to exactly one hotel
            # ════════════════════════════════════════════════════════════
            
            for t in travelers:
                model += lpSum(
                    traveler_in_hotel[segment.segment_id][t][h.hotel_id]
                    for h in segment.hotel_options
                ) == 1, f"traveler_one_hotel_{segment.segment_id}_{t}"
            
            # ════════════════════════════════════════════════════════════
            # CONSTRAINT 4: Travelers in hotel <= capacity
            # ════════════════════════════════════════════════════════════
            
            travelers_in_this_hotel = lpSum(
                traveler_in_hotel[segment.segment_id][t][hotel_id]
                for t in travelers
            )
            
            model += (
                travelers_in_this_hotel <= total_capacity
            ), f"travelers_fit_{segment.segment_id}_{hotel_id}"
            
            # ════════════════════════════════════════════════════════════
            # CONSTRAINT 5: Link traveler assignment to hotel selection
            # ════════════════════════════════════════════════════════════
            
            for t in travelers:
                # traveler_in_hotel <= x_hotel
                model += (
                    traveler_in_hotel[segment.segment_id][t][hotel_id]
                    <= x_hotel[segment.segment_id][hotel_id]
                ), f"traveler_hotel_link_{segment.segment_id}_{t}_{hotel_id}"


def compute_hotel_cost(segment, hotel_opt, n_rooms_values, nights):
    """
    Compute total hotel cost based on room allocation.
    
    Cost = Σ (n_rooms[room_type] * room_cost_per_night * nights)
    """
    
    total_cash = 0.0
    total_points = 0
    
    for rt in hotel_opt.room_types:
        num = n_rooms_values.get(rt.room_type_id, 0)
        total_cash += num * rt.cash_per_night * nights
        if rt.award_per_night:
            total_points += num * rt.award_per_night * nights
    
    return total_cash, total_points
```

---

## Balanced Normalization: Stable Scaling

### Problem: `1/max(K_f, K_h)` Creates Instability

If one category has unusually high density, the other becomes negligible.

### Solution: Separate Scaling Per Category, Then Weight

```python
def compute_balanced_scores_v3(
    flight_options: List[FlightOption],
    hotel_options: List[HotelOption],
    config: BalancedModeConfig,
) -> Tuple[Dict, Dict]:
    """
    Compute balanced scores with stable per-category normalization.
    
    V3 approach:
    1. Compute raw balanced score per option
    2. Normalize each category separately by its K
    3. Apply user importance weights
    4. DON'T divide by max(K_f, K_h)
    """
    
    # ════════════════════════════════════════════════════════════════════
    # STEP 1: Compute raw balanced scores
    # ════════════════════════════════════════════════════════════════════
    
    flight_raw_scores = {}
    for f in flight_options:
        if f.value <= 0:
            flight_raw_scores[f.edge_key] = 0.0
            continue
        
        hours = f.total_time_minutes / 60
        time_factor = 1.0 + max(0, hours - config.baseline_hours) * config.time_penalty_per_hour
        connection_factor = 1.0 + f.num_stops * config.connection_penalty
        
        flight_raw_scores[f.edge_key] = f.value / (time_factor * connection_factor)
    
    hotel_raw_scores = {}
    for h in hotel_options:
        if h.value <= 0:
            hotel_raw_scores[h.edge_key] = 0.0
            continue
        
        quality_factor = config.quality_bonus.get(h.star_rating, 1.0)
        hotel_raw_scores[h.edge_key] = h.value * quality_factor
    
    # ════════════════════════════════════════════════════════════════════
    # STEP 2: Compute K per category (robust median)
    # ════════════════════════════════════════════════════════════════════
    
    flight_scores_list = [s for s in flight_raw_scores.values() if s > 0]
    hotel_scores_list = [s for s in hotel_raw_scores.values() if s > 0]
    
    K_flight = robust_median(flight_scores_list, config) if flight_scores_list else 1.0
    K_hotel = robust_median(hotel_scores_list, config) if hotel_scores_list else 1.0
    
    # ════════════════════════════════════════════════════════════════════
    # STEP 3: Normalize SEPARATELY, then apply importance
    # ════════════════════════════════════════════════════════════════════
    
    # Normalized flight utility = (raw_score / K_flight) * flight_importance
    # This puts flights on a "per unit contribution" scale
    
    flight_utility = {}
    for key, raw_score in flight_raw_scores.items():
        normalized = raw_score / K_flight if K_flight > 0 else 0
        flight_utility[key] = normalized * config.flight_importance
    
    # Normalized hotel utility = (raw_score / K_hotel) * hotel_importance
    hotel_utility = {}
    for key, raw_score in hotel_raw_scores.items():
        normalized = raw_score / K_hotel if K_hotel > 0 else 0
        hotel_utility[key] = normalized * config.hotel_importance
    
    # ════════════════════════════════════════════════════════════════════
    # NOTE: We DON'T divide by max(K_flight, K_hotel)
    # 
    # This keeps the two categories on comparable scales:
    # - A "typical" flight option has utility ≈ flight_importance
    # - A "typical" hotel option has utility ≈ hotel_importance
    # 
    # User can then tune flight_importance vs hotel_importance
    # to express "I care more about flights / hotels"
    # ════════════════════════════════════════════════════════════════════
    
    return flight_utility, hotel_utility


def robust_median(values: List[float], config: BalancedModeConfig) -> float:
    """Compute robust median with trimming and minimum samples."""
    
    if len(values) < config.min_samples_for_median:
        # Not enough samples - return prior
        return config.default_density_prior
    
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    
    # Trim outliers (e.g., top/bottom 10%)
    low_idx = int(n * config.outlier_percentile)
    high_idx = int(n * (1 - config.outlier_percentile))
    
    if low_idx >= high_idx:
        return sorted_vals[n // 2]
    
    trimmed = sorted_vals[low_idx:high_idx]
    return trimmed[len(trimmed) // 2]
```

---

## Deterministic Epsilon: Safe Bounds

### Problem: Fixed Epsilon Can Dominate Small Objectives

If objective is ~0.001 after normalization, `epsilon=1e-6` per edge could add up to dominate.

### Solution: Compute Safe Epsilon Relative to Primary Slack

```python
def compute_safe_tie_break_epsilon(
    primary_slack: float,
    num_edges: int,
    safety_factor: float = 1e-6,
) -> float:
    """
    Compute a safe epsilon for tie-breaking that won't affect primary objective.
    
    The total tie-break contribution across ALL edges should be < safety_factor * primary_slack.
    """
    
    if num_edges <= 0:
        return 1e-10
    
    # Total tie-break contribution = sum of (i * epsilon) for i in 0..n-1
    # = epsilon * (0 + 1 + 2 + ... + n-1) = epsilon * n*(n-1)/2
    
    max_tie_break_sum = num_edges * (num_edges - 1) / 2
    
    # We want: max_tie_break_sum * epsilon < safety_factor * primary_slack
    # So: epsilon < (safety_factor * primary_slack) / max_tie_break_sum
    
    if max_tie_break_sum <= 0:
        return 1e-10
    
    safe_epsilon = (safety_factor * abs(primary_slack)) / max_tie_break_sum
    
    # Clamp to reasonable range
    return max(1e-15, min(1e-6, safe_epsilon))


def build_secondary_objective_with_safe_epsilon(
    variables, 
    costs, 
    primary_slack: float,
):
    """
    Build secondary objective with safely bounded tie-breaker.
    """
    
    edges = list(variables["x_flight"].keys()) + list(variables["x_hotel"].keys())
    n_edges = len(edges)
    
    safe_eps = compute_safe_tie_break_epsilon(primary_slack, n_edges)
    
    logger.debug(
        f"Tie-break epsilon: {safe_eps:.2e} "
        f"(primary_slack={primary_slack:.2f}, n_edges={n_edges})"
    )
    
    # Secondary: minimize time, segments, prefer earlier, etc.
    secondary = (
        1.0 * lpSum(variables["x_flight"][e] * costs["time"][e] for e in variables["x_flight"])
        + 10.0 * lpSum(variables["x_flight"][e] * costs["segments"][e] for e in variables["x_flight"])
        + 0.1 * lpSum(variables["x_flight"][e] * costs["departure_minutes"][e] for e in variables["x_flight"])
    )
    
    # Deterministic tie-breaker with safe epsilon
    # Sort edges for determinism
    sorted_edges = sorted(edges)
    tie_breaker = lpSum(
        variables["x"][e] * (i * safe_eps)
        for i, e in enumerate(sorted_edges)
        if e in variables["x"]
    )
    
    return secondary + tie_breaker
```

---

## Next-Best Solution Mechanism

### Problem: Explainability Promises Alternatives

"Next best solution" requires actually computing it, not just promising.

### Solution: Two Mechanisms

```python
def compute_alternatives(
    model,
    solution,
    variables,
    costs,
    mode: str,
    compute_global_next_best: bool = False,
) -> Dict:
    """
    Compute alternatives for explainability.
    
    Two mechanisms:
    1. Local alternatives: For each selected edge, compare to other options in same bucket
    2. Global next-best: Re-solve with no-good cut (expensive, optional)
    """
    
    alternatives = {
        "local": {},
        "global_next_best": None,
    }
    
    # ════════════════════════════════════════════════════════════════════
    # LOCAL ALTERNATIVES (cheap, always computed)
    # ════════════════════════════════════════════════════════════════════
    
    for selected_edge in solution["selected_edges"]:
        # Find other edges in same bucket (same O-D, same date range)
        bucket = get_edge_bucket(selected_edge)
        other_options = [
            e for e in all_edges 
            if get_edge_bucket(e) == bucket and e != selected_edge
        ]
        
        if not other_options:
            alternatives["local"][selected_edge.edge_key] = {
                "next_best": None,
                "reason": "Only available option",
            }
            continue
        
        # Sort by relevant metric for mode
        if mode == "oop":
            sorted_options = sorted(other_options, key=lambda e: e.cash_cost)
        elif mode == "cpp":
            sorted_options = sorted(other_options, key=lambda e: -e.cpp if e.cpp else float('inf'))
        else:
            sorted_options = sorted(other_options, key=lambda e: -e.balanced_utility)
        
        next_best = sorted_options[0]
        
        alternatives["local"][selected_edge.edge_key] = {
            "next_best": next_best,
            "selected_metric": get_metric(selected_edge, mode),
            "next_best_metric": get_metric(next_best, mode),
            "difference": compute_difference(selected_edge, next_best, mode),
            "reason": explain_selection(selected_edge, next_best, mode),
        }
    
    # ════════════════════════════════════════════════════════════════════
    # GLOBAL NEXT-BEST (expensive, optional)
    # ════════════════════════════════════════════════════════════════════
    
    if compute_global_next_best:
        # Add no-good cut: exclude exact current solution
        selected_binaries = [
            variables["x"][e.edge_key] for e in solution["selected_edges"]
        ]
        
        # Constraint: at least one selected edge must be different
        # Σ x[selected] <= k - 1 where k = number of selected edges
        k = len(selected_binaries)
        
        # Clone model (or build fresh with additional constraint)
        model_copy = model.copy()
        model_copy += lpSum(selected_binaries) <= k - 1, "no_good_cut"
        
        # Re-solve
        model_copy.solve(SOLVER_WITH_LIMITS)
        
        if model_copy.status == LpStatusOptimal:
            next_best_solution = extract_solution(model_copy, variables)
            
            alternatives["global_next_best"] = {
                "solution": next_best_solution,
                "objective_difference": solution["objective"] - next_best_solution["objective"],
                "edges_changed": find_changed_edges(solution, next_best_solution),
            }
        else:
            alternatives["global_next_best"] = {
                "solution": None,
                "reason": "No alternative solution found",
            }
    
    return alternatives
```

---

## Pre-ILP Pruning and Performance

### Problem: Candidate Explosion

Flights × Hotels × Awards × Transfers can easily exceed 100K combinations.

### Solution: Aggressive Pre-ILP Pruning + Solver Limits

```python
@dataclass
class PruningConfig:
    """Configuration for pre-ILP candidate pruning."""
    
    # Flight limits
    max_flight_itineraries_per_od: int = 20     # Top 20 per O-D pair
    max_stops: int = 2                           # Hard limit on connections
    max_duration_hours: float = 36.0             # Hard limit on travel time
    
    # Hotel limits
    max_hotels_per_segment: int = 15             # Top 15 per stay segment
    
    # Award limits
    max_award_programs_per_edge: int = 3         # Top 3 programs by value
    
    # Heuristic scoring weights (for pruning, not optimization)
    prune_score_weights: Dict[str, float] = field(default_factory=lambda: {
        "cash": 0.4,
        "value": 0.3,
        "time": 0.2,
        "stops": 0.1,
    })


def prune_candidates(
    flight_itineraries: List[FlightItinerary],
    hotel_options: List[HotelOption],
    award_options: List[AwardOption],
    config: PruningConfig,
) -> Tuple[List, List, List]:
    """
    Aggressively prune candidates before building ILP.
    
    This is critical for performance. A 10x reduction in candidates
    can mean 100x faster solve time.
    """
    
    logger.info(
        f"Pre-pruning: {len(flight_itineraries)} flights, "
        f"{len(hotel_options)} hotels, {len(award_options)} awards"
    )
    
    # ════════════════════════════════════════════════════════════════════
    # PRUNE FLIGHTS
    # ════════════════════════════════════════════════════════════════════
    
    pruned_flights = []
    
    # Group by O-D pair
    flights_by_od = defaultdict(list)
    for f in flight_itineraries:
        # Hard filters
        if f.num_stops > config.max_stops:
            continue
        if f.total_time_minutes / 60 > config.max_duration_hours:
            continue
        
        od_key = (f.origin, f.destination, f.departure_datetime.date())
        flights_by_od[od_key].append(f)
    
    # Keep top K per O-D
    for od_key, flights in flights_by_od.items():
        # Score by heuristic
        scored = [
            (f, compute_prune_score(f, config.prune_score_weights))
            for f in flights
        ]
        scored.sort(key=lambda x: -x[1])  # Higher score = better
        
        # Keep top K
        top_k = scored[:config.max_flight_itineraries_per_od]
        pruned_flights.extend([f for f, _ in top_k])
    
    # ════════════════════════════════════════════════════════════════════
    # PRUNE HOTELS
    # ════════════════════════════════════════════════════════════════════
    
    pruned_hotels = []
    
    # Group by segment
    hotels_by_segment = defaultdict(list)
    for h in hotel_options:
        hotels_by_segment[h.segment_id].append(h)
    
    for segment_id, hotels in hotels_by_segment.items():
        # Score by value/cash ratio and quality
        scored = [
            (h, h.value / max(1, h.cash_cost) * h.star_rating)
            for h in hotels
        ]
        scored.sort(key=lambda x: -x[1])
        
        # Keep top K
        top_k = scored[:config.max_hotels_per_segment]
        pruned_hotels.extend([h for h, _ in top_k])
    
    # ════════════════════════════════════════════════════════════════════
    # PRUNE AWARDS
    # ════════════════════════════════════════════════════════════════════
    
    pruned_awards = []
    
    # Group by edge
    awards_by_edge = defaultdict(list)
    for a in award_options:
        awards_by_edge[a.edge_key].append(a)
    
    for edge_key, awards in awards_by_edge.items():
        # Sort by soft value (precomputed)
        scored = sorted(awards, key=lambda a: -a.soft_value_oop)
        
        # Keep top K programs
        programs_seen = set()
        top_awards = []
        for a in scored:
            if a.program not in programs_seen:
                top_awards.append(a)
                programs_seen.add(a.program)
            if len(programs_seen) >= config.max_award_programs_per_edge:
                break
        
        pruned_awards.extend(top_awards)
    
    logger.info(
        f"Post-pruning: {len(pruned_flights)} flights ({100*len(pruned_flights)/max(1,len(flight_itineraries)):.0f}%), "
        f"{len(pruned_hotels)} hotels ({100*len(pruned_hotels)/max(1,len(hotel_options)):.0f}%), "
        f"{len(pruned_awards)} awards ({100*len(pruned_awards)/max(1,len(award_options)):.0f}%)"
    )
    
    return pruned_flights, pruned_hotels, pruned_awards


def compute_prune_score(flight: FlightItinerary, weights: Dict[str, float]) -> float:
    """Compute heuristic score for pruning (higher = more likely to keep)."""
    
    # Normalize components to ~[0, 1]
    cash_score = 1.0 - min(1.0, flight.cash_cost / 5000)  # Lower cash = higher score
    value_score = min(1.0, flight.best_award_value / 2000) if flight.best_award_value else 0
    time_score = 1.0 - min(1.0, flight.total_time_minutes / 60 / 24)  # Shorter = higher
    stops_score = 1.0 - min(1.0, flight.num_stops / 3)  # Fewer stops = higher
    
    return (
        weights.get("cash", 0) * cash_score +
        weights.get("value", 0) * value_score +
        weights.get("time", 0) * time_score +
        weights.get("stops", 0) * stops_score
    )


@dataclass
class SolverConfig:
    """Configuration for ILP solver."""
    
    time_limit_seconds: float = 30.0    # Max solve time
    mip_gap: float = 0.01               # 1% optimality gap acceptable
    threads: int = 4                    # Parallel threads
    
    # Fallback
    enable_heuristic_fallback: bool = True
    heuristic_time_limit: float = 5.0


def solve_with_limits(model, config: SolverConfig):
    """
    Solve ILP with time limits and fallback.
    """
    
    solver = PULP_CBC_CMD(
        msg=False,
        timeLimit=config.time_limit_seconds,
        gapRel=config.mip_gap,
        threads=config.threads,
    )
    
    status = model.solve(solver)
    
    if status == LpStatusOptimal:
        return SolveResult(status="OPTIMAL", solution=extract_solution(model))
    
    elif status == LpStatusNotSolved and config.enable_heuristic_fallback:
        # Time limit hit - check if we have a feasible solution
        if model.status == 1:  # Feasible but not proven optimal
            return SolveResult(
                status="FEASIBLE_SUBOPTIMAL",
                solution=extract_solution(model),
                warning="Time limit reached. Solution may not be optimal.",
            )
        else:
            # No feasible solution found in time - try heuristic
            return run_heuristic_fallback(model, config)
    
    else:
        return SolveResult(status="INFEASIBLE", solution=None)
```

---

## Feasibility Handling and Status States

### Problem: Many Ways Optimization Can Fail

- No award availability
- Transfer constraints too tight
- Hotel inventory missing
- User preferences too strict

### Solution: Explicit Status States + Relaxation Strategy

```python
class OptimizationStatus(Enum):
    """Explicit status states for optimization results."""
    
    OPTIMAL = "optimal"
    FEASIBLE_SUBOPTIMAL = "feasible_suboptimal"
    INFEASIBLE_PREFERENCES = "infeasible_preferences"
    INFEASIBLE_DATA_MISSING = "infeasible_data_missing"
    INFEASIBLE_TRANSFERS = "infeasible_transfers"
    INFEASIBLE_DATES = "infeasible_dates"
    TIMEOUT = "timeout"
    ERROR = "error"


@dataclass
class OptimizationResult:
    """Complete optimization result with status and diagnostics."""
    
    status: OptimizationStatus
    solution: Optional[Dict]
    
    # Diagnostics
    solve_time_seconds: float
    num_variables: int
    num_constraints: int
    
    # Warnings and suggestions
    warnings: List[str]
    relaxation_applied: List[str]
    suggestions: List[str]
    
    # For infeasible cases
    infeasibility_reason: Optional[str]
    missing_data: List[str]


def solve_with_feasibility_handling(
    model,
    variables,
    costs,
    mode: str,
    preferences: UserPreferences,
) -> OptimizationResult:
    """
    Solve with comprehensive feasibility handling.
    """
    
    start_time = time.time()
    warnings = []
    relaxations = []
    suggestions = []
    
    # ════════════════════════════════════════════════════════════════════
    # ATTEMPT 1: Solve with full preferences
    # ════════════════════════════════════════════════════════════════════
    
    result = solve_with_limits(model, SOLVER_CONFIG)
    
    if result.status == "OPTIMAL":
        return OptimizationResult(
            status=OptimizationStatus.OPTIMAL,
            solution=result.solution,
            solve_time_seconds=time.time() - start_time,
            num_variables=len(model.variables()),
            num_constraints=len(model.constraints),
            warnings=warnings,
            relaxation_applied=[],
            suggestions=[],
            infeasibility_reason=None,
            missing_data=[],
        )
    
    if result.status == "FEASIBLE_SUBOPTIMAL":
        warnings.append("Time limit reached. Solution may not be globally optimal.")
        return OptimizationResult(
            status=OptimizationStatus.FEASIBLE_SUBOPTIMAL,
            solution=result.solution,
            solve_time_seconds=time.time() - start_time,
            num_variables=len(model.variables()),
            num_constraints=len(model.constraints),
            warnings=warnings,
            relaxation_applied=[],
            suggestions=["Consider expanding search time for better results."],
            infeasibility_reason=None,
            missing_data=[],
        )
    
    # ════════════════════════════════════════════════════════════════════
    # ATTEMPT 2: Diagnose infeasibility
    # ════════════════════════════════════════════════════════════════════
    
    diagnosis = diagnose_infeasibility(model, variables, costs, preferences)
    
    if diagnosis.cause == "preferences":
        # ════════════════════════════════════════════════════════════════
        # ATTEMPT 3: Relax soft preferences
        # ════════════════════════════════════════════════════════════════
        
        relaxed_prefs = relax_preferences(preferences, diagnosis.blocking_preferences)
        relaxations = [f"Relaxed: {p}" for p in diagnosis.blocking_preferences]
        
        # Rebuild model with relaxed preferences
        model_relaxed = build_model_with_preferences(variables, costs, mode, relaxed_prefs)
        result_relaxed = solve_with_limits(model_relaxed, SOLVER_CONFIG)
        
        if result_relaxed.status in ["OPTIMAL", "FEASIBLE_SUBOPTIMAL"]:
            warnings.append(
                f"Original preferences were too strict. "
                f"Relaxed: {', '.join(diagnosis.blocking_preferences)}"
            )
            return OptimizationResult(
                status=OptimizationStatus.FEASIBLE_SUBOPTIMAL,
                solution=result_relaxed.solution,
                solve_time_seconds=time.time() - start_time,
                num_variables=len(model_relaxed.variables()),
                num_constraints=len(model_relaxed.constraints),
                warnings=warnings,
                relaxation_applied=relaxations,
                suggestions=["Consider adjusting preferences for better options."],
                infeasibility_reason=None,
                missing_data=[],
            )
    
    # ════════════════════════════════════════════════════════════════════
    # ATTEMPT 4: Identify missing data
    # ════════════════════════════════════════════════════════════════════
    
    missing_data = identify_missing_data(variables, costs, diagnosis)
    
    if missing_data:
        return OptimizationResult(
            status=OptimizationStatus.INFEASIBLE_DATA_MISSING,
            solution=None,
            solve_time_seconds=time.time() - start_time,
            num_variables=len(model.variables()),
            num_constraints=len(model.constraints),
            warnings=[],
            relaxation_applied=[],
            suggestions=[
                f"Missing {item['type']} data for {item['location']}: {item['suggestion']}"
                for item in missing_data
            ],
            infeasibility_reason="Required flight/hotel data not available",
            missing_data=[f"{item['type']} at {item['location']}" for item in missing_data],
        )
    
    # ════════════════════════════════════════════════════════════════════
    # FINAL: Return infeasible with diagnosis
    # ════════════════════════════════════════════════════════════════════
    
    return OptimizationResult(
        status=diagnose_to_status(diagnosis),
        solution=None,
        solve_time_seconds=time.time() - start_time,
        num_variables=len(model.variables()),
        num_constraints=len(model.constraints),
        warnings=[],
        relaxation_applied=[],
        suggestions=diagnosis.suggestions,
        infeasibility_reason=diagnosis.reason,
        missing_data=diagnosis.missing_items,
    )


@dataclass
class InfeasibilityDiagnosis:
    """Diagnosis of why optimization failed."""
    
    cause: str  # "preferences", "data", "transfers", "dates", "unknown"
    reason: str
    blocking_preferences: List[str]
    missing_items: List[str]
    suggestions: List[str]


def diagnose_infeasibility(model, variables, costs, preferences) -> InfeasibilityDiagnosis:
    """
    Diagnose why the model is infeasible.
    
    Strategy: Relax constraints one by one to find the culprit.
    """
    
    # Check 1: Are there any flights?
    if not variables["x_flight"]:
        return InfeasibilityDiagnosis(
            cause="data",
            reason="No flight options available",
            blocking_preferences=[],
            missing_items=["flights"],
            suggestions=["Expand search dates or airports"],
        )
    
    # Check 2: Are there any hotels?
    if not variables["x_hotel"]:
        return InfeasibilityDiagnosis(
            cause="data",
            reason="No hotel options available",
            blocking_preferences=[],
            missing_items=["hotels"],
            suggestions=["Expand hotel search radius or dates"],
        )
    
    # Check 3: Test without preference constraints
    model_no_prefs = build_model_without_preferences(variables, costs)
    result = solve_with_limits(model_no_prefs, SolverConfig(time_limit_seconds=5))
    
    if result.status == "OPTIMAL":
        # Preferences are the problem - find which ones
        blocking = find_blocking_preferences(model, variables, costs, preferences)
        return InfeasibilityDiagnosis(
            cause="preferences",
            reason=f"Preferences too restrictive: {', '.join(blocking)}",
            blocking_preferences=blocking,
            missing_items=[],
            suggestions=[f"Consider relaxing: {p}" for p in blocking],
        )
    
    # Check 4: Test transfers
    model_no_transfers = build_model_cash_only(variables, costs)
    result = solve_with_limits(model_no_transfers, SolverConfig(time_limit_seconds=5))
    
    if result.status == "OPTIMAL":
        return InfeasibilityDiagnosis(
            cause="transfers",
            reason="Transfer constraints make points usage impossible",
            blocking_preferences=[],
            missing_items=["transfer paths"],
            suggestions=["Check transfer graph configuration"],
        )
    
    # Unknown cause
    return InfeasibilityDiagnosis(
        cause="unknown",
        reason="Unable to find feasible solution",
        blocking_preferences=[],
        missing_items=[],
        suggestions=["Try different dates or destinations"],
    )


def relax_preferences(prefs: UserPreferences, to_relax: List[str]) -> UserPreferences:
    """
    Create relaxed preferences by converting hard constraints to soft or removing.
    """
    
    relaxed = copy.deepcopy(prefs)
    
    for pref_name in to_relax:
        if pref_name == "max_stops":
            relaxed.max_stops = None  # Remove hard constraint
            relaxed.prefer_direct = True  # Keep as soft preference
        elif pref_name == "avoided_airlines":
            relaxed.avoided_airlines = []  # Remove
        elif pref_name == "min_star_rating":
            relaxed.min_star_rating = max(3.0, (relaxed.min_star_rating or 4.0) - 1.0)
        elif pref_name == "max_total_hours":
            relaxed.max_total_hours = (relaxed.max_total_hours or 24) * 1.5
        # ... more relaxations
    
    return relaxed
```

---

## Revised Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)

**Focus: Get the mathematical foundation right**

Tasks:
1. [ ] **Two-pass optimization framework** with robust slack (abs + rel)
2. [ ] **Precompute all soft values** before MILP (no sigmoid in model)
3. [ ] **Integer transfer modeling** with floor/ceil
4. [ ] **FlightItinerary edge model** (complete itinerary, not leg)
5. [ ] **Deterministic edge ordering** + safe epsilon computation

Tests:
- [ ] Slack behaves correctly near zero
- [ ] Soft values are pure constants
- [ ] Transfer delivered points are always integer
- [ ] Same inputs → same outputs (determinism)

Deliverable: Core MILP infrastructure that's mathematically sound.

### Phase 2: Flight Path + Time Expansion (Week 2-3)

**Focus: Multi-city temporal feasibility**

Tasks:
1. [ ] **Time-expanded node model** (city, day)
2. [ ] **Path constraints on time-expanded graph**
3. [ ] **Stay segment decomposition** from trip spec
4. [ ] **Flight-segment alignment** (arrival before check-in, etc.)

Tests:
- [ ] Can't depart before arriving
- [ ] Multi-city sequences are valid
- [ ] Stay segments align with flights

Deliverable: Flight path model that handles multi-city correctly.

### Phase 3: Hotel + Group Lodging (Week 3-4)

**Focus: Room allocation, not per-person hotels**

Tasks:
1. [ ] **Stay segment model** with explicit dates
2. [ ] **Hotel option per segment** (not per destination)
3. [ ] **Room allocation constraints** (capacity, counts)
4. [ ] **Traveler-room assignment** for groups
5. [ ] **Hotel cost = Σ rooms × rate × nights**

Tests:
- [ ] Group of 4 doesn't book 4 separate hotels
- [ ] Room capacity is respected
- [ ] Costs are computed correctly

Deliverable: Group lodging that doesn't double-count.

### Phase 4: Three Modes + Balanced Normalization (Week 4-5)

**Focus: Mode-specific objectives, stable scaling**

Tasks:
1. [ ] **OOP mode** objective (single cash term)
2. [ ] **CPP mode** objective (soft thresholds, precomputed)
3. [ ] **Balanced mode** objective (separate K per category)
4. [ ] **User-configurable importance weights**
5. [ ] **Mode-specific pruning strategies**

Tests:
- [ ] OOP uses points aggressively
- [ ] CPP rejects low-value redemptions (softly)
- [ ] Balanced normalization is stable across trip types

Deliverable: Three distinct modes with correct behavior.

### Phase 5: Pruning + Performance (Week 5-6)

**Focus: Make it fast enough for production**

Tasks:
1. [ ] **Pre-ILP pruning** (top K per bucket)
2. [ ] **Solver time limits** + MIP gap
3. [ ] **Heuristic fallback** when ILP times out
4. [ ] **Parallel candidate fetching**
5. [ ] **Performance benchmarks** (target: <5s for typical trip)

Tests:
- [ ] 1000+ candidates → pruned to ~100 → solved in <5s
- [ ] Timeout produces feasible solution
- [ ] Heuristic fallback works

Deliverable: Production-viable performance.

### Phase 6: Feasibility + Preferences (Week 6-7)

**Focus: Handle real-world failures gracefully**

Tasks:
1. [ ] **Status states** (OPTIMAL, FEASIBLE_SUBOPTIMAL, INFEASIBLE_*)
2. [ ] **Infeasibility diagnosis** (which constraint?)
3. [ ] **Preference relaxation strategy**
4. [ ] **User preference system** (hard/soft)
5. [ ] **Booking deadline risk** model

Tests:
- [ ] Strict preferences → relaxed → solution found
- [ ] Missing data → helpful error message
- [ ] Risky transfers → warning or block

Deliverable: Graceful handling of edge cases.

### Phase 7: Explainability + Alternatives (Week 7-8)

**Focus: Users understand WHY**

Tasks:
1. [ ] **Per-edge explanations** (why selected, why payment method)
2. [ ] **Local alternatives** (what else was considered)
3. [ ] **Global next-best** (no-good cut, optional)
4. [ ] **Transfer explanations** (why this path)
5. [ ] **Binding constraint analysis**

Tests:
- [ ] Explanations are human-readable
- [ ] Alternatives are computed correctly
- [ ] No-good cut produces different solution

Deliverable: Explainable optimization.

---

## Summary: V3 Key Principles

1. **Mathematical rigor**: Integer transfers, precomputed values, robust slack
2. **Explicit structures**: Stay segments, time-expanded nodes, room allocation
3. **Stable scaling**: Separate normalization per category, safe epsilon
4. **Production readiness**: Pruning, time limits, fallbacks, status states
5. **User-facing**: Preferences (hard/soft), explainability, alternatives

This plan should survive real users, real inventory, and real edge cases.
