# ILP Algorithm V2: Balanced Routing with Proper Connection Handling

This document describes the improved ILP (Integer Linear Programming) algorithm that properly handles transit connections, chronological ordering, and provides a balanced ranking between cost, time, and connections.

## Table of Contents

1. [Problem with Previous Approach](#problem-with-previous-approach)
2. [Key Fixes](#key-fixes)
3. [The Improved Algorithm](#the-improved-algorithm)
4. [Worked Example: JFK → AUH → DXB → JFK](#worked-example-jfk--auh--dxb--jfk)
5. [Balanced Ranking System](#balanced-ranking-system)
6. [Chronological Ordering](#chronological-ordering)
7. [Edge Cases and Nuances](#edge-cases-and-nuances)

---

## Problem with Previous Approach

### Issue 1: Overly Restrictive Transit City Limits

The previous algorithm had this constraint:
```python
# OLD (INCORRECT)
for transit_city in cities:
    if transit_city not in {start, end, *must_visit}:
        ∑ x[p][e] for e arriving at transit_city ≤ 1
```

**Why this was wrong:**

Consider the trip **JFK → AUH → DXB → JFK** where both legs require a connection through Bahrain (BAH):

```
OUTBOUND: JFK → BAH → AUH
RETURN:   DXB → BAH → JFK
```

The old constraint said "BAH can only be visited once" which made this valid itinerary **infeasible**.

### Issue 2: Insufficient Penalty Balance

The previous weights were:
- `W_extra_city = 10^12` (too high)
- `W_num_edges = 10^9` (penalized ALL edges, not just extra ones)

This caused the optimizer to avoid ALL connections, even legitimate ones through major hubs.

### Issue 3: Limited Chronological Constraints

Chronological constraints were only applied at must-visit cities, but connections at transit cities also need time validation.

---

## Key Fixes

### Fix 1: Edge-Based Sequence Tracking (Instead of Transit Limits)

We use **edge-based sequence variables** instead of city-based MTZ constraints. This is critical because cities like BAH can be visited multiple times (once on outbound, once on return), and city-based position variables would cause infeasibility.

**New approach:**
```python
# Position variable for each EDGE: v[edge] = sequence position in path
v[p][e] ∈ [0, n_edges]

# If edge not selected, position is 0
v[p][e] ≤ n_edges × x[p][e]

# Edges from start city have position ≥ 1 (if selected)
For each edge e from start_city:
    v[p][e] ≥ x[p][e]

# For connected edges (e1 ends where e2 starts), e2 comes after e1
For each city c, for each (e1 arriving at c, e2 departing from c):
    v[p][e2] - v[p][e1] ≥ 1 - M×(2 - x[p][e1] - x[p][e2])
```

This ensures:
- ✅ Cities can be visited multiple times (for connections)
- ✅ No disconnected sub-tours (edges must form continuous sequence)
- ✅ Valid ordering through edge positions, not city positions

### Fix 2: Balanced Ranking System

Instead of extreme penalties, we use a balanced weighting:

| Factor | Weight | Purpose |
|--------|--------|---------|
| Points Savings | 10^6 | Reward using points |
| Cash Cost | 10^5 | Penalize cash spending |
| Surcharges | 10^3 | Penalize high surcharges |
| Travel Time | 10^2 | Prefer shorter flights |
| Extra Connections | 10^6 | Penalize connections beyond minimum |
| Non-Hub Transits | 10^7 | Penalize obscure routing |

### Fix 3: Hub City Recognition

We recognize major airline hubs as legitimate connection points:

```python
HUB_CITIES = {
    'IST',  # Istanbul - Turkish Airlines hub
    'DOH',  # Doha - Qatar Airways hub
    'DXB',  # Dubai - Emirates hub
    'AUH',  # Abu Dhabi - Etihad hub
    'BAH',  # Bahrain - Gulf Air hub
    'CDG',  # Paris - Air France hub
    'LHR',  # London - BA hub
    'FRA',  # Frankfurt - Lufthansa hub
    'AMS',  # Amsterdam - KLM hub
    'JFK', 'LAX', 'ORD',  # US hubs
    'SIN', 'HKG', 'ICN', 'NRT',  # Asian hubs
    ...
}
```

Routing through hub cities incurs **no penalty**. Only non-hub transits are penalized.

### Fix 4: Comprehensive Chronological Ordering

We now enforce chronological ordering at **ALL cities**, not just must-visit destinations:

```python
MIN_CONNECTION_TIME = 60 minutes

For ALL cities:
    For each (arriving_edge, departing_edge) pair:
        if departure_time < arrival_time + MIN_CONNECTION_TIME:
            x[arriving_edge] + x[departing_edge] ≤ 1
```

This ensures:
- ✅ Connections have at least 60 minutes
- ✅ No "time travel" at any city
- ✅ Valid layovers at transit points

---

## The Improved Algorithm

### Step 1: Build Flight Graph

```
Input: 
  - Origin/destinations (e.g., JFK, AUH, DXB)
  - Travel dates
  - User's points balances

Output:
  - Graph with edges = available flights
  - Each edge has: cash_cost, points_cost, program, surcharge, departure_time, arrival_time
```

### Step 2: Create Decision Variables

```python
# Edge selection (binary)
x[traveler][edge] ∈ {0, 1}

# Payment method (binary)
z[(payer, traveler)][edge] ∈ {0, 1}        # Cash
y[(payer, traveler)][(bank, airline)][edge] ∈ {0, 1}  # Points via transfer
y_native[(payer, traveler)][airline][edge] ∈ {0, 1}   # Native miles

# Transfer blocks (integer)
t_blocks[payer][(bank, airline)] ∈ {0, 1, 2, ...}

# Edge sequence position (continuous) - NOT city-based!
# This allows cities to be visited multiple times
v[traveler][edge] ∈ [0, n_edges]
```

### Step 3: Apply Constraints

#### 3a. Path Constraints
```python
# Exactly 1 edge leaves start city
∑{e: origin(e) = start} x[p][e] = 1

# Exactly 1 edge arrives at end city
∑{e: dest(e) = end} x[p][e] = 1

# Flow conservation at all cities
For each city c:
    ∑{e: origin(e) = c} x[p][e] = ∑{e: dest(e) = c} x[p][e]

# Must-visit cities visited at least once
For each must_visit city c:
    ∑{e: dest(e) = c} x[p][e] ≥ 1
```

#### 3b. Edge-Based Sequence Tracking
```python
# If edge not selected, sequence position is 0
For each edge e:
    v[p][e] ≤ n_edges × x[p][e]

# Edges from start city have position ≥ 1
For each edge e from start_city:
    v[p][e] ≥ x[p][e]

# Connected edges: e2 comes after e1
For each city c:
    For each (e1 arriving at c, e2 departing from c):
        v[p][e2] - v[p][e1] ≥ 1 - M×(2 - x[p][e1] - x[p][e2])
```

#### 3c. Chronological Ordering
```python
MIN_CONNECTION = 60 minutes

For each city c:
    For each pair (e1 arriving at c, e2 departing from c):
        if departure(e2) < arrival(e1) + MIN_CONNECTION:
            x[p][e1] + x[p][e2] ≤ 1
```

#### 3d. Payment Constraints
```python
# Exactly one payment method per selected edge
∑ z + ∑ y + ∑ y_native = x[p][e]

# Transfer constraints
∑ t_blocks × block_size ≤ balance
∑ miles_used ≤ t_blocks × block_size × ratio
```

### Step 4: Objective Function (Balanced Ranking)

```python
Maximize:
    + W_savings × points_savings
    - W_cash × total_cash
    - W_surcharge × surcharge_penalty
    - W_time × total_travel_time
    + W_benefit × card_benefits
    - W_extra_city × non_hub_transits
    - W_connection × extra_connections

Where:
    W_savings = 10^6
    W_cash = 10^5
    W_surcharge = 10^3
    W_time = 10^2
    W_connection = 10^6
    W_extra_city = 10^7
```

### Step 5: Solve and Extract Solution

```python
solver.solve()

# Extract path by following selected edges
# Build adjacency from selected edges, then traverse from start to end
selected_edges = [e for e in edges if x[p][e] > 0.5]
path = traverse from start_city following selected edges
```

---

## Worked Example: JFK → AUH → DXB → JFK

### Trip Details
- **Route:** New York → Abu Dhabi → Dubai → New York
- **Traveler:** John with 200,000 Chase points
- **Duration:** 7 days (3 in AUH, 4 in DXB)

### Available Flights (Simplified)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Route              │ Flight   │ Cash   │ Points  │ Program │ Time   │ Hub?  │
├────────────────────┼──────────┼────────┼─────────┼─────────┼────────┼───────┤
│ JFK → AUH direct   │ EY101    │ $1,500 │ 75,000  │ EY      │ 14h    │ -     │
│ JFK → BAH → AUH    │ GF511+22 │ $900   │ 55,000  │ AA      │ 18h    │ BAH   │
│ JFK → DOH → AUH    │ QR702+10 │ $1,100 │ 60,000  │ QR      │ 17h    │ DOH   │
├────────────────────┼──────────┼────────┼─────────┼─────────┼────────┼───────┤
│ AUH → DXB direct   │ EY401    │ $80    │ 5,000   │ EY      │ 1h     │ -     │
├────────────────────┼──────────┼────────┼─────────┼─────────┼────────┼───────┤
│ DXB → JFK direct   │ EK201    │ $1,400 │ 62,500  │ EK      │ 14h    │ -     │
│ DXB → BAH → JFK    │ GF23+512 │ $950   │ 50,000  │ AA      │ 19h    │ BAH   │
│ DXB → IST → JFK    │ TK761+1  │ $850   │ 45,000  │ TK      │ 18h    │ IST   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Optimization

#### 1. Variables Created

```python
# Edge selection
x["john"][("JFK", "AUH", "EY101")] = ?
x["john"][("JFK", "BAH", "GF511")] = ?
x["john"][("BAH", "AUH", "GF22")] = ?
# ... etc for all edges

# Path ordering
u["john"]["JFK"] = 0  # Fixed: start
u["john"]["BAH"] = ?  # Variable: position if visited
u["john"]["AUH"] = ?  # Variable: must be visited
u["john"]["DXB"] = ?  # Variable: must be visited
```

#### 2. Evaluate Options

**Option A: All Direct Flights (Cash)**
```
JFK → AUH (EY101): $1,500
AUH → DXB (EY401): $80
DXB → JFK (EK201): $1,400
────────────────────────────
Total: $2,980 cash
Segments: 3 (minimum)
Extra connections: 0
Travel time: 29h

Ranking Score:
  - Cash penalty: -10^5 × 2980 = -298,000,000
  - Time penalty: -10^2 × 29 × 60 = -174,000
  - Connection penalty: 0
  = -298,174,000
```

**Option B: Connection via BAH (Points)**
```
JFK → BAH (GF511): 27,500 AA miles + $50 (Chase→AA)
BAH → AUH (GF22): 27,500 AA miles + $50 (Chase→AA)
AUH → DXB (EY401): $80 cash
DXB → BAH (GF23): 25,000 AA miles + $40 (Chase→AA)
BAH → JFK (GF512): 25,000 AA miles + $40 (Chase→AA)
────────────────────────────
Total: $260 cash + 105,000 points
Cash saved: $2,720 - $260 = $2,460
Segments: 5 (minimum = 3, extra = 2)
Travel time: 38h
Hub transit: BAH (✓ recognized hub)

Ranking Score:
  + Savings: 10^6 × 2460 = 2,460,000,000
  - Cash: -10^5 × 260 = -26,000,000
  - Time: -10^2 × 38 × 60 = -228,000
  - Connections: -10^6 × 2 = -2,000,000
  - Non-hub: 0 (BAH is a hub)
  = 2,431,772,000
```

**Option C: Mixed (Direct outbound, connection return)**
```
JFK → AUH (EY101): $1,500 cash
AUH → DXB (EY401): $80 cash
DXB → IST (TK761): 22,500 TK miles + $40 (Chase→TK)
IST → JFK (TK1): 22,500 TK miles + $40 (Chase→TK)
────────────────────────────
Total: $1,660 cash + 45,000 points
Cash saved: $1,400 - $80 = $1,320
Segments: 4 (extra = 1)
Travel time: 33h
Hub transit: IST (✓ recognized hub)

Ranking Score:
  + Savings: 10^6 × 1320 = 1,320,000,000
  - Cash: -10^5 × 1660 = -166,000,000
  - Time: -10^2 × 33 × 60 = -198,000
  - Connections: -10^6 × 1 = -1,000,000
  = 1,152,802,000
```

#### 3. Winner: Option B

The optimizer selects **Option B** with the highest score (2.43 billion).

Even though it has more connections:
- The massive points savings ($2,460) outweighs the connection penalty
- BAH is a recognized hub, so no extra-city penalty
- Travel time is longer but the cost savings dominate

### Final Itinerary

```
┌──────────────────────────────────────────────────────────────────────────┐
│ DAY 1: OUTBOUND                                                          │
│                                                                          │
│ JFK 22:00 → BAH 18:30+1 (Gulf Air GF511, 12h30m)                        │
│ BAH 21:00 → AUH 22:00 (Gulf Air GF22, 1h)                               │
│                                                                          │
│ Payment: 55,000 AA miles + $100 (transferred from Chase)                │
├──────────────────────────────────────────────────────────────────────────┤
│ DAYS 2-4: ABU DHABI                                                      │
├──────────────────────────────────────────────────────────────────────────┤
│ DAY 4: ABU DHABI → DUBAI                                                 │
│                                                                          │
│ AUH 10:00 → DXB 11:00 (Etihad EY401, 1h)                                │
│                                                                          │
│ Payment: $80 cash                                                        │
├──────────────────────────────────────────────────────────────────────────┤
│ DAYS 4-7: DUBAI                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ DAY 7: RETURN                                                            │
│                                                                          │
│ DXB 14:00 → BAH 14:30 (Gulf Air GF23, 30m)                              │
│ BAH 19:00 → JFK 01:00+1 (Gulf Air GF512, 14h)                           │
│                                                                          │
│ Payment: 50,000 AA miles + $80 (transferred from Chase)                 │
├──────────────────────────────────────────────────────────────────────────┤
│ TRANSFER STRATEGY:                                                       │
│                                                                          │
│ Transfer 105,000 Chase Ultimate Rewards → American AAdvantage           │
│ (Use Chase Sapphire Preferred portal, instant transfer)                 │
├──────────────────────────────────────────────────────────────────────────┤
│ TOTALS:                                                                  │
│                                                                          │
│ Cash paid: $260                                                          │
│ Points used: 105,000 Chase (transferred to AA)                          │
│ Cash equivalent saved: $2,720                                            │
│ Total travel time: 38 hours (across 5 segments)                         │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Balanced Ranking System

### The Ranking Formula

```
Score = Cost_Component + Time_Component + Connection_Component

Where:
  Cost_Component = W_savings × cash_saved - W_cash × cash_paid - W_surcharge × surcharge_penalty
  Time_Component = -W_time × total_minutes
  Connection_Component = -W_connection × extra_segments - W_extra_city × non_hub_transits
```

### Weight Calibration

The weights are calibrated so that:

| Scenario | Preferred Outcome |
|----------|-------------------|
| Save $1,000 vs. 1 extra connection | Take the connection (10^6 × 1000 > 10^6 × 1) |
| Save $500 vs. 3 extra hours travel | Take faster option if connections equal |
| Hub connection vs. obscure city | Always prefer hub |
| $100 more cash vs. non-hub transit | Pay more cash |

### Customizable Balance

Users can adjust the balance by modifying weights:

```python
# Prefer fewer connections (even at higher cost)
W_connection = 10^8  # Increased

# Prefer faster travel (time-sensitive)
W_time = 10^4  # Increased

# Maximize savings (budget-conscious)
W_savings = 10^8  # Increased
```

---

## Chronological Ordering

### Minimum Connection Time

We enforce a **60-minute minimum connection** at all airports:

```python
MIN_CONNECTION_TIME = 60  # minutes

# If arrival + 60min > departure, can't connect
if departure_time(e2) < arrival_time(e1) + 60:
    x[e1] + x[e2] ≤ 1  # Can't select both
```

### Why This Matters

**Without chronological constraints:**
```
Optimizer might select:
  JFK → BAH arriving 18:30
  BAH → AUH departing 18:00  ← IMPOSSIBLE! Departs before arrival
```

**With chronological constraints:**
```
These edges can't both be selected.
Optimizer must choose:
  JFK → BAH arriving 18:30
  BAH → AUH departing 21:00  ← Valid: 2.5 hour connection
```

### Layover at Destinations

For must-visit cities (destinations, not connections), the stay duration is determined by trip dates, not minimum connection time.

---

## Edge Cases and Nuances

### 1. Same City Visited Twice (Valid)

**Scenario:** JFK → IST → DXB → IST → JFK

This is valid if:
- The flight times work chronologically
- IST is a hub city (no penalty)
- User gets significant savings

**Edge-based sequence handles this:** Each edge has its own position variable `v[edge]`. The edge JFK→IST might have position 1, while DXB→IST has position 3. No conflict because we track edges, not cities.

### 2. No Direct Flights Available

**Scenario:** JFK → AUH with no direct flights

The optimizer will:
1. Find all connection options (via DOH, BAH, etc.)
2. Evaluate each based on cost/time/connections
3. Select the best balance

### 3. Very Long Layover

**Scenario:** Only available connection has 12-hour layover

The time penalty (`W_time × 720 minutes`) will be significant, but if it's the only option or saves substantial money, it may still be selected.

### 4. Multiple Must-Visit Cities in Custom Order

**Scenario:** JFK → DXB → AUH → JFK (user wants DXB first)

Currently, the optimizer chooses the order. To enforce user-specified order, additional constraints would be needed:
```python
u[p]["DXB"] < u[p]["AUH"]  # DXB must come before AUH
```

### 5. Insufficient Points for All Legs

**Scenario:** User has 50,000 points but needs 100,000 for full points booking

The optimizer will:
1. Use points where they provide best value
2. Pay cash for remaining legs
3. Balance the mix to minimize total cost

### 6. Award Space Only on One Direction

**Scenario:** Points available JFK→DXB but not DXB→JFK

The optimizer will:
1. Use points for outbound (JFK→DXB)
2. Pay cash for return (DXB→JFK)
3. This is often the optimal mixed strategy

---

## Possible Failures and Mitigations

### 1. Infeasible: No Path Exists

**Cause:** No flights connect the required cities on given dates.

**Mitigation:**
- Expand date range
- Add alternative airports
- Reduce must-visit cities

### 2. Solver Timeout

**Cause:** Too many variables (large flight graphs).

**Mitigation:**
- Pre-filter unlikely routes
- Increase solver timeout
- Use heuristic initial solution

### 3. Suboptimal Due to Missing Edges

**Cause:** Award availability not fetched for some routes.

**Mitigation:**
- Ensure comprehensive flight search
- Fallback to cash-only for missing award data

### 4. Chronological Deadlock

**Cause:** All connection options violate minimum connection time.

**Mitigation:**
- Reduce `MIN_CONNECTION_TIME` for specific airports
- Flag warning to user about tight connections

---

## Summary

The improved ILP algorithm:

1. **Removes restrictive transit limits** - Cities can be visited multiple times for connections
2. **Uses edge-based sequence tracking** - Prevents sub-tours while allowing multi-visit (unlike city-based MTZ which fails)
3. **Applies comprehensive chronological ordering** - All connections validated, not just destinations
4. **Implements balanced ranking** - Weighs cost, time, and connections appropriately
5. **Recognizes hub cities** - Legitimate connections through 68 recognized hubs aren't penalized

This produces itineraries that are:
- ✅ Valid (no time travel, sufficient connections)
- ✅ Efficient (balances cost and convenience)
- ✅ Practical (uses real airline routing patterns)
- ✅ Flexible (handles multi-visit cities like BAH on both outbound and return)
