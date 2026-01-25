# Tripy Implementation Plan v3.0

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | Jan 2026 | Initial implementation plan |
| v2.0 | Jan 2026 | Added multi-modal transport, autocomplete, chatbot |
| v3.0 | Jan 2026 | **Detailed algorithm implementation**, new objective function prioritizing out-of-pocket savings over time |

---

## Executive Summary

This document provides a **detailed, function-by-function implementation plan** for Tripy's core optimization algorithm. The primary goal is **minimizing out-of-pocket expenses** (cash paid). Using credit card points to avoid paying cash is the primary strategy; time is a secondary consideration.

### Core Principle

> **If paying with points saves more cash than the alternative (train, bus, cash flight), then use points.**

Example:
- Option A: Flight with 50,000 Chase points + $85 surcharge → Out-of-pocket: **$85**
- Option B: Train ticket → Out-of-pocket: **$150**
- **Winner: Option A** (points flight saves $65)

---

## Table of Contents

1. [Algorithm Overview](#algorithm-overview)
2. [The Objective Function](#the-objective-function)
3. [Complete Data Flow](#complete-data-flow)
4. [Function-by-Function Implementation](#function-by-function-implementation)
5. [Edge Types and Cost Structure](#edge-types-and-cost-structure)
6. [ILP Model Details](#ilp-model-details)
7. [Multi-Modal Transport Integration](#multi-modal-transport-integration)
8. [Transfer Partner Optimization](#transfer-partner-optimization)
9. [Worked Examples](#worked-examples)
10. [API Integration Details](#api-integration-details)

---

## Algorithm Overview

### What We're Solving

Given:
- A set of cities to visit (start, intermediate destinations, end)
- Available credit card points (Chase, Amex, Citi, etc.)
- Available airline miles (United, Delta, etc.)
- Cash budget constraint

Find:
- The optimal path through all cities
- The optimal payment method for each segment (cash vs points)
- The optimal transfer strategy (which bank points → which airline)

### The Core Algorithm

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TRIPY OPTIMIZATION PIPELINE                         │
└─────────────────────────────────────────────────────────────────────────────┘

Step 1: INPUT COLLECTION
    ├── User destinations: [Seattle] → [Tokyo, Kyoto] → [Seattle]
    ├── User points: {Chase: 200,000, United: 50,000}
    ├── Budget: $2,000 max cash
    └── Dates: March 10-18, 2025

Step 2: AIRPORT RESOLUTION
    ├── Seattle → SEA
    ├── Tokyo → NRT, HND
    └── Kyoto → KIX, ITM

Step 3: EDGE COLLECTION (for ALL origin-destination pairs)
    ├── SEA → NRT: [Flight UA $800 cash, Flight UA 70k pts + $50, Train N/A]
    ├── SEA → HND: [Flight NH $850 cash, Flight NH 65k pts + $80]
    ├── NRT → KIX: [Flight $200 cash, Train $80 cash (2.5h)]
    ├── HND → KIX: [Flight $180 cash, Train $90 cash (2h)]
    ├── KIX → SEA: [Flight UA $750 cash, Flight UA 65k pts + $50]
    └── ... (all permutations)

Step 4: BUILD ILP GRAPH
    ├── Nodes: [SEA, NRT, HND, KIX, ITM]
    ├── Edges: All transport options with costs
    └── Variables: Path selection, payment method, transfers

Step 5: SOLVE ILP
    ├── Objective: MINIMIZE out-of-pocket cash
    ├── Subject to: Valid path, budget, points availability
    └── Output: Optimal path + payment allocation

Step 6: GENERATE RESULT
    ├── Path: SEA → NRT → KIX → SEA
    ├── Payments: [Flight 70k Chase→UA + $50, Train $80, Flight 65k Chase→UA + $50]
    └── Total out-of-pocket: $180 (vs $1,750 all-cash)
```

---

## The Objective Function

### Current vs New Objective

**Current Objective (v1/v2):**
```
MAXIMIZE: W₁×(PointsValue) - W₂×(CashPaid) - W₃×(Time)
Where W₁=10⁶, W₂=10³, W₃=1
```

This maximizes the "value" you get from points, which doesn't directly minimize out-of-pocket.

**New Objective (v3) - Minimize Out-of-Pocket:**
```
MINIMIZE: W₁×(OutOfPocketCash) + W₂×(Time)
Where W₁=10⁶, W₂=1

OutOfPocketCash = CashBookings + PointsSurcharges
```

### Why This Matters

Consider SEA → NRT:
- **Option A**: Cash flight = $800
- **Option B**: Points flight = 70,000 United miles + $85 surcharge
- **Option C**: (Hypothetical) Train = $200

| Metric | Option A | Option B | Option C |
|--------|----------|----------|----------|
| Out-of-pocket | $800 | $85 | $200 |
| Points used | 0 | 70,000 | 0 |
| **Best for minimizing cash?** | No | **Yes** | No |

With the new objective, **Option B wins** because $85 < $200 < $800.

### The New Objective Function (Code)

```python
def minimize_out_of_pocket_objective(
    m: pl.LpProblem,
    travelers: List[str],
    edges: List[Edge],
    cash_cost: Dict[Edge, float],
    time_cost: Dict[Edge, float],
    x: Dict[str, Dict[Edge, pl.LpVariable]],      # Path selection
    z: Dict[Tuple, Dict[Edge, pl.LpVariable]],    # Cash payment
    y: Dict[Tuple, Dict[Tuple, Dict[Edge, pl.LpVariable]]],  # Points via transfer
    y_native: Dict[Tuple, Dict[str, Dict[Edge, pl.LpVariable]]],  # Native miles
    get_surcharge: Callable[[str, Edge], float],
    airlines: List[str],
    W1: float = 1e6,  # Weight for cash (primary)
    W2: float = 1.0,  # Weight for time (secondary)
):
    """
    Build objective function that MINIMIZES out-of-pocket expenses.
    
    Out-of-pocket = cash bookings + surcharges on points bookings
    
    The algorithm will prefer using points (even if it uses many points)
    as long as the surcharge is less than the cash alternative.
    """
    T = travelers
    A = airlines
    
    # Component 1: Cash bookings (full cash price)
    cash_bookings = pl.lpSum(
        z[(q, p)][e] * cash_cost.get(e, 0.0)
        for q in T
        for p in T
        for e in edges
    )
    
    # Component 2: Surcharges on points bookings (transferred points)
    transfer_surcharges = pl.lpSum(
        y[(q, p)][(s, a)][e] * get_surcharge(a, e)
        for q in T
        for p in T
        for (s, a) in y[(q, p)].keys()
        for e in edges
    )
    
    # Component 3: Surcharges on native miles bookings
    native_surcharges = pl.lpSum(
        y_native[(q, p)][a][e] * get_surcharge(a, e)
        for q in T
        for p in T
        for a in A
        for e in edges
    )
    
    # Total out-of-pocket
    out_of_pocket = cash_bookings + transfer_surcharges + native_surcharges
    
    # Time component (secondary)
    total_time = pl.lpSum(
        x[p][e] * time_cost.get(e, 0.0)
        for p in T
        for e in edges
    )
    
    # MINIMIZE: out_of_pocket (primary) + time (secondary)
    # W1 >> W2 ensures cash minimization always trumps time
    m += W1 * out_of_pocket + W2 * total_time
    
    return m
```

### Decision Logic

For each edge (transport segment), the optimizer chooses:

```python
def edge_decision_logic(edge, options):
    """
    Pseudocode for how the optimizer decides payment method.
    
    Options:
    - Cash: Pay full cash_cost
    - Points (transfer): Pay surcharge only (if you have transferable points)
    - Points (native): Pay surcharge only (if you have airline miles)
    - Ground (train/bus): Pay cash (no points option)
    """
    
    costs = []
    
    # Option 1: Pay cash for this edge
    if edge.has_cash_option:
        costs.append({
            "type": "cash",
            "out_of_pocket": edge.cash_cost,
            "points_used": 0,
        })
    
    # Option 2: Pay with transferable points
    for (bank, airline) in available_transfers:
        if can_book_with_points(edge, airline):
            costs.append({
                "type": "points_transfer",
                "source": bank,
                "airline": airline,
                "out_of_pocket": edge.surcharge[airline],  # Only the surcharge!
                "points_used": edge.miles_required[airline],
            })
    
    # Option 3: Pay with native airline miles
    for airline in airlines_with_native_balance:
        if can_book_with_points(edge, airline):
            costs.append({
                "type": "points_native",
                "airline": airline,
                "out_of_pocket": edge.surcharge[airline],
                "points_used": edge.miles_required[airline],
            })
    
    # Option 4: Ground transport (cash only)
    if edge.has_train:
        costs.append({
            "type": "train",
            "out_of_pocket": edge.train_cash_cost,
            "points_used": 0,
        })
    
    if edge.has_bus:
        costs.append({
            "type": "bus",
            "out_of_pocket": edge.bus_cash_cost,
            "points_used": 0,
        })
    
    # THE KEY DECISION: Choose minimum out-of-pocket
    # (subject to having enough points/budget)
    return min(costs, key=lambda x: x["out_of_pocket"])
```

---

## Complete Data Flow

### End-to-End Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              USER INPUT                                      │
│  • Start: Seattle (SEA)                                                      │
│  • Visit: Tokyo, Kyoto                                                       │
│  • End: Seattle (SEA)                                                        │
│  • Dates: March 10-18                                                        │
│  • Points: Chase 200k, United 50k                                            │
│  • Budget: $2,000 max                                                        │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         1. DESTINATION RESOLUTION                            │
│                                                                              │
│  Input: ["Seattle", "Tokyo", "Kyoto"]                                        │
│  Output: {                                                                   │
│    "Seattle": ["SEA"],                                                       │
│    "Tokyo": ["NRT", "HND"],                                                  │
│    "Kyoto": ["KIX", "ITM"],                                                  │
│  }                                                                           │
│                                                                              │
│  Function: _normalize_city_to_code(city_name) → List[airport_codes]         │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       2. POINTS NORMALIZATION                                │
│                                                                              │
│  Input: {"Chase Ultimate Rewards": 200000, "United MileagePlus": 50000}     │
│  Output: {                                                                   │
│    "user1": {                                                                │
│      "chase": 200000,     # Bank (lowercase) - can transfer                  │
│      "UA": 50000,         # Airline (uppercase) - use directly               │
│    }                                                                         │
│  }                                                                           │
│                                                                              │
│  Function: _normalize_program_to_transfer_key(program) → code               │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         3. EDGE COLLECTION                                   │
│                                                                              │
│  For each origin-destination pair, fetch ALL transport options:             │
│                                                                              │
│  SEA → NRT:                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Edge: (SEA, NRT, UA123)                                              │    │
│  │   cash_cost: $850                                                    │    │
│  │   time_cost: 660 min (11h)                                           │    │
│  │   points_cost: {UA: 70000}                                           │    │
│  │   points_surcharge: {UA: $50}                                        │    │
│  │   mode: "flight"                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Edge: (SEA, NRT, NH456)                                              │    │
│  │   cash_cost: $920                                                    │    │
│  │   time_cost: 720 min (12h)                                           │    │
│  │   points_cost: {NH: 65000}                                           │    │
│  │   points_surcharge: {NH: $120}                                       │    │
│  │   mode: "flight"                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  NRT → KIX:                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Edge: (NRT, KIX, JL789)                                              │    │
│  │   cash_cost: $180                                                    │    │
│  │   time_cost: 75 min                                                  │    │
│  │   points_cost: {JL: 7500}                                            │    │
│  │   points_surcharge: {JL: $20}                                        │    │
│  │   mode: "flight"                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Edge: (NRT, KIX, TRAIN_SHINKANSEN)                                   │    │
│  │   cash_cost: $130                                                    │    │
│  │   time_cost: 150 min (2.5h)                                          │    │
│  │   points_cost: null (no points option)                               │    │
│  │   mode: "train"                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  Function: get_all_transport_edges(origin, dest, date, points, filters)     │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        4. BUILD ILP INPUTS                                   │
│                                                                              │
│  Convert edges + points into ILP-ready format:                              │
│                                                                              │
│  ilp_inputs = {                                                              │
│    "travelers": ["user1"],                                                   │
│    "cities": ["SEA", "NRT", "HND", "KIX", "ITM"],                           │
│    "edges": [(SEA,NRT,UA123), (SEA,NRT,NH456), (NRT,KIX,JL789), ...],       │
│    "cash_cost": {(SEA,NRT,UA123): 850, (NRT,KIX,TRAIN): 130, ...},          │
│    "time_cost": {(SEA,NRT,UA123): 660, (NRT,KIX,TRAIN): 150, ...},          │
│    "airlines": ["UA", "NH", "JL"],                                           │
│    "award_points": {                                                         │
│      "UA": {(SEA,NRT,UA123): 70000, ...},                                   │
│      "NH": {(SEA,NRT,NH456): 65000, ...},                                   │
│    },                                                                        │
│    "cash_surcharge": {                                                       │
│      "UA": {(SEA,NRT,UA123): 50, ...},                                      │
│    },                                                                        │
│    "sources_by_trav": {"user1": ["chase"]},                                 │
│    "source_balances": {("user1", "chase"): 200000},                         │
│    "miles_balance": {("user1", "UA"): 50000},                               │
│    "allowed_sa": {("chase", "UA"), ("chase", "NH"), ...},                   │
│    "budget_cash": {"user1": 2000},                                          │
│  }                                                                           │
│                                                                              │
│  Function: build_ilp_inputs_from_edges(edges, travelers, points, ...)       │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         5. SOLVE ILP                                         │
│                                                                              │
│  Create and solve the optimization problem:                                  │
│                                                                              │
│  MINIMIZE:                                                                   │
│    1,000,000 × (cash_bookings + surcharges)   # Primary: out-of-pocket      │
│    + 1 × total_time                           # Secondary: travel time       │
│                                                                              │
│  SUBJECT TO:                                                                 │
│    • Valid path from SEA through all destinations back to SEA               │
│    • Each segment paid exactly once (cash OR points)                        │
│    • Points used ≤ available balance                                        │
│    • Cash spent ≤ budget                                                    │
│    • Transfer rules respected (Chase → UA is valid)                         │
│                                                                              │
│  Function: plan_minimize_out_of_pocket(ilp_inputs) → solution               │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         6. EXTRACT SOLUTION                                  │
│                                                                              │
│  solution = {                                                                │
│    "status": "Optimal",                                                      │
│    "path": {"user1": ["SEA", "NRT", "KIX", "SEA"]},                         │
│    "pay_mode": {                                                             │
│      "user1": [                                                              │
│        {                                                                     │
│          "edge": ["SEA", "NRT", "UA123"],                                   │
│          "type": "points",                                                   │
│          "via": {"source": "chase", "airline": "UA"},                       │
│          "miles": 70000,                                                     │
│          "surcharge": 50,                                                    │
│          "mode": "flight",                                                   │
│        },                                                                    │
│        {                                                                     │
│          "edge": ["NRT", "KIX", "TRAIN_SHINKANSEN"],                        │
│          "type": "cash",                                                     │
│          "fare": 130,                                                        │
│          "mode": "train",                                                    │
│        },                                                                    │
│        {                                                                     │
│          "edge": ["KIX", "SEA", "UA456"],                                   │
│          "type": "points",                                                   │
│          "via": {"source": "chase", "airline": "UA"},                       │
│          "miles": 65000,                                                     │
│          "surcharge": 50,                                                    │
│          "mode": "flight",                                                   │
│        },                                                                    │
│      ]                                                                       │
│    },                                                                        │
│    "totals": {                                                               │
│      "cash": 230,           # $50 + $130 + $50                              │
│      "airline_points": 135000,                                               │
│      "transfers": {"user1": {"chase": {"UA": 135000}}},                     │
│    }                                                                         │
│  }                                                                           │
│                                                                              │
│  SAVINGS: $1,850 cash price - $230 out-of-pocket = $1,620 saved (88%)       │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Function-by-Function Implementation

### 4.1 `generate_optimized_itinerary` (Entry Point)

**Location:** `backend/src/services/itinerary_service.py`

```python
async def generate_optimized_itinerary(trip_id: str) -> Dict[str, Any]:
    """
    Main entry point for itinerary optimization.
    
    Steps:
    1. Load trip data (destinations, dates, budget)
    2. Load points for all travelers
    3. Resolve city names to airport codes
    4. Fetch transport edges for all O-D pairs
    5. Build ILP inputs
    6. Solve ILP optimization
    7. Save and return results
    
    Returns:
    {
        "status": "Optimal" | "Infeasible" | ...,
        "solution": {...},
        "items": [...],
        "out_of_pocket": 230,
    }
    """
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 1: Load trip data
    # ─────────────────────────────────────────────────────────────────────
    trip = trip_service.get_trip(trip_id)
    if not trip:
        raise ValueError(f"Trip {trip_id} not found")
    
    start_date = trip.get("startDate", "")
    end_date = trip.get("endDate", "")
    max_budget = trip.get("maxBudget")  # User's cash budget limit
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 2: Load destinations
    # ─────────────────────────────────────────────────────────────────────
    destinations = destination_service.list_destinations(trip_id)
    
    # Find start/end destinations (marked with isStart/isEnd flags)
    start_dest = next((d for d in destinations if d.get("isStart")), None)
    end_dest = next((d for d in destinations if d.get("isEnd")), None)
    
    # Middle destinations (cities to visit)
    middle_dests = [d for d in destinations 
                    if not d.get("isStart") and not d.get("isEnd") and not d.get("excluded")]
    
    start_name = start_dest.get("name") if start_dest else destinations[0].get("name")
    end_name = end_dest.get("name") if end_dest else start_name  # Round trip if no end
    middle_names = [d.get("name") for d in middle_dests]
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 3: Resolve cities to airport codes (parallel)
    # ─────────────────────────────────────────────────────────────────────
    all_names = [start_name, end_name] + middle_names
    code_results = await asyncio.gather(
        *[asyncio.to_thread(_normalize_city_to_code, name) for name in all_names],
        return_exceptions=True,
    )
    
    start_code = code_results[0]  # e.g., "SEA"
    end_code = code_results[1]    # e.g., "SEA" (round trip)
    middle_codes = [r for r in code_results[2:] if r and not isinstance(r, Exception)]
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 4: Load travelers and points
    # ─────────────────────────────────────────────────────────────────────
    members = trip_member_service.list_members(trip_id)
    travelers = [m.get("userId") for m in members if m.get("status") == "active"]
    
    points_summary = points_service.trip_points_summary(trip_id)
    user_points_by_trav = {}
    
    for item in points_summary.get("items", []):
        user_id = item.get("userId")
        program = _normalize_program_to_transfer_key(item.get("program", ""))
        balance = int(item.get("balance", 0))
        
        if user_id and program and balance > 0:
            if user_id not in user_points_by_trav:
                user_points_by_trav[user_id] = {}
            user_points_by_trav[user_id][program] = balance
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 5: Fetch transport edges for all O-D pairs
    # ─────────────────────────────────────────────────────────────────────
    all_cities = list(dict.fromkeys([start_code] + middle_codes + [end_code]))
    pairs = [(o, d) for o in all_cities for d in all_cities if o != d]
    
    # Combine points from all travelers for edge fetching
    combined_points = {}
    for user_points in user_points_by_trav.values():
        for prog, bal in user_points.items():
            combined_points[prog] = combined_points.get(prog, 0) + bal
    
    # Fetch all edges in parallel (flights, trains, buses)
    edges_all = {}
    sem = asyncio.Semaphore(6)  # Limit concurrent API calls
    
    async def fetch_edges(o: str, d: str):
        async with sem:
            return await get_all_transport_edges(
                origin=o,
                destination=d,
                date=start_date,
                combined_points=combined_points,
                filters={"pax": len(travelers)},
            )
    
    results = await asyncio.gather(
        *[fetch_edges(o, d) for o, d in pairs],
        return_exceptions=True,
    )
    
    for i, (o, d) in enumerate(pairs):
        if not isinstance(results[i], Exception):
            edges, flags = results[i]
            edges_all.update(edges)
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 6: Build ILP inputs and solve
    # ─────────────────────────────────────────────────────────────────────
    start_city_by_trav = {t: start_code for t in travelers}
    end_city_by_trav = {t: end_code for t in travelers}
    
    per_traveler_budget = (max_budget // len(travelers)) if max_budget else 1e9
    
    solution = run_ilp_from_edges(
        edges_dict=edges_all,
        travelers=travelers,
        start_city_by_trav=start_city_by_trav,
        end_city_by_trav=end_city_by_trav,
        user_points_by_trav=user_points_by_trav,
        plan_fn=plan_minimize_out_of_pocket,  # ← NEW OBJECTIVE FUNCTION
        must_visit_cities=middle_codes,
        transfer_graph=DEFAULT_TRANSFER_GRAPH,
        default_cash_budget=per_traveler_budget,
    )
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 7: Build and return result
    # ─────────────────────────────────────────────────────────────────────
    total_out_of_pocket = solution.get("totals", {}).get("cash", 0)
    
    return {
        "status": solution.get("status"),
        "solution": solution,
        "out_of_pocket": total_out_of_pocket,
        "items": build_itinerary_items(trip_id, solution, edges_all),
    }
```

### 4.2 `_normalize_city_to_code` (City → Airport)

```python
def _normalize_city_to_code(city_name: str) -> Optional[str]:
    """
    Convert city name to IATA airport code.
    
    Examples:
    - "New York" → "JFK" (primary airport)
    - "NYC" → "JFK"
    - "Tokyo" → "NRT" (or "HND")
    - "Paris (CDG,ORY)" → "CDG" (first code)
    - "JFK" → "JFK" (already a code)
    
    Returns: IATA code or None if not found
    """
    city_name = city_name.strip()
    
    # Already an airport code?
    if re.match(r'^[A-Z]{3}$', city_name.upper()):
        return city_name.upper()
    
    # Extract code from "City (CODE)" format
    match = re.search(r'\(([A-Z]{3}(?:,[A-Z]{3})*)\)', city_name.upper())
    if match:
        codes = match.group(1).split(',')
        return codes[0]  # Return first/primary airport
    
    # Search using city service (Amadeus API or CSV fallback)
    search_name = re.sub(r'\s*\([^)]*\)', '', city_name).strip()
    
    try:
        results = city_service.search_cities(search_name, max_results=5)
        
        for result in results:
            iata = result.get("iataCode", "")
            if iata and re.match(r'^[A-Z]{3}$', iata.upper()):
                return iata.upper()
    except Exception as e:
        logger.warning(f"City search failed for {city_name}: {e}")
    
    # Fallback: try OpenAI
    try:
        from src.handlers.openAI import find_commercial_airports_for_city
        airports = find_commercial_airports_for_city(search_name, max_results=3)
        for a in airports:
            code = (a.get("iata_code") or "").upper().strip()
            if code and re.match(r'^[A-Z]{3}$', code):
                return code
    except Exception:
        pass
    
    return None
```

### 4.3 `_normalize_program_to_transfer_key` (Program → Code)

```python
def _normalize_program_to_transfer_key(program: str) -> str:
    """
    Normalize loyalty program name to transfer graph key.
    
    Banks return lowercase (match transfer_graph keys):
    - "Chase Ultimate Rewards" → "chase"
    - "Amex Membership Rewards" → "amex"
    
    Airlines return uppercase 2-letter IATA:
    - "United MileagePlus" → "UA"
    - "Delta SkyMiles" → "DL"
    
    This is critical because:
    - Banks can TRANSFER to airlines (chase → UA)
    - Airlines can be used DIRECTLY (UA miles → book UA flight)
    """
    s = (program or "").strip().lower()
    
    # Bank mappings
    BANK_MAP = {
        "chase": "chase",
        "chase ultimate rewards": "chase",
        "amex": "amex",
        "amex membership rewards": "amex",
        "membership rewards": "amex",
        "citi": "citi",
        "citi thankyou": "citi",
        "capital one": "capitalone",
        "capitalone": "capitalone",
        "bilt": "bilt",
        "bilt rewards": "bilt",
    }
    
    if s in BANK_MAP:
        return BANK_MAP[s]
    
    # Airline mappings
    AIRLINE_MAP = {
        "united": "UA",
        "united mileageplus": "UA",
        "american": "AA",
        "american aadvantage": "AA",
        "delta": "DL",
        "delta skymiles": "DL",
        "alaska": "AS",
        "british airways": "BA",
        "air france": "AF",
        "singapore": "SQ",
        # ... more airlines
    }
    
    if s in AIRLINE_MAP:
        return AIRLINE_MAP[s]
    
    # Already a short code?
    original = program.strip()
    if len(original) == 2 and original.isupper():
        return original  # e.g., "UA", "DL"
    if len(original) <= 10 and original.islower():
        return original  # e.g., "chase", "amex"
    
    return s
```

### 4.4 `get_all_transport_edges` (Unified Edge Fetcher)

```python
async def get_all_transport_edges(
    origin: str,
    destination: str,
    date: str,
    combined_points: Dict[str, int],
    filters: Dict[str, Any],
) -> Tuple[Dict[Tuple[str, str, str], Dict[str, Any]], Dict[str, bool]]:
    """
    Fetch ALL transport options between two cities in parallel.
    
    Returns:
        (edges_dict, availability_flags)
        
    edges_dict format:
        {
            (origin, dest, mode_id): {
                "cash_cost": float,      # Full cash price
                "time_cost": float,      # Duration in minutes
                "points_cost": float,    # Miles required (or None for ground)
                "points_program": str,   # Airline code (or None)
                "points_surcharge": float,  # Taxes/fees when using points
                "mode": str,             # "flight" | "train" | "bus" | "car"
            }
        }
    """
    edges = {}
    flags = {"flights": False, "trains": False, "buses": False, "cars": False}
    
    # Launch all fetchers in parallel
    flight_task = _fetch_flights(origin, destination, date, combined_points, filters)
    train_task = get_train_options_async(origin, destination, date)
    ground_task = asyncio.to_thread(get_bus_and_car_options, origin, destination, date)
    
    results = await asyncio.gather(
        flight_task, train_task, ground_task,
        return_exceptions=True,
    )
    
    # Process flights
    if not isinstance(results[0], Exception) and results[0]:
        edges.update(results[0])
        flags["flights"] = True
    
    # Process trains
    if not isinstance(results[1], Exception) and results[1]:
        train_edges = train_options_to_edges(origin, destination, results[1])
        edges.update(train_edges)
        flags["trains"] = bool(train_edges)
    
    # Process ground (bus/car)
    if not isinstance(results[2], Exception) and results[2]:
        ground_edges = ground_options_to_edges(origin, destination, results[2])
        edges.update(ground_edges)
        flags["buses"] = any(e[2] == "BUS" for e in ground_edges)
        flags["cars"] = any(e[2] == "CAR" for e in ground_edges)
    
    return edges, flags


async def _fetch_flights(
    origin: str,
    destination: str,
    date: str,
    combined_points: Dict[str, int],
    filters: Dict[str, Any],
) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
    """
    Fetch flight edges from AwardTool + SerpAPI.
    
    Returns edges with both cash and points options.
    """
    filters = {
        **filters,
        "outbound_date": date,
        "award_programs": get_award_programs_for_api(),
    }
    
    # Try AwardTool first (award availability)
    edges = await get_flights_award_first_with_points_async(
        origin, destination, combined_points, filters
    )
    
    # Fallback to SerpAPI if no award availability
    if not edges:
        edges = await get_flights_serp_first_with_points_async(
            origin, destination, combined_points, filters
        )
    
    # Last resort: cash-only from SerpAPI
    if not edges:
        edges = await asyncio.to_thread(
            get_flights_serp_only, origin, destination, date, filters
        )
    
    return edges or {}
```

### 4.5 `build_ilp_inputs_from_edges` (Edge → ILP Format)

```python
def build_ilp_inputs_from_edges(
    edges_dict: Dict[Tuple[str, str, str], Dict],
    travelers: List[str],
    start_city_by_trav: Dict[str, str],
    end_city_by_trav: Dict[str, str],
    user_points_by_trav: Dict[str, Dict[str, float]],
    *,
    must_visit_cities: List[str] = None,
    transfer_graph: Dict = None,
    bank_block_size: int = 1000,
    default_cash_budget: float = 1e9,
) -> Dict[str, Any]:
    """
    Transform raw edges and user data into ILP-ready inputs.
    
    This function:
    1. Extracts all unique cities from edges
    2. Builds cost matrices (cash, time, points)
    3. Maps user points to bank sources and airline balances
    4. Sets up transfer partner eligibility
    5. Configures budget constraints
    
    Returns a dictionary with all ILP parameters.
    """
    edges = list(edges_dict.keys())
    
    # ─────────────────────────────────────────────────────────────────────
    # Extract cities
    # ─────────────────────────────────────────────────────────────────────
    city_set = set()
    for i, j, _ in edges:
        city_set.add(i)
        city_set.add(j)
    for t in travelers:
        city_set.add(start_city_by_trav.get(t, ""))
        city_set.add(end_city_by_trav.get(t, ""))
    cities = sorted(city_set - {""})
    
    # ─────────────────────────────────────────────────────────────────────
    # Extract airlines from edges
    # ─────────────────────────────────────────────────────────────────────
    airline_set = set()
    for e, data in edges_dict.items():
        prog = (data.get("points_program") or "").upper()
        if prog and len(prog) == 2:
            airline_set.add(prog)
    airlines = sorted(airline_set)
    
    # ─────────────────────────────────────────────────────────────────────
    # Build cost matrices
    # ─────────────────────────────────────────────────────────────────────
    time_cost = {}
    cash_cost = {}
    
    for e, data in edges_dict.items():
        time_cost[e] = float(data.get("time_cost") or 1e6)
        cash_cost[e] = float(data.get("cash_cost") or 1e7)
    
    # ─────────────────────────────────────────────────────────────────────
    # Build points matrices (per airline)
    # ─────────────────────────────────────────────────────────────────────
    award_points = {a: {} for a in airlines}
    cash_surcharge = {a: {} for a in airlines}
    allowed_award_edge = {a: {} for a in airlines}
    
    for e, data in edges_dict.items():
        airline = (data.get("points_program") or "").upper()
        pts = data.get("points_cost")
        sur = data.get("points_surcharge")
        
        for a in airlines:
            if a == airline and pts is not None:
                award_points[a][e] = float(pts)
                cash_surcharge[a][e] = float(sur or 0)
                allowed_award_edge[a][e] = 1
            else:
                award_points[a][e] = 0
                cash_surcharge[a][e] = 0
                allowed_award_edge[a][e] = 0
    
    # ─────────────────────────────────────────────────────────────────────
    # Split user points into banks (transferable) vs airlines (direct)
    # ─────────────────────────────────────────────────────────────────────
    sources_by_trav = {}      # {traveler: [bank1, bank2, ...]}
    source_balances = {}      # {(traveler, bank): balance}
    miles_balance = {}        # {(traveler, airline): balance}
    
    tg = transfer_graph or {}
    
    for trav, balances in (user_points_by_trav or {}).items():
        banks = []
        for key, value in balances.items():
            if key.islower() and key in tg:
                # This is a bank (chase, amex, etc.) - can transfer
                banks.append(key)
                source_balances[(trav, key)] = float(value)
            else:
                # This is an airline (UA, DL, etc.) - use directly
                airline = key.upper()
                if airline in airlines:
                    miles_balance[(trav, airline)] = float(value)
        
        sources_by_trav[trav] = banks
    
    # ─────────────────────────────────────────────────────────────────────
    # Build transfer partner eligibility
    # ─────────────────────────────────────────────────────────────────────
    allowed_sa = set()  # (source, airline) pairs that can transfer
    ratio = {}          # Transfer ratio (usually 1.0)
    bonus = {}          # Bonus multiplier (usually 1.0)
    inc_source = {}     # Transfer block size
    
    for bank, airline_map in tg.items():
        for airline, transfer_ratio in (airline_map or {}).items():
            airline_code = airline.upper()
            if airline_code not in airlines:
                continue
            
            allowed_sa.add((bank, airline_code))
            ratio[(bank, airline_code)] = float(transfer_ratio)
            bonus[(bank, airline_code)] = 1.0  # No bonus by default
            inc_source[(bank, airline_code)] = bank_block_size
    
    # ─────────────────────────────────────────────────────────────────────
    # Build link_ok: which traveler can use which airline
    # ─────────────────────────────────────────────────────────────────────
    link_ok = {}
    for trav in travelers:
        banks = set(sources_by_trav.get(trav, []))
        for a in airlines:
            # Can use airline if:
            # 1. Has native miles in that airline, OR
            # 2. Has a bank that can transfer to that airline
            has_native = (trav, a) in miles_balance and miles_balance[(trav, a)] > 0
            has_transfer = any((b, a) in allowed_sa for b in banks)
            link_ok[(trav, a)] = 1 if (has_native or has_transfer) else 0
    
    # ─────────────────────────────────────────────────────────────────────
    # Budget and payment rules
    # ─────────────────────────────────────────────────────────────────────
    budget_cash = {trav: float(default_cash_budget) for trav in travelers}
    
    can_pay_for = {}
    for q in travelers:
        for p in travelers:
            can_pay_for[(q, p)] = 1  # Allow any traveler to pay for any other
    
    return {
        "travelers": travelers,
        "start_city": start_city_by_trav,
        "end_city": end_city_by_trav,
        "cities": cities,
        "edges": edges,
        "time_cost": time_cost,
        "cash_cost": cash_cost,
        "airlines": airlines,
        "award_points": award_points,
        "cash_surcharge": cash_surcharge,
        "allowed_award_edge": allowed_award_edge,
        "sources_by_trav": sources_by_trav,
        "source_balances": source_balances,
        "allowed_sa": allowed_sa,
        "ratio": ratio,
        "bonus": bonus,
        "inc_source": inc_source,
        "miles_balance": miles_balance,
        "link_ok": link_ok,
        "budget_cash": budget_cash,
        "can_pay_for": can_pay_for,
        "must_visit_cities": must_visit_cities or [],
    }
```

### 4.6 `plan_minimize_out_of_pocket` (The Core ILP Solver)

```python
def plan_minimize_out_of_pocket(
    travelers: List[str],
    start_city: Dict[str, str],
    end_city: Dict[str, str],
    cities: List[str],
    edges: List[Tuple[str, str, str]],
    time_cost: Dict[Tuple, float],
    cash_cost: Dict[Tuple, float],
    airlines: List[str],
    award_points: Dict[str, Dict[Tuple, float]],
    cash_surcharge: Dict[str, Dict[Tuple, float]],
    allowed_award_edge: Dict[str, Dict[Tuple, int]],
    sources_by_trav: Dict[str, List[str]],
    source_balances: Dict[Tuple[str, str], float],
    allowed_sa: Set[Tuple[str, str]],
    ratio: Dict[Tuple[str, str], float],
    bonus: Dict[Tuple[str, str], float],
    inc_source: Dict[Tuple[str, str], int],
    miles_balance: Dict[Tuple[str, str], float],
    link_ok: Dict[Tuple[str, str], int],
    budget_cash: Dict[str, float],
    can_pay_for: Dict[Tuple[str, str], int],
    total_cash_seats: Dict[Tuple, int] = None,
    award_seats: Dict[str, Dict[Tuple, int]] = None,
    meetup_cities: List[str] = None,
    must_visit_cities: List[str] = None,
    *,
    W1: float = 1e6,   # Weight for out-of-pocket cash (PRIMARY)
    W2: float = 1.0,   # Weight for time (SECONDARY)
) -> Dict[str, Any]:
    """
    ═══════════════════════════════════════════════════════════════════════════
    CORE ILP OPTIMIZER: MINIMIZE OUT-OF-POCKET EXPENSES
    ═══════════════════════════════════════════════════════════════════════════
    
    OBJECTIVE:
        MINIMIZE: W₁ × (CashBookings + PointsSurcharges) + W₂ × TotalTime
        
        Where:
        - CashBookings = sum of full cash prices for edges paid in cash
        - PointsSurcharges = sum of taxes/fees for edges paid with points
        - TotalTime = sum of travel duration
        - W₁ >> W₂ ensures cash minimization is always primary
    
    DECISION VARIABLES:
        x[p][e] ∈ {0,1}     : Does passenger p take edge e?
        z[q,p][e] ∈ {0,1}   : Does payer q pay CASH for passenger p on edge e?
        y[q,p][s,a][e] ∈ {0,1}: Does payer q transfer from bank s to airline a 
                               for passenger p on edge e?
        y_native[q,p][a][e] ∈ {0,1}: Does payer q use native miles from airline a
                                     for passenger p on edge e?
        t_blocks[q][s,a] ∈ Z⁺: How many 1000-point blocks does payer q transfer 
                               from bank s to airline a?
    
    CONSTRAINTS:
        1. PATH: Valid path from start to end through must-visit cities
        2. PAYMENT: Each chosen edge has exactly one payment method
        3. TRANSFER: Points transferred ≤ available balance
        4. NATIVE: Native miles used ≤ available balance
        5. BUDGET: Cash spent (bookings + surcharges) ≤ budget
        6. ELIGIBILITY: Can only use airlines you have access to
    
    RETURNS:
        {
            "status": "Optimal" | "Infeasible" | ...,
            "path": {traveler_id: [city1, city2, ...]},
            "edges": {traveler_id: [[origin, dest, mode], ...]},
            "pay_mode": {traveler_id: [{edge, type, payer, ...}, ...]},
            "totals": {cash, airline_points, time, transfers, native_used},
        }
    """
    import pulp as pl
    
    T = travelers
    A = airlines
    INF = 1e9
    
    # ═══════════════════════════════════════════════════════════════════════
    # SETUP: Safe lookups for award data
    # ═══════════════════════════════════════════════════════════════════════
    
    def get_miles(airline: str, edge: Tuple) -> float:
        """Get miles required for this edge on this airline."""
        return award_points.get(airline, {}).get(edge, INF)
    
    def get_surcharge(airline: str, edge: Tuple) -> float:
        """Get surcharge (taxes/fees) for this edge on this airline."""
        return cash_surcharge.get(airline, {}).get(edge, INF)
    
    def can_book_points(airline: str, edge: Tuple) -> bool:
        """Can this edge be booked with points on this airline?"""
        return allowed_award_edge.get(airline, {}).get(edge, 0) == 1
    
    # ═══════════════════════════════════════════════════════════════════════
    # CREATE ILP MODEL
    # ═══════════════════════════════════════════════════════════════════════
    
    m = pl.LpProblem("MinimizeOutOfPocket", pl.LpMinimize)
    
    # ─────────────────────────────────────────────────────────────────────
    # Decision Variable: x[p][e] - Does passenger p take edge e?
    # ─────────────────────────────────────────────────────────────────────
    x = {
        p: {e: pl.LpVariable(f"x_{p}_{e}", cat="Binary") for e in edges}
        for p in T
    }
    
    # ─────────────────────────────────────────────────────────────────────
    # Decision Variable: z[q,p][e] - Does payer q pay CASH for passenger p on e?
    # ─────────────────────────────────────────────────────────────────────
    z = {
        (q, p): {e: pl.LpVariable(f"z_{q}_{p}_{e}", cat="Binary") for e in edges}
        for q in T for p in T
    }
    
    # ─────────────────────────────────────────────────────────────────────
    # Decision Variable: y[q,p][s,a][e] - Transfer from bank s to airline a
    # ─────────────────────────────────────────────────────────────────────
    y = {
        (q, p): {
            (s, a): {e: pl.LpVariable(f"y_{q}_{p}_{s}_{a}_{e}", cat="Binary") for e in edges}
            for s in sources_by_trav.get(q, [])
            for a in A
            if (s, a) in allowed_sa
        }
        for q in T for p in T
    }
    
    # ─────────────────────────────────────────────────────────────────────
    # Decision Variable: y_native[q,p][a][e] - Use native airline miles
    # ─────────────────────────────────────────────────────────────────────
    y_native = {
        (q, p): {
            a: {e: pl.LpVariable(f"yn_{q}_{p}_{a}_{e}", cat="Binary") for e in edges}
            for a in A
        }
        for q in T for p in T
    }
    
    # ─────────────────────────────────────────────────────────────────────
    # Decision Variable: t_blocks[q][s,a] - Transfer blocks (1000 points each)
    # ─────────────────────────────────────────────────────────────────────
    t_blocks = {
        q: {
            (s, a): pl.LpVariable(f"t_{q}_{s}_{a}", lowBound=0, cat="Integer")
            for s in sources_by_trav.get(q, [])
            for a in A
            if (s, a) in allowed_sa
        }
        for q in T
    }
    
    # ═══════════════════════════════════════════════════════════════════════
    # CONSTRAINT 1: PATH VALIDITY
    # ═══════════════════════════════════════════════════════════════════════
    
    for p in T:
        # Must leave start city exactly once
        m += pl.lpSum(x[p][e] for e in edges if e[0] == start_city[p]) == 1
        
        # Must enter end city exactly once
        m += pl.lpSum(x[p][e] for e in edges if e[1] == end_city[p]) == 1
        
        # Flow conservation: what goes in must come out (except start/end)
        for city in cities:
            outflow = pl.lpSum(x[p][e] for e in edges if e[0] == city)
            inflow = pl.lpSum(x[p][e] for e in edges if e[1] == city)
            
            if city == start_city[p]:
                m += outflow - inflow == 1  # Net outflow from start
            elif city == end_city[p]:
                m += outflow - inflow == -1  # Net inflow to end
            else:
                m += outflow == inflow  # Pass-through
    
    # Must-visit cities: enter each exactly once
    for city in (must_visit_cities or []):
        for p in T:
            if city != start_city.get(p) and city != end_city.get(p):
                m += pl.lpSum(x[p][e] for e in edges if e[1] == city) == 1
    
    # ═══════════════════════════════════════════════════════════════════════
    # CONSTRAINT 2: PAYMENT EXCLUSIVITY
    # Each chosen edge must be paid exactly once (cash OR points)
    # ═══════════════════════════════════════════════════════════════════════
    
    for p in T:
        for e in edges:
            # Sum of all payment methods = x[p][e] (1 if edge chosen, 0 otherwise)
            cash_payments = pl.lpSum(z[(q, p)][e] for q in T)
            transfer_payments = pl.lpSum(
                y[(q, p)][(s, a)][e]
                for q in T
                for (s, a) in y[(q, p)].keys()
            )
            native_payments = pl.lpSum(
                y_native[(q, p)][a][e] for q in T for a in A
            )
            
            m += cash_payments + transfer_payments + native_payments == x[p][e]
    
    # ═══════════════════════════════════════════════════════════════════════
    # CONSTRAINT 3: TRANSFER LIMITS
    # Can't transfer more points than you have
    # ═══════════════════════════════════════════════════════════════════════
    
    for q in T:
        for s in sources_by_trav.get(q, []):
            for a in A:
                if (s, a) not in allowed_sa:
                    continue
                
                block_size = inc_source.get((s, a), 1000)
                transfer_ratio = ratio.get((s, a), 1.0)
                transfer_bonus = bonus.get((s, a), 1.0)
                miles_per_block = block_size * transfer_ratio * transfer_bonus
                
                # Miles used via transfer ≤ miles delivered
                miles_used = pl.lpSum(
                    y[(q, p)][(s, a)][e] * get_miles(a, e)
                    for p in T
                    for e in edges
                    if (s, a) in y[(q, p)]
                )
                m += miles_used <= t_blocks[q][(s, a)] * miles_per_block
                
                # Points transferred ≤ points available
                m += t_blocks[q][(s, a)] * block_size <= source_balances.get((q, s), 0)
    
    # ═══════════════════════════════════════════════════════════════════════
    # CONSTRAINT 4: NATIVE MILES LIMITS
    # Can't use more native miles than you have
    # ═══════════════════════════════════════════════════════════════════════
    
    for q in T:
        for a in A:
            miles_used = pl.lpSum(
                y_native[(q, p)][a][e] * get_miles(a, e)
                for p in T
                for e in edges
            )
            m += miles_used <= miles_balance.get((q, a), 0)
    
    # ═══════════════════════════════════════════════════════════════════════
    # CONSTRAINT 5: CASH BUDGET
    # Total cash spent ≤ budget
    # ═══════════════════════════════════════════════════════════════════════
    
    for q in T:
        # Cash bookings
        cash_spending = pl.lpSum(
            z[(q, p)][e] * cash_cost.get(e, 0)
            for p in T
            for e in edges
        )
        
        # Surcharges on points bookings (transfers)
        transfer_surcharges = pl.lpSum(
            y[(q, p)][(s, a)][e] * get_surcharge(a, e)
            for p in T
            for (s, a) in y[(q, p)].keys()
            for e in edges
        )
        
        # Surcharges on native miles bookings
        native_surcharges = pl.lpSum(
            y_native[(q, p)][a][e] * get_surcharge(a, e)
            for p in T
            for a in A
            for e in edges
        )
        
        m += cash_spending + transfer_surcharges + native_surcharges <= budget_cash[q]
    
    # ═══════════════════════════════════════════════════════════════════════
    # CONSTRAINT 6: ELIGIBILITY
    # Can only use airlines you have access to
    # ═══════════════════════════════════════════════════════════════════════
    
    for q in T:
        for p in T:
            for e in edges:
                # Transfer eligibility
                for (s, a) in y[(q, p)].keys():
                    can_use = link_ok.get((q, a), 0) * (1 if can_book_points(a, e) else 0)
                    m += y[(q, p)][(s, a)][e] <= can_use
                
                # Native eligibility
                for a in A:
                    can_use = link_ok.get((q, a), 0) * (1 if can_book_points(a, e) else 0)
                    m += y_native[(q, p)][a][e] <= can_use
    
    # ═══════════════════════════════════════════════════════════════════════
    # OBJECTIVE FUNCTION: MINIMIZE OUT-OF-POCKET
    # ═══════════════════════════════════════════════════════════════════════
    
    # Component 1: Cash bookings (full price)
    cash_bookings_total = pl.lpSum(
        z[(q, p)][e] * cash_cost.get(e, 0)
        for q in T
        for p in T
        for e in edges
    )
    
    # Component 2: Surcharges on points bookings
    surcharges_total = (
        pl.lpSum(
            y[(q, p)][(s, a)][e] * get_surcharge(a, e)
            for q in T
            for p in T
            for (s, a) in y[(q, p)].keys()
            for e in edges
        )
        + pl.lpSum(
            y_native[(q, p)][a][e] * get_surcharge(a, e)
            for q in T
            for p in T
            for a in A
            for e in edges
        )
    )
    
    # Total out-of-pocket
    out_of_pocket = cash_bookings_total + surcharges_total
    
    # Component 3: Travel time (secondary)
    total_time = pl.lpSum(
        x[p][e] * time_cost.get(e, 0)
        for p in T
        for e in edges
    )
    
    # ═══════════════════════════════════════════════════════════════════════
    # THE OBJECTIVE: MINIMIZE (cash × W1) + (time × W2)
    # 
    # Since W1 = 1,000,000 and W2 = 1, cash is ALWAYS prioritized.
    # Example: $100 saved is worth 100,000,000 in objective value
    #          1000 minutes saved is worth 1,000 in objective value
    # ═══════════════════════════════════════════════════════════════════════
    
    m += W1 * out_of_pocket + W2 * total_time
    
    # ═══════════════════════════════════════════════════════════════════════
    # SOLVE
    # ═══════════════════════════════════════════════════════════════════════
    
    m.solve(pl.PULP_CBC_CMD(msg=False))
    
    # ═══════════════════════════════════════════════════════════════════════
    # EXTRACT SOLUTION
    # ═══════════════════════════════════════════════════════════════════════
    
    solution = {
        "status": pl.LpStatus[m.status],
        "path": {p: [] for p in T},
        "edges": {p: [] for p in T},
        "pay_mode": {p: [] for p in T},
        "totals": {
            "cash": 0.0,
            "airline_points": 0.0,
            "time": 0.0,
            "transfers": {q: {} for q in T},
            "native_used": {q: {} for q in T},
        },
    }
    
    if pl.LpStatus[m.status] != "Optimal":
        return solution
    
    # Extract paths
    for p in T:
        chosen_edges = [e for e in edges if pl.value(x[p][e]) > 0.5]
        solution["edges"][p] = [[e[0], e[1], e[2]] for e in chosen_edges]
        
        # Reconstruct path
        next_city = {e[0]: e[1] for e in chosen_edges}
        path = [start_city[p]]
        current = start_city[p]
        while current in next_city and current != end_city[p]:
            current = next_city[current]
            path.append(current)
        solution["path"][p] = path
    
    # Extract payment methods and calculate totals
    total_cash = 0.0
    total_points = 0.0
    total_time_val = 0.0
    
    for p in T:
        for e in [tuple(edge) for edge in solution["edges"][p]]:
            total_time_val += time_cost.get(e, 0)
            
            # Check cash payment
            for q in T:
                if pl.value(z[(q, p)][e]) > 0.5:
                    fare = cash_cost.get(e, 0)
                    total_cash += fare
                    solution["pay_mode"][p].append({
                        "edge": [e[0], e[1], e[2]],
                        "type": "cash",
                        "payer": q,
                        "fare": fare,
                        "mode": _get_mode_from_edge(e),
                    })
                    break
                
                # Check transfer payment
                for (s, a) in y[(q, p)].keys():
                    if pl.value(y[(q, p)][(s, a)][e]) > 0.5:
                        miles = get_miles(a, e)
                        surcharge = get_surcharge(a, e)
                        total_cash += surcharge
                        total_points += miles
                        solution["pay_mode"][p].append({
                            "edge": [e[0], e[1], e[2]],
                            "type": "points",
                            "payer": q,
                            "via": {"source": s, "airline": a},
                            "miles": miles,
                            "surcharge": surcharge,
                            "mode": "flight",
                        })
                        break
                
                # Check native payment
                for a in A:
                    if pl.value(y_native[(q, p)][a][e]) > 0.5:
                        miles = get_miles(a, e)
                        surcharge = get_surcharge(a, e)
                        total_cash += surcharge
                        total_points += miles
                        solution["pay_mode"][p].append({
                            "edge": [e[0], e[1], e[2]],
                            "type": "points",
                            "payer": q,
                            "via": {"native": a},
                            "miles": miles,
                            "surcharge": surcharge,
                            "mode": "flight",
                        })
                        break
    
    solution["totals"]["cash"] = total_cash
    solution["totals"]["airline_points"] = total_points
    solution["totals"]["time"] = total_time_val
    
    return solution


def _get_mode_from_edge(edge: Tuple[str, str, str]) -> str:
    """Extract transport mode from edge identifier."""
    mode_id = edge[2].upper()
    if "TRAIN" in mode_id:
        return "train"
    if "BUS" in mode_id:
        return "bus"
    if "CAR" in mode_id:
        return "car"
    if "FERRY" in mode_id:
        return "ferry"
    return "flight"
```

---

## Edge Types and Cost Structure

### Flight Edge (Points Available)

```python
{
    "cash_cost": 850.0,        # Pay $850 cash
    "time_cost": 660.0,        # 11 hours flight
    "points_cost": 70000,      # OR use 70,000 miles
    "points_program": "UA",    # Via United
    "points_surcharge": 50.0,  # Pay $50 surcharge if using points
    "mode": "flight",
}
```

**Decision:**
- Cash: Out-of-pocket = $850
- Points: Out-of-pocket = $50 (surcharge only)
- **Points wins** (saves $800)

### Train Edge (Cash Only)

```python
{
    "cash_cost": 130.0,        # Pay $130 cash
    "time_cost": 150.0,        # 2.5 hours
    "points_cost": None,       # No points option
    "points_program": None,
    "points_surcharge": None,
    "mode": "train",
}
```

**Decision:**
- Cash: Out-of-pocket = $130
- Points: Not available
- **Cash (train)** is the only option

### Comparing Flight vs Train

| Route | Flight Cash | Flight Points + Surcharge | Train Cash |
|-------|-------------|---------------------------|------------|
| Tokyo → Kyoto | $180 | 7,500 miles + $20 | $130 |

**Analysis:**
- Flight cash: $180 out-of-pocket
- Flight points: $20 out-of-pocket (if you have miles)
- Train: $130 out-of-pocket

**Winner:** 
- If you have 7,500 miles: **Flight with points** ($20 < $130 < $180)
- If you don't have miles: **Train** ($130 < $180)

---

## Worked Examples

### Example 1: Seattle → Tokyo → Kyoto → Seattle

**User has:**
- 200,000 Chase Ultimate Rewards
- $2,000 budget

**Available edges:**

| Route | Option | Cash Cost | Points | Surcharge | Time |
|-------|--------|-----------|--------|-----------|------|
| SEA→NRT | UA Flight | $850 | 70,000 UA | $50 | 11h |
| SEA→NRT | NH Flight | $920 | 65,000 NH | $120 | 12h |
| NRT→KIX | JL Flight | $180 | 7,500 JL | $20 | 1.25h |
| NRT→KIX | Shinkansen | $130 | N/A | N/A | 2.5h |
| KIX→SEA | UA Flight | $750 | 65,000 UA | $50 | 10h |

**Optimizer analysis:**

| Segment | Best Option | Out-of-Pocket | Points Used |
|---------|-------------|---------------|-------------|
| SEA→NRT | UA Flight (points) | $50 | 70,000 |
| NRT→KIX | JL Flight (points) | $20 | 7,500 |
| KIX→SEA | UA Flight (points) | $50 | 65,000 |

Wait - can Chase transfer to JL (Japan Airlines)? Let's check the transfer graph...

Chase can transfer to: UA, BA, AF, SQ, IB, VS, AC, etc.
Chase **cannot** transfer to: JL (Japan Airlines)

**Revised analysis:**

| Segment | Best Option | Out-of-Pocket | Points Used |
|---------|-------------|---------------|-------------|
| SEA→NRT | UA Flight (Chase→UA) | $50 | 70,000 |
| NRT→KIX | Shinkansen (cash) | $130 | 0 |
| KIX→SEA | UA Flight (Chase→UA) | $50 | 65,000 |

**Total:**
- Out-of-pocket: $230
- Points used: 135,000 Chase (transferred to United)
- Points remaining: 65,000 Chase

**Comparison to all-cash:**
- All cash: $850 + $180 + $750 = $1,780
- Optimized: $230
- **Savings: $1,550 (87%)**

### Example 2: Paris → Amsterdam (Short Distance)

**User has:**
- 50,000 Chase points
- $500 budget

**Available edges:**

| Route | Option | Cash Cost | Points | Surcharge | Time |
|-------|--------|-----------|--------|-----------|------|
| CDG→AMS | AF Flight | $150 | 10,000 AF | $80 | 1.25h |
| CDG→AMS | Thalys Train | $80 | N/A | N/A | 3.3h |
| CDG→AMS | FlixBus | $25 | N/A | N/A | 7h |

**Analysis:**

| Option | Out-of-Pocket | Time |
|--------|---------------|------|
| Flight (points) | $80 | 1.25h |
| Train | $80 | 3.3h |
| Bus | $25 | 7h |

**Decision:**
- Bus is cheapest ($25), but takes 7 hours
- Flight and train tie at $80
- Since W1 >> W2, we minimize cash first: **Bus wins** at $25

But wait - is saving $55 worth 5.75 extra hours?

**The algorithm as specified will choose bus** because minimizing cash is primary.

If the user doesn't want long travel times, they should set a maximum travel time constraint (not currently implemented, but could be added).

---

## API Integration Details

### AwardTool API

```python
async def fetch_awardtool_flights(
    origin: str,
    destination: str,
    date: str,
    programs: List[str],
) -> List[Dict]:
    """
    Fetch award flight availability from AwardTool.
    
    Request:
    POST https://www.awardtool-api.com/flights
    {
        "origin": "SEA",
        "destination": "NRT",
        "date": "2025-03-10",
        "programs": ["UA", "NH", "JL"],
        "cabin": "economy",
    }
    
    Response:
    {
        "flights": [
            {
                "flight_number": "UA123",
                "origin": "SEA",
                "destination": "NRT",
                "program": "UA",
                "miles": 70000,
                "surcharge": 50,
                "cash_price": 850,
                "duration": 660,
                "departure": "2025-03-10T10:00",
                "arrival": "2025-03-11T14:00",
            },
            ...
        ]
    }
    """
    api_key = os.getenv("AWARDTOOL_API_KEY")
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://www.awardtool-api.com/flights",
            json={
                "origin": origin,
                "destination": destination,
                "date": date,
                "programs": programs,
                "cabin": "economy",
                "api_key": api_key,
            },
            timeout=30.0,
        )
        response.raise_for_status()
        return response.json().get("flights", [])
```

### SerpAPI (Google Flights)

```python
def fetch_serpapi_flights(
    origin: str,
    destination: str,
    date: str,
) -> List[Dict]:
    """
    Fetch cash flight prices from Google Flights via SerpAPI.
    
    Request:
    GET https://serpapi.com/search?engine=google_flights&...
    
    Response includes cash prices for comparison.
    """
    api_key = os.getenv("SERPAPI_API_KEY")
    
    params = {
        "engine": "google_flights",
        "departure_id": origin,
        "arrival_id": destination,
        "outbound_date": date,
        "currency": "USD",
        "api_key": api_key,
    }
    
    response = requests.get("https://serpapi.com/search", params=params)
    response.raise_for_status()
    
    data = response.json()
    return data.get("best_flights", []) + data.get("other_flights", [])
```

---

## Summary

### Key Differences in v3

1. **New Objective Function**: Minimize out-of-pocket cash (not maximize points value)
2. **Clear Priority**: Cash savings > Time savings (W1=10⁶, W2=1)
3. **Decision Logic**: Use points whenever surcharge < cash alternative
4. **Complete Data Flow**: Step-by-step from user input to optimized result
5. **Function Details**: Full implementation of each function

### The Core Formula

```
Out-of-Pocket = Σ(Cash Bookings) + Σ(Points Surcharges)

For each edge, choose the option with minimum Out-of-Pocket:
- If points_surcharge < cash_cost AND have_enough_points → Use points
- Else → Pay cash (flight, train, bus, or car)
```

### Implementation Checklist

| Task | Status |
|------|--------|
| New objective function (`plan_minimize_out_of_pocket`) | 📋 To implement |
| Multi-modal edge fetching | ✅ In v2 |
| Transfer graph integration | ✅ Complete |
| Budget constraints | ✅ Complete |
| Path constraints | ✅ Complete |
| Solution extraction | ✅ Complete |

---

## Multi-Modal Transport Integration

### Train Service Implementation

```python
# backend/src/services/train_service.py

"""
Train transport service for European and Japanese high-speed rail.

Integrates with:
- Trainline API (Europe)
- JR Pass calculator (Japan)
- Amtrak API (USA - limited)
"""

import httpx
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import asyncio


@dataclass
class TrainEdge:
    """Represents a train route option."""
    origin: str           # Station/city code
    destination: str      # Station/city code
    operator: str         # e.g., "Eurostar", "TGV", "Shinkansen"
    cash_cost: float      # Price in USD
    duration_minutes: int
    departure_time: str
    arrival_time: str
    train_number: str


# ═══════════════════════════════════════════════════════════════════════════
# HIGH-SPEED RAIL CORRIDORS (Pre-defined routes with estimates)
# ═══════════════════════════════════════════════════════════════════════════

EUROPEAN_CORRIDORS = {
    # Eurostar (UK ↔ Europe)
    ("LON", "PAR"): {"operator": "Eurostar", "duration": 140, "min_price": 70, "max_price": 300},
    ("LON", "BRU"): {"operator": "Eurostar", "duration": 120, "min_price": 50, "max_price": 200},
    ("LON", "AMS"): {"operator": "Eurostar", "duration": 240, "min_price": 60, "max_price": 250},
    
    # TGV (France)
    ("PAR", "LYO"): {"operator": "TGV", "duration": 120, "min_price": 30, "max_price": 120},
    ("PAR", "MRS"): {"operator": "TGV", "duration": 190, "min_price": 40, "max_price": 150},
    ("PAR", "BCN"): {"operator": "TGV", "duration": 390, "min_price": 60, "max_price": 200},
    
    # ICE (Germany)
    ("FRA", "MUC"): {"operator": "ICE", "duration": 190, "min_price": 30, "max_price": 140},
    ("FRA", "BER"): {"operator": "ICE", "duration": 240, "min_price": 40, "max_price": 150},
    ("FRA", "AMS"): {"operator": "ICE", "duration": 240, "min_price": 40, "max_price": 160},
    
    # Thalys (Benelux ↔ France)
    ("PAR", "BRU"): {"operator": "Thalys", "duration": 85, "min_price": 30, "max_price": 120},
    ("PAR", "AMS"): {"operator": "Thalys", "duration": 200, "min_price": 40, "max_price": 150},
    ("BRU", "AMS"): {"operator": "Thalys", "duration": 110, "min_price": 25, "max_price": 100},
    
    # AVE (Spain)
    ("MAD", "BCN"): {"operator": "AVE", "duration": 160, "min_price": 35, "max_price": 140},
    ("MAD", "SEV"): {"operator": "AVE", "duration": 150, "min_price": 30, "max_price": 110},
    
    # Frecciarossa (Italy)
    ("ROM", "MIL"): {"operator": "Frecciarossa", "duration": 175, "min_price": 40, "max_price": 130},
    ("ROM", "FLR"): {"operator": "Frecciarossa", "duration": 90, "min_price": 25, "max_price": 90},
    ("MIL", "VCE"): {"operator": "Frecciarossa", "duration": 145, "min_price": 30, "max_price": 100},
}

JAPANESE_CORRIDORS = {
    # Shinkansen (Bullet trains)
    ("TYO", "OSA"): {"operator": "Shinkansen Nozomi", "duration": 140, "min_price": 120, "max_price": 180},
    ("TYO", "KYO"): {"operator": "Shinkansen Nozomi", "duration": 135, "min_price": 110, "max_price": 170},
    ("TYO", "NGO"): {"operator": "Shinkansen Nozomi", "duration": 100, "min_price": 90, "max_price": 140},
    ("OSA", "KYO"): {"operator": "Shinkansen", "duration": 15, "min_price": 15, "max_price": 30},
    ("OSA", "HRS"): {"operator": "Shinkansen", "duration": 80, "min_price": 70, "max_price": 110},
    
    # Tokyo airports to city
    ("NRT", "TYO"): {"operator": "Narita Express", "duration": 60, "min_price": 25, "max_price": 35},
    ("HND", "TYO"): {"operator": "Tokyo Monorail", "duration": 20, "min_price": 5, "max_price": 10},
    
    # Osaka airports to city
    ("KIX", "OSA"): {"operator": "Haruka Express", "duration": 50, "min_price": 20, "max_price": 30},
}

# City code to airport code mapping (for inter-modal connections)
CITY_TO_AIRPORT = {
    "TYO": ["NRT", "HND"],  # Tokyo
    "OSA": ["KIX", "ITM"],  # Osaka
    "KYO": ["KIX", "ITM"],  # Kyoto (uses Osaka airports)
    "LON": ["LHR", "LGW", "STN", "LTN"],  # London
    "PAR": ["CDG", "ORY"],  # Paris
}


async def get_train_options_async(
    origin: str,
    destination: str,
    date: str,
) -> List[TrainEdge]:
    """
    Fetch train options between two cities.
    
    Strategy:
    1. Check if direct high-speed corridor exists
    2. Query Trainline API for real-time prices (if available)
    3. Fall back to estimated prices from corridor data
    
    Returns list of TrainEdge options.
    """
    # Normalize codes
    origin = origin.upper()[:3]
    destination = destination.upper()[:3]
    
    # Handle airport-to-city and city-to-airport
    origin_cities = _get_city_codes(origin)
    dest_cities = _get_city_codes(destination)
    
    results = []
    
    for o in origin_cities:
        for d in dest_cities:
            # Check European corridors
            corridor_key = (o, d)
            reverse_key = (d, o)
            
            corridor = EUROPEAN_CORRIDORS.get(corridor_key) or EUROPEAN_CORRIDORS.get(reverse_key)
            if not corridor:
                corridor = JAPANESE_CORRIDORS.get(corridor_key) or JAPANESE_CORRIDORS.get(reverse_key)
            
            if corridor:
                # Use estimated price (midpoint)
                estimated_price = (corridor["min_price"] + corridor["max_price"]) / 2
                
                results.append(TrainEdge(
                    origin=origin,
                    destination=destination,
                    operator=corridor["operator"],
                    cash_cost=estimated_price,
                    duration_minutes=corridor["duration"],
                    departure_time="",
                    arrival_time="",
                    train_number=f"TRAIN_{corridor['operator'].upper()[:4]}",
                ))
    
    # Try Trainline API for more accurate prices
    try:
        trainline_results = await _query_trainline_api(origin, destination, date)
        if trainline_results:
            results.extend(trainline_results)
    except Exception as e:
        # Fall back to estimates if API fails
        pass
    
    return results


def _get_city_codes(code: str) -> List[str]:
    """Get city codes from airport code or city code."""
    # Check if it's an airport that maps to a city
    for city, airports in CITY_TO_AIRPORT.items():
        if code in airports:
            return [city]
    return [code]


async def _query_trainline_api(
    origin: str,
    destination: str,
    date: str,
) -> List[TrainEdge]:
    """
    Query Trainline API for real train prices.
    
    Returns empty list if API is not configured or fails.
    """
    api_key = os.getenv("TRAINLINE_API_KEY")
    if not api_key:
        return []
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                "https://api.trainline.eu/v1/search",
                params={
                    "origin": origin,
                    "destination": destination,
                    "departure_date": date,
                },
                headers={"X-API-Key": api_key},
                timeout=10.0,
            )
            
            if response.status_code != 200:
                return []
            
            data = response.json()
            results = []
            
            for journey in data.get("journeys", []):
                results.append(TrainEdge(
                    origin=origin,
                    destination=destination,
                    operator=journey.get("operator", "Train"),
                    cash_cost=journey.get("price_usd", 0),
                    duration_minutes=journey.get("duration_minutes", 0),
                    departure_time=journey.get("departure", ""),
                    arrival_time=journey.get("arrival", ""),
                    train_number=journey.get("train_number", ""),
                ))
            
            return results
            
        except Exception:
            return []


def train_options_to_edges(
    origin: str,
    destination: str,
    trains: List[TrainEdge],
) -> Dict[Tuple[str, str, str], Dict]:
    """
    Convert TrainEdge list to ILP edge format.
    
    Train edges have:
    - cash_cost: ticket price
    - time_cost: duration in minutes
    - points_cost: None (no points option)
    - mode: "train"
    """
    edges = {}
    
    for i, train in enumerate(trains):
        edge_id = f"TRAIN_{train.operator.upper()[:4]}_{i}"
        edge_key = (origin, destination, edge_id)
        
        edges[edge_key] = {
            "cash_cost": train.cash_cost,
            "time_cost": train.duration_minutes,
            "points_cost": None,           # Trains don't accept points
            "points_program": None,
            "points_surcharge": None,
            "mode": "train",
            "operator": train.operator,
            "departure": train.departure_time,
            "arrival": train.arrival_time,
        }
    
    return edges
```

### Bus Service Implementation

```python
# backend/src/services/bus_service.py

"""
Bus transport service (FlixBus, Greyhound, etc.)
"""

BUS_ROUTES = {
    # European FlixBus routes (examples)
    ("PAR", "AMS"): {"operator": "FlixBus", "duration": 420, "price_range": (20, 50)},
    ("PAR", "BRU"): {"operator": "FlixBus", "duration": 240, "price_range": (15, 35)},
    ("BER", "PRA"): {"operator": "FlixBus", "duration": 270, "price_range": (15, 40)},
    ("MUN", "VIE"): {"operator": "FlixBus", "duration": 240, "price_range": (20, 45)},
    
    # US Greyhound routes (examples)
    ("NYC", "BOS"): {"operator": "Greyhound", "duration": 270, "price_range": (20, 60)},
    ("NYC", "WAS"): {"operator": "Greyhound", "duration": 270, "price_range": (25, 70)},
    ("LAX", "SFO"): {"operator": "Greyhound", "duration": 420, "price_range": (30, 80)},
}


def get_bus_options(origin: str, destination: str, date: str) -> List[Dict]:
    """
    Get bus options for a route.
    
    Returns list of bus options with estimated prices.
    """
    key = (origin.upper()[:3], destination.upper()[:3])
    reverse_key = (key[1], key[0])
    
    route = BUS_ROUTES.get(key) or BUS_ROUTES.get(reverse_key)
    if not route:
        return []
    
    # Use midpoint of price range as estimate
    price = (route["price_range"][0] + route["price_range"][1]) / 2
    
    return [{
        "origin": origin,
        "destination": destination,
        "operator": route["operator"],
        "cash_cost": price,
        "duration_minutes": route["duration"],
        "mode": "bus",
    }]


def bus_options_to_edges(origin: str, destination: str, buses: List[Dict]) -> Dict:
    """Convert bus options to ILP edge format."""
    edges = {}
    
    for i, bus in enumerate(buses):
        edge_id = f"BUS_{bus['operator'].upper()[:4]}_{i}"
        edge_key = (origin, destination, edge_id)
        
        edges[edge_key] = {
            "cash_cost": bus["cash_cost"],
            "time_cost": bus["duration_minutes"],
            "points_cost": None,
            "points_program": None,
            "points_surcharge": None,
            "mode": "bus",
            "operator": bus["operator"],
        }
    
    return edges
```

---

## Decision Flowchart

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EDGE PAYMENT DECISION FLOWCHART                          │
└─────────────────────────────────────────────────────────────────────────────┘

For each edge (transport segment) from city A to city B:

                          ┌──────────────────┐
                          │  Collect all     │
                          │  transport       │
                          │  options         │
                          └────────┬─────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
     ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
     │   FLIGHTS      │   │    TRAINS      │   │     BUSES      │
     │                │   │                │   │                │
     │ • Cash price   │   │ • Cash price   │   │ • Cash price   │
     │ • Points +     │   │ • No points    │   │ • No points    │
     │   surcharge    │   │   option       │   │   option       │
     └───────┬────────┘   └───────┬────────┘   └───────┬────────┘
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │  For each option,        │
                    │  calculate OUT-OF-POCKET │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
     ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
     │  Flight Cash   │  │ Flight Points  │  │ Train/Bus Cash │
     │                │  │                │  │                │
     │ OOP = $cash    │  │ OOP = $surge   │  │ OOP = $cash    │
     │ (full price)   │  │ (just fees)    │  │ (full price)   │
     └───────┬────────┘  └───────┬────────┘  └───────┬────────┘
             │                   │                   │
             └───────────────────┼───────────────────┘
                                 │
                                 ▼
                   ┌───────────────────────────┐
                   │   COMPARE OUT-OF-POCKET   │
                   │   (subject to having      │
                   │    enough points/budget)  │
                   └─────────────┬─────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
              ▼                                     ▼
    ┌──────────────────────┐              ┌──────────────────────┐
    │ Points available AND │              │ No points OR         │
    │ surcharge < cash     │              │ surcharge ≥ cash     │
    │ alternatives         │              │ alternatives         │
    └──────────┬───────────┘              └──────────┬───────────┘
               │                                     │
               ▼                                     ▼
    ┌──────────────────────┐              ┌──────────────────────┐
    │   ✅ USE POINTS      │              │   ✅ USE CASH        │
    │                      │              │   (cheapest option)  │
    │   Pay: $surcharge    │              │                      │
    │   Use: X miles       │              │   Pay: $cash_cost    │
    └──────────────────────┘              └──────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
CONCRETE EXAMPLE: Seattle → Paris
═══════════════════════════════════════════════════════════════════════════════

User has: 100,000 Chase points, $500 budget

Options:
┌─────────────────────────────────────────────────────────────────────────────┐
│ Option          │ Out-of-Pocket │ Points Used │ Time    │ Available?       │
├─────────────────┼───────────────┼─────────────┼─────────┼──────────────────┤
│ UA Flight Cash  │ $950          │ 0           │ 10h     │ ✅ Yes           │
│ UA Flight Pts   │ $50 surcharge │ 60,000      │ 10h     │ ✅ Yes (have pts)│
│ AF Flight Cash  │ $1,100        │ 0           │ 11h     │ ✅ Yes           │
│ AF Flight Pts   │ $250 surcharge│ 55,000      │ 11h     │ ✅ Yes (have pts)│
│ Train           │ N/A           │ N/A         │ N/A     │ ❌ No route      │
│ Bus             │ N/A           │ N/A         │ N/A     │ ❌ No route      │
└─────────────────────────────────────────────────────────────────────────────┘

Decision:
1. Sort by out-of-pocket: $50 < $250 < $950 < $1,100
2. Check constraints:
   - $50 ≤ $500 budget ✅
   - 60,000 ≤ 100,000 points ✅
3. Winner: UA Flight with Points ($50 out-of-pocket)


═══════════════════════════════════════════════════════════════════════════════
EDGE CASE: High Surcharge Makes Points Not Worth It
═══════════════════════════════════════════════════════════════════════════════

User has: 100,000 Chase points, $500 budget

Options for London → Dublin:
┌─────────────────────────────────────────────────────────────────────────────┐
│ Option          │ Out-of-Pocket │ Points Used │ Time    │ Decision         │
├─────────────────┼───────────────┼─────────────┼─────────┼──────────────────┤
│ BA Flight Cash  │ $80           │ 0           │ 1.5h    │                  │
│ BA Flight Pts   │ $150 surcharge│ 9,000       │ 1.5h    │ ❌ $150 > $80    │
│ Ryanair Cash    │ $25           │ 0           │ 1.5h    │ ✅ WINNER        │
│ Ferry           │ $45           │ 0           │ 3.5h    │                  │
└─────────────────────────────────────────────────────────────────────────────┘

Decision:
- BA points surcharge ($150) > Ryanair cash ($25)
- Algorithm chooses: Ryanair Cash at $25
- Points saved for better redemption later!
```

---

## Edge Cases and Fallback Strategies

### Case 1: Not Enough Points

```python
def handle_insufficient_points(
    edge: Tuple,
    required_miles: int,
    available_miles: int,
    cash_cost: float,
) -> Dict:
    """
    When user doesn't have enough points for an edge.
    
    Strategy:
    1. Check if partial points + cash is possible (usually not)
    2. Fall back to full cash payment
    3. Suggest alternative routes that might work with available points
    """
    if available_miles >= required_miles:
        return {"use_points": True, "miles": required_miles}
    
    # Most airlines don't allow partial points, so fall back to cash
    return {
        "use_points": False,
        "pay_cash": True,
        "cash_amount": cash_cost,
        "reason": f"Need {required_miles} miles but only have {available_miles}",
    }
```

### Case 2: No Award Availability

```python
def handle_no_award_seats(
    edge: Tuple,
    airlines: List[str],
    cash_cost: float,
) -> Dict:
    """
    When award space is sold out.
    
    This happens when:
    - All award seats are taken
    - The route doesn't have award pricing
    - The date is blacked out
    
    Strategy:
    1. Try alternative airlines
    2. Try nearby dates (if flexible)
    3. Fall back to cash
    """
    # In ILP, this is handled by setting allowed_award_edge[a][e] = 0
    # for airlines without availability
    
    return {
        "use_points": False,
        "pay_cash": True,
        "cash_amount": cash_cost,
        "reason": "No award availability on this route/date",
    }
```

### Case 3: Budget Exceeded

```python
def handle_budget_exceeded(
    total_cost: float,
    budget: float,
    current_solution: Dict,
) -> Dict:
    """
    When the optimal solution exceeds budget.
    
    Strategy (in order of preference):
    1. Use more points (if available)
    2. Try cheaper transport modes (bus instead of train)
    3. Suggest reducing destinations
    4. Return partial solution with warning
    """
    if total_cost <= budget:
        return {"feasible": True, "solution": current_solution}
    
    # ILP will return "Infeasible" if no solution exists within budget
    # Frontend should:
    # 1. Show message: "Trip exceeds budget by $X"
    # 2. Suggest: "Remove Y destination to save $Z"
    # 3. Offer: "Increase budget to $W for optimal trip"
    
    return {
        "feasible": False,
        "over_budget_by": total_cost - budget,
        "suggestions": [
            {"action": "increase_budget", "new_budget": total_cost},
            {"action": "remove_destination", "savings_estimate": "varies"},
            {"action": "use_cheaper_transport", "savings_estimate": "varies"},
        ],
    }
```

### Case 4: Multi-City TSP Ordering

```python
def optimize_city_order(
    start: str,
    end: str,
    must_visit: List[str],
    edges_dict: Dict,
) -> List[str]:
    """
    When user specifies cities to visit but not the order.
    
    The ILP naturally handles this via the path constraints:
    - Must visit each city exactly once
    - Optimizer chooses order that minimizes total out-of-pocket
    
    Example:
    Visit: [Paris, Rome, Barcelona]
    
    Possible orderings:
    1. SEA → Paris → Rome → Barcelona → SEA
    2. SEA → Paris → Barcelona → Rome → SEA
    3. SEA → Rome → Paris → Barcelona → SEA
    ... etc.
    
    ILP evaluates all orderings implicitly and picks cheapest.
    """
    # This is handled automatically by the ILP model
    # The must_visit_cities constraint ensures each is visited once
    # The optimizer determines the order
    
    # For debugging, we can enumerate orderings:
    from itertools import permutations
    
    best_order = None
    best_cost = float('inf')
    
    for order in permutations(must_visit):
        path = [start] + list(order) + [end]
        cost = calculate_path_cost(path, edges_dict)
        if cost < best_cost:
            best_cost = cost
            best_order = path
    
    return best_order
```

---

## Testing Strategy

### Unit Tests

```python
# backend/tests/test_minimize_out_of_pocket.py

import pytest
from src.handlers.points_maximizer import plan_minimize_out_of_pocket


class TestMinimizeOutOfPocket:
    """Test the new objective function."""
    
    def test_prefers_points_when_surcharge_lower_than_cash(self):
        """
        Given:
        - Flight cash: $500
        - Flight points: 25,000 miles + $50 surcharge
        
        Expected: Choose points (out-of-pocket $50 < $500)
        """
        # Setup
        edges = [("SEA", "SFO", "UA123")]
        cash_cost = {("SEA", "SFO", "UA123"): 500}
        award_points = {"UA": {("SEA", "SFO", "UA123"): 25000}}
        cash_surcharge = {"UA": {("SEA", "SFO", "UA123"): 50}}
        
        result = plan_minimize_out_of_pocket(
            travelers=["user1"],
            edges=edges,
            cash_cost=cash_cost,
            award_points=award_points,
            cash_surcharge=cash_surcharge,
            # ... other params
        )
        
        assert result["pay_mode"]["user1"][0]["type"] == "points"
        assert result["totals"]["cash"] == 50  # Only surcharge
    
    def test_prefers_cash_when_surcharge_higher_than_alternatives(self):
        """
        Given:
        - Flight cash: $80
        - Flight points: 10,000 miles + $150 surcharge
        
        Expected: Choose cash (out-of-pocket $80 < $150)
        """
        edges = [("LON", "DUB", "BA123")]
        cash_cost = {("LON", "DUB", "BA123"): 80}
        award_points = {"BA": {("LON", "DUB", "BA123"): 10000}}
        cash_surcharge = {"BA": {("LON", "DUB", "BA123"): 150}}
        
        result = plan_minimize_out_of_pocket(
            travelers=["user1"],
            edges=edges,
            cash_cost=cash_cost,
            award_points=award_points,
            cash_surcharge=cash_surcharge,
            # ... other params
        )
        
        assert result["pay_mode"]["user1"][0]["type"] == "cash"
        assert result["totals"]["cash"] == 80
    
    def test_chooses_train_over_expensive_flight(self):
        """
        Given:
        - Flight cash: $200
        - Flight points: N/A
        - Train: $80
        
        Expected: Choose train ($80 < $200)
        """
        edges = [
            ("PAR", "LYO", "AF123"),   # Flight
            ("PAR", "LYO", "TRAIN_TGV"),  # Train
        ]
        cash_cost = {
            ("PAR", "LYO", "AF123"): 200,
            ("PAR", "LYO", "TRAIN_TGV"): 80,
        }
        # No points available for either
        award_points = {"AF": {}}
        cash_surcharge = {"AF": {}}
        
        result = plan_minimize_out_of_pocket(
            travelers=["user1"],
            edges=edges,
            cash_cost=cash_cost,
            award_points=award_points,
            cash_surcharge=cash_surcharge,
            # ... other params
        )
        
        chosen_edge = result["pay_mode"]["user1"][0]["edge"]
        assert "TRAIN" in chosen_edge[2]
        assert result["totals"]["cash"] == 80
    
    def test_chooses_flight_points_over_train_when_cheaper(self):
        """
        Given:
        - Flight cash: $300
        - Flight points: 20,000 miles + $30 surcharge
        - Train: $120
        
        Expected: Choose flight with points ($30 < $120)
        """
        edges = [
            ("PAR", "BCN", "AF456"),
            ("PAR", "BCN", "TRAIN_TGV"),
        ]
        cash_cost = {
            ("PAR", "BCN", "AF456"): 300,
            ("PAR", "BCN", "TRAIN_TGV"): 120,
        }
        award_points = {"AF": {("PAR", "BCN", "AF456"): 20000}}
        cash_surcharge = {"AF": {("PAR", "BCN", "AF456"): 30}}
        
        result = plan_minimize_out_of_pocket(
            travelers=["user1"],
            edges=edges,
            cash_cost=cash_cost,
            award_points=award_points,
            cash_surcharge=cash_surcharge,
            source_balances={("user1", "chase"): 100000},
            # ... other params
        )
        
        assert result["pay_mode"]["user1"][0]["type"] == "points"
        assert result["totals"]["cash"] == 30  # Just the surcharge
```

### Integration Tests

```python
# backend/tests/test_itinerary_integration.py

@pytest.mark.asyncio
async def test_full_itinerary_flow():
    """
    End-to-end test: Seattle → Tokyo → Kyoto → Seattle
    """
    # Create trip with destinations
    trip_id = await create_test_trip(
        start="Seattle",
        destinations=["Tokyo", "Kyoto"],
        end="Seattle",
    )
    
    # Add user points
    await add_points(
        trip_id=trip_id,
        user_id="user1",
        points={"Chase Ultimate Rewards": 200000},
    )
    
    # Generate itinerary
    result = await generate_optimized_itinerary(trip_id)
    
    # Assertions
    assert result["status"] == "Optimal"
    assert result["out_of_pocket"] < 500  # Should be cheap with 200k points
    
    # Verify path
    path = result["solution"]["path"]["user1"]
    assert "SEA" in path
    assert any(code in path for code in ["NRT", "HND"])  # Tokyo airport
    assert any(code in path for code in ["KIX", "ITM"])  # Kyoto/Osaka airport
    
    # Verify most segments use points (minimize cash)
    payments = result["solution"]["pay_mode"]["user1"]
    points_payments = [p for p in payments if p["type"] == "points"]
    assert len(points_payments) >= 2  # At least 2 of 3 segments use points
```

---

## Deployment Configuration

### Environment Variables

```bash
# .env.production

# Flight APIs
AWARDTOOL_API_KEY=at_xxxxx
SERPAPI_API_KEY=sp_xxxxx

# Train APIs (optional - falls back to estimates)
TRAINLINE_API_KEY=tl_xxxxx

# OpenAI (for fallback airport lookup)
OPENAI_API_KEY=sk_xxxxx

# Optimization settings
ILP_SOLVER_TIMEOUT_SECONDS=30
MAX_EDGES_PER_PAIR=10
```

### AWS App Runner Configuration

```yaml
# apprunner.yaml
version: 1.0
runtime: python311
build:
  commands:
    build:
      - pip install -r requirements.txt
run:
  command: uvicorn src.app:app --host 0.0.0.0 --port 8000
  network:
    port: 8000
  env:
    - name: PYTHONPATH
      value: /app/backend
    - name: ILP_SOLVER
      value: CBC
```

---

## Summary

### The Algorithm in One Sentence

> For each transport segment, calculate out-of-pocket cost (cash price OR points surcharge), then use Integer Linear Programming to find the combination that minimizes total out-of-pocket while respecting budget and points constraints.

### Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| Minimize out-of-pocket (not maximize points value) | User's primary goal is saving cash |
| W1=10⁶ for cash, W2=1 for time | Cash savings always trump time savings |
| Include trains/buses as cash-only edges | Provides alternatives when points aren't worth it |
| Transfer graph with 1:1 ratios | Simplifies transfer calculations |
| ILP solver (CBC via PuLP) | Guarantees optimal solution |

### Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `handlers/points_maximizer.py` | Modify | Add `plan_minimize_out_of_pocket` |
| `services/train_service.py` | Create | Train route lookup and pricing |
| `services/bus_service.py` | Create | Bus route lookup and pricing |
| `services/itinerary_service.py` | Modify | Integrate train/bus edges |
| `handlers/ilp_adapter.py` | Modify | Handle multi-modal edges |

---

*Document Version: 3.0*
*Last Updated: January 2026*
