# Multi-Currency Points & Budget Constraint System

## Table of Contents

**Part 1 — System Overview**
1. [Multi-Currency Architecture](#1-multi-currency-architecture)
2. [Currency Classification & Normalization](#2-currency-classification--normalization)
3. [The Transfer Graph: How Bank Points Become Airline Miles](#3-the-transfer-graph-how-bank-points-become-airline-miles)
4. [Multi-Payer Support](#4-multi-payer-support)
5. [How Budget Constrains Points Spending](#5-how-budget-constrains-points-spending)
6. [Adaptive Budget Tiers: The Core Mechanism](#6-adaptive-budget-tiers-the-core-mechanism)

**Part 2 — Bug Analysis & Implementation Plan**
7. [Root Cause Analysis: Why Only 1 Currency Works](#7-root-cause-analysis-why-only-1-currency-works)
8. [Root Cause Analysis: Why Budget Isn't the Ultimate Driver](#8-root-cause-analysis-why-budget-isnt-the-ultimate-driver)
9. [Implementation Plan: Multi-Currency Fixes](#9-implementation-plan-multi-currency-fixes)
10. [Implementation Plan: Budget as Ultimate Driver](#10-implementation-plan-budget-as-ultimate-driver)
11. [Implementation Plan: Multi-Payer Fixes](#11-implementation-plan-multi-payer-fixes)
12. [Implementation Sequence & Dependencies](#12-implementation-sequence--dependencies)
13. [Required Test Cases](#13-required-test-cases)
14. [Required Logging & Telemetry](#14-required-logging--telemetry)

---

# Part 1 — System Overview

## 1. Multi-Currency Architecture

The system supports an arbitrary mix of credit card currencies submitted simultaneously. A user can provide balances from multiple programs, and the optimizer will combine them to find the best overall booking strategy.

### Supported Currency Categories

| Category | Programs | Key Trait |
|---|---|---|
| **Transferable bank points** | Chase UR, Amex MR, Citi TYP, Capital One, Bilt | Can transfer 1:1 to airline/hotel partners |
| **Fixed-value bank points** | Bank of America, Wells Fargo, Discover, US Bank | Redeemable at fixed cpp via travel portal only |
| **Airline miles** | United, American, Delta, Southwest, JetBlue, Alaska, British Airways, Virgin Atlantic, Air France/KLM, Singapore, ANA, and more | Used directly for award bookings |
| **Hotel points** | Marriott, Hilton, Hyatt, IHG | Used for hotel award bookings |

These are defined in the `PointsProgram` enum (`backend/src/schemas/programs.py`) and the `CurrencyBalance` schema (`backend/src/schemas/optimize.py`).

### How Currencies Are Submitted

The `OptimizeSoloRequest` schema accepts currencies through the `points` dictionary:

```python
# Example: user has Chase, Amex, and direct United miles
{
    "trip_id": "abc123",
    "points": {
        "chase_ur": 100000,    # Bank points - can transfer to 15+ airline partners
        "amex_mr": 75000,      # Bank points - different set of transfer partners
        "UA": 25000            # Direct United miles
    }
}
```

Optional controls allow fine-grained currency management:

- **`allowed_currencies`**: Whitelist — only use these currencies (e.g., `["chase_ur", "UA"]`)
- **`max_points_by_currency`**: Per-currency caps (e.g., `{"chase_ur": 50000}` to limit Chase usage)
- **`currency_balances`**: Structured format with metadata per currency (enabled flag, max-to-use cap, display names)
- **`max_cash_budget`**: Maximum cash out-of-pocket across the entire trip

---

## 2. Currency Classification & Normalization

When a request arrives, the adapter layer (`backend/src/optimization/adapter_v3.py`) classifies each currency entry through the `_classify_points()` function. This is the critical routing step that determines how each currency can be used.

### Classification Logic

```
Input: {"chase_ur": 100000, "amex_mr": 75000, "UA": 25000, "wells_fargo": 20000}

Step 1: Normalize keys
  "chase_ur"     → bank key "chase"
  "amex_mr"      → bank key "amex"
  "UA"           → program key "united"
  "wells_fargo"  → bank key "wells_fargo"

Step 2: Route to category
  "chase"        → transferable bank    → bank_balances["chase"] = 100,000
  "amex"         → transferable bank    → bank_balances["amex"] = 75,000
  "united"       → airline program      → points_balances["united"] = 25,000
  "wells_fargo"  → fixed-value bank     → treated as cash offset ($200 at 1.0 cpp)
```

The five transferable banks are: **Chase, Amex, Citi, Capital One, and Bilt**. These are the only banks whose points can be transferred to airline/hotel partners.

Fixed-value banks (Bank of America, Wells Fargo, Discover, US Bank) have a fixed cents-per-point value when redeemed through their travel portal. They cannot transfer to airline partners, so the system treats them as a cash offset rather than flexible points.

---

## 3. The Transfer Graph: How Bank Points Become Airline Miles

The transfer graph (`backend/src/optimization/constants.py` and `backend/src/handlers/transfer_strategy.py`) is the core data structure that enables multi-currency optimization. It defines which bank can transfer to which airline/hotel program, and at what ratio.

### Transfer Partner Matrix

| Bank | Airline Partners |
|---|---|
| **Chase UR** | United, British Airways, Air France/KLM, Iberia, Singapore, Virgin Atlantic, Aer Lingus, Emirates, Air Canada, Avianca, Southwest, Alaska + Hyatt, Marriott, IHG |
| **Amex MR** | Delta, JetBlue, British Airways, Air France/KLM, Iberia, Singapore, Cathay Pacific, ANA, Virgin Atlantic, Emirates, Etihad, Qantas, Avianca, Alaska, Air Canada, JAL + Hilton, Marriott |
| **Citi TYP** | American, JetBlue, Turkish, Singapore, Cathay Pacific, Qatar, Virgin Atlantic, Etihad, Emirates, Air France/KLM, Qantas, Air Canada, Avianca, JAL |
| **Capital One** | Air Canada, Air France/KLM, British Airways, Emirates, Etihad, Finnair, Singapore, Turkish, Avianca, Qantas, TAP |
| **Bilt** | United, American, British Airways, Air France/KLM, Turkish, Virgin Atlantic, Aer Lingus, Emirates, Air Canada, Alaska + Hyatt, IHG |

All standard transfers are at a 1:1 ratio. The system also models transfer bonuses via the `TransferPath.current_bonus` field (e.g., 1.25 for a 25% promotional bonus).

### How the Optimizer Uses the Graph

When the solver evaluates an award flight on, say, Air France/KLM Flying Blue, it considers all possible funding sources:

1. **Native**: User has Flying Blue miles directly → use them
2. **Transfer from Chase**: Chase UR → Flying Blue at 1:1
3. **Transfer from Amex**: Amex MR → Flying Blue at 1:1
4. **Transfer from Citi**: Citi TYP → Flying Blue at 1:1
5. **Transfer from Capital One**: Capital One → Flying Blue at 1:1
6. **Transfer from Bilt**: Bilt → Flying Blue at 1:1

The solver models each path as a `FundingSource` object with a unique `source_id`. It then uses integer linear programming (ILP) to select the optimal combination across all segments, respecting balance limits and transfer block sizes (typically 1,000-point increments).

---

## 4. Multi-Payer Support

The system supports multiple people contributing points to a single trip via the `payer_points` field:

```python
{
    "payer_points": {
        "alice": {"amex_mr": 50000, "UA": 10000},
        "bob": {"chase_ur": 80000, "amex_mr": 30000}
    }
}
```

When `payer_points` is provided, the system creates a separate `Traveler` object per payer. Each traveler has their own `bank_balances` and `points_balances`. Points are **not** pooled between payers — Alice's Amex points and Bob's Amex points are tracked separately throughout the ILP solver.

---

## 5. How Budget Constrains Points Spending

The budget is intended to be the most important constraint in the system. It forces the optimizer to spend points more aggressively to keep the user's cash out-of-pocket within their limit.

### Budget as a Hard Constraint

In the ILP solver (`backend/src/optimization/solver_v3.py`), the budget is added as a hard constraint:

```
total_flight_cash + total_surcharges <= cash_budget
```

### The Budget Flow

```
User sets budget → API extracts from trip data → Passed to solver as cash_budget
                                                                    ↓
                                              Solver enforces: total_oop <= budget
                                                                    ↓
                                              Points MUST be used to fill the gap
```

---

## 6. Adaptive Budget Tiers: The Core Mechanism

The system computes a tightness ratio `r = budget / best_cash_price` and applies guardrails accordingly:

| Tier | Ratio (r) | CPP Floor | Max Miles/$ Saved | Behavior |
|---|---|---|---|---|
| **Normal** | r >= 1.0 | 1.1 cents | 140 | Full guardrails. Budget covers cash. |
| **Tight** | 0.60 <= r < 1.0 | 0.95 cents | 180 | Must use some points. Relax CPP. |
| **Very Tight** | 0.30 <= r < 0.60 | 0.80 cents | 250 | Heavy points usage. Relax further. |
| **Critical** | r < 0.30 | 0.0 cents | Infinity | No CPP restrictions. |

---

# Part 2 — Bug Analysis & Implementation Plan

## 7. Root Cause Analysis: Why Only 1 Currency Works

The ILP solver's variable design (`solver_v3.py`) is actually multi-currency capable. The `y_pf` variable uses a 5-tuple key `(leg_id, edge_id, option_id, payer, source_id)` and the "choose exactly one payment" constraint is per-flight, not per-trip. **The solver can use different currencies for different legs.** The bugs are upstream.

### BUG 1 (ROOT CAUSE): Award enrichment keeps only 1 program per flight

**File**: `backend/src/optimization/adapter_v3.py`, lines 1966–1983

When AwardTool placeholder flights are filtered out and their award pricing is attached to validated SerpAPI flights, the code keeps only the **single cheapest** award option:

```python
# Lines 1966-1983 — THE ROOT CAUSE
best_option = None
best_points = float('inf')

for match_airline in matching_airlines:
    key = (leg_id, match_airline)
    if key in award_options_by_leg_airline:
        for opt in award_options_by_leg_airline[key]:
            if opt.miles_required and opt.miles_required < best_points:
                best_option = opt          # ← overwrites, keeps only cheapest
                best_points = opt.miles_required

if best_option:
    new_opt = deepcopy(best_option)
    new_opt.option_id = f"{flight.edge_id}_{best_option.program}"
    flight.award_options = [new_opt]       # ← ONLY ONE award option attached!
```

**Why this kills multi-currency**: Suppose a United flight has awards available via:
- United MileagePlus: 35,000 pts (cheapest)
- ANA Mileage Club: 40,000 pts (partner award)

The enrichment picks United at 35k and discards the ANA option. In the solver, `FundingSource` objects are only created for programs that appear in `f.award_options`. Since only United appears, funding sources are `chase→united`, `bilt→united`. A user with **Amex** (which transfers to ANA but NOT United) has zero usable sources for this flight. Their Amex balance is completely invisible to the solver.

The solver's variable creation loop (`solver_v3.py:664-716`) iterates `for opt in f.award_options` — it's designed for multiple options per flight. The adapter just never provides them.

### BUG 2 (COMPOUND): Placeholder enrichment uses airline-only matching — false positive attachment risk

**File**: `backend/src/optimization/adapter_v3.py`, lines 1930–1963

Each `FlightOption` from AwardTool search results has exactly one `opt.award_program`. When AwardTool returns multiple program options for the same route (e.g., United direct award AND Turkish partner award), they become **separate** `FlightItineraryEdge` placeholder objects. After validation filters out these placeholders, their award options are collected into `award_options_by_leg_airline` keyed by `(leg_id, airline_code)`.

The enrichment then matches these options to validated SerpAPI flights using `AIRLINE_ALLIANCES` — so a DL flight can receive an AF award option because both are SkyTeam. This is too coarse: the AF award may have been priced for a connecting routing through Paris, but it's being attached to a DL direct flight. The pricing doesn't correspond to the flight.

**Current matching key**: `(leg_id, airline_code)` via `AIRLINE_ALLIANCES` (line 1963)

**What's needed**: Tighter matching that includes route shape. See Fix 1, Sub-fix 1c for the implementation. At minimum: `(leg_id, marketing_carrier, origin, destination)`. Fall back to alliance matching only if tight matching produces zero results, and log a warning when doing so.

### BUG 3 (DATA LOSS): Dict overwrite in `_classify_points`

**File**: `backend/src/optimization/adapter_v3.py`, lines 278–291

```python
# Line 279 — assignment, not accumulation
bank_balances[bank_normalized] = effective_balance
# Line 290 — same problem
points_balances[normalized] = effective_balance
```

If two keys in the user's `points` dict normalize to the same canonical key (e.g., `"amex_mr"` and `"MR"` both → `"amex"`), the second overwrites the first. The first entry's balance is silently lost.

**How likely**: Low for single-payer (users rarely submit duplicate aliases), but a real risk if frontend sends both raw and normalized keys.

### BUG 4 (CRITICAL FOR MULTI-PAYER): Hardcoded `traveler_ids=["user"]`

**File**: `backend/src/optimization/adapter_v3.py`, line 478

```python
traveler_ids=["user"],   # ← hardcoded, should use actual payer IDs
```

In multi-payer mode, `convert_trip_to_spec` creates travelers with IDs like `"alice"` and `"bob"`, but `_build_legs_and_segments` hardcodes `traveler_ids=["user"]` for every leg. The spec validation catches the mismatch (`"user"` is not a known traveler) and the adapter **silently returns empty results** (line 1713-1716). The ILP solver is **never invoked** for multi-payer trips, and the system falls back to the greedy solver — which lacks the sophisticated ILP multi-currency optimization.

### BUG 5 (GREEDY FALLBACK): Currency restrictions dropped on fallback

**File**: `backend/src/agents/orchestrator.py`, lines 1876–1883

When the V3 solver returns empty results (e.g., due to Bug 4) and falls back to greedy:

```python
# Lines 1876-1883 — Fallback drops currency constraints
return await self._run_greedy_optimization(
    segments=segments,
    search_results=search_results,
    user_points=user_points,
    budget=budget,
    trip_data=trip_data,
    payer_points=payer_points,
    # ← MISSING: allowed_currencies, max_points_by_currency, max_cash_budget
)
```

`allowed_currencies`, `max_points_by_currency`, and `max_cash_budget` are silently dropped. Any per-currency caps or restrictions the user set are ignored in the fallback path.

### BUG 6 (GREEDY): First-match-wins prevents cross-currency comparison

**File**: `backend/src/agents/orchestrator.py`, lines 2195–2219

The greedy `_pick_best_flight_option` returns on the **first** option that passes thresholds and is affordable. It never compares "use Chase UR for a UA award" vs "use Amex MR for a DL award" for the same route. The order of the `options` list (sorted by `cash_price`) determines which currency gets consumed. This is implicit single-currency-per-segment selection by accident of ordering.

---

## 8. Root Cause Analysis: Why Budget Isn't the Ultimate Driver

### ISSUE 1: CPP guardrails reject award options BEFORE the solver sees them

**File**: `backend/src/optimization/solver_v3.py`, lines 685–703

```python
# Guard 1: CPP Floor — option rejected, y_pf variable never created
if cpp_floor > 0 and opt.miles_required > 0:
    if actual_cpp < cpp_floor:
        rejected_count += 1
        continue  # ← solver can never use this option

# Guard 2: Miles Per Dollar Saved — same
if miles_per_dollar > max_miles_per_dollar and opt.miles_required > 0:
    rejected_count += 1
    continue
```

These guards run BEFORE ILP variables are created. If the budget is tight but the adaptive tier hasn't relaxed enough (or the tier calculation uses a noisy `best_cash_price`), viable award options get rejected. The solver literally cannot see them. This causes infeasibility → tier escalation → potentially removing the budget constraint entirely.

**Why this fights the budget**: The solver's **objective** (minimize OOP) naturally prefers points when they save cash. CPP floors are an extra layer that blocks the solver from doing what its objective already wants to do. When budgets are tight, the floor serves no purpose — the user explicitly wants to spend points. The floor fights that intent.

### ISSUE 2: Fallback removes budget constraint entirely

**File**: `backend/src/optimization/solver_v3.py`, fallback logic

If the solver is infeasible at all four tiers (normal → tight → very tight → critical), the budget hard constraint is removed entirely. The result includes a warning, but the returned plan may spend far more cash than the user budgeted. This directly contradicts "budget is the ultimate driver."

### ISSUE 3: `best_cash_price` is unstable, making tier selection noisy

The budget tier is determined by `r = budget / best_cash_price`. But `best_cash_price` is the cheapest all-cash option found by the flight searcher, which depends on:
- Search timing (prices change by the minute)
- Which carriers were searched
- Filters applied (cabin class, stops, etc.)
- Availability at search time

If `best_cash_price` shifts between $800 and $1,200 across searches, the same $600 budget could land in "tight" (r=0.75) or "very tight" (r=0.50), causing wildly different CPP floors and therefore different results.

### ISSUE 4: Greedy `budget_is_tight` is binary, not proportional

**File**: `backend/src/agents/orchestrator.py`, line 1930–1932

```python
budget_is_tight = budget > 0 and budget < NO_BUDGET_LIMIT
```

Any real budget — even $100,000 for a $500 flight — triggers `prefer_points=True` and `force_points=True`. There is no gradient. A user who sets a generous $5,000 budget for a $400 trip gets the same aggressive points behavior as someone with a $200 budget for a $2,000 trip.

---

## 9. Implementation Plan: Multi-Currency Fixes

### Fix 1 (P0 — Root Cause): Attach ALL award options per flight with Pareto-optimal selection

**File**: `backend/src/optimization/adapter_v3.py`, lines 1966–1983

**Current**: Keeps only the single cheapest award option across all programs.

**Change**: Collect all award options, keep a Pareto frontier per program (lowest miles + lowest surcharge), deduplicate with stable composite `option_id`s, sort deterministically, and cap total options per flight.

#### Sub-fix 1a: Pareto frontier per program (not just cheapest miles)

Keeping only "cheapest miles per program" blocks the best OOP option in many cases:

- Program A: 35,000 pts + $450 surcharge
- Program B: 45,000 pts + $60 surcharge

Under a tight budget, Program B is vastly better for OOP. If we keep only "cheapest miles," we might keep A and discard a cheaper-surcharge variant of the same program.

**Rule**: For each program, keep up to **2 options**: one with lowest miles, one with lowest surcharge. If they're the same option, keep just one.

#### Sub-fix 1b: Stable, unique, collision-proof `option_id`

The current `option_id = f"{flight.edge_id}_{opt.program}"` collides if there are multiple award options for the same program (different cabins, different surcharges). Downstream code that uses `option_id` as a dict key will silently overwrite.

**Exact format specification**:

```python
def make_option_id(edge_id: str, opt: AwardOption) -> str:
    """
    Stable, unique option_id for ILP variable naming and dict keys.
    
    Format: "{edge_id}:{program}:{cabin}:{miles}:{surcharge_cents}"
    
    Rules:
    - surcharge is normalized to integer cents (avoid float drift)
    - cabin is lowercased and stripped
    - if total length > 80 chars, keep first 40 chars of edge_id 
      + sha1 hash of the full string (truncated to 12 hex chars)
    - all colons in component values are replaced with '_' to avoid 
      delimiter collision
    """
    program = (opt.program or "unknown").replace(":", "_")
    cabin = (opt.cabin_or_room_type or "economy").lower().strip().replace(":", "_")
    surcharge_cents = int(round(opt.surcharge * 100))
    
    raw_id = f"{edge_id}:{program}:{cabin}:{opt.miles_required}:{surcharge_cents}"
    
    if len(raw_id) <= 80:
        return raw_id
    
    # Hash for stability when ID is too long
    import hashlib
    hash_suffix = hashlib.sha1(raw_id.encode()).hexdigest()[:12]
    return f"{edge_id[:40]}:{hash_suffix}"
```

**Invariant**: Two `option_id`s are equal if and only if they represent the same program, cabin, miles, and surcharge for the same flight edge. This is correct deduplication — identical options should share an ID.

#### Sub-fix 1c: Tighten matching keys with a concrete flight fingerprint function

The current matching uses `(leg_id, airline_code)` via `AIRLINE_ALLIANCES`. This is too coarse — it can attach an AF award (Paris hub, connecting) to a DL direct flight on the same leg just because DL and AF are SkyTeam partners. The award option was priced for a completely different routing.

**Rule**: Build a deterministic fingerprint using only fields reliably present on both placeholder edges (AwardTool) and validated edges (SerpAPI).

**Fingerprint function spec** (add to `adapter_v3.py`):

```python
def make_flight_fingerprint(edge: FlightItineraryEdge) -> tuple:
    """
    Deterministic fingerprint for matching award options to validated flights.
    Uses only fields that exist on BOTH placeholder and validated edges.
    
    Fields used (all reliably present):
    - leg_id: int — which leg this serves
    - origin: str — first departure airport (e.g., "SEA")
    - destination: str — final arrival airport (e.g., "CDG")
    - marketing_carrier: str — first segment's marketing carrier (e.g., "DL")
    - num_stops: int — 0 for direct, 1+ for connections
    - departure_bucket: str — departure time bucketed to 60-min windows
      (e.g., "2025-07-15T14" for any departure between 14:00-14:59)
    
    NOT included (unreliable on placeholders):
    - flight_number (placeholders use fake numbers like "AW001")
    - arrival_time (often missing on award tool results)
    - cabin (sometimes missing or inconsistent)
    """
    carrier = ""
    if edge.segments:
        carrier = (edge.segments[0].marketing_carrier or "").upper()[:2]
    
    dep_bucket = ""
    if edge.departure_datetime:
        dep_bucket = edge.departure_datetime.strftime("%Y-%m-%dT%H")
    
    return (
        edge.leg_id,
        (edge.origin or "").upper(),
        (edge.destination or "").upper(),
        carrier,
        edge.num_stops,
        dep_bucket,
    )
```

**Matching strategy** (two-tier with explicit fallback):

```python
# Tier 1: Build award_options_by_fingerprint from placeholder edges
award_options_by_fingerprint = {}  # fingerprint -> List[AwardOption]
for placeholder in placeholder_edges:
    fp = make_flight_fingerprint(placeholder)
    award_options_by_fingerprint.setdefault(fp, []).extend(placeholder.award_options)

# Tier 2: For each validated flight, try fingerprint match first
for flight in validated_flights:
    if flight.award_options:
        continue
    
    fp = make_flight_fingerprint(flight)
    if fp in award_options_by_fingerprint:
        candidates = award_options_by_fingerprint[fp]
        match_method = "fingerprint"
    else:
        # Fallback: alliance matching (current behavior)
        candidates = _collect_alliance_candidates(flight, award_options_by_leg_airline)
        match_method = "alliance_fallback"
        if candidates:
            logger.warning(
                f"[V3 Adapter] No fingerprint match for {flight.edge_id}. "
                f"Using alliance fallback ({len(candidates)} candidates). "
                f"Award pricing may not exactly correspond to this flight."
            )
    
    # ... proceed to Pareto selection (Sub-fix 1a) ...
```

**Why these specific fields**: `leg_id` + `origin` + `destination` ensure same route. `marketing_carrier` prevents cross-airline attachment. `num_stops` prevents attaching a connecting award price to a direct flight (or vice versa). `departure_bucket` (60-min window) prevents attaching a morning flight's pricing to an evening flight.

**What's deliberately excluded**: `flight_number` (fake on placeholders), `arrival_time` (often missing), `cabin` (inconsistent naming). These would cause false negatives (zero matches) and force excessive fallback to alliance matching.

#### Sub-fix 1d: Deterministic ordering + cap

Sort collected options by `(program, miles_required, surcharge)` before attaching. This ensures stable results across runs. Cap at **MAX_AWARD_OPTIONS_PER_FLIGHT = 8** (configurable) after the Pareto selection. If a flight has options from 10+ programs, keep the top 8 by effective OOP (surcharge as primary sort, then miles).

#### Combined implementation

```python
# BEFORE (lines 1966-1983):
best_option = None
best_points = float('inf')
for match_airline in matching_airlines:
    key = (leg_id, match_airline)
    if key in award_options_by_leg_airline:
        for opt in award_options_by_leg_airline[key]:
            if opt.miles_required and opt.miles_required < best_points:
                best_option = opt
                best_points = opt.miles_required
if best_option:
    new_opt = deepcopy(best_option)
    new_opt.option_id = f"{flight.edge_id}_{best_option.program}"
    flight.award_options = [new_opt]

# AFTER:
MAX_AWARD_OPTIONS_PER_FLIGHT = 8

# Step 1: Collect all candidates via matching keys
all_candidates = []

# Try tight matching first: (leg_id, carrier, origin, dest)
flight_origin = flight.origin
flight_dest = flight.destination
tight_key = (leg_id, airline, flight_origin, flight_dest)
# ... collect from tight keys, then fall back to alliance matching
# (full implementation uses a helper function)

for match_airline in matching_airlines:
    key = (leg_id, match_airline)
    if key in award_options_by_leg_airline:
        for opt in award_options_by_leg_airline[key]:
            if opt.miles_required and opt.miles_required > 0:
                all_candidates.append(opt)

# Step 2: Pareto frontier per program — keep (lowest miles) + (lowest surcharge)
pareto_by_program = {}  # program -> list of kept options
for opt in all_candidates:
    prog = opt.program
    if prog not in pareto_by_program:
        pareto_by_program[prog] = {"best_miles": opt, "best_surcharge": opt}
    else:
        entry = pareto_by_program[prog]
        if opt.miles_required < entry["best_miles"].miles_required:
            entry["best_miles"] = opt
        if opt.surcharge < entry["best_surcharge"].surcharge:
            entry["best_surcharge"] = opt

# Step 3: Flatten Pareto set (deduplicate identical options)
pareto_options = []
seen_fingerprints = set()
for prog, entry in pareto_by_program.items():
    for opt in [entry["best_miles"], entry["best_surcharge"]]:
        fp = (opt.program, opt.miles_required, int(opt.surcharge),
              opt.cabin_or_room_type)
        if fp not in seen_fingerprints:
            seen_fingerprints.add(fp)
            pareto_options.append(opt)

# Step 4: Sort deterministically, then cap
pareto_options.sort(key=lambda o: (o.surcharge, o.miles_required, o.program))
pareto_options = pareto_options[:MAX_AWARD_OPTIONS_PER_FLIGHT]

# Step 5: Attach with stable, unique option_ids
if pareto_options:
    flight.award_options = []
    for opt in pareto_options:
        new_opt = deepcopy(opt)
        new_opt.option_id = (
            f"{flight.edge_id}:{opt.program}:"
            f"{opt.cabin_or_room_type}:{opt.miles_required}:{int(opt.surcharge)}"
        )
        flight.award_options.append(new_opt)
    flights_enriched += 1
```

**Impact**: The solver now sees award options across multiple programs AND multiple surcharge/miles trade-offs per program. It can route Chase→United, Amex→ANA, etc. This is the single most impactful fix.

**Risks & mitigations**:

| Risk | Mitigation |
|---|---|
| More options per flight → ILP variable explosion | `MAX_AWARD_OPTIONS_PER_FLIGHT = 8` cap. Profile solver time before/after. With 20 flights × 8 options × 5 funding sources = 800 `y_pf` vars — still tractable for PuLP. |
| Tighter matching key misses valid awards | Fallback to alliance matching if tight match produces zero results. Log which fallback was used. |
| Non-deterministic option ordering causes flapping results | Deterministic sort on `(surcharge, miles, program)` before cap. |
| `option_id` collision downstream | Composite key includes program + cabin + miles + surcharge. Collision requires identical options, which is correct dedup. |

**Test**: Submit `{"chase_ur": 100000, "amex_mr": 80000}` for a route where Chase partners (United) and Amex partners (Delta, ANA) both have awards. Verify both currencies are used across segments.

---

### Fix 2 (P0): Fix dict overwrite in `_classify_points` — use `max()` for alias collisions, not `sum()`

**File**: `backend/src/optimization/adapter_v3.py`, lines 278–291

**Why not `sum()`**: If the frontend accidentally sends both raw and normalized keys for the *same* balance (e.g., `"amex_mr": 50000` and `"amex": 50000` representing the same Amex account), summing would inflate the balance to 100,000 — making plans infeasible to execute in real life. Two keys that normalize to the same canonical key almost always represent the **same underlying account** submitted with different aliases, not two separate accounts with additive balances.

**Rule**: When two inputs normalize to the same canonical key within the same payer, treat as **alias collision** → take `max()` and log a warning. If they genuinely have different balances, the higher one is the safer bet (the lower one may be stale).

```python
# BEFORE (line 279):
bank_balances[bank_normalized] = effective_balance

# AFTER:
if bank_normalized in bank_balances:
    old_val = bank_balances[bank_normalized]
    bank_balances[bank_normalized] = max(old_val, effective_balance)
    logger.warning(
        f"[V3 Adapter]{label} Alias collision: '{prog}' → '{bank_normalized}' "
        f"already has {old_val:,} pts. Taking max({old_val:,}, {effective_balance:,}) = "
        f"{bank_balances[bank_normalized]:,}. If these are separate accounts, "
        f"use payer_points with distinct payer IDs."
    )
else:
    bank_balances[bank_normalized] = effective_balance

# Same pattern for points_balances (line 290):
if normalized in points_balances:
    old_val = points_balances[normalized]
    points_balances[normalized] = max(old_val, effective_balance)
    logger.warning(
        f"[V3 Adapter]{label} Alias collision: '{prog}' → '{normalized}' "
        f"already has {old_val:,} pts. Taking max."
    )
else:
    points_balances[normalized] = effective_balance
```

**Edge case**: If a user truly has two separate Amex accounts (rare but possible), they should use `payer_points` with distinct payer IDs — that path creates separate Traveler objects and doesn't hit this collision.

**Interaction with input precedence** (see Fix 5): This `max()` logic applies within whichever input format wins the precedence rule (`currency_balances` > `payer_points` > `points`). If `currency_balances` is provided, `points` is ignored entirely — no cross-format collision is possible.

**Test**: Submit `{"amex_mr": 50000, "amex": 50000}`. Verify `bank_balances["amex"] == 50000` (max, not 100,000). Verify warning is logged.

---

### Fix 3 (P1): Forward currency constraints to greedy fallback

**File**: `backend/src/agents/orchestrator.py`, lines 1876–1883

**Change**: Pass all currency parameters to the greedy fallback.

```python
# BEFORE:
return await self._run_greedy_optimization(
    segments=segments,
    search_results=search_results,
    user_points=user_points,
    budget=budget,
    trip_data=trip_data,
    payer_points=payer_points,
)

# AFTER:
return await self._run_greedy_optimization(
    segments=segments,
    search_results=search_results,
    user_points=user_points,
    budget=budget,
    trip_data=trip_data,
    payer_points=payer_points,
    allowed_currencies=allowed_currencies,
    max_points_by_currency=max_points_by_currency,
    max_cash_budget=max_cash_budget,
)
```

Also update the `_run_greedy_optimization` method signature to accept and apply these parameters. At minimum, filter `user_points` by `allowed_currencies` and cap balances by `max_points_by_currency` before the greedy loop starts.

---

### Fix 4 (P2 — Deferred): Greedy optimizer — compare across currencies before selecting

> **Deferral rationale**: Once Phase 1 makes the ILP path reliable for both single-payer and multi-payer, the greedy fallback becomes rare (only triggered on ILP errors). Investing in full cross-currency comparison in the greedy path duplicates solver logic. **Only implement if monitoring shows > 20% of requests still hitting greedy after Phase 1.**

**File**: `backend/src/agents/orchestrator.py`, `_pick_best_flight_option`

**Current**: Returns the first affordable option (first-match-wins).

**Change (if implemented)**: Collect all viable options across all programs, then pick the one that minimizes OOP (or maximizes CPP, depending on mode).

```python
# BEFORE: return on first viable
for option in options:
    if option.award_available and passes_thresholds(option):
        if self._can_afford_points(option.award_program, option.award_points, remaining_points):
            return option

# AFTER: collect all viable, pick best
viable_awards = []
for option in options:
    if option.award_available and passes_thresholds(option):
        if self._can_afford_points(option.award_program, option.award_points, remaining_points):
            viable_awards.append(option)

if viable_awards:
    # Pick the one that saves the most cash (lowest surcharge) — for OOP mode
    return min(viable_awards, key=lambda o: (o.award_surcharge or 0))
```

**Important caveat**: Even with this fix, the greedy path is fundamentally limited — it processes segments sequentially with no backtracking. Points consumed on segment 1 are irreversibly gone for segment 2. The ILP solver doesn't have this limitation (it optimizes globally). This is another reason to prioritize ILP reliability over greedy sophistication.

---

### Fix 5 (P2): Canonical internal representation for currency balances

**Current**: Three parallel input formats (`points` dict, `currency_balances` list, `payer_points` nested dict) are handled by separate code paths. There is no defined precedence — if multiple formats are provided simultaneously, behavior is undefined.

**Input precedence rule** (must be enforced at the top of the optimization pipeline):

```
1. currency_balances (richest format — per-currency metadata, enabled flag, max_to_use)
   → If provided, this is the SOLE source of balance data. Ignore points and payer_points.

2. payer_points (multi-payer format — { payer_id: { program: balance } })
   → If provided and currency_balances is NOT provided, use this.
   → Ignore points dict.

3. points (flat dict — { program: balance })
   → Used only if neither currency_balances nor payer_points is provided.
   → Treated as single payer with payer_id="user".
```

If a request provides BOTH `currency_balances` and `points`, `currency_balances` wins and `points` is ignored. Log a warning if both are non-empty so the frontend knows it's sending redundant data.

**Change**: Add a normalization step immediately after request parsing that converts the winning input into a single canonical format:

```python
@dataclass
class ResolvedBalance:
    payer_id: str
    raw_key: str            # Original key from user input
    canonical_key: str      # Normalized key (e.g., "chase", "united")
    category: str           # "transferable_bank", "fixed_value_bank", "airline", "hotel"
    balance: int
    max_to_use: Optional[int]
    enabled: bool

def resolve_balances(request: OptimizeSoloRequest) -> List[ResolvedBalance]:
    """
    Single source of truth for all currency inputs.
    
    Precedence: currency_balances > payer_points > points
    
    Steps:
    1. Select winning input format per precedence rule above
    2. Normalize all keys to canonical form
    3. Detect alias collisions within same payer → take max, warn
    4. Classify each balance (transferable_bank, fixed_value, airline, hotel)
    5. Apply allowed_currencies filter (drop non-whitelisted)
    6. Apply max_points_by_currency caps (clamp balances)
    7. Drop disabled balances (enabled=False from currency_balances)
    
    Returns: deduplicated, validated list — ready for downstream consumption.
    """
```

All downstream code reads from `List[ResolvedBalance]`. This eliminates ambiguity about which input format takes precedence and prevents "why didn't my `max_to_use` apply?" bugs.

---

### Fix 6 (P2): Fixed-value bank points as explicit payment rail

**Current**: Fixed-value bank points (Wells Fargo, etc.) are treated as a "cash offset" — they effectively increase the budget.

**Change**: Model them as a separate payment option in the solver:

**Option A (simpler)**: Treat as OOP reduction, not budget inflation. When computing final OOP, subtract the portal redemption value. The budget constraint still uses real cash only.

**Option B (better)**: Add a `z_portal[leg, payer]` binary variable to the ILP for portal bookings, with `cost = cash_price * (1 - cpp/100)` representing the reduced effective cost. The solver then decides whether portal booking is cheaper than cash or award booking.

For now, **Option A** is recommended — it's a small code change with correct behavior. Add a `portal_offset` field to the result and subtract it from OOP in the response builder, not from the budget.

---

## 10. Implementation Plan: Budget as Ultimate Driver

### Fix 7 (P0): Lexicographic objective — min OOP first, then maximize quality

**File**: `backend/src/optimization/solver_v3.py`, lines 685–703 (CPP guards) + objective function

**Current**: Award options below CPP floor are rejected before variable creation. The solver cannot use them even if they're the only way to meet the budget. The current tier-escalation system (normal → tight → very tight → critical) is a heuristic that tries to approximate this, but it requires tuning arbitrary thresholds and produces noisy results when `best_cash_price` is unstable.

**Change**: Two-part reform.

#### Part A: Remove CPP hard gates — create variables for ALL award options

```python
# BEFORE (lines 685-703): hard rejection
if actual_cpp < cpp_floor:
    rejected_count += 1
    continue  # variable never created — solver blind to this option

# AFTER: always create variable, tag with quality metadata
# Remove the 'continue' — create y_pf for all options with miles > 0
# Store CPP quality on each option for use in Stage 2 objective
opt._cpp_quality = actual_cpp  # Annotate for Stage 2
```

This ensures the solver can *always* find a within-budget solution if one exists with the user's available points. No more "all options rejected → infeasible → tier escalation → budget dropped" cascade.

#### Part B: True lexicographic objective (not weighted sum)

A weighted-sum approach (`minimize OOP + cpp_penalty * weight`) is fragile: if weights are too high, the solver avoids low-CPP options even when budget demands them; if weights are too low, it ignores CPP quality entirely. Weight tuning is an ongoing maintenance burden.

Instead, use a true two-stage lexicographic solve. The solver already has a two-pass architecture — this change aligns the passes with the correct priority order.

```
Stage 1 (existing Pass 1): Minimize OOP
  - Objective: minimize(total_cash + total_surcharges + convenience_penalties)
  - Budget constraint: total_oop <= budget (HARD, never removed)
  - Result: OOP* = optimal out-of-pocket cost

Stage 2 (existing Pass 2): Maximize quality within OOP envelope
  - Add constraint: OOP <= OOP* + delta
  - Objective: maximize(quality)
```

**Delta formula** (one parameter to tune):

```python
def compute_stage2_delta(budget: float, oop_star: float) -> float:
    """
    Slack for Stage 2 quality optimization.
    
    Small enough that OOP doesn't degrade meaningfully.
    Large enough that the solver has room to improve quality.
    
    Formula: delta = max($25, 2% of budget, 1% of OOP*)
    
    Examples:
      budget=$500,  OOP*=$400 → delta = max(25, 10, 4)   = $25
      budget=$2000, OOP*=$800 → delta = max(25, 40, 8)   = $40
      budget=$100,  OOP*=$95  → delta = max(25, 2, 0.95) = $25
    """
    return max(25.0, 0.02 * max(1.0, budget), 0.01 * oop_star)
```

**Stage 2 quality function** (fully specified):

```python
# All terms are in "quality points" — higher is better.
# The solver MAXIMIZES this objective.

quality = (
    # Term 1: CPP quality (primary — reward good redemption value)
    #   Weight: 1000 per cent of CPP
    #   e.g., 1.5 cpp award → 1500 quality points
    + sum(opt._cpp_quality * 1000 * y_pf_var
          for (y_pf_var, opt) in active_award_vars)
    
    # Term 2: Transfer count penalty (prefer fewer transfers)
    #   Each transfer costs 200 quality points
    #   Rationale: fewer transfers = simpler booking, less risk
    - sum(200 * u_tr_var
          for u_tr_var in active_transfer_used_vars)
    
    # Term 3: Program diversity penalty (prefer fewer distinct programs)
    #   Each distinct program beyond the first costs 100 quality points
    #   Rationale: booking across 4 programs is complex, 1 program is simple
    #   Implementation: add binary "program_used[prog]" vars, penalize sum
    - sum(100 * program_used_var
          for program_used_var in program_used_vars)
    
    # Term 4: Travel time penalty
    #   Each hour over baseline costs 50 quality points
    - sum(50 * excess_hours * x_f_var
          for (x_f_var, excess_hours) in flight_time_excess)
    
    # Term 5: Stops penalty
    #   Each stop costs 150 quality points
    - sum(150 * stops * x_f_var
          for (x_f_var, stops) in flight_stops)
    
    # Term 6: Deterministic tie-breaker (prevent solver non-determinism)
    #   Tiny bonus for lower edge_id index (stable ordering)
    + sum(0.001 * (1000 - edge_index) * x_f_var
          for (x_f_var, edge_index) in indexed_flights)
)
```

**Weight rationale**: CPP quality (1000/cent) dominates so the solver strongly prefers high-value redemptions. Transfer penalty (200) means the solver would accept ~0.2 cpp less to avoid an extra transfer. Program diversity penalty (100) means ~0.1 cpp less to use one fewer program. These weights can be tuned, but the relative ordering (CPP >> transfers > programs > time > stops > tie-break) is the design intent.

**Why lexicographic is superior to weighted sum:**

| Approach | Budget compliance | CPP quality | Tuning needed |
|---|---|---|---|
| Weighted sum | Depends on weights | Depends on weights | Constant tuning as data changes |
| Current tier heuristics | Often fails (escalation removes budget) | Hard-gated, all or nothing | Threshold tuning for 4 tiers |
| **Lexicographic (proposed)** | **Guaranteed** (Stage 1 is pure OOP) | **Best possible within budget** (Stage 2) | Only `delta` slack — one parameter |

**This eliminates**:
- The entire `ComfortConfig` budget tier system (normal/tight/very_tight/critical)
- The CPP floor / miles-per-dollar hard gates
- The tier escalation retry loop
- The "remove budget constraint" fallback (replaced by Fix 8's closest-plan)

**What it preserves**: The existing two-pass architecture in `solver_v3.py`. Pass 1 becomes Stage 1 (min OOP). Pass 2 becomes Stage 2 (max quality within OOP* + delta).

**Test**: Budget = $200 for a $1,500 trip. All award options have CPP = 0.6 cents (below the old 1.1 floor). Verify: Stage 1 finds a within-budget solution using those options. Stage 2 picks the highest-CPP combination among them. No tier escalation needed.

---

### Fix 8 (P0): Never remove the budget constraint — structured closest-plan response

**File**: `backend/src/optimization/solver_v3.py`, fallback logic + `backend/src/schemas/optimize.py`

**Current**: If infeasible at all tiers, budget constraint is removed and the result is returned as if it's a normal solution (just with a text warning). The UI may present this as "within budget" because there's no structured signal.

**Change**: Two-phase solve with explicit response status.

#### Phase A: Primary solve (budget enforced)

```
Solve with budget constraint: total_oop <= budget
If feasible → return with status "within_budget"
```

#### Phase B: Secondary solve (closest plan, budget NOT enforced)

```
If primary infeasible:
  Solve WITHOUT budget constraint, minimizing OOP
  Get min_feasible_oop
  Return with status "closest_over_budget"
```

**Invariant — "Closest plan" is precisely defined as**:

> The minimum achievable OOP under the *same constraints* as the original request, except `OOP <= budget` is removed.

The secondary solve MUST preserve:
- `allowed_currencies` (user's currency whitelist)
- `max_points_by_currency` (per-currency caps)
- Payer separation rules (no pooling)
- Transfer increments and block sizes
- Cabin / stops / airline filters from the original request
- **The same search result snapshot** (do NOT re-search flights — use the identical `flights` list from the primary solve)

Only remove: the `OOP <= budget` hard constraint.

This ensures the "closest plan" is deterministic and comparable to the original request. If the secondary solve used different search results or relaxed currency constraints, the "closest" plan could be unreachable under the user's actual constraints, breaking trust.

The response MUST include a structured status so the UI can never accidentally present an over-budget plan as within-budget:

```python
# Add to OptimizeSoloResponse or OptimizationResult:
class BudgetStatus(BaseModel):
    status: Literal["within_budget", "closest_over_budget", "no_budget_set"]
    user_budget: Optional[float] = None
    actual_oop: float
    required_budget: Optional[float] = None  # min_feasible_oop (only if over budget)
    shortfall: Optional[float] = None        # required_budget - user_budget
    suggested_budget: Optional[float] = None # required_budget * 1.10

# In response:
budget_status = BudgetStatus(
    status="closest_over_budget",
    user_budget=budget,
    actual_oop=min_feasible_oop,
    required_budget=min_feasible_oop,
    shortfall=min_feasible_oop - budget,
    suggested_budget=min_feasible_oop * 1.10,
)

# Plus structured warning:
StructuredWarning(
    category="budget",
    severity="warning",
    headline="Budget Too Low",
    message=f"The lowest possible out-of-pocket is ${min_feasible_oop:.0f}. "
            f"Your budget of ${budget:.0f} is ${min_feasible_oop - budget:.0f} short.",
    details={
        "user_budget": budget,
        "min_feasible_oop": min_feasible_oop,
        "shortfall": min_feasible_oop - budget,
        "suggested_budget": min_feasible_oop * 1.10,
    }
)
```

**Key behaviors**:

1. The system never pretends the budget is met when it isn't.
2. The UI can check `budget_status.status` to show a clear "over budget" banner.
3. `suggested_budget` gives users a concrete number to adjust to.
4. The closest plan is still returned (so users aren't left empty-handed), but it's **explicitly labeled** as not meeting their budget.

**Frontend contract**: If `budget_status.status == "closest_over_budget"`, the results page MUST show a prominent banner with the shortfall and suggested budget. The "Book this" CTA should change to "Increase budget to $X" or similar.

---

### Fix 9 (P1): Stabilize `best_cash_price` — precise definition + cache per search run

**Current**: `best_cash_price` depends on search results, which vary between runs. It's also not formally defined — could mean cheapest itinerary, cheapest per-leg sum, cheapest after filters, etc. If this value shifts between solver retries within the same optimization run, tier selection becomes noisy.

**Change**: Define precisely and compute once.

**Definition**: `best_cash_price = sum of cheapest validated cash flight per leg, among flights with known cash prices.`

```python
def compute_best_cash_price(flights: List[FlightItineraryEdge], legs: List) -> float:
    """
    Stable best cash price: sum of cheapest cash flight per leg.
    Only uses validated flights with known, non-sentinel cash prices.
    Falls back to median if cheapest is an outlier (< 30% of median).
    """
    total = 0.0
    for leg in legs:
        leg_flights = [
            f for f in flights
            if f.leg_id == leg.leg_id and f.cash_cost > 0 and not f.cash_cost_unknown
        ]
        if not leg_flights:
            return float('inf')  # Can't compute → treat as "normal" tier
        prices = sorted(f.cash_cost for f in leg_flights)
        cheapest = prices[0]
        median = prices[len(prices) // 2]
        # Use median if cheapest is suspiciously low (data error or basic economy outlier)
        if cheapest < median * 0.3 and len(prices) > 3:
            total += median
        else:
            total += cheapest
    return total
```

**Caching rule**: Compute `best_cash_price` **once** at the start of `run_v3_optimization`, store it on the solver context, and reuse it throughout the entire solve (including any retries or tier escalations). Never recompute mid-solve.

```python
# In run_v3_optimization, before solver invocation:
best_cash_price = compute_best_cash_price(flights, spec.legs)
logger.info(f"[V3] best_cash_price={best_cash_price:.0f} (cached for this run)")
# Pass to solver as immutable parameter
```

**Note**: With Fix 7's lexicographic objective, `best_cash_price` is primarily used for logging and quality scoring in Stage 2 — it no longer drives tier selection or CPP floor thresholds. This significantly reduces the impact of instability.

---

### Fix 10 (P1): Make greedy `budget_is_tight` proportional, not binary

**File**: `backend/src/agents/orchestrator.py`, lines 1930–1932

**Change**: Use the same tier system as the ILP solver.

```python
# BEFORE:
budget_is_tight = budget > 0 and budget < NO_BUDGET_LIMIT

# AFTER:
if budget <= 0 or budget >= NO_BUDGET_LIMIT:
    budget_tier = "none"      # No budget set
    prefer_points = False
else:
    # Estimate best cash price from search results
    best_cash = self._estimate_best_cash_price(search_results, segments)
    ratio = budget / best_cash if best_cash > 0 else 1.0

    if ratio >= 1.0:
        budget_tier = "normal"    # Budget covers cash — points optional
        prefer_points = False
    elif ratio >= 0.60:
        budget_tier = "tight"     # Must use some points
        prefer_points = True
    elif ratio >= 0.30:
        budget_tier = "very_tight"
        prefer_points = True
    else:
        budget_tier = "critical"
        prefer_points = True
```

Then use `budget_tier` to set CPP thresholds in the 3-pass greedy logic instead of the current hard-coded values. Normal tier uses standard CPP, tight uses relaxed, critical uses no CPP restriction.

---

## 11. Implementation Plan: Multi-Payer Fixes

### Fix 11 (P0): Fix hardcoded `traveler_ids=["user"]` + stop silent failures

**File**: `backend/src/optimization/adapter_v3.py`, line 478 + lines 1713–1716

#### Part A: Pass actual payer IDs to the leg builder

```python
# BEFORE (line 478):
traveler_ids=["user"],

# AFTER:
# The function needs access to payer IDs. Pass as parameter:
def _build_legs_and_segments(segments, payer_ids=None):
    traveler_ids = payer_ids or ["user"]
    ...
    legs.append(OrderedLeg(
        leg_id=leg_id,
        ...,
        traveler_ids=traveler_ids,
    ))

# In convert_trip_to_spec, pass the payer IDs:
payer_ids = list(payer_points.keys()) if payer_points else ["user"]  # before line 392
legs, stay_segments = _build_legs_and_segments(segments, payer_ids=payer_ids)
```

#### Part B: Make spec validation failure a loud error, not a silent empty return

The current code silently returns `[]` on validation failure (line 1713-1716), which causes the orchestrator to fall back to greedy without any indication that the ILP path was broken. This makes debugging nearly impossible.

```python
# BEFORE (lines 1713-1716):
errors = spec.validate()
if errors:
    logger.error(f"[V3 Adapter] Invalid spec: {errors}")
    return []   # ← silent failure, orchestrator falls back to greedy

# AFTER:
errors = spec.validate()
if errors:
    logger.error(f"[V3 Adapter] CRITICAL: Invalid spec — ILP solver cannot run. "
                 f"Errors: {errors}. Falling back to greedy. "
                 f"Traveler IDs: {[t.traveler_id for t in spec.travelers]}, "
                 f"Leg traveler_ids: {[l.traveler_ids for l in spec.legs]}")
    # Return empty but also propagate a warning that reaches the API response
    # so we can detect this in monitoring
    return [], [WarningItem(
        category="degradation",
        severity="warning",
        headline="Optimization Degraded",
        message="Advanced optimizer unavailable for this configuration. "
                "Results may not use all available currencies optimally.",
    )]
```

This requires updating the return type of `run_v3_optimization` to also return warnings (or attaching warnings to a context object). At minimum, the error log should include enough detail to diagnose the mismatch.

**Impact**: Multi-payer trips will now pass spec validation and actually use the ILP solver instead of silently falling back to the greedy path. When the ILP path does fail, the failure is visible in logs and response metadata.

**Test**: Submit `payer_points: {"alice": {"amex_mr": 50000}, "bob": {"chase_ur": 80000}}`. Verify V3 solver is invoked (not greedy fallback). Verify both payers' currencies appear in the result's `payer_breakdown`.

---

### Fix 12 (P1): One payer per segment (MVP) + booker attribution

**Current**: The solver allows any payer's points to fund any segment. The "choose exactly one payment" constraint (`cash_vars + points_vars == x`) means exactly one `y_pf` variable is active per segment — which already implies one payer. **However**, the current constraint doesn't explicitly prevent a scenario where the solver picks `y_pf` with payer=alice for leg 1 and payer=bob for leg 1 if there are multiple `y_pf` vars active across different programs for the same leg (which can't happen due to the equality constraint, but should be verified).

**MVP rule**: Each award segment has exactly one payer who funds it. No multi-payer split on a single ticket. This is an operational necessity — two people cannot pay one award ticket from two different loyalty accounts.

**Why this matters now**: "Donate points but kept separate" means one person can fund another person's ticket. That's fine. But the solver must track *which* payer funds *which* segment clearly, because:

1. The booking instructions must tell the right person to log into the right portal.
2. The transfer instructions must tell the right person to transfer from the right bank.
3. The payer breakdown in the response must correctly attribute costs.

**One-payer-per-segment enforcement proof**:

> For each segment, the ILP constraint `sum(z_cf) + sum(y_pf) == x_f` ensures that exactly ONE payment variable is active when a flight is selected (`x_f = 1`). Each `y_pf` variable has a fixed `payer_id` baked into its key: `(leg_id, edge_id, option_id, payer, source_id)`. Therefore, when exactly one `y_pf = 1`, exactly one payer is selected for that segment. No multi-payer split is possible.

This is currently implicit. To prevent future refactor bugs (e.g., someone relaxing the constraint to `>=` or adding split-payment variables), add an **explicit validation assertion** in solution extraction:

```python
# In solution extraction, VERIFY one-payer-per-segment:
for edge_id, active_vars in active_payment_vars.items():
    payer_ids = set(var.payer_id for var in active_vars if var.value > 0.5)
    assert len(payer_ids) <= 1, (
        f"INVARIANT VIOLATION: segment {edge_id} has {len(payer_ids)} payers: "
        f"{payer_ids}. Expected exactly one payer per segment."
    )
```

**Change**:

```python
# 1. The constraint "sum(cash_vars) + sum(points_vars) == x" already ensures
# exactly ONE y_pf or z_cf is active per segment. VERIFIED by assertion above.

# 2. In Solution extraction — add explicit payer attribution:
for edge_id, payment in flight_payments.items():
    if payment.method == "points":
        # The active y_pf variable tells us which payer funded this
        payment.booking_payer_id = payment.payer_id
        payment.booking_program = src.target_program
        payment.booking_source_bank = src.from_bank  # if transfer

# 3. In response schema — add BookingAttribution:
class BookingAttribution(BaseModel):
    segment_id: str
    payer_id: str
    payer_name: str
    action: str  # "transfer_and_book" or "book_direct" or "pay_cash"
    source_bank: Optional[str] = None  # e.g., "amex" (if transfer needed)
    target_program: Optional[str] = None  # e.g., "flying_blue"
    points_amount: Optional[int] = None

# 4. Later (post-MVP): Add program-specific rules for "can book for others"
# e.g., United allows booking for anyone, but some programs require
# the mileage account holder to be a passenger. This becomes a policy
# layer that filters which payer can fund which segment.
```

**Test**: Two payers, three segments. Verify each segment's `booking_payer_id` is exactly one payer. Verify booking instructions correctly name the right payer for each action.

---

### Fix 13 (P2): Make `(payer_id, currency_key)` the universal balance key

**Current**: Bank balances use `bank_balances[bank_key]` per traveler, which works because each Traveler object is separate. But the greedy path uses flat `remaining_points` with `payer::program` prefixed keys, creating two different keying schemes.

**Change**: Standardize on `(payer_id, canonical_key)` tuples everywhere, or consistently use the `payer::program` string format in both ILP and greedy paths. The ILP path already uses per-traveler dicts (which is equivalent), so this is mainly about making the greedy path consistent and ensuring no code path accidentally merges payers.

---

## 12. Implementation Sequence & Dependencies

> **Sequencing principle**: Fix the ILP path first (Phase 1). Once ILP is reliable for both single-payer and multi-payer, the greedy fallback becomes rare. Invest in greedy parity only enough to not regress — don't duplicate solver logic.

### Phase 1 — Critical Fixes (unblock multi-currency + budget + multi-payer)

| Order | Fix | File | Est. Effort | Rationale |
|-------|-----|------|-------------|-----------|
| 1.1 | **Fix 11**: Fix `traveler_ids=["user"]` + loud error logging | `adapter_v3.py:478` + `:1713` | 1 hour | Unblocks ILP for multi-payer. Do first so multi-payer tests work immediately. |
| 1.2 | **Fix 1**: Pareto award options per flight (all sub-fixes) | `adapter_v3.py:1966-1983` | 3-4 hours | Root cause of "only 1 currency works." Includes stable option_ids, Pareto frontier, tighter matching keys, deterministic ordering, and cap. |
| 1.3 | **Fix 2**: Alias collision → `max()` not overwrite | `adapter_v3.py:278-291` | 30 min | Prevents silent data loss. Quick fix. |
| 1.4 | **Fix 7**: Lexicographic objective (min OOP → max quality) | `solver_v3.py` Pass 1/2 + CPP guards | 4-5 hours | Makes budget the true ultimate driver. Eliminates tier escalation. Remove CPP hard gates, keep two-pass architecture. |
| 1.5 | **Fix 8**: Structured closest-plan response | `solver_v3.py` fallback + `schemas/optimize.py` | 2 hours | Trust win. Never pretend budget is met. Depends on Fix 7 (fewer infeasible cases). |

**Validation after Phase 1**:
- [ ] Submit 2+ bank currencies → both used across segments
- [ ] Submit multi-payer points → ILP solver invoked (not greedy fallback), check logs for "CRITICAL" absence
- [ ] Budget $300 for $1,500 trip → points used aggressively, no "no results"
- [ ] Budget $300 for $1,500 trip where only low-CPP awards exist → awards used (no hard rejection)
- [ ] Budget $100 for $2,000 trip → `budget_status.status == "closest_over_budget"` with correct `shortfall`
- [ ] Same flight shows award options for 2+ programs (e.g., United AND ANA)
- [ ] `option_id`s are unique across all award options (no collisions)
- [ ] Repeated runs with same inputs produce same results (determinism)

### Phase 2 — Greedy Fallback Hardening

> **Investment level**: Moderate. Once Phase 1 makes ILP reliable, greedy becomes the rare fallback path. Do Fix 3 (critical for correctness) and Fix 10 (prevents silly behavior). Defer Fix 4 (full cross-currency comparison) unless greedy is still triggered frequently in production.

| Order | Fix | File | Est. Effort | Rationale |
|-------|-----|------|-------------|-----------|
| 2.1 | **Fix 3**: Forward currency constraints to greedy fallback | `orchestrator.py:1876-1883` | 1 hour | Correctness: user's currency restrictions must not be silently dropped. |
| 2.2 | **Fix 10**: Proportional `budget_is_tight` | `orchestrator.py:1930-1932` | 2 hours | Prevents a $5,000 budget for a $400 trip from force-spending points. |
| 2.3 | **Fix 4**: Cross-currency comparison in greedy | `orchestrator.py:_pick_best_flight_option` | 2-3 hours | **Defer unless greedy is common**. Only if monitoring shows > 20% of requests hitting greedy after Phase 1. |

**Validation after Phase 2**:
- [ ] Greedy fallback respects `allowed_currencies` and `max_points_by_currency`
- [ ] Greedy with generous budget ($5,000 for $400 trip) does NOT force points
- [ ] If Fix 4 is implemented: greedy compares UA award (Chase) vs DL award (Amex) and picks lower surcharge

### Phase 3 — Robustness & Correctness

| Order | Fix | File | Est. Effort | Dependencies |
|-------|-----|------|-------------|--------------|
| 3.1 | **Fix 9**: Stabilize `best_cash_price` + cache per run | `adapter_v3.py` | 1-2 hours | None (lower impact after Fix 7 removes tier system) |
| 3.2 | **Fix 5**: Canonical `ResolvedBalance` internal representation | `schemas/optimize.py` + adapter | 3-4 hours | None |
| 3.3 | **Fix 6**: Fixed-value bank as OOP reduction, not budget inflation | `adapter_v3.py` + solver | 2 hours | Fix 5 |
| 3.4 | **Fix 12**: One-payer-per-segment + booker attribution | `solver_v3.py` + result builder | 2-3 hours | Fix 11 |
| 3.5 | **Fix 13**: Universal `(payer, key)` balance keying | Multiple files | 3-4 hours | Fix 5 |

**Validation after Phase 3**:
- [ ] Wells Fargo points reduce OOP, don't inflate budget
- [ ] `best_cash_price` is identical across retries within same optimization run
- [ ] Multi-payer result shows exactly one `booking_payer_id` per segment
- [ ] Booking instructions name the correct payer for each transfer/booking action
- [ ] `{"amex_mr": 50k, "amex": 50k}` does NOT produce 100k balance

### Total Estimated Effort

- **Phase 1 (Critical)**: ~11 hours
- **Phase 2 (Greedy Hardening)**: ~3-6 hours (Fix 4 deferred unless needed)
- **Phase 3 (Robustness)**: ~14 hours
- **Total**: ~28-31 hours

### Risk Mitigations

| Risk | Mitigation |
|---|---|
| Fix 1 Pareto options increase solver variable count → slower | `MAX_AWARD_OPTIONS_PER_FLIGHT = 8` cap. With 20 flights × 8 options × 5 sources = 800 `y_pf` vars — well within PuLP limits. Profile before/after. |
| Fix 1 tighter matching keys miss valid awards | Fallback to alliance-level matching if tight match produces zero results. Log which fallback was used. |
| Fix 1 non-deterministic option ordering causes flapping | Deterministic sort `(surcharge, miles, program)` before cap. Verify with repeated-run test. |
| Fix 7 lexicographic objective changes results for all users | The behavior change is strictly better: same OOP, better quality within that OOP. No user gets a worse plan. A/B test to verify. |
| Fix 7 removes tier system that some code paths depend on | Audit all references to `budget_tier`, `get_budget_tier`, `get_adaptive_cpp_floor`. Replace with Stage 2 quality scoring. |
| Fix 11 unlocks ILP for multi-payer, exposing latent solver bugs | Run multi-payer integration test (2 payers, 3 segments) before deploying. |
| Greedy fixes (Phase 2) regress single-payer behavior | Keep Phase 2 changes behind a feature flag initially. Monitor greedy fallback rate after Phase 1. |

---

## 13. Required Test Cases

These tests catch regressions immediately and should be added as part of Phase 1 before deploying any fixes.

### Test 1: Multi-currency visibility — disjoint transfer partners

**Setup**: Route where award options exist across programs with disjoint transfer partners.
- Award options on flight: United (35k), ANA (40k), Flying Blue (45k)
- User points: `{"amex_mr": 100000}` (Amex transfers to ANA and Flying Blue, but NOT United)

**Expected**: Solver can choose ANA or Flying Blue options. **Cannot** choose United (no funding path). Result uses Amex → ANA or Amex → Flying Blue.

**What this catches**: If Fix 1 is incomplete and only United (cheapest) is attached, the solver sees zero viable options for the Amex user.

---

### Test 2: Multi-currency — both banks used across segments

**Setup**: Round trip SEA → CDG. Two banks with non-overlapping best options.
- Outbound: Award via Flying Blue (60k + $80 surcharge), Award via United (65k + $120 surcharge)
- Return: Award via United (45k + $55 surcharge), Award via Flying Blue (55k + $90 surcharge)
- User points: `{"chase_ur": 80000, "amex_mr": 80000}`

**Expected**: Solver picks Amex→Flying Blue for outbound (lower surcharge) and Chase→United for return (lower surcharge). Both banks used. Total OOP = $135.

**What this catches**: Single-currency behavior where only one bank is used for both segments.

---

### Test 3: Award option uniqueness — no `option_id` collisions

**Setup**: Same flight has multiple award options for same program with different cabins/surcharges.
- United Economy: 35k + $80
- United Business: 90k + $150

**Expected**: Both options have distinct `option_id`s. Both appear in `f.award_options`. Solver can pick either.

**What this catches**: `option_id = f"{edge_id}_{program}"` collision causing one to overwrite the other.

---

### Test 4: Multi-payer ILP invocation

**Setup**: Two payers.
- `payer_points: {"alice": {"amex_mr": 60000}, "bob": {"chase_ur": 80000}}`
- Round trip with awards on Flying Blue and United.

**Expected**:
1. V3 ILP solver is invoked (check logs for `ilp_invoked=true`).
2. Both payers' currencies appear in result's `payer_breakdown`.
3. Each segment has exactly one `booking_payer_id` — verify the one-payer-per-segment invariant (no segment with contributions from both Alice and Bob).
4. Booking instructions correctly name the right payer for each transfer/booking action.

**What this catches**: Bug 4 (`traveler_ids=["user"]`) causing silent fallback. Also validates Fix 12's one-payer-per-segment invariant.

---

### Test 5: Budget infeasible — closest plan with structured status

**Setup**: Budget = $50. Trip costs minimum $400 in surcharges alone.
- Best all-cash: $1,200
- Best award: 60k pts + $180 surcharge (cheapest surcharge available)

**Expected**: `budget_status.status == "closest_over_budget"`. `required_budget` = $180. `shortfall` = $130. Structured warning with headline "Budget Too Low." Plan is returned (not empty) but explicitly labeled as over-budget.

**What this catches**: Fix 8 incomplete — system either returns empty or presents over-budget plan as within budget.

---

### Test 6: No double-counting alias collision

**Setup**: `{"amex_mr": 50000, "amex": 50000}` — same account, two aliases.

**Expected**: `bank_balances["amex"] == 50000` (max, not 100,000). Warning logged about alias collision.

**What this catches**: Fix 2 regression — summing instead of taking max.

---

### Test 7: Determinism — repeated runs produce same results

**Setup**: Any multi-currency trip with 3+ award options per flight.

**Expected**: Run optimization 5 times with identical inputs. All 5 runs produce identical `option_id`s, same segment assignments, same payer breakdown.

**What this catches**: Non-deterministic option ordering causing flapping results in production.

---

### Test 8: Lexicographic objective — budget forces low-CPP usage

**Setup**: Budget = $200. Best cash = $1,500. Only available award: 80k pts + $150 surcharge (CPP = 0.56 cents — below old 1.1 floor).

**Expected**: Stage 1 selects the award option (OOP = $150 < $200 budget). Stage 2 confirms it's the only option. Result is within budget.

**What this catches**: Fix 7 incomplete — CPP hard gate still active, rejecting the only viable option and causing infeasibility.

---

### Test 9: Pareto frontier — surcharge-optimal option preserved

**Setup**: Two awards on same program for same flight.
- Program A, Economy: 35k pts + $450 surcharge
- Program A, Economy: 45k pts + $60 surcharge (different fare class)
- Budget: $100

**Expected**: Both options survive Pareto selection (one is miles-optimal, one is surcharge-optimal). Solver picks the $60-surcharge option because it fits within budget.

**What this catches**: "Keep cheapest miles" policy discarding the option that actually fits the budget.

---

### Test 10: Tight matching — don't attach wrong routing's award to a flight

**Setup**: Leg 0, DL flight SEA→CDG direct. AwardTool also found AF award SEA→CDG via CDG connecting in Paris (different routing). Both are SkyTeam.

**Expected**: Under tight matching, the AF award (if it has a different origin/destination shape) is NOT attached to the DL direct flight. Under fallback alliance matching, it IS attached but with a logged warning.

**What this catches**: Fix 1c incomplete — airline-only matching attaching awards with incompatible routings.

---

## 14. Required Logging & Telemetry

These log lines and structured metrics are required across all phases. They are the minimum needed to diagnose silent fallbacks, budget mismatches, and currency routing failures in production.

### Critical decision-point logs (must be present after Phase 1)

| Log point | Location | Format | Purpose |
|---|---|---|---|
| **ILP invocation status** | `adapter_v3.py`, after `spec.validate()` | `[V3] ilp_invoked=true\|false reason={reason}` | Detect silent greedy fallbacks. If `false`, reason must be one of: `spec_validation_failed`, `no_flights`, `solver_exception`, `empty_result`. |
| **Budget status** | `solver_v3.py`, after solve completes | `[V3] budget_status={within_budget\|closest_over_budget\|no_budget_set} user_budget={X} actual_oop={Y} shortfall={Z}` | Detect budget violations. If `closest_over_budget`, shortfall must be logged. |
| **Award options per flight** | `adapter_v3.py`, after enrichment | `[V3] flight={edge_id} award_options={count} programs=[{list}] match_method={fingerprint\|alliance_fallback}` | Detect Fix 1 regressions. If `count=1` on a route with known multi-program awards, enrichment is broken. |
| **Currencies classified** | `adapter_v3.py`, after `_classify_points` | `[V3] payer={id} bank_balances={dict} points_balances={dict} alias_collisions={count}` | Detect Fix 2 issues. If `alias_collisions > 0`, investigate double-count risk. |
| **Input precedence** | `adapter_v3.py` or `routes/solo.py`, at request parse | `[V3] input_source={currency_balances\|payer_points\|points} payer_count={N} currency_count={M}` | Detect conflicting inputs. |

### Structured metrics (for monitoring dashboards)

```python
# Emit after each optimization run:
metrics.emit({
    "ilp_invoked": True,                          # bool
    "ilp_solve_time_ms": 1234,                    # int
    "budget_status": "within_budget",             # enum
    "budget_shortfall": 0.0,                      # float (0 if within budget)
    "currencies_provided": 3,                     # int
    "currencies_used_in_solution": 2,             # int
    "award_options_per_flight_avg": 4.2,          # float
    "award_options_per_flight_min": 1,            # int (should be > 1 after Fix 1)
    "match_method_fingerprint_pct": 0.85,         # float (% of flights matched by fingerprint)
    "greedy_fallback": False,                     # bool
    "payer_count": 1,                             # int
    "stage2_delta_used": 25.0,                    # float
    "stage2_cpp_achieved_avg": 1.35,              # float
})
```

### Alerts to set up

| Alert | Condition | Severity |
|---|---|---|
| High greedy fallback rate | `greedy_fallback=true` > 20% of requests over 1 hour | Warning |
| ILP never invoked for multi-payer | `payer_count > 1 AND ilp_invoked=false` any occurrence | Error |
| Systematic single-currency | `currencies_provided >= 2 AND currencies_used_in_solution <= 1` > 50% of multi-currency requests | Warning |
| Budget always over | `budget_status=closest_over_budget` > 30% of budgeted requests | Info (may indicate UX issue) |

---

## Key Files Reference

| File | Purpose |
|---|---|
| `backend/src/schemas/optimize.py` | API schemas: `OptimizeSoloRequest`, `CurrencyBalance`, `OOPMetrics` |
| `backend/src/schemas/programs.py` | `PointsProgram` enum defining all canonical program IDs |
| `backend/src/schemas/points.py` | `PointsBalance` model, normalization helpers |
| `backend/src/optimization/constants.py` | Transfer graph, CPP thresholds, surcharge programs, solver config |
| `backend/src/optimization/normalize.py` | Program/bank key normalization, classification functions |
| `backend/src/optimization/models_v3.py` | `FundingSource`, `AwardOption`, `TransferPath`, `ComfortConfig` (budget tiers) |
| `backend/src/optimization/adapter_v3.py` | `_classify_points()`, `convert_trip_to_spec()` — **BUG 1, 2, 3, 4 here** |
| `backend/src/optimization/solver_v3.py` | ILP solver — budget constraint, CPP guards, variable creation |
| `backend/src/handlers/transfer_strategy.py` | Extended transfer graph, transfer instructions, bank/program metadata |
| `backend/src/agents/orchestrator.py` | Greedy optimizer — **BUG 5, 6 here**, budget detection |
| `backend/src/agents/models.py` | `NO_BUDGET_LIMIT` sentinel constant |
