# Direct Flight (Cash) vs. Indirect Flight (Points): Decision Logic Under Budget Constraints

## Table of Contents

1. [Overview](#overview)
2. [The Core Trade-Off](#the-core-trade-off)
3. [Flight Search Pipeline](#flight-search-pipeline)
4. [How Points Are Valued](#how-points-are-valued)
5. [The ILP Optimization Model](#the-ilp-optimization-model)
6. [Budget as a Hard Constraint](#budget-as-a-hard-constraint)
7. [Adaptive Budget Tiers](#adaptive-budget-tiers)
8. [Connection Penalties: Why Direct Flights Are Strongly Preferred](#connection-penalties-why-direct-flights-are-strongly-preferred)
9. [Optimization Modes](#optimization-modes)
10. [Pruning and Pre-Filtering](#pruning-and-pre-filtering)
11. [Award Rejection Guardrails](#award-rejection-guardrails)
12. [Transfer Partner Graph](#transfer-partner-graph)
13. [End-to-End Decision Flow](#end-to-end-decision-flow)
14. [Worked Examples](#worked-examples)
15. [Key Configuration Constants](#key-configuration-constants)

---

## Overview

Tripy's flight optimizer solves a fundamental travel planning problem: **should a user pay cash for a direct flight, or burn loyalty points/miles on a (potentially indirect) award flight?** The answer depends on the interaction of several factors—budget constraints, points balances, redemption value (CPP), travel time, and the number of connections.

The system uses an **Integer Linear Programming (ILP)** solver to find the globally optimal assignment of flights to payment methods (cash or points) across all legs of a trip. This is not a greedy heuristic—it simultaneously considers every feasible combination of routes and payment methods, subject to hard constraints (budget, points balances, route validity) and soft preferences (fewer connections, shorter travel time, better CPP).

---

## The Core Trade-Off

At its simplest, the decision reduces to:

| Factor | Direct Flight (Cash) | Indirect Flight (Points) |
|--------|---------------------|-------------------------|
| **Cost** | Full ticket price in cash | Surcharge only (taxes/fees) |
| **Travel time** | Usually shorter | Usually longer (layovers) |
| **Convenience** | No connections | One or more connections |
| **Points spent** | None | Thousands of miles/points |
| **Budget impact** | Full price against budget | Only surcharge against budget |

The key insight: **award flights only cost the surcharge in cash**. If a user's budget is $500 but the direct cash flight is $800, the system *must* find a points-based alternative. An indirect award flight with a $120 surcharge fits within budget even though it requires a connection.

---

## Flight Search Pipeline

The system employs a multi-strategy search to gather both cash and award options:

### Strategy 1: Award-First (`get_flights_award_first_with_points_async`)

1. Query **AwardTool API** for real-time award availability (miles pricing across multiple airline programs)
2. Query **SERP (Google Flights)** for cash pricing
3. Merge results, prioritizing award options
4. Fall back to the best cash option per origin-destination pair if no exact flight match exists

### Strategy 2: SERP-First (`get_flights_serp_first_with_points_async`)

1. Search SERP first for cash options
2. Query AwardTool to find matching award availability
3. Annotate cash flights with corresponding award options

### Strategy 3: SERP-Only (Fallback)

- Cash-only fallback when award searches fail or time out

For each origin-destination pair, the system collects:
- **Cash flights**: Direct and connecting options with full cash prices
- **Award flights**: Points required + surcharge, by airline program
- **Metadata**: Departure/arrival times, duration, number of stops, carriers

---

## How Points Are Valued

Points redemptions are evaluated using **Cents Per Point (CPP)**:

```
CPP = (cash_price - surcharge) × 100 / points_required
```

For example:
- Cash flight: $500
- Award flight: 25,000 miles + $80 surcharge
- Cash saved: $500 − $80 = $420
- CPP: ($420 × 100) / 25,000 = **1.68¢ per point**

The system maintains market-implied CPP valuations for major programs:

| Program | Market CPP | Category |
|---------|-----------|----------|
| Chase Ultimate Rewards | 1.8¢ | Bank (transferable) |
| Amex Membership Rewards | 1.8¢ | Bank (transferable) |
| Bilt Rewards | 1.8¢ | Bank (transferable) |
| Citi ThankYou | 1.5¢ | Bank (transferable) |
| Capital One Miles | 1.5¢ | Bank (transferable) |
| Alaska Mileage Plan | 1.8¢ | Airline |
| Singapore KrisFlyer | 1.7¢ | Airline |
| American AAdvantage | 1.4¢ | Airline |
| United MileagePlus | 1.3¢ | Airline |
| Delta SkyMiles | 1.2¢ | Airline |
| Emirates Skywards | 0.8¢ | Airline |

These valuations serve as benchmarks. In CPP-focused mode, the system only burns points when the achieved CPP exceeds the market rate—otherwise, the user would be better off keeping their points for a future redemption.

---

## The ILP Optimization Model

The optimizer formulates the routing and payment problem as an **Integer Linear Program** (ILP). The decision variables are binary (0 or 1):

### Decision Variables

| Variable | Meaning |
|----------|---------|
| `x[p][e]` | Passenger `p` takes flight edge `e` (1 = yes) |
| `z[(q, p)][e]` | Payer `q` pays **cash** for passenger `p` on edge `e` |
| `y[(q, p)][(s, a)][e]` | Payer `q` pays with **transferred points** (source `s` → airline `a`) for passenger `p` on edge `e` |
| `y_native[(q, p)][a][e]` | Payer `q` pays with **native airline miles** for passenger `p` on edge `e` |

### Core Constraints

1. **Route validity**: Each passenger must have a connected path from origin to destination
2. **Payment exclusivity**: Each selected flight is paid for by exactly one method (cash OR points, from one payer)
3. **Points balance**: Total points drawn from each source cannot exceed available balance
4. **Transfer eligibility**: Points can only flow through valid bank → airline transfer paths
5. **Chronological ordering**: Connecting flights must have valid layover times (≥60 minutes)
6. **Budget constraint**: Total out-of-pocket (cash + surcharges) ≤ budget

---

## Budget as a Hard Constraint

The budget is enforced as a **hard constraint**, not a soft preference. The ILP *must* find a solution within budget or declare infeasibility.

```
total_out_of_pocket = flight_cash + flight_surcharges ≤ cash_budget
```

Where:
- `flight_cash` = sum of full ticket prices for cash-booked flights
- `flight_surcharges` = sum of taxes/fees for points-booked flights

This creates a powerful forcing function:

| Scenario | Budget | All-Cash Price | Cheapest Surcharge | Result |
|----------|--------|---------------|-------------------|--------|
| Budget covers cash | $2,000 | $1,500 | $120 | Solver may use cash or points (optimizes per mode) |
| Budget requires points | $500 | $1,500 | $120 | **Solver MUST use points** (cash exceeds budget) |
| Budget infeasible | $50 | $1,500 | $120 | No solution possible (even surcharge exceeds budget) |

When the budget requires points, the system automatically relaxes CPP quality guardrails to ensure it can find *some* within-budget solution, even if the redemption value isn't ideal.

---

## Adaptive Budget Tiers

The system computes a **budget tightness ratio** to determine how aggressively to pursue points options:

```
r = budget / best_cash_price
```

This ratio drives a four-tier system that progressively relaxes CPP quality guards:

### Tier Definitions

| Tier | Ratio (r) | CPP Floor | Max Miles/$ | Behavior |
|------|-----------|-----------|-------------|----------|
| **Normal** | r ≥ 1.0 | 1.1¢ | 140 | Budget covers cash. Full CPP guards active. Points used only for great value. |
| **Tight** | 0.60 ≤ r < 1.0 | 0.95¢ | 180 | Budget needs points. CPP guards relaxed moderately. |
| **Very Tight** | 0.30 ≤ r < 0.60 | 0.80¢ | 250 | Heavy points usage required. CPP guards relaxed significantly. |
| **Critical** | r < 0.30 or budget < $100 | 0.0¢ | ∞ | **No CPP restrictions at all.** Any points usage is acceptable to stay within budget. |

The design principle is explicit: **budget compliance > redemption quality**. Meeting the user's cash budget is always more important than achieving an optimal CPP. The system would rather burn points at 0.5¢/point than exceed the budget.

### Tier Escalation

If the solver fails to find a solution at the current tier, it escalates:
1. Solve at computed tier → if infeasible, bump to next tier
2. Repeat until a solution is found or the problem is truly infeasible
3. At CRITICAL tier, no quality guards remain—if still infeasible, the budget genuinely cannot be met

---

## Connection Penalties: Why Direct Flights Are Strongly Preferred

The optimizer applies **extremely heavy penalties** for additional connections, making indirect flights a last resort rather than a default:

| Penalty | Weight | Meaning |
|---------|--------|---------|
| Extra connection | 10^12 | Each stop beyond the minimum is almost prohibitive |
| Non-hub transit city | 10^13 | Routing through obscure airports is even more penalized |
| Travel time | 10^3 | Shorter flights preferred (moderate weight) |

For context, a $1 difference in cash cost has a penalty weight of ~10^10 in money-saving mode. This means **one extra connection is penalized as much as a ~$100 cash price difference**. The system will pay $100 more in cash to avoid an unnecessary connection.

### Hub City Recognition

Not all connections are equally penalized. The system recognizes major hub airports (JFK, LAX, ORD, LHR, DXB, etc.) as legitimate connection points. Routing through a recognized hub incurs only the base connection penalty (10^12), while routing through a non-hub city adds the extra city penalty (10^13) on top.

This means: JFK → LHR → CDG (connecting at London Heathrow, a major hub) is far more acceptable than JFK → BHX → CDG (connecting at Birmingham, a non-hub).

### Nonstop Bonus in Pruning

Before the ILP solver even runs, the pruning stage awards a **+0.3 score bonus** to nonstop flights and a **-0.15 per stop penalty** to connecting flights during the combined heuristic scoring:

```
nonstop_bonus = 0.3    if num_stops == 0
                0.0    if num_stops == 1
               -0.15 × num_stops   otherwise
```

This biases the pruned candidate set toward direct flights.

---

## Optimization Modes

The system supports three optimization modes, each defining a different objective function for the ILP:

### Mode 1: Money Saving (OOP)

**Goal**: Minimize total out-of-pocket cash.

```
Objective = minimize(
    10^10 × total_cash                    // Primary: minimize cash spent
  + 10^12 × extra_connections             // Extreme: penalize connections
  + 10^8  × surcharge_penalties           // High: penalize high surcharges
  + 10^3  × total_travel_time             // Moderate: prefer shorter trips
  + 10^13 × non_hub_city_routing          // Extreme: penalize non-hub routing
  - benefits_from_card_perks              // Reward card benefits (e.g., free bags)
)
```

In this mode, points are used **whenever they reduce cash spending**. The solver doesn't explicitly "reward" points—it simply allows points to replace cash when the result is cheaper. A direct cash flight at $300 beats an indirect award flight with $250 surcharge + 20k miles, because the cash savings ($50) don't justify the connection penalty.

**When this mode picks an indirect award flight over a direct cash flight:**
- The cash savings from using points outweigh the connection penalty
- The budget *requires* points (budget < cash price)
- The direct flight's cash price is so high that even with the connection penalty, the award option wins

### Mode 2: CPP Focused

**Goal**: Maximize points redemption value—only use points when CPP > 1.0¢.

```
Objective = maximize(
    10^7  × points_value                  // High reward for good CPP redemptions
  - 10^4  × total_cash                    // Moderate cash penalty
  - 10^5  × surcharge_penalties           // High surcharge penalty
  - 10^3  × total_travel_time             // Moderate time penalty
  - 10^12 × extra_connections             // Extreme connection penalty
  - 10^13 × non_hub_city_routing          // Extreme non-hub penalty
)
```

This mode is pickier: it only burns points if the redemption exceeds 1.0¢/point. A $500 flight bookable with 25,000 miles + $80 surcharge yields 1.68¢/point—accepted. But 60,000 miles + $380 surcharge for a $500 flight yields only 0.2¢/point—rejected.

### Mode 3: Balanced

**Goal**: Optimize the trade-off between points value, travel time, and convenience.

```
balanced_value = cash_savings × time_factor
time_factor = min(3.0, 10.0 / travel_hours)

Objective = maximize(
    10^6  × balanced_value                // Reward value-per-hour
  - 10^5  × total_cash                    // Moderate cash penalty
  - 10^4  × surcharge_penalties           // Moderate surcharge penalty
  - 10^4  × total_travel_time             // Significant time penalty
  - 10^8  × extra_connections             // High connection penalty
  - 10^13 × non_hub_city_routing          // Extreme non-hub penalty
)
```

This mode penalizes longer flights more heavily and accepts points redemptions at a lower threshold (0.5¢/point). A short direct award flight with decent CPP beats a long connecting award flight with great CPP.

---

## Pruning and Pre-Filtering

Before the ILP solver runs, the candidate set is pruned to keep computation tractable:

### Flight Pruning

For each origin-destination pair, the system keeps the **top 5** options across four dimensions:
1. **Lowest cash price** — cheapest cash options
2. **Shortest travel time** — fastest options
3. **Best award value** — highest CPP redemptions
4. **Fewest stops** — most convenient options

### Combined Heuristic Score

Flights that don't rank in the top 5 on any single dimension are scored with a combined heuristic:

```
score = 0.20 × cash_score
      + 0.20 × award_score
      + 0.20 × time_score
      + 0.10 × time_preference_match
      + nonstop_bonus
      + time_preference_bonus
      - carrier_change_penalty
```

Where:
- `cash_score` = 1.0 − min(1.0, price / $5,000) — cheaper is better
- `time_score` = 1.0 − min(1.0, minutes / 1,440) — shorter is better (normalized to 24h)
- `award_score` = min(1.0, best_award_value / $2,000) — better redemptions score higher
- `nonstop_bonus` = +0.3 for nonstop, 0 for 1-stop, -0.15 × stops for multi-stop
- `carrier_change_penalty` = 0.1 if the itinerary involves a carrier change

### Award Option Pruning

Per flight edge, award options are pruned to the **top K airline programs** by points cost, keeping the most efficient redemptions and discarding programs with excessive miles requirements.

---

## Award Rejection Guardrails

Even after pruning, individual award options can be rejected before entering the ILP:

### Surcharge-Based Rejection

```python
if surcharge > cash_price × 0.50:     # Reject if surcharge > 50% of cash
    reject()

if surcharge > $300 per segment:       # Reject if surcharge > $300
    reject()
```

These guards prevent degenerate redemptions where the "award" flight costs nearly as much in cash as the regular ticket, making the points expenditure wasteful.

### CPP Floor Rejection

Depending on the budget tier, the system rejects award options below a CPP floor:

| Budget Tier | CPP Floor | Effect |
|-------------|-----------|--------|
| Normal | 1.1¢ | Only good redemptions pass |
| Tight | 0.95¢ | Slightly relaxed |
| Very Tight | 0.80¢ | Further relaxed |
| Critical | 0.0¢ | Everything passes |

### Miles-Per-Dollar Guard

The system also rejects awards where too many miles are burned per dollar saved:

```
miles_per_dollar = points_required / (cash_price - surcharge)
```

| Budget Tier | Max Miles/$ | Effective CPP Floor |
|-------------|-------------|-------------------|
| Normal | 140 | ~0.71¢ |
| Tight | 180 | ~0.56¢ |
| Very Tight | 250 | ~0.40¢ |
| Critical | ∞ | None |

This prevents scenarios like: $500 cash flight, 60,000 miles + $380 surcharge → saves $120 using 60,000 miles → 500 miles per dollar → **rejected** (except under critical budget pressure).

---

## Transfer Partner Graph

Points aren't always held in the right program. The system models a **transfer graph** mapping bank currencies to airline programs:

| Bank Program | Airline Partners (sample) |
|-------------|-------------------------|
| Chase UR | United, British Airways, Singapore, Air France, Virgin Atlantic, Emirates, Air Canada, Alaska |
| Amex MR | Delta, JetBlue, British Airways, Singapore, Cathay Pacific, ANA, Air Canada, Alaska |
| Citi TYP | American, Turkish, Singapore, Cathay Pacific, Qatar, Air France, Air Canada |
| Capital One | Air Canada, Air France, British Airways, Emirates, Singapore, Turkish |
| Bilt | United, American, British Airways, Air France, Turkish, Air Canada, Alaska |

Transfer ratios are typically 1:1. The ILP solver models these transfers as variables, allowing it to route points through the optimal transfer path. For example, if a user has Chase UR points and needs to book an award on Singapore Airlines, the solver can transfer Chase → Singapore KrisFlyer and book the award.

---

## End-to-End Decision Flow

Here is the complete decision pipeline from trip request to route selection:

```
┌─────────────────────────────────────────────────────┐
│  1. SEARCH PHASE                                     │
│  ┌──────────────┐     ┌──────────────┐              │
│  │ AwardTool API│     │ SERP / Google│              │
│  │ (award avail)│     │ (cash prices)│              │
│  └──────┬───────┘     └──────┬───────┘              │
│         └───────┬────────────┘                       │
│                 ▼                                     │
│        Merge: each flight edge has                   │
│        cash_price + [award_options]                   │
│        (direct and connecting routes)                │
└─────────────────────────┬───────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────┐
│  2. PRUNING PHASE                                    │
│  • Keep top-5 by: cash, time, award value, stops    │
│  • Nonstop bonus: +0.3 score                         │
│  • Combined heuristic tiebreak                       │
│  • Award option pruning (top-K programs per edge)    │
└─────────────────────────┬───────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────┐
│  3. GUARDRAIL PHASE                                  │
│  • Compute budget tier: r = budget / best_cash       │
│  • Set adaptive CPP floor and miles/$ limit          │
│  • Reject awards:                                    │
│    - Surcharge > 50% of cash price                   │
│    - Surcharge > $300/segment                        │
│    - CPP < floor (tier-dependent)                    │
│    - Miles/$ > max (tier-dependent)                  │
└─────────────────────────┬───────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────┐
│  4. ILP OPTIMIZATION PHASE                           │
│  Hard constraints:                                   │
│    • Route connectivity (valid path)                 │
│    • Payment exclusivity (one method per flight)     │
│    • Points balance limits                           │
│    • Transfer eligibility (bank → airline)            │
│    • Chronological ordering (valid layovers ≥ 60m)   │
│    • BUDGET: cash + surcharges ≤ budget              │
│                                                      │
│  Objective (mode-dependent):                         │
│    money_saving → minimize cash spent                │
│    cpp_focused  → maximize CPP value                 │
│    balanced     → optimize value/time/convenience    │
│                                                      │
│  Connection penalties: 10^12 per extra stop          │
│  Non-hub city penalty: 10^13 per non-hub transit     │
└─────────────────────────┬───────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────┐
│  5. RESULT                                           │
│  Each flight edge labeled:                           │
│    • CASH: pay full price                            │
│    • POINTS: pay surcharge + deduct miles            │
│       (with transfer path if needed)                 │
│  Total OOP ≤ budget ✓                                │
└─────────────────────────────────────────────────────┘
```

---

## Worked Examples

### Example 1: Budget Allows Cash — Direct Cash Wins

**Scenario**: JFK → LHR, Budget = $2,000

| Option | Type | Cash OOP | Points | Stops | Travel Time |
|--------|------|----------|--------|-------|-------------|
| A | Direct, cash | $750 | 0 | 0 | 7h |
| B | Direct, award | $120 surcharge | 30,000 UA | 0 | 7h |
| C | 1-stop, award | $80 surcharge | 22,000 BA | 1 | 11h |

**Budget tier**: Normal (r = $2,000 / $750 = 2.67 ≥ 1.0)

**In Money Saving mode**: Option B wins — same direct flight, only $120 OOP vs. $750. CPP = ($750 − $120) × 100 / 30,000 = 2.1¢ (excellent). Connection penalty doesn't apply since B is also direct.

**In CPP Focused mode**: Option B also wins — 2.1¢/point exceeds the 1.0¢ threshold. Option C has CPP = ($750 − $80) × 100 / 22,000 = 3.05¢ (even better CPP), but the 10^12 connection penalty makes it lose to the direct option B.

**Key takeaway**: When a direct award flight exists, it almost always beats an indirect award flight due to the massive connection penalty.

### Example 2: Tight Budget Forces Points, No Direct Award

**Scenario**: SFO → NRT, Budget = $400

| Option | Type | Cash OOP | Points | Stops | Travel Time |
|--------|------|----------|--------|-------|-------------|
| A | Direct, cash | $1,200 | 0 | 0 | 11h |
| B | 1-stop, award (via ICN) | $150 surcharge | 40,000 ANA | 1 | 15h |
| C | 1-stop, cash (via LAX) | $900 | 0 | 1 | 14h |

**Budget tier**: Critical (r = $400 / $900 = 0.44... wait, best cash = $900 for 1-stop, $1,200 for direct → best = $900, r = 0.44 → Very Tight)

- Option A: $1,200 > $400 budget → **infeasible (cash)**
- Option C: $900 > $400 budget → **infeasible (cash)**
- Option B: $150 surcharge < $400 budget → **feasible** ✓

**Result**: Option B (1-stop award via Seoul) is the **only feasible option**. The system selects it despite the connection, because budget compliance is a hard constraint. CPP = ($900 − $150) × 100 / 40,000 = 1.875¢ — excellent value anyway.

### Example 3: Balanced Mode Trade-Off

**Scenario**: LAX → CDG, Budget = $800

| Option | Type | Cash OOP | Points | Stops | Travel Time | CPP |
|--------|------|----------|--------|-------|-------------|-----|
| A | Direct, cash | $650 | 0 | 0 | 11h | N/A |
| B | Direct, award | $200 surcharge | 45,000 AF | 0 | 11h | 1.0¢ |
| C | 1-stop, award (via LHR) | $90 surcharge | 25,000 BA | 1 | 14h | 2.24¢ |

**Budget tier**: Normal (r = $800 / $650 = 1.23 ≥ 1.0)

**In Money Saving mode**: Option B wins ($200 < $650 cash), saves $450 in OOP. Option C saves $560 but incurs a 10^12 connection penalty.

**In CPP Focused mode**: Option C has better CPP (2.24¢ vs 1.0¢), but the connection penalty (10^12) dominates. Option B barely meets the 1.0¢ threshold. If B's CPP were 0.9¢, the solver would prefer Option A (cash) since B doesn't meet the threshold.

**In Balanced mode**: Option B wins with balanced_value = $450 savings × time_factor(11h) = $450 × (10/11) = $409 adjusted value. Option C = $560 × (10/14) = $400 adjusted value. B edges out C even before the connection penalty.

---

## Key Configuration Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `W_connection` | 10^12 | `points_maximizer.py` | Penalty per extra flight connection |
| `W_extra_city` | 10^13 | `points_maximizer.py` | Penalty for routing through non-hub cities |
| `MAX_SURCHARGE_CASH_RATIO` | 0.50 | `points_maximizer.py` | Reject award if surcharge > 50% of cash price |
| `MAX_SURCHARGE_PER_SEGMENT` | $300 | `points_maximizer.py` | Maximum surcharge per flight segment |
| `MIN_CPP_OOP_MODE` | 0.5¢ | `points_maximizer.py` | Minimum CPP in money saving mode |
| `MIN_CPP_FOCUSED` | 1.0¢ | `points_maximizer.py` | Minimum CPP in CPP focused mode |
| `MIN_CPP_BALANCED` | 0.5¢ | `points_maximizer.py` | Minimum CPP in balanced mode |
| `MIN_CONNECTION_TIME` | 60 min | `points_maximizer.py` | Minimum layover for valid connections |
| `budget_tier_tight_ratio` | 1.0 | `models_v3.py` | Budget-to-cash ratio below which = "tight" |
| `budget_tier_very_tight_ratio` | 0.60 | `models_v3.py` | Below this = "very tight" |
| `budget_tier_critical_ratio` | 0.30 | `models_v3.py` | Below this = "critical" (no CPP guards) |
| `cpp_floor_tight` | 0.95¢ | `models_v3.py` | CPP floor for tight budgets |
| `cpp_floor_very_tight` | 0.80¢ | `models_v3.py` | CPP floor for very tight budgets |
| `cpp_floor_critical` | 0.0¢ | `models_v3.py` | CPP floor for critical budgets (no restriction) |
| `max_miles_per_dollar_saved` | 140 | `models_v3.py` | Normal tier: max miles per $1 saved |
| `max_miles_per_dollar_tight` | 180 | `models_v3.py` | Tight tier: max miles per $1 saved |
| `max_miles_per_dollar_very_tight` | 250 | `models_v3.py` | Very tight tier: max miles per $1 saved |
| ILP solver time limit | 60s | `points_maximizer.py` | Maximum solver runtime |

---

## Summary

The system's decision between a direct cash flight and an indirect points flight is governed by a hierarchy of priorities:

1. **Budget compliance** (hard constraint) — The solution must fit within the user's cash budget. If cash flights exceed the budget, points *must* be used, even at suboptimal CPP.

2. **Route quality** (near-prohibitive penalty) — Direct flights are overwhelmingly preferred. The 10^12 connection penalty means the optimizer will accept significantly higher cash costs to avoid adding a connection.

3. **Cost minimization / Value maximization** (objective function) — Depending on the mode, the solver either minimizes cash outflow or maximizes points redemption value, always subject to the above priorities.

4. **Redemption quality** (adaptive guardrails) — CPP floors and miles-per-dollar limits ensure points aren't wasted on poor redemptions—but these guards are relaxed when budget pressure demands it.

The net effect: **the system will almost always prefer a direct flight when one is available, and will use points over cash when the budget demands it or when the redemption value justifies it.** An indirect award flight only wins when no direct option fits the budget, or when the direct cash price is so high relative to the indirect award's cost that the savings outweigh the heavy connection penalty.
