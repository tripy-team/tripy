# Three Optimization Modes: Implementation Plan V2

**Revision Notes:** This plan incorporates critical feedback addressing:
- Objective function double-counting and weight magnitude issues
- CPP threshold brittleness
- Normalization robustness
- Edge granularity (itinerary vs leg)
- Hotel per-night modeling
- Transfer modeling precision
- Solver determinism and tie-breaking
- User preference knobs
- Explainability layer

---

## Table of Contents

1. [Revised Architecture Overview](#revised-architecture-overview)
2. [Fixing the Objective Function](#fixing-the-objective-function)
3. [Soft Thresholds for CPP Mode](#soft-thresholds-for-cpp-mode)
4. [Robust Normalization for Balanced Mode](#robust-normalization-for-balanced-mode)
5. [Edge Granularity: Itinerary vs Leg](#edge-granularity-itinerary-vs-leg)
6. [Hotel Modeling: Per-Night Constraints](#hotel-modeling-per-night-constraints)
7. [Transfer Modeling Refinements](#transfer-modeling-refinements)
8. [Determinism and Tie-Breaking](#determinism-and-tie-breaking)
9. [User Preference Knobs](#user-preference-knobs)
10. [Explainability Layer](#explainability-layer)
11. [Testing Strategy (Revised)](#testing-strategy-revised)
12. [Implementation Phases (Revised)](#implementation-phases-revised)

---

## Revised Architecture Overview

### Key Changes from V1

| Issue | V1 Approach | V2 Approach |
|-------|-------------|-------------|
| Objective mixing | Single weighted sum with 1e8 weights | **Two-pass optimization** or normalized weights |
| CPP thresholds | Hard cutoff (cpp > 1.2) | **Soft penalty + fallback** |
| Weight magnitudes | 1e8, 1e7, 1e6 | **Normalized to [0, 100]** |
| Flight/hotel comparison | Fixed 10h = 5 nights | **User-configurable knobs** |
| Edge definition | Ambiguous | **Explicitly per-itinerary-option** |
| Hotel selection | One per destination | **Per-night with date alignment** |
| Tie-breaking | None | **Deterministic lexicographic** |
| Explainability | None | **First-class output** |

### Revised Model Structure

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         UNIFIED ILP MODEL (V2)                                  │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                      PHASE 1: PRIMARY OBJECTIVE                           │ │
│  │                                                                           │ │
│  │   OOP Mode:     Minimize total_cash                                      │ │
│  │   CPP Mode:     Maximize soft_value (with penalty below threshold)       │ │
│  │   Balanced:     Maximize normalized_utility                              │ │
│  │                                                                           │ │
│  │   Subject to: All constraints (path, payment, transfer, hotel, etc.)     │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                            │
│                                    ▼                                            │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                      PHASE 2: TIE-BREAKING                                │ │
│  │                                                                           │ │
│  │   Fix primary objective at optimal value (with small slack ε)            │ │
│  │   Then optimize secondary criteria:                                       │ │
│  │     - Minimize total travel time                                         │ │
│  │     - Minimize number of segments                                        │ │
│  │     - Prefer earlier departures                                          │ │
│  │     - Prefer higher-quality airlines/hotels                              │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                            │
│                                    ▼                                            │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                      EXPLAINABILITY EXTRACTION                            │ │
│  │                                                                           │ │
│  │   For each selected edge:                                                 │ │
│  │     - Why points vs cash                                                 │ │
│  │     - CPP achieved                                                        │ │
│  │     - Which constraints were binding                                      │ │
│  │     - Alternatives considered                                             │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Fixing the Objective Function

### Problem: Double-Counting and Weight Scale

**V1 (Problematic):**
```python
# WRONG: Double-counts surcharges, uses huge weights
Maximize:
    10^8 × Σ (cash - surcharge) × y_points    # Surcharge subtracted here
  - 10^7 × (Σ cash × z_cash + Σ surcharge × y_points)  # Surcharge ALSO here!
  - 10^6 × time
```

Issues:
- Surcharges penalized twice (once in value, once in total_cash)
- Weight magnitudes (1e8) cause numerical instability in CBC
- Single objective conflates multiple goals

### Solution: Two-Pass Lexicographic Optimization

**Pass 1:** Optimize primary objective
**Pass 2:** Among solutions within ε of optimal, optimize secondary criteria

```python
def solve_two_pass(model, mode, variables, costs, epsilon=0.01):
    """
    Two-pass lexicographic optimization for stable, deterministic solutions.
    
    Pass 1: Optimize mode-specific primary objective
    Pass 2: Fix primary at optimal (with slack), optimize tie-breakers
    """
    
    # ════════════════════════════════════════════════════════════════════
    # PASS 1: PRIMARY OBJECTIVE
    # ════════════════════════════════════════════════════════════════════
    
    if mode == "oop":
        # OOP: Minimize out-of-pocket cash
        # Single coherent cash term: all cash paid (bookings + surcharges)
        primary_obj = lpSum(
            z_cash[e] * cash_cost[e] for e in edges  # Cash bookings
        ) + lpSum(
            y_points[e] * surcharge[e] for e in edges  # Award surcharges
        )
        model.setObjective(primary_obj, sense=LpMinimize)
        
    elif mode == "cpp":
        # CPP: Maximize soft value (see next section for soft thresholds)
        primary_obj = lpSum(
            y_points[e] * soft_value(e) for e in edges
        )
        model.setObjective(primary_obj, sense=LpMaximize)
        
    elif mode == "balanced":
        # Balanced: Maximize normalized utility
        primary_obj = lpSum(
            y_points[e] * normalized_score(e) for e in edges
        )
        model.setObjective(primary_obj, sense=LpMaximize)
    
    # Solve Pass 1
    model.solve()
    opt_primary = model.objective.value()
    
    # ════════════════════════════════════════════════════════════════════
    # PASS 2: TIE-BREAKING (fix primary, optimize secondary)
    # ════════════════════════════════════════════════════════════════════
    
    # Fix primary objective at optimal (with small slack for numerical stability)
    if mode == "oop":
        # Allow up to ε% more cash
        model.addConstraint(primary_obj <= opt_primary * (1 + epsilon))
    else:
        # Allow up to ε% less value
        model.addConstraint(primary_obj >= opt_primary * (1 - epsilon))
    
    # Secondary objective: prefer shorter trips, fewer segments, earlier departures
    secondary_obj = (
        1.0 * lpSum(x[e] * time_cost[e] for e in edges)           # Minimize time
      + 10.0 * lpSum(x[e] * num_segments[e] for e in edges)       # Minimize segments
      + 0.1 * lpSum(x[e] * departure_minutes[e] for e in edges)   # Prefer earlier
      - 0.5 * lpSum(x[e] * quality_score[e] for e in edges)       # Prefer quality
    )
    model.setObjective(secondary_obj, sense=LpMinimize)
    
    # Solve Pass 2
    model.solve()
    
    return extract_solution(model, variables)
```

### Alternative: Normalized Single-Pass with Bounded Weights

If two-pass is too slow, use normalized weights within [0, 100]:

```python
def build_normalized_objective(mode, variables, costs):
    """
    Single-pass objective with normalized weights.
    All coefficients bounded to [0, 100] range.
    """
    
    # ════════════════════════════════════════════════════════════════════
    # NORMALIZE ALL VALUES TO [0, 1] RANGE
    # ════════════════════════════════════════════════════════════════════
    
    # Cash costs: normalize by max reasonable trip cost
    MAX_TRIP_CASH = 10000.0  # $10K max expected
    norm_cash = {e: min(1.0, cash_cost[e] / MAX_TRIP_CASH) for e in edges}
    
    # Value (cash saved): normalize similarly
    norm_value = {e: min(1.0, max(0, value[e]) / MAX_TRIP_CASH) for e in edges}
    
    # Time: normalize by max reasonable trip time
    MAX_TRIP_HOURS = 48.0  # 48 hours max
    norm_time = {e: min(1.0, time_cost[e] / 60 / MAX_TRIP_HOURS) for e in edges}
    
    # Segments: normalize by max segments
    MAX_SEGMENTS = 6
    norm_segments = {e: min(1.0, num_segments[e] / MAX_SEGMENTS) for e in edges}
    
    # ════════════════════════════════════════════════════════════════════
    # WEIGHTS: ALL IN [1, 100] RANGE
    # ════════════════════════════════════════════════════════════════════
    
    if mode == "oop":
        W = {"value": 100, "cash": 80, "time": 5, "segments": 20}
    elif mode == "cpp":
        W = {"value": 100, "cash": 30, "time": 20, "segments": 40}
    elif mode == "balanced":
        W = {"value": 100, "cash": 50, "time": 40, "segments": 40}
    
    # ════════════════════════════════════════════════════════════════════
    # OBJECTIVE: Maximize value, minimize everything else
    # ════════════════════════════════════════════════════════════════════
    
    # Note: NO double-counting. Cash term only counts what's actually paid.
    obj = (
        W["value"] * lpSum(y_points[e] * norm_value[e] for e in edges)
      - W["cash"] * lpSum(z_cash[e] * norm_cash[e] + y_points[e] * norm_surcharge[e] for e in edges)
      - W["time"] * lpSum(x[e] * norm_time[e] for e in edges)
      - W["segments"] * lpSum(x[e] * norm_segments[e] for e in edges)
    )
    
    return obj
```

---

## Soft Thresholds for CPP Mode

### Problem: Hard Thresholds Cause Infeasibility

**V1 (Problematic):**
```python
# WRONG: Hard filter can eliminate all award options
if cpp < 1.2:
    exclude from objective  # What if ALL awards are 1.1 cpp?
```

This causes:
- Infeasibility if no awards meet threshold
- Discontinuity: 1.19 cpp worthless, 1.20 cpp valuable
- Forces all-cash when 1.1 cpp would still be a good choice

### Solution: Soft Penalty Function

```python
def compute_soft_value(edge, airline, costs, thresholds):
    """
    Compute soft value that smoothly penalizes below-threshold redemptions.
    
    Instead of: value if cpp > threshold else 0
    Use:        value × penalty_factor(cpp, threshold)
    """
    
    raw_value = costs["cash"][edge] - costs["surcharge"][airline][edge]
    miles = costs["miles"][airline][edge]
    cpp = (raw_value * 100.0) / miles if miles > 0 else 0
    
    threshold = thresholds.get(airline, thresholds["default"])
    
    # ════════════════════════════════════════════════════════════════════
    # SOFT PENALTY OPTIONS (choose one)
    # ════════════════════════════════════════════════════════════════════
    
    # Option A: Sigmoid (smooth transition)
    # penalty_factor = 1 / (1 + exp(-steepness * (cpp - threshold)))
    steepness = 5.0  # How sharp the transition is
    penalty_factor = 1.0 / (1.0 + math.exp(-steepness * (cpp - threshold)))
    
    # Option B: Piecewise linear (easier to reason about)
    # Full value above threshold, linear decay below, floor at 20%
    if cpp >= threshold:
        penalty_factor = 1.0
    else:
        # Linear decay: 100% at threshold, 20% at 0 cpp
        penalty_factor = max(0.2, 0.2 + 0.8 * (cpp / threshold))
    
    # Option C: Quadratic penalty below threshold
    if cpp >= threshold:
        penalty_factor = 1.0
    else:
        gap = threshold - cpp
        penalty_factor = max(0.1, 1.0 - (gap / threshold) ** 2)
    
    return raw_value * penalty_factor


# CPP Thresholds (program-specific)
CPP_THRESHOLDS = {
    # Hotels
    "HYATT": 1.5,
    "MAR": 0.8,
    "HH": 0.5,
    "IHG": 0.6,
    # Airlines
    "UA": 1.2,
    "AA": 1.2,
    "DL": 1.0,
    "BA": 1.8,  # High due to surcharges
    "NH": 1.5,  # Premium program
    # Default
    "default": 1.2,
}
```

### Fallback Rule for Required Legs

```python
def apply_threshold_fallback(leg, available_awards, thresholds):
    """
    If no awards meet threshold for a required leg, relax threshold.
    
    This prevents infeasibility while still preferring good redemptions.
    """
    
    meeting_threshold = [
        a for a in available_awards
        if a.cpp >= thresholds.get(a.program, thresholds["default"])
    ]
    
    if meeting_threshold:
        return available_awards, thresholds  # No change needed
    
    # No awards meet threshold - find the best available
    if not available_awards:
        return available_awards, thresholds  # Will use cash
    
    best_available_cpp = max(a.cpp for a in available_awards)
    
    # Log the fallback
    logger.warning(
        f"Leg {leg}: No awards meet threshold. "
        f"Best available: {best_available_cpp:.2f} cpp. "
        f"Relaxing threshold for this leg."
    )
    
    # Create leg-specific threshold override
    leg_thresholds = thresholds.copy()
    for a in available_awards:
        # Set threshold to best_available - 0.1 (to allow it)
        leg_thresholds[a.program] = min(
            leg_thresholds.get(a.program, 99),
            best_available_cpp - 0.1
        )
    
    return available_awards, leg_thresholds
```

---

## Robust Normalization for Balanced Mode

### Problem: Fixed Constants and Outliers

**V1 Issues:**
- "10h flight ≈ 5 nights hotel" is arbitrary
- Median can be distorted by small/weird sample sets
- Different trip types need different weights

### Solution: User-Configurable + Robust Statistics

```python
@dataclass
class BalancedModeConfig:
    """
    User-configurable parameters for balanced mode.
    
    These can be set via API, user preferences, or derived from trip type.
    """
    
    # Cross-category weights (how important is lodging vs transport?)
    flight_importance: float = 1.0      # 1.0 = baseline
    hotel_importance: float = 1.0       # Increase for "hotel snob"
    
    # Time sensitivity
    time_penalty_per_hour: float = 0.03  # 3% penalty per hour above baseline
    baseline_hours: float = 10.0         # "Normal" long-haul
    
    # Connection sensitivity
    connection_penalty: float = 0.25     # 25% penalty per extra stop
    max_acceptable_stops: int = 2        # Hard constraint
    
    # Hotel quality bonus
    quality_bonus: Dict[float, float] = field(default_factory=lambda: {
        5.0: 1.15,   # 15% bonus for 5-star
        4.5: 1.08,
        4.0: 1.00,   # Baseline
        3.5: 0.90,
        3.0: 0.80,
    })
    
    # Normalization robustness
    min_samples_for_median: int = 5      # Below this, use prior
    outlier_percentile: float = 0.1      # Trim top/bottom 10%
    
    @classmethod
    def for_trip_type(cls, trip_type: str) -> "BalancedModeConfig":
        """Factory method for trip-type-specific configs."""
        
        if trip_type == "weekend_getaway":
            return cls(
                flight_importance=0.8,   # Less important
                hotel_importance=1.2,    # More important
                time_penalty_per_hour=0.05,  # More time-sensitive
                baseline_hours=5.0,
            )
        elif trip_type == "business":
            return cls(
                flight_importance=1.2,
                hotel_importance=1.0,
                time_penalty_per_hour=0.08,  # Very time-sensitive
                connection_penalty=0.4,       # Hate connections
            )
        elif trip_type == "extended_vacation":
            return cls(
                flight_importance=1.0,
                hotel_importance=1.3,    # Hotel matters more for long stays
                time_penalty_per_hour=0.02,  # Less time-sensitive
                baseline_hours=12.0,
            )
        else:
            return cls()  # Default


def compute_robust_normalization(flight_options, hotel_options, config: BalancedModeConfig):
    """
    Compute normalization constants with outlier handling and minimum samples.
    """
    
    # ════════════════════════════════════════════════════════════════════
    # FLIGHT NORMALIZATION
    # ════════════════════════════════════════════════════════════════════
    
    flight_densities = []
    for f in flight_options:
        if f.value <= 0:
            continue
        
        # Time factor
        hours = f.time_minutes / 60
        time_factor = 1.0 + max(0, hours - config.baseline_hours) * config.time_penalty_per_hour
        
        # Connection factor
        connection_factor = 1.0 + f.num_stops * config.connection_penalty
        
        # Value density (value per adjusted hour)
        adjusted_hours = hours * time_factor * connection_factor
        density = f.value / max(1, adjusted_hours)
        
        flight_densities.append(density)
    
    # Robust median with outlier trimming
    if len(flight_densities) >= config.min_samples_for_median:
        K_flight = trimmed_median(
            flight_densities, 
            trim_pct=config.outlier_percentile
        )
    else:
        # Insufficient samples - use stable prior
        K_flight = 150.0  # $150 per adjusted hour is reasonable
        logger.info(f"Flight normalization: using prior K={K_flight} (only {len(flight_densities)} samples)")
    
    # ════════════════════════════════════════════════════════════════════
    # HOTEL NORMALIZATION
    # ════════════════════════════════════════════════════════════════════
    
    hotel_densities = []
    for h in hotel_options:
        if h.value <= 0:
            continue
        
        # Quality factor
        quality_factor = config.quality_bonus.get(h.star_rating, 1.0)
        
        # Value density (value per adjusted night)
        adjusted_nights = h.nights / quality_factor
        density = h.value / max(1, adjusted_nights)
        
        hotel_densities.append(density)
    
    if len(hotel_densities) >= config.min_samples_for_median:
        K_hotel = trimmed_median(
            hotel_densities,
            trim_pct=config.outlier_percentile
        )
    else:
        K_hotel = 200.0  # $200 per adjusted night
        logger.info(f"Hotel normalization: using prior K={K_hotel} (only {len(hotel_densities)} samples)")
    
    # ════════════════════════════════════════════════════════════════════
    # CROSS-CATEGORY SCALING
    # ════════════════════════════════════════════════════════════════════
    
    # Apply user importance weights
    K_flight_weighted = K_flight * config.flight_importance
    K_hotel_weighted = K_hotel * config.hotel_importance
    
    # Scale to [0, 1] range
    max_K = max(K_flight_weighted, K_hotel_weighted, 1.0)
    scale_flight = 1.0 / max_K
    scale_hotel = 1.0 / max_K
    
    return NormalizationResult(
        K_flight=K_flight,
        K_hotel=K_hotel,
        scale_flight=scale_flight * config.flight_importance,
        scale_hotel=scale_hotel * config.hotel_importance,
        config=config,
    )


def trimmed_median(values: List[float], trim_pct: float = 0.1) -> float:
    """Compute median after trimming outliers from both ends."""
    if not values:
        return 0.0
    
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    
    # Trim indices
    low_idx = int(n * trim_pct)
    high_idx = int(n * (1 - trim_pct))
    
    # Ensure we have at least one value
    if low_idx >= high_idx:
        return sorted_vals[n // 2]
    
    trimmed = sorted_vals[low_idx:high_idx]
    return trimmed[len(trimmed) // 2]
```

---

## Edge Granularity: Itinerary vs Leg

### Problem: Ambiguous Edge Definition

V1 didn't clarify whether an "edge" is:
- A single flight leg (LAX → DFW)
- An entire itinerary option for an O-D pair (LAX → DFW → JFK as one edge)

This affects:
- How connection counts are computed
- Whether layover duration is included in time
- Constraint complexity

### Solution: Explicitly Define as Itinerary Options

```python
@dataclass
class FlightItineraryEdge:
    """
    An edge represents ONE complete itinerary option for an origin-destination pair.
    
    This includes:
    - All legs (segments)
    - All layovers
    - Total travel time (air + ground)
    - Number of stops
    
    Example:
        origin: "LAX"
        destination: "NRT"
        segments: [
            Segment(LAX→DFW, UA123, 3h15m),
            Segment(DFW→NRT, UA456, 13h20m),
        ]
        layovers: [
            Layover(DFW, 2h30m),
        ]
        total_time: 19h05m  # Air time + layover
        num_stops: 1
    """
    
    # Core identifiers
    origin: str                    # Origin airport (e.g., "LAX")
    destination: str               # Final destination (e.g., "NRT")
    itinerary_id: str              # Unique ID for this option
    
    # Segment details
    segments: List[FlightSegment]  # Individual legs
    layovers: List[Layover]        # Connections
    
    # Aggregated metrics (pre-computed)
    total_air_time_minutes: int    # Sum of flight durations
    total_layover_minutes: int     # Sum of connection times
    total_time_minutes: int        # Air + layover + buffer
    num_stops: int                 # Number of connections
    
    # Pricing
    cash_cost: float
    award_options: List[AwardOption]  # Different programs/prices
    
    # Schedule
    departure_datetime: datetime
    arrival_datetime: datetime
    
    # Quality indicators
    operating_airlines: List[str]
    is_redeye: bool
    has_long_layover: bool         # Any layover > 4 hours
    
    @property
    def edge_key(self) -> Tuple[str, str, str]:
        return (self.origin, self.destination, self.itinerary_id)


@dataclass
class FlightSegment:
    """A single flight leg within an itinerary."""
    origin: str
    destination: str
    flight_number: str
    operating_airline: str
    departure_time: datetime
    arrival_time: datetime
    duration_minutes: int
    aircraft_type: Optional[str] = None


@dataclass 
class Layover:
    """A connection between segments."""
    airport: str
    duration_minutes: int
    is_long: bool  # > 4 hours
    requires_terminal_change: bool


def build_itinerary_edges(raw_flight_data: List[Dict]) -> List[FlightItineraryEdge]:
    """
    Transform raw flight search results into itinerary edges.
    
    Each edge is a complete option for an O-D pair, not individual legs.
    """
    
    edges = []
    
    for flight in raw_flight_data:
        segments = [
            FlightSegment(
                origin=seg["departure_airport"],
                destination=seg["arrival_airport"],
                flight_number=seg["flight_number"],
                operating_airline=seg["airline"],
                departure_time=parse_datetime(seg["departure_time"]),
                arrival_time=parse_datetime(seg["arrival_time"]),
                duration_minutes=seg["duration"],
            )
            for seg in flight["segments"]
        ]
        
        layovers = []
        for i in range(len(segments) - 1):
            arr = segments[i].arrival_time
            dep = segments[i + 1].departure_time
            duration = (dep - arr).total_seconds() / 60
            layovers.append(Layover(
                airport=segments[i].destination,
                duration_minutes=int(duration),
                is_long=duration > 240,  # > 4 hours
                requires_terminal_change=False,  # Would need additional data
            ))
        
        edge = FlightItineraryEdge(
            origin=segments[0].origin,
            destination=segments[-1].destination,
            itinerary_id=flight["id"],
            segments=segments,
            layovers=layovers,
            total_air_time_minutes=sum(s.duration_minutes for s in segments),
            total_layover_minutes=sum(l.duration_minutes for l in layovers),
            total_time_minutes=flight["total_duration"],
            num_stops=len(segments) - 1,
            cash_cost=flight["price"],
            award_options=parse_award_options(flight.get("awards", [])),
            departure_datetime=segments[0].departure_time,
            arrival_datetime=segments[-1].arrival_time,
            operating_airlines=list(set(s.operating_airline for s in segments)),
            is_redeye=is_redeye_flight(segments[0].departure_time),
            has_long_layover=any(l.is_long for l in layovers),
        )
        
        edges.append(edge)
    
    return edges
```

---

## Hotel Modeling: Per-Night Constraints

### Problem: "One per destination" is Underspecified

V1 said "one hotel per destination" but real trips need:
- Different hotels on different nights (split stays)
- Date alignment with flights (check-in after arrival)
- Multi-city with different dates

### Solution: Per-Night Stay Modeling

```python
@dataclass
class HotelStayEdge:
    """
    A hotel stay option for a specific destination and date range.
    
    Unlike flights (point-to-point), hotels are:
    - Location-bound (no "routing")
    - Date-range-bound (check-in to check-out)
    - Can be split (different hotels on different nights)
    """
    
    # Location
    city: str                      # City code (e.g., "TYO")
    airport_codes: List[str]       # Nearby airports for alignment
    
    # Property
    hotel_id: str
    hotel_name: str
    chain: str                     # "HYATT", "MARRIOTT", etc.
    star_rating: float
    
    # Stay period
    check_in: date
    check_out: date
    nights: int
    
    # Pricing
    cash_cost: float               # Total for all nights
    cash_per_night: float
    award_cost: Optional[int]      # Total points for all nights
    award_per_night: Optional[int]
    award_program: Optional[str]
    award_surcharge: float         # Resort fees, taxes
    
    # Availability confidence
    availability_score: float      # 0-1, how likely to still be available
    cancellation_policy: str       # "free", "partial", "non-refundable"
    
    @property
    def edge_key(self) -> Tuple[str, str, str, str]:
        return (self.city, self.hotel_id, str(self.check_in), str(self.check_out))


def build_hotel_constraints(model, hotel_edges, flight_edges, travelers):
    """
    Build hotel selection constraints with proper date alignment.
    """
    
    # ════════════════════════════════════════════════════════════════════
    # GROUP HOTELS BY (city, date_range)
    # ════════════════════════════════════════════════════════════════════
    
    # Group by stay period (city + dates)
    hotels_by_stay = defaultdict(list)
    for h in hotel_edges:
        stay_key = (h.city, h.check_in, h.check_out)
        hotels_by_stay[stay_key].append(h)
    
    # ════════════════════════════════════════════════════════════════════
    # CONSTRAINT 1: Exactly one hotel per required stay
    # ════════════════════════════════════════════════════════════════════
    
    for (city, check_in, check_out), hotels in hotels_by_stay.items():
        if city in required_hotel_cities:
            for p in travelers:
                model += lpSum(
                    x_hotel[p][h.edge_key] for h in hotels
                ) == 1, f"one_hotel_{p}_{city}_{check_in}"
    
    # ════════════════════════════════════════════════════════════════════
    # CONSTRAINT 2: Date alignment with flights
    # ════════════════════════════════════════════════════════════════════
    
    for p in travelers:
        for (city, check_in, check_out), hotels in hotels_by_stay.items():
            # Find flights arriving at this city
            arriving_flights = [
                f for f in flight_edges
                if f.destination in CITY_TO_AIRPORTS.get(city, [city])
            ]
            
            # Find flights departing from this city
            departing_flights = [
                f for f in flight_edges
                if f.origin in CITY_TO_AIRPORTS.get(city, [city])
            ]
            
            for h in hotels:
                # CONSTRAINT 2a: If hotel selected, must have a valid arriving flight
                # (arriving on or before check-in date)
                valid_arrivals = [
                    f for f in arriving_flights
                    if f.arrival_datetime.date() <= h.check_in
                ]
                
                if valid_arrivals:
                    model += x_hotel[p][h.edge_key] <= lpSum(
                        x_flight[p][f.edge_key] for f in valid_arrivals
                    ), f"hotel_arrival_align_{p}_{h.edge_key}"
                
                # CONSTRAINT 2b: If hotel selected, must have a valid departing flight
                # (departing on or after check-out date)
                valid_departures = [
                    f for f in departing_flights
                    if f.departure_datetime.date() >= h.check_out
                ]
                
                if valid_departures:
                    model += x_hotel[p][h.edge_key] <= lpSum(
                        x_flight[p][f.edge_key] for f in valid_departures
                    ), f"hotel_depart_align_{p}_{h.edge_key}"
    
    # ════════════════════════════════════════════════════════════════════
    # CONSTRAINT 3: Multi-city continuity
    # ════════════════════════════════════════════════════════════════════
    
    # If trip is: JFK → TYO (3 nights) → KYO (2 nights) → TYO → JFK
    # Then: TYO hotel checkout ≤ KYO hotel checkin
    #       KYO hotel checkout ≤ TYO departure
    
    for p in travelers:
        for i, (city1, stay1) in enumerate(ordered_stays[p]):
            for city2, stay2 in ordered_stays[p][i+1:]:
                # Stays must not overlap
                model += (
                    lpSum(x_hotel[p][h.edge_key] * h.check_out for h in stay1)
                    <= lpSum(x_hotel[p][h.edge_key] * h.check_in for h in stay2)
                ), f"stay_order_{p}_{city1}_{city2}"
```

### Robustness: Require Alternatives

```python
def add_robustness_constraints(model, hotel_edges, min_alternatives=2):
    """
    Soft constraint: prefer hotels with booking alternatives.
    
    This reduces risk of "perfect" solution disappearing.
    """
    
    # Group by stay period
    hotels_by_stay = group_hotels_by_stay(hotel_edges)
    
    for stay_key, hotels in hotels_by_stay.items():
        if len(hotels) < min_alternatives:
            logger.warning(
                f"Stay {stay_key}: Only {len(hotels)} hotel options. "
                f"Solution may be fragile."
            )
            
            # Add availability-weighted bonus to objective
            # Prefer hotels with higher availability scores
            for h in hotels:
                # Add small bonus for availability (in secondary objective)
                availability_bonus[h.edge_key] = h.availability_score * 10
```

---

## Transfer Modeling Refinements

### Problem: Block Model Too Coarse

V1 issues:
- Minimum increments vary by program (1000, 500, etc.)
- Transfer ratios and bonuses can be conditional
- Transfer time delays affect booking feasibility

### Solution: Precise Transfer Modeling

```python
@dataclass
class TransferPath:
    """
    Complete definition of a transfer path from bank to program.
    """
    from_bank: str              # "chase", "amex", etc.
    to_program: str             # "UA", "HYATT", etc.
    
    # Transfer mechanics
    min_increment: int          # Minimum transfer amount (usually 1000)
    ratio: float                # Points received per bank point
    current_bonus: float        # Current promotional bonus (1.0 = none)
    bonus_expiry: Optional[date]
    
    # Timing
    typical_hours: int          # Typical transfer time
    max_hours: int              # Worst case
    is_instant: bool
    
    # Constraints
    max_per_day: Optional[int]  # Some banks limit daily transfers
    max_per_year: Optional[int]
    
    def compute_delivered_points(self, bank_points: int) -> int:
        """Compute points delivered after transfer."""
        # Round down to increment
        transferable = (bank_points // self.min_increment) * self.min_increment
        return int(transferable * self.ratio * self.current_bonus)
    
    def compute_bank_points_needed(self, target_points: int) -> int:
        """Compute bank points needed to get target program points."""
        # Account for ratio and bonus
        effective_rate = self.ratio * self.current_bonus
        raw_needed = target_points / effective_rate
        # Round up to increment
        return int(math.ceil(raw_needed / self.min_increment)) * self.min_increment


def build_transfer_constraints(model, transfer_paths, source_balances, variables):
    """
    Build transfer constraints with proper increment handling.
    """
    
    t_blocks = variables["t_blocks"]
    y_flight = variables["y_flight"]
    y_hotel = variables["y_hotel"]
    
    for tp in transfer_paths:
        s, prog = tp.from_bank, tp.to_program
        
        # ════════════════════════════════════════════════════════════════
        # CONSTRAINT 1: Points used ≤ points delivered
        # ════════════════════════════════════════════════════════════════
        
        # Points used for flights via this path
        flight_points = lpSum(
            y_flight[(s, prog)][e] * miles_required[prog][e]
            for e in flight_edges
            if (s, prog) in y_flight and prog in miles_required
        )
        
        # Points used for hotels via this path
        hotel_points = lpSum(
            y_hotel[(s, prog)][h] * points_required[prog][h]
            for h in hotel_edges
            if (s, prog) in y_hotel and prog in points_required
        )
        
        # Delivered = blocks × increment × ratio × bonus
        delivered = t_blocks[s][prog] * tp.min_increment * tp.ratio * tp.current_bonus
        
        model += flight_points + hotel_points <= delivered, f"transfer_sufficiency_{s}_{prog}"
        
        # ════════════════════════════════════════════════════════════════
        # CONSTRAINT 2: Blocks transferred ≤ balance / increment
        # ════════════════════════════════════════════════════════════════
        
        max_blocks = source_balances.get(s, 0) // tp.min_increment
        model += t_blocks[s][prog] <= max_blocks, f"transfer_balance_{s}_{prog}"
    
    # ════════════════════════════════════════════════════════════════════
    # CONSTRAINT 3: Total from each source ≤ balance
    # ════════════════════════════════════════════════════════════════════
    
    for source in sources:
        source_paths = [tp for tp in transfer_paths if tp.from_bank == source]
        
        total_from_source = lpSum(
            t_blocks[source][tp.to_program] * tp.min_increment
            for tp in source_paths
        )
        
        model += total_from_source <= source_balances[source], f"source_balance_{source}"


def add_transfer_timing_penalty(objective, transfer_paths, days_until_travel):
    """
    Add penalty for transfers that might not complete in time.
    """
    
    timing_penalty = 0
    
    for tp in transfer_paths:
        if tp.is_instant:
            continue
        
        # Penalty if transfer might be tight
        hours_available = days_until_travel * 24
        if tp.max_hours > hours_available:
            # High risk - strong penalty
            timing_penalty += t_blocks[tp.from_bank][tp.to_program] * 50
        elif tp.typical_hours > hours_available * 0.5:
            # Moderate risk - mild penalty
            timing_penalty += t_blocks[tp.from_bank][tp.to_program] * 10
    
    return timing_penalty
```

---

## Determinism and Tie-Breaking

### Problem: MILP Solutions Can Vary

CBC (and other solvers) can return different solutions on:
- Different runs
- Different CBC versions
- Subtle coefficient changes

### Solution: Deterministic Tie-Breaking

```python
def ensure_deterministic_solution(model, variables, costs):
    """
    Add tie-breaking terms to ensure deterministic solutions.
    
    Strategy:
    1. Sort candidate edges deterministically before building variables
    2. Add small tie-breaking terms to objective
    3. Use two-pass optimization for clear priorities
    """
    
    # ════════════════════════════════════════════════════════════════════
    # STEP 1: Deterministic edge ordering
    # ════════════════════════════════════════════════════════════════════
    
    # Sort edges by a stable key before creating variables
    # This ensures variable creation order is consistent
    sorted_flight_edges = sorted(
        flight_edges,
        key=lambda e: (e.origin, e.destination, e.itinerary_id)
    )
    
    sorted_hotel_edges = sorted(
        hotel_edges,
        key=lambda h: (h.city, h.check_in, h.hotel_id)
    )
    
    # ════════════════════════════════════════════════════════════════════
    # STEP 2: Tie-breaking terms in objective
    # ════════════════════════════════════════════════════════════════════
    
    # Use edge index as a tiny tie-breaker
    # Earlier edges (by sort order) are slightly preferred
    EPSILON = 1e-6
    
    tie_breaker = lpSum(
        x_flight[e.edge_key] * (i * EPSILON)
        for i, e in enumerate(sorted_flight_edges)
    ) + lpSum(
        x_hotel[h.edge_key] * (i * EPSILON)
        for i, h in enumerate(sorted_hotel_edges)
    )
    
    # ════════════════════════════════════════════════════════════════════
    # STEP 3: Secondary objectives for tie-breaking
    # ════════════════════════════════════════════════════════════════════
    
    # When primary objective has multiple optima, prefer:
    secondary_preferences = [
        # 1. Fewer total segments
        ("min_segments", lpSum(x_flight[e.edge_key] * e.num_stops for e in flight_edges)),
        
        # 2. Shorter total time
        ("min_time", lpSum(x_flight[e.edge_key] * e.total_time_minutes for e in flight_edges)),
        
        # 3. Earlier departures
        ("earlier_departure", lpSum(
            x_flight[e.edge_key] * e.departure_datetime.timestamp() 
            for e in flight_edges
        )),
        
        # 4. Higher airline quality (tie-break within same time/segments)
        ("prefer_quality", -lpSum(
            x_flight[e.edge_key] * AIRLINE_QUALITY_SCORE.get(e.operating_airlines[0], 50)
            for e in flight_edges
        )),
        
        # 5. Deterministic edge ordering
        ("deterministic", tie_breaker),
    ]
    
    return secondary_preferences


AIRLINE_QUALITY_SCORE = {
    # Higher = better
    "SQ": 95,   # Singapore
    "NH": 90,   # ANA
    "CX": 88,   # Cathay
    "EK": 85,   # Emirates
    "QR": 85,   # Qatar
    "BA": 75,   # British Airways
    "UA": 70,   # United
    "AA": 65,   # American
    "DL": 70,   # Delta
    # Default
    "default": 50,
}
```

---

## User Preference Knobs

### Problem: Users Will Ask for Customization

Even with three modes, users will want:
- "Avoid redeyes"
- "Max 1 stop"
- "Must be Hyatt"
- "No long layovers"

### Solution: Preference System with Hard/Soft Constraints

```python
@dataclass
class UserPreferences:
    """
    User-configurable preferences that affect optimization.
    
    Each preference can be:
    - Hard constraint (must be satisfied)
    - Soft penalty (preferred but not required)
    """
    
    # ════════════════════════════════════════════════════════════════════
    # FLIGHT PREFERENCES
    # ════════════════════════════════════════════════════════════════════
    
    # Stops
    max_stops: Optional[int] = None          # Hard: max connections
    prefer_direct: bool = False               # Soft: penalty for connections
    connection_penalty_soft: float = 50.0     # Penalty per stop if prefer_direct
    
    # Time
    max_total_hours: Optional[float] = None   # Hard: max travel time
    avoid_redeye: bool = False                # Soft: penalty for overnight flights
    redeye_penalty: float = 100.0
    max_layover_hours: Optional[float] = None # Hard: max single layover
    prefer_short_layover: bool = True         # Soft: penalty for long layovers
    
    # Airlines
    preferred_airlines: List[str] = field(default_factory=list)
    avoided_airlines: List[str] = field(default_factory=list)
    preferred_airline_bonus: float = 20.0
    avoided_airline_penalty: float = 100.0
    
    # Schedule
    earliest_departure: Optional[time] = None  # Hard: don't depart before
    latest_arrival: Optional[time] = None      # Hard: arrive by
    prefer_morning_departure: bool = False
    prefer_evening_arrival: bool = False
    
    # ════════════════════════════════════════════════════════════════════
    # HOTEL PREFERENCES
    # ════════════════════════════════════════════════════════════════════
    
    # Brands
    preferred_chains: List[str] = field(default_factory=list)  # ["HYATT", "MAR"]
    avoided_chains: List[str] = field(default_factory=list)
    chain_preference_bonus: float = 30.0
    
    # Quality
    min_star_rating: Optional[float] = None   # Hard: minimum stars
    prefer_higher_rated: bool = True          # Soft: bonus for higher stars
    
    # Location (future)
    # preferred_areas: List[str] = field(default_factory=list)
    
    # ════════════════════════════════════════════════════════════════════
    # TRANSFER PREFERENCES
    # ════════════════════════════════════════════════════════════════════
    
    # Timing risk
    min_days_for_non_instant: int = 3         # Warn/penalize if cutting it close
    prefer_instant_transfers: bool = True
    
    # Program preferences
    preferred_programs: List[str] = field(default_factory=list)
    
    # ════════════════════════════════════════════════════════════════════
    # MODE OVERRIDES
    # ════════════════════════════════════════════════════════════════════
    
    # Override mode defaults
    override_cpp_threshold: Optional[float] = None
    override_time_weight: Optional[float] = None
    override_hotel_importance: Optional[float] = None


def apply_preferences(model, preferences: UserPreferences, variables, edges):
    """
    Apply user preferences as hard constraints and soft penalties.
    """
    
    penalties = []
    
    # ════════════════════════════════════════════════════════════════════
    # HARD CONSTRAINTS
    # ════════════════════════════════════════════════════════════════════
    
    if preferences.max_stops is not None:
        for e in flight_edges:
            if e.num_stops > preferences.max_stops:
                model += x_flight[e.edge_key] == 0, f"max_stops_{e.edge_key}"
    
    if preferences.max_total_hours is not None:
        model += lpSum(
            x_flight[e.edge_key] * e.total_time_minutes
            for e in flight_edges
        ) <= preferences.max_total_hours * 60, "max_total_time"
    
    if preferences.max_layover_hours is not None:
        for e in flight_edges:
            if e.has_long_layover and max(l.duration_minutes for l in e.layovers) > preferences.max_layover_hours * 60:
                model += x_flight[e.edge_key] == 0, f"max_layover_{e.edge_key}"
    
    if preferences.min_star_rating is not None:
        for h in hotel_edges:
            if h.star_rating < preferences.min_star_rating:
                model += x_hotel[h.edge_key] == 0, f"min_stars_{h.edge_key}"
    
    for airline in preferences.avoided_airlines:
        for e in flight_edges:
            if airline in e.operating_airlines:
                model += x_flight[e.edge_key] == 0, f"avoid_airline_{airline}_{e.edge_key}"
    
    # ════════════════════════════════════════════════════════════════════
    # SOFT PENALTIES (added to objective)
    # ════════════════════════════════════════════════════════════════════
    
    if preferences.prefer_direct:
        penalties.append(lpSum(
            x_flight[e.edge_key] * e.num_stops * preferences.connection_penalty_soft
            for e in flight_edges
        ))
    
    if preferences.avoid_redeye:
        penalties.append(lpSum(
            x_flight[e.edge_key] * preferences.redeye_penalty
            for e in flight_edges if e.is_redeye
        ))
    
    if preferences.preferred_airlines:
        # Bonus for preferred (negative penalty)
        penalties.append(-lpSum(
            x_flight[e.edge_key] * preferences.preferred_airline_bonus
            for e in flight_edges
            if any(a in preferences.preferred_airlines for a in e.operating_airlines)
        ))
    
    if preferences.preferred_chains:
        penalties.append(-lpSum(
            x_hotel[h.edge_key] * preferences.chain_preference_bonus
            for h in hotel_edges
            if h.chain in preferences.preferred_chains
        ))
    
    if preferences.prefer_higher_rated:
        # Small bonus per star
        penalties.append(-lpSum(
            x_hotel[h.edge_key] * (h.star_rating - 3.0) * 5.0
            for h in hotel_edges
        ))
    
    # Return total penalty to add to objective
    return lpSum(penalties)
```

---

## Explainability Layer

### Problem: Users Need to Understand WHY

A "smart" optimizer needs to explain:
- Why points were used vs cash
- What alternatives were considered
- Which constraints were binding

### Solution: First-Class Explainability Output

```python
@dataclass
class EdgeExplanation:
    """Explanation for why a specific edge was selected and how it was paid."""
    
    edge_key: Tuple
    edge_type: str  # "flight" or "hotel"
    
    # Selection explanation
    selected: bool
    selection_reason: str
    alternatives_considered: int
    
    # Payment explanation
    payment_method: str  # "cash", "points_transfer", "points_native"
    payment_reason: str
    
    # Value metrics
    cash_cost: float
    points_cost: Optional[int]
    surcharge: Optional[float]
    cpp_achieved: Optional[float]
    
    # For balanced mode
    raw_value: Optional[float]
    time_factor: Optional[float]
    connection_factor: Optional[float]
    normalized_score: Optional[float]
    
    # Constraints
    binding_constraints: List[str]
    
    # Alternatives
    best_alternative: Optional[Dict]
    savings_vs_alternative: Optional[float]


@dataclass
class TransferExplanation:
    """Explanation for transfer decisions."""
    
    from_program: str
    to_program: str
    points_transferred: int
    points_received: int
    ratio_used: str
    bonus_applied: Optional[float]
    
    # Why this path
    reason: str
    alternatives: List[Dict]


@dataclass
class SolutionExplanation:
    """Complete explanation of the optimization solution."""
    
    mode: str
    mode_description: str
    
    # Summary
    summary: str
    total_cash_paid: float
    total_points_used: int
    total_value_achieved: float
    average_cpp: float
    
    # Per-edge explanations
    flight_explanations: List[EdgeExplanation]
    hotel_explanations: List[EdgeExplanation]
    
    # Transfer explanations
    transfer_explanations: List[TransferExplanation]
    
    # Constraint analysis
    binding_constraints: List[str]
    slack_constraints: List[str]
    
    # Alternatives
    next_best_solution: Optional[Dict]
    improvement_suggestions: List[str]


def generate_explanation(model, solution, mode, costs, preferences) -> SolutionExplanation:
    """
    Generate human-readable explanation of the solution.
    """
    
    flight_explanations = []
    hotel_explanations = []
    
    # ════════════════════════════════════════════════════════════════════
    # ANALYZE EACH SELECTED FLIGHT
    # ════════════════════════════════════════════════════════════════════
    
    for e in solution["flights"]:
        edge = flight_edges_by_key[e["edge_key"]]
        
        # Why was this flight selected?
        alternatives = get_alternatives(edge.origin, edge.destination, edge.departure_datetime.date())
        
        if len(alternatives) == 1:
            selection_reason = "Only available option for this route/date"
        elif edge.cash_cost == min(a.cash_cost for a in alternatives):
            selection_reason = "Lowest cash cost option"
        elif edge.num_stops == min(a.num_stops for a in alternatives):
            selection_reason = "Most direct route"
        elif edge.total_time_minutes == min(a.total_time_minutes for a in alternatives):
            selection_reason = "Shortest travel time"
        else:
            selection_reason = "Best balance of cost/time/convenience"
        
        # Why points vs cash?
        if e["payment_method"] == "cash":
            if not edge.award_options:
                payment_reason = "No award availability on this flight"
            elif mode == "cpp" and all(a.cpp < CPP_THRESHOLDS[a.program] for a in edge.award_options):
                best_award = max(edge.award_options, key=lambda a: a.cpp)
                payment_reason = (
                    f"Award cpp ({best_award.cpp:.2f}¢) below threshold "
                    f"({CPP_THRESHOLDS[best_award.program]:.2f}¢). Preserving points."
                )
            else:
                payment_reason = "Cash booking was more economical"
        else:
            award = e["award_details"]
            if mode == "oop":
                payment_reason = (
                    f"Using points saves ${edge.cash_cost - award.surcharge:.0f} "
                    f"({award.cpp:.2f}¢ per point)"
                )
            elif mode == "cpp":
                payment_reason = (
                    f"Excellent redemption at {award.cpp:.2f}¢ per point "
                    f"(above {CPP_THRESHOLDS[award.program]:.2f}¢ threshold)"
                )
            else:  # balanced
                payment_reason = (
                    f"Normalized score {e['normalized_score']:.2f} after "
                    f"adjusting for {edge.total_time_minutes/60:.1f}h travel time "
                    f"and {edge.num_stops} stop(s)"
                )
        
        flight_explanations.append(EdgeExplanation(
            edge_key=e["edge_key"],
            edge_type="flight",
            selected=True,
            selection_reason=selection_reason,
            alternatives_considered=len(alternatives),
            payment_method=e["payment_method"],
            payment_reason=payment_reason,
            cash_cost=edge.cash_cost,
            points_cost=e.get("points_cost"),
            surcharge=e.get("surcharge"),
            cpp_achieved=e.get("cpp"),
            raw_value=e.get("raw_value"),
            time_factor=e.get("time_factor"),
            connection_factor=e.get("connection_factor"),
            normalized_score=e.get("normalized_score"),
            binding_constraints=get_binding_constraints_for_edge(model, e["edge_key"]),
            best_alternative=get_best_alternative(alternatives, edge),
            savings_vs_alternative=compute_savings_vs_alternative(edge, alternatives),
        ))
    
    # ... similar for hotels ...
    
    # ════════════════════════════════════════════════════════════════════
    # GENERATE SUMMARY
    # ════════════════════════════════════════════════════════════════════
    
    if mode == "oop":
        summary = (
            f"Minimized out-of-pocket spending to ${solution['total_cash']:.0f}. "
            f"Used {solution['total_points']:,} points across {len(solution['transfers'])} transfer(s) "
            f"to save ${solution['total_value']:.0f} in cash."
        )
    elif mode == "cpp":
        summary = (
            f"Maximized point value at {solution['average_cpp']:.2f}¢ per point. "
            f"Only used points for redemptions above program thresholds."
        )
    else:
        summary = (
            f"Balanced value, time, and convenience. "
            f"Achieved {solution['average_cpp']:.2f}¢ per point "
            f"with {solution['total_time_hours']:.1f} hours total travel "
            f"and {solution['total_stops']} connection(s)."
        )
    
    # ════════════════════════════════════════════════════════════════════
    # IMPROVEMENT SUGGESTIONS
    # ════════════════════════════════════════════════════════════════════
    
    suggestions = []
    
    if solution["transfers_at_risk"]:
        suggestions.append(
            f"⚠️ Transfer from {solution['transfers_at_risk'][0]['from']} may take "
            f"{solution['transfers_at_risk'][0]['hours']} hours. Consider booking "
            f"with cash and transferring later."
        )
    
    if solution["close_alternatives"]:
        alt = solution["close_alternatives"][0]
        suggestions.append(
            f"💡 Alternative: {alt['description']} saves ${alt['savings']:.0f} more "
            f"but adds {alt['extra_time_hours']:.1f} hours of travel."
        )
    
    return SolutionExplanation(
        mode=mode,
        mode_description=MODE_DESCRIPTIONS[mode],
        summary=summary,
        total_cash_paid=solution["total_cash"],
        total_points_used=solution["total_points"],
        total_value_achieved=solution["total_value"],
        average_cpp=solution["average_cpp"],
        flight_explanations=flight_explanations,
        hotel_explanations=hotel_explanations,
        transfer_explanations=solution["transfer_explanations"],
        binding_constraints=get_all_binding_constraints(model),
        slack_constraints=get_slack_constraints(model),
        next_best_solution=solution.get("next_best"),
        improvement_suggestions=suggestions,
    )
```

---

## Testing Strategy (Revised)

### 1. Constraint Feasibility Tests

```python
class TestConstraintFeasibility:
    """Validate that solutions satisfy all constraints."""
    
    def test_path_feasibility(self, solution):
        """Verify selected flights form a valid path."""
        for traveler, flights in solution["flights"].items():
            path = extract_path(flights)
            
            # Continuous path
            for i in range(len(path) - 1):
                assert path[i]["destination"] == path[i+1]["origin"], \
                    f"Path discontinuity: {path[i]} → {path[i+1]}"
            
            # Starts and ends correctly
            assert path[0]["origin"] == solution["start_city"][traveler]
            assert path[-1]["destination"] == solution["end_city"][traveler]
    
    def test_payment_exclusivity(self, solution):
        """Verify each edge has exactly one payment method."""
        for edge in solution["all_edges"]:
            payment_count = sum([
                1 if edge.get("cash_payment") else 0,
                1 if edge.get("points_transfer") else 0,
                1 if edge.get("points_native") else 0,
            ])
            assert payment_count == 1, f"Edge {edge} has {payment_count} payments"
    
    def test_transfer_balance(self, solution, user_points):
        """Verify transfers don't exceed balance."""
        for source, balance in user_points.items():
            transferred = sum(
                t["points"] for t in solution["transfers"]
                if t["from"] == source
            )
            assert transferred <= balance, \
                f"Transferred {transferred} from {source} but only had {balance}"
    
    def test_date_alignment(self, solution):
        """Verify hotel dates align with flights."""
        for hotel in solution["hotels"]:
            # Find arriving flight
            arriving = [
                f for f in solution["flights"]
                if f["destination_city"] == hotel["city"]
                and f["arrival_date"] <= hotel["check_in"]
            ]
            assert arriving, f"No valid arrival for hotel {hotel}"
            
            # Find departing flight
            departing = [
                f for f in solution["flights"]
                if f["origin_city"] == hotel["city"]
                and f["departure_date"] >= hotel["check_out"]
            ]
            assert departing, f"No valid departure for hotel {hotel}"
```

### 2. Golden Scenario Tests with Slack

```python
class TestGoldenScenarios:
    """Test against known scenarios with acceptable ranges."""
    
    def test_jfk_tyo_roundtrip_oop(self):
        """OOP mode for JFK→TYO roundtrip."""
        solution = run_optimization(
            scenario="jfk_tyo_7nights",
            mode="oop",
            user_points={"chase": 200000, "hyatt": 50000}
        )
        
        # Assert within acceptable range (not exact values)
        assert solution["total_cash"] <= 500, "Cash should be ≤ $500 in OOP mode"
        assert solution["total_points"] >= 150000, "Should use most points"
        assert solution["status"] == "Optimal"
    
    def test_cpp_prefers_premium_redemptions(self):
        """CPP mode should reject low-value redemptions."""
        solution = run_optimization(
            scenario="mixed_cpp_options",
            mode="cpp",
            user_points={"chase": 100000}
        )
        
        # All redemptions should be above threshold
        for edge in solution["points_edges"]:
            assert edge["cpp"] >= 1.0, f"CPP mode used low-value redemption: {edge['cpp']}¢"
    
    def test_balanced_prefers_direct(self):
        """Balanced mode should prefer direct flights over slightly cheaper connections."""
        solution = run_optimization(
            scenario="direct_vs_connection",
            mode="balanced",
        )
        
        # Should choose direct even if connection saves $100
        max_stops = max(f["num_stops"] for f in solution["flights"])
        assert max_stops <= 1, "Balanced mode should avoid multi-stop"
```

### 3. Solver Stability Tests

```python
class TestSolverStability:
    """Test for deterministic, stable solutions."""
    
    def test_deterministic_across_runs(self):
        """Same inputs should produce same outputs."""
        results = []
        for _ in range(5):
            solution = run_optimization(scenario="standard", mode="oop")
            results.append(solution["edge_ids"])
        
        # All runs should produce identical edge selections
        assert all(r == results[0] for r in results), "Solutions vary across runs"
    
    def test_stable_under_small_perturbations(self):
        """Small price changes shouldn't flip entire solution."""
        base_solution = run_optimization(scenario="standard", mode="oop")
        
        # Add 1% noise to prices
        perturbed_solution = run_optimization(
            scenario="standard",
            mode="oop",
            price_noise=0.01
        )
        
        # At least 80% of edges should be the same
        overlap = len(set(base_solution["edge_ids"]) & set(perturbed_solution["edge_ids"]))
        total = len(base_solution["edge_ids"])
        assert overlap / total >= 0.8, "Solution too sensitive to small price changes"
```

---

## Implementation Phases (Revised)

### Phase 1: Core Refactoring (Week 1-2)

**Tasks:**
1. [ ] Implement two-pass optimization framework
2. [ ] Normalize all costs to [0, 1] range
3. [ ] Refactor objective to avoid double-counting
4. [ ] Add deterministic tie-breaking
5. [ ] Create `FlightItineraryEdge` data model

**Tests:**
- Constraint feasibility tests
- Determinism tests

### Phase 2: Mode Implementation (Week 2-3)

**Tasks:**
1. [ ] Implement OOP mode with single cash term
2. [ ] Implement CPP mode with soft thresholds + fallback
3. [ ] Implement Balanced mode with robust normalization
4. [ ] User-configurable `BalancedModeConfig`

**Tests:**
- Mode-specific behavior tests
- Golden scenario tests

### Phase 3: Hotel Integration (Week 3-4)

**Tasks:**
1. [ ] Implement `HotelStayEdge` data model
2. [ ] Per-night hotel selection constraints
3. [ ] Date alignment constraints
4. [ ] Hotel-flight continuity constraints

**Tests:**
- Date alignment tests
- Multi-city tests

### Phase 4: Transfer Refinements (Week 4-5)

**Tasks:**
1. [ ] Precise transfer modeling (increments, ratios, bonuses)
2. [ ] Transfer timing penalties
3. [ ] Unified transfer pool constraints

**Tests:**
- Transfer balance tests
- Timing risk tests

### Phase 5: User Preferences (Week 5-6)

**Tasks:**
1. [ ] Implement `UserPreferences` data model
2. [ ] Hard constraint application
3. [ ] Soft penalty integration
4. [ ] Mode-specific defaults + overrides

**Tests:**
- Preference enforcement tests
- Override tests

### Phase 6: Explainability (Week 6-7)

**Tasks:**
1. [ ] `SolutionExplanation` data model
2. [ ] Per-edge explanation generation
3. [ ] Transfer explanation generation
4. [ ] Binding constraint analysis
5. [ ] Alternative analysis

**Tests:**
- Explanation completeness tests
- Human-readability review

### Phase 7: Testing & Hardening (Week 7-8)

**Tasks:**
1. [ ] Solver stability tests
2. [ ] Edge case scenarios
3. [ ] Performance benchmarks
4. [ ] Integration with API

---

## Summary: Key Changes from V1

| V1 | V2 |
|----|----| 
| Single weighted objective (1e8) | Two-pass lexicographic OR normalized [0-100] |
| Hard CPP thresholds | Soft penalty + fallback |
| Fixed flight/hotel weights | User-configurable `BalancedModeConfig` |
| Ambiguous "edge" | Explicit `FlightItineraryEdge` per O-D option |
| One hotel per destination | Per-night with date alignment |
| Block transfer model | Precise increments, ratios, timing |
| No tie-breaking | Deterministic secondary objectives |
| No user preferences | Hard/soft constraint framework |
| No explainability | First-class `SolutionExplanation` |
| Edge ID equality tests | Range-based golden tests |
