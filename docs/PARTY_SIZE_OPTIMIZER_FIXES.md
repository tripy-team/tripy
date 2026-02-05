# Party Size & Group Optimizer Fixes - Implementation Plan

**Created:** February 4, 2026  
**Last Updated:** February 4, 2026  
**Status:** Planning  
**Priority:** High  
**Scope:** Flights-only (no hotels)  
**Affected Files:**
- `backend/src/handlers/group_oop_optimizer.py` (core ILP logic)
- `backend/src/handlers/group_api.py` (API handlers)
- `backend/src/services/trip_member_service.py` (member join logic)
- `frontend/src/app/(app)/group/join/[inviteCode]/page.tsx` (join form)
- `frontend/src/app/(app)/group/dashboard/page.tsx` (member display)
- `frontend/src/app/(app)/group/results/page.tsx` (optimizer output display)

---

## Executive Summary

The group optimizer has several critical issues when handling **families with children** or **members with large party sizes but limited/no points**. These issues can produce "solutions" that are:

1. **Mathematically optimal but operationally impossible** (phantom award availability)
2. **Technically feasible but financially impossible** (settlement debt exceeds budget)
3. **Unnecessarily infeasible** (overly strict balance constraints)
4. **Suboptimal due to dominated options** (points options worse than cash not pruned)

This document outlines each issue, its root cause, and a detailed implementation plan to fix it.

> **Note:** This plan is **flights-only**. Hotel logic differs significantly (rooms vs occupants, shared rooms) and is out of scope.

---

## Table of Contents

0. [Data Semantics](#data-semantics-critical---read-first) **(CRITICAL - Read First)**
1. [Optimization Definition](#optimization-definition) **(NEW - Read Before ILP Work)**
2. [Cursor Guardrails](#cursor-guardrails) **(NEW - Implementation Rules)**
3. [Issue 0: No Dominance Pruning of Points Options](#issue-0-no-dominance-pruning-of-points-options) **(P0)**
4. [Issue 1: Binary Booking Items Prevent Partial Point Coverage](#issue-1-binary-booking-items-prevent-partial-point-coverage)
5. [Issue 2: Budget Constraints Ignore Settlement Debt](#issue-2-budget-constraints-ignore-settlement-debt)
6. [Issue 3: Party-Size Award Availability Not Verified](#issue-3-party-size-award-availability-not-verified)
7. [Issue 4: Fair Market Value Settlement Can Exceed Cash Value](#issue-4-fair-market-value-settlement-can-exceed-cash-value)
8. [Issue 5: Balance Constraint Blocks Valid Solutions](#issue-5-balance-constraint-blocks-valid-solutions)
9. [Issue 6: Booker Attribution Policy](#issue-6-booker-attribution-policy) **(REFRAMED)**
10. [Implementation Phases](#implementation-phases-revised) **(REVISED)**
11. [Schema Plumbing Checklist](#schema-plumbing-checklist) **(NEW)**
12. [Testing Plan](#testing-plan-expanded) **(EXPANDED)**
13. [Schema Impact](#schema-impact-newmodified-fields)
14. [Testing Helpers](#testing-helpers)

---

## Data Semantics (CRITICAL - Read First)

All cost/points fields are **per-passenger** unless otherwise noted. Totals are computed by multiplying by `party_size`.

### Field Definitions

| Field | Location | Unit | Description |
|-------|----------|------|-------------|
| `cash_cost` | `MemberBookingItem` | USD per pax | Cash fare for one passenger |
| `points_required` | `GroupPointsOption` | points per pax | Award points needed for one passenger |
| `surcharge` | `GroupPointsOption` | USD per pax | Taxes/fees when using points, per passenger |
| `party_size` | `MemberBookingItem` | integer | Number of passengers in this item |
| `party_size` | `GroupMember` | integer | Total travelers in member's booking (input) |

### Computing Totals

```python
# Total cash cost for an item
total_cash = item.cash_cost * item.party_size

# Total points required
total_points = opt.points_required * item.party_size

# Total surcharge
total_surcharge = opt.surcharge * item.party_size

# Cash avoided by using points (for settlement capping)
cash_avoided_per_pax = item.cash_cost - opt.surcharge
total_cash_avoided = cash_avoided_per_pax * item.party_size
```

### After Expansion

| Item Type | `party_size` | Description |
|-----------|--------------|-------------|
| Original (pre-expansion) | N | Member's full party |
| Pax item (post-expansion) | 1 | Single passenger, atomic |
| Bucket item (large party) | ≤ BUCKET_SIZE | Group of passengers treated together |

**Rule:** `GroupMember.party_size` is the input. `MemberBookingItem.party_size` is copied from member at item creation, but may diverge after expansion (pax items → 1, bucket items → bucket size).

### Dominance Pruning Uses Per-Pax Values

When comparing options for dominance, use **per-pax** values:
- Compare `opt.surcharge` (per pax) to `item.cash_cost` (per pax)
- Do NOT multiply by `party_size` for pruning decisions

### ILP Constraints Use Totals

When building ILP constraints (settlement, budget), use **totals**:
- `points_used = opt.points_required * item.party_size`
- `cash_cost = item.cash_cost * item.party_size`
- `surcharge = opt.surcharge * item.party_size`

**CRITICAL COMMENT TO ADD IN CODE:**
```python
# PRUNING uses per-pax values (opt.surcharge vs item.cash_cost)
# ILP CONSTRAINTS use totals (multiply by party_size)
```

---

## Optimization Definition

This section defines exactly what the optimizer does. **Do not change these definitions without review.**

### Objective Function

**Minimize total booking out-of-pocket (OOP) for the group:**

```
minimize: Σ (cash_fare_if_cash + surcharge_if_points)
```

- Cash fare: `pay_cash[item] * item.cash_cost * item.party_size`
- Surcharge: `Σ use_points[(item, prog, owner)] * opt.surcharge * item.party_size`

**Settlement is NOT part of the objective.** It's a post-solve transfer between members.

### Constraints

| Constraint | Description | Soft in Phase 4? |
|------------|-------------|------------------|
| One payment per item | Each item is 100% cash OR 100% points from one source | No (always hard) |
| Points pool balance | Can't use more points than owner has in program | No (always hard) |
| Per-member budget | `member_cash_oop + member_surcharges <= budget` | Yes (slack vars) |
| Settlement cap | `settlement_owed_to_others <= max_settlement_owed` | Yes (disabled) |
| Balance constraint | `owner_points_used <= 1.5 * fair_share` | Yes (disabled first) |

### Settlement (Post-Solve)

Settlement is computed **after** the ILP solves, using the same `settlement_value_usd()` function:

```
For each allocation where owner != beneficiary:
    settlement = settlement_value_usd(program, points_used, cash_cost, surcharge)
    beneficiary owes owner this amount
```

**Self-settlement is always $0.** Do not create settlement rows where `from_member == to_member`.

### Partial Coverage Granularity

After passenger expansion:
- If `party_size <= MAX_PASSENGER_EXPANSION` (6): granularity = 1 passenger
- If `party_size > MAX_PASSENGER_EXPANSION`: granularity = `BUCKET_SIZE` (3) passengers

**You cannot mix payment types within a bucket.** A bucket of 3 passengers is all-cash or all-points from one source.

---

## Cursor Guardrails

**Follow these rules strictly during implementation. Violations will cause bugs or frontend crashes.**

### 1. Program Code Normalization

Normalize all program codes to **UPPERCASE** at the earliest possible point:

```python
def normalize_program_code(code: str) -> str:
    return code.strip().upper()
```

Apply to:
- `member.points_balances` keys
- `pool.by_member` and `pool.by_program` keys
- `opt.program_code`
- `opt.available_from`
- `opt.transfer_from_bank`

**Why:** Mixed case (`"chase"` vs `"Chase"` vs `"CHASE"`) causes silent mismatches in ILP variable construction.

### 2. Backward Compatibility for Field Changes

**Do NOT rename or remove existing fields in the first PR.**

For `GroupPaymentAllocation`:
- **Step 1:** Add new fields (`surcharge_usd`, `cash_base_usd`, `booker_member`) alongside existing `cash_paid`
- **Step 2:** Update frontend to use new fields
- **Step 3:** Remove old `cash_paid` field in a later PR

### 3. Expansion Grouping via `original_item_id`

**Do NOT return `expansion_map` as a separate field.**

Instead, include `original_item_id` on every allocation:
- UI groups allocations by `original_item_id` for display
- If `original_item_id == item_id`, the item was not expanded

### 4. Unified Settlement Function

Use `settlement_value_usd()` in **exactly these places**:
1. ILP settlement constraint (Issue 2)
2. Settlement extraction in `_extract_group_solution()` (Issue 4)
3. Any UI that displays "settlement value"

**Never call `get_fair_market_value()` directly for settlement amounts.**

### 5. Soft Budget Implementation

Use dynamic `BIG_M` and bound slack variables:

```python
# Compute upper bound
total_cash_upper_bound = sum(item.cash_cost * item.party_size for item in booking_items)

# Use bounded BIG_M
BIG_M = max(10_000, 100 * total_cash_upper_bound)

# Create bounded slack variables
for member in members:
    if member.max_cash_budget is not None:
        budget_overage[member.user_id] = pl.LpVariable(
            f"budget_overage_{member.user_id}",
            lowBound=0,
            upBound=total_cash_upper_bound,  # Bounded!
            cat="Continuous",
        )
```

### 6. `transfer_from_bank` Population Rule

For Phase 3 (booker attribution), ensure `GroupPointsOption.transfer_from_bank` is populated:

```python
BANK_PROGRAMS = {"CHASE", "AMEX", "CITI", "CAPONE", "BILT"}

def infer_transfer_from_bank(opt: GroupPointsOption) -> Optional[str]:
    """
    If transfer_from_bank is not set, infer it.
    Bank programs transfer to airline → beneficiary books.
    Airline programs → owner books directly.
    """
    if opt.transfer_from_bank:
        return opt.transfer_from_bank.upper()
    
    prog = opt.program_code.upper()
    if prog in BANK_PROGRAMS:
        # Bank currency transfers to airline
        return prog
    
    # Airline program - no transfer needed
    return None
```

### 7. Passenger Breakdown Serialization

For `passenger_breakdown`, use a lightweight dict to avoid recursion:

```python
# Instead of: passenger_breakdown: List[GroupPaymentAllocation]
# Use:
@dataclass
class PassengerBreakdownItem:
    item_id: str
    payment_type: str  # "cash" or "points"
    surcharge_usd: float
    cash_base_usd: float
    points_used: Optional[int]
    program_used: Optional[str]
    points_owner: Optional[str]

# In GroupPaymentAllocation:
passenger_breakdown: Optional[List[PassengerBreakdownItem]] = None
```

### 8. Test Function Consistency

Use these exact function names in tests:
- `minimize_group_out_of_pocket_with_fallback()` - multi-phase solver with metadata
- `solve_group_ilp()` - single-phase ILP solver
- `prune_dominated_options(item, soft_threshold_pct=0.95)` - pruning function
- `expand_party_to_passengers(items, max_expansion=6, bucket_size=3)` - expansion

**Do not mix `cash_threshold_pct` and `soft_threshold_pct` - use `soft_threshold_pct`.**

---

## Issue 0: No Dominance Pruning of Points Options

### Problem Description

The optimizer currently considers **all** points options provided, even those that are objectively worse than alternatives. This:

1. **Increases ILP size** unnecessarily (more decision variables)
2. **Can produce bad redemptions** where surcharge ≥ cash cost
3. **Slows solver time**, especially after passenger expansion

**Examples of dominated options:**

```
Flight cash cost: $300

Option A: 30,000 UA miles + $50 taxes  ✓ Valid
Option B: 35,000 UA miles + $60 taxes  ✗ Dominated by A (more points, more surcharge)
Option C: 25,000 DL miles + $350 taxes ✗ Dominated by cash (surcharge > cash cost!)
```

### Root Cause

No filtering step before ILP construction. All options from search results go directly to the optimizer.

### Proposed Solution: Pre-ILP Dominance Pruning

**Two-tier pruning thresholds:**

| Threshold | Default | Action | Rationale |
|-----------|---------|--------|-----------|
| HARD_PRUNE | `surcharge >= cash_cost` | Always remove | Never makes mathematical sense |
| SOFT_PRUNE | `surcharge >= 0.95 * cash_cost` | Remove by default | Marginal savings not worth points |

The soft threshold is configurable because some international departures have legitimately high taxes where 95% might be too aggressive.

```python
# Configuration
HARD_PRUNE_THRESHOLD = 1.0   # surcharge >= 100% of cash: always prune
SOFT_PRUNE_THRESHOLD = 0.95  # surcharge >= 95% of cash: prune by default

def prune_dominated_options(
    item: MemberBookingItem,
    soft_threshold_pct: float = SOFT_PRUNE_THRESHOLD,
    enable_soft_prune: bool = True,
) -> MemberBookingItem:
    """
    Remove points options that are dominated or economically worse than cash.
    
    TWO-TIER PRUNING:
    - Hard prune: surcharge >= cash_cost (ALWAYS remove, never makes sense)
    - Soft prune: surcharge >= soft_threshold_pct * cash_cost (configurable)
    
    PARETO DOMINANCE (within same program):
    - Sort options by points_required ascending
    - Keep option only if its surcharge is STRICTLY LOWER than all 
      previously kept options (at lower or equal points)
    
    Example (program UA, cash_cost=$300):
    
        Option 1: 20,000 pts, $40 surcharge → KEEP (first, best surcharge so far = $40)
        Option 2: 25,000 pts, $35 surcharge → KEEP (surcharge $35 < $40)
        Option 3: 25,000 pts, $45 surcharge → DROP (surcharge $45 >= $35)
        Option 4: 30,000 pts, $30 surcharge → KEEP (surcharge $30 < $35)
        Option 5: 35,000 pts, $50 surcharge → DROP (surcharge $50 >= $30)
    
    Why Option 3 is dominated: Option 2 has SAME points with LOWER surcharge.
    Why Option 5 is dominated: Option 4 has FEWER points with LOWER surcharge.
    
    Args:
        item: Booking item with points_options (per-pax costs)
        soft_threshold_pct: Soft prune if surcharge >= this % of cash cost
        enable_soft_prune: If False, only hard prune (surcharge >= cash)
        
    Returns:
        Item with pruned options list (mutates in place)
    """
    if not item.points_options:
        return item
    
    original_count = len(item.points_options)
    cash_cost = item.cash_cost  # Per-pax
    
    # Tier 1: HARD PRUNE (surcharge >= cash_cost)
    # These NEVER make sense - you'd pay more in taxes than the cash fare
    viable = [
        opt for opt in item.points_options 
        if opt.surcharge < cash_cost * HARD_PRUNE_THRESHOLD
    ]
    
    hard_pruned = original_count - len(viable)
    if hard_pruned > 0:
        logger.info(f"[Prune] {item.item_id}: Hard-pruned {hard_pruned} options "
                   f"(surcharge >= cash ${cash_cost:.2f})")
    
    # Tier 2: SOFT PRUNE (surcharge >= threshold)
    if enable_soft_prune:
        soft_threshold = cash_cost * soft_threshold_pct
        viable = [opt for opt in viable if opt.surcharge < soft_threshold]
        
        soft_pruned = (original_count - hard_pruned) - len(viable)
        if soft_pruned > 0:
            logger.info(f"[Prune] {item.item_id}: Soft-pruned {soft_pruned} options "
                       f"(surcharge >= {soft_threshold_pct*100:.0f}% of cash)")
    
    if not viable:
        logger.info(f"[Prune] {item.item_id}: All {original_count} points options "
                   f"dominated by cash")
        item.points_options = []
        return item
    
    # Tier 3: PARETO DOMINANCE within each program
    by_program: Dict[str, List[GroupPointsOption]] = {}
    for opt in viable:
        prog = opt.program_code.upper()
        if prog not in by_program:
            by_program[prog] = []
        by_program[prog].append(opt)
    
    pareto_optimal = []
    for prog, opts in by_program.items():
        # Sort by points_required ascending, then surcharge ascending (tiebreaker)
        opts.sort(key=lambda x: (x.points_required, x.surcharge))
        
        kept = []
        best_surcharge_so_far = float('inf')
        
        for opt in opts:
            if opt.surcharge < best_surcharge_so_far:
                # This option has LOWER surcharge than any kept option
                # with FEWER or EQUAL points → not dominated
                kept.append(opt)
                best_surcharge_so_far = opt.surcharge
            # else: This option has MORE points than some kept option
            # with LOWER or EQUAL surcharge → DOMINATED, skip
        
        pareto_optimal.extend(kept)
        
        pareto_pruned = len(opts) - len(kept)
        if pareto_pruned > 0:
            logger.info(f"[Prune] {item.item_id} {prog}: Pareto-pruned {pareto_pruned}, "
                       f"kept {len(kept)}/{len(opts)}")
    
    # Summary logging with min surcharge retained (helps debugging)
    final_count = len(pareto_optimal)
    if final_count > 0:
        min_surcharge_retained = min(opt.surcharge for opt in pareto_optimal)
    else:
        min_surcharge_retained = None
    
    if final_count < original_count:
        logger.info(
            f"[Prune] {item.item_id}: {original_count} → {final_count} options "
            f"(hard={hard_pruned}, soft={soft_pruned if enable_soft_prune else 0}, "
            f"pareto={original_count - hard_pruned - (soft_pruned if enable_soft_prune else 0) - final_count})"
            f"{f', min_surcharge=${min_surcharge_retained:.2f}' if min_surcharge_retained else ''}"
        )
    
    item.points_options = pareto_optimal
    return item


def prune_all_items(
    items: List[MemberBookingItem],
    soft_threshold_pct: float = SOFT_PRUNE_THRESHOLD,
    enable_soft_prune: bool = True,
) -> List[MemberBookingItem]:
    """
    Apply dominance pruning to all booking items.
    
    Returns:
        Items with pruned options (mutates in place)
    """
    total_before = sum(len(item.points_options) for item in items)
    
    for item in items:
        prune_dominated_options(item, soft_threshold_pct, enable_soft_prune)
    
    total_after = sum(len(item.points_options) for item in items)
    logger.info(f"[Prune] Total options: {total_before} → {total_after} "
               f"({total_before - total_after} removed across {len(items)} items)")
    
    return items
```

### Implementation Steps

1. **Create `prune_dominated_options()` function**
   - File: `backend/src/handlers/group_oop_optimizer.py`
   - Add before `solve_group_ilp()` (~line 275)

2. **Call pruning in `solve_group_ilp()`**
   - Before building decision variables
   - Log reduction in option count

3. **Add configuration parameter**
   - `DOMINANCE_CASH_THRESHOLD = 0.95` in optimizer config

### Why This is P0

- Reduces ILP size significantly (fewer `use_points` variables)
- Prevents obviously bad redemptions before they happen
- **Required before passenger expansion** (which multiplies variables)
- Simple to implement, no model changes needed

---

## Issue 1: Binary Booking Items Prevent Partial Point Coverage

### Problem Description

Currently, each booking item (e.g., "Bob's family flight JFK→CDG") is treated as an **atomic unit** with a single binary decision: pay 100% cash OR pay 100% points.

**Current Decision Variables:**
```python
# Binary: either cash or points, nothing in between
pay_cash[item.item_id] = {0, 1}
use_points[(item.item_id, program, owner_id)] = {0, 1}

# Constraint: exactly one payment method
pay_cash[item] + Σ use_points[item, *, *] == 1
```

**Problematic Scenario:**
```
Bob: party_size=4, has 50,000 Chase points
Flight needs: 60,000 points/person = 240,000 total

Bob's options:
❌ Use his 50,000 points → NOT ENOUGH (needs 240k)
❌ Partial coverage → NOT SUPPORTED
✓ Pay 100% cash → $2,400
✓ Someone else covers 100% → Requires 240k from another member
```

**Result:** Bob's 50,000 points are **completely useless for his own family's booking**. They can only be used for a different member's smaller booking, or go unused entirely.

### Root Cause

The `MemberBookingItem` dataclass treats a family as a single item with `party_size` as a multiplier:

```python
@dataclass
class MemberBookingItem:
    item_id: str
    member_id: str
    party_size: int = 1  # Multiplier, not separate items
    cash_cost: float     # Per-person cost
    points_options: List[GroupPointsOption]
```

The ILP then multiplies costs:
```python
# Line 324: All-cash cost
all_cash_cost = sum(item.cash_cost * item.party_size for item in booking_items)

# Line 421: Cash component in objective
pay_cash[item.item_id] * item.cash_cost * item.party_size
```

This is efficient for the solver but prevents mixed payment within a family.

### Proposed Solution: Per-Passenger Atomic Items (with Safeguards)

**Option A: Gated Expansion with Limits (Recommended)**

Transform family bookings into per-passenger items, but with safeguards to prevent ILP explosion:

```python
# Configuration
MAX_PASSENGER_EXPANSION = 6  # Don't expand beyond this
BUCKET_SIZE = 3              # If party > MAX, create buckets of this size

def expand_party_to_passengers(
    items: List[MemberBookingItem],
    *,
    enable_partial_coverage: bool = True,
    max_expansion: int = MAX_PASSENGER_EXPANSION,
    bucket_size: int = BUCKET_SIZE,
) -> Tuple[List[MemberBookingItem], Dict[str, List[str]]]:
    """
    Expand items with party_size > 1 into smaller units for mixed payment.
    
    Expansion rules:
    1. Only expand if enable_partial_coverage=True
    2. Only expand if party_size > 1 AND points options exist (else no benefit)
    3. If party_size <= max_expansion: expand to individual pax
    4. If party_size > max_expansion: expand to buckets of bucket_size
    
    Example (party_size=4):
        bob_flight → bob_flight_pax_1, bob_flight_pax_2, 
                     bob_flight_pax_3, bob_flight_pax_4
    
    Example (party_size=10, max=6, bucket=3):
        bob_flight → bob_flight_bucket_1 (size 3), bob_flight_bucket_2 (size 3),
                     bob_flight_bucket_3 (size 3), bob_flight_bucket_4 (size 1)
    """
    expanded = []
    expansion_map = {}  # original_id -> [expanded_ids]
    
    for item in items:
        # Gate 1: Expansion disabled
        if not enable_partial_coverage:
            expanded.append(item)
            expansion_map[item.item_id] = [item.item_id]
            continue
        
        # Gate 2: No benefit from expansion (no points options or single pax)
        if item.party_size == 1 or not item.points_options:
            expanded.append(item)
            expansion_map[item.item_id] = [item.item_id]
            continue
        
        # Gate 3: Decide expansion strategy
        expanded_ids = []
        
        if item.party_size <= max_expansion:
            # Individual passenger expansion
            for pax_idx in range(item.party_size):
                pax_item_id = f"{item.item_id}_pax_{pax_idx + 1}"
                expanded_ids.append(pax_item_id)
                
                pax_item = MemberBookingItem(
                    item_id=pax_item_id,
                    member_id=item.member_id,
                    item_type=item.item_type,
                    description=f"{item.description} (Pax {pax_idx + 1}/{item.party_size})",
                    cash_cost=item.cash_cost,
                    points_options=item.points_options,  # Reuse (immutable)
                    origin=item.origin,
                    destination=item.destination,
                    date=item.date,
                    airline=item.airline,
                    party_size=1,  # Atomic
                    original_item_id=item.item_id,
                    passenger_index=pax_idx,
                )
                expanded.append(pax_item)
        else:
            # Bucket expansion (party too large)
            remaining = item.party_size
            bucket_idx = 0
            while remaining > 0:
                this_bucket_size = min(bucket_size, remaining)
                bucket_item_id = f"{item.item_id}_bucket_{bucket_idx + 1}"
                expanded_ids.append(bucket_item_id)
                
                bucket_item = MemberBookingItem(
                    item_id=bucket_item_id,
                    member_id=item.member_id,
                    item_type=item.item_type,
                    description=f"{item.description} (Group {bucket_idx + 1}, {this_bucket_size} pax)",
                    cash_cost=item.cash_cost,  # Still per-person
                    points_options=item.points_options,
                    origin=item.origin,
                    destination=item.destination,
                    date=item.date,
                    airline=item.airline,
                    party_size=this_bucket_size,  # Bucket size
                    original_item_id=item.item_id,
                    bucket_index=bucket_idx,
                )
                expanded.append(bucket_item)
                
                remaining -= this_bucket_size
                bucket_idx += 1
            
            logger.info(f"[Expand] {item.item_id}: party_size={item.party_size} → "
                       f"{len(expanded_ids)} buckets (max_expansion={max_expansion})")
        
        expansion_map[item.item_id] = expanded_ids
    
    return expanded, expansion_map
```

**Benefits:**
- Bob's 50k points can now cover 2 of his 4 passengers
- Remaining 2 passengers can be cash or from Alice's points
- **Gated**: Only expands when beneficial
- **Bounded**: Large parties become buckets, not N separate items

**Drawbacks:**
- More decision variables (but bounded by max_expansion × bucket_size)
- Need to re-aggregate results for display
- **Operational consideration**: Expanded items may book as separate PNRs

**UI Implication:**
Surface `original_item_id` grouping in results: "These 4 passengers may book as separate tickets."

**Option B: Continuous Allocation Variables (Not Recommended)**

Allow fractional point coverage with continuous variables:
```python
# points_fraction[(item, program, owner)] ∈ [0, 1]
# Represents fraction of party covered by this source
```

**Why not recommended:**
- Operationally invalid (can't book 0.83 passengers on points)
- Would need rounding logic that could violate constraints
- Harder to explain to users

### Implementation Steps

1. **Add `original_item_id` and `passenger_index` fields to `MemberBookingItem`**
   - File: `backend/src/handlers/group_oop_optimizer.py`
   - Line: ~148-175

2. **Create `expand_party_to_passengers()` function**
   - File: `backend/src/handlers/group_oop_optimizer.py`
   - Add after dataclass definitions (~line 240)

3. **Call expansion in `solve_group_ilp()`**
   - File: `backend/src/handlers/group_oop_optimizer.py`
   - Line: ~313-320, before building decision variables

4. **Create `collapse_passenger_allocations()` to re-aggregate results**
   - Group allocations by `original_item_id` for display
   - Sum cash/points across passengers of same original item

5. **Update `_extract_group_solution()` to handle expanded items**
   - File: `backend/src/handlers/group_oop_optimizer.py`
   - Line: ~1029-1137

6. **Update frontend display to show aggregated family bookings**
   - Files: `frontend/src/app/(app)/group/results/page.tsx`, etc.

### Code Changes

```python
# In group_oop_optimizer.py

# Add MIXED payment type for collapsed allocations
class PaymentType(str, Enum):
    CASH = "cash"
    POINTS = "points"
    MIXED = "mixed"  # NEW: For collapsed family bookings with both


@dataclass
class MemberBookingItem:
    item_id: str
    member_id: str
    item_type: Literal["flight"]  # Flights only (hotels removed)
    description: str
    cash_cost: float
    points_options: List[GroupPointsOption] = field(default_factory=list)
    origin: Optional[str] = None
    destination: Optional[str] = None
    date: Optional[str] = None
    airline: Optional[str] = None
    is_shared: bool = False
    shared_among: List[str] = field(default_factory=list)
    party_size: int = 1
    # NEW: Track original grouping for passenger-level items
    original_item_id: Optional[str] = None
    passenger_index: Optional[int] = None
    bucket_index: Optional[int] = None  # For large party bucketization


# expand_party_to_passengers() is defined above in "Proposed Solution"
# Key changes:
#   - Gated by enable_partial_coverage flag
#   - max_expansion limit prevents ILP blowup
#   - Large parties bucketize instead of individual expansion


def collapse_passenger_allocations(
    allocations: List[GroupPaymentAllocation],
    expansion_map: Dict[str, List[str]],
) -> List[GroupPaymentAllocation]:
    """
    Re-aggregate per-passenger allocations back to family-level for display.
    
    IMPORTANT: This is display-only. Settlement calculations must use
    the atomic (expanded) allocations for accuracy.
    """
    # Build reverse map: expanded_id -> original_id
    reverse_map = {}
    for original_id, expanded_ids in expansion_map.items():
        for exp_id in expanded_ids:
            reverse_map[exp_id] = original_id
    
    # Group allocations by original item
    by_original: Dict[str, List[GroupPaymentAllocation]] = {}
    for alloc in allocations:
        original_id = reverse_map.get(alloc.item_id, alloc.item_id)
        if original_id not in by_original:
            by_original[original_id] = []
        by_original[original_id].append(alloc)
    
    # Collapse each group
    collapsed = []
    for original_id, group in by_original.items():
        if len(group) == 1:
            # Single item, no collapse needed
            collapsed.append(group[0])
        else:
            # Multiple passengers - create summary allocation
            total_cash = sum(a.cash_paid for a in group)
            total_points = sum(a.points_used or 0 for a in group)
            total_points_value = sum(a.points_value_usd or 0 for a in group)
            
            # Determine payment breakdown
            cash_pax = [a for a in group if a.payment_type == PaymentType.CASH]
            points_pax = [a for a in group if a.payment_type == PaymentType.POINTS]
            
            # Use MIXED enum for mixed payment scenarios
            if len(cash_pax) == len(group):
                summary_type = PaymentType.CASH
            elif len(points_pax) == len(group):
                summary_type = PaymentType.POINTS
            else:
                summary_type = PaymentType.MIXED  # Correct enum, not POINTS
            
            collapsed.append(GroupPaymentAllocation(
                item_id=original_id,
                beneficiary_member=group[0].beneficiary_member,
                payment_type=summary_type,
                cash_paid=total_cash,
                points_used=total_points if total_points > 0 else None,
                program_used=points_pax[0].program_used if points_pax else None,
                program_name=points_pax[0].program_name if points_pax else None,
                points_owner=None,  # Multiple possible in MIXED case
                points_value_usd=round(total_points_value, 2) if total_points_value > 0 else None,
                # NEW: Include per-passenger breakdown for UI drill-down
                passenger_breakdown=group,
            ))
    
    return collapsed
```

**Critical Note:** Settlement constraints and extraction must operate on **atomic items** (post-expansion), NOT collapsed allocations. The collapse is purely for display.

---

## Issue 2: Budget Constraints Ignore Settlement Debt

### Problem Description

The current budget constraint only checks **immediate cash out-of-pocket**:

```python
# Lines 537-562 in group_oop_optimizer.py
for member in members:
    if member.max_cash_budget is not None:
        member_cash = pl.lpSum(
            pay_cash[item.item_id] * item.cash_cost * item.party_size
            for item in booking_items
            if item.member_id == member.user_id
        )
        member_surcharges = pl.lpSum(
            use_points[...] * opt.surcharge * item.party_size
            ...
        )
        
        member_total = member_cash + member_surcharges
        m += member_total <= member.max_cash_budget  # Only cash OOP!
```

Settlement debt is calculated **after** optimization in `_calculate_settlements()` (line 1231), meaning:

1. Optimizer finds "feasible" solution where Bob pays $320 taxes (within $500 budget)
2. Settlement calculation reveals Bob owes Alice $4,000 for points used
3. Bob cannot/will not pay → Solution is **unusable**

### Proposed Solution: Settlement-Aware Budget Constraint

**CRITICAL: Unified Settlement Value Function**

The ILP constraint and settlement extraction MUST use the same function to avoid mismatches where the ILP rejects a solution based on uncapped FMV, even though capped settlement would be lower.

```python
def settlement_value_usd(
    program: str,
    points_used: int,
    cash_cost: float,
    surcharge: float,
) -> float:
    """
    Compute settlement value with FMV capping.
    
    MUST be used in BOTH:
    1. ILP settlement constraint (Issue 2)
    2. Settlement extraction (Issue 4)
    
    Args:
        program: Points program code
        points_used: Total points used (points_required * party_size)
        cash_cost: Total cash cost avoided (cash_cost * party_size)
        surcharge: Total surcharge (surcharge * party_size)
        
    Returns:
        Settlement value in USD, capped at cash avoided
    """
    uncapped_fmv = get_fair_market_value(program, points_used)
    cash_avoided = max(0, cash_cost - surcharge)
    return min(uncapped_fmv, cash_avoided)
```

**Option A: Add Max Settlement Constraint (Recommended)**

Add a per-member `max_settlement_owed` parameter and constrain it using `settlement_value_usd()`:

```python
# New member field
@dataclass
class GroupMember:
    ...
    max_settlement_owed: Optional[float] = None  # Max they're willing to owe
    
# Constraint uses CAPPED settlement value
settlement_owed[member_id] = pl.lpSum(
    use_points[(item, prog, owner)] * settlement_value_usd(
        program=prog,
        points_used=points_required * party_size,
        cash_cost=item.cash_cost * party_size,
        surcharge=opt.surcharge * party_size,
    )
    for item in booking_items if item.member_id == member_id
    for opt in item.points_options
    for owner in pool.by_member.keys()
    if owner != member_id  # Points from others
    and (item.item_id, opt.program_code, owner) in use_points
)

m += settlement_owed[member_id] <= member.max_settlement_owed
```

**Option B: Combined Effective Budget**

Constrain `cash_oop + settlement_owed <= effective_budget`:

```python
effective_oop = member_cash + member_surcharges + settlement_owed
m += effective_oop <= member.max_effective_budget
```

**Option C: User Choice at Join Time**

Add UI option when joining:
- "I'm willing to owe up to $X in settlement to other members"
- "Don't use others' points for my bookings if settlement exceeds $Y"

### Implementation Steps

1. **Add `max_settlement_owed` field to `GroupMember` dataclass**
   - File: `backend/src/handlers/group_oop_optimizer.py`
   - Line: ~86-108

2. **Add settlement constraint to ILP**
   - File: `backend/src/handlers/group_oop_optimizer.py`
   - After per-member budget constraints (~line 562)

3. **Update `join_trip` service to accept `max_settlement_owed`**
   - File: `backend/src/services/trip_member_service.py`

4. **Update `JoinTripRequest` schema**
   - File: `backend/src/app.py`

5. **Update frontend join page UI**
   - File: `frontend/src/app/(app)/group/join/[inviteCode]/page.tsx`
   - Add slider/input for max settlement

6. **Update API client**
   - File: `frontend/src/lib/api.ts`

### Code Changes

```python
# In group_oop_optimizer.py

@dataclass
class GroupMember:
    user_id: str
    name: str
    role: MemberRole = MemberRole.MEMBER
    departure_airport: str = "JFK"
    arrival_airport: Optional[str] = None
    travel_dates: Optional[Tuple[str, str]] = None
    cabin_preference: str = "Economy"
    points_balances: Dict[str, int] = field(default_factory=dict)
    max_cash_budget: Optional[float] = None
    willing_to_share_points: bool = True
    party_size: int = 1
    # NEW: Settlement constraints
    max_settlement_owed: Optional[float] = None  # Max $ willing to owe others
    include_settlement_in_budget: bool = False   # If True, cash + settlement <= budget


# In solve_group_ilp(), add after existing budget constraints:

# 4b. Per-member SETTLEMENT constraints (NEW)
# CRITICAL: Use settlement_value_usd() which caps FMV at cash avoided
for member in members:
    if member.max_settlement_owed is not None:
        # Calculate settlement this member would owe
        # (points used for their items, provided by others)
        #
        # settlement_value_usd() handles FMV capping, so ILP constraint
        # matches actual settlement calculation in extraction
        member_settlement = pl.lpSum(
            use_points[(item.item_id, opt.program_code, owner_id)]
            * settlement_value_usd(
                program=opt.program_code,
                points_used=opt.points_required * item.party_size,
                cash_cost=item.cash_cost * item.party_size,
                surcharge=opt.surcharge * item.party_size,
            )
            for item in booking_items
            if item.member_id == member.user_id
            for opt in item.points_options
            for owner_id in pool.by_member.keys()
            if owner_id != member.user_id  # Points from others
            and (item.item_id, opt.program_code, owner_id) in use_points
        )
        
        m += member_settlement <= member.max_settlement_owed, \
            f"max_settlement_{member.user_id}"
        
        logger.info(f"  Settlement constraint for {member.user_id}: "
                   f"<= ${member.max_settlement_owed}")

# 4c. Combined effective budget constraint (optional, if member opts in)
for member in members:
    if member.include_settlement_in_budget and member.max_cash_budget is not None:
        effective_oop = member_cash + member_surcharges + member_settlement
        m += effective_oop <= member.max_cash_budget, \
            f"effective_budget_{member.user_id}"
```

### Frontend Changes

```tsx
// In frontend/src/app/(app)/group/join/[inviteCode]/page.tsx

// Add state
const [maxSettlementOwed, setMaxSettlementOwed] = useState<number | ''>('');
const [includeSettlementInBudget, setIncludeSettlementInBudget] = useState(false);

// Add UI section after budget input
<div className="mt-6 pt-6 border-t border-slate-200">
    <div className="flex items-center gap-3 mb-4">
        <Info className="w-5 h-5 text-blue-600" />
        <div>
            <div className="font-medium text-slate-900">Settlement Preferences</div>
            <div className="text-sm text-slate-500">
                If others use their points for your booking, you'll owe them fair value
            </div>
        </div>
    </div>
    
    <div className="space-y-4">
        <div>
            <label className="block text-sm text-slate-600 mb-2">
                Maximum settlement I'm willing to owe
            </label>
            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                <input
                    type="number"
                    value={maxSettlementOwed}
                    onChange={(e) => setMaxSettlementOwed(e.target.value ? Number(e.target.value) : '')}
                    placeholder="No limit"
                    className="w-full pl-8 pr-4 py-3 border border-slate-200 rounded-xl"
                />
            </div>
            <p className="text-xs text-slate-500 mt-1">
                Leave blank for no limit. The optimizer won't create plans where you'd owe more.
            </p>
        </div>
        
        <label className="flex items-center gap-2 cursor-pointer">
            <input
                type="checkbox"
                checked={includeSettlementInBudget}
                onChange={(e) => setIncludeSettlementInBudget(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
            />
            <span className="text-sm text-slate-600">
                Include settlement in my budget limit (cash + settlement ≤ budget)
            </span>
        </label>
    </div>
</div>
```

---

## Issue 3: Party-Size Award Availability Not Verified

### Problem Description

The optimizer assumes if 1 award seat exists, `party_size` seats exist at the same price. This is often false:

1. **Availability:** Award inventory is limited; 4 seats may not exist even if 1 does
2. **Pricing:** Some programs have dynamic pricing that changes with quantity
3. **Routing:** Families may need to split across flights or connections

Current flow:
```
Flight Search → Returns option (1 seat verified)
                     ↓
Optimizer → Multiplies by party_size (assumes 4 seats exist)
                     ↓
Result → "Use 240,000 points" (but only 60,000-seat inventory exists)
```

### Proposed Solution: Party-Size Aware Option Generation

**Option A: Verify Availability Upstream (Recommended)**

Modify flight search to only return options if `party_size` inventory is available:

```python
# In flight search / option generation
def get_points_options_for_party(
    flight: FlightOffer,
    party_size: int,
    points_programs: List[str],
) -> List[GroupPointsOption]:
    """
    Only return points options if enough award seats exist for the party.
    """
    options = []
    
    for program in points_programs:
        award_availability = check_award_availability(
            flight=flight,
            program=program,
            seats_needed=party_size,
        )
        
        if award_availability.seats_available >= party_size:
            options.append(GroupPointsOption(
                program_code=program,
                points_required=award_availability.points_per_seat,
                surcharge=award_availability.taxes_per_seat,
                # Mark as party-verified
                verified_party_size=party_size,
            ))
        else:
            logger.info(f"Skipping {program} option: only {award_availability.seats_available} "
                       f"seats available, need {party_size}")
    
    return options
```

**Option B: Mark Options as Speculative**

If availability can't be verified, flag the option:

```python
@dataclass
class GroupPointsOption:
    ...
    availability_verified: bool = False
    verified_seats: Optional[int] = None
```

Then show warnings in UI: "Award availability not guaranteed for 4 passengers"

**Option C: Create Split Options**

If only 2 of 4 seats are available on points, create multiple item options:
- Option 1: 4 pax cash
- Option 2: 2 pax points + 2 pax cash (requires item splitting from Issue 1)

### Implementation Steps

1. **Update flight search to accept `party_size` parameter**
   - File: `backend/src/services/serp_api_functions.py`

2. **Add availability verification logic**
   - May require additional API calls to award search APIs

3. **Add `verified_party_size` field to `GroupPointsOption`**
   - File: `backend/src/handlers/group_oop_optimizer.py`

4. **Add UI warnings for unverified availability**
   - File: `frontend/src/app/(app)/group/results/page.tsx`

### Notes

This issue is **medium priority** because:
- It affects solution quality but not feasibility
- Users can verify availability during booking phase
- Full fix requires award availability API integration (complex)

---

## Issue 4: Fair Market Value Settlement Can Exceed Cash Value

### Problem Description

Settlement is calculated using fixed cents-per-point (CPP) values:

```python
# In fair_market_values.py
FAIR_MARKET_VALUES = {
    "UA": 1.5,   # 1.5 cents per point
    "chase": 2.0,
    ...
}

def get_fair_market_value(program: str, points: int) -> float:
    cpp = FAIR_MARKET_VALUES.get(program.upper(), 1.5)
    return points * cpp / 100
```

This can create perverse outcomes:

```
Cash fare: $300
Points option: 30,000 miles (taxes $50)
FMV at 1.5 cpp: $450

Result:
- Optimizer uses points (lower cash OOP: $50 vs $300)
- Settlement: beneficiary owes $450 for the points
- Beneficiary's total: $50 + $450 = $500 > $300 cash!
```

### Proposed Solution: Cap Settlement at Cash Avoided

**CRITICAL: Use Unified `settlement_value_usd()` from Issue 2**

The same function MUST be used in:
1. ILP settlement constraint (Issue 2)
2. Settlement extraction (this issue)

This function is defined in Issue 2:

```python
def settlement_value_usd(
    program: str,
    points_used: int,
    cash_cost: float,
    surcharge: float,
) -> float:
    """
    Compute settlement value with FMV capping.
    
    Args:
        program: Points program code
        points_used: Total points used (points_required * party_size)
        cash_cost: Total cash cost (cash_cost * party_size)
        surcharge: Total surcharge (surcharge * party_size)
        
    Returns:
        min(uncapped_fmv, cash_avoided) where cash_avoided = max(0, cash_cost - surcharge)
    """
    uncapped_fmv = get_fair_market_value(program, points_used)
    cash_avoided = max(0, cash_cost - surcharge)
    return min(uncapped_fmv, cash_avoided)
```

**Why this matters:** If the ILP uses uncapped FMV in constraints but extraction uses capped FMV, the ILP might reject feasible solutions or accept solutions that report different settlements than constrained.

**Part 2: Prevent Bad Redemptions at Dominance Pruning (Issue 0)**

The FMV cap handles settlement, but we should also **prevent the optimizer from choosing** these bad redemptions in the first place. This is handled by Issue 0's dominance pruning:

```python
# In prune_dominated_options() (from Issue 0):
if opt.surcharge >= item.cash_cost * DOMINANCE_CASH_THRESHOLD:
    # Surcharge alone is close to/exceeds cash - never choose this
    continue  # Skip this option
```

**Edge Case: What if surcharge >= cash_cost but optimizer still picks points?**

This can happen if:
1. Pruning threshold is too lenient (e.g., 95%)
2. Points option just barely passes pruning

In these cases, the FMV cap produces `cash_avoided <= 0`, meaning:
- Settlement value = $0
- Points owner gets no reimbursement
- Points are effectively "donated" to beneficiary

This is technically correct but can be confusing. Add a warning:

```python
# In settlement calculation
if cash_avoided <= 0:
    logger.warning(
        f"Points redemption for {item.item_id} has non-positive cash avoided "
        f"(cash=${item.cash_cost:.2f}, surcharge=${opt.surcharge:.2f}). "
        f"Points owner {owner_id} receives no settlement."
    )
```

### Implementation Steps

1. **Update `_extract_group_solution()` to use capped FMV**
   - File: `backend/src/handlers/group_oop_optimizer.py`
   - Line: ~1078

2. **Pass `cash_cost` to FMV calculation**
   - For atomic pax items: `cash_cost = item.cash_cost` (per pax)
   - For original items: `cash_cost = item.cash_cost * item.party_size`

3. **Add warning logs for zero/negative cash avoided cases**

4. **Document the capping logic in settlement explanation UI**

5. **Coordinate with Issue 0 dominance pruning to filter most of these cases upstream**

### Code Changes

```python
# In _extract_group_solution()
# MUST use settlement_value_usd() - same function as ILP constraint

for opt in item.points_options:
    for owner_id in pool.by_member.keys():
        key = (item.item_id, opt.program_code, owner_id)
        if key not in use_points:
            continue
        
        if pl.value(use_points[key]) > 0.5:
            # Compute totals (per-pax values × party_size)
            total_surcharge = opt.surcharge * item.party_size
            total_points = opt.points_required * item.party_size
            total_cash = item.cash_cost * item.party_size
            
            # CRITICAL: Use unified settlement_value_usd() from Issue 2
            # This ensures ILP constraint and extraction agree
            points_value = settlement_value_usd(
                program=opt.program_code,
                points_used=total_points,
                cash_cost=total_cash,
                surcharge=total_surcharge,
            )
            
            # Compute for logging
            uncapped_fmv = get_fair_market_value(opt.program_code, total_points)
            cash_avoided = max(0, total_cash - total_surcharge)
            
            # Log capping
            if points_value < uncapped_fmv:
                logger.info(f"Capped settlement for {item.item_id}: "
                           f"${uncapped_fmv:.2f} FMV → ${points_value:.2f} "
                           f"(cash avoided: ${cash_avoided:.2f})")
            
            # Warn on zero-value redemptions
            if cash_avoided <= 0:
                logger.warning(
                    f"Zero-value redemption for {item.item_id}: "
                    f"surcharge (${total_surcharge:.2f}) >= cash (${total_cash:.2f}). "
                    f"Points owner {owner_id} receives $0 settlement."
                )
```

---

## Issue 5: Balance Constraint Blocks Valid Solutions

### Problem Description

The "balanced points usage" constraint limits how much any single member can use:

```python
# Lines 606-631
if balance_points_usage and len(members) > 1:
    max_points_per_member = int((total_available_points / len(members)) * 1.5)
    
    for owner_id in pool.by_member.keys():
        m += owner_points_used <= max_points_per_member
```

**Problematic Scenario:**
```
Alice: 300,000 points
Bob: 0 points
Total pool: 300,000
Max per member: 225,000 (300k / 2 * 1.5)

Bob's family (party_size=4) needs: 240,000 points

Result: Alice can only use 225,000 → INFEASIBLE
```

Alice is **willing** to cover Bob's family (she has enough points), but the balance constraint prevents it.

### Proposed Solution: Multi-Phase Solve with Relaxation Cascade

Instead of ad-hoc retries, formalize a **relaxation cascade** with explicit modes and audit metadata:

**Relaxation Phases:**

| Phase | Balance Constraint | Settlement Caps | Budget Constraint | Use Case |
|-------|-------------------|-----------------|-------------------|----------|
| 1 (Strict) | ✓ Enabled | ✓ Enabled | ✓ Enabled | Ideal solution |
| 2 (Relax Balance) | ✗ Disabled | ✓ Enabled | ✓ Enabled | One whale subsidizing |
| 3 (Relax Settlement) | ✗ Disabled | ✗ Disabled | ✓ Enabled | High settlement tolerance |
| 4 (Best Effort) | ✗ Disabled | ✗ Disabled | ✓ Soft | Return closest feasible |

```python
class SolvePhase(str, Enum):
    STRICT = "strict"
    RELAX_BALANCE = "relax_balance"
    RELAX_SETTLEMENT = "relax_settlement"
    BEST_EFFORT = "best_effort"


@dataclass
class SolveMetadata:
    """Audit trail for solver decisions."""
    phase_used: SolvePhase
    constraints_relaxed: List[str]
    balance_constraint_active: bool
    settlement_caps_active: bool
    fallback_reason: Optional[str] = None
    phases_attempted: List[str] = field(default_factory=list)
    budget_overages: Dict[str, float] = field(default_factory=dict)  # member_id -> overage USD


def minimize_group_out_of_pocket_with_fallback(
    members: List[GroupMember],
    booking_items: List[MemberBookingItem],
    pool: GroupPointsPool,
    *,
    enable_balance: bool = True,
    enable_settlement_caps: bool = True,
    min_members_for_balance: int = 3,
) -> Tuple[GroupOOPSolution, str, SolveMetadata]:
    """
    Multi-phase solver with automatic relaxation.
    
    Returns:
        Tuple of (solution, status, metadata)
        metadata.phase_used tells which phase succeeded
        metadata.constraints_relaxed lists what was disabled
    """
    phases_attempted = []
    
    # Phase 1: STRICT
    phases_attempted.append("strict")
    solution, status = solve_group_ilp(
        members, booking_items, pool,
        balance_points_usage=enable_balance and len(members) >= min_members_for_balance,
        enforce_settlement_caps=enable_settlement_caps,
    )
    
    if status == "Optimal":
        return solution, status, SolveMetadata(
            phase_used=SolvePhase.STRICT,
            constraints_relaxed=[],
            balance_constraint_active=enable_balance,
            settlement_caps_active=enable_settlement_caps,
            phases_attempted=phases_attempted,
        )
    
    # Phase 2: RELAX_BALANCE
    phases_attempted.append("relax_balance")
    logger.info("[Fallback] Phase 2: Relaxing balance constraint")
    solution, status = solve_group_ilp(
        members, booking_items, pool,
        balance_points_usage=False,  # RELAXED
        enforce_settlement_caps=enable_settlement_caps,
    )
    
    if status == "Optimal":
        return solution, status, SolveMetadata(
            phase_used=SolvePhase.RELAX_BALANCE,
            constraints_relaxed=["balance_points_usage"],
            balance_constraint_active=False,
            settlement_caps_active=enable_settlement_caps,
            fallback_reason="Balance constraint caused infeasibility",
            phases_attempted=phases_attempted,
        )
    
    # Phase 3: RELAX_SETTLEMENT
    phases_attempted.append("relax_settlement")
    logger.info("[Fallback] Phase 3: Relaxing settlement caps")
    solution, status = solve_group_ilp(
        members, booking_items, pool,
        balance_points_usage=False,
        enforce_settlement_caps=False,  # RELAXED
    )
    
    if status == "Optimal":
        return solution, status, SolveMetadata(
            phase_used=SolvePhase.RELAX_SETTLEMENT,
            constraints_relaxed=["balance_points_usage", "max_settlement_owed"],
            balance_constraint_active=False,
            settlement_caps_active=False,
            fallback_reason="Settlement caps caused infeasibility",
            phases_attempted=phases_attempted,
        )
    
    # Phase 4: BEST_EFFORT with SOFT BUDGETS
    # Use slack variables + penalty to find closest feasible solution
    phases_attempted.append("best_effort")
    logger.warning("[Fallback] Phase 4: Using soft budgets to find closest solution")
    
    solution, status, budget_overages = solve_group_ilp_soft_budgets(
        members, booking_items, pool,
        balance_points_usage=False,
        enforce_settlement_caps=False,
    )
    
    return solution, status, SolveMetadata(
        phase_used=SolvePhase.BEST_EFFORT,
        constraints_relaxed=["balance_points_usage", "max_settlement_owed", "budgets (soft)"],
        balance_constraint_active=False,
        settlement_caps_active=False,
        fallback_reason="No fully feasible solution; returned closest with budget overages",
        phases_attempted=phases_attempted,
        budget_overages=budget_overages,  # NEW: Dict[member_id, overage_amount]
    )


def solve_group_ilp_soft_budgets(
    members: List[GroupMember],
    booking_items: List[MemberBookingItem],
    pool: GroupPointsPool,
    **kwargs,
) -> Tuple[GroupOOPSolution, str, Dict[str, float]]:
    """
    Solve ILP with soft budget constraints using slack variables.
    
    Instead of hard constraint: member_total <= budget
    Use: member_total <= budget + budget_overage[member]
    
    Objective: minimize(total_oop + BIG_M * sum(budget_overages))
    
    This ensures:
    1. Solver prefers solutions within budget (BIG_M penalty)
    2. If no feasible solution exists, returns closest solution
    3. budget_overages tells us exactly how much each member exceeds
    
    Returns:
        Tuple of (solution, status, budget_overages dict)
    """
    BIG_M = 100000  # Large penalty for budget violations
    
    m = pl.LpProblem("GroupOOP_SoftBudget", pl.LpMinimize)
    
    # ... existing variable definitions ...
    
    # Add slack variables for budget overages
    budget_overage = {}
    for member in members:
        if member.max_cash_budget is not None:
            budget_overage[member.user_id] = pl.LpVariable(
                f"budget_overage_{member.user_id}",
                lowBound=0,  # Non-negative
                cat="Continuous",
            )
    
    # Modify budget constraints to use slack
    for member in members:
        if member.max_cash_budget is not None:
            member_total = member_cash[member.user_id] + member_surcharges[member.user_id]
            # Soft constraint: allow overage but penalize it
            m += member_total <= member.max_cash_budget + budget_overage[member.user_id], \
                f"soft_budget_{member.user_id}"
    
    # Objective: minimize OOP + heavy penalty for budget violations
    # This ensures solver strongly prefers staying within budget
    total_penalty = pl.lpSum(
        BIG_M * budget_overage[member.user_id]
        for member in members
        if member.user_id in budget_overage
    )
    
    m += total_oop_objective + total_penalty, "Objective"
    
    # Solve
    m.solve(pl.PULP_CBC_CMD(msg=0))
    
    # Extract budget overages
    overages = {}
    for member_id, var in budget_overage.items():
        overage_value = pl.value(var)
        if overage_value and overage_value > 0.01:  # Small threshold
            overages[member_id] = round(overage_value, 2)
            logger.warning(f"Member {member_id} exceeds budget by ${overage_value:.2f}")
    
    # ... rest of extraction ...
    
    return solution, pl.LpStatus[m.status], overages
```

### Implementation Steps

1. **Create `SolvePhase` enum and `SolveMetadata` dataclass**
   - File: `backend/src/handlers/group_oop_optimizer.py`

2. **Add `min_members_for_balance` parameter to `solve_group_ilp()`**
   - Default to 3 (only apply for groups of 4+)

3. **Implement `minimize_group_out_of_pocket_with_fallback()`**
   - Replace current two-phase logic with multi-phase cascade

4. **Return metadata in API response**
   - File: `backend/src/routes/optimize.py`
   - Include `solve_metadata` in response body

5. **Display warnings in UI when constraints were relaxed**
   - File: `frontend/src/app/(app)/group/results/page.tsx`
   - Show banner: "Balance constraint was relaxed to find a solution"

### Code Changes

```python
# In solve_group_ilp()

def solve_group_ilp(
    members: List[GroupMember],
    booking_items: List[MemberBookingItem],
    pool: GroupPointsPool,
    *,
    balance_points_usage: bool = True,
    min_members_for_balance: int = 3,  # NEW
    enforce_settlement_caps: bool = True,  # NEW
    ...
) -> Tuple[GroupOOPSolution, str]:
    
    # 8. BALANCED POINTS USAGE CONSTRAINT
    # Only apply for groups large enough where imbalance matters
    should_balance = (
        balance_points_usage 
        and len(members) >= min_members_for_balance
        and len(pool.by_member) > 1
    )
    
    if should_balance:
        total_available_points = sum(
            sum(owner_points.values())
            for owner_points in pool.by_member.values()
        )
        
        max_points_per_member = int((total_available_points / len(members)) * 1.5)
        
        if max_points_per_member > 0:
            for owner_id in pool.by_member.keys():
                owner_points_used = pl.lpSum(...)
                m += owner_points_used <= max_points_per_member
            
            logger.info(f"[GroupILP] Balance constraint: max {max_points_per_member:,} pts/member")
    else:
        logger.info(f"[GroupILP] Balance constraint DISABLED "
                   f"(members={len(members)}, min_required={min_members_for_balance})")
    
    # 9. SETTLEMENT CAPS (from Issue 2)
    if enforce_settlement_caps:
        # ... settlement constraint code ...
        pass
    else:
        logger.info("[GroupILP] Settlement caps DISABLED")
```

---

## Issue 6: Booker Attribution Policy (REFRAMED)

### Problem Description

The current implementation assigns surcharges to the **beneficiary** (traveler), but who actually pays at booking depends on the **booking flow**:

```
Case A: Owner books directly
  - Alice redeems her United miles for Bob's flight
  - Alice's credit card is charged for $320 taxes
  - Alice is the "booker"

Case B: Transfer to beneficiary's account
  - Alice transfers Chase points to Bob's United account
  - Bob books the flight using HIS United account
  - Bob's credit card is charged for $320 taxes
  - Bob is the "booker"
```

Blindly assigning surcharge to `owner_id` OR `beneficiary` will be wrong in some cases.

### Why This Is Complex

Different programs have different booking semantics:
- **Bank transfer programs (Chase, Amex, Citi):** Points transfer to beneficiary's airline account → beneficiary books
- **Airline redemptions (same account):** Owner books for beneficiary → owner pays surcharge
- **Partner bookings:** May vary based on partner program rules

The current codebase likely has `transfer_from_bank`, `available_from` fields that encode this, but doesn't use them for surcharge attribution.

### Proposed Solution: Booker Determination Rule

**Step 1: Add `booker_member` to allocation model**

```python
@dataclass
class GroupPaymentAllocation:
    item_id: str
    beneficiary_member: str  # Who travels
    points_owner: Optional[str]  # Whose points are used
    booker_member: Optional[str]  # NEW: Who pays surcharge at booking
    ...
```

**Step 2: Implement booker determination logic**

```python
def determine_booker(
    opt: GroupPointsOption,
    owner_id: str,
    beneficiary_id: str,
) -> str:
    """
    Determine who is responsible for paying surcharge at booking.
    
    Rules:
    1. If points require transfer to beneficiary's account (bank → airline),
       then beneficiary books and pays surcharge.
    2. If points are redeemed directly from owner's account (airline),
       then owner books and pays surcharge.
    """
    # Transfer programs: points move to beneficiary's account
    if opt.transfer_from_bank:
        # Chase UR → United: beneficiary's United account, beneficiary books
        return beneficiary_id
    
    # Direct redemption: owner's account, owner books
    return owner_id


# Example usage in _extract_group_solution():
booker_id = determine_booker(opt, owner_id, beneficiary_id)
oop_per_member[booker_id] += surcharge
```

**Step 3: Compute effective OOP after all attributions**

```python
# Per-member breakdown
cash_oop_per_member: Dict[str, float]   # What they pay at booking (cash + surcharge if booker)
net_after_settlement: Dict[str, float]  # cash_oop + settlement_owed - settlement_received
```

### Implementation Steps

1. **Add `booker_member` field to `GroupPaymentAllocation`**
   - File: `backend/src/handlers/group_oop_optimizer.py`

2. **Create `determine_booker()` function**
   - Start with simple rule based on `transfer_from_bank`
   - Can be refined later per-program

3. **Update `_extract_group_solution()` to compute booker and attribute surcharge correctly**

4. **Update budget constraint to use correct member for surcharge**
   - Surcharge should count against **booker's** budget, not beneficiary's

5. **Update frontend to show booking responsibility**
   - "Alice provides 50,000 UA miles. Bob books and pays $320 taxes."

### Code Changes

```python
# In group_oop_optimizer.py

def determine_booker(
    opt: GroupPointsOption,
    owner_id: str,
    beneficiary_id: str,
) -> str:
    """
    Determine who books (and pays surcharge).
    
    Transfer chain:
      Bank (Chase) → Airline (United) → Booking
      
    If transfer_from_bank is set, points move to beneficiary's airline
    account, so beneficiary books. Otherwise, owner redeems directly.
    """
    if opt.transfer_from_bank:
        # Points transferred to beneficiary's airline account
        # Beneficiary has the miles in their account and books
        return beneficiary_id
    else:
        # Owner redeems directly from their airline account
        # (e.g., owner's United account books for beneficiary)
        return owner_id


# In _extract_group_solution()
for opt in item.points_options:
    for owner_id in pool.by_member.keys():
        key = (item.item_id, opt.program_code, owner_id)
        if key not in use_points:
            continue
        
        if pl.value(use_points[key]) > 0.5:
            surcharge = opt.surcharge * item.party_size
            points_used = opt.points_required * item.party_size
            beneficiary_id = item.member_id
            
            # NEW: Determine who books
            booker_id = determine_booker(opt, owner_id, beneficiary_id)
            
            allocation = GroupPaymentAllocation(
                item_id=item.item_id,
                beneficiary_member=beneficiary_id,
                payment_type=PaymentType.POINTS,
                cash_paid=surcharge,  # Booker pays this
                points_used=points_used,
                points_owner=owner_id,
                booker_member=booker_id,  # NEW
                ...
            )
            
            # Attribute surcharge to booker, not beneficiary
            total_oop += surcharge
            oop_per_member[booker_id] += surcharge
```

### Why Phase 3 (Deferred)

This is deferred because:
1. Requires understanding of program-specific booking rules
2. Current attribution (to beneficiary) isn't catastrophically wrong—just sometimes inaccurate
3. Must be implemented after Phase 2 (passenger splitting) to handle per-pax surcharges correctly
4. Frontend needs rework to show booker vs beneficiary clearly

### CRITICAL: ILP Budget Constraint Must Change

When booker attribution is implemented, the **ILP budget constraint itself must route surcharges to the correct member**, not just post-solve accounting.

**Current (wrong after Phase 3):**
```python
# Surcharges attributed to beneficiary (item.member_id)
member_surcharges = pl.lpSum(
    use_points[(item.item_id, opt.program_code, owner_id)]
    * opt.surcharge * item.party_size
    for item in booking_items
    if item.member_id == member.user_id  # ← WRONG: beneficiary
    for opt in item.points_options
    for owner_id in pool.by_member.keys()
)
```

**Required (Phase 3):**
```python
# Surcharges attributed to BOOKER (deterministic from opt + owner + beneficiary)
# Booker is known at constraint-build time because determine_booker() is pure
member_surcharges = pl.lpSum(
    use_points[(item.item_id, opt.program_code, owner_id)]
    * opt.surcharge * item.party_size
    for item in booking_items
    for opt in item.points_options
    for owner_id in pool.by_member.keys()
    if determine_booker(opt, owner_id, item.member_id) == member.user_id  # ← CORRECT
    and (item.item_id, opt.program_code, owner_id) in use_points
)
```

**Why this works:** `determine_booker(opt, owner_id, beneficiary_id)` is deterministic (no decision variables), so we can compute at constraint-build time which member would be the booker for each `use_points` term. The `use_points` binary variable then "activates" the surcharge term against the correct member's budget.

**If you don't do this:** Budgets will be enforced on the wrong person, and a "feasible" solution could have Bob within budget while Alice (the actual booker) exceeds hers.

---

## Implementation Phases (REVISED)

Based on feedback, reordered phases to prioritize safety and ILP efficiency.

### Phase 1: Dominance Pruning + Safety Constraints (Do First)

**Goal:** Reduce ILP size, prevent bad redemptions, add settlement safety.

| Task | Files | Priority | Notes |
|------|-------|----------|-------|
| 1.1 Add `prune_dominated_options()` | `group_oop_optimizer.py` | **P0** | Filter surcharge >= cash_cost, remove Pareto-dominated |
| 1.2 Add `max_settlement_owed` constraint | `group_oop_optimizer.py`, `trip_member_service.py`, `app.py` | **P0** | Settlement-aware budget |
| 1.3 Cap FMV at cash avoided | `group_oop_optimizer.py` | **P0** | Prevent settlement > cash |
| 1.4 Multi-phase solve with metadata | `group_oop_optimizer.py` | **P1** | `SolveMetadata`, relaxation cascade |

**Why P0:**
- Dominance pruning reduces ILP size (fewer variables/constraints)
- Required before passenger expansion (multiplicative effect)
- Prevents obviously bad redemptions from being chosen

### Phase 2: Per-Passenger Item Splitting

**Goal:** Enable mixed payment within families.

| Task | Files | Priority | Notes |
|------|-------|----------|-------|
| 2.1 Add `expand_party_to_passengers()` with safeguards | `group_oop_optimizer.py` | **P1** | `MAX_EXPANSION=6`, bucketize if larger |
| 2.2 Add `collapse_passenger_allocations()` with MIXED enum | `group_oop_optimizer.py` | **P1** | Display-only collapse |
| 2.3 Ensure settlement uses atomic items (not collapsed) | `group_oop_optimizer.py` | **P1** | Critical for accuracy |
| 2.4 Add `original_item_id`, `passenger_index`, `bucket_index` fields | `group_oop_optimizer.py` | **P1** | Tracking |
| 2.5 Update frontend to show pax breakdown | `group/results/page.tsx` | **P2** | "These may book as separate tickets" |

**Safeguards:**
- Gate expansion: only if `party_size > 1` AND `points_options` exist
- Limit expansion: `MAX_PASSENGER_EXPANSION = 6`
- Bucketize large parties: `BUCKET_SIZE = 3`

### Phase 3: Booker Attribution Policy

**Goal:** Correct surcharge attribution based on booking flow.

| Task | Files | Priority | Notes |
|------|-------|----------|-------|
| 3.1 Add `booker_member` field to allocation | `group_oop_optimizer.py` | **P2** | |
| 3.2 Implement `determine_booker()` | `group_oop_optimizer.py` | **P2** | Based on `transfer_from_bank` |
| 3.3 Update budget constraint to use booker | `group_oop_optimizer.py` | **P2** | Surcharge against booker's budget |
| 3.4 Update frontend to show booker vs beneficiary | `group/results/page.tsx` | **P3** | |

**Deferred because:** Requires understanding program rules; current behavior isn't catastrophically wrong.

### Phase 4: UI/UX Improvements

**Goal:** Better user experience and control.

| Task | Files | Priority | Notes |
|------|-------|----------|-------|
| 4.1 Add settlement preferences UI | `group/join/[inviteCode]/page.tsx` | **P2** | `max_settlement_owed` input |
| 4.2 Show solver metadata warnings | `group/results/page.tsx` | **P2** | "Balance constraint was relaxed" |
| 4.3 Show per-passenger breakdown with drill-down | `group/results/page.tsx` | **P3** | |
| 4.4 Show availability warnings for unverified options | `group/results/page.tsx` | **P3** | |

### Phase 5: Award Availability Verification (Future)

**Estimated Effort:** 5+ days (requires API integration)

| Task | Files | Priority |
|------|-------|----------|
| 5.1 Party-size aware search | `serp_api_functions.py` | **P3** |
| 5.2 Mark speculative options | `group_oop_optimizer.py` | **P3** |

---

## Schema Plumbing Checklist

**New fields must flow through ALL these layers consistently. Missing any layer will cause silent bugs.**

### Backend Request → Service → Persistence

| Field | Request Schema | Service Function | Persistence | Read Path |
|-------|---------------|------------------|-------------|-----------|
| `party_size` | `JoinTripRequest.party_size: int = Field(1, ge=1)` | `trip_member_service.join_trip(..., party_size: int)` | Store in member record | Return in dashboard + optimizer input |
| `adults` | `JoinTripRequest.adults: int = Field(1, ge=1)` | `trip_member_service.join_trip(..., adults: int)` | Store in member record | Return in dashboard |
| `children` | `JoinTripRequest.children: int = Field(0, ge=0)` | `trip_member_service.join_trip(..., children: int)` | Store in member record | Return in dashboard |
| `max_settlement_owed` | `JoinTripRequest.max_settlement_owed: Optional[float]` | `trip_member_service.join_trip(..., max_settlement_owed: Optional[float])` | Store in member record | Return to optimizer via `GroupMember` |
| `include_settlement_in_budget` | `JoinTripRequest.include_settlement_in_budget: bool = False` | Pass through | Store in member record | Return to optimizer |

### Implementation Checklist

**Step 1: Backend Request Schema (`app.py`)**
```python
class JoinTripRequest(BaseModel):
    invite_code: str
    # ... existing fields ...
    
    # NEW: Party size fields
    party_size: int = Field(1, ge=1, description="Total travelers in booking")
    adults: int = Field(1, ge=1, description="Number of adults")
    children: int = Field(0, ge=0, description="Number of children")
    
    # NEW: Settlement preferences
    max_settlement_owed: Optional[float] = Field(None, ge=0, description="Max USD willing to owe others")
    include_settlement_in_budget: bool = Field(False, description="If True, cash + settlement <= budget")
    
    @validator('party_size', always=True)
    def validate_party_size(cls, v, values):
        adults = values.get('adults', 1)
        children = values.get('children', 0)
        expected = adults + children
        if v != expected:
            return expected  # Auto-compute from adults + children
        return v
```

**Step 2: Service Layer (`trip_member_service.py`)**
```python
def join_trip(
    user_id: str,
    invite_code: str,
    *,
    # ... existing params ...
    party_size: int = 1,
    adults: int = 1,
    children: int = 0,
    max_settlement_owed: Optional[float] = None,
    include_settlement_in_budget: bool = False,
) -> Dict[str, Any]:
    # Validate
    if party_size < 1:
        raise ValueError("party_size must be >= 1")
    if adults < 1:
        raise ValueError("adults must be >= 1")
    
    # Build member record
    item = {
        # ... existing fields ...
        "party_size": party_size,
        "adults": adults,
        "children": children,
        "max_settlement_owed": max_settlement_owed,
        "include_settlement_in_budget": include_settlement_in_budget,
    }
    
    # Persist (DynamoDB / SQL / etc.)
    # ...
```

**Step 3: Persistence Layer**

Ensure your database schema/table can store these fields. For DynamoDB:
```python
# Member record attributes
{
    "pk": f"TRIP#{trip_id}",
    "sk": f"MEMBER#{user_id}",
    "party_size": 4,
    "adults": 2,
    "children": 2,
    "max_settlement_owed": 500.00,  # Optional, can be None
    "include_settlement_in_budget": False,
    # ... other fields ...
}
```

**Step 4: Read Path (`group_api.py` or wherever members are fetched)**
```python
def get_trip_members(trip_id: str) -> List[Dict]:
    """Fetch members for dashboard display AND optimizer input."""
    members = db.query(pk=f"TRIP#{trip_id}", sk_begins_with="MEMBER#")
    
    return [
        {
            "user_id": m["user_id"],
            "name": m["name"],
            "party_size": m.get("party_size", 1),
            "adults": m.get("adults", 1),
            "children": m.get("children", 0),
            "max_settlement_owed": m.get("max_settlement_owed"),
            "include_settlement_in_budget": m.get("include_settlement_in_budget", False),
            # ... other fields ...
        }
        for m in members
    ]
```

**Step 5: Optimizer Input Assembly**

When building `GroupMember` for the optimizer:
```python
def build_group_members(trip_id: str) -> List[GroupMember]:
    member_records = get_trip_members(trip_id)
    
    return [
        GroupMember(
            user_id=m["user_id"],
            name=m["name"],
            party_size=m["party_size"],
            max_settlement_owed=m.get("max_settlement_owed"),
            include_settlement_in_budget=m.get("include_settlement_in_budget", False),
            # ... other fields ...
        )
        for m in member_records
    ]
```

### Frontend Checklist

| Component | File | Changes |
|-----------|------|---------|
| Join form | `group/join/[inviteCode]/page.tsx` | Add inputs for `adults`, `children`, `max_settlement_owed` |
| API call | `lib/api.ts` | Include new fields in `tripsAPI.join()` body |
| Dashboard | `group/dashboard/page.tsx` | Display party size, settlement prefs (read-only) |
| Results | `group/results/page.tsx` | Display `original_item_id` grouping, `SolveMetadata` warnings |

---

## Testing Plan (EXPANDED)

### Flight-Only Unit Tests

```python
# tests/test_group_optimizer_party_size.py

# ============================================================
# ISSUE 0: DOMINANCE PRUNING TESTS
# ============================================================

def test_no_dominated_redemptions_surcharge_exceeds_cash():
    """
    Points options where surcharge >= cash_cost should never be chosen.
    These should be pruned before ILP construction.
    """
    items = [
        MemberBookingItem(
            item_id="flight",
            member_id="bob",
            item_type="flight",
            cash_cost=100,  # $100 cash fare
            points_options=[
                GroupPointsOption("UA", 10000, 95),   # Surcharge $95 (~95% of cash) - SHOULD BE PRUNED
                GroupPointsOption("AA", 10000, 110),  # Surcharge $110 (>cash) - SHOULD BE PRUNED
                GroupPointsOption("DL", 8000, 30),    # Surcharge $30 - OK to keep
            ],
        ),
    ]
    
    # After pruning, only DL option should remain
    pruned = prune_all_items(items, soft_threshold_pct=0.95)
    
    assert len(pruned[0].points_options) == 1
    assert pruned[0].points_options[0].program_code == "DL"


def test_no_pareto_dominated_options():
    """
    If option A has >= points AND >= surcharge than option B (same program),
    option A should be pruned.
    """
    items = [
        MemberBookingItem(
            item_id="flight",
            member_id="bob",
            item_type="flight",
            cash_cost=500,
            points_options=[
                GroupPointsOption("UA", 25000, 50),   # Better: fewer points, same surcharge
                GroupPointsOption("UA", 30000, 50),   # DOMINATED: more points, same surcharge
                GroupPointsOption("UA", 25000, 80),   # DOMINATED: same points, more surcharge
            ],
        ),
    ]
    
    pruned = prune_all_items(items)
    
    # Only the 25k/50 option should survive
    assert len(pruned[0].points_options) == 1
    assert pruned[0].points_options[0].points_required == 25000
    assert pruned[0].points_options[0].surcharge == 50


# ============================================================
# ISSUE 1: PASSENGER EXPANSION TESTS
# ============================================================

def test_partial_point_coverage_with_expansion():
    """
    Bob (party_size=4, 50k points) should be able to use his points
    for some passengers. The exact number depends on solver optimization.
    
    Key assertion: Bob's points ARE used (not wasted), and mixed payment
    is possible (some pax on points, some on cash or Alice's points).
    """
    members = [
        GroupMember(user_id="bob", party_size=4, 
                   points_balances={"UA": 50000}, max_cash_budget=2000),
        GroupMember(user_id="alice", party_size=1,
                   points_balances={"UA": 200000}, max_cash_budget=500),
    ]
    
    items = [
        MemberBookingItem(
            item_id="bob_flight",
            member_id="bob",
            item_type="flight",
            party_size=4,  # Will be expanded to 4 items
            cash_cost=500,
            points_options=[GroupPointsOption("UA", 25000, 50)],
        ),
    ]
    
    # Build pool from members
    pool = build_pool_from_members(members)
    
    # Use the multi-phase solver
    solution, status, metadata = minimize_group_out_of_pocket_with_fallback(
        members, items, pool
    )
    
    assert status == "Optimal"
    
    # Key assertions:
    # 1. Bob's points should be used (at least partially)
    bob_points_used = sum(
        a.points_used or 0 
        for a in solution.allocations 
        if a.points_owner == "bob"
    )
    assert bob_points_used > 0, "Bob's points should be utilized, not wasted"
    assert bob_points_used <= 50000, "Bob can't use more points than he has"
    
    # 2. Solution should have mixed payment (not all one type)
    # This proves expansion enabled partial coverage
    bob_allocations = [a for a in solution.allocations if "bob" in a.item_id]
    payment_types = set(a.payment_type for a in bob_allocations)
    # Note: Could be all POINTS if Alice covers remaining, that's valid too
    # The key is that Bob's limited points didn't block the whole booking


def test_expansion_feasibility_and_settlement_on_atomic_items():
    """
    After expansion, settlement calculations must use atomic items (post-expansion),
    not collapsed allocations.
    """
    items = [
        MemberBookingItem(
            item_id="bob_flight",
            member_id="bob",
            item_type="flight",
            party_size=4,
            cash_cost=500,
            points_options=[GroupPointsOption("UA", 25000, 50)],
        ),
    ]
    
    # Expand
    expanded, expansion_map = expand_party_to_passengers(items)
    
    assert len(expanded) == 4, "Should expand to 4 atomic items"
    assert len(expansion_map["bob_flight"]) == 4
    
    # Solve
    solution = minimize_group_out_of_pocket(members, expanded, pool)
    
    # Verify settlements computed per atomic item
    for settlement in solution.settlements:
        # Settlement item_id should be atomic (pax-level), not original
        assert "_pax_" in settlement.item_id or settlement.item_id in expansion_map


def test_solver_size_guard_bucketization():
    """
    party_size=10 should NOT create 10 separate items.
    Instead, it should bucketize into groups of BUCKET_SIZE.
    """
    items = [
        MemberBookingItem(
            item_id="big_family_flight",
            member_id="bob",
            item_type="flight",
            party_size=10,  # Large family
            cash_cost=500,
            points_options=[GroupPointsOption("UA", 25000, 50)],
        ),
    ]
    
    # Expand with max_expansion=6, bucket_size=3
    expanded, expansion_map = expand_party_to_passengers(
        items,
        max_expansion=6,
        bucket_size=3,
    )
    
    # Should create 4 buckets: [3, 3, 3, 1] = 10 total
    assert len(expanded) == 4, f"Expected 4 buckets, got {len(expanded)}"
    
    bucket_sizes = [e.party_size for e in expanded]
    assert sum(bucket_sizes) == 10, "Total party size must be preserved"
    assert max(bucket_sizes) <= 3, "No bucket should exceed BUCKET_SIZE"


def test_expansion_map_immutability():
    """
    expansion_map[item.item_id] = [item.item_id] for unexpanded items
    must not break if original item_id is later referenced.
    
    This tests that we don't mutate item_ids after building the map.
    """
    items = [
        MemberBookingItem(
            item_id="single_pax_flight",
            member_id="alice",
            item_type="flight",
            party_size=1,  # Won't expand
            cash_cost=500,
            points_options=[],
        ),
    ]
    
    expanded, expansion_map = expand_party_to_passengers(items)
    
    # Single-pax item should map to itself
    assert expansion_map["single_pax_flight"] == ["single_pax_flight"]
    
    # Verify the item_id wasn't mutated
    assert expanded[0].item_id == "single_pax_flight"


# ============================================================
# ISSUE 2: SETTLEMENT CONSTRAINT TESTS
# ============================================================

def test_settlement_within_budget():
    """
    Bob (max_settlement_owed=$500) should not be assigned solutions
    where settlement exceeds $500.
    """
    members = [
        GroupMember(user_id="bob", party_size=2, 
                   points_balances={}, max_cash_budget=200,
                   max_settlement_owed=500),  # NEW field
        GroupMember(user_id="alice", party_size=1,
                   points_balances={"chase": 100000}, max_cash_budget=1000),
    ]
    
    items = [
        MemberBookingItem(
            item_id="bob_flight",
            member_id="bob",
            item_type="flight",
            party_size=2,
            cash_cost=800,  # $1600 total
            points_options=[GroupPointsOption("UA", 40000, 50)],  # 80k pts
        ),
    ]
    
    solution = minimize_group_out_of_pocket(members, items, pool)
    
    # Calculate settlement Bob owes
    bob_settlement = sum(
        s.amount_usd for s in solution.settlements
        if s.from_member == "bob"
    )
    
    assert bob_settlement <= 500, f"Bob's settlement ({bob_settlement}) exceeds max"


# ============================================================
# ISSUE 4: FMV CAPPING TESTS
# ============================================================

def test_fmv_capped_at_cash_avoided():
    """
    Settlement should never exceed the cash cost that was avoided.
    """
    # 30k points at 1.5cpp = $450 FMV
    # But cash cost is only $300
    # Settlement should be capped at $300 - $50 = $250
    
    members = [
        GroupMember(user_id="bob", points_balances={}),
        GroupMember(user_id="alice", points_balances={"UA": 100000}),
    ]
    
    items = [
        MemberBookingItem(
            item_id="flight",
            member_id="bob",
            item_type="flight",
            cash_cost=300,
            points_options=[GroupPointsOption("UA", 30000, 50)],
        ),
    ]
    
    solution = minimize_group_out_of_pocket(members, items, pool)
    
    for alloc in solution.allocations:
        if alloc.payment_type == PaymentType.POINTS:
            cash_avoided = 300 - 50  # cash_cost - surcharge = $250
            assert alloc.points_value_usd <= cash_avoided, \
                f"FMV ({alloc.points_value_usd}) exceeds cash avoided ({cash_avoided})"


def test_zero_value_redemption_warning():
    """
    When surcharge >= cash_cost, cash_avoided <= 0 and settlement value = $0.
    This should be pruned by dominance, but if not, FMV cap handles it.
    """
    # This option should be pruned, but test FMV cap as fallback
    items = [
        MemberBookingItem(
            item_id="flight",
            member_id="bob",
            item_type="flight",
            cash_cost=100,
            points_options=[GroupPointsOption("UA", 10000, 120)],  # Surcharge > cash
        ),
    ]
    
    # Without pruning, if this option is somehow chosen:
    # cash_avoided = 100 - 120 = -20
    # FMV cap = max(0, -20) = 0
    
    # This tests the safety net, though pruning should prevent this case
    cash_avoided = 100 - 120
    capped_fmv = max(0, cash_avoided)
    assert capped_fmv == 0


# ============================================================
# ISSUE 5: BALANCE CONSTRAINT TESTS
# ============================================================

def test_balance_constraint_disabled_for_small_groups():
    """
    Balance constraint should not apply for 2-person groups.
    """
    members = [
        GroupMember(user_id="alice", points_balances={"chase": 300000}),
        GroupMember(user_id="bob", points_balances={}),  # No points
    ]
    
    items = [
        MemberBookingItem(
            item_id="bob_flight",
            member_id="bob",
            item_type="flight",
            cash_cost=500,
            points_options=[GroupPointsOption("UA", 60000, 50)],
        ),
    ]
    
    # Alice should be able to use all 300k for Bob even though
    # "fair share" would be 150k each
    solution = minimize_group_out_of_pocket(
        members, items, pool,
        balance_points_usage=True,
        min_members_for_balance=3,  # Disabled for 2 members
    )
    
    assert solution.status == "Optimal"


def test_solve_metadata_tracks_relaxations():
    """
    When constraints are relaxed, metadata should reflect this.
    """
    # Create scenario that requires relaxation
    members = [
        GroupMember(user_id="alice", points_balances={"chase": 300000}),
        GroupMember(user_id="bob", points_balances={}, max_settlement_owed=10),  # Very low cap
    ]
    
    items = [
        MemberBookingItem(
            item_id="bob_flight",
            member_id="bob",
            item_type="flight",
            party_size=4,
            cash_cost=1000,
            points_options=[GroupPointsOption("UA", 50000, 50)],
        ),
    ]
    
    solution, status, metadata = minimize_group_out_of_pocket_with_fallback(
        members, items, pool
    )
    
    # Check metadata reflects what happened
    assert metadata.phases_attempted is not None
    assert len(metadata.phases_attempted) >= 1
    if metadata.phase_used != SolvePhase.STRICT:
        assert len(metadata.constraints_relaxed) > 0


# ============================================================
# ISSUE 6: BOOKER ATTRIBUTION TESTS (PHASE 3)
# ============================================================

def test_booker_attribution_transfer_to_beneficiary():
    """
    When points are transferred (bank → airline), beneficiary books and pays surcharge.
    """
    opt = GroupPointsOption(
        program_code="UA",
        points_required=25000,
        surcharge=50,
        transfer_from_bank="chase",  # Transfer required
    )
    
    booker = determine_booker(opt, owner_id="alice", beneficiary_id="bob")
    
    # Points transfer to Bob's UA account, so Bob books
    assert booker == "bob"


def test_booker_attribution_direct_redemption():
    """
    When points are redeemed directly (no transfer), owner books and pays surcharge.
    """
    opt = GroupPointsOption(
        program_code="UA",
        points_required=25000,
        surcharge=50,
        transfer_from_bank=None,  # Direct redemption from owner's UA account
    )
    
    booker = determine_booker(opt, owner_id="alice", beneficiary_id="bob")
    
    # Alice redeems from her UA account for Bob, so Alice books
    assert booker == "alice"
```

### Integration Tests

```python
# tests/integration/test_family_no_points_scenario.py

def test_family_with_children_no_points_e2e():
    """
    End-to-end test: Family of 4 with no points joins group with points-rich member.
    """
    # 1. Create trip
    trip = create_trip(title="Europe Trip")
    
    # 2. Organizer joins (has points)
    join_trip(trip.invite_code, user="alice", 
              points={"chase": 200000}, budget=1000, party_size=1)
    
    # 3. Family joins (no points)
    join_trip(trip.invite_code, user="bob",
              points={}, budget=500, party_size=4,
              max_settlement_owed=2000)
    
    # 4. Run optimization
    result = optimize_group_oop(trip.trip_id)
    
    # 5. Verify solution is usable
    assert result.status in ["Optimal", "Relaxed"]
    
    bob_cash_oop = result.oop_per_member["bob"]
    bob_settlement = sum(s.amount_usd for s in result.settlements if s.from_member == "bob")
    
    assert bob_cash_oop <= 500, "Bob's cash OOP exceeds budget"
    assert bob_settlement <= 2000, "Bob's settlement exceeds max"
    assert bob_cash_oop + bob_settlement > 0, "Bob should pay something"


def test_large_party_bucketization_e2e():
    """
    End-to-end test: Large party (10 pax) should bucketize, not explode ILP.
    """
    trip = create_trip(title="Big Family Trip")
    
    join_trip(trip.invite_code, user="bob",
              points={"UA": 100000}, budget=5000, party_size=10)
    
    # Should complete without timeout
    import time
    start = time.time()
    result = optimize_group_oop(trip.trip_id)
    elapsed = time.time() - start
    
    assert elapsed < 30, f"Optimization took too long: {elapsed}s (should be < 30s)"
    assert result.status == "Optimal"
```

---

## Schema Impact (New/Modified Fields)

This section lists all new or modified fields introduced by this plan. Cursor should ensure these are added to dataclasses AND serialized in API responses where applicable.

### GroupMember (existing dataclass - add fields)

```python
@dataclass
class GroupMember:
    # ... existing fields ...
    
    # NEW fields from this plan:
    max_settlement_owed: Optional[float] = None      # Issue 2: Max $ willing to owe
    include_settlement_in_budget: bool = False       # Issue 2: If True, cash + settlement <= budget
```

### MemberBookingItem (existing dataclass - add fields)

```python
@dataclass
class MemberBookingItem:
    # ... existing fields ...
    
    # NEW fields from this plan:
    original_item_id: Optional[str] = None           # Issue 1: For expanded pax items
    passenger_index: Optional[int] = None            # Issue 1: Which pax (0-indexed)
    bucket_index: Optional[int] = None               # Issue 1: Which bucket (for large parties)
```

### GroupPointsOption (existing dataclass - verify fields exist)

```python
@dataclass
class GroupPointsOption:
    program_code: str
    points_required: int                             # Per-pax
    surcharge: float                                 # Per-pax
    available_from: Optional[str] = None             # Airline program code
    transfer_from_bank: Optional[str] = None         # Bank program if transfer needed
    transfer_ratio: float = 1.0                      # Points transfer ratio
    
    # NEW fields (optional - for Issue 3):
    availability_verified: bool = False              # Issue 3: Was party availability checked?
    verified_seats: Optional[int] = None             # Issue 3: How many seats verified?
```

### PassengerBreakdownItem (NEW - lightweight struct for serialization)

```python
@dataclass
class PassengerBreakdownItem:
    """
    Lightweight struct for passenger breakdown in collapsed allocations.
    Avoids recursion issues with GroupPaymentAllocation self-reference.
    """
    item_id: str                                     # Expanded pax item ID
    payment_type: str                                # "cash" or "points" (string, not enum)
    surcharge_usd: float
    cash_base_usd: float
    points_used: Optional[int] = None
    program_used: Optional[str] = None
    points_owner: Optional[str] = None
```

### GroupPaymentAllocation (existing dataclass - add/clarify fields)

```python
@dataclass
class GroupPaymentAllocation:
    item_id: str
    beneficiary_member: str                          # Who travels
    payment_type: PaymentType                        # CASH, POINTS, or MIXED (new)
    
    # BACKWARD COMPATIBLE: Keep existing field, add new ones
    cash_paid: float = 0.0                           # DEPRECATED: Use surcharge_usd + cash_base_usd
    
    # NEW clarified fields (avoid "cash_paid" ambiguity):
    surcharge_usd: float = 0.0                       # Taxes/fees paid at booking (by booker)
    cash_base_usd: float = 0.0                       # Cash fare (if PaymentType.CASH)
    total_booking_cost_usd: float = 0.0              # surcharge + cash_base
    
    points_used: Optional[int] = None
    points_owner: Optional[str] = None               # Whose points
    program_used: Optional[str] = None
    program_name: Optional[str] = None
    points_value_usd: Optional[float] = None         # Settlement value (capped FMV)
    
    # NEW fields from this plan:
    original_item_id: Optional[str] = None           # Issue 1: For UI grouping (don't use expansion_map)
    booker_member: Optional[str] = None              # Issue 6: Who pays surcharge at booking
    passenger_breakdown: Optional[List[PassengerBreakdownItem]] = None  # Lightweight, no recursion
```

### SolveMetadata (NEW dataclass)

```python
@dataclass
class SolveMetadata:
    phase_used: SolvePhase
    constraints_relaxed: List[str]
    balance_constraint_active: bool
    settlement_caps_active: bool
    fallback_reason: Optional[str] = None
    phases_attempted: List[str] = field(default_factory=list)
    budget_overages: Dict[str, float] = field(default_factory=dict)
```

### PaymentType (existing enum - add value)

```python
class PaymentType(str, Enum):
    CASH = "cash"
    POINTS = "points"
    MIXED = "mixed"   # NEW: For collapsed family bookings with both
```

---

## Testing Helpers

Tests in this plan use a `pool` variable without showing how to build it. Add these helpers:

```python
# tests/conftest.py or tests/helpers.py

def normalize_program_code(code: str) -> str:
    """Normalize program codes to uppercase."""
    return code.strip().upper()


def build_pool_from_members(members: List[GroupMember]) -> GroupPointsPool:
    """
    Build a GroupPointsPool from member points balances.
    
    IMPORTANT: Normalizes program codes to uppercase to prevent
    silent mismatches in ILP variable construction.
    
    Usage in tests:
        members = [GroupMember(user_id="alice", points_balances={"UA": 50000}), ...]
        pool = build_pool_from_members(members)
    """
    by_member = {}
    by_program = {}
    
    for member in members:
        if member.points_balances:
            # Normalize program codes to uppercase
            normalized_balances = {
                normalize_program_code(prog): bal 
                for prog, bal in member.points_balances.items()
            }
            by_member[member.user_id] = normalized_balances
            
            for program, balance in normalized_balances.items():
                if program not in by_program:
                    by_program[program] = {}
                by_program[program][member.user_id] = balance
    
    return GroupPointsPool(
        by_member=by_member,
        by_program=by_program,
    )


# Fixture for pytest
import pytest

@pytest.fixture
def sample_pool():
    """Pool with Alice having Chase/UA and Bob having nothing."""
    members = [
        GroupMember(user_id="alice", points_balances={"chase": 200000, "UA": 50000}),
        GroupMember(user_id="bob", points_balances={}),
    ]
    return build_pool_from_members(members)
```

---

## Open Questions

1. **Should settlement be enforced at booking time or later?**
   - Current: Settlement is calculated but not enforced
   - Option: Require settlement deposit before revealing booking instructions

2. **How to handle settlement when one member can't/won't pay?**
   - Current: No mechanism
   - Option: Add "settlement insurance" or escrow

3. **Should we support "sponsor" members who don't expect settlement?**
   - Use case: Parent covering children's trip
   - Option: Add `is_sponsor` flag that waives settlement for their contributions

4. **How granular should passenger splitting be?**
   - Current plan: Split to individual passengers (or buckets for large parties)
   - Alternative: Split to "adults" vs "children" buckets (different award pricing)

5. **What should the dominance pruning threshold be?**
   - Current proposal: `DOMINANCE_CASH_THRESHOLD = 0.95` (prune if surcharge >= 95% of cash)
   - Tradeoff: Lower threshold (80%) = more aggressive pruning, faster solver, but may miss edge cases where high-surcharge redemptions are actually beneficial

6. **Should we track and display which constraints were relaxed?**
   - Current proposal: Return `SolveMetadata` with `constraints_relaxed` list
   - UI question: How prominent should the warning be? Banner vs. footnote vs. expandable details?

7. **How to handle booker attribution for programs we don't have transfer rules for?**
   - Current proposal: Default to beneficiary (safer for budget)
   - Alternative: Default to owner (simpler assumption)

---

## Cursor Implementation Checklist (Executable)

**Use this as the exact sequence of operations. Follow in order to avoid plumbing gaps.**

---

### PR 1 (P0): Dominance Pruning + Settlement Safety + FMV Capping

#### 1. Backend: `group_oop_optimizer.py`

##### 1.1 Add program normalization utility (TOP of file, near imports)

```python
def normalize_program_code(code: str) -> str:
    """Normalize program codes to uppercase to prevent silent mismatches."""
    return code.strip().upper()
```

**Then use it anywhere you:**
- Read member balances keys
- Build `pool.by_member` / `pool.by_program`
- Read/write `opt.program_code`, `available_from`, `transfer_from_bank`

**Cursor task:** Search `program_code` usage and wrap with `normalize_program_code(...)` at creation time.

##### 1.2 Add unified settlement function (near FMV helpers)

```python
# PRUNING uses per-pax values (opt.surcharge vs item.cash_cost)
# ILP CONSTRAINTS use totals (multiply by party_size)

def settlement_value_usd(
    program: str, 
    points_used: int, 
    cash_cost: float, 
    surcharge: float
) -> float:
    """
    Compute settlement value with FMV capping.
    
    MUST be used in BOTH:
    1. ILP settlement constraint
    2. Settlement extraction
    """
    uncapped_fmv = get_fair_market_value(normalize_program_code(program), points_used)
    cash_avoided = max(0.0, cash_cost - surcharge)
    return min(uncapped_fmv, cash_avoided)
```

##### 1.3 Implement pruning functions (right before `solve_group_ilp()`)

Copy `prune_dominated_options()` and `prune_all_items()` from this plan.

**Ensure:**
- Normalize `opt.program_code = normalize_program_code(opt.program_code)` inside pruning (or earlier at ingestion)
- Define `soft_pruned = 0` before use (logging references it)
- Confirm `logger` exists in this file

**Cursor task:** Insert the two functions and call `prune_all_items(booking_items, ...)` inside `solve_group_ilp()` before decision variables.

##### 1.4 Update `_extract_group_solution()` to cap FMV (Issue 4)

Replace any direct call to `get_fair_market_value()` for settlement with:

```python
points_value = settlement_value_usd(
    program=opt.program_code,
    points_used=total_points,
    cash_cost=total_cash,
    surcharge=total_surcharge,
)
```

Add the "zero/negative cash avoided" warning log:
```python
if cash_avoided <= 0:
    logger.warning(
        f"Zero-value redemption for {item.item_id}: "
        f"surcharge (${total_surcharge:.2f}) >= cash (${total_cash:.2f}). "
        f"Points owner {owner_id} receives $0 settlement."
    )
```

##### 1.5 Add `GroupMember` fields + settlement constraint (Issue 2)

In `GroupMember` dataclass, add:
```python
max_settlement_owed: Optional[float] = None
include_settlement_in_budget: bool = False
```

Then add ILP constraint block after existing budget constraints:

```python
# Settlement constraint (Issue 2)
# settlement_value_usd returns a constant float; multiplying by binary var is linear
for member in members:
    if member.max_settlement_owed is not None:
        member_settlement_owed = pl.lpSum(
            use_points[(item.item_id, opt.program_code, owner_id)]
            * settlement_value_usd(
                program=opt.program_code,
                points_used=opt.points_required * item.party_size,
                cash_cost=item.cash_cost * item.party_size,
                surcharge=opt.surcharge * item.party_size,
            )
            for item in booking_items
            if item.member_id == member.user_id
            for opt in item.points_options
            for owner_id in pool.by_member.keys()
            if owner_id != member.user_id  # Only cross-member
            and (item.item_id, opt.program_code, owner_id) in use_points
        )
        
        m += member_settlement_owed <= member.max_settlement_owed, \
            f"max_settlement_{member.user_id}"
    
    # Combined effective budget (optional)
    if member.include_settlement_in_budget and member.max_cash_budget is not None:
        effective_oop = member_cash + member_surcharges + member_settlement_owed
        m += effective_oop <= member.max_cash_budget, \
            f"effective_budget_{member.user_id}"
```

**Cursor task:** Keep existing `member_cash`/`member_surcharges` expressions; just add `member_settlement_owed`.

---

#### 2. Backend: Join Schema Plumbing

##### 2.1 `JoinTripRequest` schema (`backend/src/app.py`)

Add fields (do NOT remove old ones):

```python
class JoinTripRequest(BaseModel):
    invite_code: str
    # ... existing fields ...
    
    # Party size
    party_size: int = Field(1, ge=1, description="Total travelers")
    adults: int = Field(1, ge=1, description="Number of adults")
    children: int = Field(0, ge=0, description="Number of children")
    
    # Settlement preferences
    max_settlement_owed: Optional[float] = Field(None, ge=0, description="Max USD willing to owe")
    include_settlement_in_budget: bool = Field(False)
    
    @validator('party_size', always=True)
    def validate_party_size(cls, v, values):
        adults = values.get('adults', 1)
        children = values.get('children', 0)
        return adults + children
```

**Cursor task:** Find `class JoinTripRequest(BaseModel)` and add fields + validator.

##### 2.2 `trip_member_service.join_trip(...)`

Add params and persist:

```python
def join_trip(
    user_id: str,
    invite_code: str,
    *,
    # ... existing params ...
    party_size: int = 1,
    adults: int = 1,
    children: int = 0,
    max_settlement_owed: Optional[float] = None,
    include_settlement_in_budget: bool = False,
) -> Dict[str, Any]:
    item = {
        # ... existing fields ...
        "party_size": max(1, party_size),
        "adults": max(1, adults),
        "children": max(0, children),
        "max_settlement_owed": max_settlement_owed,
        "include_settlement_in_budget": include_settlement_in_budget,
    }
    # ... persist ...
```

**Cursor task:** Search for member record write payload and include these keys.

##### 2.3 `group_api.py` (or wherever you read members)

When returning members, include all new fields:

```python
GroupMember(
    user_id=m["user_id"],
    name=m["name"],
    party_size=m.get("party_size", 1),
    max_settlement_owed=m.get("max_settlement_owed"),
    include_settlement_in_budget=m.get("include_settlement_in_budget", False),
    # ... other fields ...
)
```

---

#### 3. Frontend: Join UI + API Payload

##### 3.1 `frontend/.../group/join/[inviteCode]/page.tsx`

Add fields:
- `adults` (number, min 1)
- `children` (number, min 0)
- `maxSettlementOwed` (optional number)
- `includeSettlementInBudget` (checkbox)

##### 3.2 `frontend/src/lib/api.ts`

Update join request body:

```typescript
body: JSON.stringify({
  invite_code,
  // ... existing ...
  adults: options.adults ?? 1,
  children: options.children ?? 0,
  party_size: (options.adults ?? 1) + (options.children ?? 0),
  max_settlement_owed: options.maxSettlementOwed ?? null,
  include_settlement_in_budget: options.includeSettlementInBudget ?? false,
}),
```

---

#### 4. Minimal Tests (PR1)

Create `tests/test_group_optimizer_pruning.py`:

```python
def test_prune_hard_threshold():
    """Options with surcharge >= cash_cost are removed."""
    # ...

def test_prune_pareto_dominance():
    """Pareto-dominated options within same program are removed."""
    # ...
```

Create `tests/test_settlement_capping.py`:

```python
def test_settlement_value_usd_caps_at_cash_avoided():
    """FMV is capped at cash_cost - surcharge."""
    result = settlement_value_usd("UA", 30000, 300, 50)
    assert result <= 250  # cash_avoided = 300 - 50

def test_settlement_value_usd_zero_when_surcharge_exceeds_cash():
    """When surcharge >= cash_cost, settlement = 0."""
    result = settlement_value_usd("UA", 10000, 100, 120)
    assert result == 0
```

---

### PR 2 (P1): Multi-Phase Solver + SolveMetadata + Soft Budgets

#### 1. Backend: `group_oop_optimizer.py`

Add:
- `SolvePhase` enum
- `SolveMetadata` dataclass
- `minimize_group_out_of_pocket_with_fallback(...)` orchestrator

Implement phase cascade:
1. **strict** - all constraints
2. **relax_balance** - disable balance constraint
3. **relax_settlement** - disable settlement caps
4. **best_effort** - soft budgets

##### Soft budgets function

Create `solve_group_ilp_soft_budgets(...)`:

```python
def solve_group_ilp_soft_budgets(
    members, booking_items, pool, **kwargs
) -> Tuple[GroupOOPSolution, str, Dict[str, float]]:
    # Same decision variables as solve_group_ilp()
    
    # Compute bounds
    total_cash_upper_bound = sum(
        item.cash_cost * item.party_size for item in booking_items
    )
    BIG_M = max(10_000, 100 * total_cash_upper_bound)
    
    # Add bounded slack variables
    budget_overage = {}
    for member in members:
        if member.max_cash_budget is not None:
            budget_overage[member.user_id] = pl.LpVariable(
                f"budget_overage_{member.user_id}",
                lowBound=0,
                upBound=total_cash_upper_bound,  # Bounded!
                cat="Continuous",
            )
    
    # Budget constraints become soft
    for member in members:
        if member.max_cash_budget is not None:
            member_total = member_cash + member_surcharges
            m += member_total <= member.max_cash_budget + budget_overage[member.user_id]
    
    # Objective adds penalty
    total_penalty = pl.lpSum(BIG_M * ov for ov in budget_overage.values())
    m += total_oop_objective + total_penalty
    
    # ... solve and extract overages ...
```

**Cursor task:** Keep `solve_group_ilp()` as-is. Copy to create `solve_group_ilp_soft_budgets()` with patches.

#### 2. Backend: API response includes `solve_metadata`

Add `solve_metadata` to optimization endpoint response.

#### 3. Frontend: Results Banner

In `frontend/.../group/results/page.tsx`:

```tsx
{solveMetadata?.phase_used !== "strict" && (
  <Banner type="warning">
    Some constraints were relaxed to find a solution.
    {solveMetadata?.constraints_relaxed?.join(", ")}
  </Banner>
)}

{solveMetadata?.budget_overages && Object.keys(solveMetadata.budget_overages).length > 0 && (
  <Banner type="error">
    Budget exceeded: {Object.entries(solveMetadata.budget_overages)
      .map(([id, amt]) => `${id}: $${amt.toFixed(2)}`)
      .join(", ")}
  </Banner>
)}
```

---

### PR 3 (P1/P2): Party Splitting + Display Collapse

#### 1. Backend Model Changes

`MemberBookingItem` add fields:
```python
original_item_id: Optional[str] = None
passenger_index: Optional[int] = None
bucket_index: Optional[int] = None
```

`PaymentType` add:
```python
MIXED = "mixed"
```

`PassengerBreakdownItem` (NEW lightweight struct):
```python
@dataclass
class PassengerBreakdownItem:
    item_id: str
    payment_type: str  # "cash" or "points" (string, not enum)
    surcharge_usd: float
    cash_base_usd: float
    points_used: Optional[int] = None
    program_used: Optional[str] = None
    points_owner: Optional[str] = None
```

`GroupPaymentAllocation` add:
```python
original_item_id: Optional[str] = None
passenger_breakdown: Optional[List[PassengerBreakdownItem]] = None
```

**Cursor task:** Do NOT add `passenger_breakdown: List[GroupPaymentAllocation]` (recursion risk).

#### 2. Implement `expand_party_to_passengers(...)`

Return expanded items. Set `original_item_id=item.item_id` on each expanded item.

**Do NOT return `expansion_map` in API.** Every expanded item carries its `original_item_id`.

#### 3. Call Expansion in `solve_group_ilp()`

Before variable build:

```python
if enable_partial_coverage:
    booking_items = expand_party_to_passengers(
        booking_items,
        max_expansion=MAX_PASSENGER_EXPANSION,
        bucket_size=BUCKET_SIZE,
    )[0]  # Just the items, not the map
```

Gate expansion:
- `enable_partial_coverage` flag
- `party_size > 1`
- `points_options` non-empty

#### 4. Settlement on Atomic Allocations

Use expanded items during extraction + settlement calculations.
Only collapse for display at the very end.

#### 5. Implement `collapse_passenger_allocations(...)`

```python
def collapse_passenger_allocations(
    allocations: List[GroupPaymentAllocation],
) -> List[GroupPaymentAllocation]:
    # Group by original_item_id
    by_original = {}
    for alloc in allocations:
        key = alloc.original_item_id or alloc.item_id
        by_original.setdefault(key, []).append(alloc)
    
    collapsed = []
    for original_id, group in by_original.items():
        if len(group) == 1:
            collapsed.append(group[0])
        else:
            # Determine payment type
            types = set(a.payment_type for a in group)
            if types == {PaymentType.CASH}:
                summary_type = PaymentType.CASH
            elif types == {PaymentType.POINTS}:
                summary_type = PaymentType.POINTS
            else:
                summary_type = PaymentType.MIXED
            
            # Build breakdown
            breakdown = [
                PassengerBreakdownItem(
                    item_id=a.item_id,
                    payment_type=a.payment_type.value,
                    surcharge_usd=a.surcharge_usd,
                    cash_base_usd=a.cash_base_usd,
                    points_used=a.points_used,
                    program_used=a.program_used,
                    points_owner=a.points_owner,
                )
                for a in group
            ]
            
            collapsed.append(GroupPaymentAllocation(
                item_id=original_id,
                original_item_id=original_id,
                beneficiary_member=group[0].beneficiary_member,
                payment_type=summary_type,
                # Sum totals
                surcharge_usd=sum(a.surcharge_usd for a in group),
                cash_base_usd=sum(a.cash_base_usd for a in group),
                points_used=sum(a.points_used or 0 for a in group) or None,
                # Mixed: set to None
                points_owner=None if summary_type == PaymentType.MIXED else group[0].points_owner,
                passenger_breakdown=breakdown,
            ))
    
    return collapsed
```

#### 6. Frontend Results Grouping

Group by `allocation.original_item_id ?? allocation.item_id`.

Show: "This booking may require multiple tickets" if `breakdown.length > 1`.

---

### PR 4 (P2): Booker Attribution (Deferred)

When ready:
1. Add `booker_member` field
2. Implement `determine_booker(opt, owner, beneficiary)`
3. Update ILP budgets so surcharge hits the booker (deterministic routing)

---

### Quick Reference: File Edit Order

```
PR1:
  backend/src/handlers/group_oop_optimizer.py
    → normalize_program_code()
    → settlement_value_usd()
    → prune_dominated_options(), prune_all_items()
    → call prune_all_items() in solve_group_ilp()
    → update _extract_group_solution() with capped settlement
    → add GroupMember.max_settlement_owed + constraint block
  backend/src/app.py
    → extend JoinTripRequest
  backend/src/services/trip_member_service.py
    → accept + persist new fields
  backend/src/handlers/group_api.py
    → return new fields, pass to GroupMember
  frontend/src/app/(app)/group/join/[inviteCode]/page.tsx
    → add inputs
  frontend/src/lib/api.ts
    → add fields to payload
  tests/test_group_optimizer_pruning.py (new)
  tests/test_settlement_capping.py (new)

PR2:
  backend/src/handlers/group_oop_optimizer.py
    → SolvePhase, SolveMetadata
    → minimize_group_out_of_pocket_with_fallback()
    → solve_group_ilp_soft_budgets()
  backend/src/routes/optimize.py (or wherever response is built)
    → include solve_metadata
  frontend/src/app/(app)/group/results/page.tsx
    → warning banners

PR3:
  backend/src/handlers/group_oop_optimizer.py
    → PassengerBreakdownItem, model field additions
    → expand_party_to_passengers()
    → call expansion in solve_group_ilp()
    → collapse_passenger_allocations()
  frontend/src/app/(app)/group/results/page.tsx
    → group by original_item_id, show breakdown

PR4:
  backend/src/handlers/group_oop_optimizer.py
    → booker_member, determine_booker()
    → update budget constraint routing
```

---

## Appendix: Current Code References

| Component | File | Lines |
|-----------|------|-------|
| `MemberBookingItem` dataclass | `group_oop_optimizer.py` | 148-175 |
| `GroupMember` dataclass | `group_oop_optimizer.py` | 86-108 |
| Decision variables | `group_oop_optimizer.py` | 341-387 |
| Objective function | `group_oop_optimizer.py` | 415-480 |
| Budget constraints | `group_oop_optimizer.py` | 537-562 |
| Balance constraint | `group_oop_optimizer.py` | 606-631 |
| Solution extraction | `group_oop_optimizer.py` | 1029-1137 |
| Settlement calculation | `group_oop_optimizer.py` | 1231-1274 |
| Fair market values | `fair_market_values.py` | All |
| Join trip service | `trip_member_service.py` | 13-61 |
| Join trip API | `app.py` | 299-314, 818-842 |
| Frontend join page | `group/join/[inviteCode]/page.tsx` | All |
