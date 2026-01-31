# ILP Algorithm: Comprehensive Technical Documentation

This document provides an in-depth technical explanation of Tripy's Integer Linear Programming (ILP) optimization algorithm, covering inputs, outputs, intermediate data structures, data flow, and implementation details.

## Table of Contents

1. [Overview](#overview)
2. [High-Level Data Flow](#high-level-data-flow)
3. [Input Specifications](#input-specifications)
4. [Data Transformation Pipeline](#data-transformation-pipeline)
5. [ILP Model Structure](#ilp-model-structure)
6. [Optimization Modes](#optimization-modes)
7. [Output Specifications](#output-specifications)
8. [Worked Examples](#worked-examples)
9. [Edge Cases and Error Handling](#edge-cases-and-error-handling)

---

## Overview

### What is ILP?

**Integer Linear Programming (ILP)** is a mathematical optimization technique where:
- The **objective function** is linear (a weighted sum of variables)
- The **constraints** are linear equations or inequalities
- Some or all variables are restricted to **integer values** (including binary 0/1)

Tripy uses ILP to find the optimal combination of:
- Which flights to take for a multi-city itinerary
- How to pay for each flight (cash vs. points)
- Which points programs to use and how much to transfer
- How to minimize cost while respecting time and routing constraints

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| **ILP Solver** | `points_maximizer.py` | Core optimization model with PuLP/CBC |
| **Data Adapter** | `ilp_adapter.py` | Transforms flight edges into ILP inputs |
| **Models** | `optimization/models.py` | Data classes for typed inputs/outputs |
| **Constraints** | `optimization/constraints.py` | Modular constraint builders |
| **Constants** | `optimization/constants.py` | Configuration, thresholds, hub cities |
| **Transfer Strategy** | `transfer_strategy.py` | Transfer graph and instruction generation |

---

## High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              USER REQUEST                                        │
│    • Trip dates, destinations (e.g., JFK → AUH → DXB → JFK)                    │
│    • Traveler points balances (Chase: 150K, Amex: 80K, United: 45K)           │
│    • Preferences (optimize for OOP or CPP)                                      │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         1. FLIGHT DATA FETCHING                                 │
│                                                                                 │
│    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐            │
│    │  AwardTool v2   │   │    SerpAPI      │   │   Panorama      │            │
│    │  (award flights)│   │  (cash flights) │   │ (date calendar) │            │
│    └────────┬────────┘   └────────┬────────┘   └────────┬────────┘            │
│             │                     │                     │                      │
│             └─────────────────────┼─────────────────────┘                      │
│                                   ▼                                            │
│                       MERGE & DEDUPLICATE FLIGHTS                              │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         2. BUILD EDGE DICTIONARY                                │
│                                                                                 │
│    edges_dict = {                                                               │
│        (origin, dest, flight_num): {                                           │
│            "cash_cost": float,           # USD price                           │
│            "points_cost": int,           # Miles required                      │
│            "points_program": str,        # "UA", "AA", etc.                   │
│            "points_surcharge": float,    # Taxes/fees for award               │
│            "transfer_partners": list,    # ["chase", "amex"]                  │
│            "time_cost": float,           # Travel time (minutes)              │
│            "departure_time": str,        # ISO datetime                       │
│            "arrival_time": str,          # ISO datetime                       │
│        },                                                                       │
│        ...                                                                      │
│    }                                                                            │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     3. ILP ADAPTER: build_ilp_inputs_from_edges()              │
│                                                                                 │
│    Transforms raw edges into structured ILP inputs:                            │
│    • Split user points into banks vs. airlines                                 │
│    • Build transfer graph constraints                                          │
│    • Calculate link_ok eligibility matrix                                      │
│    • Extract departure/arrival times for chronological ordering                │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     4. ILP SOLVER: plan_maximize_points_value()                │
│                                                                                 │
│    1. Create decision variables (x, z, y, y_native, t_blocks)                  │
│    2. Apply constraints (path, payment, transfer, chronological)               │
│    3. Build objective function (based on optimization mode)                    │
│    4. Solve with PuLP CBC solver                                               │
│    5. Extract solution (paths, payments, transfers)                            │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         5. SOLUTION OUTPUT                                      │
│                                                                                 │
│    {                                                                            │
│        "status": "Optimal",                                                    │
│        "path": {"traveler_1": ["JFK", "AUH", "DXB", "JFK"]},                  │
│        "edges": {"traveler_1": [["JFK", "AUH", "EY101"], ...]},               │
│        "pay_mode": [{"type": "points", "via": {"source": "chase", ...}}],     │
│        "totals": {                                                              │
│            "airline_points": 105000,                                           │
│            "cash": 260,                                                         │
│            "time": 2280,                                                        │
│            "points_value": 2460,                                               │
│            "transfers": {"traveler_1": {"chase": {"AA": {...}}}},             │
│        }                                                                        │
│    }                                                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Input Specifications

### 1. Edge Dictionary (Raw Flight Data)

The primary input is a dictionary of flight edges with pricing information.

```python
EdgeKey = Tuple[str, str, str]  # (origin_airport, destination_airport, flight_number)

edges_dict: Dict[EdgeKey, Dict[str, Any]] = {
    ("JFK", "DXB", "EK201"): {
        # Cash booking
        "cash_cost": 1200.0,              # USD price for revenue ticket
        
        # Award booking (optional - not all flights have award availability)
        "points_cost": 62500,             # Miles required
        "points_program": "EK",           # Airline code for award booking
        "points_surcharge": 150.0,        # Taxes/fees for award ($)
        "transfer_partners": ["chase", "amex"],  # Banks that can transfer
        
        # Schedule information
        "time_cost": 840.0,               # Total travel time (minutes)
        "departure_time": "2026-02-25T22:00:00",  # ISO datetime
        "arrival_time": "2026-02-26T19:30:00",
        
        # Operating carrier
        "operating_airline": "EK",
    },
    # ... more edges
}
```

**Required Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `cash_cost` | float | Cash price in USD (required) |
| `time_cost` | float | Total travel time in minutes |

**Optional Award Fields:**
| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `points_cost` | int | Miles required for award | None (no award) |
| `points_program` | str | Airline code (e.g., "UA") | None |
| `points_surcharge` | float | Taxes/fees for award | 0.0 |
| `transfer_partners` | List[str] | Banks that can transfer | [] |

**Schedule Fields (for chronological ordering):**
| Field | Type | Description |
|-------|------|-------------|
| `departure_time` | str | ISO datetime of departure |
| `arrival_time` | str | ISO datetime of arrival |

### 2. Traveler Information

```python
travelers: List[str] = ["traveler_1", "traveler_2"]

start_city_by_trav: Dict[str, str] = {
    "traveler_1": "JFK",
    "traveler_2": "JFK",
}

end_city_by_trav: Dict[str, str] = {
    "traveler_1": "JFK",  # Round trip: same as start
    "traveler_2": "JFK",
}

must_visit_cities: List[str] = ["AUH", "DXB"]  # Intermediate destinations
```

### 3. User Points Balances

```python
user_points_by_trav: Dict[str, Dict[str, int]] = {
    "traveler_1": {
        # Bank/transferable points (keys are program names)
        "Chase Ultimate Rewards": 150000,
        "Amex Membership Rewards": 80000,
        
        # Native airline miles (use directly, no transfer)
        "United MileagePlus": 45000,
        "Delta SkyMiles": 20000,
    },
}
```

**The adapter automatically splits these into:**
- **Banks (transferable):** `{("traveler_1", "chase"): 150000, ("traveler_1", "amex"): 80000}`
- **Airlines (native):** `{("traveler_1", "UA"): 45000, ("traveler_1", "DL"): 20000}`

### 4. Transfer Graph (Bank → Airline mappings)

```python
DEFAULT_TRANSFER_GRAPH: Dict[str, Dict[str, float]] = {
    "chase": {
        "UA": 1.0,   # Chase → United at 1:1
        "BA": 1.0,   # Chase → British Airways at 1:1
        "AF": 1.0,   # Chase → Air France at 1:1
        "SQ": 1.0,   # Chase → Singapore at 1:1
        "HYATT": 1.0,
    },
    "amex": {
        "DL": 1.0,   # Amex → Delta at 1:1
        "BA": 1.0,
        "AF": 1.0,
        "NH": 1.0,   # ANA
    },
    "citi": {
        "AA": 1.0,   # Citi → American at 1:1
        "TK": 1.0,   # Turkish
    },
    "capitalone": {
        "BA": 0.75,  # Capital One → BA at 1:0.75 (worse ratio!)
        "AF": 1.0,
    },
    "bilt": {
        "UA": 1.0,
        "AA": 1.0,
        "HYATT": 1.0,
    },
}
```

### 5. Configuration Options

```python
# Optimization mode
optimization_mode: Literal["oop", "cpp", "money_saving", "cpp_focused", "balanced"]

# OOP Mode: Minimize out-of-pocket cash
# CPP Mode: Maximize cents-per-point value

# Other options
allow_all_payers: bool = True        # Any traveler can pay for any other
default_cash_budget: float = 1e9     # Effectively unlimited
bank_block_size: int = 1000          # Minimum transfer increment
```

---

## Data Transformation Pipeline

### Stage 1: Edge Dictionary → ILP Inputs

The `build_ilp_inputs_from_edges()` function transforms the raw edge dictionary into structured ILP inputs.

```python
def build_ilp_inputs_from_edges(
    edges_dict,                    # Raw flight edges
    travelers,                     # List of traveler IDs
    start_city_by_trav,           # Starting airports
    end_city_by_trav,             # Ending airports
    user_points_by_trav,          # Points balances
    *,
    meetup_cities=None,           # Cities where travelers must meet
    transfer_graph=None,          # Bank → Airline mappings
    transfer_bonuses=None,        # Promotional bonuses
    bank_block_size=1000,         # Minimum transfer increment
    default_cash_if_missing=1e7,  # Fallback for missing prices
    allow_all_payers=True,        # Payment restrictions
) -> Dict[str, Any]:
```

**Output Structure:**

```python
ilp_inputs = {
    # Travelers and routing
    "travelers": ["traveler_1"],
    "start_city": {"traveler_1": "JFK"},
    "end_city": {"traveler_1": "JFK"},
    "cities": ["JFK", "AUH", "DXB", "BAH", ...],  # All cities in graph
    "edges": [("JFK", "AUH", "EY101"), ...],      # All edge keys
    
    # Edge costs
    "time_cost": {("JFK", "AUH", "EY101"): 840.0, ...},
    "cash_cost": {("JFK", "AUH", "EY101"): 1500.0, ...},
    "departure_time": {("JFK", "AUH", "EY101"): "2026-02-25T22:00:00", ...},
    "arrival_time": {("JFK", "AUH", "EY101"): "2026-02-26T08:00:00", ...},
    
    # Airlines and award pricing
    "airlines": ["EY", "AA", "UA", ...],
    "award_points": {
        "EY": {("JFK", "AUH", "EY101"): 75000.0, ...},
        "AA": {("JFK", "AUH", "EY101"): 0.0, ...},  # 0 = not available via AA
    },
    "cash_surcharge": {
        "EY": {("JFK", "AUH", "EY101"): 100.0, ...},
    },
    "allowed_award_edge": {
        "EY": {("JFK", "AUH", "EY101"): 1, ...},  # 1 = can price this edge
    },
    
    # Points balances (split by adapter)
    "sources_by_trav": {"traveler_1": ["chase", "amex"]},
    "source_balances": {("traveler_1", "chase"): 150000.0, ...},
    "miles_balance": {("traveler_1", "UA"): 45000.0, ...},
    
    # Transfer rules
    "allowed_sa": {("chase", "UA"), ("chase", "BA"), ...},  # Valid transfers
    "ratio": {("chase", "UA"): 1.0, ("capitalone", "BA"): 0.75, ...},
    "bonus": {("chase", "UA"): 1.0, ...},  # Promotional multipliers
    "inc_source": {("chase", "UA"): 1000, ...},  # Block sizes
    
    # Eligibility
    "link_ok": {("traveler_1", "UA"): 1, ...},  # Can this traveler use this airline?
    "can_pay_for": {("traveler_1", "traveler_1"): 1, ...},  # Who can pay for whom
    "budget_cash": {"traveler_1": 1e9},
    
    # Capacity (usually unlimited)
    "total_cash_seats": {},
    "award_seats": {},
    
    # Required stops
    "meetup_cities": ["AUH", "DXB"],
}
```

### Stage 2: Eligibility Calculation (link_ok)

The `link_ok` matrix determines which traveler can use which airline's awards.

```python
# link_ok[(traveler, airline)] = 1 if:
#   1. Traveler has native miles in that airline, OR
#   2. Traveler has bank points that can transfer to that airline

for trav in travelers:
    banks = set(sources_by_trav.get(trav, []))  # ["chase", "amex"]
    
    for airline in airlines:
        link = 0
        
        # Check native miles
        if (trav, airline) in miles_balance and miles_balance[(trav, airline)] > 0:
            link = 1
        else:
            # Check if any bank can transfer to this airline
            for bank in banks:
                if (bank, airline) in allowed_sa:
                    link = 1
                    break
        
        link_ok[(trav, airline)] = link
```

**Example:**
```
Traveler has: Chase (150K), Amex (80K), United miles (45K)
Airlines in graph: UA, AA, EK, BA

link_ok[("traveler_1", "UA")] = 1  # Native UA miles + Chase→UA
link_ok[("traveler_1", "AA")] = 0  # No AA miles, no bank transfers to AA
link_ok[("traveler_1", "EK")] = 1  # Chase→EK, Amex→EK
link_ok[("traveler_1", "BA")] = 1  # Chase→BA, Amex→BA
```

---

## ILP Model Structure

### Decision Variables

The ILP uses several types of binary and integer variables.

#### 1. Edge Selection: `x[traveler][edge]`

```python
x[p][e] ∈ {0, 1}  # 1 if traveler p uses edge e, 0 otherwise
```

**Example:**
```python
x["john"][("JFK", "AUH", "EY101")] = 1  # John takes EY101 from JFK to AUH
x["john"][("JFK", "DXB", "EK201")] = 0  # John doesn't take this flight
```

#### 2. Cash Payment: `z[(payer, traveler)][edge]`

```python
z[(q, p)][e] ∈ {0, 1}  # 1 if payer q pays CASH for traveler p on edge e
```

**Example:**
```python
z[("john", "john")][("AUH", "DXB", "EY401")] = 1  # John pays cash for his flight
z[("john", "jane")][("AUH", "DXB", "EY401")] = 0  # John not paying cash for Jane
```

#### 3. Points via Transfer: `y[(payer, traveler)][(bank, airline)][edge]`

```python
y[(q, p)][(s, a)][e] ∈ {0, 1}
# 1 if payer q uses bank s transferred to airline a for traveler p on edge e
```

**Example:**
```python
y[("john", "john")][("chase", "UA")][("JFK", "AUH", "EY101")] = 1
# John transfers Chase points to United to book this flight
```

#### 4. Native Points: `y_native[(payer, traveler)][airline][edge]`

```python
y_native[(q, p)][a][e] ∈ {0, 1}
# 1 if payer q uses existing airline a miles for traveler p on edge e
```

**Example:**
```python
y_native[("john", "john")]["UA"][("JFK", "AUH", "EY101")] = 1
# John uses his existing United miles directly
```

#### 5. Transfer Blocks: `t_blocks[payer][(bank, airline)]`

```python
t_blocks[q][(s, a)] ∈ {0, 1, 2, 3, ...}  # Integer, number of 1000-point blocks
```

**Example:**
```python
t_blocks["john"][("chase", "UA")] = 78
# John transfers 78 × 1000 = 78,000 Chase points to United
```

### Constraints

#### 1. Path Constraints

**Start Constraint:** Exactly 1 edge leaves start city

```python
∑{e: origin(e) = start_city[p]} x[p][e] = 1
```

**End Constraint:** Exactly 1 edge arrives at end city

```python
∑{e: dest(e) = end_city[p]} x[p][e] = 1
```

**Flow Conservation:** For intermediate cities, inflow = outflow

```python
# For round trips (start == end):
∑{e: origin(e) = city} x[p][e] = ∑{e: dest(e) = city} x[p][e]

# For one-way starts: net outflow of 1
# For one-way ends: net inflow of 1
# For transit: strict flow conservation
```

**Must-Visit Constraint:** Each destination visited at least once

```python
For each must_visit city c:
    ∑{e: dest(e) = c} x[p][e] ≥ 1
```

#### 2. Chronological Ordering Constraints

Ensures connections have sufficient time (60+ minutes minimum).

```python
MIN_CONNECTION_TIME = 60  # minutes

For each city c:
    For each pair (arriving_edge e1, departing_edge e2):
        if departure_time(e2) < arrival_time(e1) + MIN_CONNECTION_TIME:
            x[p][e1] + x[p][e2] ≤ 1  # Can't select both
```

**Special handling for round trips:** The constraint is NOT applied at the start city between return arrivals and outbound departures (they're at opposite ends of the trip, not consecutive).

#### 3. Payment Constraints

**Exactly one payment method per selected edge:**

```python
∑{q} z[(q,p)][e] + ∑{q,s,a} y[(q,p)][(s,a)][e] + ∑{q,a} y_native[(q,p)][a][e] = x[p][e]
```

If edge is selected (x=1), exactly one payment variable must be 1.
If edge is not selected (x=0), all payment variables must be 0.

**Can-pay-for restrictions:**

```python
z[(q,p)][e] ≤ can_pay_for[(q,p)]
y[(q,p)][(s,a)][e] ≤ can_pay_for[(q,p)]
```

#### 4. Transfer Constraints

**Points transferred must fit in blocks:**

```python
∑{p,e} y[(q,p)][(s,a)][e] × miles[a][e] ≤ t_blocks[q][(s,a)] × block_size × ratio × bonus
```

**Can't transfer more than balance:**

```python
∑{a} t_blocks[q][(s,a)] × block_size ≤ source_balance[q][s]
```

#### 5. Native Miles Constraints

```python
∑{p,e} y_native[(q,p)][a][e] × miles[a][e] ≤ miles_balance[(q,a)]
```

#### 6. Eligibility Constraints

```python
y[(q,p)][(s,a)][e] ≤ link_ok[(q,a)] × can_price[a][e]
y_native[(q,p)][a][e] ≤ link_ok[(q,a)] × can_price[a][e]
```

---

## Optimization Modes

### Mode 1: Money Saving (OOP - Out of Pocket)

**Goal:** Minimize total cash paid, use points aggressively.

**Strategy:** Use points whenever they save ANY money (cpp > 0).

```python
# Objective Function
Maximize:
    W_savings × points_savings        # +10^8: Reward cash saved by using points
  - W_cash × total_cash_paid          # -10^7: Penalize cash spending
  - W_surcharge × surcharge_penalty   # -10^4: Penalize high surcharges
  - W_time × total_travel_time        # -10^1: Minor time penalty
  + W_benefit × card_benefits         # Bonus for free bags, etc.
  - W_extra_city × non_hub_transits   # Penalize obscure routing
  - W_connection × extra_connections  # -10^6: Penalize extra stops
```

**Use Case:** Travelers with lots of points who want to minimize cash spending.

### Mode 2: CPP Focused (Cents Per Point)

**Goal:** Maximize point value, only use points when CPP > 1.0.

**Strategy:** Preserve points for premium redemptions.

```python
# Objective Function
Maximize:
    W_value × points_value            # +10^7: Reward good CPP
  - W_cash × total_cash_paid          # -10^4: Secondary cash minimization
  - W_surcharge × surcharge_penalty   # -10^5: High surcharge penalty
  - W_time × total_travel_time        # -10^3: Moderate time penalty
  + W_benefit × card_benefits
  - W_extra_city × non_hub_transits
  - W_connection × extra_connections  # -10^12: Strong connection penalty
```

**Use Case:** Travelers who want maximum value per point.

### Mode 3: Balanced

**Goal:** Optimize CPP adjusted by travel time and stops.

**Strategy:** Score = CPP_value / (hours_traveled × (1 + stops))

```python
def balanced_value(edge, airline):
    savings = cash_cost - surcharge
    time_hours = max(1, time_minutes / 60)
    time_factor = 10.0 / time_hours  # Shorter = higher factor
    return savings * min(time_factor, 3.0)  # Cap at 3x bonus
```

### Surcharge Rejection Rules

Awards with excessive surcharges are automatically rejected:

```python
MAX_SURCHARGE_CASH_RATIO = 0.50   # 50% of cash price
MAX_SURCHARGE_PER_SEGMENT = 300   # $300 absolute max

def should_reject_award(airline, edge):
    surcharge = get_tax(airline, edge)
    cash = cash_cost.get(edge, 0)
    
    if surcharge > cash * MAX_SURCHARGE_CASH_RATIO:
        return True  # Surcharge > 50% of cash price
    if surcharge > MAX_SURCHARGE_PER_SEGMENT:
        return True  # Surcharge > $300
    return False
```

---

## Output Specifications

### Solution Structure

```python
solution = {
    # Solver status
    "status": "Optimal",  # or "Infeasible", "Unbounded", etc.
    
    # Path per traveler (city sequence)
    "path": {
        "traveler_1": ["JFK", "AUH", "DXB", "JFK"],
    },
    
    # Edges per traveler (flight sequence)
    "edges": {
        "traveler_1": [
            ["JFK", "AUH", "EY101"],
            ["AUH", "DXB", "EY401"],
            ["DXB", "JFK", "EK203"],
        ],
    },
    
    # Payment mode per segment
    "pay_mode": {
        "traveler_1": [
            {
                "edge": ["JFK", "AUH", "EY101"],
                "type": "points",
                "payer": "traveler_1",
                "via": {"source": "chase", "airline": "EY"},
                "miles": 75000,
                "surcharge": 100.0,
                "points_value": 1400.0,  # Cash equivalent saved
                "cents_per_point": 1.87,
            },
            {
                "edge": ["AUH", "DXB", "EY401"],
                "type": "cash",
                "payer": "traveler_1",
                "fare": 80.0,
            },
            {
                "edge": ["DXB", "JFK", "EK203"],
                "type": "points",
                "payer": "traveler_1",
                "via": {"native": "EK"},  # Used native Emirates miles
                "miles": 62500,
                "surcharge": 150.0,
                "points_value": 1150.0,
                "cents_per_point": 1.84,
            },
        ],
    },
    
    # Aggregated totals
    "totals": {
        "airline_points": 137500,     # Total miles used
        "cash": 330.0,                # Total cash paid (fares + surcharges)
        "time": 2280.0,               # Total travel time (minutes)
        "points_value": 2550.0,       # Total cash saved by using points
        "optimization_mode": "money_saving",
        
        # Transfer details per payer
        "transfers": {
            "traveler_1": {
                "chase": {
                    "EY": {
                        "blocks": 75,
                        "source_points": 75000,
                        "delivered_airline_points": 75000.0,
                    },
                },
            },
        },
        
        # Native miles used
        "native_used": {
            "traveler_1": {
                "EK": 62500.0,
            },
        },
    },
}
```

### Transfer Instructions (Generated from Solution)

```python
transfer_instruction = {
    "from_program": "chase",
    "from_program_name": "Chase Ultimate Rewards",
    "to_program": "EY",
    "to_program_name": "Etihad Guest",
    "points_to_transfer": 75000,
    "transfer_ratio": "1:1",
    "resulting_points": 75000,
    "transfer_time": "instant",
    "portal_url": "https://ultimaterewardspoints.chase.com",
    "booking_url": "https://www.etihad.com",
    "steps": [
        "1. Log in to your Chase Ultimate Rewards account",
        "2. Navigate to the rewards portal: https://ultimaterewardspoints.chase.com",
        "3. Select 'Transfer Points' or 'Transfer to Partners'",
        "4. Find and select Etihad Guest",
        "5. Enter your Etihad Guest membership number",
        "6. Transfer 75,000 points (1:1 ratio, instant)",
        "7. You will receive 75,000 Etihad Guest points",
        "8. Book at https://www.etihad.com using your Etihad Guest points",
    ],
}
```

---

## Worked Examples

### Example 1: JFK → AUH → DXB → JFK (Multi-City Round Trip)

**Input:**
- Traveler: John with 200,000 Chase points
- Route: New York → Abu Dhabi (3 days) → Dubai (4 days) → New York
- Mode: OOP (minimize cash)

**Available Flights (simplified):**

| Route | Flight | Cash | Points | Program | Surcharge | Time |
|-------|--------|------|--------|---------|-----------|------|
| JFK → AUH | EY101 | $1,500 | 75,000 | EY | $100 | 14h |
| JFK → BAH → AUH | GF511+22 | $900 | 55,000 | AA | $100 | 18h |
| AUH → DXB | EY401 | $80 | 5,000 | EY | $20 | 1h |
| DXB → JFK | EK201 | $1,400 | 62,500 | EK | $150 | 14h |
| DXB → BAH → JFK | GF23+512 | $950 | 50,000 | AA | $80 | 19h |

**ILP Processing:**

1. **Build Graph:** 5 unique edges with cash + award pricing

2. **Calculate link_ok:**
   ```
   link_ok[("john", "EY")] = 1  # Chase → EY
   link_ok[("john", "AA")] = 0  # No path (Chase doesn't transfer to AA)
   link_ok[("john", "EK")] = 1  # Chase → EK
   ```

3. **Apply Constraints:**
   - Path: 1 edge leaves JFK, 1 edge arrives at JFK
   - Must-visit: AUH and DXB each visited once
   - Flow conservation at all cities
   - Chronological: AUH departure > AUH arrival; DXB departure > DXB arrival

4. **Evaluate Options:**

   **Option A: Direct via Etihad (Points)**
   ```
   JFK → AUH: 75,000 EY + $100 (Chase → EY)
   AUH → DXB: $80 cash
   DXB → JFK: 62,500 EK + $150 (Chase → EK)
   
   Total: $330 cash + 137,500 points
   Cash saved: ($1,500 - $100) + ($1,400 - $150) = $2,650
   Score: 10^8 × 2650 - 10^7 × 330 - ... = HIGH
   ```

   **Option B: Connections via BAH (Mixed - NOT FEASIBLE)**
   ```
   link_ok[("john", "AA")] = 0 → Cannot use AA award pricing
   Falls back to cash: $900 + $80 + $950 = $1,930 cash
   Score: -10^7 × 1930 = NEGATIVE
   ```

5. **Solution:** Option A selected

**Output:**
```python
{
    "status": "Optimal",
    "path": {"john": ["JFK", "AUH", "DXB", "JFK"]},
    "edges": {"john": [["JFK", "AUH", "EY101"], ["AUH", "DXB", "EY401"], ["DXB", "JFK", "EK201"]]},
    "totals": {
        "airline_points": 137500,
        "cash": 330.0,
        "points_value": 2650.0,
    },
    "pay_mode": {"john": [
        {"type": "points", "via": {"source": "chase", "airline": "EY"}, "miles": 75000},
        {"type": "cash", "fare": 80.0},
        {"type": "points", "via": {"source": "chase", "airline": "EK"}, "miles": 62500},
    ]},
}
```

### Example 2: Insufficient Points for All Legs

**Input:**
- Traveler: Jane with 50,000 Chase points
- Route: JFK → DXB → JFK (round trip)
- Mode: OOP

**Scenario:**
- Outbound (EK): 62,500 miles needed → insufficient
- Return (EK): 62,500 miles needed → insufficient

**ILP Processing:**

The ILP evaluates:
1. Pay cash for both: $2,600 total
2. Use 50,000 points where most valuable + pay cash for rest

**If award available at 50,000 miles for one leg:**
- Use points for outbound: 50,000 EK + $150 surcharge
- Pay cash for return: $1,400

**Solution adapts to available balance.**

---

## Edge Cases and Error Handling

### 1. Infeasible: No Path Exists

**Cause:** No flights connect required cities on given dates.

**Detection:**
```python
if solver_status != "Optimal":
    # Check graph connectivity
    for city in must_visit_cities:
        if not has_incoming_edges(city):
            logger.error(f"No incoming edges to must-visit city {city}!")
```

**Mitigation:**
- Expand date range
- Add alternative airports
- Reduce must-visit cities

### 2. Chronological Deadlock

**Cause:** All connection options violate minimum connection time.

**Example:**
```
Available flights:
- JFK → AUH arriving 18:30
- AUH → DXB departing 18:00 (ONLY option!)

Required connection time: 60 minutes
```

**Mitigation:**
- Reduce `MIN_CONNECTION_TIME` for specific airports
- Flag warning about tight connections
- Search for alternative flight combinations

### 3. Round Trip at Same City

**Special Handling:** For round trips (start_city == end_city), chronological constraints are NOT applied between:
- Return flight arriving at start
- Outbound flight departing from start

These are at opposite ends of the trip, not consecutive.

```python
if is_round_trip and city == start:
    # Skip chronological constraint between return arrival and outbound departure
    continue
```

### 4. Missing Award Availability

**Cause:** Flight exists for cash but no award seats.

**Detection:**
```python
if points_cost is None or points_cost <= 0:
    can_price[airline][edge] = 0  # Block award booking
    safe_award[airline][edge] = 0
```

**Behavior:** ILP falls back to cash-only for that edge.

### 5. Points Not Linked

**Cause:** Traveler's banks don't transfer to flight's airline.

**Detection:** `link_ok[(traveler, airline)] = 0`

**Behavior:** ILP can only use cash for that airline's flights.

### 6. Hub City Recognition

Routing through recognized hub cities incurs NO penalty:

```python
HUB_CITIES = {
    'IST', 'DOH', 'DXB', 'AUH', 'BAH',  # Middle East
    'CDG', 'LHR', 'FRA', 'AMS',          # Europe
    'JFK', 'LAX', 'ORD', 'DFW', 'ATL',   # US
    'SIN', 'HKG', 'ICN', 'NRT',          # Asia
    # ... 68 total hubs
}

# Only penalize non-hub transits
non_hub_cities = set(cities) - wanted_cities - HUB_CITIES
extra_city_penalty = ∑ x[p][e] for e arriving at non_hub_cities
```

---

## Summary

The ILP algorithm:

1. **Takes structured inputs:** Flight edges with pricing, traveler points, transfer graph
2. **Builds decision variables:** Binary choices for edge selection and payment method
3. **Applies constraints:** Path validity, chronological ordering, payment rules, transfer limits
4. **Optimizes objective:** Balance cost, time, and convenience based on selected mode
5. **Produces solution:** Optimal paths, payment methods, transfer instructions

**Key Implementation Files:**

| File | Lines | Purpose |
|------|-------|---------|
| `points_maximizer.py` | ~1250 | Core ILP model with PuLP |
| `ilp_adapter.py` | ~280 | Edge → ILP input transformation |
| `optimization/models.py` | ~360 | Typed data classes |
| `optimization/constraints.py` | ~740 | Modular constraint builders |
| `optimization/constants.py` | ~460 | Config, thresholds, hub cities |
| `transfer_strategy.py` | ~730 | Transfer graph, instructions |

**Solver:** PuLP with CBC (Coin-or Branch and Cut) backend, typically solves in <1 second for typical trip sizes.
