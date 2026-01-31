# Implementation Action Plan (AI Agent Steps)

This document describes the **exact steps I will take** to implement the V3 optimization system.

---

## Execution Strategy

I will implement in **small, testable chunks**:
1. Each step modifies 1-3 files
2. Each step is independently testable
3. I'll run tests after each step before proceeding
4. If tests fail, I'll fix before moving on

---

## Phase 1: Data Models & Precomputation (Steps 1-5)

### Step 1: Add New Data Models

**Files to modify:** `backend/src/optimization/models.py`

**What I'll do:**
```python
# Add these new dataclasses:

@dataclass
class StaySegment:
    """Explicit hotel stay segment with fixed dates."""
    segment_id: int
    city: str
    check_in: date
    check_out: date
    nights: int
    arriving_flight_date: date
    departing_flight_date: date

@dataclass
class FlightItineraryEdge:
    """Complete itinerary as single edge (not per-leg)."""
    edge_key: str
    origin: str
    destination: str
    segments: List[FlightSegment]
    departure_datetime: datetime
    arrival_datetime: datetime
    total_time_minutes: int
    num_stops: int
    # Payment options
    cash_cost: float
    award_options: List[AwardOption]

@dataclass
class AwardOption:
    """Single award booking option with PRECOMPUTED values."""
    program: str
    miles_required: int
    surcharge: float
    raw_value: float
    cpp: float
    # PRECOMPUTED soft values (not computed in MILP)
    soft_value_oop: float
    soft_value_cpp: float
    soft_value_balanced: float

@dataclass 
class TransferPath:
    """Transfer path with integer-safe delivery."""
    from_bank: str
    to_program: str
    min_increment: int
    ratio: float
    current_bonus: float
    effective_delivered_per_block: int  # floor(increment * ratio * bonus)
    max_hours: int
    is_instant: bool

@dataclass
class SlackConfig:
    """Two-pass slack configuration."""
    rel_eps_cash: float = 0.01
    rel_eps_value: float = 0.01
    abs_eps_cash: float = 25.0
    abs_eps_value: float = 25.0
```

**Test:** Import models, instantiate each with sample data.

---

### Step 2: Add Precomputation Functions

**Files to create:** `backend/src/optimization/precompute.py`

**What I'll do:**
```python
# New file with functions to precompute values BEFORE building MILP

def precompute_award_soft_values(
    award_options: List[AwardOption],
    thresholds: Dict[str, float],
    balanced_config: BalancedModeConfig,
) -> List[AwardOption]:
    """
    Precompute soft_value_oop, soft_value_cpp, soft_value_balanced
    for each award option. These become FIXED COEFFICIENTS.
    """
    for opt in award_options:
        # OOP: any positive value
        opt.soft_value_oop = max(0, opt.raw_value)
        
        # CPP: piecewise linear penalty below threshold
        threshold = thresholds.get(opt.program, thresholds["default"])
        if opt.cpp >= threshold:
            opt.soft_value_cpp = opt.raw_value
        elif opt.cpp > 0:
            penalty = 0.2 + 0.8 * (opt.cpp / threshold)
            opt.soft_value_cpp = opt.raw_value * penalty
        else:
            opt.soft_value_cpp = 0.0
        
        # Balanced: time/connection adjusted
        # (requires edge info, passed in separately)
    
    return award_options


def precompute_transfer_effective_increment(tp: TransferPath) -> TransferPath:
    """Compute integer-safe delivered points per block."""
    raw = tp.min_increment * tp.ratio * tp.current_bonus
    tp.effective_delivered_per_block = int(math.floor(raw))
    return tp
```

**Test:** Unit test with known inputs, verify soft values match expected.

---

### Step 3: Add Stay Segment Decomposition

**Files to modify:** `backend/src/optimization/models.py` (add function)

**What I'll do:**
```python
def decompose_trip_to_stay_segments(
    destinations: List[Destination],
    flight_dates: Dict[str, Tuple[date, date]],  # city -> (arrive, depart)
) -> List[StaySegment]:
    """
    Convert destinations + flight dates into explicit stay segments.
    """
    segments = []
    for i, dest in enumerate(destinations):
        arrive, depart = flight_dates[dest.city]
        check_in = arrive
        check_out = depart
        
        segments.append(StaySegment(
            segment_id=i,
            city=dest.city,
            check_in=check_in,
            check_out=check_out,
            nights=(check_out - check_in).days,
            arriving_flight_date=arrive,
            departing_flight_date=depart,
        ))
    return segments
```

**Test:** Sample trip with 2 cities, verify segments have correct dates.

---

### Step 4: Add Room Allocation Models

**Files to modify:** `backend/src/optimization/models.py`

**What I'll do:**
```python
@dataclass
class RoomType:
    room_type_id: str
    hotel_id: str
    capacity: int
    cash_per_night: float
    award_per_night: Optional[int]
    award_program: Optional[str]

@dataclass
class HotelOption:
    segment_id: int
    hotel_id: str
    hotel_name: str
    chain: str
    star_rating: float
    room_types: List[RoomType]
    total_cash_cost: float  # Cheapest room * nights
    award_options: List[HotelAwardOption]
```

**Test:** Create sample hotel with 2 room types, verify capacity math.

---

### Step 5: Add Pruning Configuration

**Files to create:** `backend/src/optimization/pruning.py`

**What I'll do:**
```python
@dataclass
class PruningConfig:
    max_flight_itineraries_per_od: int = 20
    max_hotels_per_segment: int = 15
    max_award_programs_per_edge: int = 3
    max_stops: int = 2
    max_duration_hours: float = 36.0


def prune_flight_candidates(
    flights: List[FlightItineraryEdge],
    config: PruningConfig,
) -> List[FlightItineraryEdge]:
    """Keep top K flights per O-D pair."""
    # Group by (origin, dest, date)
    by_od = defaultdict(list)
    for f in flights:
        if f.num_stops > config.max_stops:
            continue
        if f.total_time_minutes / 60 > config.max_duration_hours:
            continue
        key = (f.origin, f.destination, f.departure_datetime.date())
        by_od[key].append(f)
    
    # Keep top K per group
    pruned = []
    for flights_group in by_od.values():
        scored = sorted(flights_group, key=lambda f: f.cash_cost)
        pruned.extend(scored[:config.max_flight_itineraries_per_od])
    
    return pruned


def prune_hotel_candidates(...):
    """Keep top K hotels per segment."""
    # Similar logic
```

**Test:** 100 flights → verify pruned to ~20 per O-D.

---

## Phase 2: Core MILP Refactor (Steps 6-10)

### Step 6: Create New Solver Module

**Files to create:** `backend/src/optimization/solver_v3.py`

**Why new file:** The existing `points_maximizer.py` is ~1250 lines. Rather than heavily modify it, I'll create a new solver that can be swapped in.

**What I'll do:**
```python
class OptimizationSolverV3:
    """
    V3 solver with:
    - Two-pass optimization
    - Precomputed soft values
    - Integer-safe transfers
    - Stay segments
    """
    
    def __init__(
        self,
        mode: str,  # "oop", "cpp", "balanced"
        config: SolverConfig,
        slack_config: SlackConfig,
    ):
        self.mode = mode
        self.config = config
        self.slack_config = slack_config
    
    def solve(
        self,
        flights: List[FlightItineraryEdge],
        hotels: List[HotelOption],
        stay_segments: List[StaySegment],
        transfers: List[TransferPath],
        balances: Dict[str, int],
        travelers: List[str],
    ) -> OptimizationResult:
        """Main solve method."""
        
        # 1. Prune candidates
        flights = prune_flight_candidates(flights, self.config.pruning)
        hotels = prune_hotel_candidates(hotels, self.config.pruning)
        
        # 2. Precompute soft values
        for f in flights:
            for opt in f.award_options:
                precompute_award_soft_values(opt, ...)
        
        # 3. Build MILP
        model = self._build_model(flights, hotels, stay_segments, transfers, balances, travelers)
        
        # 4. Two-pass solve
        return self._solve_two_pass(model)
```

**Test:** Instantiate solver, verify it initializes without error.

---

### Step 7: Implement Two-Pass Solve with Robust Slack

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**
```python
def _solve_two_pass(self, model: LpProblem) -> OptimizationResult:
    """Two-pass lexicographic optimization."""
    
    # Pass 1: Primary objective
    primary_obj = self._build_primary_objective()
    
    if self.mode == "oop":
        model.setObjective(primary_obj, sense=LpMinimize)
    else:
        model.setObjective(primary_obj, sense=LpMaximize)
    
    model.solve(self._get_solver())
    
    if model.status != LpStatusOptimal:
        return self._handle_infeasibility(model)
    
    opt_primary = value(primary_obj)
    
    # Compute robust slack: max(absolute, relative * opt)
    if self.mode == "oop":
        slack = max(
            self.slack_config.abs_eps_cash,
            self.slack_config.rel_eps_cash * abs(opt_primary)
        )
        model += primary_obj <= opt_primary + slack, "pass1_bound"
    else:
        slack = max(
            self.slack_config.abs_eps_value,
            self.slack_config.rel_eps_value * abs(opt_primary)
        )
        model += primary_obj >= opt_primary - slack, "pass1_bound"
    
    # Pass 2: Secondary objective
    secondary_obj = self._build_secondary_objective(opt_primary, slack)
    model.setObjective(secondary_obj, sense=LpMinimize)
    model.solve(self._get_solver())
    
    return self._extract_solution(model)
```

**Test:** Mock model, verify slack is computed correctly for opt=0 and opt=1000.

---

### Step 8: Implement Safe Epsilon Tie-Breaking

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**
```python
def _compute_safe_epsilon(self, primary_slack: float, n_edges: int) -> float:
    """
    Compute epsilon that won't affect primary objective.
    
    Total tie-break = Σ(i * eps) for i in 0..n-1 = eps * n*(n-1)/2
    We want: total < 1e-6 * primary_slack
    """
    if n_edges <= 1:
        return 1e-10
    
    max_sum = n_edges * (n_edges - 1) / 2
    safe_eps = (1e-6 * abs(primary_slack)) / max_sum
    
    return max(1e-15, min(1e-6, safe_eps))


def _build_secondary_objective(self, opt_primary: float, slack: float):
    """Build secondary with safe tie-breaker."""
    
    n_edges = len(self.x_flight) + len(self.x_hotel)
    safe_eps = self._compute_safe_epsilon(slack, n_edges)
    
    # Sort edges deterministically
    all_edges = sorted(list(self.x_flight.keys()) + list(self.x_hotel.keys()))
    
    # Tie-breaker: earlier edge index = slightly preferred
    tie_breaker = lpSum(
        self.x[e] * (i * safe_eps)
        for i, e in enumerate(all_edges)
    )
    
    # Time/segment preferences
    secondary = (
        lpSum(self.x_flight[e] * self.costs["time"][e] for e in self.x_flight) +
        tie_breaker
    )
    
    return secondary
```

**Test:** Verify same input always produces same output (determinism).

---

### Step 9: Implement Integer-Safe Transfer Constraints

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**
```python
def _add_transfer_constraints(self):
    """Add transfer constraints with integer delivery."""
    
    for tp in self.transfers:
        s, prog = tp.from_bank, tp.to_program
        
        # Miles used from this source->program
        miles_used = lpSum(
            self.y_points[(s, prog)][e] * self.award_miles[e]
            for e in self.edges_using_program(prog)
        )
        
        # Delivered = blocks * effective_delivered_per_block (INTEGER!)
        # Constraint: miles_used <= blocks * effective_delivered_per_block
        self.model += (
            miles_used <= self.t_blocks[s][prog] * tp.effective_delivered_per_block
        ), f"transfer_int_{s}_{prog}"
    
    # Source balance: blocks * increment <= balance
    for source in self.sources:
        bank_used = lpSum(
            self.t_blocks[source][tp.to_program] * tp.min_increment
            for tp in self.transfers if tp.from_bank == source
        )
        self.model += bank_used <= self.balances[source], f"balance_{source}"
```

**Test:** Transfer with ratio=0.75, bonus=1.25 → verify delivered is 937 not 937.5.

---

### Step 10: Implement Stay Segment Constraints

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**
```python
def _add_hotel_segment_constraints(self):
    """Add hotel constraints using explicit stay segments."""
    
    for segment in self.stay_segments:
        # Exactly one hotel per segment
        self.model += lpSum(
            self.x_hotel[segment.segment_id][h.hotel_id]
            for h in segment.hotel_options
        ) == 1, f"one_hotel_seg_{segment.segment_id}"
    
    # NOTE: No date inequality constraints!
    # Continuity is by construction (segment order).


def _add_room_allocation_constraints(self):
    """Add room allocation for groups."""
    
    num_travelers = len(self.travelers)
    
    for segment in self.stay_segments:
        for hotel in segment.hotel_options:
            h_id = hotel.hotel_id
            
            # Total capacity
            capacity = lpSum(
                self.n_rooms[segment.segment_id][h_id][rt.room_type_id] * rt.capacity
                for rt in hotel.room_types
            )
            
            # Capacity >= travelers if hotel selected
            self.model += (
                capacity >= num_travelers * self.x_hotel[segment.segment_id][h_id]
            ), f"room_cap_{segment.segment_id}_{h_id}"
            
            # Rooms only if hotel selected
            for rt in hotel.room_types:
                self.model += (
                    self.n_rooms[segment.segment_id][h_id][rt.room_type_id] 
                    <= num_travelers * self.x_hotel[segment.segment_id][h_id]
                ), f"room_sel_{segment.segment_id}_{h_id}_{rt.room_type_id}"
```

**Test:** Group of 4, room capacity 2 → verify 2 rooms selected.

---

## Phase 3: Mode-Specific Objectives (Steps 11-14)

### Step 11: Implement OOP Mode Objective

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**
```python
def _build_oop_objective(self):
    """
    OOP: Minimize out-of-pocket cash.
    
    Cash = Σ(cash_cost * z_cash) + Σ(surcharge * y_points)
    """
    
    flight_cash = lpSum(
        self.z_cash_flight[e] * f.cash_cost + 
        lpSum(
            self.y_points[(s, prog)][e] * opt.surcharge
            for (s, prog), opt in f.award_options_by_path.items()
        )
        for e, f in self.flights_by_edge.items()
    )
    
    hotel_cash = lpSum(
        self.z_cash_hotel[seg][h] * hotel.total_cash_cost +
        lpSum(
            self.y_points_hotel[(s, prog)][seg][h] * opt.surcharge
            for (s, prog), opt in hotel.award_options_by_path.items()
        )
        for seg in self.stay_segments
        for h, hotel in seg.hotels_by_id.items()
    )
    
    return flight_cash + hotel_cash
```

**Test:** Trip with cash=$1000, award+surcharge=$100 → OOP selects award.

---

### Step 12: Implement CPP Mode Objective

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**
```python
def _build_cpp_objective(self):
    """
    CPP: Maximize redemption value using PRECOMPUTED soft values.
    
    The soft_value_cpp is already computed per award option.
    It's a CONSTANT (float), not a variable.
    """
    
    flight_value = lpSum(
        self.y_points[(s, prog)][e] * opt.soft_value_cpp  # Constant!
        for e, f in self.flights_by_edge.items()
        for (s, prog), opt in f.award_options_by_path.items()
    )
    
    hotel_value = lpSum(
        self.y_points_hotel[(s, prog)][seg][h] * opt.soft_value_cpp
        for seg in self.stay_segments
        for h, hotel in seg.hotels_by_id.items()
        for (s, prog), opt in hotel.award_options_by_path.items()
    )
    
    return flight_value + hotel_value
```

**Test:** Award at 0.5 cpp (threshold 1.5) → verify soft value is ~33% of raw.

---

### Step 13: Implement Balanced Mode Objective

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**
```python
def _build_balanced_objective(self):
    """
    Balanced: Combine flight + hotel value with SEPARATE normalization.
    
    1. Normalize flights by K_flight
    2. Normalize hotels by K_hotel
    3. Apply importance weights
    4. Sum
    """
    
    # Compute K values (robust median of positive values)
    K_flight = self._compute_robust_median([
        opt.soft_value_balanced for f in self.flights 
        for opt in f.award_options if opt.soft_value_balanced > 0
    ])
    
    K_hotel = self._compute_robust_median([
        opt.soft_value_balanced for h in self.hotels
        for opt in h.award_options if opt.soft_value_balanced > 0
    ])
    
    # Normalize separately
    flight_utility = lpSum(
        self.y_points[(s, prog)][e] * (opt.soft_value_balanced / K_flight) * self.config.flight_importance
        for e, f in self.flights_by_edge.items()
        for (s, prog), opt in f.award_options_by_path.items()
    )
    
    hotel_utility = lpSum(
        self.y_points_hotel[(s, prog)][seg][h] * (opt.soft_value_balanced / K_hotel) * self.config.hotel_importance
        for seg in self.stay_segments
        for h, hotel in seg.hotels_by_id.items()
        for (s, prog), opt in hotel.award_options_by_path.items()
    )
    
    return flight_utility + hotel_utility


def _compute_robust_median(self, values: List[float]) -> float:
    """Trimmed median with outlier removal."""
    if len(values) < 5:
        return self.config.default_density_prior
    
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    low = int(n * 0.1)
    high = int(n * 0.9)
    trimmed = sorted_vals[low:high]
    
    return trimmed[len(trimmed) // 2] if trimmed else sorted_vals[n // 2]
```

**Test:** Flights with median $500, hotels with median $200 → verify both contribute proportionally.

---

### Step 14: Add Mode Selection and API

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**
```python
def _build_primary_objective(self):
    """Build objective based on mode."""
    
    if self.mode == "oop":
        return self._build_oop_objective()
    elif self.mode == "cpp":
        return self._build_cpp_objective()
    elif self.mode == "balanced":
        return self._build_balanced_objective()
    else:
        raise ValueError(f"Unknown mode: {self.mode}")


# Public API
def optimize_trip(
    trip_request: TripRequest,
    mode: str = "balanced",
    config: Optional[SolverConfig] = None,
) -> OptimizationResult:
    """
    Main entry point for V3 optimization.
    
    Args:
        trip_request: Full trip specification
        mode: "oop", "cpp", or "balanced"
        config: Optional solver configuration
    
    Returns:
        OptimizationResult with solution, status, and explanation
    """
    
    solver = OptimizationSolverV3(mode=mode, config=config or SolverConfig())
    
    # Fetch and prepare data
    flights = fetch_flights(trip_request)
    hotels = fetch_hotels(trip_request)
    segments = decompose_trip_to_stay_segments(trip_request.destinations, ...)
    transfers = build_transfer_paths(trip_request.points_balances)
    
    return solver.solve(
        flights=flights,
        hotels=hotels,
        stay_segments=segments,
        transfers=transfers,
        balances=trip_request.points_balances,
        travelers=trip_request.travelers,
    )
```

**Test:** Call `optimize_trip` with each mode, verify different results.

---

## Phase 4: Feasibility & Diagnostics (Steps 15-18)

### Step 15: Add Status Enum and Result Types

**Files to modify:** `backend/src/optimization/models.py`

**What I'll do:**
```python
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
    solution: Optional[Solution]
    
    # Diagnostics
    solve_time_seconds: float
    num_variables: int
    num_constraints: int
    
    # User-facing
    warnings: List[str]
    relaxations_applied: List[str]
    suggestions: List[str]
    
    # For infeasible
    infeasibility_reason: Optional[str]
    missing_data: List[str]
```

**Test:** Verify all status values serialize correctly.

---

### Step 16: Add Infeasibility Diagnosis

**Files to create:** `backend/src/optimization/diagnosis.py`

**What I'll do:**
```python
def diagnose_infeasibility(
    model: LpProblem,
    variables: Dict,
    preferences: UserPreferences,
) -> InfeasibilityDiagnosis:
    """
    Diagnose why model is infeasible.
    
    Strategy: Test progressively relaxed models.
    """
    
    # Check 1: Any flights at all?
    if not variables["x_flight"]:
        return InfeasibilityDiagnosis(
            cause="data",
            reason="No flight options available",
            suggestions=["Expand search dates or airports"],
        )
    
    # Check 2: Any hotels at all?
    if not variables["x_hotel"]:
        return InfeasibilityDiagnosis(
            cause="data",
            reason="No hotel options available",
            suggestions=["Expand hotel search area"],
        )
    
    # Check 3: Test without preferences
    model_no_prefs = build_model_no_preferences(variables)
    if model_no_prefs.solve() == LpStatusOptimal:
        # Preferences are blocking
        blocking = find_blocking_preferences(model, preferences)
        return InfeasibilityDiagnosis(
            cause="preferences",
            reason=f"Preferences too restrictive: {blocking}",
            blocking_preferences=blocking,
            suggestions=[f"Consider relaxing: {p}" for p in blocking],
        )
    
    # Check 4: Test cash-only (no transfers)
    model_cash = build_model_cash_only(variables)
    if model_cash.solve() == LpStatusOptimal:
        return InfeasibilityDiagnosis(
            cause="transfers",
            reason="Transfer constraints prevent points usage",
            suggestions=["Check transfer configuration"],
        )
    
    return InfeasibilityDiagnosis(
        cause="unknown",
        reason="Could not determine cause",
        suggestions=["Try different dates or destinations"],
    )
```

**Test:** Create intentionally infeasible model, verify correct diagnosis.

---

### Step 17: Add Preference Relaxation

**Files to create:** `backend/src/optimization/relaxation.py`

**What I'll do:**
```python
def relax_preferences(
    prefs: UserPreferences,
    to_relax: List[str],
) -> UserPreferences:
    """
    Create relaxed copy of preferences.
    
    Converts hard constraints to soft, or removes entirely.
    """
    
    relaxed = copy.deepcopy(prefs)
    
    for pref_name in to_relax:
        if pref_name == "max_stops":
            relaxed.max_stops = None  # Remove hard limit
            relaxed.prefer_direct = True  # Keep as soft
        
        elif pref_name == "avoided_airlines":
            relaxed.avoided_airlines = []
        
        elif pref_name == "min_star_rating":
            if relaxed.min_star_rating:
                relaxed.min_star_rating = max(3.0, relaxed.min_star_rating - 1.0)
        
        elif pref_name == "max_layover_hours":
            if relaxed.max_layover_hours:
                relaxed.max_layover_hours *= 1.5
    
    return relaxed


def solve_with_relaxation_cascade(
    model_builder,
    preferences: UserPreferences,
    solver_config: SolverConfig,
) -> OptimizationResult:
    """
    Try solving with progressive preference relaxation.
    """
    
    # Attempt 1: Full preferences
    model = model_builder(preferences)
    result = solve_with_limits(model, solver_config)
    
    if result.status == "OPTIMAL":
        return result
    
    # Attempt 2: Diagnose and relax
    diagnosis = diagnose_infeasibility(model, ...)
    
    if diagnosis.cause == "preferences":
        relaxed_prefs = relax_preferences(preferences, diagnosis.blocking_preferences)
        model_relaxed = model_builder(relaxed_prefs)
        result_relaxed = solve_with_limits(model_relaxed, solver_config)
        
        if result_relaxed.status == "OPTIMAL":
            result_relaxed.warnings.append(
                f"Relaxed preferences: {diagnosis.blocking_preferences}"
            )
            result_relaxed.relaxations_applied = diagnosis.blocking_preferences
            return result_relaxed
    
    # Return failure with diagnosis
    return OptimizationResult(
        status=OptimizationStatus.INFEASIBLE_PREFERENCES,
        solution=None,
        infeasibility_reason=diagnosis.reason,
        suggestions=diagnosis.suggestions,
    )
```

**Test:** Strict preferences (direct flights only) with no directs available → verify relaxation finds solution.

---

### Step 18: Add Solver Time Limits and Fallback

**Files to modify:** `backend/src/optimization/solver_v3.py`

**What I'll do:**
```python
@dataclass
class SolverConfig:
    time_limit_seconds: float = 30.0
    mip_gap: float = 0.01  # 1% gap acceptable
    threads: int = 4
    enable_heuristic_fallback: bool = True


def _get_solver(self):
    """Get PuLP solver with time limits."""
    
    return PULP_CBC_CMD(
        msg=False,
        timeLimit=self.config.time_limit_seconds,
        gapRel=self.config.mip_gap,
        threads=self.config.threads,
    )


def _solve_with_timeout_handling(self, model: LpProblem) -> SolveResult:
    """Solve with timeout handling."""
    
    status = model.solve(self._get_solver())
    
    if status == LpStatusOptimal:
        return SolveResult(status="OPTIMAL", solution=self._extract_solution(model))
    
    # Check if we have a feasible (but not proven optimal) solution
    if model.sol_status == 1:  # Feasible
        return SolveResult(
            status="FEASIBLE_SUBOPTIMAL",
            solution=self._extract_solution(model),
            warning="Time limit reached",
        )
    
    # No feasible solution found
    if self.config.enable_heuristic_fallback:
        return self._run_heuristic_fallback()
    
    return SolveResult(status="INFEASIBLE", solution=None)
```

**Test:** Set time_limit=0.1s on complex model → verify timeout handling.

---

## Phase 5: Explainability (Steps 19-21)

### Step 19: Add Local Alternatives Computation

**Files to create:** `backend/src/optimization/explainability.py`

**What I'll do:**
```python
def compute_local_alternatives(
    solution: Solution,
    all_edges: Dict,
    mode: str,
) -> Dict[str, LocalAlternative]:
    """
    For each selected edge, find alternatives in same bucket.
    """
    
    alternatives = {}
    
    for selected in solution.selected_edges:
        # Find same bucket (same O-D, same date range)
        bucket = get_bucket(selected)
        other_options = [
            e for e in all_edges.values()
            if get_bucket(e) == bucket and e.edge_key != selected.edge_key
        ]
        
        if not other_options:
            alternatives[selected.edge_key] = LocalAlternative(
                selected=selected,
                next_best=None,
                reason="Only available option",
            )
            continue
        
        # Sort by mode-relevant metric
        if mode == "oop":
            other_options.sort(key=lambda e: e.cash_cost)
        elif mode == "cpp":
            other_options.sort(key=lambda e: -e.best_cpp)
        else:
            other_options.sort(key=lambda e: -e.balanced_utility)
        
        next_best = other_options[0]
        
        alternatives[selected.edge_key] = LocalAlternative(
            selected=selected,
            next_best=next_best,
            difference=compute_difference(selected, next_best, mode),
            reason=explain_why_selected(selected, next_best, mode),
        )
    
    return alternatives
```

**Test:** Solution with 2 flights selected → verify alternatives computed for each.

---

### Step 20: Add Global Next-Best (No-Good Cut)

**Files to modify:** `backend/src/optimization/explainability.py`

**What I'll do:**
```python
def compute_global_next_best(
    model: LpProblem,
    solution: Solution,
    variables: Dict,
    solver_config: SolverConfig,
) -> Optional[Solution]:
    """
    Compute globally next-best solution using no-good cut.
    
    This is EXPENSIVE - only run if explicitly requested.
    """
    
    # Clone model
    model_copy = model.copy()
    
    # Add no-good cut: exclude current solution
    # Σ x[selected] <= k - 1
    selected_vars = [
        variables["x"][e.edge_key] for e in solution.selected_edges
    ]
    k = len(selected_vars)
    
    model_copy += lpSum(selected_vars) <= k - 1, "no_good_cut"
    
    # Solve again
    status = model_copy.solve(PULP_CBC_CMD(
        msg=False,
        timeLimit=solver_config.time_limit_seconds / 2,  # Half time for second solve
    ))
    
    if status == LpStatusOptimal:
        next_solution = extract_solution(model_copy, variables)
        return next_solution
    
    return None  # No alternative found
```

**Test:** Verify second solution differs from first by at least one edge.

---

### Step 21: Add Solution Explanation Builder

**Files to modify:** `backend/src/optimization/explainability.py`

**What I'll do:**
```python
@dataclass
class SolutionExplanation:
    """Human-readable explanation of the solution."""
    
    summary: str
    mode_explanation: str
    
    flight_explanations: List[FlightExplanation]
    hotel_explanations: List[HotelExplanation]
    transfer_explanations: List[TransferExplanation]
    
    alternatives: Dict[str, LocalAlternative]
    global_next_best: Optional[Solution]
    
    binding_constraints: List[str]
    warnings: List[str]


def build_solution_explanation(
    solution: Solution,
    model: LpProblem,
    mode: str,
    compute_global_alt: bool = False,
) -> SolutionExplanation:
    """Build complete explanation for solution."""
    
    flight_expl = [
        FlightExplanation(
            flight=f,
            payment_method=solution.payment_methods[f.edge_key],
            why_selected=explain_flight_selection(f, solution, mode),
            why_payment=explain_payment_choice(f, solution),
            value_captured=compute_value_captured(f, solution),
        )
        for f in solution.selected_flights
    ]
    
    hotel_expl = [
        HotelExplanation(
            hotel=h,
            segment=h.segment,
            rooms_booked=solution.rooms[h.hotel_id],
            payment_method=solution.payment_methods[h.edge_key],
            why_selected=explain_hotel_selection(h, solution, mode),
        )
        for h in solution.selected_hotels
    ]
    
    transfer_expl = [
        TransferExplanation(
            transfer=t,
            points_transferred=solution.transfers[t.key],
            why_used=explain_transfer_choice(t, solution),
        )
        for t in solution.active_transfers
    ]
    
    alternatives = compute_local_alternatives(solution, all_edges, mode)
    
    global_alt = None
    if compute_global_alt:
        global_alt = compute_global_next_best(model, solution, variables, config)
    
    return SolutionExplanation(
        summary=f"Total: ${solution.total_cash:.0f} cash, {solution.total_points:,} points",
        mode_explanation=get_mode_explanation(mode),
        flight_explanations=flight_expl,
        hotel_explanations=hotel_expl,
        transfer_explanations=transfer_expl,
        alternatives=alternatives,
        global_next_best=global_alt,
        binding_constraints=find_binding_constraints(model),
        warnings=solution.warnings,
    )
```

**Test:** Full solution → verify explanation is complete and readable.

---

## Phase 6: Integration (Steps 22-24)

### Step 22: Add Route Handler

**Files to modify:** `backend/src/routes/optimize.py`

**What I'll do:**
```python
from ..optimization.solver_v3 import optimize_trip, OptimizationStatus

@router.post("/v3/optimize")
async def optimize_trip_v3(
    request: TripOptimizationRequest,
    mode: str = Query(default="balanced", enum=["oop", "cpp", "balanced"]),
    include_alternatives: bool = Query(default=False),
):
    """
    V3 trip optimization endpoint.
    
    Supports three modes:
    - oop: Minimize out-of-pocket cash
    - cpp: Maximize redemption value (cents per point)
    - balanced: Balance value, time, and convenience
    """
    
    result = optimize_trip(
        trip_request=request.to_trip_request(),
        mode=mode,
        config=SolverConfig(
            include_global_alternatives=include_alternatives,
        ),
    )
    
    if result.status == OptimizationStatus.OPTIMAL:
        return {
            "status": "success",
            "solution": result.solution.to_dict(),
            "explanation": result.explanation.to_dict() if result.explanation else None,
        }
    
    elif result.status == OptimizationStatus.FEASIBLE_SUBOPTIMAL:
        return {
            "status": "success",
            "solution": result.solution.to_dict(),
            "warnings": result.warnings,
        }
    
    else:
        return {
            "status": "failed",
            "reason": result.infeasibility_reason,
            "suggestions": result.suggestions,
        }
```

**Test:** API test with sample request → verify response format.

---

### Step 23: Add Migration Path from V2

**Files to modify:** `backend/src/handlers/points_maximizer.py`

**What I'll do:**
```python
# Add flag to switch between V2 and V3

def run_optimization(
    request: OptimizationRequest,
    use_v3: bool = False,  # Feature flag
):
    """
    Run optimization, with flag to use V3 solver.
    """
    
    if use_v3:
        from ..optimization.solver_v3 import optimize_trip
        return optimize_trip(
            trip_request=request.to_trip_request(),
            mode=request.mode or "balanced",
        )
    
    # Existing V2 logic
    return _run_v2_optimization(request)
```

**Test:** Verify V2 still works, V3 can be enabled with flag.

---

### Step 24: Add Integration Tests

**Files to create:** `backend/tests/test_solver_v3.py`

**What I'll do:**
```python
import pytest
from src.optimization.solver_v3 import OptimizationSolverV3, optimize_trip
from src.optimization.models import *


class TestSolverV3:
    """Integration tests for V3 solver."""
    
    def test_oop_mode_prefers_awards(self):
        """OOP should use awards when they save cash."""
        trip = make_sample_trip()
        result = optimize_trip(trip, mode="oop")
        
        assert result.status == OptimizationStatus.OPTIMAL
        assert result.solution.total_cash < trip.cash_only_cost
        assert result.solution.total_points > 0
    
    def test_cpp_mode_rejects_low_value(self):
        """CPP should reject awards below threshold."""
        trip = make_trip_with_low_cpp_awards()
        result = optimize_trip(trip, mode="cpp")
        
        # Should pay cash rather than use 0.5 cpp awards
        assert result.solution.total_points == 0
    
    def test_balanced_mode_normalizes(self):
        """Balanced should handle flights and hotels proportionally."""
        trip = make_mixed_trip()
        result = optimize_trip(trip, mode="balanced")
        
        # Both flights and hotels should be optimized
        assert result.solution.flight_value > 0 or result.solution.hotel_value > 0
    
    def test_integer_transfers(self):
        """Transfer delivered points must be integers."""
        trip = make_trip_with_fractional_transfer()
        result = optimize_trip(trip, mode="oop")
        
        for t in result.solution.transfers:
            assert t.delivered_points == int(t.delivered_points)
    
    def test_group_room_allocation(self):
        """Group trips should allocate rooms correctly."""
        trip = make_group_trip(num_travelers=4)
        result = optimize_trip(trip, mode="balanced")
        
        # Should not book 4 separate hotels
        total_rooms = sum(r.count for r in result.solution.rooms)
        assert total_rooms >= 2  # At least 2 rooms for 4 people
        assert total_rooms <= 4  # At most 1 per person
    
    def test_infeasibility_diagnosis(self):
        """Infeasible trips should return helpful diagnosis."""
        trip = make_impossible_trip()
        result = optimize_trip(trip, mode="oop")
        
        assert result.status != OptimizationStatus.OPTIMAL
        assert result.infeasibility_reason is not None
        assert len(result.suggestions) > 0
    
    def test_determinism(self):
        """Same input should always produce same output."""
        trip = make_sample_trip()
        
        result1 = optimize_trip(trip, mode="balanced")
        result2 = optimize_trip(trip, mode="balanced")
        
        assert result1.solution.selected_edges == result2.solution.selected_edges
```

**Test:** Run full test suite, verify all pass.

---

## Execution Summary

**Total Steps:** 24  
**Estimated Files Modified:** ~15  
**Estimated Files Created:** ~5  
**New Lines of Code:** ~2,500-3,000

**Order of Execution:**

```
Phase 1 (Data Models)     → Steps 1-5   → Test data structures
Phase 2 (Core MILP)       → Steps 6-10  → Test solver mechanics
Phase 3 (Mode Objectives) → Steps 11-14 → Test each mode
Phase 4 (Feasibility)     → Steps 15-18 → Test error handling
Phase 5 (Explainability)  → Steps 19-21 → Test explanations
Phase 6 (Integration)     → Steps 22-24 → Test end-to-end
```

**I will proceed step-by-step, testing after each, and not move forward until tests pass.**

---

Ready to start? I'll begin with **Step 1: Add New Data Models**.
