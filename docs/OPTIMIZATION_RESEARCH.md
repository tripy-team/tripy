# Tripy Optimization Architecture Research

This document provides a comprehensive overview of how APIs are used for flight search and how the optimization algorithm works to find the best travel itinerary using points and cash.

## Table of Contents

1. [External APIs and Data Sources](#external-apis-and-data-sources)
2. [Data Flow Architecture](#data-flow-architecture)
3. [ILP Optimization Model](#ilp-optimization-model)
4. [Optimization Modes](#optimization-modes)
5. [Transfer Graphs and Points System](#transfer-graphs-and-points-system)
6. [Implementation Details](#implementation-details)

---

## External APIs and Data Sources

### AwardTool API v2 (Primary Award Flight Search)

The main source for award flight availability across multiple airline loyalty programs.

**Endpoints:**
| Endpoint | URL | Purpose |
|----------|-----|---------|
| Priming | `https://apisv2.awardtoolapi.com/flight_trigger/search_real_time` | Initiates async searches |
| Polling | `https://apisv2.awardtoolapi.com/flight_retrieval/search_result` | Retrieves incremental results |

**Architecture: Two-Phase Priming + Polling**

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  1. Prime API   │───▶│  2. Poll Results │───▶│  3. Parse Data  │
│  (batch programs)│    │  (5s intervals)  │    │  (extract edges)│
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

1. **Priming Phase**: Batches programs (default 3 per batch) and initiates searches
2. **Polling Phase**: Polls every 5s until max 60s, collecting incremental results
3. **Data Extraction**: Parses award flights with points cost, surcharges, transfer partners

**Configuration:**
```python
AWARDTOOL_POLL_INTERVAL = 5      # seconds between polls
AWARDTOOL_MAX_POLL_TIME = 60    # max seconds to poll
AWARDTOOL_PROGRAM_BATCH_SIZE = 3 # programs per batch
```

**Returns:**
- Points cost (miles required)
- Surcharges/taxes
- Transfer partners (which bank programs can access this award)
- Operating carrier and flight details

### AwardTool Panorama Calendar API

**Endpoint:** `https://www.awardtool-api.com/panorama/panorama_calendar_data`

**Purpose:** Calendar view of award availability for date flexibility analysis.

**Use Cases:**
- Validate that selected dates have award availability
- Suggest optimal dates for award redemptions
- Identify patterns in award availability

### SerpAPI (Google Flights)

**Endpoint:** `https://serpapi.com/search.json`

**Purpose:** Cash flight prices and general availability.

**Key Parameters:**
```python
{
    "engine": "google_flights",
    "type": 2,  # one-way
    "deep_search": True,
    "currency": "USD",
    "hl": "en",
    # Filters
    "stops": 0/1/2,
    "bags": 1,
    "airlines": "UA,AA,...",
    "max_price": 5000,
    "travel_class": 1/2/3/4  # Economy/Premium/Business/First
}
```

**Returns:**
- Cash prices in USD
- Flight numbers and operating carriers
- Duration and layover info
- Departure/arrival times

**Caching:** 90 minutes TTL

---

## Data Flow Architecture

### End-to-End Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           USER REQUEST                                    │
│                    (trip_id, dates, destinations)                        │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    1. FETCH TRIP DATA                                     │
│        • Trip members and their points balances                          │
│        • Destination cities and dates                                     │
│        • Budget constraints                                               │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    2. RESOLVE CITIES → AIRPORTS                          │
│        • "Dubai" → ["DXB"]                                               │
│        • "New York" → ["JFK", "EWR", "LGA"]                             │
│        • Parallel async resolution                                        │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    3. BUILD ROUTE GRAPH                                   │
│        • All origin-destination pairs                                     │
│        • start → city1 → city2 → ... → end                              │
│        • Generates edges for each O-D pair                               │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    4. FETCH FLIGHT EDGES (Parallel)                       │
│                                                                          │
│    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐      │
│    │  AwardTool v2   │   │    SerpAPI      │   │   Panorama      │      │
│    │  (award flights)│   │  (cash flights) │   │ (date calendar) │      │
│    └────────┬────────┘   └────────┬────────┘   └────────┬────────┘      │
│             │                     │                     │                │
│             └─────────────────────┼─────────────────────┘                │
│                                   ▼                                      │
│                        MERGE & DEDUPLICATE                               │
│                                                                          │
│    Fallback Chain:                                                       │
│    1. Award-first (AwardTool + SerpAPI)                                  │
│    2. SERP-first (SerpAPI + AwardTool)                                  │
│    3. SERP-only (cash flights only)                                      │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    5. BUILD EDGE DICTIONARY                               │
│                                                                          │
│    Format: {(origin, destination, flight_num): {                         │
│        cash_cost: float,                                                 │
│        points_cost: int,                                                 │
│        points_program: str,          # e.g., "UA", "AA"                 │
│        points_surcharge: float,      # taxes/fees for award             │
│        transfer_partners: list,      # ["chase", "amex"]                │
│        time_cost: float,             # total travel time                │
│        departure_time: str,                                              │
│        arrival_time: str,                                                │
│        operating_airline: str                                            │
│    }}                                                                    │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    6. PREPARE ILP INPUTS                                  │
│                   (ilp_adapter.build_ilp_inputs_from_edges)              │
│                                                                          │
│    • Split user points: banks vs airlines                                │
│    • Build transfer graph constraints                                    │
│    • Map edges to pricing airlines                                       │
│    • Calculate link_ok (traveler → airline eligibility)                 │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    7. RUN ILP OPTIMIZATION                                │
│                   (points_maximizer.plan_maximize_points_value)          │
│                                                                          │
│    • Solver: PuLP with CBC backend                                       │
│    • Mode: "oop" (minimize cash) or "cpp" (maximize value)              │
│    • Outputs: optimal paths, payment methods, transfer instructions      │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    8. EXTRACT & FORMAT SOLUTION                           │
│                                                                          │
│    • Paths per traveler                                                  │
│    • Payment modes (cash vs points per segment)                          │
│    • Transfer strategy (which banks → which airlines)                    │
│    • Totals (cash, points, time, value)                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

### Flight Edge Merging Logic

```python
# Merge award and cash flight data
for leg in serp_legs:
    edge_key = (leg.departure, leg.arrival, leg.flight_num)
    
    # Try exact flight match first
    if edge_key in award_edges:
        merged[edge_key] = {
            **cash_data[edge_key],
            **award_data[edge_key]  # points, surcharge, program
        }
    else:
        # Fallback: O-D match (same route, different flight)
        od_key = (leg.departure, leg.arrival)
        if od_key in award_od_index:
            # Use cheapest award on this route
            merged[edge_key] = {
                **cash_data[edge_key],
                **award_od_index[od_key]
            }
```

---

## ILP Optimization Model

The core of Tripy's optimization is an **Integer Linear Program (ILP)** that finds the optimal combination of flights, payment methods, and point transfers.

### Decision Variables

| Variable | Type | Description |
|----------|------|-------------|
| `x[p][e]` | Binary | Traveler `p` uses edge (flight) `e` |
| `z[(q,p)][e]` | Binary | Payer `q` pays **cash** for traveler `p` on edge `e` |
| `y[(q,p)][(s,a)][e]` | Binary | Payer `q` uses bank `s` transferred to airline `a` for traveler `p` on edge `e` |
| `y_native[(q,p)][a][e]` | Binary | Payer `q` uses **native** airline `a` points for traveler `p` on edge `e` |
| `t_blocks[q][(s,a)]` | Integer | Number of transfer blocks from bank `s` to airline `a` by payer `q` |

### Constraints

#### 1. Path Constraints

```python
# Must start at start_city (exactly 1 outgoing edge)
m += lpSum(x[p][e] for e in edges if e[0] == start_city[p]) == 1

# Must end at end_city (exactly 1 incoming edge)  
m += lpSum(x[p][e] for e in edges if e[1] == end_city[p]) == 1

# Flow conservation at intermediate cities
for city in cities:
    if city != start_city[p] and city != end_city[p]:
        m += (lpSum(x[p][e] for e if e[0] == city) 
           == lpSum(x[p][e] for e if e[1] == city))

# Must-visit cities: exactly 1 edge arrives
for city in must_visit_cities:
    m += lpSum(x[p][e] for e if e[1] == city) == 1

# Transit cities: at most 1 visit (prevents sub-tours)
for city in transit_cities:
    m += lpSum(x[p][e] for e if e[1] == city) <= 1

# Chronological ordering at must-visit cities
# (departure time >= arrival time of previous segment)
```

#### 2. Payment Constraints

```python
# Exactly one payment method per chosen edge
for p in travelers:
    for e in edges:
        m += (lpSum(z[(q,p)][e] for q in travelers) 
            + lpSum(y[(q,p)][(s,a)][e] for q,s,a) 
            + lpSum(y_native[(q,p)][a][e] for q,a)
            == x[p][e])

# Restrict who can pay for whom
# z[(q,p)][e] <= can_pay_for[(q,p)]
```

#### 3. Transfer Constraints

```python
# Transfer blocks: points transferred must fit in blocks
# sum(y * miles_required) <= t_blocks * (block_size * ratio * bonus)

# Source balance: can't transfer more than you have
# t_blocks * block_size <= source_balance[q][s]
```

#### 4. Budget Constraints

```python
# Total cash spend (cash bookings + surcharges) <= budget
for q in payers:
    m += (lpSum(z[(q,p)][e] * cash_cost[e]) 
        + lpSum(y * surcharge[a][e])
        <= budget_cash[q])
```

#### 5. Capacity Constraints

```python
# Cash seats available
for e in edges:
    m += lpSum(z[(q,p)][e] for q,p) <= total_cash_seats[e]

# Award seats available per program
for a in airlines:
    for e in edges:
        m += lpSum(y[(q,p)][(s,a)][e] for q,p,s) <= award_seats[a][e]
```

### Objective Functions

#### OOP Mode (Out-Of-Pocket) — Default

**Goal:** Minimize total cash paid

```python
objective = (
    W_oop_savings * points_savings      # Reward for using points
  - W_oop_cash * total_cash_paid        # Penalize cash spending
  - W_oop_surcharge * surcharge_penalty # Penalize high surcharges
  - W_oop_time * total_time             # Slight time preference
  + W_benefit * card_benefits           # Bonus for card perks
  - W_extra_city * extra_city_penalty   # Avoid unnecessary layovers
)

# Weights (order of magnitude)
W_oop_savings = 10^7    # Strongly prefer point usage
W_oop_cash = 10^6       # Minimize cash
W_oop_surcharge = 10^3  # Avoid high surcharges
W_oop_time = 1          # Minor time consideration
W_extra_city = 10^8     # Strongly avoid extra cities
```

**Point Usage Criteria (OOP):**
- CPP threshold: 0.5 cents/point (very low)
- Uses points whenever they reduce cash
- Rejects awards where surcharge > 50% of cash price
- Rejects awards where surcharge > $300/segment

#### CPP Mode (Cents Per Point)

**Goal:** Maximize point value (redemption quality)

```python
objective = (
    W1 * points_value               # Maximize CPP
  - W2 * total_cash_paid            # Secondary: minimize cash
  - W3 * total_time                 # Minor time preference
  + W_benefit * card_benefits       # Bonus for card perks
  - W_extra_city * extra_city_penalty
)

# Weights
W1 = 10^6  # Primary: maximize point value
W2 = 10^3  # Secondary: minimize cash
W3 = 1     # Minor: prefer shorter flights
```

**Point Usage Criteria (CPP):**
Program-specific minimum CPP thresholds:

| Program | Min CPP | Notes |
|---------|---------|-------|
| Singapore (SQ) | 1.5¢ | Premium redemptions |
| British Airways (BA) | 1.8¢ | Avios often devalued |
| ANA (NH) | 1.5¢ | Sweet spots exist |
| United (UA) | 1.0¢ | Flexible program |
| JetBlue (B6) | 0.9¢ | Lower value expected |
| Default | 1.2¢ | General threshold |

---

## Optimization Modes

### OOP Mode (Out-Of-Pocket)

**Use Case:** Minimize cash paid, maximize point usage regardless of "value"

**Behavior:**
- Uses points whenever they reduce out-of-pocket costs
- Low CPP threshold (0.5¢) — willing to "waste" points to save cash
- Penalizes high surcharges that eat into cash savings
- Best for travelers who have points to burn

**Example:**
```
Flight: JFK → LHR
Cash: $800
Award: 60,000 UA miles + $150 surcharge

CPP = ($800 - $150) / 60,000 = 1.08¢

OOP Mode: ✅ USE POINTS (saves $650 cash, CPP > 0.5¢)
CPP Mode: ✅ USE POINTS (1.08¢ > 1.0¢ threshold for UA)
```

### CPP Mode (Cents Per Point)

**Use Case:** Maximize point value, preserve points for better redemptions

**Behavior:**
- Only uses points when CPP exceeds program-specific threshold
- Willing to pay more cash to preserve points for premium redemptions
- Best for travelers who want maximum value per point

**Example:**
```
Flight: JFK → LHR
Cash: $400
Award: 60,000 BA Avios + $200 surcharge

CPP = ($400 - $200) / 60,000 = 0.33¢

OOP Mode: ✅ USE POINTS (saves $200 cash)
CPP Mode: ❌ USE CASH (0.33¢ < 1.8¢ threshold for BA)
```

---

## Transfer Graphs and Points System

### Transfer Graph Structure

The transfer graph maps which bank programs can transfer to which airline programs:

```python
TRANSFER_GRAPH = {
    "chase": {
        "UA": 1.0,   # Chase → United at 1:1
        "BA": 1.0,   # Chase → British Airways at 1:1
        "AF": 1.0,   # Chase → Air France at 1:1
        "SQ": 1.0,   # Chase → Singapore at 1:1
        "HYATT": 1.0 # Chase → Hyatt at 1:1
    },
    "amex": {
        "DL": 1.0,   # Amex → Delta at 1:1
        "BA": 1.0,
        "AF": 1.0,
        "SQ": 1.0,
        "ANA": 1.0   # Good for ANA sweet spots
    },
    "citi": {
        "AA": 1.0,   # Citi → American at 1:1
        "TK": 1.0,   # Citi → Turkish at 1:1
        "QF": 1.0,   # Citi → Qantas at 1:1
        "SQ": 1.0
    },
    "capitalone": {
        "AF": 1.0,
        "BA": 0.75,  # Capital One → BA at 1:0.75 (worse ratio)
        "TK": 1.0
    },
    "bilt": {
        "UA": 1.0,
        "AA": 1.0,
        "BA": 1.0,
        "HYATT": 1.0
    }
}
```

### Points Balance Processing

```python
# Input: Raw user points
user_points = {
    "traveler_1": {
        "Chase Ultimate Rewards": 150000,
        "Amex Membership Rewards": 80000,
        "United MileagePlus": 45000,  # Native airline points
    }
}

# Step 1: Normalize program names
normalized = {
    "traveler_1": {
        "chase": 150000,      # Bank → transferable
        "amex": 80000,        # Bank → transferable
        "UA": 45000           # Airline → native (use directly)
    }
}

# Step 2: Split into banks vs airlines
banks = {"chase": 150000, "amex": 80000}
airlines = {"UA": 45000}

# Step 3: Calculate link_ok (eligibility)
link_ok = {
    ("traveler_1", "UA"): 1,  # Direct: has UA miles
    ("traveler_1", "BA"): 1,  # Transfer: chase/amex → BA
    ("traveler_1", "DL"): 1,  # Transfer: amex → DL
    ("traveler_1", "AA"): 0,  # No path: no citi, no AA miles
}
```

### Transfer Blocks

Transfers are modeled in discrete blocks to reflect real-world transfer mechanics:

```python
TRANSFER_BLOCK_SIZE = 1000  # Minimum transfer unit

# Example: Need 35,500 UA miles
# Must transfer in blocks: ceil(35,500 / 1000) = 36 blocks
# Actual transfer: 36,000 points

# Constraint in ILP:
# t_blocks[traveler][(chase, UA)] * 1000 >= miles_needed
```

### Transfer Bonuses

The system supports transfer bonuses (promotions):

```python
# 30% transfer bonus: Chase → UA
transfer_bonus = {("chase", "UA"): 1.3}

# With bonus: 36,000 Chase points → 46,800 UA miles
# Effectively: 1000 Chase = 1300 UA miles
```

---

## Implementation Details

### Caching Strategy

| Data Source | TTL | Cache Key Includes |
|-------------|-----|-------------------|
| AwardTool | 6 hours | origin, dest, date, cabins, programs |
| Panorama | 24 hours | origin, dest, month |
| SerpAPI | 90 minutes | origin, dest, date, class, stops |

### Error Handling & Fallbacks

```
┌─────────────────────┐
│  Award-First Mode   │  Try AwardTool first (faster for known routes)
└──────────┬──────────┘
           │ Fail?
           ▼
┌─────────────────────┐
│  SERP-First Mode    │  Try SerpAPI first (broader coverage)
└──────────┬──────────┘
           │ Fail?
           ▼
┌─────────────────────┐
│  SERP-Only Mode     │  Cash flights only (last resort)
└──────────┬──────────┘
           │ Fail?
           ▼
┌─────────────────────┐
│  AI Route Suggest   │  OpenAI suggests alternative routes
└─────────────────────┘
```

### ILP Infeasibility Handling

```python
# If ILP returns infeasible, retry with relaxed budget
budget_multipliers = [1.0, 2.0, 3.0, 5.0, 10.0]

for mult in budget_multipliers:
    result = solve_ilp(budget=original_budget * mult)
    if result.status == "Optimal":
        break
```

### Parallelization

```python
# Flight edge fetching: max 6 concurrent requests
SEMAPHORE_LIMIT = 6

async def fetch_all_edges(od_pairs):
    sem = asyncio.Semaphore(SEMAPHORE_LIMIT)
    
    async def fetch_with_limit(od):
        async with sem:
            return await fetch_edge(od)
    
    return await asyncio.gather(*[
        fetch_with_limit(od) for od in od_pairs
    ])
```

### Card Benefits Integration

```python
# Track which travelers have cards with airline benefits
benefit_airlines = {
    "traveler_1": {"UA", "DL"},  # Has United/Delta card → free bags
}

# In objective function:
card_benefits = lpSum(
    x[p][e] * bag_fee * passengers
    for p in travelers
    for e in edges
    if edge_airline[e] in benefit_airlines[p]
)
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `backend/src/handlers/awardtool_v2.py` | AwardTool API integration (priming/polling) |
| `backend/src/handlers/flights.py` | Flight search orchestration, SerpAPI |
| `backend/src/handlers/ilp_adapter.py` | Prepares data for ILP optimization |
| `backend/src/handlers/points_maximizer.py` | Core ILP model and solver |
| `backend/src/services/itinerary_service.py` | High-level orchestration |
| `backend/src/handlers/transfer_strategy.py` | Transfer instruction generation |

---

## Summary

Tripy's optimization system:

1. **Fetches flight data** from multiple sources (AwardTool for awards, SerpAPI for cash)
2. **Builds a graph** of all possible flight edges with cost attributes
3. **Prepares ILP inputs** by splitting points into transferable (bank) and native (airline)
4. **Solves an ILP** to find the optimal combination of:
   - Which flights to take
   - How to pay for each (cash vs points)
   - Which points to transfer and where
5. **Extracts the solution** with detailed transfer instructions

The system supports two optimization modes:
- **OOP**: Minimize cash, use points liberally
- **CPP**: Maximize point value, preserve points for premium redemptions
