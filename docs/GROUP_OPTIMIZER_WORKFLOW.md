# Group Optimizer Workflow

This document provides a comprehensive explanation of the group optimizer workflow in Tripy, from the frontend user interface through the backend optimization algorithm.

---

## Table of Contents

1. [Overview](#overview)
2. [Frontend Flow](#frontend-flow)
   - [Creating a Group Trip](#creating-a-group-trip)
   - [Joining a Group Trip](#joining-a-group-trip)
   - [Dashboard and Optimization Trigger](#dashboard-and-optimization-trigger)
   - [Results and Booking](#results-and-booking)
3. [Backend Architecture](#backend-architecture)
   - [API Endpoints](#api-endpoints)
   - [Core Services](#core-services)
   - [Data Flow Diagram](#data-flow-diagram)
4. [The Optimization Algorithm](#the-optimization-algorithm)
   - [ILP Model Overview](#ilp-model-overview)
   - [Decision Variables](#decision-variables)
   - [Objective Function](#objective-function)
   - [Constraints](#constraints)
   - [Solution Extraction](#solution-extraction)
5. [Points Pooling and Transfers](#points-pooling-and-transfers)
6. [Settlement Calculation](#settlement-calculation)
7. [Key Files Reference](#key-files-reference)

---

## Overview

Tripy's group optimizer allows multiple travelers to plan trips together by **pooling their credit card points** to achieve the lowest possible out-of-pocket (OOP) cost. The system uses **Integer Linear Programming (ILP)** to find the optimal allocation of points across group members while respecting individual constraints.

**Key Capabilities:**
- Cross-member point sharing (Alice's points can pay for Bob's flight)
- Multi-program optimization (Chase UR, Amex MR, airline miles, etc.)
- Automatic transfer path detection (bank points → airline miles)
- Fair settlement calculation (who owes whom after optimization)
- Budget constraints per member and group-wide

---

## Frontend Flow

### Creating a Group Trip

**Page:** `/group/setup`  
**File:** `frontend/src/app/(app)/group/setup/page.tsx`  
**Component:** `GroupTripSetup`

**User Flow:**
1. User fills in trip details:
   - Destinations and dates
   - Budget constraints
   - Travel preferences (cabin class, departure times)
   - Points balances for their credit cards

2. **Key Function:** `handleCreateTrip()` (lines 205-321)
   - Creates the trip via `POST /trips`
   - Adds destinations via `POST /trips/{tripId}/destinations`
   - Upserts user's points via `POST /trips/{tripId}/points`
   - Generates an invite code via `POST /trips/{tripId}/invite`

3. The invite modal displays a shareable link: `/group/join/{inviteCode}`

**API Calls:**
```typescript
// Create trip
tripsAPI.create({ ... }) → POST /trips

// Add destinations
destinationsAPI.add({ tripId, destination }) → POST /trips/{tripId}/destinations

// Add points
pointsAPI.upsert({ tripId, points }) → POST /trips/{tripId}/points

// Generate invite
tripsAPI.invite(tripId) → POST /trips/{tripId}/invite
```

---

### Joining a Group Trip

**Page:** `/group/join/[inviteCode]`  
**File:** `frontend/src/app/(app)/group/join/[inviteCode]/page.tsx`  
**Component:** `GroupMemberJoin`

**User Flow:**
1. User visits the invite link or enters the invite code
2. System fetches trip info via `GET /trips/invite/{inviteCode}`
3. User enters their:
   - Travel preferences (home airport, dates, cabin class)
   - Party size (number of travelers)
   - Points balances (credit cards they want to contribute)
   - Willingness to share points (`freely`, `ask_before`, `do_not_use`)

4. **Key Function:** `handleJoin()` (lines 289-330)
   - Joins the trip via `POST /trips/invite/{inviteCode}/join`
   - Upserts their points via `POST /trips/{tripId}/points`

**API Calls:**
```typescript
// Get trip info by invite code
tripsAPI.getByInvite(inviteCode) → GET /trips/invite/{inviteCode}

// Join trip
tripsAPI.join(inviteCode, preferences) → POST /trips/invite/{inviteCode}/join

// Add member's points
pointsAPI.upsert({ tripId, points }) → POST /trips/{tripId}/points
```

---

### Dashboard and Optimization Trigger

**Page:** `/group/dashboard`  
**File:** `frontend/src/app/(app)/group/dashboard/page.tsx`  
**Component:** `GroupDashboardContent`

**Dashboard Features:**
- Shows all group members and their status
- Displays the aggregated points pool
- Lists trip destinations
- Shows "ready" status for optimization

**Key Function:** `fetchTripData()` loads:
- Trip details via `GET /trips/{tripId}`
- Members via `GET /trips/{tripId}/members`
- Points summary via `GET /trips/{tripId}/points/summary`
- Destinations via `GET /trips/{tripId}/destinations`

**Triggering Optimization:**
When the user clicks "Generate Itineraries", the system navigates to the payment page, which triggers the optimization.

---

### Results and Booking

**Page:** `/group/results`  
**File:** `frontend/src/app/(app)/group/results/page.tsx`  
**Component:** `GroupResults`

**Displays:**
- Optimized itineraries ranked by total OOP
- Per-member cost breakdown
- Points used vs. remaining
- Transfer instructions
- Settlement information (who owes whom)

**Key API Call for Optimization:**
```typescript
// Trigger group optimization
optimizationAPI.group({
  trip_id: string,
  points: Record<string, number>,          // Aggregated points
  budget: number,
  member_points: Record<string, Record<string, number>>,  // Per-member
  member_budgets: Record<string, number>,
  cabin_classes: string[],
  split_method?: string
}) → POST /optimize/group
```

**Booking Flow:**
1. User selects an itinerary
2. Views transfer instructions (`/group/transfer-instructions`)
3. Pays the service fee (`/group/payment`)
4. Follows booking checklist (`/group/booking`)
5. Settles with group members (`/group/settlement`)

---

## Backend Architecture

### API Endpoints

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/group/{trip_id}/optimize-oop` | POST | `optimize_group_oop()` | Main group optimization |
| `/optimize/group` | POST | `optimize_group_trip()` | Alternative optimization route |
| `/group/{trip_id}/points-pool` | GET | `handle_get_points_pool()` | Get aggregated points |
| `/group/{trip_id}/simulate-allocation` | POST | `handle_simulate_allocation()` | Preview settlements |
| `/group/{trip_id}/settlements` | GET | `handle_get_settlements()` | Get settlement details |

### Core Services

| Service | File | Purpose |
|---------|------|---------|
| `trip_service` | `backend/src/services/trip_service.py` | Trip CRUD operations |
| `trip_member_service` | `backend/src/services/trip_member_service.py` | Member management |
| `points_service` | `backend/src/services/points_service.py` | Points balance management |
| `destination_service` | `backend/src/services/destination_service.py` | Trip destinations |

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  GroupSetup → GroupJoin → GroupDashboard → GroupResults → GroupBooking      │
│       │            │            │              │              │              │
│       ▼            ▼            ▼              ▼              ▼              │
│  POST /trips   POST /join   GET /members   POST /optimize   GET /transfers  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND API                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                         app.py (FastAPI routes)                              │
│                                   │                                          │
│                                   ▼                                          │
│                  ┌────────────────────────────────┐                          │
│                  │       group_api.py             │                          │
│                  │    handle_optimize_oop()       │                          │
│                  └────────────────┬───────────────┘                          │
│                                   │                                          │
│              ┌────────────────────┼────────────────────┐                     │
│              ▼                    ▼                    ▼                     │
│  ┌───────────────────┐  ┌─────────────────┐  ┌──────────────────┐           │
│  │group_points_pooling│  │group_oop_optimizer│ │ cost_allocation  │           │
│  │aggregate_points()  │  │minimize_group_oop()│ │allocate_costs() │           │
│  └───────────────────┘  └─────────────────┘  └──────────────────┘           │
│                                   │                                          │
│                                   ▼                                          │
│                          ┌─────────────────┐                                 │
│                          │   PuLP ILP      │                                 │
│                          │   CBC Solver    │                                 │
│                          └─────────────────┘                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## The Optimization Algorithm

The core of group optimization is an **Integer Linear Programming (ILP)** solver that minimizes total out-of-pocket cost while respecting constraints.

**File:** `backend/src/handlers/group_oop_optimizer.py`  
**Function:** `minimize_group_out_of_pocket()` (lines 246-535)  
**Solver:** PuLP with CBC backend (60-second time limit)

### ILP Model Overview

The optimizer treats the problem as:
> "Given a set of booking items (flights) and a pool of points from multiple members, find the allocation that minimizes the total cash paid by the group."

**Key Insight:** Cross-member point sharing means Alice's Chase points can pay for Bob's flight if it reduces total OOP.

### Decision Variables

```python
# 1. Cash payment decision (binary)
pay_cash[item_id] = {0, 1}
# 1 if item is paid with cash, 0 otherwise

# 2. Points usage decision (binary)  
use_points[(item_id, program, owner_id)] = {0, 1}
# 1 if item is paid using owner's points in program

# 3. Transfer amount (integer)
transfer[(owner_id, bank, program)] = Z⁺
# Points transferred from bank to airline program
```

**Example:**
- `pay_cash["flight_jfk_cdg"] = 1` → Pay cash for JFK→CDG flight
- `use_points[("flight_jfk_cdg", "UA", "alice")] = 1` → Alice uses United miles
- `transfer[("alice", "chase", "UA")] = 50000` → Alice transfers 50k Chase UR to United

### Objective Function

```
Minimize: cash_component + surcharge_component - points_bonus

Where:
  cash_component = Σ (pay_cash[item] × cash_cost × party_size)
  surcharge_component = Σ (use_points[item, prog, owner] × surcharge × party_size)
  points_bonus = ε × Σ (use_points[...])  # Tiny tiebreaker favoring points
```

**Explanation:**
- When paying cash: add the full flight cost
- When paying points: add only the taxes/fees (surcharge)
- The `points_bonus` (ε = 0.0001) breaks ties in favor of using points

### Constraints

#### 1. Each Item Paid Exactly Once
```
pay_cash[item] + Σ(use_points[item, program, owner]) = 1
```
Every booking must be paid for by exactly one method.

#### 2. Points Balance Constraints
```
Σ(points_used from program by owner) ≤ direct_balance + transferred_in
```
You can't use more points than you have (directly or via transfer).

#### 3. Transfer Limits
```
Σ(transfers from bank by owner) ≤ owner's bank balance
```
You can't transfer more points than you have in your bank account.

#### 4. Per-Member Budget Constraints
```
member_cash_paid + member_surcharges ≤ member_budget
```
Each member's out-of-pocket must stay within their budget.

#### 5. Max Subsidy Constraint (Optional)
```
points_provided_for_others × fair_value ≤ max_subsidy
```
Limits how much one member can subsidize others.

#### 6. Combined Group Budget
```
total_cash + total_surcharges ≤ combined_group_budget
```
Group budgets are **additive** - member budgets are summed.

### Solution Extraction

After solving, the optimizer extracts:

1. **Allocations:** How each item is paid (cash or points, from which member)
2. **Transfer Plan:** Which transfers are needed (Chase UR → United, etc.)
3. **Settlements:** Who owes whom based on points contributed
4. **Remaining Balances:** Points left after optimization

```python
# Extract solution from solved ILP
for item in booking_items:
    if pl.value(pay_cash[item.item_id]) > 0.5:
        # Item paid with cash
        allocations.append(CashPayment(...))
    else:
        # Find which points option was used
        for opt in item.points_options:
            for owner_id in pool.by_member.keys():
                key = (item.item_id, opt.program_code, owner_id)
                if key in use_points and pl.value(use_points[key]) > 0.5:
                    allocations.append(PointsPayment(...))
```

---

## Points Pooling and Transfers

**File:** `backend/src/handlers/group_points_pooling.py`  
**Function:** `aggregate_group_points()`

Points from all group members are aggregated into a `GroupPointsPool`:

```python
@dataclass
class GroupPointsPool:
    total_by_program: Dict[str, int]        # Total points per program
    by_member: Dict[str, Dict[str, int]]    # Breakdown by member
    shareable_pool: Dict[str, int]          # Only from willing members
    transfer_potential: Dict[str, List[str]] # Bank → airline transfer paths
    total_value: float                       # Estimated USD value
```

**Transfer Graph:**

The system uses `EXTENDED_TRANSFER_GRAPH` to model which bank points can transfer to which airlines:

```python
EXTENDED_TRANSFER_GRAPH = {
    "chase": {
        "UA": {"ratio": 1.0, "name": "United MileagePlus"},
        "BA": {"ratio": 1.0, "name": "British Airways Avios"},
        "HH": {"ratio": 1.0, "name": "Hilton Honors"},
        ...
    },
    "amex": {
        "DL": {"ratio": 1.0, "name": "Delta SkyMiles"},
        "AF": {"ratio": 1.0, "name": "Air France Flying Blue"},
        ...
    },
    ...
}
```

**Determining Point Availability:**

The function `_can_provide_points()` checks if a member can provide points for a booking:

1. Check if member is willing to share (`willing_to_share_points = True`)
2. Check direct balance in the target program
3. Check if any bank program can transfer to the target

---

## Settlement Calculation

**File:** `backend/src/handlers/group_oop_optimizer.py`  
**Function:** `_calculate_settlements()`

When Alice uses her points for Bob's flight, Bob owes Alice the **fair market value** of those points.

**Process:**

1. Track all cross-member point contributions during solution extraction
2. Calculate fair market value using `get_fair_market_value()`
3. Generate settlement entries (who owes whom)
4. Consolidate and net out bidirectional settlements

```python
@dataclass
class SettlementEntry:
    from_member: str       # Who owes
    from_member_name: str
    to_member: str         # Who receives
    to_member_name: str
    amount_usd: float      # Settlement amount
    reason: str            # e.g., "Points used for your JFK→CDG flight"
    breakdown: List[Dict]  # Itemized breakdown
```

**Example:**
- Alice uses 50,000 United miles (worth $750) for Bob's flight
- Bob owes Alice $750
- If Bob also used 30,000 of his points (worth $450) for Alice's hotel, the net settlement is Bob owes Alice $300

**Fair Market Values:**

Located in `backend/src/handlers/fair_market_values.py`:

```python
# Cents per point (CPP) by program
FAIR_MARKET_VALUES = {
    "UA": 1.5,   # United miles worth 1.5¢ each
    "DL": 1.2,   # Delta miles worth 1.2¢ each
    "chase": 2.0, # Chase UR worth 2.0¢ each
    ...
}

def get_fair_market_value(program: str, points: int) -> float:
    cpp = FAIR_MARKET_VALUES.get(program.upper(), 1.5)
    return points * cpp / 100  # Returns USD
```

---

## Key Files Reference

### Frontend

| File | Purpose |
|------|---------|
| `frontend/src/app/(app)/group/setup/page.tsx` | Trip creation |
| `frontend/src/app/(app)/group/join/[inviteCode]/page.tsx` | Member joining |
| `frontend/src/app/(app)/group/dashboard/page.tsx` | Dashboard |
| `frontend/src/app/(app)/group/results/page.tsx` | Optimization results |
| `frontend/src/app/(app)/group/payment/page.tsx` | Service fee payment |
| `frontend/src/app/(app)/group/booking/page.tsx` | Booking checklist |
| `frontend/src/app/(app)/group/settlement/page.tsx` | Settlement management |
| `frontend/src/lib/api.ts` | API client (lines 2873-2888 for group optimization) |
| `frontend/src/lib/hooks/useOOPOptimization.ts` | Optimization hook |

### Backend

| File | Purpose |
|------|---------|
| `backend/src/app.py` (line 2324) | API route definitions |
| `backend/src/handlers/group_api.py` | Group optimization handlers |
| `backend/src/handlers/group_oop_optimizer.py` | ILP optimizer (core algorithm) |
| `backend/src/handlers/group_points_pooling.py` | Points aggregation |
| `backend/src/handlers/cost_allocation.py` | Settlement calculation |
| `backend/src/handlers/transfer_strategy.py` | Transfer graph definitions |
| `backend/src/handlers/fair_market_values.py` | Points valuation |
| `backend/src/agents/orchestrator.py` | Main orchestration agent |
| `backend/src/agents/group_allocator.py` | Booking allocation logic |
| `backend/src/services/trip_service.py` | Trip data access |
| `backend/src/services/trip_member_service.py` | Member management |
| `backend/src/services/points_service.py` | Points balance management |

### Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `minimize_group_out_of_pocket()` | `group_oop_optimizer.py:246` | Main ILP solver |
| `handle_optimize_oop()` | `group_api.py:155` | API handler |
| `aggregate_group_points()` | `group_points_pooling.py` | Points pooling |
| `_can_provide_points()` | `group_oop_optimizer.py:542` | Check point availability |
| `_calculate_settlements()` | `group_oop_optimizer.py:845` | Settlement math |
| `_build_group_transfer_plan()` | `group_oop_optimizer.py:754` | Transfer instructions |
| `allocate_costs()` | `cost_allocation.py` | Detailed cost breakdown |

---

## Summary

The group optimizer workflow:

1. **Frontend:** Users create/join trips, enter points, set preferences
2. **API:** Requests flow through FastAPI routes to handlers
3. **Aggregation:** Points from all members are pooled
4. **ILP Optimization:** Solver minimizes OOP with constraints
5. **Extraction:** Results include allocations, transfers, settlements
6. **Display:** Frontend shows ranked itineraries with booking instructions

The ILP model is the heart of the system - it's what enables Tripy to find the optimal way to use multiple people's points across different programs to minimize what everyone pays out of pocket.
