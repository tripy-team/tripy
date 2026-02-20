# Multi-Airport Flight Selection: Points & Cash Optimization

## Overview

When a user searches for flights to a city served by multiple airports (e.g., "New York" → JFK / EWR / LGA), the system must decide which airport — and therefore which flight — best balances points efficiency, cash cost, and travel convenience. This document details the end-to-end pipeline: from airport expansion through pruning, ILP optimization, and final selection, including when to sacrifice CPP for lower out-of-pocket cost.

---

## 1. Airport Expansion

### Metro Mapping

The `METRO_AIRPORTS` dictionary in `backend/src/agents/orchestrator.py` maps city names and aliases to all serving airports:

| City | Airports |
|------|----------|
| New York / NYC | JFK, EWR, LGA |
| Los Angeles / LA | LAX, BUR, SNA, ONT |
| San Francisco / SF | SFO, OAK, SJC |
| Washington DC | IAD, DCA, BWI |
| London | LHR, LGW, STN, LTN |
| Paris | CDG, ORY |
| Tokyo | NRT, HND |
| Milan | MXP, LIN, BGY |

### Asymmetric Expansion: Origins vs. Destinations

The system now uses **asymmetric expansion** — origins and destinations are treated differently:

**Origins (`expand_metro=False`)**: A user departing from "SEA" means Seattle-Tacoma specifically. No metro expansion occurs.

```
"SEA" → ["SEA"]
"HND" → ["HND"]
```

**Destinations (`expand_metro=True`)**: A user flying to "HND" almost certainly wants to reach Tokyo — not Haneda specifically. The system expands to the full metro group via `_expand_to_metro()`, keeping the user's selection first for tie-breaking preference:

```
"HND" → ["HND", "NRT"]
"CDG" → ["CDG", "ORY"]
"LGA" → ["LGA", "JFK", "EWR"]
"Tokyo (HND)" → ["HND", "NRT"]
```

The `_expand_to_metro()` helper uses the `_AIRPORT_TO_METRO` reverse lookup (built from `METRO_AIRPORTS`) to find all sibling airports for any given code. The user's original selection always appears first in the returned list.

### Other Input Formats

- **City name** → always expands to all metro airports (e.g., `"Paris"` → `["CDG", "ORY"]`)
- **Comma-separated codes** → conditionally expanded based on `expand_metro` (e.g., `"SEA,BFI,PDX"`)
- **Parenthesized format** → conditionally expanded (e.g., `"Paris (CDG,ORY)"` → `["CDG", "ORY"]` + metro peers if `expand_metro=True`)

### Fallback

If a city is not in `METRO_AIRPORTS`, `itinerary_service.py` falls back to a city service API lookup, returning up to 5 airports.

### Where Expansion Is Called

In the orchestrator's trip-building flow:

| Location | `expand_metro` | Rationale |
|----------|---------------|-----------|
| Origin (`isStart`) | `False` | Respect user's departure airport |
| Intermediate destinations | `True` | User cares about the city, not the runway |
| Final destination (`isEnd`) | `True` | Same as intermediates |

---

## 2. Flight Search Pipeline

The system searches for flights across **all** expanded airports using a multi-strategy pipeline:

### Strategy 1: Award-First
1. Query AwardTool for award availability on each airport pair
2. Query SERP (Google Flights) for cash fares
3. Merge results, annotating cash flights with any matching award options

### Strategy 2: SERP-First
1. Query SERP for cash fares on each airport pair
2. Query AwardTool to annotate with award options
3. Merge

### Strategy 3: SERP-Only (Fallback)
Used when award searches fail; returns cash-only options.

At this stage, the system has a large pool of candidate flights spanning all airport variants for each city — for example, SEA→JFK, SEA→EWR, and SEA→LGA are all separate candidates for a "Seattle to New York" leg. With the new metro expansion, a user selecting "JFK" as their destination will now also see SEA→EWR and SEA→LGA candidates surfaced automatically.

---

## 3. Pruning: Multi-Criteria Candidate Reduction

Before entering the ILP solver, the candidate pool is reduced via `pruning.py` to keep the problem tractable without discarding high-value options.

### Hard Filters
- **Max stops**: Exceeds configured stop limit → discard
- **Max duration**: Exceeds configured hour limit → discard

### Multi-Criteria Selection (per origin-destination pair)

Flights are grouped by `(leg_id, origin_airport, destination_airport, date)`. Within each group, the top K candidates are selected along **five independent axes**:

| Criterion | Sort Key | Top K Kept |
|-----------|----------|------------|
| Lowest cash price | `cash_cost` ascending | `max_by_cash` |
| Shortest travel time | `total_time_minutes` ascending | `max_by_time` |
| Best award value | `best_award_value()` descending | `max_by_award` |
| Fewest stops | `(num_stops, time, cash)` ascending | 5 |
| Best time preference match | `time_pref_score` descending | `max_by_time` |

The **union** of all five selections becomes the candidate pool for that O-D pair.

### Combined Score Tie-Breaking

If the union exceeds `max_total_per_od`, a combined heuristic score ranks the survivors:

```
score = 0.20 × cash_score
      + 0.20 × award_score
      + 0.20 × time_score
      + 0.10 × time_preference_score
      + nonstop_bonus            // +0.30 nonstop, -0.15 per stop
      + time_preference_bonus    // -0.15 to +0.15
      - carrier_change_penalty   // -0.10
```

### Award Option Pruning
Per flight edge, award options are pruned to top K programs (sorted by `raw_value` descending), ensuring program diversity.

### Key Observation: Grouping Is Per-Airport-Pair

Pruning groups by `(leg, origin, destination)` — meaning SEA→JFK, SEA→EWR, and SEA→LGA are **independent groups** that each keep their own top-K. This is correct: it prevents a cheap JFK flight from eliminating all EWR flights before the optimizer can compare them holistically. With metro expansion now adding more airport pairs for destinations, the total candidate count entering the ILP is larger — but each group is independently capped.

---

## 4. ILP Optimization

### Decision Variables

The V3 solver (`solver_v3.py`) makes simultaneous decisions across all trip legs:

| Variable | Meaning |
|----------|---------|
| `x_f[leg, edge]` | Binary: select this flight for this leg |
| `z_cf[leg, edge, payer]` | Binary: pay cash for this flight |
| `y_pf[leg, edge, opt, payer, source]` | Binary: pay with points via this award option |
| `t_b[payer, bank, program]` | Integer: number of transfer blocks from bank to program |

### Optimization Modes

#### OOP (Out-of-Pocket) — Default
Minimizes total cash spent:

```
minimize: flight_cash + surcharges + stop_penalty + time_penalty
        + layover_penalty + quality_penalty
```

- Points opportunity cost is **OFF** (0.0¢), so points naturally win when they save cash
- Pass 2 tie-breaks by minimizing miles spent within the OOP budget envelope
- Guardrails (CPP floor, miles-per-dollar cap) prevent bad redemptions

#### CPP (Cents-Per-Point)
Maximizes the value extracted per point:

```
minimize: -flight_value + stops_penalty + quality_penalty
```

Only uses points when CPP ≥ program-specific threshold.

#### Balanced
Balances value and cash:

```
minimize: cash_penalty_weight × OOP_cost - flight_utility
```

#### Lexicographic
Two-stage: first ensures budget feasibility, then maximizes quality (CPP quality, fewer transfers, fewer stops, less travel time).

### Points / Cash Trade-Off Guardrails

| Guardrail | Default | Purpose |
|-----------|---------|---------|
| **CPP floor** | 1.1¢ | Blocks redemptions below this cents-per-point value |
| **Max miles per $1 saved** | 140 | Prevents spending e.g. 60k pts to save $120 (= 500 mi/$) |
| **Max surcharge ratio** | 50% of cash price | Kills awards where surcharges negate the savings |
| **Program-specific CPP thresholds** | BA: 1.8¢, LH: 1.6¢, UA: 1.0¢, etc. | Higher bar for high-surcharge programs |

### Transfer Bonuses

Both the ILP solver and the greedy fallback now integrate **live transfer bonuses** from the NerdWallet scraper.

**ILP path (`adapter_v3.py`)**: `build_transfer_paths()` fetches active bonuses via `get_ilp_transfer_bonuses()` and sets `current_bonus` and `bonus_expiry_date` on each `TransferPath`. Previously `current_bonus` was hardcoded to 1.0 — it now reflects the real promotion multiplier:

```
effective_delivered_per_block = floor(increment × base_ratio × current_bonus)
```

For example, a 30% Capital One → ANA bonus means `1000 × 1.0 × 1.3 = 1300` miles delivered per 1000-point block, making Star Alliance NRT routings significantly cheaper in the solver.

**Greedy path (`orchestrator.py`)**: The orchestrator caches bonuses via `_get_transfer_bonuses()` and exposes `_bonus_multiplier(bank_display_name, airline_code)`. This is used in three places:
1. **`_can_afford_points()`** — effective ratio stretches the user's balance (e.g., 80k C1 points with a 30% bonus cover a 100k TK award: `80k × 1.3 = 104k`)
2. **`_deduct_points_from_sources()`** — fewer bank points need to be deducted when a bonus is active (`needed_from_bank = points_needed / effective_ratio`)
3. **Transfer instructions** — bonus is surfaced as a step in the booking instructions (e.g., "Active 30% transfer bonus! Your 80,000 points become 104,000 TK miles")

### Airport Continuity Constraints

When consecutive legs share a multi-airport city, the solver adds pairwise exclusion constraints:

```
For each airport A in city C:
    arriving_at_A[leg_n] + departing_from_B[leg_n+1] ≤ 1   (B ≠ A, B ∈ C)
```

This prevents the solver from landing at ORY (Paris) and departing from CDG — which would require an expensive ground transfer the system cannot automatically insert.

### How the Solver Compares Airports

The solver sees flights to JFK, EWR, and LGA as **separate edges** for the same leg. Because `x_f` is binary and the "exactly one flight per leg" constraint forces exactly one selection, the solver naturally picks the airport that minimizes the objective — whether that's the cheapest cash fare at EWR or the best award availability at JFK.

There is **no explicit airport preference** (though the user's selected airport appears first in the expanded list for deterministic tie-breaking). The comparison is purely via the generalized cost:

```
generalized_cost(flight) = cash_or_surcharge + stop_cost × stops
                         + time_cost × excess_hours + layover_cost × excess_layover
                         + redeye_penalty + carrier_change_penalty
```

---

## 5. Concrete Example

**Trip**: Seattle → Tokyo, user selects "HND" as destination. Has 100k Chase UR, 50k Capital One, $200 cash budget. Active 30% Capital One → ANA bonus.

**Step 1 — Expansion**: Because HND is a destination, `expand_metro=True` expands to `["HND", "NRT"]`. The system searches SEA→HND and SEA→NRT.

| Flight | Route | Cash | Award Program | Miles | Surcharge | CPP |
|--------|-------|------|---------------|-------|-----------|-----|
| A | SEA→NRT nonstop (NH) | $1,200 | ANA via C1 (w/ 30% bonus) | 55k | $90 | 2.02¢ |
| B | SEA→HND nonstop (DL) | $1,050 | Delta via Amex | 80k | $5.60 | 1.31¢ |
| C | SEA→NRT 1-stop (UA) | $900 | United via Chase | 40k | $5.60 | 2.24¢ |
| D | SEA→HND 1-stop (JL) | $1,100 | JAL via C1 | 60k | $150 | 1.58¢ |

**Step 2 — Transfer bonus impact on Flight A**: The 30% C1→ANA bonus means 55k ANA miles only costs `55,000 / 1.3 = 42,308` Capital One points. The user's 50k C1 balance covers this.

**Step 3 — OOP mode** (minimize cash, $200 budget):
- All cash fares ($900–$1,200) exceed the $200 budget → must use points
- Flight A: $90 surcharge (under budget), 42.3k C1 points at effective 2.02¢ CPP ✓
- Flight C: $5.60 surcharge (under budget), 40k Chase at 2.24¢ CPP ✓ — but 1-stop adds $175 stop penalty
- Flight A wins: nonstop + excellent CPP + within budget

Without metro expansion, selecting "HND" would have missed Flight A (NRT) and Flight C (NRT) entirely. Without the transfer bonus, Flight A would have needed 55k C1 points — exceeding the user's 50k balance.

---

## 6. When to Sacrifice CPP for OOP

The system has a layered decision framework for when to accept worse cents-per-point (CPP) in exchange for lower out-of-pocket (OOP) cash. This is not a single threshold but an adaptive cascade driven by budget tightness.

### 6.1 The Core Design Principle

> **Budget compliance > redemption quality.**
>
> The system would rather redeem points at 0.8¢/pt and stay within budget than hold out for 1.5¢/pt and exceed it.

In OOP mode (the default), the objective function sets **points opportunity cost to zero** — meaning the solver treats points as "free" and only cares about minimizing the cash leaving the user's bank account. The only things preventing terrible redemptions are the CPP guardrails, and those guardrails are *intentionally relaxed* when the budget demands it.

### 6.2 Budget Tier System

The system classifies every optimization run into a budget tier based on the **tightness ratio** — the user's cash budget divided by the best available cash fare:

```
r = budget / best_cash_price
```

| Tier | Ratio (r) | CPP Floor | Max Miles/$ | Behavior |
|------|-----------|-----------|-------------|----------|
| **Normal** | r ≥ 1.0 | 1.1¢ | 140 | Full guardrails. Budget covers cash, so only use points if the redemption is genuinely good. |
| **Tight** | 0.60 ≤ r < 1.0 | 0.95¢ | 180 | Budget requires some points. Relax CPP floor slightly to open up more award options. |
| **Very Tight** | 0.30 ≤ r < 0.60 (or budget < $100) | 0.80¢ | 250 | Heavy points needed. Accept mediocre redemptions to stay within budget. |
| **Critical** | r < 0.30 | 0.0¢ | ∞ | No restrictions whatsoever. Any award the user can afford is acceptable. |

**Key design decision**: "Tight" starts at `r < 1.0`, not `r < 0.60`. This means *any* budget that requires points usage will begin relaxing CPP guards. The reasoning: if the user set a budget, meeting it is more important than perfect redemption quality.

### 6.3 The Guardrails That Get Relaxed

Three guardrails protect against bad redemptions, and all three loosen as the budget tier escalates:

#### A. CPP Floor
Blocks award options where `(cash_price - surcharge) × 100 / miles_required` falls below the floor.

- Normal: **1.1¢** — a strong floor that blocks junk (e.g., 60k pts + $380 surcharge to replace a $500 fare = 0.2¢ CPP)
- Tight: **0.95¢** — slightly more permissive
- Very Tight: **0.80¢** — accepts sub-1¢ redemptions
- Critical: **0.0¢** — anything goes

Program-specific thresholds (BA: 1.8¢, SQ: 1.5¢, UA: 1.0¢, etc.) are also relaxed proportionally.

#### B. Max Miles Per Dollar Saved
Prevents spending too many miles for each dollar of cash savings: `miles / max(1, cash_equivalent - surcharge) ≤ K`.

- Normal: **140 miles/$** (~0.7¢ effective floor)
- Tight: **180 miles/$**
- Very Tight: **250 miles/$**
- Critical: **∞** (no limit)

#### C. Max Surcharge Ratio
Blocks awards where the surcharge exceeds a percentage of the cash fare. This is fixed at **50%** in the ILP but relaxed in the greedy fallback (up to 80% at Pass 1, 95% at Pass 2, no limit at Pass 3).

### 6.4 Guardrail Escalation (Infeasibility Recovery)

If the solver returns INFEASIBLE at the current tier, it **automatically escalates** through the tier ladder:

```
normal → tight → very_tight → critical → remove budget constraint entirely
```

At each step:
1. The model is rebuilt with the new tier's relaxed guardrails
2. The solver runs again
3. If feasible, the result is returned with a warning: *"Used relaxed redemption criteria to stay within budget. Some point redemptions may have lower-than-ideal value."*
4. If still infeasible, try the next tier

This means the system will accept progressively worse CPP rather than tell the user "no solution exists."

### 6.5 Two-Pass Tie-Breaking Adapts Too

Even after finding a feasible OOP solution, the **Pass 2 tie-breaker** changes behavior based on the budget tier:

| Budget Tier | Pass 2 Priority | Rationale |
|-------------|-----------------|-----------|
| Normal / Tight | miles → time → stops | "Don't waste points" — minimize points spent among equally-cheap options |
| Very Tight / Critical | time → stops → miles | "I can go + don't kill me" — user is already committed to spending points, optimize for experience |

### 6.6 Greedy Fallback (Non-ILP Path)

The orchestrator's `_pick_best_flight_option` has its own progressive relaxation for budget-tight scenarios:

| Pass | CPP Minimum | Max Surcharge Ratio | Description |
|------|-------------|---------------------|-------------|
| Normal | 1.0¢ (configurable) | 50% | Standard quality thresholds |
| Pass 1 (budget tight) | 0.1¢ | 80% | Heavily relaxed |
| Pass 2 (budget tight) | > 0¢ | 95% | Nearly no restrictions |
| Pass 3 (budget tight) | — (any) | — (any) | Absolute last resort: any affordable award |
| Cash fallback | — | — | No usable awards at all; pay cash |

The greedy path now also accounts for **transfer bonuses** when evaluating affordability. A 30% bonus on Capital One → Turkish Airlines means the greedy solver treats 77k C1 points as sufficient for a 100k TK award (`77k × 1.3 = 100.1k`), potentially unlocking options that would otherwise fail the affordability check — making CPP sacrifice less necessary in bonus-active scenarios.

### 6.7 How Transfer Bonuses Reduce the Need to Sacrifice CPP

Transfer bonuses create a third lever beyond just relaxing CPP floors or increasing budget. When a bonus is active:

1. **More awards become affordable**: A user with 80k C1 points and a 30% bonus to ANA can now book a 100k ANA saver award. Without the bonus, this would be out of reach.
2. **Effective CPP improves**: If you transfer 77k C1 points to get 100k ANA miles for a $1,200 fare with $90 surcharge, the effective CPP based on *bank points spent* is `(1200 - 90) × 100 / 77,000 = 1.44¢` — better than the nominal 1.11¢ CPP based on airline miles.
3. **Less pressure to relax guardrails**: Because more options pass the CPP floor at their effective rate, the system is less likely to hit infeasibility and trigger tier escalation.

The ILP solver now receives `TransferPath` objects with the real `current_bonus` multiplier (previously hardcoded to 1.0), meaning it can accurately model the cost advantage of bonus-active transfer paths and prefer them during optimization.

### 6.8 When CPP Should Be Sacrificed: Decision Framework

Combining the code's behavior with real-world trade-off logic:

| Scenario | Accept Lower CPP? | Reason |
|----------|-------------------|--------|
| Budget covers cash fare (r ≥ 1.0) | **No** — enforce full guardrails | Points are optional; only use them for genuinely good redemptions |
| Budget slightly below cash (0.6 ≤ r < 1.0) | **Yes, modestly** (≥0.95¢) | Need some points to close the gap; a slightly below-average redemption is acceptable |
| Budget well below cash (0.3 ≤ r < 0.6) | **Yes, significantly** (≥0.80¢) | Must use points heavily; mediocre CPP is better than exceeding budget |
| Budget extremely tight (r < 0.3) | **Yes, unconditionally** | Survival mode — any redemption that keeps the trip alive is worthwhile |
| Active transfer bonus on a lower-CPP option | **Yes, if effective CPP improves** | A 30% bonus turns a 0.9¢ redemption into an effective 1.17¢ based on bank points spent |
| Multi-leg trip where one leg has great CPP | **Yes, on the weak leg** | The ILP optimizes globally — a 0.9¢ leg paired with a 2.0¢ leg can still average 1.45¢ |
| Nonstop vs. connecting with better CPP | **Yes, if convenience cost justifies it** | The generalized cost model prices stops at $100-175; a nonstop at 0.9¢ CPP can beat a 1-stop at 1.5¢ CPP when the stop penalty is large enough |

### 6.9 Concrete Example: Sacrificing CPP for Budget

**Trip**: SEA → LHR, budget $200, user has 120k Chase UR.

| Option | Type | OOP | CPP | Miles | Surcharge |
|--------|------|-----|-----|-------|-----------|
| A | Cash | $850 | — | — | — |
| B | UA Award (nonstop) | $45 | 1.61¢ | 50k | $45 |
| C | BA Award (1-stop) | $310 | 0.72¢ | 75k | $310 |
| D | VS Award (nonstop) | $120 | 1.22¢ | 60k | $120 |

Best cash price = $850. Budget $200 → ratio = 200/850 = 0.24 → **Critical tier**.

- At Normal tier: Only B and D pass the 1.1¢ CPP floor. B costs $45 OOP (within budget). **B wins.**
- But what if B is unavailable (no saver space)?
  - At Normal: D ($120 OOP, 1.22¢) passes. **D wins.**
  - If D is also unavailable, C at 0.72¢ is below the 1.1¢ floor — **blocked**.
  - Escalation to Critical: C's 0.72¢ is now allowed. $310 OOP exceeds $200 budget → still infeasible.
  - Final fallback: remove budget constraint, pick cheapest OOP with any CPP → **D or C depending on availability**.

The system prefers B > D > C > A, progressively accepting worse CPP to stay closer to budget.

---

## 7. Identified Improvements

### 7.1 Ground Transfer Awareness in the Objective (High Impact)

**Current state**: The `INTER_AIRPORT_TRANSFERS` dictionary exists in `orchestrator.py` with costs and times for inter-airport transfers (e.g., CDG↔ORY: $50, 90 min), but this data is **not** consumed by the ILP solver. The airport continuity constraint only prevents *different* airports on consecutive legs — it doesn't account for the user's location relative to each airport.

**Problem**: For a round-trip NYC → Paris → NYC, the solver might choose JFK outbound and JFK inbound purely on flight cost, even if the user lives near EWR and would pay $80 + 90 minutes each way to get to JFK.

**Improvement**: Add a per-airport "ground access cost" parameter to the optimization. This could be:
- A configurable constant per airport (e.g., user specifies "home airport" preference)
- A soft penalty derived from `INTER_AIRPORT_TRANSFERS` when the airport differs from the user's preferred one
- Added to the generalized cost: `ground_cost[airport] × x_f[leg, edge]`

### 7.2 Cross-Airport Award Arbitrage (Medium Impact)

**Current state**: The system searches each airport pair independently. A flight SEA→CDG might have great United award space, while SEA→ORY might have better Air France award space — but the system doesn't strategically choose the airport *because* of the award program availability.

**Problem**: The pruning step groups by `(leg, origin, destination)`, so JFK and EWR flights are never directly compared during pruning. A mediocre JFK flight survives pruning in its group, while a great EWR flight also survives in its group. Both enter the solver, which handles it correctly — but if pruning is too aggressive (small K), the best cross-airport option might be pruned away. With metro expansion now adding more airport pairs, this risk increases slightly.

**Improvement**:
- Add a cross-airport pruning pass that compares the best candidates across all airports for the same city, ensuring the globally best options survive regardless of airport
- Alternatively, increase K for multi-airport cities to compensate

### 7.3 Differentiated Airport Scoring (Medium Impact)

**Current state**: All airports within a metro area are treated identically beyond flight-level attributes. The solver doesn't know that LHR has better lounge access than STN, or that HND is more convenient than NRT for Tokyo city center.

**Improvement**: Add airport-level quality scores or convenience bonuses:
- Hub airports (where the operating airline has a hub) could get a small bonus for better connection reliability
- City-center proximity could be encoded as a time penalty
- This would especially help in cities like London (LHR vs. STN is a massive convenience gap) and Tokyo (HND vs. NRT)

### 7.4 Pruning Group Key Includes City, Not Just Airport (Low-Medium Impact)

**Current state**: Pruning groups by `(leg_id, origin_airport, destination_airport, date)`. This means each airport pair has its own independent quota.

**Problem**: If a city has 4 airports (e.g., LA: LAX, BUR, SNA, ONT), and `max_total_per_od = 20`, the solver could receive up to 80 candidates for a single leg (20 per airport pair). With metro expansion now adding more destination airports automatically, this problem is amplified — selecting "LAX" now produces candidates for LAX, BUR, SNA, and ONT.

**Improvement**: Add an additional cap at the city-pair level. After per-airport pruning, run a second pass that compares the survivors across all airport pairs for the same city pair and enforces a city-level cap (e.g., 30 total for all NYC airports combined). This keeps the ILP tractable while preserving the best options.

### 7.5 Transfer Bonus-Aware Search Ordering (Medium Impact)

**Current state**: Award search queries are dispatched for a fixed set of programs (`["UA", "AA", "DL", "BA", "AF", "VS", "AV", "AC", "AS"]`) regardless of the user's point balances or active transfer bonuses. The greedy solver and ILP solver now both consume bonus data, but the *search layer* does not.

**Problem**: If a user has 100k Capital One and there's an active 30% bonus to ANA, the system should prioritize searching NH (ANA) award space and NRT routes. Currently, NH may not even be in the default search list.

**Improvement**:
- Rank search programs by expected utility: `user_balance × transfer_ratio × bonus × historical_CPP`
- Search higher-utility programs first or with higher priority
- For users with no points in a given program and no transfer path, skip the search entirely to reduce API calls and latency
- Dynamically add programs to the search list when a transfer bonus makes them particularly attractive

### 7.6 Airport Continuity Constraint Relaxation with Transfer Costing (Low Impact)

**Current state**: Airport continuity is a **hard** constraint — you cannot arrive at ORY and depart from CDG. This eliminates potentially great options where the user might happily pay $50 and 90 minutes for a ground transfer.

**Improvement**: Convert the hard constraint to a soft constraint by introducing the inter-airport transfer cost into the objective:
- If arriving at ORY and departing CDG, add $50 + time_penalty(90 min) to the generalized cost
- The solver can then decide: is the ORY inbound + CDG outbound combination good enough to justify the $50 + 90-minute transfer?
- This requires new binary variables for inter-airport transfers but the `INTER_AIRPORT_TRANSFERS` data already exists

### 7.7 Duplicate Metro Mapping Consolidation (Low Impact, Code Quality)

**Current state**: `METRO_AIRPORTS` is defined in both `orchestrator.py` and `itinerary_service.py` with overlapping but potentially divergent entries. The new `_expand_to_metro()` function only uses the `orchestrator.py` copy.

**Improvement**: Consolidate into a single source of truth (e.g., `programs.yml` or a dedicated `airports.yml`), imported by all consumers. This prevents drift and makes it easier to add new cities.

### 7.8 Cabin Class Differentiation Across Airports (Medium Impact)

**Current state**: The system doesn't appear to factor in that award availability and pricing vary dramatically by cabin class at different airports. For instance, NRT might have ANA business class saver awards while HND only has economy.

**Improvement**: When the user targets a specific cabin class, weight the search and pruning toward airports that historically have better availability in that cabin. This could be a heuristic (e.g., prefer hub airports for business/first) or data-driven from historical award searches. This is especially relevant now that metro expansion surfaces both NRT and HND — the system should recognize that the two airports may have vastly different award inventories.

### 7.9 Expose the CPP/OOP Trade-Off to Users (High Impact)

**Current state**: The tier relaxation happens silently. The user sees a result but doesn't know the CPP was sacrificed for budget compliance. The `solo.py` route surfaces rejected alternatives (cheapest option, best CPP option) but doesn't explain *why* a lower-CPP option was chosen when budget was the driver.

**Improvement**: Surface a clear explanation like: *"We used your points at 0.85¢/pt (below the usual 1.1¢ target) to keep you within your $300 budget. The best-value option (1.6¢/pt) would have cost $420 out of pocket."*

### 7.10 User-Configurable CPP Floor (Medium Impact)

Some users are "points maximizers" who'd rather pay more cash than waste points at low CPP. Others just want the cheapest trip. Currently, the CPP floor is hardcoded per tier.

**Improvement**: Let users set a personal CPP floor preference (e.g., "never use my points below 1.5¢/pt"). The budget tier system would still override it when the budget literally cannot be met otherwise, but it respects the user's preference whenever possible.

### 7.11 "What-If" Budget Comparison (Low-Medium Impact)

Users often don't know what budget to set. A budget of $200 might force terrible redemptions while $350 would unlock excellent ones.

**Improvement**: Run the optimizer at 2-3 budget points (e.g., user's budget, 1.5× budget, no budget) and present the trade-off: *"At $200 budget: 0.8¢/pt avg. At $350 budget: 1.5¢/pt avg. Increasing budget by $150 would save 40k points."*

### 7.12 Per-Leg CPP Breakdown for Multi-Leg Trips (Medium Impact)

On multi-leg trips, the ILP optimizes globally. This means one leg might get a great 2.0¢ redemption while another gets a poor 0.7¢ redemption, averaging to 1.35¢. The user sees the average but not the per-leg breakdown.

**Improvement**: Show per-leg CPP in the results and flag any leg where CPP is below the floor that would apply in isolation. This helps users understand *where* value was sacrificed and potentially request a cash override for that specific leg.

---

## 8. Summary

The current system handles multi-airport cities through a combination of asymmetric metro expansion (origins stay specific, destinations expand to full metro groups), multi-criteria pruning, and ILP optimization where all airport variants compete on generalized cost. Transfer bonuses are now fully integrated into both the ILP solver (via `TransferPath.current_bonus`) and the greedy fallback (via `_bonus_multiplier()`), reducing the need for CPP sacrifice when promotions are active.

The CPP-vs-OOP trade-off is managed through an adaptive budget tier system that progressively relaxes quality guardrails (CPP floor: 1.1¢ → 0.95¢ → 0.80¢ → 0.0¢) as the budget gets tighter, following the principle that staying within budget always trumps redemption quality.

**Primary remaining gaps:**

1. **No user-side ground access cost** — the solver doesn't know which airport is convenient for the user
2. **Hard airport continuity** — prevents potentially beneficial cross-airport transfers
3. **No cross-airport pruning awareness** — the pruning step doesn't guarantee the globally best options survive across airports, amplified by metro expansion
4. **Silent CPP sacrifice** — users aren't told when/why redemption quality was lowered for budget compliance
5. **Search layer ignores bonuses** — bonus-aware routing only kicks in at the optimization stage, not at the search stage where program selection happens
6. **No user-configurable CPP floor** — the system decides the CPP threshold, not the user

The highest-impact improvements are **7.1 (ground transfer awareness)** for airport selection, **7.5 (bonus-aware search ordering)** for surfacing the right award options, and **7.9 (exposing the CPP/OOP trade-off)** for user trust.
