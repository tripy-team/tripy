# AwardTool Points Transfer & Redemption Strategy

## Implementation Plan

This document outlines a comprehensive strategy for using the AwardTool API to create an intelligent loyalty points transfer and redemption system that minimizes out-of-pocket costs while maximizing point value.

---

## Table of Contents

1. [Strategic Overview](#1-strategic-overview)
2. [Core API Integration](#2-core-api-integration)
3. [Transfer Decision Engine](#3-transfer-decision-engine)
4. [Redemption Optimization Algorithm](#4-redemption-optimization-algorithm)
5. [User Experience Flow](#5-user-experience-flow)
6. [Implementation Phases](#6-implementation-phases)
7. [Technical Architecture](#7-technical-architecture)
8. [Data Models](#8-data-models)
9. [API Endpoints](#9-api-endpoints)
10. [Testing Strategy](#10-testing-strategy)

---

## 1. Strategic Overview

### 1.1 Problem Statement

Users have fragmented loyalty points across multiple bank programs (Chase UR, Amex MR, Citi TY, Capital One, Bilt) and airline programs (United, Delta, American, etc.). Determining the optimal way to:
- **Transfer** bank points to airline/hotel programs
- **Redeem** those points for maximum value
- **Minimize** total out-of-pocket (cash + surcharges)

...is a complex multi-variable optimization problem.

### 1.2 Solution: AwardTool-Powered Transfer Intelligence

Leverage AwardTool's `transfer_options` field to automatically determine:

| Decision | Data Source | Optimization Goal |
|----------|-------------|-------------------|
| Which bank to transfer from | `transfer_options.program` | Minimize points required |
| How many points to transfer | `transfer_options.points` | Match exact award cost |
| Which airline program to book through | `program_code` | Lowest surcharge + best availability |
| When to transfer | Transfer time metadata | Match travel timeline |

### 1.3 Key Differentiator: OOP vs CPP Optimization

| Traditional (CPP) | Our Approach (OOP) |
|-------------------|-------------------|
| Maximize cents-per-point value | Minimize total cash paid |
| Skip "low value" redemptions | Use points if it reduces cash outlay |
| Optimize per-segment | Optimize entire trip holistically |
| May leave points unused | Strategically depletes point balances |

**Example Impact:**
- Trip cost: $2,550 (2 flights + 5-night hotel)
- CPP approach: $1,370 OOP (uses points only when CPP ≥ 1.0¢)
- OOP approach: $210 OOP (uses points wherever they eliminate cash)
- **Savings: $1,160 (85% reduction)**

---

## 2. Core API Integration

### 2.1 AwardTool Endpoints to Leverage

#### Primary: Real-time Search API

```
POST https://www.awardtool-api.com/search_real_time
```

**Key Response Field: `transfer_options`**

```json
{
  "data": [{
    "airline_code": "B6",
    "award_points": 14000,
    "surcharge": 5.6,
    "transfer_options": [
      { "points": 14000, "program": "chase" },
      { "points": 17500, "program": "amex" },
      { "points": 14000, "program": "citi" }
    ],
    "url": "https://www.jetblue.com/booking/flights?..."
  }]
}
```

This tells us:
- **Chase/Citi**: 14,000 points (1:1 transfer ratio)
- **Amex**: 17,500 points (1:1.25 ratio - less efficient)

#### Secondary: Panorama Calendar API

```
POST https://www.awardtool-api.com/panorama/panorama_calendar_data
```

Use for date flexibility optimization - find dates with best award availability before committing to specific searches.

#### Tertiary: Async Polling API (Performance)

```
POST https://apis.awardtool.com/flight_trigger/search_real_time  (trigger)
POST https://apis.awardtool.com/flight_retrieval/search_result   (poll)
```

Use for multi-route searches to improve performance via parallelization.

### 2.2 Data Extraction Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    AwardTool API Response                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Extract:                                                        │
│  • award_points (base airline miles required)                   │
│  • surcharge (taxes/fees in USD)                                │
│  • transfer_options[] (bank transfer paths + costs)             │
│  • fare.products[] (flight segments, times, aircraft)           │
│  • url (direct booking link)                                    │
│  • cabin_prices{} (costs by cabin class)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Normalize into TransferOption objects:                          │
│  {                                                               │
│    bank: "chase",                                                │
│    airline: "B6",                                                │
│    bank_points_needed: 14000,                                   │
│    airline_miles_received: 14000,                               │
│    transfer_ratio: 1.0,                                          │
│    surcharge: 5.6,                                               │
│    booking_url: "...",                                           │
│    transfer_time: "instant"                                      │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Transfer Decision Engine

### 3.1 Multi-Factor Ranking Algorithm

For each award flight, rank transfer options by:

```python
def rank_transfer_options(
    transfer_options: List[TransferOption],
    user_balances: Dict[str, int],
    preferences: UserPreferences
) -> List[RankedOption]:
    """
    Rank transfer options considering multiple factors.
    
    Priority Order:
    1. Sufficient balance (disqualify if insufficient)
    2. Fewest bank points required
    3. Lowest surcharge
    4. Fastest transfer time (if travel is imminent)
    5. User preference (if they prefer certain programs)
    """
    ranked = []
    
    for opt in transfer_options:
        bank = opt["program"].lower()
        points_needed = opt["points"]
        user_balance = user_balances.get(bank, 0)
        
        # Calculate eligibility and score
        is_eligible = user_balance >= points_needed
        
        # Score components (lower is better)
        points_score = points_needed / 1000  # Normalize
        surcharge_score = opt.get("surcharge", 0) / 10
        
        # Time urgency penalty
        days_until_travel = preferences.get("days_until_travel", 30)
        transfer_time = BANK_TRANSFER_TIMES.get(bank, 2)  # days
        time_penalty = 100 if transfer_time > days_until_travel else 0
        
        total_score = points_score + surcharge_score + time_penalty
        
        ranked.append({
            "option": opt,
            "bank": bank,
            "is_eligible": is_eligible,
            "score": total_score,
            "user_balance": user_balance,
            "shortfall": max(0, points_needed - user_balance),
        })
    
    # Sort: eligible first, then by score
    return sorted(ranked, key=lambda x: (not x["is_eligible"], x["score"]))
```

### 3.2 Bank Transfer Metadata

```python
BANK_TRANSFER_METADATA = {
    "chase": {
        "name": "Chase Ultimate Rewards",
        "portal_url": "https://ultimaterewardspoints.chase.com",
        "transfer_time_days": 0,  # Instant
        "transfer_time_display": "Instant",
        "minimum_transfer": 1000,
        "transfer_increments": 1000,
        "cards": ["Sapphire Reserve", "Sapphire Preferred", "Ink Preferred"],
    },
    "amex": {
        "name": "American Express Membership Rewards",
        "portal_url": "https://global.americanexpress.com/rewards",
        "transfer_time_days": 1,  # 1-2 business days typical
        "transfer_time_display": "1-2 business days",
        "minimum_transfer": 1000,
        "transfer_increments": 1000,
        "cards": ["Platinum", "Gold", "Green", "Business Platinum"],
    },
    "citi": {
        "name": "Citi ThankYou Points",
        "portal_url": "https://thankyou.citi.com",
        "transfer_time_days": 0,
        "transfer_time_display": "Instant to 24 hours",
        "minimum_transfer": 1000,
        "transfer_increments": 1000,
        "cards": ["Premier", "Prestige", "Custom Cash"],
    },
    "capitalone": {
        "name": "Capital One Miles",
        "portal_url": "https://www.capitalone.com/credit-cards/benefits/travel/",
        "transfer_time_days": 1,
        "transfer_time_display": "Instant to 2 days",
        "minimum_transfer": 100,
        "transfer_increments": 100,
        "cards": ["Venture X", "Venture", "Spark Miles"],
    },
    "bilt": {
        "name": "Bilt Rewards",
        "portal_url": "https://www.biltrewards.com",
        "transfer_time_days": 0,
        "transfer_time_display": "Instant",
        "minimum_transfer": 1000,
        "transfer_increments": 1000,
        "special_notes": [
            "Best value: Transfer on rent payment day (1st of month)",
            "Double points on dining at Bilt Dining partners",
        ],
        "cards": ["Bilt Mastercard"],
    },
}
```

### 3.3 Transfer Ratio Variations

Some banks have non-1:1 transfer ratios to certain programs:

```python
TRANSFER_RATIOS = {
    # (bank, airline) -> ratio (bank_points : airline_miles)
    ("amex", "HH"): 1.0 / 2.0,   # 1 MR = 2 Hilton (good for hotels)
    ("amex", "DL"): 1.0,         # 1 MR = 1 SkyMile
    ("amex", "B6"): 1.0 / 0.8,   # 1 MR = 0.8 TrueBlue (less efficient)
    
    ("chase", "HYATT"): 1.0,     # 1 UR = 1 World of Hyatt (excellent)
    ("chase", "UA"): 1.0,        # 1 UR = 1 MileagePlus
    ("chase", "MAR"): 1.0,       # 1 UR = 1 Marriott
    
    # Default: 1:1 for any unlisted combination
}

def get_effective_ratio(bank: str, airline: str) -> float:
    return TRANSFER_RATIOS.get((bank, airline), 1.0)
```

---

## 4. Redemption Optimization Algorithm

### 4.1 ILP Formulation: Minimum Out-of-Pocket

**Objective:** Minimize total cash expenditure across entire trip

```
Variables:
  pay_cash[i] ∈ {0,1}         # 1 if item i paid with cash
  use_points[i,p] ∈ {0,1}     # 1 if item i paid via program p
  transfer[b,p] ∈ ℤ⁺          # Points transferred from bank b to program p

Objective:
  Minimize Σᵢ (pay_cash[i] × cash_cost[i]) + 
           Σᵢ,ₚ (use_points[i,p] × surcharge[i,p])

Subject to:
  # Each item paid exactly once
  ∀i: pay_cash[i] + Σₚ use_points[i,p] = 1

  # Don't exceed available points (including transferred)
  ∀p: Σᵢ (use_points[i,p] × points_req[i,p]) ≤ balance[p] + Σᵦ transfer[b,p]

  # Don't transfer more than available
  ∀b: Σₚ transfer[b,p] ≤ balance[b]

  # Only transfer to valid partners
  ∀b,p: transfer[b,p] = 0 if not can_transfer(b, p)
```

### 4.2 Implementation

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
import pulp as pl

@dataclass
class BookableItem:
    item_id: str
    item_type: str  # "flight" or "hotel"
    description: str  # "JFK → CDG (Air France)"
    cash_cost: float
    points_options: List[Dict]  # [{program, points, surcharge}]

@dataclass 
class OptimizationResult:
    status: str
    total_out_of_pocket: float
    total_points_used: int
    payments: List[Dict]
    transfers: List[Dict]
    comparison_all_cash: float
    savings: float

def minimize_out_of_pocket(
    items: List[BookableItem],
    user_balances: Dict[str, int],
    transfer_graph: Dict[str, List[str]],
) -> OptimizationResult:
    """
    Solve ILP to find minimum out-of-pocket payment strategy.
    """
    prob = pl.LpProblem("MinOOP", pl.LpMinimize)
    
    # Identify banks (lowercase) vs airline/hotel programs (uppercase)
    banks = [k for k in user_balances if k.islower()]
    programs = set()
    for item in items:
        for opt in item.points_options:
            programs.add(opt["program"])
    
    # Decision variables
    pay_cash = {
        item.item_id: pl.LpVariable(f"cash_{item.item_id}", cat="Binary")
        for item in items
    }
    
    use_points = {
        (item.item_id, opt["program"]): pl.LpVariable(
            f"pts_{item.item_id}_{opt['program']}", cat="Binary"
        )
        for item in items
        for opt in item.points_options
    }
    
    transfer = {
        (bank, prog): pl.LpVariable(f"xfer_{bank}_{prog}", lowBound=0, cat="Integer")
        for bank in banks
        for prog in programs
        if prog in transfer_graph.get(bank, [])
    }
    
    # Objective: Minimize OOP
    prob += (
        pl.lpSum(pay_cash[item.item_id] * item.cash_cost for item in items) +
        pl.lpSum(
            use_points[(item.item_id, opt["program"])] * opt["surcharge"]
            for item in items
            for opt in item.points_options
        )
    )
    
    # Constraint: Pay each item exactly once
    for item in items:
        prob += (
            pay_cash[item.item_id] + 
            pl.lpSum(use_points[(item.item_id, opt["program"])] 
                    for opt in item.points_options) == 1
        )
    
    # Constraint: Don't exceed points balance
    for prog in programs:
        points_used = pl.lpSum(
            use_points[(item.item_id, opt["program"])] * opt["points"]
            for item in items
            for opt in item.points_options
            if opt["program"] == prog
        )
        transferred_in = pl.lpSum(
            transfer[(bank, prog)]
            for bank in banks
            if (bank, prog) in transfer
        )
        native_balance = user_balances.get(prog, 0)
        
        prob += points_used <= native_balance + transferred_in
    
    # Constraint: Don't transfer more than bank balance
    for bank in banks:
        prob += pl.lpSum(
            transfer[(bank, prog)]
            for prog in programs
            if (bank, prog) in transfer
        ) <= user_balances[bank]
    
    # Solve
    prob.solve(pl.PULP_CBC_CMD(msg=False))
    
    # Extract solution
    return _extract_solution(prob, items, pay_cash, use_points, transfer, user_balances)
```

### 4.3 Multi-Segment Consolidation

When booking multiple flights, prefer consolidating to fewer transfer operations:

```python
def consolidate_transfers(raw_transfers: List[Dict]) -> List[Dict]:
    """
    Combine transfers to the same airline program.
    
    Example:
      [Chase→UA 20000, Chase→UA 15000] → [Chase→UA 35000]
    """
    consolidated = {}
    
    for xfer in raw_transfers:
        key = (xfer["from_bank"], xfer["to_program"])
        if key in consolidated:
            consolidated[key]["points"] += xfer["points"]
            consolidated[key]["for_segments"].extend(xfer["for_segments"])
        else:
            consolidated[key] = {
                "from_bank": xfer["from_bank"],
                "to_program": xfer["to_program"],
                "points": xfer["points"],
                "for_segments": xfer["for_segments"].copy(),
            }
    
    return list(consolidated.values())
```

---

## 5. User Experience Flow

### 5.1 End-to-End Journey

```
┌─────────────────────────────────────────────────────────────────────┐
│  Step 1: User Creates Trip                                          │
│  • Enter destinations, dates, travelers                             │
│  • Input point balances (Chase: 150K, Amex: 200K, etc.)            │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 2: System Searches (Parallel)                                 │
│  • AwardTool: Award availability + transfer_options                 │
│  • SerpAPI: Cash prices for comparison                              │
│  • Panorama Calendar: Date flexibility suggestions                  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 3: Optimization Engine                                        │
│  • Build unified cost graph (flights + hotels)                      │
│  • Run ILP solver to minimize OOP                                   │
│  • Generate transfer + payment plan                                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 4: Present Strategy to User                                   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  YOUR OPTIMIZED TRIP                                         │   │
│  │                                                               │   │
│  │  Total Out-of-Pocket: $210                                   │   │
│  │  vs. All Cash: $2,550                                        │   │
│  │  You Save: $2,340 (92%)                                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  STEP 1: TRANSFER YOUR POINTS                                │   │
│  │                                                               │   │
│  │  ① Chase UR → Air France Flying Blue                        │   │
│  │     Transfer: 60,000 points                                  │   │
│  │     [Open Chase Portal]                                      │   │
│  │                                                               │   │
│  │  ② Amex MR → Hilton Honors                                  │   │
│  │     Transfer: 100,000 points → 200,000 Hilton               │   │
│  │     [Open Amex Portal]                                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  STEP 2: BOOK YOUR TRIP                                      │   │
│  │                                                               │   │
│  │  ✈ JFK → CDG - Air France                                   │   │
│  │    60,000 miles + $120 taxes                                 │   │
│  │    [Book on AirFrance.com]                                   │   │
│  │                                                               │   │
│  │  🏨 Hilton Paris Opera (5 nights)                           │   │
│  │    200,000 points + $40 resort fee                          │   │
│  │    [Book on Hilton.com]                                      │   │
│  │                                                               │   │
│  │  ✈ CDG → JFK - Air France                                   │   │
│  │    55,000 miles + $50 taxes                                  │   │
│  │    [Book on AirFrance.com]                                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Step-by-Step Transfer Instructions

For each transfer, provide explicit instructions:

```python
def generate_transfer_instructions(
    bank: str,
    airline: str,
    points: int,
    user_context: Dict,
) -> Dict:
    """
    Generate step-by-step transfer instructions.
    """
    bank_info = BANK_TRANSFER_METADATA[bank]
    airline_info = AIRLINE_METADATA.get(airline, {})
    
    steps = [
        f"1. Log in to your {bank_info['name']} account",
        f"2. Go to: {bank_info['portal_url']}",
        f"3. Click 'Transfer Points' or 'Travel Partners'",
        f"4. Find '{airline_info.get('name', airline)}' in the partner list",
        f"5. Enter your {airline_info.get('name', airline)} loyalty number",
        f"   (Create a free account at {airline_info.get('signup_url', 'their website')} if needed)",
        f"6. Enter transfer amount: {points:,} points",
        f"7. Confirm the transfer",
    ]
    
    # Add timing advice
    transfer_time = bank_info['transfer_time_display']
    if bank_info['transfer_time_days'] > 0:
        steps.append(f"8. Wait for transfer to complete ({transfer_time})")
        steps.append(f"   ⚠️ Do NOT book until points appear in your {airline_info.get('name', airline)} account")
    else:
        steps.append(f"8. Points transfer instantly - you can book immediately!")
    
    return {
        "summary": f"Transfer {points:,} {bank_info['name']} → {airline_info.get('name', airline)}",
        "from_program": bank_info['name'],
        "to_program": airline_info.get('name', airline),
        "points_to_transfer": points,
        "transfer_portal_url": bank_info['portal_url'],
        "transfer_time": transfer_time,
        "steps": steps,
        "special_notes": bank_info.get('special_notes', []),
    }
```

---

## 6. Implementation Phases

### Phase 1: Foundation (Core Transfer Intelligence)

| Task | Description | Priority | Effort |
|------|-------------|----------|--------|
| 1.1 | Extract `transfer_options` from AwardTool responses | Critical | Low |
| 1.2 | Create `BANK_TRANSFER_METADATA` constant | Critical | Low |
| 1.3 | Implement `rank_transfer_options()` function | Critical | Medium |
| 1.4 | Add transfer instructions generator | High | Medium |
| 1.5 | Update itinerary response to include transfer_plan | High | Medium |

**Deliverable:** Users see specific transfer instructions (which bank, how many points, portal URL)

### Phase 2: Optimization Engine

| Task | Description | Priority | Effort |
|------|-------------|----------|--------|
| 2.1 | Define `BookableItem` and related dataclasses | Critical | Low |
| 2.2 | Implement `minimize_out_of_pocket()` ILP solver | Critical | High |
| 2.3 | Add hotel points options to cost graph | High | Medium |
| 2.4 | Implement transfer consolidation logic | Medium | Low |
| 2.5 | Add CPP calculation for value display | Medium | Low |

**Deliverable:** System automatically determines optimal points allocation across entire trip

### Phase 3: Enhanced API Integration

| Task | Description | Priority | Effort |
|------|-------------|----------|--------|
| 3.1 | Migrate to async polling API for better performance | Medium | Medium |
| 3.2 | Integrate Panorama Calendar for date flexibility | Medium | Medium |
| 3.3 | Add transfer bonus tracking (promotional ratios) | Low | Medium |
| 3.4 | Implement partner award edge generation | Low | High |

**Deliverable:** Faster searches, smarter date suggestions, promotional awareness

### Phase 4: Frontend Experience

| Task | Description | Priority | Effort |
|------|-------------|----------|--------|
| 4.1 | Create `TransferStrategyCard` component | High | Medium |
| 4.2 | Create `PaymentBreakdown` component | High | Medium |
| 4.3 | Add "Copy to Clipboard" for transfer amounts | Medium | Low |
| 4.4 | Create visual transfer flow diagram | Low | Medium |
| 4.5 | Add savings comparison visualization | Medium | Medium |

**Deliverable:** Beautiful, actionable UI for transfer instructions

---

## 7. Technical Architecture

### 7.1 System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                               FRONTEND                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ TripPlanPage    │  │ ItineraryView   │  │ TransferStrategy│              │
│  │                 │──│                 │──│ Component       │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ API
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               BACKEND                                        │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    API Layer (app.py)                                │    │
│  │  POST /api/trip/optimize-out-of-pocket                              │    │
│  │  POST /api/transfers/simulate                                        │    │
│  │  GET  /api/transfers/instructions/{trip_id}                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                   │                                          │
│          ┌────────────────────────┼────────────────────────┐                │
│          ▼                        ▼                        ▼                │
│  ┌───────────────┐    ┌───────────────────┐    ┌───────────────────┐       │
│  │ flights.py    │    │ trip_cost_        │    │ min_oop_          │       │
│  │               │    │ optimizer.py      │    │ optimizer.py      │       │
│  │ - AwardTool   │    │                   │    │                   │       │
│  │ - SerpAPI     │    │ - Aggregate costs │    │ - ILP solver      │       │
│  │ - Merge data  │    │ - Normalize items │    │ - Payment plan    │       │
│  └───────────────┘    └───────────────────┘    └───────────────────┘       │
│          │                        │                        │                │
│          └────────────────────────┼────────────────────────┘                │
│                                   ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    transfer_strategy.py                              │    │
│  │                                                                      │    │
│  │  • BANK_TRANSFER_METADATA                                           │    │
│  │  • EXTENDED_TRANSFER_GRAPH (banks → airlines + hotels)              │    │
│  │  • rank_transfer_options()                                          │    │
│  │  • generate_transfer_instructions()                                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SERVICES                                   │
│                                                                              │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐               │
│  │  AwardTool    │    │  SerpAPI      │    │  Database     │               │
│  │  API          │    │  (cash fares) │    │  (user points)│               │
│  └───────────────┘    └───────────────┘    └───────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 File Structure

```
backend/src/
├── handlers/
│   ├── flights.py              # Existing - AwardTool integration
│   ├── hotels.py               # Existing - Hotel search
│   ├── transfer_strategy.py    # NEW - Transfer graph, metadata, instructions
│   ├── trip_cost_optimizer.py  # NEW - Unified cost aggregation
│   └── min_oop_optimizer.py    # NEW - ILP solver for OOP minimization
├── services/
│   └── itinerary_service.py    # Updated - Include transfer_plan in response
└── utils/
    └── display_formatters.py   # Updated - Format transfer instructions

frontend/src/
├── components/
│   ├── TransferStrategy.tsx    # NEW - Main transfer strategy display
│   ├── TransferCard.tsx        # NEW - Individual transfer instruction
│   └── PaymentBreakdown.tsx    # NEW - Payment summary by item
└── hooks/
    └── useTransferOptimization.ts  # NEW - API hook
```

---

## 8. Data Models

### 8.1 Backend Models

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Literal
from enum import Enum

class PaymentType(Enum):
    CASH = "cash"
    POINTS = "points"

@dataclass
class TransferOption:
    """A single transfer path from bank to loyalty program."""
    bank_code: str                  # "chase", "amex", etc.
    bank_name: str                  # "Chase Ultimate Rewards"
    target_program: str             # "UA", "HH", etc.
    target_program_name: str        # "United MileagePlus"
    bank_points_required: int       # Points to transfer from bank
    program_points_received: int    # Points that arrive (may differ due to ratio)
    transfer_ratio: float           # e.g., 1.0 or 2.0 for Amex→Hilton
    transfer_time: str              # "instant", "1-2 business days"
    portal_url: str                 # Direct link to transfer portal

@dataclass
class BookableItem:
    """A flight or hotel that can be paid with cash or points."""
    item_id: str
    item_type: Literal["flight", "hotel"]
    description: str                # Human-readable description
    route: Optional[str]            # "JFK → CDG" for flights
    date: str                       # "2026-03-15"
    cash_cost: float                # Full cash price
    points_options: List[Dict]      # [{program, points, surcharge, transfer_options}]
    booking_url: Optional[str]      # Direct booking link

@dataclass
class PaymentInstruction:
    """How to pay for a specific item."""
    item_id: str
    item_type: str
    description: str
    payment_type: PaymentType
    cash_paid: float                # Actual cash outlay
    points_used: Optional[int]      # If paying with points
    program_used: Optional[str]     # Loyalty program used
    booking_url: Optional[str]

@dataclass
class TransferInstruction:
    """Instructions to transfer points from bank to program."""
    from_bank: str
    from_bank_name: str
    to_program: str
    to_program_name: str
    points_to_transfer: int
    resulting_points: int
    transfer_ratio_display: str     # "1:1" or "1:2"
    transfer_time: str
    portal_url: str
    steps: List[str]                # Step-by-step guide
    notes: List[str]                # Special considerations
    for_items: List[str]            # Which bookings this covers

@dataclass
class OptimizationResult:
    """Complete optimization output."""
    status: str                     # "Optimal", "Infeasible"
    total_out_of_pocket: float
    total_points_used: int
    points_by_program: Dict[str, int]
    all_cash_cost: float
    savings: float
    savings_percentage: float
    transfers: List[TransferInstruction]
    payments: List[PaymentInstruction]
```

### 8.2 API Response Schema

```json
{
  "status": "Optimal",
  "summary": {
    "total_out_of_pocket": 210.00,
    "all_cash_cost": 2550.00,
    "savings": 2340.00,
    "savings_percentage": 91.8,
    "total_points_used": 315000
  },
  "points_by_program": {
    "Air France Flying Blue": 115000,
    "Hilton Honors": 200000
  },
  "transfers": [
    {
      "from_bank": "chase",
      "from_bank_name": "Chase Ultimate Rewards",
      "to_program": "AF",
      "to_program_name": "Air France Flying Blue",
      "points_to_transfer": 60000,
      "resulting_points": 60000,
      "transfer_ratio_display": "1:1",
      "transfer_time": "instant",
      "portal_url": "https://ultimaterewardspoints.chase.com",
      "steps": [
        "1. Log in to your Chase Ultimate Rewards account",
        "2. Go to: https://ultimaterewardspoints.chase.com",
        "3. Click 'Transfer Points' or 'Travel Partners'",
        "..."
      ],
      "notes": [],
      "for_items": ["flight_jfk_cdg"]
    }
  ],
  "payments": [
    {
      "item_id": "flight_jfk_cdg",
      "item_type": "flight",
      "description": "JFK → CDG on Air France",
      "payment_type": "points",
      "cash_paid": 120.00,
      "points_used": 60000,
      "program_used": "Air France Flying Blue",
      "booking_url": "https://www.airfrance.com/..."
    }
  ]
}
```

---

## 9. API Endpoints

### 9.1 Optimize Trip Out-of-Pocket

```
POST /api/trip/optimize-out-of-pocket
```

**Request:**
```json
{
  "trip_id": "abc123",
  "include_hotels": true,
  "points_override": null,
  "max_cash_budget": null
}
```

**Response:** Full `OptimizationResult` as shown above.

### 9.2 Simulate Transfer Strategy

```
POST /api/transfers/simulate
```

**Request:**
```json
{
  "available_points": {
    "chase": 150000,
    "amex": 200000
  },
  "expenses": [
    {
      "type": "flight",
      "description": "JFK → CDG",
      "cash_cost": 800,
      "points_options": [
        {"program": "AF", "points": 60000, "surcharge": 120}
      ]
    }
  ]
}
```

Use for "what if" scenarios without a saved trip.

### 9.3 Get Transfer Instructions

```
GET /api/transfers/instructions/{trip_id}
```

Returns just the transfer instructions portion, useful for refreshing the UI.

---

## 10. Testing Strategy

### 10.1 Unit Tests

| Test Case | Description | Expected Outcome |
|-----------|-------------|------------------|
| `test_rank_single_option` | One transfer option available | Returns that option |
| `test_rank_multiple_same_points` | Multiple options, same points | Prefer instant transfer |
| `test_rank_insufficient_balance` | No option has sufficient balance | Flag as ineligible, suggest partial |
| `test_ilp_basic_flight` | Single flight, user has enough points | Pay with points, $0 + surcharge |
| `test_ilp_hotel_low_cpp` | Hotel where CPP < 1.0 | Still use points (OOP approach) |
| `test_ilp_mixed_trip` | 2 flights + hotel, limited points | Optimal allocation across items |
| `test_ilp_transfer_required` | Bank points, no airline balance | Creates transfer instruction |

### 10.2 Integration Tests

```python
async def test_full_optimization_flow():
    """
    End-to-end test of optimization pipeline.
    """
    # Setup: User with 200K Amex, 100K Chase
    user_points = {"amex": 200000, "chase": 100000}
    
    # Trip: JFK → CDG → JFK with 3 nights at Hyatt
    trip = create_test_trip(
        destinations=[("JFK", "CDG", "2026-06-01", "2026-06-04")],
        return_date="2026-06-04"
    )
    
    # Execute optimization
    result = await optimize_trip_out_of_pocket(trip.id, user_points)
    
    # Verify
    assert result.status == "Optimal"
    assert result.total_out_of_pocket < 500  # Should be mostly surcharges
    assert len(result.transfers) >= 1  # At least one transfer needed
    assert result.savings > 0
```

### 10.3 Scenario Tests

| Scenario | Setup | Expected Behavior |
|----------|-------|-------------------|
| **Abundant Points** | 1M+ across programs | Use points everywhere, minimal OOP |
| **No Points** | 0 points | Pay cash everywhere, no transfers |
| **Single Bank** | 200K Chase only | Transfer to airlines Chase supports |
| **Multi-Bank Split** | 50K each in 4 banks | Consolidate to optimal airlines |
| **Travel Imminent** | Flight in 2 days | Avoid slow-transfer banks |
| **Budget Constraint** | Max $100 OOP | Must use points even at low CPP |

---

## Appendix A: Supported Transfer Partners

### Bank → Airline

| Bank | Airlines (1:1 unless noted) |
|------|----------------------------|
| **Chase UR** | United, Southwest, British Airways, Air France/KLM, Iberia, Singapore, Virgin Atlantic, Aer Lingus, JetBlue |
| **Amex MR** | Delta, JetBlue (1:0.8), ANA, Singapore, Cathay, British Airways, Air France, Emirates, Etihad, Virgin Atlantic, Qantas, Avianca, Iberia, Air Canada |
| **Citi TY** | JetBlue, Singapore, Cathay, Qatar, Emirates, Etihad, Turkish, Avianca, Air France, Thai, EVA, Virgin Atlantic |
| **Capital One** | Air Canada, Air France, British Airways, Emirates, Etihad, Finnair, Singapore, Turkish, Avianca, Qantas, TAP, Cathay |
| **Bilt** | United, American, Air France, Turkish, Emirates, Virgin Atlantic, Aer Lingus, Air Canada, Iberia, Cathay |

### Bank → Hotel

| Bank | Hotels (ratio) |
|------|----------------|
| **Chase UR** | Hyatt (1:1), Marriott (1:1), IHG (1:1) |
| **Amex MR** | Hilton (1:2), Marriott (1:1) |
| **Capital One** | Accor (1:1), Wyndham (1:1) |
| **Bilt** | Hyatt (1:1), IHG (1:1) |

---

## Appendix B: Example Walkthrough

### Scenario

**User Points:**
- Chase UR: 150,000
- Amex MR: 200,000
- United MileagePlus: 25,000 (native airline miles)

**Trip:**
- JFK → CDG (June 1): Cash $850 OR Air France 55,000 + $120
- Hilton Paris (3 nights): Cash $600 OR 150,000 Hilton + $30
- CDG → JFK (June 4): Cash $900 OR United 60,000 + $50

### Optimization Process

1. **Build cost graph:**
   - Flight 1: Cash=$850, Points=(AF:55K+$120)
   - Hotel: Cash=$600, Points=(HH:150K+$30, but need to transfer Amex at 1:2)
   - Flight 2: Cash=$900, Points=(UA:60K+$50)

2. **Check transfer paths:**
   - AF ← Chase (1:1) ✓
   - HH ← Amex (1:2, so 75K Amex = 150K Hilton) ✓
   - UA ← user already has 25K, need 35K more ← Chase (1:1) ✓

3. **ILP Solution:**
   - Flight 1: Pay with AF points → Transfer 55K Chase → AF
   - Hotel: Pay with Hilton points → Transfer 75K Amex → 150K Hilton
   - Flight 2: Pay with UA points → Use 25K existing + Transfer 35K Chase

4. **Result:**
   - Total OOP: $120 + $30 + $50 = **$200**
   - vs. All Cash: $2,350
   - **Savings: $2,150 (91%)**

### Transfer Instructions Generated

```
Step 1: Transfer Points

① Chase Ultimate Rewards → Air France Flying Blue
   Transfer: 55,000 points
   Time: Instant
   For: JFK → CDG flight
   [Open Chase Portal]

② Chase Ultimate Rewards → United MileagePlus
   Transfer: 35,000 points
   Time: Instant
   For: CDG → JFK flight
   [Open Chase Portal]

③ Amex Membership Rewards → Hilton Honors
   Transfer: 75,000 points → 150,000 Hilton points (2x bonus!)
   Time: 1-2 business days
   For: Hilton Paris hotel
   [Open Amex Portal]

Step 2: Book Your Trip

✈ JFK → CDG - Air France
  55,000 miles + $120 taxes
  [Book on airfrance.com]

🏨 Hilton Paris Opera (3 nights)
  150,000 points + $30 fees
  [Book on hilton.com]

✈ CDG → JFK - United
  60,000 miles + $50 taxes
  [Book on united.com]
```

---

*Document Version: 1.0*
*Last Updated: January 2026*
*Based on AwardTool API documentation and Tripy backend architecture*
