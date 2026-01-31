# ILP (Integer Linear Programming) Optimization Explained

This document explains how Tripy's ILP-based optimization works, using a concrete example of a 7-day trip from New York (JFK) to Dubai (DXB) and back.

## Table of Contents

1. [What is ILP?](#what-is-ilp)
2. [The Optimization Problem](#the-optimization-problem)
3. [Decision Variables](#decision-variables)
4. [Constraints](#constraints)
5. [Objective Function](#objective-function)
6. [Worked Example: NYC → Dubai → NYC](#worked-example-nyc--dubai--nyc)
7. [Nuances and Edge Cases](#nuances-and-edge-cases)
8. [Possible Failures](#possible-failures)

---

## What is ILP?

**Integer Linear Programming (ILP)** is a mathematical optimization technique where:
- The **objective function** is linear (a weighted sum of variables)
- The **constraints** are linear equations or inequalities
- Some or all variables are restricted to **integer values** (including binary 0/1)

Tripy uses ILP to find the optimal combination of:
- Which flights to take
- How to pay for each flight (cash vs. points)
- Which points to transfer and where

The solver (PuLP with CBC backend) explores all valid combinations and finds the one that maximizes the objective function.

---

## The Optimization Problem

### Goal
Find the cheapest way to travel from origin to destination(s) and back, using a combination of:
- **Cash bookings** (pay full price)
- **Points via transfer** (transfer bank points → airline miles → book award)
- **Native airline miles** (use existing airline miles directly)

### Two Optimization Modes

| Mode | Goal | When to Use |
|------|------|-------------|
| **OOP** (Out-of-Pocket) | Minimize total cash paid | When you have lots of points and want to spend less cash |
| **CPP** (Cents Per Point) | Maximize point value | When you want the best "deal" for your points |

---

## Decision Variables

The ILP uses several types of binary (0/1) and integer variables:

### 1. Edge Selection: `x[p][e]`
```
x[traveler][edge] ∈ {0, 1}
```
- **1** if traveler `p` uses flight edge `e`
- **0** otherwise

**Example:** `x["john"][("JFK", "DXB", "EK201")] = 1` means John takes Emirates flight 201 from JFK to DXB.

### 2. Cash Payment: `z[(q,p)][e]`
```
z[(payer, traveler)][edge] ∈ {0, 1}
```
- **1** if payer `q` pays **cash** for traveler `p` on edge `e`

**Example:** `z[("john", "john")][("JFK", "DXB", "EK201")] = 1` means John pays cash for his own ticket.

### 3. Points via Transfer: `y[(q,p)][(s,a)][e]`
```
y[(payer, traveler)][(bank, airline)][edge] ∈ {0, 1}
```
- **1** if payer `q` uses bank `s` points transferred to airline `a` for traveler `p` on edge `e`

**Example:** `y[("john", "john")][("chase", "UA")][("JFK", "DXB", "EK201")] = 1` means John transfers Chase points to United to book the flight.

### 4. Native Points: `y_native[(q,p)][a][e]`
```
y_native[(payer, traveler)][airline][edge] ∈ {0, 1}
```
- **1** if payer `q` uses their existing airline `a` miles for traveler `p` on edge `e`

### 5. Transfer Blocks: `t_blocks[q][(s,a)]`
```
t_blocks[payer][(bank, airline)] ∈ {0, 1, 2, 3, ...}
```
- Number of 1,000-point blocks transferred from bank `s` to airline `a`

---

## Constraints

### 1. Path Constraints

#### Start Constraint
Exactly one flight must leave the start city:
```
∑{e: origin(e) = start_city} x[p][e] = 1
```

#### End Constraint  
Exactly one flight must arrive at the end city:
```
∑{e: destination(e) = end_city} x[p][e] = 1
```

#### Flow Conservation
For intermediate cities, what goes in must come out:
```
∑{e: origin(e) = city} x[p][e] = ∑{e: destination(e) = city} x[p][e]
```

#### Must-Visit Cities
Each destination must be visited exactly once:
```
∑{e: destination(e) = must_visit_city} x[p][e] = 1
```

#### Transit City Limits
Transit cities (layovers) can be visited at most once:
```
∑{e: destination(e) = transit_city} x[p][e] ≤ 1
```

### 2. Payment Constraints

Exactly one payment method per selected edge:
```
∑{q} z[(q,p)][e] + ∑{q,s,a} y[(q,p)][(s,a)][e] + ∑{q,a} y_native[(q,p)][a][e] = x[p][e]
```

If an edge is selected (`x=1`), exactly one of cash/transfer/native must be 1.
If an edge is not selected (`x=0`), all payment variables must be 0.

### 3. Transfer Constraints

Points transferred must come from available balance:
```
∑{a} t_blocks[q][(s,a)] × block_size ≤ source_balance[q][s]
```

Miles used must fit within transferred blocks:
```
∑{p,e} y[(q,p)][(s,a)][e] × miles[a][e] ≤ t_blocks[q][(s,a)] × block_size × ratio
```

### 4. Chronological Constraints

At must-visit cities (destinations where you stay), departing flight must be after arriving flight:
```
If arrival_time(e1) > departure_time(e2):
    x[p][e1] + x[p][e2] ≤ 1  (can't select both)
```

---

## Objective Function

### OOP Mode (Minimize Cash)
```
Maximize:
    W_savings × (cash_saved_by_using_points)
  - W_cash × (total_cash_paid)
  - W_surcharge × (surcharge_penalty)
  - W_time × (total_travel_time)
  + W_benefit × (card_benefits)
  - W_extra_city × (edges_to_unwanted_cities)
  - W_edges × (number_of_edges)
```

**Weights:**
| Weight | Value | Purpose |
|--------|-------|---------|
| W_savings | 10^7 | Strongly reward using points |
| W_cash | 10^6 | Strongly penalize cash spending |
| W_surcharge | 10^3 | Moderately penalize high surcharges |
| W_time | 1 | Slightly prefer shorter flights |
| W_extra_city | 10^12 | VERY strongly avoid routing through extra cities |
| W_edges | 10^9 | Strongly prefer fewer flight segments |

---

## Worked Example: NYC → Dubai → NYC

### Trip Details
- **Origin/Return:** New York (JFK)
- **Destination:** Dubai (DXB)
- **Duration:** 7 days
- **Traveler:** John
- **Points Available:**
  - Chase Ultimate Rewards: 150,000
  - Amex Membership Rewards: 80,000

### Step 1: Build the Flight Graph

The system fetches available flights and builds a graph:

```
Edges (simplified):
┌─────────────────────────────────────────────────────────────────┐
│ Edge                    │ Cash  │ Points │ Program │ Surcharge │
├─────────────────────────┼───────┼────────┼─────────┼───────────┤
│ JFK → DXB (EK201)       │ $1200 │ 62,500 │ EK      │ $150      │
│ JFK → DXB (UA962)       │ $1100 │ 77,000 │ UA      │ $50       │
│ JFK → IST → DXB (TK1)   │ $800  │ 45,000 │ TK      │ $80       │
│ JFK → LHR → DXB (BA115) │ $950  │ 50,000 │ BA      │ $400      │
│ DXB → JFK (EK203)       │ $1300 │ 62,500 │ EK      │ $150      │
│ DXB → JFK (UA963)       │ $1150 │ 77,000 │ UA      │ $50       │
│ DXB → IST → JFK (TK2)   │ $850  │ 45,000 │ TK      │ $80       │
└─────────────────────────────────────────────────────────────────┘
```

### Step 2: Set Up Variables

For each edge, create decision variables:
```python
# Edge selection
x["john"][("JFK", "DXB", "EK201")] = ?  # 0 or 1
x["john"][("JFK", "DXB", "UA962")] = ?
# ... etc

# Payment method (for each selected edge)
z[("john", "john")][("JFK", "DXB", "EK201")] = ?  # Cash
y[("john", "john")][("chase", "UA")][("JFK", "DXB", "UA962")] = ?  # Points
```

### Step 3: Apply Constraints

**Path constraints:**
```
# Exactly 1 outbound from JFK
x["john"][("JFK", "DXB", "EK201")] + x["john"][("JFK", "DXB", "UA962")] + ... = 1

# Exactly 1 inbound to JFK
x["john"][("DXB", "JFK", "EK203")] + x["john"][("DXB", "JFK", "UA963")] + ... = 1

# Must visit DXB exactly once
x["john"][("JFK", "DXB", "*")] + x["john"][("IST", "DXB", "*")] + ... = 1
```

**Payment constraints:**
```
# If EK201 selected, exactly one payment method
z[cash] + y[chase→EK] + y[amex→EK] + y_native[EK] = x[("JFK", "DXB", "EK201")]
```

**Transfer constraints:**
```
# Can't transfer more than John has
t_blocks["john"][("chase", "UA")] × 1000 ≤ 150,000

# Miles used ≤ miles transferred
miles_used ≤ t_blocks × 1000 × transfer_ratio
```

### Step 4: Evaluate Objective

**Option A: Direct flights with cash**
```
JFK → DXB (EK201): $1,200 cash
DXB → JFK (EK203): $1,300 cash
─────────────────────────────
Total: $2,500 cash, 0 points
Edges: 2

Objective = 0 - (10^6 × 2500) - (10^9 × 2)
         = -2,500,000,000 - 2,000,000,000
         = -4.5 × 10^9
```

**Option B: Direct flights with points (Chase → UA)**
```
JFK → DXB (UA962): 77,000 UA miles + $50 surcharge
DXB → JFK (UA963): 77,000 UA miles + $50 surcharge
─────────────────────────────────────────────────
Total: $100 cash, 154,000 points (transfer 154,000 Chase → UA)
Cash saved: $2,250 - $100 = $2,150
Edges: 2

Objective = (10^7 × 2150) - (10^6 × 100) - (10^9 × 2)
         = 21,500,000,000 - 100,000,000 - 2,000,000,000
         = 19.4 × 10^9
```

**Option C: Connection via Istanbul with points (Amex → TK)**
```
JFK → IST (TK1a): 22,500 TK miles + $40
IST → DXB (TK1b): 22,500 TK miles + $40
DXB → IST (TK2a): 22,500 TK miles + $40
IST → JFK (TK2b): 22,500 TK miles + $40
────────────────────────────────────────
Total: $160 cash, 90,000 points
Cash saved: $1,650 - $160 = $1,490
Edges: 4
Extra cities: IST visited twice → penalty = 2 × 10^12

Objective = (10^7 × 1490) - (10^6 × 160) - (10^9 × 4) - (2 × 10^12)
         = 14,900,000,000 - 160,000,000 - 4,000,000,000 - 2,000,000,000,000
         ≈ -2 × 10^12  (VERY NEGATIVE due to extra city penalty)
```

### Step 5: Solver Selects Optimal Solution

The solver compares all valid options and selects **Option B** with the highest objective value (19.4 × 10^9).

**Final Itinerary:**
```
┌────────────────────────────────────────────────────────────────┐
│ OUTBOUND: Feb 11, 2026                                        │
│ JFK → DXB on United UA962                                     │
│ Payment: 77,000 United miles + $50 (transferred from Chase)   │
├────────────────────────────────────────────────────────────────┤
│ STAY: 7 nights in Dubai                                       │
├────────────────────────────────────────────────────────────────┤
│ RETURN: Feb 18, 2026                                          │
│ DXB → JFK on United UA963                                     │
│ Payment: 77,000 United miles + $50 (transferred from Chase)   │
├────────────────────────────────────────────────────────────────┤
│ TRANSFER STRATEGY:                                            │
│ Transfer 154,000 Chase Ultimate Rewards → United MileagePlus  │
├────────────────────────────────────────────────────────────────┤
│ TOTAL: $100 cash + 154,000 Chase points                       │
│ SAVINGS: $2,400 vs cash booking                               │
└────────────────────────────────────────────────────────────────┘
```

---

## Nuances and Edge Cases

### 1. Transfer Ratio Variations

Not all transfers are 1:1. Capital One → British Airways is 1:0.75:
```python
transfer_graph = {
    "capitalone": {"BA": 0.75}  # 1000 C1 points = 750 Avios
}
```

The ILP accounts for this in the transfer constraints.

### 2. Transfer Bonuses

Periodic promotions offer bonus miles (e.g., 30% bonus):
```python
# With 30% bonus: 100,000 Chase → 130,000 United
transfer_bonus = {("chase", "UA"): 1.3}
```

### 3. Surcharge Rejection

Awards with excessive surcharges are automatically rejected:
```python
# Reject if:
# - Surcharge > 50% of cash price
# - Surcharge > $300 per segment

# BA JFK→LHR: $950 cash, 50,000 Avios + $400 surcharge
# $400 > $300 → REJECTED (not considered as points option)
```

### 4. Program-Specific CPP Thresholds (CPP Mode)

In CPP mode, different programs have different minimum value thresholds:
```python
thresholds = {
    "BA": 1.8,   # British Airways - high surcharges, need high CPP
    "SQ": 1.5,   # Singapore - premium program
    "UA": 1.0,   # United - flexible, lower threshold
    "DL": 0.9,   # Delta - variable value
}
```

### 5. Multi-Traveler Scenarios

When multiple travelers share points:
```python
can_pay_for = {
    ("john", "john"): 1,  # John can pay for himself
    ("john", "jane"): 1,  # John can pay for Jane
    ("jane", "jane"): 1,  # Jane can pay for herself
    ("jane", "john"): 0,  # Jane can't pay for John (example)
}
```

### 6. Round-Trip Flow Conservation

For round trips (start == end), flow conservation ensures:
- Exactly 1 edge leaves JFK (outbound)
- Exactly 1 edge arrives at JFK (return)
- At JFK: outflow == inflow

---

## Possible Failures

### 1. Infeasible Solution
**Cause:** No valid path exists that satisfies all constraints.

**Examples:**
- No flights available on requested dates
- Budget too low for any option
- Must-visit city has no incoming/outgoing flights

**Solution:** Relax constraints (expand dates, increase budget, try alternative airports).

### 2. Sub-Optimal Routing (Fixed)
**Cause:** Optimizer routes through unnecessary cities to save points.

**Example:** JFK → YYZ → CDG → DXB → IST → FRA → JFK instead of JFK → DXB → JFK

**Solution:** High penalties for extra cities (`W_extra_city = 10^12`) and edge count (`W_num_edges = 10^9`).

### 3. Points Not Being Used
**Cause:** Transfer graph doesn't link user's bank to flight's airline.

**Example:** User has Citi points, but only Amex transfers to Emirates.

**Diagnosis:** Check logs for "link_ok=0" warnings.

**Solution:** Verify transfer graph configuration, add missing transfer paths.

### 4. Chronological Violations
**Cause:** Return flight departs before outbound arrives (time travel).

**Example:** Arrive in DXB at 10pm, but selected return departs at 8am same day.

**Solution:** Chronological constraints block invalid combinations at must-visit cities.

### 5. Excessive Surcharges Selected
**Cause:** Cash saved still positive despite high surcharge.

**Example:** $3000 cash flight, 100k miles + $1500 surcharge → CPP = 1.5¢ but $1500 OOP!

**Solution:** Surcharge rejection rules (>50% of cash or >$300/segment).

### 6. Solver Timeout
**Cause:** Too many variables/constraints, solver can't finish in time.

**Symptoms:** Very large flight graphs (>500 edges), many travelers.

**Solution:** Reduce search space, increase timeout, use heuristics for initial solution.

### 7. Missing Award Availability
**Cause:** Flight exists for cash but no award seats available.

**Example:** JFK→DXB cash flight found, but Emirates has no award seats.

**Diagnosis:** `ILP edges with award pricing: 0` in logs.

**Solution:** The ILP falls back to cash-only for that route.

---

## Summary

The ILP optimization:

1. **Models the problem** as a graph with flights as edges
2. **Creates binary variables** for each flight/payment combination
3. **Applies constraints** for valid paths, payments, and transfers
4. **Maximizes an objective** that rewards point savings and penalizes costs
5. **Finds the optimal solution** using the CBC solver

The key insight is that by formulating travel booking as an ILP, we can efficiently search through millions of combinations to find the truly optimal itinerary—something a human couldn't do manually.

**For the NYC → Dubai example:**
- The solver evaluates direct vs. connection flights
- Compares cash vs. points for each option
- Accounts for transfer ratios and bonuses
- Strongly penalizes unnecessary routing complexity
- Returns the best overall solution: direct United flights using Chase points
