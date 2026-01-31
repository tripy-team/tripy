# Hotel ILP Integration: Implementation Plan

This document outlines the implementation plan for extending the ILP optimization algorithm to include hotels based on their transfer partners, enabling unified flight + hotel optimization.

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Why Joint Optimization is Required](#why-joint-optimization-is-required)
3. [Current State Analysis](#current-state-analysis)
4. [Proposed Architecture](#proposed-architecture)
5. [Data Model Changes](#data-model-changes)
6. [ILP Model Extensions](#ilp-model-extensions)
7. [Implementation Phases](#implementation-phases)
8. [API Changes](#api-changes)
9. [Testing Strategy](#testing-strategy)

---

## Executive Summary

### Goal

Extend the ILP optimizer to **jointly optimize flights AND hotels in a single ILP model**, using transfer partner relationships to minimize total out-of-pocket costs across both.

### Critical Design Decision: Joint vs. Sequential Optimization

**We MUST use joint optimization, NOT sequential optimization.**

| Approach | Description | Optimality |
|----------|-------------|------------|
| **Sequential** | Optimize flights first, then hotels with leftover points | ❌ Suboptimal |
| **Joint (Proposed)** | Single ILP with flights AND hotels as variables | ✅ Global Optimum |

### Key Benefits

- **Global optimum:** Points allocated optimally between flights and hotels
- **Shared resource handling:** Transfer pool constraints apply to BOTH simultaneously
- **Trade-off analysis:** System can decide: "Skip flight award, use points for hotel instead"
- **Single solve:** One optimization pass for entire trip

### Example Scenario

```
Trip: JFK → Tokyo → JFK (7 nights)

User Points:
- Chase UR: 200,000
- Hyatt: 50,000 (native)

Current System:
- Flight: JFK → NRT via ANA (95,000 miles, transferred from Amex)
- Hotel: Booked separately (cash or manually using points)

Proposed System:
- Flight: JFK → NRT via United (140,000 miles, Chase → UA)
- Hotel: Park Hyatt Tokyo (175,000 points, Chase → Hyatt + native Hyatt)
- Optimizer decides: Is it better to use Chase for flights or hotels?
```

---

## Why Joint Optimization is Required

### The Problem with Sequential Optimization

**Sequential approach:**
1. Run flight ILP → Get optimal flights using available points
2. Run hotel ILP → Get optimal hotels using *remaining* points

**Why this fails:**

```
Example: User has 200,000 Chase points

SEQUENTIAL APPROACH:
─────────────────────
Step 1: Flight ILP
  - JFK → TYO → JFK: 190,000 miles via ANA (Chase → ANA)
  - Uses 190,000 Chase points
  - Cash saved: $2,500 (1.3 cpp)

Step 2: Hotel ILP (with remaining 10,000 points)
  - Can't afford any hotel award (need 175,000 for Park Hyatt)
  - Falls back to cash: $4,200 for 7 nights
  
Total: $4,200 cash, 190,000 points used
Points value: $2,500 (1.3 cpp)

JOINT APPROACH:
───────────────
Single ILP considers ALL options together:
  - Option A: Flights on points, hotel on cash
    Cash: $4,200, Points: 190,000, Value: $2,500
    
  - Option B: Flights on cash, hotel on points  
    Flight cash: $2,800
    Hotel: 175,000 Hyatt (50K native + 125K Chase→Hyatt)
    Cash saved on hotel: $4,200 @ 2.4 cpp
    Total cash: $2,800, Points: 175,000
    Points value: $4,200 (2.4 cpp) ← MUCH BETTER!
    
  - Option C: Mixed - cheaper flights + hotel on points
    Flight: $1,800 (budget carrier cash)
    Hotel: 175,000 Hyatt points
    Total cash: $1,800, Points: 175,000
    Points value: $4,200 (2.4 cpp) ← EVEN BETTER!

Joint ILP selects Option C: $1,800 cash vs $4,200 cash (saves $2,400!)
```

### Mathematical Proof: Sequential ≠ Global Optimum

The problem is a **resource allocation problem** with a shared constraint (points budget).

**Formal Definition:**

Let:
- `F` = set of flight options
- `H` = set of hotel options  
- `P` = total points available
- `v_f(f)` = value of flight option f (cash saved)
- `v_h(h)` = value of hotel option h (cash saved)
- `p_f(f)` = points required for flight f
- `p_h(h)` = points required for hotel h

**Joint Optimization (Correct):**
```
Maximize:  Σ v_f(f)·x_f + Σ v_h(h)·x_h
Subject to: Σ p_f(f)·x_f + Σ p_h(h)·x_h ≤ P   ← SHARED CONSTRAINT
            x_f, x_h ∈ {0,1}
```

**Sequential Optimization (Incorrect):**
```
Step 1: Maximize Σ v_f(f)·x_f  s.t. Σ p_f(f)·x_f ≤ P
        → Let P_used be points used, solution x_f*

Step 2: Maximize Σ v_h(h)·x_h  s.t. Σ p_h(h)·x_h ≤ (P - P_used)
        → Solution x_h*
```

**Why sequential fails:** Step 1 greedily maximizes flight value without considering that hotel awards might have HIGHER value per point. The constraint `P - P_used` in Step 2 is artificially restrictive.

### When Sequential WOULD Work (Special Cases)

Sequential optimization gives the global optimum ONLY if:

1. **No shared resources:** Flights and hotels use completely separate point pools
2. **Identical CPP:** All flight and hotel awards have the same cents-per-point value
3. **No trade-offs:** Selecting a flight never affects which hotel is optimal

None of these hold in our case, so **joint optimization is required**.

### Complexity Considerations

**Q: Does joint optimization significantly increase solver time?**

**A:** Not significantly, because:

1. **Hotel variables are simpler:** No routing constraints (flow conservation)
2. **Sparse coupling:** Flight-hotel interaction is only through:
   - Shared transfer pool (one set of constraints)
   - Date alignment (limited constraints)
3. **Limited hotel options:** Typically 10-50 hotels per destination vs. 100+ flights

**Expected impact:**
| Metric | Flights Only | Flights + Hotels |
|--------|--------------|------------------|
| Variables | ~1,000 | ~1,500 (+50%) |
| Constraints | ~2,000 | ~2,500 (+25%) |
| Solver time | ~0.5s | ~1.0s |

The CBC solver handles this easily.

---

## Current State Analysis

### Existing Transfer Graph (Hotels Already Supported!)

The `transfer_strategy.py` already defines hotel transfer partners:

```python
EXTENDED_TRANSFER_GRAPH = {
    "chase": {
        "UA": {"ratio": 1.0, "type": "airline", "name": "United MileagePlus"},
        "HYATT": {"ratio": 1.0, "type": "hotel", "name": "World of Hyatt"},
        "MAR": {"ratio": 1.0, "type": "hotel", "name": "Marriott Bonvoy"},
        "IHG": {"ratio": 1.0, "type": "hotel", "name": "IHG One Rewards"},
    },
    "amex": {
        "DL": {"ratio": 1.0, "type": "airline", "name": "Delta SkyMiles"},
        "HH": {"ratio": 2.0, "type": "hotel", "name": "Hilton Honors"},  # 1:2 ratio!
        "MAR": {"ratio": 1.0, "type": "hotel", "name": "Marriott Bonvoy"},
    },
    "bilt": {
        "HYATT": {"ratio": 1.0, "type": "hotel", "name": "World of Hyatt"},
        "IHG": {"ratio": 1.0, "type": "hotel", "name": "IHG One Rewards"},
        "MAR": {"ratio": 1.0, "type": "hotel", "name": "Marriott Bonvoy"},
    },
    # ... more banks
}
```

### Current ILP Structure (Flights Only)

```
Decision Variables:
- x[traveler][flight_edge]         # Flight selection
- z[(payer,traveler)][edge]        # Cash payment
- y[(payer,traveler)][(bank,airline)][edge]  # Points payment
- t_blocks[payer][(bank,airline)]  # Transfer blocks

Constraints:
- Path constraints (routing)
- Payment constraints
- Transfer constraints
- Chronological ordering
```

### Gap Analysis

| Aspect | Flights (Current) | Hotels (Needed) |
|--------|-------------------|-----------------|
| Routing | Complex graph traversal | No routing (location-bound) |
| Timing | Departure/arrival times | Check-in/check-out dates |
| Quantity | 1 flight per leg | N nights per destination |
| Selection | Choose from multiple flights | Choose from multiple hotels |
| Payment | Cash or points | Cash, points, or cash+points |
| Constraints | Flow conservation | Date alignment with flights |

---

## Proposed Architecture

### High-Level Design: Single Unified ILP

**Key Principle:** Flights and hotels are variables in the **SAME** ILP model, solved **SIMULTANEOUSLY**.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              USER REQUEST                                        │
│    • Flights: JFK → TYO → JFK                                                   │
│    • Hotels: 7 nights in Tokyo                                                  │
│    • Points: Chase 200K, Hyatt 50K                                             │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┴───────────────────────────┐
        ▼                                                       ▼
┌───────────────────────────┐                   ┌───────────────────────────┐
│     FLIGHT FETCHER        │                   │      HOTEL FETCHER        │
│  (AwardTool + SerpAPI)    │                   │  (Hotels API + Awards)    │
└───────────────┬───────────┘                   └───────────────┬───────────┘
                │                                               │
                ▼                                               ▼
┌───────────────────────────┐                   ┌───────────────────────────┐
│   Flight Edge Dictionary  │                   │   Hotel Edge Dictionary   │
│   {(O,D,flight): {...}}   │                   │   {(city,hotel,dates): {}}│
└───────────────┬───────────┘                   └───────────────┬───────────┘
                │                                               │
                └───────────────────────┬───────────────────────┘
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        UNIFIED ILP ADAPTER                                       │
│                                                                                 │
│    • Merge flight + hotel edges into SINGLE input structure                    │
│    • Build unified transfer graph (airlines + hotel programs)                  │
│    • Calculate link_ok for ALL programs                                        │
│    • Create SHARED source balance constraints                                   │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│                    ╔═══════════════════════════════════════╗                   │
│                    ║     SINGLE UNIFIED ILP MODEL          ║                   │
│                    ║   (Solved in ONE optimization pass)   ║                   │
│                    ╚═══════════════════════════════════════╝                   │
│                                                                                 │
│    ┌─────────────────────────────────────────────────────────────────────┐     │
│    │                      DECISION VARIABLES                             │     │
│    │                                                                     │     │
│    │  FLIGHTS                        HOTELS                              │     │
│    │  ────────                       ──────                              │     │
│    │  x_flight[p][e] ∈ {0,1}         x_hotel[p][h] ∈ {0,1}              │     │
│    │  z_flight[(q,p)][e]             z_hotel[(q,p)][h]                  │     │
│    │  y_flight[(q,p)][(s,a)][e]      y_hotel[(q,p)][(s,prog)][h]       │     │
│    │                                                                     │     │
│    │                    SHARED TRANSFER BLOCKS                           │     │
│    │                    ──────────────────────                           │     │
│    │            t_blocks[q][(bank, program)] ∈ {0,1,2,...}              │     │
│    │            (covers BOTH airlines AND hotel programs)                │     │
│    └─────────────────────────────────────────────────────────────────────┘     │
│                                                                                 │
│    ┌─────────────────────────────────────────────────────────────────────┐     │
│    │                         CONSTRAINTS                                 │     │
│    │                                                                     │     │
│    │  FLIGHT-SPECIFIC           HOTEL-SPECIFIC          COUPLING        │     │
│    │  ───────────────           ──────────────          ────────        │     │
│    │  • Path routing            • 1 hotel/dest          • Date align    │     │
│    │  • Flow conservation       • Hotel payment         • SHARED        │     │
│    │  • Chronological           • CPP thresholds          TRANSFER      │     │
│    │  • Flight payment                                    BUDGET        │     │
│    │                                                                     │     │
│    │                    ╔═════════════════════════════════╗              │     │
│    │                    ║  CRITICAL: SHARED CONSTRAINT    ║              │     │
│    │                    ║                                 ║              │     │
│    │                    ║  Σ points_flights + Σ points_hotels ≤ P       ║     │
│    │                    ║                                 ║              │     │
│    │                    ║  This is why we MUST solve      ║              │     │
│    │                    ║  flights + hotels TOGETHER!     ║              │     │
│    │                    ╚═════════════════════════════════╝              │     │
│    └─────────────────────────────────────────────────────────────────────┘     │
│                                                                                 │
│    ┌─────────────────────────────────────────────────────────────────────┐     │
│    │                      OBJECTIVE FUNCTION                             │     │
│    │                                                                     │     │
│    │  Maximize: W₁ × (flight_value + hotel_value)     ← Combined value  │     │
│    │          - W₂ × (flight_cash + hotel_cash)       ← Combined cost   │     │
│    │          - W₃ × (flight_time)                                      │     │
│    │          - W₄ × (routing_penalty)                                  │     │
│    │          + W₅ × (hotel_quality_bonus)            ← Optional        │     │
│    └─────────────────────────────────────────────────────────────────────┘     │
│                                                                                 │
│                                    │                                            │
│                          SOLVE (PuLP/CBC)                                       │
│                                    │                                            │
└────────────────────────────────────┼────────────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        UNIFIED SOLUTION                                          │
│                                                                                 │
│    The solver returns the GLOBALLY OPTIMAL allocation of points between        │
│    flights and hotels, not a greedy sequential allocation.                     │
│                                                                                 │
│    {                                                                            │
│        "flights": {...},      # Optimal flight itinerary                       │
│        "hotels": {...},       # Optimal hotel bookings                         │
│        "transfers": {...},    # Combined transfer strategy                     │
│        "totals": {                                                              │
│            "flight_cash": 1800,          # May be higher than flights-only!   │
│            "hotel_cash": 0,              # Because hotel CPP was better        │
│            "flight_points": 0,                                                  │
│            "hotel_points": 175000,                                              │
│            "total_cash": 1800,           # vs $4200 with sequential approach   │
│            "total_points_value": 4200,   # Better overall value                │
│        }                                                                        │
│    }                                                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture Guarantees Global Optimum

1. **Single feasibility region:** All constraints (flights + hotels + transfers) define ONE polytope
2. **Single objective:** Optimizer sees the full trade-off landscape
3. **Shared resources:** Transfer budget constraint spans both flight and hotel variables
4. **One solve:** CBC explores the entire solution space simultaneously

### Anti-Pattern: What NOT to Do

```
❌ WRONG: Sequential Optimization (Two Separate ILPs)
───────────────────────────────────────────────────
┌─────────────────────┐      ┌─────────────────────┐
│   FLIGHT ILP        │      │    HOTEL ILP        │
│                     │ ───► │                     │
│ Budget: 200K points │      │ Budget: 200K - F*   │ ← Artificially constrained!
│ Output: F* points   │      │ Output: H* points   │
└─────────────────────┘      └─────────────────────┘

This approach CANNOT discover that using 0 points on flights 
and 175K on hotels is globally better!
```

---

## Data Model Changes

### 1. Hotel Edge Definition

Create a new data structure for hotel "edges":

```python
# New type for hotel edges
HotelEdgeKey = Tuple[str, str, str, str]  # (city, hotel_id, check_in, check_out)

@dataclass
class HotelEdge:
    """Represents a hotel option in the optimization graph."""
    city: str                    # Airport code (e.g., "NRT" for Tokyo)
    hotel_id: str                # Unique hotel identifier
    hotel_name: str              # Display name
    check_in: str                # ISO date (YYYY-MM-DD)
    check_out: str               # ISO date
    nights: int                  # Number of nights
    
    # Cash booking
    cash_cost: float             # Total cash price for all nights
    cash_per_night: float        # Cash price per night
    
    # Award booking (optional)
    points_cost: Optional[int]   # Total points for all nights
    points_per_night: Optional[int]  # Points per night
    points_program: Optional[str]    # "HYATT", "MAR", "HH", "IHG"
    points_surcharge: float = 0.0    # Resort fees, taxes (if any)
    
    # Transfer partners
    transfer_partners: List[str] = field(default_factory=list)
    
    # Hotel attributes
    category: int = 0            # Award category (1-8 for Hyatt, 1-8 for Marriott)
    star_rating: float = 0.0     # Star rating
    
    @property
    def key(self) -> HotelEdgeKey:
        return (self.city, self.hotel_id, self.check_in, self.check_out)
    
    @property
    def has_award(self) -> bool:
        return self.points_cost is not None and self.points_cost > 0
    
    def cpp_value(self) -> float:
        """Calculate cents-per-point value."""
        if not self.has_award or self.points_cost <= 0:
            return 0.0
        cash_saved = self.cash_cost - self.points_surcharge
        if cash_saved <= 0:
            return 0.0
        return (cash_saved * 100.0) / self.points_cost
```

### 2. Extended Hotel Edge Dictionary

```python
hotel_edges_dict: Dict[HotelEdgeKey, Dict[str, Any]] = {
    ("NRT", "hyatt_park_tokyo", "2026-03-01", "2026-03-08"): {
        "hotel_name": "Park Hyatt Tokyo",
        "nights": 7,
        
        # Cash
        "cash_cost": 4200.0,        # $600/night × 7
        "cash_per_night": 600.0,
        
        # Award
        "points_cost": 175000,      # 25,000/night × 7
        "points_per_night": 25000,
        "points_program": "HYATT",
        "points_surcharge": 0.0,    # Hyatt has no surcharges!
        
        # Transfer partners
        "transfer_partners": ["chase", "bilt"],
        
        # Attributes
        "category": 7,              # Category 7 property
        "star_rating": 5.0,
    },
    ("NRT", "marriott_tokyo", "2026-03-01", "2026-03-08"): {
        "hotel_name": "Tokyo Marriott Hotel",
        "nights": 7,
        "cash_cost": 2100.0,        # $300/night × 7
        "points_cost": 280000,      # 40,000/night × 7
        "points_program": "MAR",
        "transfer_partners": ["chase", "amex", "bilt"],
        "category": 6,
    },
    # ... more hotels
}
```

### 3. Unified Program Types

```python
# Extend the models to handle both program types
class ProgramType(str, Enum):
    AIRLINE = "airline"
    HOTEL = "hotel"

@dataclass
class LoyaltyProgram:
    """Unified representation of airline or hotel program."""
    code: str                    # "UA", "HYATT", "MAR"
    name: str                    # "United MileagePlus", "World of Hyatt"
    program_type: ProgramType    # AIRLINE or HOTEL
    cpp_threshold: float         # Minimum CPP to use points
    has_surcharges: bool         # Does this program have significant fees?
```

### 4. Extended Constants

```python
# Add to constants.py

# Hotel-specific CPP thresholds
HOTEL_CPP_THRESHOLDS: Dict[str, float] = {
    "HYATT": 1.5,    # Hyatt typically gets ~2¢/point
    "HH": 0.4,       # Hilton averages ~0.5¢/point
    "MAR": 0.7,      # Marriott varies widely
    "IHG": 0.5,      # IHG around 0.5¢/point
}

# Hotel programs known for good value
HIGH_VALUE_HOTEL_PROGRAMS: Set[str] = {"HYATT"}

# Hotel programs with potential fees
HOTEL_PROGRAMS_WITH_FEES: Set[str] = {"MAR"}  # Resort fees sometimes apply
```

---

## ILP Model Extensions

### 1. New Decision Variables

```python
# ============================================================
# EXISTING FLIGHT VARIABLES (unchanged)
# ============================================================
x_flight = {p: {e: LpVariable(f"xf_{p}_{e}", cat="Binary") for e in flight_edges} for p in T}
z_flight = {...}  # Cash payment for flights
y_flight = {...}  # Points payment for flights

# ============================================================
# NEW HOTEL VARIABLES
# ============================================================

# Hotel selection: 1 if traveler p selects hotel h
x_hotel = {
    p: {
        h: pl.LpVariable(f"xh_{p}_{h}", cat="Binary")
        for h in hotel_edges
    }
    for p in T
}

# Cash payment for hotels
z_hotel = {
    (q, p): {
        h: pl.LpVariable(f"zh_{q}_{p}_{h}", cat="Binary")
        for h in hotel_edges
    }
    for q in T for p in T
}

# Points payment for hotels (via transfer)
y_hotel = {
    (q, p): {
        (s, prog): {
            h: pl.LpVariable(f"yh_{q}_{p}_{s}_{prog}_{h}", cat="Binary")
            for h in hotel_edges
        }
        for (s, prog) in allowed_hotel_transfers
    }
    for q in T for p in T
}

# Native hotel points payment
y_hotel_native = {
    (q, p): {
        prog: {
            h: pl.LpVariable(f"yhn_{q}_{p}_{prog}_{h}", cat="Binary")
            for h in hotel_edges
        }
        for prog in hotel_programs
    }
    for q in T for p in T
}

# ============================================================
# UNIFIED TRANSFER BLOCKS (covers both flights AND hotels)
# ============================================================

# Extend t_blocks to include hotel programs
t_blocks = {
    q: {
        (s, prog): pl.LpVariable(f"t_{q}_{s}_{prog}", lowBound=0, cat="Integer")
        for s in sources_by_trav.get(q, [])
        for prog in all_programs  # airlines + hotel_programs
        if (s, prog) in allowed_sa
    }
    for q in T
}
```

### 2. New Constraints

#### 2a. Hotel Selection Constraints

```python
# ============================================================
# HOTEL SELECTION: Exactly one hotel per destination per traveler
# ============================================================

# Group hotels by (city, date_range)
hotels_by_destination = {}  # {(city, check_in, check_out): [hotel_edges]}

for h in hotel_edges:
    city, hotel_id, check_in, check_out = h
    key = (city, check_in, check_out)
    hotels_by_destination.setdefault(key, []).append(h)

# Exactly one hotel at each required destination
for (city, check_in, check_out), hotels in hotels_by_destination.items():
    if city in required_hotel_cities:  # Destinations where hotel is needed
        for p in T:
            m += pl.lpSum(x_hotel[p][h] for h in hotels) == 1
```

#### 2b. Date Alignment Constraints

```python
# ============================================================
# DATE ALIGNMENT: Hotel dates must match flight arrival/departure
# ============================================================

# For each destination city with required hotel:
# - Hotel check-in must be >= flight arrival date
# - Hotel check-out must be <= flight departure date

for p in T:
    for city in must_visit_cities:
        # Find edges arriving at this city
        arriving_edges = [e for e in flight_edges if e[1] == city]
        # Find edges departing from this city
        departing_edges = [e for e in flight_edges if e[0] == city]
        # Find hotels at this city
        city_hotels = [h for h in hotel_edges if h[0] == city]
        
        for h in city_hotels:
            h_check_in = hotel_edges_dict[h]["check_in"]
            h_check_out = hotel_edges_dict[h]["check_out"]
            
            for arr_e in arriving_edges:
                arr_date = flight_edges_dict[arr_e]["arrival_date"]
                
                # If hotel check-in is before arrival, can't select both
                if h_check_in < arr_date:
                    m += x_hotel[p][h] + x_flight[p][arr_e] <= 1
            
            for dep_e in departing_edges:
                dep_date = flight_edges_dict[dep_e]["departure_date"]
                
                # If hotel check-out is after departure, can't select both
                if h_check_out > dep_date:
                    m += x_hotel[p][h] + x_flight[p][dep_e] <= 1
```

#### 2c. Hotel Payment Constraints

```python
# ============================================================
# HOTEL PAYMENT: Exactly one payment method per selected hotel
# ============================================================

for p in T:
    for h in hotel_edges:
        m += (
            pl.lpSum(z_hotel[(q, p)][h] for q in T)
            + pl.lpSum(
                y_hotel[(q, p)][(s, prog)][h]
                for q in T
                for (s, prog) in y_hotel[(q, p)].keys()
            )
            + pl.lpSum(
                y_hotel_native[(q, p)][prog][h]
                for q in T
                for prog in y_hotel_native[(q, p)].keys()
            )
            == x_hotel[p][h]
        )
```

#### 2d. Unified Transfer Constraints

```python
# ============================================================
# UNIFIED TRANSFER: Single pool of bank points for flights + hotels
# ============================================================

for q in T:
    for s in sources_by_trav.get(q, []):
        for prog in all_programs:  # airlines + hotel programs
            if (s, prog) not in allowed_sa:
                continue
            
            blk_size = inc_source.get((s, prog), 1000)
            r = ratio.get((s, prog), 1.0)
            b = bonus.get((s, prog), 1.0)
            delivered_per_block = blk_size * r * b
            
            # Sum of ALL points used via this transfer path (flights + hotels)
            total_points_used = (
                # Flight points
                pl.lpSum(
                    y_flight[(q, p)][(s, prog)][e] * get_flight_miles(prog, e)
                    for p in T
                    for e in flight_edges
                    if (s, prog) in y_flight[(q, p)].keys()
                )
                +
                # Hotel points
                pl.lpSum(
                    y_hotel[(q, p)][(s, prog)][h] * get_hotel_points(prog, h)
                    for p in T
                    for h in hotel_edges
                    if (s, prog) in y_hotel[(q, p)].keys()
                )
            )
            
            m += total_points_used <= t_blocks[q][(s, prog)] * delivered_per_block
```

#### 2e. Source Balance Constraints (Extended) - THE KEY COUPLING CONSTRAINT

```python
# ============================================================
# SOURCE BALANCE: Can't transfer more than you have (flights + hotels)
# ============================================================
# 
# THIS IS THE CRITICAL CONSTRAINT THAT REQUIRES JOINT OPTIMIZATION!
#
# If we solved flights and hotels separately:
#   - Flight ILP might use 190,000 Chase points
#   - Hotel ILP would only have 10,000 left
#   - But maybe hotels give 2.4 cpp vs flights at 1.3 cpp!
#
# With joint optimization, the solver sees BOTH uses of Chase points
# and can allocate optimally between them.

for q in T:
    for s in sources_by_trav.get(q, []):
        
        # ════════════════════════════════════════════════════════════
        # UNIFIED CONSTRAINT: flights + hotels share the same pool
        # ════════════════════════════════════════════════════════════
        
        # Points used for FLIGHTS via this source
        flight_points_from_source = pl.lpSum(
            t_blocks[q][(s, airline)] * inc_source.get((s, airline), 1000)
            for airline in airlines
            if (s, airline) in t_blocks[q]
        )
        
        # Points used for HOTELS via this source
        hotel_points_from_source = pl.lpSum(
            t_blocks[q][(s, hotel_prog)] * inc_source.get((s, hotel_prog), 1000)
            for hotel_prog in hotel_programs
            if (s, hotel_prog) in t_blocks[q]
        )
        
        # COMBINED constraint: total from this source ≤ balance
        m += (flight_points_from_source + hotel_points_from_source 
              <= source_balances.get((q, s), 0.0))
        
        # This single constraint is why we CANNOT solve sequentially!
        # The solver must see both flight_points and hotel_points
        # to make the optimal trade-off.
```

### Mathematical Formulation: Why Joint Optimization is Required

**The Unified ILP Model:**

```
SETS:
  T = travelers
  F = flight edges
  H = hotel edges
  S = bank sources (chase, amex, citi, ...)
  A = airline programs (UA, AA, DL, ...)
  P = hotel programs (HYATT, MAR, HH, ...)

PARAMETERS:
  B[s] = balance of source s (e.g., Chase points)
  c_f[f] = cash cost of flight f
  c_h[h] = cash cost of hotel h
  m_f[a,f] = miles needed for flight f via airline a
  m_h[p,h] = points needed for hotel h via program p
  v_f[f] = cash value saved if flight f booked on points
  v_h[h] = cash value saved if hotel h booked on points
  r[s,a] = transfer ratio from source s to airline a
  r[s,p] = transfer ratio from source s to hotel program p

DECISION VARIABLES:
  x_f[f] ∈ {0,1}           = 1 if flight f is selected
  x_h[h] ∈ {0,1}           = 1 if hotel h is selected
  y_f[s,a,f] ∈ {0,1}       = 1 if flight f paid via source s → airline a
  y_h[s,p,h] ∈ {0,1}       = 1 if hotel h paid via source s → program p
  t[s,a] ∈ Z⁺              = blocks transferred from s to a (flights)
  t[s,p] ∈ Z⁺              = blocks transferred from s to p (hotels)

OBJECTIVE (OOP Mode):
  Maximize:
    Σ_f v_f[f] · y_f[*,*,f]     (flight points value)
  + Σ_h v_h[h] · y_h[*,*,h]     (hotel points value)
  - W_cash · (cash spent)        (minimize cash)
  - W_time · (travel time)       (minimize time)

CONSTRAINTS:

  (1) Flight path constraints (existing)
      ... flow conservation, must-visit, etc.

  (2) Hotel selection constraints (new)
      Σ_{h ∈ hotels_at_city_c} x_h[h] = 1    ∀ city c requiring hotel

  (3) Flight payment
      Σ_{s,a} y_f[s,a,f] + z_f[f] = x_f[f]   ∀ flight f

  (4) Hotel payment
      Σ_{s,p} y_h[s,p,h] + z_h[h] = x_h[h]   ∀ hotel h

  (5) Transfer block sufficiency
      Σ_{f} y_f[s,a,f] · m_f[a,f] ≤ t[s,a] · 1000 · r[s,a]     ∀ (s,a)
      Σ_{h} y_h[s,p,h] · m_h[p,h] ≤ t[s,p] · 1000 · r[s,p]     ∀ (s,p)

  ╔═══════════════════════════════════════════════════════════════════════╗
  ║ (6) SOURCE BALANCE - THE COUPLING CONSTRAINT                          ║
  ║                                                                       ║
  ║     Σ_a t[s,a] · 1000 + Σ_p t[s,p] · 1000 ≤ B[s]     ∀ source s     ║
  ║     ─────────────────   ─────────────────                             ║
  ║      flights portion     hotels portion                               ║
  ║                                                                       ║
  ║     This constraint couples flight and hotel variables!               ║
  ║     The solver MUST see both to find the optimal split.               ║
  ╚═══════════════════════════════════════════════════════════════════════╝
```

**Why Sequential Fails - Formal Proof:**

Consider a simple case:
- Budget: B = 200,000 Chase points
- Flight option: 190,000 miles, saves $2,500 (1.32 cpp)
- Hotel option: 175,000 points, saves $4,200 (2.40 cpp)

**Sequential Approach:**
```
Step 1: max 2500 · x_f  s.t. 190000 · x_f ≤ 200000
        → x_f* = 1, uses 190,000 points

Step 2: max 4200 · x_h  s.t. 175000 · x_h ≤ 10000  ← Only 10K left!
        → x_h* = 0, infeasible to use points

Result: Value = $2,500, Cash spent = $4,200 on hotel
```

**Joint Approach:**
```
max 2500 · x_f + 4200 · x_h
s.t. 190000 · x_f + 175000 · x_h ≤ 200000

Solutions:
  (x_f=1, x_h=0): Value = 2500, feasible (190K ≤ 200K)
  (x_f=0, x_h=1): Value = 4200, feasible (175K ≤ 200K) ← BETTER!
  (x_f=1, x_h=1): Value = 6700, infeasible (365K > 200K)

Result: x_f*=0, x_h*=1, Value = $4,200
```

**The joint approach finds $1,700 more value!**

### 3. Extended Objective Function

```python
# ============================================================
# UNIFIED OBJECTIVE: Flights + Hotels
# ============================================================

# Flight costs (existing)
flight_cash_expr = pl.lpSum(
    z_flight[(q, p)][e] * flight_cash_cost.get(e, 0.0)
    for q in T for p in T for e in flight_edges
)
flight_surcharge_expr = pl.lpSum(
    y_flight[(q, p)][(s, a)][e] * get_flight_tax(a, e)
    for q in T for p in T for (s, a) in y_flight[(q, p)].keys() for e in flight_edges
)
flight_points_value_expr = pl.lpSum(
    y_flight[(q, p)][(s, a)][e] * (flight_cash_cost.get(e, 0) - get_flight_tax(a, e))
    for q in T for p in T for (s, a) in y_flight[(q, p)].keys() for e in flight_edges
)

# Hotel costs (NEW)
hotel_cash_expr = pl.lpSum(
    z_hotel[(q, p)][h] * hotel_cash_cost.get(h, 0.0)
    for q in T for p in T for h in hotel_edges
)
hotel_surcharge_expr = pl.lpSum(
    y_hotel[(q, p)][(s, prog)][h] * get_hotel_surcharge(prog, h)
    for q in T for p in T for (s, prog) in y_hotel[(q, p)].keys() for h in hotel_edges
)
hotel_points_value_expr = pl.lpSum(
    y_hotel[(q, p)][(s, prog)][h] * (hotel_cash_cost.get(h, 0) - get_hotel_surcharge(prog, h))
    for q in T for p in T for (s, prog) in y_hotel[(q, p)].keys() for h in hotel_edges
)

# Combined expressions
total_cash_expr = flight_cash_expr + flight_surcharge_expr + hotel_cash_expr + hotel_surcharge_expr
total_points_value = flight_points_value_expr + hotel_points_value_expr

# Objective (OOP mode)
if mode == "money_saving":
    m += (
        W_savings * total_points_value
        - W_cash * total_cash_expr
        - W_time * total_time_expr           # Flights only
        - W_extra_city * extra_city_penalty  # Flights only
        - W_connection * extra_connections   # Flights only
        + W_hotel_quality * hotel_quality_expr  # NEW: Prefer better hotels
    )
```

---

## Implementation Phases

### Phase 1: Data Layer (Week 1-2)

**Files to Modify/Create:**

| File | Changes |
|------|---------|
| `optimization/models.py` | Add `HotelEdge`, `HotelEdgeKey`, `ProgramType` |
| `optimization/constants.py` | Add `HOTEL_CPP_THRESHOLDS`, hotel programs |
| `transfer_strategy.py` | Already has hotel support - minor updates |
| `handlers/hotels.py` | Add hotel award fetching (new) |

**Tasks:**

1. [ ] Define `HotelEdge` dataclass
2. [ ] Define `HotelEdgeKey` type alias
3. [ ] Add hotel CPP thresholds to constants
4. [ ] Create hotel award data fetcher
5. [ ] Add hotel edge dictionary builder

**Deliverable:** Hotel edge dictionary can be built from hotel search results.

### Phase 2: ILP Adapter (Week 2-3)

**Files to Modify:**

| File | Changes |
|------|---------|
| `handlers/ilp_adapter.py` | Add `build_hotel_ilp_inputs()`, extend unified adapter |

**Tasks:**

1. [ ] Create `build_hotel_ilp_inputs_from_edges()` function
2. [ ] Extend `link_ok` calculation for hotel programs
3. [ ] Create unified adapter that combines flights + hotels
4. [ ] Handle native hotel points balances

**Deliverable:** Unified ILP inputs can be generated from flights + hotels.

### Phase 3: ILP Solver Extension (Week 3-4)

**Files to Modify:**

| File | Changes |
|------|---------|
| `handlers/points_maximizer.py` | Add hotel variables, constraints, objective terms |
| `optimization/constraints.py` | Add hotel constraint builders |

**Tasks:**

1. [ ] Add hotel decision variables (`x_hotel`, `z_hotel`, `y_hotel`)
2. [ ] Add hotel selection constraints
3. [ ] Add date alignment constraints
4. [ ] Extend transfer constraints to include hotels
5. [ ] Extend objective function
6. [ ] Add solution extraction for hotels

**Deliverable:** ILP can optimize flights + hotels jointly.

### Phase 4: Solution Extraction & Output (Week 4-5)

**Files to Modify:**

| File | Changes |
|------|---------|
| `handlers/points_maximizer.py` | Extend solution extraction |
| `handlers/transfer_strategy.py` | Add hotel transfer instructions |

**Tasks:**

1. [ ] Extract hotel selections from ILP solution
2. [ ] Generate unified transfer instructions (flights + hotels)
3. [ ] Calculate combined totals
4. [ ] Format output for frontend

**Deliverable:** Complete solution with flight + hotel + transfer instructions.

### Phase 5: API Integration (Week 5-6)

**Files to Modify:**

| File | Changes |
|------|---------|
| `services/itinerary_service.py` | Add hotel fetching, call unified optimizer |
| `routes/optimize.py` | Update API endpoints |
| `handlers/hotels.py` | Hotel search integration |

**Tasks:**

1. [ ] Add hotel search to itinerary service
2. [ ] Update optimization API to include hotels
3. [ ] Add caching for hotel award availability
4. [ ] Update response format

**Deliverable:** API can optimize trips with hotels.

### Phase 6: Testing & Refinement (Week 6-7)

**Tasks:**

1. [ ] Unit tests for hotel ILP components
2. [ ] Integration tests for unified optimizer
3. [ ] Performance testing (solver time with hotels)
4. [ ] Edge case handling
5. [ ] CPP threshold tuning for hotels

---

## API Changes

### Request Format (Extended)

```python
{
    "trip_id": "abc123",
    "travelers": ["traveler_1"],
    "start_city": "JFK",
    "destinations": [
        {
            "city": "TYO",
            "arrive_date": "2026-03-01",
            "depart_date": "2026-03-08",
            "need_hotel": True,  # NEW
            "hotel_preferences": {  # NEW
                "min_stars": 4,
                "max_points_per_night": 50000,
                "preferred_programs": ["HYATT", "MAR"],
            }
        }
    ],
    "end_city": "JFK",
    "user_points": {
        "traveler_1": {
            "Chase Ultimate Rewards": 200000,
            "World of Hyatt": 50000,
        }
    },
    "optimization_mode": "oop",
    "include_hotels": True,  # NEW
}
```

### Response Format (Extended)

```python
{
    "status": "Optimal",
    
    # Flight solution (existing)
    "flights": {
        "path": ["JFK", "NRT", "JFK"],
        "edges": [["JFK", "NRT", "NH10"], ["NRT", "JFK", "NH11"]],
        "pay_mode": [...],
    },
    
    # Hotel solution (NEW)
    "hotels": {
        "traveler_1": [
            {
                "city": "NRT",
                "hotel_id": "hyatt_park_tokyo",
                "hotel_name": "Park Hyatt Tokyo",
                "check_in": "2026-03-01",
                "check_out": "2026-03-08",
                "nights": 7,
                "payment": {
                    "type": "points",
                    "program": "HYATT",
                    "points_used": 175000,
                    "cash_paid": 0,
                    "cash_equivalent": 4200,
                    "cpp": 2.4,
                },
            }
        ]
    },
    
    # Combined totals
    "totals": {
        "flight_cash": 250,
        "flight_points": 190000,
        "hotel_cash": 0,
        "hotel_points": 175000,
        "total_cash": 250,
        "total_points_used": 365000,
        "total_points_value": 6500,  # Cash equivalent saved
        "average_cpp": 1.78,
    },
    
    # Unified transfer strategy
    "transfers": {
        "traveler_1": {
            "chase": {
                "NH": {
                    "points_to_transfer": 190000,
                    "miles_received": 190000,
                },
                "HYATT": {
                    "points_to_transfer": 125000,  # Remaining after using native
                    "points_received": 125000,
                },
            },
        },
    },
    
    # Step-by-step transfer instructions
    "transfer_instructions": [
        {
            "step": 1,
            "action": "Transfer Chase → HYATT",
            "points": 125000,
            "description": "Transfer to cover remaining Hyatt nights",
        },
        {
            "step": 2,
            "action": "Transfer Chase → ANA",
            "points": 190000,
            "description": "Transfer for round-trip flights",
        },
        {
            "step": 3,
            "action": "Book Park Hyatt Tokyo",
            "points": 175000,
            "source": "50K native + 125K transferred",
        },
        {
            "step": 4,
            "action": "Book ANA flights",
            "points": 190000,
        },
    ],
}
```

---

## Testing Strategy

### Unit Tests

```python
# test_hotel_ilp.py

def test_hotel_edge_creation():
    """Test hotel edge dictionary is built correctly."""
    pass

def test_hotel_link_ok_calculation():
    """Test link_ok includes hotel programs."""
    pass

def test_hotel_selection_constraint():
    """Test exactly one hotel is selected per destination."""
    pass

def test_date_alignment_constraint():
    """Test hotel dates align with flight dates."""
    pass

def test_unified_transfer_constraint():
    """Test transfer budget is shared between flights and hotels."""
    pass

def test_hotel_cpp_calculation():
    """Test CPP is calculated correctly for hotels."""
    pass
```

### Integration Tests

```python
# test_unified_optimization.py

def test_flight_only_optimization():
    """Existing flights-only optimization still works."""
    pass

def test_hotel_only_optimization():
    """Hotels can be optimized without flights."""
    pass

def test_flight_plus_hotel_optimization():
    """Joint optimization produces valid solution."""
    pass

def test_transfer_allocation():
    """Points are allocated optimally between flights and hotels."""
    pass

def test_native_points_usage():
    """Native hotel points are used before transfers."""
    pass
```

### Performance Tests

```python
def test_solver_time_with_hotels():
    """Solver completes in reasonable time with hotels."""
    # Target: <5 seconds for typical trip
    pass

def test_large_hotel_selection():
    """Solver handles many hotel options."""
    # Target: 50+ hotel options per city
    pass
```

---

## Summary

### Key Implementation Points

1. **Hotel edges are simpler than flights:** No routing, just selection at fixed locations
2. **Transfer pools are unified:** Points can go to flights OR hotels
3. **Date constraints link flights and hotels:** Check-in/out must align with arrivals/departures
4. **CPP thresholds differ:** Hotels (especially Hyatt) often have better CPP than flights
5. **Existing code reuse:** Transfer graph already supports hotels!

### Expected Benefits

| Metric | Current | With Hotels |
|--------|---------|-------------|
| Optimization scope | Flights only | Flights + Hotels |
| Points allocation | Single category | Cross-category optimization |
| User value | Good flight deals | Best overall trip value |
| Transfer efficiency | One transfer type | Combined transfers |

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Solver time increases | Pre-filter hotels, limit options per city |
| Hotel award availability varies | Cache availability, fallback to cash |
| Complex date alignment | Clear date constraints, validation |
| Hotel programs change | Configurable program definitions |

---

## Next Steps

1. **Immediate:** Review this plan with the team
2. **Week 1:** Start Phase 1 (Data Layer)
3. **Ongoing:** Update this document as implementation progresses
4. **Post-implementation:** Document learnings and optimizations
