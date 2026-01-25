# Points Optimization System - Architecture Diagram

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                              │
│                     (React/TypeScript Frontend)                     │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                        API GATEWAY (Lambda)                         │
│                  /itinerary/optimize (POST)                         │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                    ITINERARY SERVICE (Python)                       │
│              generate_optimized_itinerary()                         │
└────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
        ┌───────────────────────┐   ┌───────────────────────┐
        │   FLIGHT DATA FETCH   │   │   USER POINTS DATA    │
        │                       │   │                       │
        │ • SERP API (cash)     │   │ • DynamoDB lookup     │
        │ • AwardTool (awards)  │   │ • User balances       │
        │ • Parallel requests   │   │ • Transfer partners   │
        └───────────────────────┘   └───────────────────────┘
                    │                           │
                    └─────────────┬─────────────┘
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                  ILP ADAPTER (build_ilp_inputs)                     │
│  Converts edges + user data → ILP optimization inputs              │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│              ILP OPTIMIZER (points_maximizer.py)                    │
│         plan_maximize_points_value() - PuLP/CBC Solver              │
│                                                                      │
│  Objective: MAX (W1·points_value - W2·cash - W3·time)              │
│                                                                      │
│  Constraints:                                                        │
│  • Flow conservation (valid paths)                                  │
│  • must_visit_cities (dynamic ordering)                             │
│  • Points balance limits                                            │
│  • Cash budget limits                                               │
│  • Transfer partner rules                                           │
│  • Award seat availability                                          │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                    SOLUTION PROCESSOR                               │
│  • Extract optimal paths                                            │
│  • Calculate totals (points, cash, time)                            │
│  • Build transfer instructions                                      │
│  • Generate strategy reasoning                                      │
└────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
        ┌───────────────────────┐   ┌───────────────────────┐
        │ build_transfer_tips   │   │   save_itinerary      │
        │ _from_solution()      │   │   _items()            │
        │                       │   │                       │
        │ • Portal URLs         │   │ • DynamoDB            │
        │ • Step-by-step        │   │ • Path records        │
        │ • Value calcs         │   │ • Payment modes       │
        │ • Timing info         │   │ • Transfer tips       │
        └───────────────────────┘   └───────────────────────┘
                    │                           │
                    └─────────────┬─────────────┘
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                    RESPONSE TO FRONTEND                             │
│  {                                                                  │
│    "paths": {...},                                                  │
│    "payments": {...},                                               │
│    "transfer_tips": [...],                                          │
│    "totals": {...},                                                 │
│    "strategy_reason": "..."                                         │
│  }                                                                  │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│              FRONTEND TRANSFER INSTRUCTIONS DISPLAY                 │
│           (transfer-instructions.ts components)                     │
│                                                                      │
│  • Transfer strategy overview                                       │
│  • Detailed transfer cards per segment                              │
│  • Step-by-step instructions with URLs                              │
│  • Value metrics (cpp, cash saved)                                  │
│  • Booking portal links                                             │
└────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

### 1. User Request Flow

```
User selects:
┌───────────────────────────────────┐
│ • Departure: FLL                  │
│ • Destinations: HND, CDG          │
│ • Arrival: MCO                    │
│ • Dates: Flexible                 │
│ • Budget: $3,000                  │
│ • Points: 200k Chase UR           │
└───────────────────────────────────┘
                │
                ▼
POST /itinerary/optimize
┌───────────────────────────────────┐
│ {                                 │
│   "trip_id": "...",               │
│   "start_dest": "FLL",            │
│   "destinations": ["HND", "CDG"], │
│   "end_dest": "MCO",              │
│   "budget": 3000,                 │
│   "user_points": {...}            │
│ }                                 │
└───────────────────────────────────┘
```

### 2. Flight Data Fetching

```
Parallel Requests (asyncio.gather):
┌─────────────────────────────────────────────────────────────┐
│                                                               │
│  FLL→HND ──┬──→ SERP (cash prices)                          │
│            └──→ AwardTool (award availability)              │
│                                                               │
│  HND→CDG ──┬──→ SERP (cash prices)                          │
│            └──→ AwardTool (award availability)              │
│                                                               │
│  CDG→MCO ──┬──→ SERP (cash prices)                          │
│            └──→ AwardTool (award availability)              │
│                                                               │
│  FLL→CDG ──┬──→ SERP (cash prices)                          │
│            └──→ AwardTool (award availability)              │
│                                                               │
│  CDG→HND ──┬──→ SERP (cash prices)                          │
│            └──→ AwardTool (award availability)              │
│                                                               │
│  HND→MCO ──┬──→ SERP (cash prices)                          │
│            └──→ AwardTool (award availability)              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
                        Merge into edges_all
┌─────────────────────────────────────────────────────────────┐
│ {                                                             │
│   ("FLL", "HND", "UA1234"): {                                │
│     "cash_cost": 1400,                                       │
│     "time_cost": 840,  # minutes                             │
│     "points_cost": 70000,                                    │
│     "points_program": "UA",                                  │
│     "points_surcharge": 56,                                  │
│     "transfer_partners": ["chase", "amex"],                  │
│     ...                                                       │
│   },                                                          │
│   ...                                                         │
│ }                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. ILP Optimization Process

```
Input to ILP:
┌─────────────────────────────────────────────────────────────┐
│ • travelers: ["user123"]                                     │
│ • start_city: {"user123": "FLL"}                             │
│ • end_city: {"user123": "MCO"}                               │
│ • cities: ["FLL", "HND", "CDG", "MCO"]                       │
│ • edges: [(FLL,HND,UA1234), (HND,CDG,AF098), ...]           │
│ • must_visit_cities: ["HND", "CDG"]  ← Dynamic ordering!    │
│ • user_points: {"user123": {"chase": 200000}}               │
│ • transfer_graph: {chase: {UA: 1.0, AF: 1.0, ...}}          │
│ • budget_cash: {"user123": 3000}                             │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
              ILP Solver (CBC) evaluates:
┌─────────────────────────────────────────────────────────────┐
│                                                               │
│  Decision Variables:                                          │
│  • x[p][e]: Binary - passenger p takes edge e                │
│  • z[q,p][e]: Binary - q pays cash for p's edge e           │
│  • y[q,p][s,a][e]: Binary - q uses bank s→airline a for p   │
│  • y_native[q,p][a][e]: Binary - q uses native airline a    │
│  • t_blocks[q][s,a]: Integer - transfer blocks q→a          │
│                                                               │
│  Constraints:                                                 │
│  1. Flow: Each passenger has valid path                      │
│  2. Visits: Must visit HND and CDG exactly once              │
│  3. Payment: One payer per edge (cash OR points)             │
│  4. Transfer: Blocks × ratio ≥ miles needed                  │
│  5. Balance: Don't exceed points/cash budgets                │
│  6. Eligibility: Only use available transfer partners        │
│                                                               │
│  Objective: MAXIMIZE                                          │
│    W1 × (cash_saved_by_points) -                             │
│    W2 × (total_cash_paid) -                                  │
│    W3 × (total_travel_time)                                  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
                        Optimal Solution
┌─────────────────────────────────────────────────────────────┐
│ {                                                             │
│   "status": "Optimal",                                       │
│   "path": {                                                   │
│     "user123": ["FLL", "HND", "CDG", "MCO"]                  │
│   },                                                          │
│   "edges": {                                                  │
│     "user123": [                                              │
│       ["FLL", "HND", "UA1234"],                              │
│       ["HND", "CDG", "AF098"],                               │
│       ["CDG", "MCO", "DL456"]                                │
│     ]                                                         │
│   },                                                          │
│   "pay_mode": {...},                                         │
│   "totals": {                                                 │
│     "airline_points": 160000,                                │
│     "cash": 261,                                             │
│     "time": 2880,                                            │
│     "points_value": 2589,                                    │
│     "transfers": {...}                                       │
│   }                                                           │
│ }                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4. Transfer Tips Generation

```
From solution.pay_mode:
┌─────────────────────────────────────────────────────────────┐
│ [                                                             │
│   {                                                           │
│     "edge": ["FLL", "HND", "UA1234"],                        │
│     "type": "points",                                         │
│     "via": {"source": "chase", "airline": "UA"},             │
│     "miles": 70000,                                           │
│     "surcharge": 56,                                          │
│     "points_value": 1344,                                     │
│     "cents_per_point": 1.92                                   │
│   },                                                          │
│   ...                                                         │
│ ]                                                             │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
    build_transfer_tips_from_solution()
┌─────────────────────────────────────────────────────────────┐
│ Enriches with:                                                │
│ • Program display names (chase → "Chase Ultimate Rewards")   │
│ • Portal URLs (_TRANSFER_DETAILS)                            │
│ • Booking URLs (_AIRLINE_BOOKING_URLS)                       │
│ • Transfer timing                                             │
│ • Step-by-step instructions                                  │
│ • Value calculations                                          │
│ • Strategy reasoning                                          │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
                      Enhanced Transfer Tips
┌─────────────────────────────────────────────────────────────┐
│ [                                                             │
│   {                                                           │
│     "from_program": "Chase Ultimate Rewards",                │
│     "to_program": "United MileagePlus",                      │
│     "route_segment": "FLL→HND",                              │
│     "points": 70000,                                          │
│     "cents_per_point": 1.92,                                  │
│     "points_value": 1344.0,                                   │
│     "surcharge": 56.0,                                        │
│     "transfer_portal_url": "https://chase.com/...",          │
│     "transfer_time": "instant",                               │
│     "booking_url": "https://united.com/...",                 │
│     "transfer_steps": [                                       │
│       "1. Visit Chase portal...",                             │
│       "2. Navigate to Transfer Points...",                    │
│       ...                                                     │
│     ],                                                        │
│     "strategy_reason": "For your multi-city route..."        │
│   },                                                          │
│   ...                                                         │
│ ]                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Backend Components

```
┌────────────────────────────────────────────────────────────┐
│ itinerary_service.py                                        │
├────────────────────────────────────────────────────────────┤
│ • generate_optimized_itinerary()                            │
│   └─ Orchestrates entire optimization process              │
│                                                              │
│ • _fetch_edges_for_route()                                  │
│   └─ Fetches flight data (SERP + AwardTool)                │
│                                                              │
│ • build_transfer_tips_from_solution()                       │
│   └─ Generates detailed transfer instructions              │
│                                                              │
│ • _TRANSFER_DETAILS                                         │
│   └─ Credit card portal URLs and timing                    │
│                                                              │
│ • _AIRLINE_BOOKING_URLS                                     │
│   └─ Airline booking portal URLs                           │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ ilp_adapter.py                                              │
├────────────────────────────────────────────────────────────┤
│ • build_ilp_inputs_from_edges()                             │
│   └─ Converts flight edges to ILP format                   │
│                                                              │
│ • run_ilp_from_edges()                                      │
│   └─ Runs ILP solver with edges + user data                │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ points_maximizer.py                                         │
├────────────────────────────────────────────────────────────┤
│ • plan_maximize_points_value()                              │
│   └─ ILP optimizer (PuLP/CBC)                              │
│   └─ Objective: MAX points value                           │
│   └─ Constraints: flow, budget, transfers, etc.            │
│   └─ Supports must_visit_cities (dynamic ordering)         │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ flights.py                                                  │
├────────────────────────────────────────────────────────────┤
│ • get_flights_award_first_with_points_async()               │
│   └─ Fetches flights prioritizing award availability       │
│                                                              │
│ • _awardtool_realtime()                                     │
│   └─ Queries AwardTool API for award flights               │
│                                                              │
│ • serp_route()                                              │
│   └─ Queries SERP API for cash flights                     │
└────────────────────────────────────────────────────────────┘
```

### Frontend Components

```
┌────────────────────────────────────────────────────────────┐
│ transfer-instructions.ts                                    │
├────────────────────────────────────────────────────────────┤
│ • TransferTip interface                                     │
│   └─ TypeScript type for transfer instructions             │
│                                                              │
│ • buildTransferStepsFromItinerary()                         │
│   └─ Converts backend data to UI components                │
│                                                              │
│ • buildSteps()                                              │
│   └─ Generates step-by-step instructions                   │
│   └─ Uses backend steps if available                       │
│                                                              │
│ • buildTransferStrategyOverview()                           │
│   └─ Summarizes total strategy                             │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ TransferInstructionsCard.tsx (hypothetical)                │
├────────────────────────────────────────────────────────────┤
│ • Displays transfer tips to user                            │
│ • Shows step-by-step instructions                           │
│ • Includes portal/booking links                             │
│ • Shows value metrics (cpp, savings)                        │
└────────────────────────────────────────────────────────────┘
```

## External Dependencies

```
┌────────────────────────────────────────────────────────────┐
│ SERP API (SerpAPI)                                          │
├────────────────────────────────────────────────────────────┤
│ • Google Flights data                                       │
│ • Cash flight prices                                        │
│ • Flight schedules                                          │
│ • 90-minute cache                                           │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ AwardTool API                                               │
├────────────────────────────────────────────────────────────┤
│ • Real-time award availability                              │
│ • Multiple airline programs                                 │
│ • Panorama calendar view                                    │
│ • 6-hour cache                                              │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ PuLP + CBC Solver                                           │
├────────────────────────────────────────────────────────────┤
│ • Integer Linear Programming                                │
│ • Open-source solver (CBC)                                  │
│ • Optimal solution guaranteed                               │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ DynamoDB                                                    │
├────────────────────────────────────────────────────────────┤
│ • User points storage                                       │
│ • Trip data storage                                         │
│ • Itinerary persistence                                     │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ Redis Cache (optional)                                      │
├────────────────────────────────────────────────────────────┤
│ • Flight data caching                                       │
│ • Award data caching                                        │
│ • TTL-based expiration                                      │
└────────────────────────────────────────────────────────────┘
```

## Key Algorithms

### 1. Must-Visit Cities Implementation

```python
# In points_maximizer.py, constraint 1b:
for c in must_visit_cities:
    for p in travelers:
        if c == start_city.get(p) or c == end_city.get(p):
            continue
        # Force each must-visit city to be visited exactly once
        m += pl.lpSum(x[p][e] for e in edges if e[1] == c) == 1
```

This ensures:
- HND is visited exactly once
- CDG is visited exactly once
- Optimizer chooses: HND first OR CDG first
- Start (FLL) and end (MCO) are fixed

### 2. Points Value Calculation

```python
# Objective function maximizes:
points_value_expr = pl.lpSum(
    y[(q, p)][(s, a)][e] * (cash_cost.get(e, 0.0) - get_tax(a, e))
    for q, p, s, a, e in all_combinations
    if get_points_value(a, e) >= min_points_value_cpp
)
```

Where `points_value = cash_cost - surcharge` represents the cash you would have spent if you paid cash instead of using points.

### 3. Transfer Partner Selection

The system automatically selects the best transfer partner based on:
1. User's available point balances
2. Transfer ratios (usually 1:1)
3. Award availability for that partner
4. Value delivered (cpp)

## Performance Optimizations

```
┌────────────────────────────────────────────────────────────┐
│ 1. Parallel API Requests                                    │
│    └─ asyncio.gather() for all O-D pairs                   │
│    └─ ~6 concurrent requests (semaphore)                   │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ 2. Multi-Layer Caching                                      │
│    └─ 6h cache for award data (less volatile)              │
│    └─ 90m cache for SERP data (more volatile)              │
│    └─ 24h cache for Panorama calendar                      │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ 3. Smart Graph Pruning                                      │
│    └─ ILP constraints eliminate infeasible paths early     │
│    └─ Don't enumerate all permutations explicitly          │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ 4. Fallback Layers                                          │
│    └─ Award-first → SERP-first → SERP-only                 │
│    └─ Optimal → Relaxed budget → Simple generator          │
└────────────────────────────────────────────────────────────┘
```

## Conclusion

The system provides:
- **Intelligent routing** via ILP optimization
- **Dynamic destination ordering** via must_visit_cities
- **Comprehensive transfer instructions** with URLs and timing
- **Real-time flight data** from SERP + AwardTool
- **Transparent value metrics** (cpp, savings)
- **Scalable architecture** with caching and parallel requests

All working together to deliver the best possible points optimization!
