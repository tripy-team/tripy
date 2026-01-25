# Group Travel Out-of-Pocket Reduction: Complete Implementation Plan

## Executive Summary

This document provides a comprehensive implementation plan for enabling **group travel with optimized out-of-pocket (OOP) cost reduction** in Tripy. The system will allow multiple travelers to pool their credit card points, airline miles, and hotel loyalty balances to collectively minimize the total cash spent on a shared trip.

### Key Goals

1. **Minimize Group OOP**: Reduce total cash paid across ALL group members
2. **Intelligent Points Pooling**: Leverage combined points portfolios for better redemptions
3. **Fair Cost Allocation**: Transparently assign costs to each member
4. **Cross-Member Booking**: Allow any member's points to pay for any other member's booking
5. **Settlement Tracking**: Clear who owes whom after trip optimization

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Models & Schema](#2-data-models--schema)
3. [Group Points Pooling Engine](#3-group-points-pooling-engine)
4. [Group ILP Optimizer](#4-group-ilp-optimizer)
5. [Cost Allocation & Settlement](#5-cost-allocation--settlement)
6. [API Endpoints](#6-api-endpoints)
7. [Integration with Existing Systems](#7-integration-with-existing-systems)
8. [Frontend Components](#8-frontend-components)
9. [Implementation Phases](#9-implementation-phases)
10. [Complete Example Walkthrough](#10-complete-example-walkthrough)

---

## 1. Architecture Overview

### 1.1 High-Level System Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           GROUP TRIP CREATION                                    │
│                                                                                  │
│  Trip Organizer creates trip → Sends invites → Members join with:               │
│  • Travel preferences (departure city, dates, cabin class)                      │
│  • Points balances (Chase: 100K, Amex: 150K, United: 50K, etc.)                │
│  • Budget constraints                                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      STEP 1: AGGREGATE GROUP RESOURCES                           │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐      │
│  │                    POOLED POINTS INVENTORY                            │      │
│  ├──────────────────────────────────────────────────────────────────────┤      │
│  │ Member │ Chase │ Amex │ Citi │ United │ Hilton │ Total Value        │      │
│  │ Alice  │ 150K  │  0   │  0   │   0    │   0    │ $2,250             │      │
│  │ Bob    │   0   │ 200K │  0   │  50K   │   0    │ $3,750             │      │
│  │ Carol  │  80K  │  0   │ 100K │   0    │  150K  │ $3,750             │      │
│  │ ────── │ ───── │ ──── │ ──── │ ────── │ ────── │ ──────             │      │
│  │ TOTAL  │ 230K  │ 200K │ 100K │  50K   │  150K  │ $9,750             │      │
│  └──────────────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      STEP 2: PARALLEL DATA COLLECTION                            │
│                                                                                  │
│  For EACH member's departure → shared destinations:                             │
│                                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐              │
│  │  AwardTool API   │  │   SerpAPI        │  │   Hotel APIs     │              │
│  │  Real-time +     │  │   Google Flights │  │   AwardTool +    │              │
│  │  Panorama        │  │   Cash prices    │  │   Google Hotels  │              │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘              │
│                                                                                  │
│  Output: Flight options with transfer_options, cash prices, hotel awards        │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      STEP 3: GROUP ILP OPTIMIZATION                              │
│                                                                                  │
│  Objective: MINIMIZE total group out-of-pocket cost                             │
│                                                                                  │
│  Decision Variables:                                                             │
│  • For each (member, segment): pay_cash OR use_points[program]                  │
│  • For each (owner, bank, program): transfer_amount                             │
│  • Cross-member point usage allowed                                             │
│                                                                                  │
│  Constraints:                                                                    │
│  • Each member's segments must be booked exactly once                           │
│  • Points usage ≤ owner's balance + transferred-in                              │
│  • Transfer validity (bank → airline/hotel partnerships)                        │
│  • Optional: Per-member budget caps                                             │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      STEP 4: COST ALLOCATION & SETTLEMENT                        │
│                                                                                  │
│  For each payment:                                                               │
│  • Track: WHO's points were used, for WHOSE booking                             │
│  • Calculate point value at fair market rate                                    │
│  • Generate settlement matrix                                                    │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐      │
│  │                    SETTLEMENT SUMMARY                                 │      │
│  ├──────────────────────────────────────────────────────────────────────┤      │
│  │ Member │ Points Contributed │ Flights Covered │ Net Balance          │      │
│  │ Alice  │ 150K ($2,250)      │ Alice+Bob       │ -$300 (receives)     │      │
│  │ Bob    │ 50K ($750)         │ Bob             │ +$500 (owes)         │      │
│  │ Carol  │ 180K ($2,700)      │ Carol+Alice     │ -$200 (receives)     │      │
│  └──────────────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      STEP 5: TRANSFER & BOOKING INSTRUCTIONS                     │
│                                                                                  │
│  Ordered execution plan:                                                         │
│  1. Alice: Transfer 55K Chase → Air France (for Alice+Bob JFK→CDG)             │
│  2. Carol: Transfer 80K Chase → United (for Carol ORD→CDG)                      │
│  3. Bob: Transfer 80K Amex → Hilton (for group hotel)                           │
│  4. Book flights using transferred miles                                         │
│  5. Book hotel using transferred points                                          │
│  6. Settlement: Bob pays Alice $500 via Venmo/PayPal                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Files & Modifications

| File | Purpose | Changes Required |
|------|---------|------------------|
| `backend/src/handlers/group_oop_optimizer.py` | **NEW** - Group ILP optimizer | Create new |
| `backend/src/handlers/min_oop_optimizer.py` | Base ILP optimizer | Extend for multi-member |
| `backend/src/handlers/transfer_strategy.py` | Transfer graph & instructions | Add cross-member support |
| `backend/src/services/itinerary_service.py` | Orchestration | Add group optimization flow |
| `backend/src/services/trip_member_service.py` | Member management | Add points aggregation |
| `backend/src/handlers/flights.py` | AwardTool API client | Add multi-origin support |
| `backend/src/repos/trip_member_repo.py` | Member data access | Add points by member queries |

---

## 2. Data Models & Schema

### 2.1 Database Schema Additions

#### `tripy-group-points` Table (NEW)

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | String | `TRIP#{trip_id}` |
| `SK` | String | `MEMBER#{user_id}#PROGRAM#{program_code}` |
| `trip_id` | String | Trip identifier |
| `user_id` | String | Member identifier |
| `program_code` | String | Points program (chase, amex, UA, HH, etc.) |
| `balance` | Number | Points balance |
| `contributed` | Number | Points used for group bookings |
| `updated_at` | String | Last update timestamp |

#### `tripy-group-settlements` Table (NEW)

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | String | `TRIP#{trip_id}` |
| `SK` | String | `SETTLEMENT#{settlement_id}` |
| `from_user_id` | String | Who owes |
| `to_user_id` | String | Who receives |
| `amount` | Number | Settlement amount in USD |
| `points_value` | Number | Value of points contributed |
| `status` | String | `pending`, `paid`, `confirmed` |
| `created_at` | String | Creation timestamp |

### 2.2 Python Data Models

```python
# backend/src/handlers/group_oop_optimizer.py

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple, Any, Literal
from enum import Enum


class MemberRole(str, Enum):
    ORGANIZER = "organizer"
    MEMBER = "member"
    VIEWER = "viewer"


@dataclass
class GroupMember:
    """A member of a group trip."""
    user_id: str
    name: str
    role: MemberRole
    
    # Travel preferences
    departure_airport: str
    arrival_airport: Optional[str] = None  # If different from departure
    travel_dates: Optional[Tuple[str, str]] = None  # If flexible
    cabin_preference: str = "Economy"
    
    # Points portfolio
    points_balances: Dict[str, int] = field(default_factory=dict)
    # e.g., {"chase": 150000, "amex": 0, "UA": 50000}
    
    # Budget
    max_cash_budget: Optional[float] = None
    willing_to_share_points: bool = True
    
    # Constraints
    party_size: int = 1  # Number of travelers under this member


@dataclass
class GroupPointsPool:
    """Aggregated points across all group members."""
    # Total balances by program
    total_by_program: Dict[str, int] = field(default_factory=dict)
    
    # Breakdown by member
    by_member: Dict[str, Dict[str, int]] = field(default_factory=dict)
    # e.g., {"alice": {"chase": 150000}, "bob": {"amex": 200000}}
    
    # Available for cross-member use
    shareable_pool: Dict[str, int] = field(default_factory=dict)
    
    # Transfer potential (bank points that can become airline/hotel points)
    transfer_potential: Dict[str, List[str]] = field(default_factory=dict)
    # e.g., {"chase": ["UA", "BA", "HYATT"]}


@dataclass
class MemberBookingItem:
    """A bookable item for a specific member."""
    item_id: str
    member_id: str
    item_type: Literal["flight", "hotel"]
    description: str
    
    # Pricing
    cash_cost: float
    points_options: List["GroupPointsOption"] = field(default_factory=list)
    
    # Flight-specific
    origin: Optional[str] = None
    destination: Optional[str] = None
    date: Optional[str] = None
    party_size: int = 1  # Seats needed
    
    # Hotel-specific
    hotel_name: Optional[str] = None
    nights: Optional[int] = None


@dataclass
class GroupPointsOption:
    """A points payment option with cross-member support."""
    program_code: str
    points_required: int
    surcharge: float
    
    # Who can provide these points?
    available_from: List[str] = field(default_factory=list)
    # e.g., ["alice", "carol"] if both have enough Chase for this
    
    # Transfer info
    transfer_from_bank: Optional[str] = None
    transfer_ratio: float = 1.0


@dataclass
class GroupPaymentAllocation:
    """How a specific item is paid for."""
    item_id: str
    beneficiary_member: str  # Who this booking is FOR
    
    payment_type: Literal["cash", "points"]
    cash_paid: float
    
    # If points
    points_used: Optional[int] = None
    program_used: Optional[str] = None
    points_owner: Optional[str] = None  # Who PROVIDED the points
    
    # Value for settlement
    points_value_usd: Optional[float] = None  # Fair market value


@dataclass
class SettlementEntry:
    """A single settlement between two members."""
    from_member: str  # Who owes
    to_member: str    # Who receives
    amount_usd: float
    reason: str       # e.g., "Points used for your JFK→CDG flight"


@dataclass
class GroupOOPSolution:
    """Complete solution for group OOP optimization."""
    status: str  # "Optimal", "Feasible", "Infeasible"
    
    # Payment allocations for each booking
    allocations: List[GroupPaymentAllocation] = field(default_factory=list)
    
    # Transfer instructions (with owner info)
    transfer_plan: List["GroupTransferInstruction"] = field(default_factory=list)
    
    # Settlement matrix
    settlements: List[SettlementEntry] = field(default_factory=list)
    
    # Summary
    total_group_oop: float = 0.0
    oop_per_member: Dict[str, float] = field(default_factory=dict)
    points_used_per_member: Dict[str, int] = field(default_factory=dict)
    
    # Comparison
    all_cash_cost: float = 0.0
    total_savings: float = 0.0
    savings_percentage: float = 0.0
    
    # Remaining balances
    points_remaining: Dict[str, Dict[str, int]] = field(default_factory=dict)


@dataclass
class GroupTransferInstruction:
    """Transfer instruction with owner attribution."""
    owner_member: str  # Who owns the points being transferred
    
    from_program: str
    from_program_name: str
    to_program: str
    to_program_name: str
    
    points_to_transfer: int
    transfer_ratio: str
    resulting_points: int
    
    transfer_time: str
    portal_url: str
    booking_url: str
    
    # What this transfer covers
    for_members: List[str] = field(default_factory=list)
    for_items: List[str] = field(default_factory=list)
    
    steps: List[str] = field(default_factory=list)
```

---

## 3. Group Points Pooling Engine

### 3.1 Points Aggregation

```python
# backend/src/handlers/group_points_pooling.py

from typing import Dict, List, Optional
from dataclasses import dataclass
import logging

from .transfer_strategy import EXTENDED_TRANSFER_GRAPH, get_transfer_partners
from .group_oop_optimizer import GroupMember, GroupPointsPool

logger = logging.getLogger(__name__)


def aggregate_group_points(members: List[GroupMember]) -> GroupPointsPool:
    """
    Aggregate points across all group members into a unified pool.
    
    Args:
        members: List of GroupMember objects with their points balances
        
    Returns:
        GroupPointsPool with totals, breakdowns, and transfer potential
    """
    total_by_program: Dict[str, int] = {}
    by_member: Dict[str, Dict[str, int]] = {}
    shareable_pool: Dict[str, int] = {}
    
    for member in members:
        member_points = {}
        
        for program, balance in member.points_balances.items():
            if balance <= 0:
                continue
            
            # Normalize program code
            prog = program.upper() if len(program) <= 4 else program.lower()
            
            # Add to totals
            total_by_program[prog] = total_by_program.get(prog, 0) + balance
            member_points[prog] = balance
            
            # Add to shareable if member allows
            if member.willing_to_share_points:
                shareable_pool[prog] = shareable_pool.get(prog, 0) + balance
        
        by_member[member.user_id] = member_points
    
    # Calculate transfer potential
    transfer_potential = {}
    for prog in total_by_program.keys():
        prog_lower = prog.lower()
        if prog_lower in EXTENDED_TRANSFER_GRAPH:
            partners = get_transfer_partners(prog_lower)
            transfer_potential[prog] = partners
    
    return GroupPointsPool(
        total_by_program=total_by_program,
        by_member=by_member,
        shareable_pool=shareable_pool,
        transfer_potential=transfer_potential,
    )


def find_best_points_source(
    program_needed: str,
    points_needed: int,
    members: List[GroupMember],
    pool: GroupPointsPool,
    *,
    prefer_member: Optional[str] = None,
) -> List[Dict[str, any]]:
    """
    Find which member(s) can provide points for a given need.
    
    Prioritizes:
    1. Direct program balance (no transfer needed)
    2. Members with sufficient balance
    3. Members who prefer to use their points
    4. Combining multiple members if needed
    
    Args:
        program_needed: Airline/hotel program code (e.g., "UA", "HH")
        points_needed: Number of points required
        members: List of group members
        pool: Aggregated points pool
        prefer_member: Optional member ID to prefer (e.g., the beneficiary)
        
    Returns:
        List of sources: [{"member": "alice", "program": "UA", "amount": 50000}, ...]
    """
    sources = []
    remaining = points_needed
    
    # Strategy 1: Direct balance (member already has the airline/hotel points)
    for member in members:
        if not member.willing_to_share_points and member.user_id != prefer_member:
            continue
        
        direct_balance = member.points_balances.get(program_needed, 0)
        if direct_balance > 0:
            use_amount = min(direct_balance, remaining)
            sources.append({
                "member": member.user_id,
                "program": program_needed,
                "amount": use_amount,
                "is_transfer": False,
            })
            remaining -= use_amount
            
            if remaining <= 0:
                return sources
    
    # Strategy 2: Transfer from bank points
    for member in members:
        if not member.willing_to_share_points and member.user_id != prefer_member:
            continue
        
        for bank, balance in member.points_balances.items():
            bank_lower = bank.lower()
            if bank_lower not in EXTENDED_TRANSFER_GRAPH:
                continue
            
            if program_needed not in EXTENDED_TRANSFER_GRAPH[bank_lower]:
                continue
            
            transfer_info = EXTENDED_TRANSFER_GRAPH[bank_lower][program_needed]
            ratio = transfer_info.get("ratio", 1.0)
            
            # How many bank points needed for remaining program points?
            bank_points_needed = int(remaining / ratio)
            use_amount = min(balance, bank_points_needed)
            
            if use_amount > 0:
                resulting_points = int(use_amount * ratio)
                sources.append({
                    "member": member.user_id,
                    "program": bank,
                    "amount": use_amount,
                    "is_transfer": True,
                    "transfer_to": program_needed,
                    "resulting_points": resulting_points,
                    "ratio": ratio,
                })
                remaining -= resulting_points
                
                if remaining <= 0:
                    return sources
    
    # If we get here, not enough points available
    return sources


def calculate_points_value(
    program: str,
    points: int,
    *,
    use_fair_value: bool = True,
) -> float:
    """
    Calculate the USD value of points for settlement purposes.
    
    Uses conservative fair market values to ensure equitable settlement.
    """
    # Fair market values (cents per point) based on industry standards
    FAIR_VALUES = {
        # Bank programs
        "chase": 1.5,
        "amex": 1.5,
        "citi": 1.5,
        "capitalone": 1.5,
        "bilt": 1.5,
        
        # Airlines (domestic)
        "UA": 1.3,
        "AA": 1.4,
        "DL": 1.2,
        "WN": 1.5,  # Southwest
        
        # Airlines (international)
        "BA": 1.3,
        "AF": 1.3,
        "SQ": 1.5,
        "NH": 1.5,  # ANA
        "CX": 1.4,  # Cathay
        "EK": 1.3,  # Emirates
        
        # Hotels
        "HH": 0.5,   # Hilton
        "MAR": 0.8,  # Marriott
        "HYATT": 1.7,
        "IHG": 0.5,
    }
    
    cpp = FAIR_VALUES.get(program.upper(), 1.0) if use_fair_value else 1.0
    return points * cpp / 100  # Convert cents to dollars
```

### 3.2 Transfer Partner Optimization

```python
def find_optimal_transfer_path(
    origin_program: str,
    target_program: str,
    points_needed: int,
    available_balances: Dict[str, int],
) -> Optional[Dict[str, Any]]:
    """
    Find the optimal transfer path from available bank points to target program.
    
    Considers:
    - Transfer ratios (prefer 1:1 or better)
    - Transfer times (prefer instant)
    - Available balances
    
    Returns the best transfer path or None if impossible.
    """
    best_path = None
    best_score = float('inf')
    
    for bank, balance in available_balances.items():
        bank_lower = bank.lower()
        if bank_lower not in EXTENDED_TRANSFER_GRAPH:
            continue
        
        if target_program not in EXTENDED_TRANSFER_GRAPH[bank_lower]:
            continue
        
        transfer_info = EXTENDED_TRANSFER_GRAPH[bank_lower][target_program]
        ratio = transfer_info.get("ratio", 1.0)
        
        # Calculate bank points needed
        bank_points_needed = int(points_needed / ratio)
        
        if balance < bank_points_needed:
            continue  # Not enough points
        
        # Score: lower is better
        # Penalize bad ratios, slow transfers
        transfer_time = transfer_info.get("transfer_time", "varies")
        time_penalty = {
            "instant": 0,
            "1-2 business days": 1,
            "2-3 business days": 2,
            "varies": 3,
        }.get(transfer_time, 2)
        
        ratio_penalty = max(0, (1.0 / ratio) - 1) * 10  # Penalize if ratio < 1
        
        score = bank_points_needed + (ratio_penalty * 1000) + (time_penalty * 100)
        
        if score < best_score:
            best_score = score
            best_path = {
                "from_program": bank,
                "to_program": target_program,
                "bank_points": bank_points_needed,
                "resulting_points": points_needed,
                "ratio": ratio,
                "transfer_time": transfer_time,
            }
    
    return best_path
```

---

## 4. Group ILP Optimizer

### 4.1 Core Optimization Function

```python
# backend/src/handlers/group_oop_optimizer.py (continued)

import pulp as pl
from typing import Dict, List, Optional, Tuple, Any

from .transfer_strategy import EXTENDED_TRANSFER_GRAPH, BANK_METADATA, PROGRAM_METADATA
from .min_oop_optimizer import PointsOption


def minimize_group_out_of_pocket(
    members: List[GroupMember],
    booking_items: List[MemberBookingItem],
    pool: GroupPointsPool,
    *,
    allow_cross_member_points: bool = True,
    enforce_fair_split: bool = False,
    max_subsidy_per_member: Optional[float] = None,
) -> GroupOOPSolution:
    """
    Solve ILP to minimize total group out-of-pocket cost.
    
    This extends the single-traveler optimizer with:
    - Cross-member point usage
    - Per-member budget constraints
    - Settlement calculations
    
    Args:
        members: List of GroupMember objects
        booking_items: All items to be booked (flights + hotels for all members)
        pool: Aggregated points pool
        allow_cross_member_points: Allow using one member's points for another
        enforce_fair_split: Force equal OOP per member
        max_subsidy_per_member: Max points value one member can contribute for others
        
    Returns:
        GroupOOPSolution with allocations, transfers, and settlements
    """
    if pl is None:
        raise ImportError("pulp required")
    
    if not booking_items:
        return GroupOOPSolution(status="Optimal")
    
    # Create member lookup
    member_lookup = {m.user_id: m for m in members}
    
    # Calculate all-cash cost
    all_cash_cost = sum(item.cash_cost * item.party_size for item in booking_items)
    
    # Build the ILP model
    m = pl.LpProblem("GroupMinOOP", pl.LpMinimize)
    
    # =========================================================================
    # DECISION VARIABLES
    # =========================================================================
    
    # pay_cash[item_id] = 1 if item paid with cash
    pay_cash = {
        item.item_id: pl.LpVariable(f"cash_{item.item_id}", cat="Binary")
        for item in booking_items
    }
    
    # use_points[item_id, program, owner] = 1 if item paid using owner's program points
    use_points = {}
    for item in booking_items:
        for opt in item.points_options:
            for owner_id in pool.by_member.keys():
                # Check if this owner can provide these points
                if not _can_provide_points(owner_id, opt.program_code, pool, EXTENDED_TRANSFER_GRAPH):
                    continue
                
                # Check cross-member constraints
                if not allow_cross_member_points and owner_id != item.member_id:
                    continue
                
                key = (item.item_id, opt.program_code, owner_id)
                use_points[key] = pl.LpVariable(
                    f"pts_{item.item_id}_{opt.program_code}_{owner_id}",
                    cat="Binary"
                )
    
    # transfer[owner, bank, program] = points transferred
    transfer = {}
    banks = ["chase", "amex", "citi", "capitalone", "bilt"]
    programs_needed = set()
    
    for item in booking_items:
        for opt in item.points_options:
            programs_needed.add(opt.program_code.upper())
    
    for owner_id, owner_points in pool.by_member.items():
        for bank in banks:
            if bank not in owner_points or owner_points[bank] <= 0:
                continue
            
            bank_lower = bank.lower()
            if bank_lower not in EXTENDED_TRANSFER_GRAPH:
                continue
            
            for prog in programs_needed:
                if prog in EXTENDED_TRANSFER_GRAPH[bank_lower]:
                    transfer[(owner_id, bank, prog)] = pl.LpVariable(
                        f"xfer_{owner_id}_{bank}_{prog}",
                        lowBound=0,
                        cat="Integer"
                    )
    
    # =========================================================================
    # OBJECTIVE FUNCTION: Minimize total OOP
    # =========================================================================
    
    EPSILON = 0.0001  # Tiny preference for using points
    
    # Cash component
    cash_component = pl.lpSum(
        pay_cash[item.item_id] * item.cash_cost * item.party_size
        for item in booking_items
    )
    
    # Surcharge component (when using points)
    surcharge_component = pl.lpSum(
        use_points[key] * opt.surcharge * item.party_size
        for item in booking_items
        for opt in item.points_options
        for owner_id in pool.by_member.keys()
        if (key := (item.item_id, opt.program_code, owner_id)) in use_points
    )
    
    # Small bonus for using points
    points_bonus = pl.lpSum(
        use_points[key] * EPSILON
        for key in use_points
    )
    
    m += cash_component + surcharge_component - points_bonus
    
    # =========================================================================
    # CONSTRAINTS
    # =========================================================================
    
    # 1. Each item paid exactly once
    for item in booking_items:
        item_options = [pay_cash[item.item_id]]
        
        for opt in item.points_options:
            for owner_id in pool.by_member.keys():
                key = (item.item_id, opt.program_code, owner_id)
                if key in use_points:
                    item_options.append(use_points[key])
        
        m += pl.lpSum(item_options) == 1, f"pay_once_{item.item_id}"
    
    # 2. Points balance constraints (per owner, per program)
    for prog in programs_needed:
        for owner_id, owner_points in pool.by_member.items():
            # Points used from this program by this owner
            points_used = pl.lpSum(
                use_points[(item.item_id, opt.program_code, owner_id)] 
                    * opt.points_required * item.party_size
                for item in booking_items
                for opt in item.points_options
                if opt.program_code.upper() == prog
                and (item.item_id, opt.program_code, owner_id) in use_points
            )
            
            # Direct balance
            direct_balance = owner_points.get(prog, 0) + owner_points.get(prog.lower(), 0)
            
            # Transferred in from banks
            transferred_in = pl.lpSum(
                transfer[(owner_id, bank, prog)] 
                    * EXTENDED_TRANSFER_GRAPH.get(bank.lower(), {}).get(prog, {}).get("ratio", 1.0)
                for bank in banks
                if (owner_id, bank, prog) in transfer
            )
            
            m += points_used <= direct_balance + transferred_in, f"balance_{owner_id}_{prog}"
    
    # 3. Transfer limits (per owner, per bank)
    for owner_id, owner_points in pool.by_member.items():
        for bank in banks:
            if bank not in owner_points:
                continue
            
            total_transferred = pl.lpSum(
                transfer[(owner_id, bank, prog)]
                for prog in programs_needed
                if (owner_id, bank, prog) in transfer
            )
            
            m += total_transferred <= owner_points[bank], f"bank_limit_{owner_id}_{bank}"
    
    # 4. Optional: Per-member budget constraints
    for member in members:
        if member.max_cash_budget is not None:
            member_cash = pl.lpSum(
                pay_cash[item.item_id] * item.cash_cost * item.party_size
                for item in booking_items
                if item.member_id == member.user_id
            )
            member_surcharges = pl.lpSum(
                use_points[(item.item_id, opt.program_code, owner_id)] 
                    * opt.surcharge * item.party_size
                for item in booking_items
                for opt in item.points_options
                for owner_id in pool.by_member.keys()
                if item.member_id == member.user_id
                and (item.item_id, opt.program_code, owner_id) in use_points
            )
            m += member_cash + member_surcharges <= member.max_cash_budget, \
                f"budget_{member.user_id}"
    
    # 5. Optional: Max subsidy constraint
    if max_subsidy_per_member is not None:
        for owner_id in pool.by_member.keys():
            # Points owner provides for OTHER members
            subsidy_points = pl.lpSum(
                use_points[(item.item_id, opt.program_code, owner_id)] 
                    * opt.points_required * item.party_size
                for item in booking_items
                for opt in item.points_options
                if item.member_id != owner_id  # For others
                and (item.item_id, opt.program_code, owner_id) in use_points
            )
            # Approximate value constraint (using 1.5 cpp)
            m += subsidy_points * 0.015 <= max_subsidy_per_member, \
                f"max_subsidy_{owner_id}"
    
    # =========================================================================
    # SOLVE
    # =========================================================================
    
    solver = pl.PULP_CBC_CMD(msg=False, timeLimit=60)
    m.solve(solver)
    
    status = pl.LpStatus[m.status]
    
    if status != "Optimal":
        # Fallback to all-cash
        return _build_fallback_solution(booking_items, members, all_cash_cost)
    
    # =========================================================================
    # EXTRACT SOLUTION
    # =========================================================================
    
    return _extract_group_solution(
        booking_items=booking_items,
        members=members,
        pool=pool,
        pay_cash=pay_cash,
        use_points=use_points,
        transfer=transfer,
        all_cash_cost=all_cash_cost,
    )


def _can_provide_points(
    owner_id: str,
    program: str,
    pool: GroupPointsPool,
    transfer_graph: Dict,
) -> bool:
    """Check if an owner can provide points for a program (directly or via transfer)."""
    owner_points = pool.by_member.get(owner_id, {})
    
    # Direct balance
    if owner_points.get(program, 0) > 0 or owner_points.get(program.upper(), 0) > 0:
        return True
    
    # Via transfer
    for bank, balance in owner_points.items():
        if balance <= 0:
            continue
        bank_lower = bank.lower()
        if bank_lower in transfer_graph and program in transfer_graph[bank_lower]:
            return True
    
    return False


def _build_fallback_solution(
    items: List[MemberBookingItem],
    members: List[GroupMember],
    all_cash_cost: float,
) -> GroupOOPSolution:
    """Build all-cash fallback solution."""
    allocations = [
        GroupPaymentAllocation(
            item_id=item.item_id,
            beneficiary_member=item.member_id,
            payment_type="cash",
            cash_paid=item.cash_cost * item.party_size,
        )
        for item in items
    ]
    
    oop_per_member = {}
    for alloc in allocations:
        oop_per_member[alloc.beneficiary_member] = \
            oop_per_member.get(alloc.beneficiary_member, 0) + alloc.cash_paid
    
    return GroupOOPSolution(
        status="Fallback",
        allocations=allocations,
        total_group_oop=all_cash_cost,
        oop_per_member=oop_per_member,
        all_cash_cost=all_cash_cost,
        savings=0.0,
    )
```

### 4.2 Solution Extraction

```python
def _extract_group_solution(
    booking_items: List[MemberBookingItem],
    members: List[GroupMember],
    pool: GroupPointsPool,
    pay_cash: Dict,
    use_points: Dict,
    transfer: Dict,
    all_cash_cost: float,
) -> GroupOOPSolution:
    """Extract the complete group solution from solved ILP."""
    
    allocations = []
    total_oop = 0.0
    oop_per_member = {m.user_id: 0.0 for m in members}
    points_used_per_member = {m.user_id: 0 for m in members}
    
    # Track points contributions for settlement
    points_contributed = {}  # owner -> {beneficiary -> value}
    
    for item in booking_items:
        beneficiary = item.member_id
        party_size = item.party_size
        
        # Check if paid with cash
        if pl.value(pay_cash[item.item_id]) > 0.5:
            cash_amount = item.cash_cost * party_size
            allocations.append(GroupPaymentAllocation(
                item_id=item.item_id,
                beneficiary_member=beneficiary,
                payment_type="cash",
                cash_paid=cash_amount,
            ))
            total_oop += cash_amount
            oop_per_member[beneficiary] += cash_amount
            continue
        
        # Find which points option was used
        for opt in item.points_options:
            for owner_id in pool.by_member.keys():
                key = (item.item_id, opt.program_code, owner_id)
                if key not in use_points:
                    continue
                
                if pl.value(use_points[key]) > 0.5:
                    surcharge = opt.surcharge * party_size
                    points_used = opt.points_required * party_size
                    points_value = calculate_points_value(opt.program_code, points_used)
                    
                    allocations.append(GroupPaymentAllocation(
                        item_id=item.item_id,
                        beneficiary_member=beneficiary,
                        payment_type="points",
                        cash_paid=surcharge,
                        points_used=points_used,
                        program_used=opt.program_code,
                        points_owner=owner_id,
                        points_value_usd=points_value,
                    ))
                    
                    total_oop += surcharge
                    oop_per_member[beneficiary] += surcharge
                    points_used_per_member[owner_id] += points_used
                    
                    # Track for settlement
                    if owner_id not in points_contributed:
                        points_contributed[owner_id] = {}
                    if beneficiary not in points_contributed[owner_id]:
                        points_contributed[owner_id][beneficiary] = 0.0
                    points_contributed[owner_id][beneficiary] += points_value
                    
                    break
            else:
                continue
            break
    
    # Build transfer plan
    transfer_plan = _build_group_transfer_plan(transfer, pool, allocations)
    
    # Build settlements
    settlements = _calculate_settlements(points_contributed, members)
    
    # Calculate remaining points
    points_remaining = _calculate_remaining_points(pool, allocations, transfer)
    
    savings = all_cash_cost - total_oop
    savings_pct = (savings / all_cash_cost * 100) if all_cash_cost > 0 else 0.0
    
    return GroupOOPSolution(
        status="Optimal",
        allocations=allocations,
        transfer_plan=transfer_plan,
        settlements=settlements,
        total_group_oop=round(total_oop, 2),
        oop_per_member={k: round(v, 2) for k, v in oop_per_member.items()},
        points_used_per_member=points_used_per_member,
        all_cash_cost=round(all_cash_cost, 2),
        total_savings=round(savings, 2),
        savings_percentage=round(savings_pct, 1),
        points_remaining=points_remaining,
    )


def _calculate_settlements(
    points_contributed: Dict[str, Dict[str, float]],
    members: List[GroupMember],
) -> List[SettlementEntry]:
    """
    Calculate who owes whom based on points contributions.
    
    If Alice uses her points for Bob's flight, Bob owes Alice the fair value.
    """
    settlements = []
    
    for owner_id, beneficiaries in points_contributed.items():
        for beneficiary_id, value in beneficiaries.items():
            if owner_id == beneficiary_id:
                continue  # Using own points, no settlement needed
            
            if value > 0:
                settlements.append(SettlementEntry(
                    from_member=beneficiary_id,  # Beneficiary owes
                    to_member=owner_id,          # Owner receives
                    amount_usd=round(value, 2),
                    reason=f"Points used for your bookings",
                ))
    
    # Consolidate settlements (net out mutual debts)
    return _consolidate_settlements(settlements)


def _consolidate_settlements(settlements: List[SettlementEntry]) -> List[SettlementEntry]:
    """Consolidate multiple settlements between same members into net amounts."""
    # Build net matrix
    net = {}  # (from, to) -> net amount
    
    for s in settlements:
        key = (s.from_member, s.to_member)
        reverse_key = (s.to_member, s.from_member)
        
        if reverse_key in net:
            net[reverse_key] -= s.amount_usd
        else:
            net[key] = net.get(key, 0) + s.amount_usd
    
    # Convert back to settlements
    consolidated = []
    for (from_m, to_m), amount in net.items():
        if amount > 0:
            consolidated.append(SettlementEntry(
                from_member=from_m,
                to_member=to_m,
                amount_usd=round(amount, 2),
                reason="Net settlement for points used",
            ))
        elif amount < 0:
            consolidated.append(SettlementEntry(
                from_member=to_m,
                to_member=from_m,
                amount_usd=round(-amount, 2),
                reason="Net settlement for points used",
            ))
    
    return consolidated
```

---

## 5. Cost Allocation & Fair Money Sharing

This section provides comprehensive detail on how costs are fairly allocated across group members. The system ensures that **no member subsidizes another without explicit consent and transparent settlement**.

### 5.1 Core Fairness Principles

| Principle | Description | Implementation |
|-----------|-------------|----------------|
| **Value-Based Settlement** | Points are valued at fair market rates, not arbitrary values | Uses industry-standard CPP valuations |
| **Beneficiary Pays** | Whoever benefits from a booking pays for it | Tracked via `beneficiary_member` field |
| **Transparent Attribution** | Every point used is attributed to its owner | `points_owner` field in allocations |
| **Net Settlement** | Mutual debts are canceled out | Final settlement is the net difference |
| **Optional Sharing** | Members can opt-out of sharing points | `willing_to_share_points` flag |

### 5.2 Fair Market Value (FMV) Table for Points

Points are valued using industry-standard **cents per point (CPP)** rates. These rates represent what points are typically worth when redeemed optimally:

```python
# backend/src/handlers/fair_market_values.py

FAIR_MARKET_VALUES_CPP = {
    # ═══════════════════════════════════════════════════════════════════════
    # BANK/CREDIT CARD PROGRAMS (Transferable Points)
    # ═══════════════════════════════════════════════════════════════════════
    # These are valued at 1.5 cpp because they have transfer flexibility
    "chase": 1.5,           # Chase Ultimate Rewards
    "amex": 1.5,            # American Express Membership Rewards
    "citi": 1.5,            # Citi ThankYou Points
    "capitalone": 1.5,      # Capital One Miles
    "bilt": 1.5,            # Bilt Rewards
    
    # ═══════════════════════════════════════════════════════════════════════
    # US DOMESTIC AIRLINES
    # ═══════════════════════════════════════════════════════════════════════
    "UA": 1.3,              # United MileagePlus
    "AA": 1.4,              # American AAdvantage  
    "DL": 1.2,              # Delta SkyMiles (lower due to variable pricing)
    "WN": 1.5,              # Southwest Rapid Rewards
    "B6": 1.3,              # JetBlue TrueBlue
    "AS": 1.8,              # Alaska Mileage Plan (excellent value)
    
    # ═══════════════════════════════════════════════════════════════════════
    # INTERNATIONAL AIRLINES
    # ═══════════════════════════════════════════════════════════════════════
    "BA": 1.3,              # British Airways Avios
    "AF": 1.3,              # Air France Flying Blue
    "SQ": 1.5,              # Singapore KrisFlyer
    "NH": 1.5,              # ANA Mileage Club
    "CX": 1.4,              # Cathay Pacific Asia Miles
    "EK": 1.3,              # Emirates Skywards
    "VS": 1.4,              # Virgin Atlantic Flying Club
    "TK": 1.4,              # Turkish Miles&Smiles
    "AC": 1.5,              # Aeroplan
    
    # ═══════════════════════════════════════════════════════════════════════
    # HOTEL PROGRAMS
    # ═══════════════════════════════════════════════════════════════════════
    "HH": 0.5,              # Hilton Honors (high point requirements)
    "MAR": 0.8,             # Marriott Bonvoy
    "HYATT": 1.7,           # World of Hyatt (excellent value)
    "IHG": 0.5,             # IHG One Rewards
    "WYNDHAM": 0.9,         # Wyndham Rewards
    "CHOICE": 0.6,          # Choice Privileges
}

def get_fair_market_value(program: str, points: int) -> float:
    """
    Calculate the USD value of points using Fair Market Value.
    
    Formula: USD_Value = (points × CPP) / 100
    
    Args:
        program: Program code (e.g., "chase", "UA", "HH")
        points: Number of points
        
    Returns:
        USD value as float
        
    Example:
        >>> get_fair_market_value("chase", 100000)
        1500.0  # 100K Chase points = $1,500
        
        >>> get_fair_market_value("HH", 100000)
        500.0   # 100K Hilton points = $500
    """
    cpp = FAIR_MARKET_VALUES_CPP.get(program.upper(), 1.0)
    if program.lower() in FAIR_MARKET_VALUES_CPP:
        cpp = FAIR_MARKET_VALUES_CPP[program.lower()]
    
    return (points * cpp) / 100
```

### 5.3 Three Valuation Methods

Groups can choose from three valuation methods:

#### Method 1: Fair Market Value (Default, Recommended)

Uses industry-standard CPP rates. **Best for most groups.**

```python
# Example: Alice uses 100K Chase points for Bob's flight
points_value = 100000 * 1.5 / 100  # = $1,500
# Bob owes Alice $1,500
```

#### Method 2: Actual Redemption Value

Uses the actual CPP achieved in this specific booking. **Best for maximizing perceived fairness.**

```python
# Example: Alice uses 100K Chase→AF for Bob's $2,000 flight (surcharge $100)
cash_saved = 2000 - 100  # = $1,900
actual_cpp = (1900 / 100000) * 100  # = 1.9 cpp
points_value = 100000 * 1.9 / 100  # = $1,900
# Bob owes Alice $1,900
```

#### Method 3: Fixed Rate

All points valued at the same rate (e.g., 1.5 cpp). **Best for simplicity.**

```python
# Example: All programs valued at 1.5 cpp
chase_value = 100000 * 1.5 / 100  # = $1,500
hilton_value = 100000 * 1.5 / 100  # = $1,500 (normally worth less)
```

### 5.4 The Fair Cost Allocation Algorithm

```python
# backend/src/handlers/cost_allocation.py

from typing import Dict, List, Optional
from dataclasses import dataclass
from enum import Enum


class PointsValuationMethod(str, Enum):
    FAIR_MARKET = "fair_market"    # Industry-standard CPP values
    ACTUAL_REDEMPTION = "actual"   # Actual CPP achieved in this booking
    FIXED_RATE = "fixed"           # Fixed 1.5 cpp for all programs


@dataclass
class CostAllocationConfig:
    """Configuration for cost allocation."""
    valuation_method: PointsValuationMethod = PointsValuationMethod.FAIR_MARKET
    fixed_cpp: float = 1.5  # If using fixed method
    include_surcharges_in_settlement: bool = True
    round_to_nearest: float = 0.01  # Dollars


def allocate_costs_with_detailed_breakdown(
    solution: "GroupOOPSolution",
    members: List["GroupMember"],
    config: CostAllocationConfig = None,
) -> Dict[str, "MemberCostSummary"]:
    """
    Allocate costs to each member with full transparency.
    
    The algorithm works as follows:
    
    1. FOR EACH MEMBER, calculate:
       a. CONSUMPTION: What bookings were made FOR this member
       b. CONTRIBUTION: What points this member PROVIDED
       
    2. FOR EACH BOOKING, track:
       a. WHO benefits (beneficiary_member)
       b. WHO paid (points_owner or cash)
       c. WHAT VALUE was exchanged
       
    3. CALCULATE NET POSITION:
       net = (value_received_from_others) - (value_given_to_others)
       - Positive net = member OWES money (received more than gave)
       - Negative net = member RECEIVES money (gave more than received)
    
    Returns:
        Dict mapping member_id to their detailed cost summary
    """
    if config is None:
        config = CostAllocationConfig()
    
    summaries = {}
    
    for member in members:
        member_id = member.user_id
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 1: Calculate what this member CONSUMES (bookings FOR them)
        # ═══════════════════════════════════════════════════════════════════
        consumed = [a for a in solution.allocations 
                   if a.beneficiary_member == member_id]
        
        # Cash they pay directly (surcharges on their bookings)
        direct_cash_paid = sum(a.cash_paid for a in consumed)
        
        # Points used for their bookings (regardless of who owns them)
        total_points_for_me = sum(a.points_used or 0 for a in consumed)
        
        # Value of points OTHERS provided for my bookings
        value_received_from_others = sum(
            a.points_value_usd or 0 
            for a in consumed 
            if a.points_owner and a.points_owner != member_id
        )
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 2: Calculate what this member CONTRIBUTES (their points used)
        # ═══════════════════════════════════════════════════════════════════
        contributed = [a for a in solution.allocations 
                      if a.points_owner == member_id]
        
        # Points they contributed
        total_points_contributed = sum(a.points_used or 0 for a in contributed)
        
        # Total value of their contribution
        total_contribution_value = sum(a.points_value_usd or 0 for a in contributed)
        
        # Value given TO OTHERS (their points for someone else's booking)
        value_given_to_others = sum(
            a.points_value_usd or 0 
            for a in contributed 
            if a.beneficiary_member != member_id
        )
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 3: Calculate NET settlement position
        # ═══════════════════════════════════════════════════════════════════
        # If positive: I received more than I gave → I OWE money
        # If negative: I gave more than I received → I RECEIVE money
        net_settlement = value_received_from_others - value_given_to_others
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 4: Calculate total effective cost
        # ═══════════════════════════════════════════════════════════════════
        # What this member actually pays = cash + settlement owed
        total_effective_cost = direct_cash_paid + net_settlement
        
        summaries[member_id] = MemberCostSummary(
            member_id=member_id,
            member_name=member.name,
            
            # Direct cash payments (surcharges, cash bookings)
            cash_paid=round(direct_cash_paid, 2),
            
            # Points consumption
            points_used_for_them=total_points_for_me,
            
            # Points contribution
            points_they_contributed=total_points_contributed,
            contribution_value_usd=round(total_contribution_value, 2),
            
            # Settlement details
            value_received_from_others=round(value_received_from_others, 2),
            value_given_to_others=round(value_given_to_others, 2),
            net_settlement=round(net_settlement, 2),
            settlement_direction="owes" if net_settlement > 0 else "receives",
            
            # Final cost
            total_effective_cost=round(total_effective_cost, 2),
        )
    
    return summaries


@dataclass
class MemberCostSummary:
    """Detailed cost summary for a single member."""
    member_id: str
    member_name: str
    
    # ═══════════════════════════════════════════════════════════════════════
    # DIRECT PAYMENTS
    # ═══════════════════════════════════════════════════════════════════════
    cash_paid: float  # Surcharges + any cash bookings
    
    # ═══════════════════════════════════════════════════════════════════════
    # POINTS CONSUMPTION (what was used FOR this member)
    # ═══════════════════════════════════════════════════════════════════════
    points_used_for_them: int
    
    # ═══════════════════════════════════════════════════════════════════════
    # POINTS CONTRIBUTION (what this member PROVIDED)
    # ═══════════════════════════════════════════════════════════════════════
    points_they_contributed: int
    contribution_value_usd: float
    
    # ═══════════════════════════════════════════════════════════════════════
    # SETTLEMENT BREAKDOWN
    # ═══════════════════════════════════════════════════════════════════════
    value_received_from_others: float  # Points value others gave for my bookings
    value_given_to_others: float       # Points value I gave for others' bookings
    net_settlement: float              # Positive = owes, Negative = receives
    settlement_direction: str          # "owes" or "receives"
    
    # ═══════════════════════════════════════════════════════════════════════
    # TOTAL COST
    # ═══════════════════════════════════════════════════════════════════════
    total_effective_cost: float  # cash_paid + net_settlement
```

### 5.5 Detailed Settlement Calculation Example

Let's walk through a complete example:

```
═══════════════════════════════════════════════════════════════════════════════
SCENARIO: 3 Friends Trip (Alice, Bob, Carol)
═══════════════════════════════════════════════════════════════════════════════

BOOKINGS MADE:
┌─────────────────────────────────────────────────────────────────────────────┐
│ Item              │ For     │ Points Used │ Owner   │ FMV Value │ Surcharge│
├─────────────────────────────────────────────────────────────────────────────┤
│ Flight JFK→CDG #1 │ Alice   │ 55K AF      │ Alice   │ $715      │ $120     │
│ Flight JFK→CDG #2 │ Bob     │ 55K AF      │ Alice   │ $715      │ $120     │
│ Flight ORD→CDG    │ Carol   │ 60K UA      │ Carol   │ $780      │ $90      │
│ Flight CDG→FCO #1 │ Alice   │ CASH        │ -       │ -         │ $180     │
│ Flight CDG→FCO #2 │ Bob     │ CASH        │ -       │ -         │ $180     │
│ Flight CDG→FCO #3 │ Carol   │ CASH        │ -       │ -         │ $180     │
│ Flight FCO→JFK #1 │ Alice   │ 60K UA      │ Bob     │ $780      │ $50      │
│ Flight FCO→JFK #2 │ Bob     │ 60K UA      │ Bob     │ $780      │ $50      │
│ Flight FCO→ORD    │ Carol   │ 65K UA      │ Carol   │ $845      │ $55      │
│ Paris Hotel       │ GROUP   │ 160K HH     │ Carol   │ $800      │ $40      │
│ Rome Hotel        │ GROUP   │ 120K HH     │ Carol   │ $600      │ $30      │
└─────────────────────────────────────────────────────────────────────────────┘

STEP-BY-STEP CALCULATION:
═══════════════════════════════════════════════════════════════════════════════

ALICE'S POSITION:
─────────────────────────────────────────────────────────────────────────────
  CONSUMPTION (bookings FOR Alice):
    • Flight JFK→CDG: 55K AF (owner: Alice) → $715 (own points, no settlement)
    • Flight CDG→FCO: Cash $180
    • Flight FCO→JFK: 60K UA (owner: Bob) → $780 ← Alice RECEIVED this value
    • Hotels: 1/3 share of $800 + $600 = $467 ← Alice RECEIVED this value
    
  CONTRIBUTION (Alice's points used):
    • 55K AF for Alice's flight → $715 (for self)
    • 55K AF for Bob's flight → $715 ← Alice GAVE this value to Bob
    
  CALCULATION:
    Value received from others: $780 (from Bob) + $467 (from Carol) = $1,247
    Value given to others:      $715 (to Bob) = $715
    
    Net settlement: $1,247 - $715 = $532 (Alice OWES)
    
    Direct cash paid: $120 + $180 + $50 + $23 (1/3 hotel surcharges) = $373
    
    ALICE'S TOTAL COST: $373 (cash) + $532 (settlement) = $905

─────────────────────────────────────────────────────────────────────────────

BOB'S POSITION:
─────────────────────────────────────────────────────────────────────────────
  CONSUMPTION (bookings FOR Bob):
    • Flight JFK→CDG: 55K AF (owner: Alice) → $715 ← Bob RECEIVED this value
    • Flight CDG→FCO: Cash $180
    • Flight FCO→JFK: 60K UA (owner: Bob) → $780 (own points, no settlement)
    • Hotels: 1/3 share = $467 ← Bob RECEIVED this value
    
  CONTRIBUTION (Bob's points used):
    • 60K UA for Alice's FCO→JFK → $780 ← Bob GAVE this value to Alice
    • 60K UA for Bob's FCO→JFK → $780 (for self)
    
  CALCULATION:
    Value received from others: $715 (from Alice) + $467 (from Carol) = $1,182
    Value given to others:      $780 (to Alice) = $780
    
    Net settlement: $1,182 - $780 = $402 (Bob OWES)
    
    Direct cash paid: $120 + $180 + $50 + $23 = $373
    
    BOB'S TOTAL COST: $373 (cash) + $402 (settlement) = $775

─────────────────────────────────────────────────────────────────────────────

CAROL'S POSITION:
─────────────────────────────────────────────────────────────────────────────
  CONSUMPTION (bookings FOR Carol):
    • Flight ORD→CDG: 60K UA (owner: Carol) → $780 (own points)
    • Flight CDG→FCO: Cash $180
    • Flight FCO→ORD: 65K UA (owner: Carol) → $845 (own points)
    • Hotels: 1/3 share = $467 (own points)
    
  CONTRIBUTION (Carol's points used):
    • 60K UA for Carol → $780 (for self)
    • 65K UA for Carol → $845 (for self)
    • 160K HH for GROUP hotels → $800 ← Carol GAVE $533 to Alice, $533 to Bob
    • 120K HH for GROUP hotels → $600 ← Carol GAVE $400 to Alice, $400 to Bob
    
  CALCULATION:
    Value received from others: $0 (Carol used only her own points for her bookings)
    Value given to others:      $467 to Alice + $467 to Bob = $934
    
    Net settlement: $0 - $934 = -$934 (Carol RECEIVES)
    
    Direct cash paid: $90 + $180 + $55 + $23 = $348
    
    CAROL'S TOTAL COST: $348 (cash) - $934 (receives) = -$586 ← Carol receives money!

═══════════════════════════════════════════════════════════════════════════════

FINAL SETTLEMENTS:
─────────────────────────────────────────────────────────────────────────────
  1. Alice pays Carol: $467 (for hotel points)
  2. Bob pays Carol: $467 (for hotel points)
  3. Bob pays Alice: $0 (Alice's $715 to Bob ≈ Bob's $780 to Alice, net ~$65)
     Wait, let me recalculate...
     
  Actually, consolidating:
  - Alice owes Carol: $467
  - Alice receives from Bob: $715 - $780 = -$65 (Alice owes Bob $65)
  - Bob owes Carol: $467
  
  NET SETTLEMENTS:
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ Alice → Carol: $467                                                     │
  │ Alice → Bob: $65                                                        │
  │ Bob → Carol: $467                                                       │
  └─────────────────────────────────────────────────────────────────────────┘
  
  VERIFICATION (totals should sum to zero):
  Alice: +$467 + $65 = +$532 (owes)
  Bob:   -$65 + $467 = +$402 (owes)
  Carol: -$467 - $467 = -$934 (receives)
  Total: $532 + $402 - $934 = $0 ✓

═══════════════════════════════════════════════════════════════════════════════
```

### 5.6 Settlement Consolidation Algorithm

```python
def consolidate_settlements(
    raw_settlements: List[SettlementEntry],
) -> List[SettlementEntry]:
    """
    Consolidate multiple settlements into minimal net transfers.
    
    Algorithm:
    1. Build a matrix of gross debts between all pairs
    2. For each pair, calculate net (A→B minus B→A)
    3. Only keep positive nets (the direction that matters)
    4. Optionally, further simplify using debt simplification algorithm
    
    Example:
        Input:  Alice→Bob $100, Bob→Alice $60, Bob→Carol $50
        Output: Alice→Bob $40, Bob→Carol $50
    """
    # Build gross debts matrix
    debts: Dict[Tuple[str, str], float] = {}
    
    for s in raw_settlements:
        key = (s.from_member, s.to_member)
        debts[key] = debts.get(key, 0) + s.amount_usd
    
    # Net out mutual debts
    net_settlements = []
    processed = set()
    
    for (from_m, to_m), amount in debts.items():
        if (from_m, to_m) in processed:
            continue
        
        reverse_amount = debts.get((to_m, from_m), 0)
        net_amount = amount - reverse_amount
        
        if abs(net_amount) > 0.01:  # Ignore tiny amounts
            if net_amount > 0:
                net_settlements.append(SettlementEntry(
                    from_member=from_m,
                    to_member=to_m,
                    amount_usd=round(net_amount, 2),
                    reason="Net settlement for points used",
                ))
            else:
                net_settlements.append(SettlementEntry(
                    from_member=to_m,
                    to_member=from_m,
                    amount_usd=round(-net_amount, 2),
                    reason="Net settlement for points used",
                ))
        
        processed.add((from_m, to_m))
        processed.add((to_m, from_m))
    
    return net_settlements


def simplify_settlements_graph(
    settlements: List[SettlementEntry],
) -> List[SettlementEntry]:
    """
    Further simplify settlements using debt graph optimization.
    
    This reduces the number of transactions by finding intermediate paths.
    
    Example:
        Input:  A→B $100, B→C $100
        Output: A→C $100 (B is removed as intermediary)
    
    For a 3-person group, this is rarely needed, but for larger groups
    it can significantly reduce the number of Venmo transactions.
    """
    # Build balance for each member
    balances: Dict[str, float] = {}
    
    for s in settlements:
        balances[s.from_member] = balances.get(s.from_member, 0) - s.amount_usd
        balances[s.to_member] = balances.get(s.to_member, 0) + s.amount_usd
    
    # Separate into creditors (positive balance) and debtors (negative balance)
    creditors = [(m, b) for m, b in balances.items() if b > 0.01]
    debtors = [(m, -b) for m, b in balances.items() if b < -0.01]
    
    # Sort by amount (largest first for efficiency)
    creditors.sort(key=lambda x: -x[1])
    debtors.sort(key=lambda x: -x[1])
    
    # Generate minimal settlements
    simplified = []
    i, j = 0, 0
    
    while i < len(debtors) and j < len(creditors):
        debtor, debt = debtors[i]
        creditor, credit = creditors[j]
        
        amount = min(debt, credit)
        
        if amount > 0.01:
            simplified.append(SettlementEntry(
                from_member=debtor,
                to_member=creditor,
                amount_usd=round(amount, 2),
                reason="Simplified settlement",
            ))
        
        debtors[i] = (debtor, debt - amount)
        creditors[j] = (creditor, credit - amount)
        
        if debtors[i][1] < 0.01:
            i += 1
        if creditors[j][1] < 0.01:
            j += 1
    
    return simplified
```

### 5.7 Settlement Generation & Instructions

```python
def generate_settlement_instructions(
    settlements: List["SettlementEntry"],
    members: Dict[str, "GroupMember"],
) -> List[Dict[str, Any]]:
    """
    Generate human-readable settlement instructions with payment links.
    
    Returns:
        List of settlement instruction dicts for the frontend
    """
    instructions = []
    
    for i, s in enumerate(settlements):
        from_member = members.get(s.from_member)
        to_member = members.get(s.to_member)
        
        from_name = from_member.name if from_member else s.from_member
        to_name = to_member.name if to_member else s.to_member
        
        # Generate payment deep links
        venmo_link = f"venmo://paycharge?txn=pay&recipients={to_name.replace(' ', '')}&amount={s.amount_usd:.2f}&note=Tripy%20trip%20settlement"
        paypal_link = f"https://www.paypal.me/{to_name.replace(' ', '')}?amount={s.amount_usd:.2f}"
        
        instructions.append({
            "step": i + 1,
            "settlement_id": f"settlement_{s.from_member}_{s.to_member}",
            
            # Who pays whom
            "from_member_id": s.from_member,
            "from_member_name": from_name,
            "to_member_id": s.to_member,
            "to_member_name": to_name,
            
            # Amount
            "amount": s.amount_usd,
            "amount_display": f"${s.amount_usd:,.2f}",
            
            # Context
            "reason": s.reason,
            "instruction_text": f"{from_name} pays {to_name} ${s.amount_usd:,.2f}",
            
            # Payment methods with deep links
            "payment_methods": [
                {
                    "name": "Venmo",
                    "icon": "venmo",
                    "url": venmo_link,
                    "instructions": f"Open Venmo and pay @{to_name.replace(' ', '')} ${s.amount_usd:.2f}",
                },
                {
                    "name": "PayPal",
                    "icon": "paypal", 
                    "url": paypal_link,
                    "instructions": f"Send ${s.amount_usd:.2f} via PayPal",
                },
                {
                    "name": "Zelle",
                    "icon": "zelle",
                    "url": None,  # Zelle doesn't support deep links
                    "instructions": f"Send ${s.amount_usd:.2f} to {to_name}'s email/phone via Zelle",
                },
                {
                    "name": "Cash",
                    "icon": "cash",
                    "url": None,
                    "instructions": f"Pay ${s.amount_usd:.2f} in cash",
                },
            ],
            
            # Tracking
            "status": "pending",  # pending, paid, confirmed
        })
    
    return instructions
```

---

## 6. API Endpoints - Complete Specification

This section provides exhaustive API documentation with full request/response schemas, validation rules, error handling, and workflow integration.

---

### 6.1 Complete End-to-End Workflow

The group OOP optimization follows this workflow:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE API WORKFLOW                                    │
└─────────────────────────────────────────────────────────────────────────────────┘

PHASE 1: TRIP SETUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1.1: Organizer Creates Trip
────────────────────────────────
POST /api/trip
Body: { title, start_date, end_date }
  → Creates trip shell
  → Returns: trip_id, invite_code
  
Step 1.2: Add Destinations  
────────────────────────────────
POST /api/trip/{trip_id}/destinations
Body: { name, must_include, is_start, is_end }
  → Adds destinations to visit
  → Returns: destination_id

Step 1.3: Organizer Adds Their Points
────────────────────────────────
POST /api/trip/{trip_id}/points
Body: { program: "chase", balance: 150000 }
  → Stores organizer's points balances
  → Repeat for each program they have

PHASE 2: MEMBER ONBOARDING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 2.1: Share Invite Code
────────────────────────────────
Organizer shares: https://tripy.app/group/join/{invite_code}

Step 2.2: Member Joins Trip
────────────────────────────────
POST /api/group/join
Body: { invite_code }
  → Validates code, adds member to trip
  → Returns: member_id, trip details

Step 2.3: Member Configures Preferences
────────────────────────────────
PUT /api/trip/{trip_id}/members/{member_id}
Body: {
  departure_airport: "ORD",
  cabin_preference: "Economy",
  max_cash_budget: 1500,
  willing_to_share_points: true
}

Step 2.4: Member Adds Their Points
────────────────────────────────
POST /api/trip/{trip_id}/points
Body: { program: "amex", balance: 200000 }
  → Each member adds their own points
  → System tracks ownership

PHASE 3: READY CHECK & POOL AGGREGATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 3.1: Check Member Readiness
────────────────────────────────
GET /api/group/{trip_id}/status
  → Returns which members are ready
  → Lists missing required fields

Step 3.2: View Combined Points Pool
────────────────────────────────
GET /api/group/{trip_id}/points-pool
  → Aggregates points across all members
  → Shows total by program
  → Shows breakdown by member
  → Shows transfer potential

PHASE 4: OPTIMIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 4.1: Preview/Simulate (RECOMMENDED)
────────────────────────────────
POST /api/group/{trip_id}/simulate-allocation
Body: { strategy: "minimize_group_oop" }
  → Quick preview without flight search
  → Shows projected settlements
  → Warns about large imbalances
  → Suggests alternatives

Step 4.2: Run Full Optimization
────────────────────────────────
POST /api/group/{trip_id}/optimize-oop
Body: { options: { allow_cross_member_points: true, ... } }
  
  Internal Steps:
  a) Fetch flights via AwardTool Real-time API
  b) Fetch cash prices via SerpAPI
  c) Fetch hotels via AwardTool + SerpAPI
  d) Build unified cost graph
  e) Run ILP solver (PuLP)
  f) Calculate fair cost allocation
  g) Generate settlement matrix
  h) Build transfer instructions
  i) Build booking order
  
  → Returns complete solution

PHASE 5: REVIEW & APPROVAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 5.1: Review Optimization Results
────────────────────────────────
Frontend displays:
  • Total savings
  • Per-member breakdown
  • Settlement preview
  • Transfer instructions

Step 5.2: Members Confirm Acceptance
────────────────────────────────
POST /api/group/{trip_id}/accept-plan
Body: { member_id, accepted: true }
  → Tracks who has accepted
  → Can proceed when all accept

PHASE 6: EXECUTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 6.1: Get Transfer Instructions
────────────────────────────────
GET /api/group/{trip_id}/transfers
  → Returns ordered list of transfers per member
  → Each member executes at bank portal

Step 6.2: Track Transfer Completion
────────────────────────────────
POST /api/group/{trip_id}/transfers/{transfer_id}/complete
Body: { completed: true }
  → Member marks their transfer done

Step 6.3: Get Booking Instructions
────────────────────────────────
GET /api/group/{trip_id}/booking-instructions
  → Returns ordered booking steps
  → Members book flights/hotels

PHASE 7: SETTLEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 7.1: View Settlements
────────────────────────────────
GET /api/group/{trip_id}/settlements
  → Returns who owes whom
  → Payment method links

Step 7.2: Mark Settlement Paid
────────────────────────────────
POST /api/group/{trip_id}/settlements/{id}/mark-paid
Body: { payment_method: "venmo", reference: "txn_xxx" }
  → Debtor marks as paid

Step 7.3: Confirm Settlement Received
────────────────────────────────
POST /api/group/{trip_id}/settlements/{id}/confirm
Body: { confirmed: true }
  → Creditor confirms receipt

Step 7.4: Check Settlement Status
────────────────────────────────
GET /api/group/{trip_id}/settlements/status
  → Returns overall completion status
  → Shows any pending settlements
```

---

### 6.2 Main Optimization Endpoint

#### `POST /api/group/{trip_id}/optimize-oop`

**Purpose:** Run the complete group OOP optimization.

##### Request Schema

```typescript
interface OptimizeOOPRequest {
  options?: {
    // Allow one member's points to pay for another's booking
    // Default: true
    allow_cross_member_points?: boolean;
    
    // Maximum USD value of points one member can contribute for others
    // Default: null (unlimited)
    // Example: 500 = no member subsidizes others by more than $500
    max_subsidy_per_member?: number | null;
    
    // Points valuation method for settlements
    // "fair_market" = industry CPP values (recommended)
    // "actual_redemption" = actual CPP achieved
    // "fixed_rate" = fixed CPP for all programs
    // Default: "fair_market"
    valuation_method?: "fair_market" | "actual_redemption" | "fixed_rate";
    
    // If using fixed_rate, the CPP to use
    // Default: 1.5
    fixed_cpp?: number;
    
    // Include hotels in optimization
    // Default: true
    include_hotels?: boolean;
    
    // Cabin class preferences
    // Default: ["Economy"]
    cabins?: ("Economy" | "Premium Economy" | "Business" | "First")[];
  };
}
```

##### Response Schema (Key Fields)

```typescript
interface OptimizeOOPResponse {
  status: "Optimal" | "Feasible" | "Infeasible" | "Fallback";
  
  summary: {
    total_group_oop: number;          // Total cash the group pays
    all_cash_would_cost: number;      // What it would cost without points
    total_savings: number;            // Difference
    savings_percentage: number;       
  };
  
  per_member: {
    [member_id: string]: {
      member_name: string;
      cash_paid: number;              // Surcharges they pay directly
      points_they_contributed: number;
      contribution_value_usd: number; // Value of their contribution
      value_received_from_others: number;
      value_given_to_others: number;
      net_settlement: number;         // +owes, -receives
      settlement_direction: "owes" | "receives" | "even";
      total_effective_cost: number;   // cash_paid + net_settlement
    };
  };
  
  allocations: Array<{
    item_id: string;
    beneficiary_member_id: string;    // Who this booking is FOR
    points_owner_id: string;          // Who PROVIDED the points
    points_used: number;
    points_fair_market_value: number;
    cash_paid: number;                // Surcharges
  }>;
  
  transfers: Array<{
    owner_member_id: string;
    from_program: string;
    to_program: string;
    points_to_transfer: number;
    transfer_time: string;
    steps: string[];
  }>;
  
  settlements: Array<{
    from_member_id: string;
    to_member_id: string;
    amount: number;
    reason: string;
    breakdown: Array<{ item, value }>;
  }>;
  
  booking_order: Array<{
    step: number;
    type: "transfer" | "wait" | "booking" | "settlement";
    actor_member_id?: string;
    action: string;
    depends_on_steps?: number[];
  }>;
}
```

##### Example Request

```json
{
  "options": {
    "allow_cross_member_points": true,
    "max_subsidy_per_member": 1000,
    "valuation_method": "fair_market",
    "include_hotels": true,
    "cabins": ["Economy"]
  }
}
```

##### Example Response (Abbreviated)

```json
{
  "status": "Optimal",
  "summary": {
    "total_group_oop": 1095.00,
    "all_cash_would_cost": 8780.00,
    "total_savings": 7685.00,
    "savings_percentage": 87.5
  },
  "per_member": {
    "user_alice": {
      "member_name": "Alice",
      "cash_paid": 300.00,
      "points_they_contributed": 110000,
      "contribution_value_usd": 1650.00,
      "value_received_from_others": 1247.00,
      "value_given_to_others": 715.00,
      "net_settlement": 532.00,
      "settlement_direction": "owes",
      "total_effective_cost": 832.00
    },
    "user_carol": {
      "member_name": "Carol",
      "cash_paid": 470.00,
      "points_they_contributed": 450000,
      "contribution_value_usd": 3610.00,
      "value_received_from_others": 0.00,
      "value_given_to_others": 934.00,
      "net_settlement": -934.00,
      "settlement_direction": "receives",
      "total_effective_cost": -464.00
    }
  },
  "settlements": [
    {
      "from_member_id": "user_alice",
      "from_member_name": "Alice",
      "to_member_id": "user_carol",
      "to_member_name": "Carol",
      "amount": 467.00,
      "reason": "For Carol's Hilton points used on your hotel share",
      "breakdown": [
        {"item": "Paris Hotel (1/3)", "value": 266.67},
        {"item": "Rome Hotel (1/3)", "value": 200.00}
      ]
    }
  ],
  "booking_order": [
    {"step": 1, "type": "transfer", "actor_member_id": "user_alice", "action": "Transfer 110K Chase → Air France"},
    {"step": 2, "type": "transfer", "actor_member_id": "user_carol", "action": "Transfer 120K Chase → United"},
    {"step": 3, "type": "wait", "action": "Wait for Amex transfer (1-2 days)", "depends_on_steps": [2]},
    {"step": 4, "type": "booking", "actor_member_id": "user_alice", "action": "Book JFK→CDG flights with Flying Blue"},
    {"step": 5, "type": "settlement", "actor_member_id": "user_alice", "action": "Alice pays Carol $467 via Venmo"}
  ]
}
```

---

### 6.3 Points Pool Endpoint

#### `GET /api/group/{trip_id}/points-pool`

**Purpose:** View combined points across all members.

##### Response

```json
{
  "total_by_program": {
    "chase": 230000,
    "amex": 200000,
    "citi": 100000,
    "UA": 50000,
    "HH": 150000
  },
  "by_member": {
    "user_alice": {
      "member_name": "Alice",
      "willing_to_share": true,
      "programs": {
        "chase": {"balance": 150000, "fair_market_value": 2250.00, "cpp": 1.5}
      },
      "total_value": 2250.00
    },
    "user_bob": {
      "member_name": "Bob",
      "willing_to_share": true,
      "programs": {
        "amex": {"balance": 200000, "fair_market_value": 3000.00, "cpp": 1.5},
        "UA": {"balance": 50000, "fair_market_value": 650.00, "cpp": 1.3}
      },
      "total_value": 3650.00
    }
  },
  "transfer_potential": {
    "chase": ["UA", "BA", "AF", "HYATT", "IHG"],
    "amex": ["DL", "HH", "MAR", "AF", "BA"]
  },
  "totals": {
    "total_points_count": 730000,
    "total_estimated_value": 9250.00,
    "shareable_value": 9250.00
  }
}
```

---

### 6.4 Settlement Tracking Endpoints

#### `GET /api/group/{trip_id}/settlements`

Returns all settlements with payment instructions.

#### `POST /api/group/{trip_id}/settlements/{settlement_id}/mark-paid`

```json
// Request
{
  "payment_method": "venmo",
  "payment_reference": "txn_384759284",
  "notes": "Sent via Venmo"
}

// Response
{
  "status": "paid",
  "awaiting_confirmation_from": "user_carol"
}
```

#### `POST /api/group/{trip_id}/settlements/{settlement_id}/confirm`

```json
// Request
{ "confirmed": true }

// Response
{
  "status": "confirmed",
  "message": "Settlement confirmed! All parties settled."
}
```

#### `GET /api/group/{trip_id}/settlements/status`

```json
{
  "all_settled": false,
  "total_amount": 934.00,
  "status_summary": {
    "pending": 1,
    "paid": 1,
    "confirmed": 0
  },
  "settlements": [...]
}
```

---

## 7. Integration with Existing Systems

### 7.1 Integration Points

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EXISTING SYSTEM INTEGRATION                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────┐                                                        │
│  │  itinerary_service  │  ◄─── Entry point for group optimization               │
│  │    .py              │       Calls group_oop_optimizer when trip.is_group     │
│  └─────────────────────┘                                                        │
│            │                                                                     │
│            ▼                                                                     │
│  ┌─────────────────────┐     ┌─────────────────────┐                           │
│  │  flights.py         │ ──► │  group_points_      │                           │
│  │  (AwardTool API)    │     │  pooling.py (NEW)   │                           │
│  └─────────────────────┘     └─────────────────────┘                           │
│            │                           │                                         │
│            ▼                           ▼                                         │
│  ┌─────────────────────┐     ┌─────────────────────┐                           │
│  │  trip_cost_         │ ──► │  group_oop_         │                           │
│  │  optimizer.py       │     │  optimizer.py (NEW) │                           │
│  └─────────────────────┘     └─────────────────────┘                           │
│            │                           │                                         │
│            ▼                           ▼                                         │
│  ┌─────────────────────┐     ┌─────────────────────┐                           │
│  │  min_oop_           │     │  cost_allocation    │                           │
│  │  optimizer.py       │     │  .py (NEW)          │                           │
│  │  (Single traveler)  │     │  (Settlement calc)  │                           │
│  └─────────────────────┘     └─────────────────────┘                           │
│            │                           │                                         │
│            ▼                           ▼                                         │
│  ┌─────────────────────┐     ┌─────────────────────┐                           │
│  │  transfer_strategy  │ ──► │  Group transfer     │                           │
│  │  .py                │     │  instructions       │                           │
│  └─────────────────────┘     └─────────────────────┘                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Modified `itinerary_service.py`

```python
# backend/src/services/itinerary_service.py (additions)

from ..handlers.group_oop_optimizer import (
    minimize_group_out_of_pocket,
    GroupMember,
    GroupOOPSolution,
)
from ..handlers.group_points_pooling import (
    aggregate_group_points,
)
from ..handlers.cost_allocation import (
    allocate_costs,
    generate_settlement_instructions,
)


async def generate_group_optimized_itinerary(
    trip_id: str,
    members: List[Dict[str, Any]],
    *,
    allow_cross_member_points: bool = True,
) -> Dict[str, Any]:
    """
    Generate an optimized itinerary for a group trip.
    
    This is the main entry point for group optimization.
    """
    # 1. Convert members to GroupMember objects
    group_members = [
        GroupMember(
            user_id=m["user_id"],
            name=m.get("name", m["user_id"]),
            role=MemberRole(m.get("role", "member")),
            departure_airport=m.get("departure_airport", "JFK"),
            arrival_airport=m.get("arrival_airport"),
            cabin_preference=m.get("cabin_preference", "Economy"),
            points_balances=m.get("points", {}),
            max_cash_budget=m.get("max_budget"),
            willing_to_share_points=m.get("willing_to_share", True),
            party_size=m.get("party_size", 1),
        )
        for m in members
    ]
    
    # 2. Aggregate points pool
    pool = aggregate_group_points(group_members)
    
    # 3. Fetch flight and hotel options for all members
    booking_items = await _fetch_group_booking_options(
        trip_id=trip_id,
        members=group_members,
        pool=pool,
    )
    
    # 4. Run group optimization
    solution = minimize_group_out_of_pocket(
        members=group_members,
        booking_items=booking_items,
        pool=pool,
        allow_cross_member_points=allow_cross_member_points,
    )
    
    # 5. Calculate cost allocation
    cost_summaries = allocate_costs(solution, group_members)
    
    # 6. Generate settlement instructions
    settlement_instructions = generate_settlement_instructions(
        solution.settlements,
        {m.user_id: m for m in group_members},
    )
    
    # 7. Build response
    return _build_group_response(
        solution=solution,
        members=group_members,
        pool=pool,
        cost_summaries=cost_summaries,
        settlement_instructions=settlement_instructions,
    )


async def _fetch_group_booking_options(
    trip_id: str,
    members: List[GroupMember],
    pool: GroupPointsPool,
) -> List[MemberBookingItem]:
    """
    Fetch flight and hotel options for all group members.
    
    This handles multiple departure cities and aggregates all options.
    """
    # Get trip details
    trip = await trip_repo.get_trip(trip_id)
    destinations = await destination_repo.get_destinations(trip_id)
    
    # Sort destinations into route
    route = _build_route(destinations)
    
    booking_items = []
    
    # For each member, fetch their flight options
    for member in members:
        member_origin = member.departure_airport
        member_items = []
        
        for i, (from_city, to_city) in enumerate(zip(route[:-1], route[1:])):
            # Get origin airport (member's departure for first leg, or previous destination)
            origin = member_origin if i == 0 else to_city
            
            # Fetch flight options
            flights = await _search_flights_for_segment(
                origin=origin,
                destination=to_city,
                date=trip.get("start_date"),
                pax=member.party_size,
                cabins=[member.cabin_preference],
            )
            
            # Convert to MemberBookingItem
            for j, flight in enumerate(flights):
                item = _flight_to_member_booking_item(
                    flight=flight,
                    member=member,
                    item_id=f"flight_{member.user_id}_{i}_{j}",
                )
                member_items.append(item)
        
        booking_items.extend(member_items)
    
    # Fetch shared hotel options (if applicable)
    if trip.get("include_hotels", True):
        hotel_items = await _fetch_group_hotel_options(trip, destinations, pool)
        booking_items.extend(hotel_items)
    
    return booking_items
```

### 7.3 AwardTool API Extensions

```python
# backend/src/handlers/flights.py (additions)

async def search_group_flights(
    members: List[Dict[str, str]],  # [{"member_id": "alice", "origin": "JFK"}, ...]
    destination: str,
    date: str,
    programs: List[str] = None,
    cabins: List[str] = None,
) -> Dict[str, List[Dict]]:
    """
    Search flights for multiple departure cities simultaneously.
    
    Returns dict mapping member_id to their flight options.
    """
    # Group members by origin
    by_origin = {}
    for m in members:
        origin = m["origin"]
        if origin not in by_origin:
            by_origin[origin] = []
        by_origin[origin].append(m["member_id"])
    
    # Parallel search for each origin
    tasks = []
    for origin in by_origin.keys():
        task = _awardtool_realtime(
            origin=origin,
            destination=destination,
            date_str=date,
            cabins=cabins or ["Economy", "Business"],
            pax=1,  # We'll multiply by party_size later
            programs=programs or DEFAULT_PROGRAMS,
            client=httpx.AsyncClient(),
        )
        tasks.append((origin, task))
    
    results = await asyncio.gather(*[t[1] for t in tasks], return_exceptions=True)
    
    # Map results back to members
    member_flights = {}
    for (origin, _), result in zip(tasks, results):
        if isinstance(result, Exception):
            logger.error(f"Flight search failed for {origin}: {result}")
            continue
        
        for member_id in by_origin[origin]:
            member_flights[member_id] = result.get("data", [])
    
    return member_flights
```

---

## 8. Frontend Components

### 8.1 Key Components

#### `GroupPointsPoolCard.tsx`

```tsx
interface GroupPointsPoolCardProps {
  pool: GroupPointsPool;
  members: GroupMember[];
}

export function GroupPointsPoolCard({ pool, members }: GroupPointsPoolCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Combined Points Portfolio</CardTitle>
        <CardDescription>
          Total value: ${pool.totalEstimatedValue.toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Points breakdown by program */}
        <div className="space-y-3">
          {Object.entries(pool.totalByProgram).map(([program, balance]) => (
            <div key={program} className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ProgramIcon program={program} />
                <span>{getProgramName(program)}</span>
              </div>
              <div className="text-right">
                <span className="font-medium">{balance.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground ml-2">
                  (~${(balance * getCpp(program) / 100).toFixed(0)})
                </span>
              </div>
            </div>
          ))}
        </div>
        
        <Separator className="my-4" />
        
        {/* Contribution by member */}
        <div className="space-y-2">
          <h4 className="font-medium">By Member</h4>
          {members.map(member => (
            <MemberPointsRow 
              key={member.userId} 
              member={member}
              points={pool.byMember[member.userId]}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

#### `GroupSettlementCard.tsx`

```tsx
interface GroupSettlementCardProps {
  settlements: Settlement[];
  members: Record<string, GroupMember>;
}

export function GroupSettlementCard({ settlements, members }: GroupSettlementCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settlement Summary</CardTitle>
        <CardDescription>
          Balance transfers between group members
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settlements.length === 0 ? (
          <p className="text-muted-foreground">No settlements needed!</p>
        ) : (
          <div className="space-y-4">
            {settlements.map((settlement, i) => (
              <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>
                      {members[settlement.fromMember]?.name?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">
                      {members[settlement.fromMember]?.name} pays{' '}
                      {members[settlement.toMember]?.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {settlement.reason}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">
                    ${settlement.amount.toFixed(2)}
                  </p>
                  <div className="flex gap-2 mt-1">
                    <Button size="sm" variant="outline" asChild>
                      <a href={`venmo://paycharge?txn=pay&amount=${settlement.amount}`}>
                        Venmo
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

#### `GroupTransferInstructions.tsx`

```tsx
interface GroupTransferInstructionsProps {
  transfers: GroupTransferInstruction[];
  currentUserId: string;
}

export function GroupTransferInstructions({ 
  transfers, 
  currentUserId 
}: GroupTransferInstructionsProps) {
  // Filter to show current user's transfers first
  const myTransfers = transfers.filter(t => t.ownerMember === currentUserId);
  const otherTransfers = transfers.filter(t => t.ownerMember !== currentUserId);
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Points Transfer Instructions</CardTitle>
      </CardHeader>
      <CardContent>
        {myTransfers.length > 0 && (
          <div className="mb-6">
            <h4 className="font-semibold text-primary mb-3">Your Transfers</h4>
            {myTransfers.map((transfer, i) => (
              <TransferInstructionCard 
                key={i} 
                transfer={transfer}
                isCurrentUser={true}
              />
            ))}
          </div>
        )}
        
        {otherTransfers.length > 0 && (
          <div>
            <h4 className="font-semibold text-muted-foreground mb-3">
              Other Members' Transfers
            </h4>
            {otherTransfers.map((transfer, i) => (
              <TransferInstructionCard 
                key={i} 
                transfer={transfer}
                isCurrentUser={false}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

### 8.2 New Pages

| Page | Route | Purpose |
|------|-------|---------|
| Group Results | `/group/results` | Enhanced with cost allocation view |
| Group Settlement | `/group/settlement` | **NEW** - Settlement tracking |
| Group Points | `/group/points-strategy` | Enhanced with cross-member view |

---

## 9. Implementation Phases

### Phase 1: Core Group Optimization (Foundation)

| Task | Description | Files | Priority |
|------|-------------|-------|----------|
| 1.1 | Create `GroupMember` and related data models | `group_oop_optimizer.py` | Critical |
| 1.2 | Implement `aggregate_group_points()` | `group_points_pooling.py` | Critical |
| 1.3 | Implement `find_best_points_source()` | `group_points_pooling.py` | Critical |
| 1.4 | Extend ILP for multi-member decision variables | `group_oop_optimizer.py` | Critical |
| 1.5 | Implement cross-member points constraints | `group_oop_optimizer.py` | Critical |

**Deliverable:** Basic group optimization working

### Phase 2: Cost Allocation & Settlement

| Task | Description | Files | Priority |
|------|-------------|-------|----------|
| 2.1 | Implement fair value calculation | `cost_allocation.py` | High |
| 2.2 | Implement settlement matrix generation | `cost_allocation.py` | High |
| 2.3 | Implement settlement consolidation | `cost_allocation.py` | High |
| 2.4 | Create settlements database table | DynamoDB | High |
| 2.5 | Add settlement tracking APIs | `app.py` | High |

**Deliverable:** Settlement system working

### Phase 3: API Integration

| Task | Description | Files | Priority |
|------|-------------|-------|----------|
| 3.1 | Create `/api/group/optimize-oop` endpoint | `app.py` | Critical |
| 3.2 | Create `/api/group/{id}/points-pool` endpoint | `app.py` | High |
| 3.3 | Create settlement management endpoints | `app.py` | High |
| 3.4 | Integrate with existing itinerary service | `itinerary_service.py` | Critical |
| 3.5 | Add multi-origin flight search | `flights.py` | High |

**Deliverable:** All APIs functional

### Phase 4: Frontend Experience

| Task | Description | Files | Priority |
|------|-------------|-------|----------|
| 4.1 | Create `GroupPointsPoolCard` | `components/` | High |
| 4.2 | Create `GroupSettlementCard` | `components/` | High |
| 4.3 | Create `GroupTransferInstructions` | `components/` | High |
| 4.4 | Update results page for group view | `group/results/page.tsx` | High |
| 4.5 | Create settlement tracking page | `group/settlement/page.tsx` | Medium |

**Deliverable:** Complete user experience

### Phase 5: Testing & Refinement

| Task | Description | Priority |
|------|-------------|----------|
| 5.1 | Unit tests for ILP solver | Critical |
| 5.2 | Integration tests for API endpoints | High |
| 5.3 | E2E tests for complete flow | High |
| 5.4 | Performance optimization | Medium |
| 5.5 | Edge case handling | Medium |

---

## 10. Complete Example Walkthrough

### Scenario

**Trip:** 3 friends traveling JFK → Paris → Rome → JFK (10 days)

**Group Members:**

| Member | Departure | Points Portfolio |
|--------|-----------|------------------|
| Alice | JFK | Chase: 150K |
| Bob | JFK | Amex: 200K, United: 50K |
| Carol | ORD | Chase: 80K, Citi: 100K, Hilton: 150K |

### Step 1: Pool Aggregation

```python
pool = GroupPointsPool(
    total_by_program={
        "chase": 230000,   # Alice 150K + Carol 80K
        "amex": 200000,    # Bob
        "citi": 100000,    # Carol
        "UA": 50000,       # Bob
        "HH": 150000,      # Carol
    },
    by_member={
        "alice": {"chase": 150000},
        "bob": {"amex": 200000, "UA": 50000},
        "carol": {"chase": 80000, "citi": 100000, "HH": 150000},
    },
    transfer_potential={
        "chase": ["UA", "BA", "AF", "SQ", "HYATT", "IHG"],
        "amex": ["DL", "AF", "BA", "HH", "MAR"],
        "citi": ["AA", "TK", "QR", "SQ"],
    },
)
```

### Step 2: Flight Options (via AwardTool)

| Segment | Cash Price | Points Options |
|---------|------------|----------------|
| JFK → CDG (Alice) | $850 | AF: 55K + $120, UA: 70K + $80 |
| JFK → CDG (Bob) | $850 | AF: 55K + $120, UA: 70K + $80 |
| ORD → CDG (Carol) | $900 | UA: 60K + $90, AF: 60K + $130 |
| CDG → FCO (All) | $180/ea | ITA: 15K + $30 (cash only better) |
| FCO → JFK (Alice) | $900 | UA: 60K + $50 |
| FCO → JFK (Bob) | $900 | UA: 60K + $50 |
| FCO → ORD (Carol) | $950 | UA: 65K + $55 |
| Paris Hotel (4 nights) | $800 | HH: 160K + $40, HYATT: 80K + $30 |
| Rome Hotel (4 nights) | $600 | HH: 120K + $30, HYATT: 60K + $25 |

**All-Cash Total:** $8,780

### Step 3: ILP Optimization Result

**Optimal Payment Strategy:**

| Item | Payment | Cash | Points | Owner |
|------|---------|------|--------|-------|
| Alice JFK→CDG | AF Miles | $120 | 55K | Alice (Chase→AF) |
| Bob JFK→CDG | AF Miles | $120 | 55K | Alice (Chase→AF) |
| Carol ORD→CDG | UA Miles | $90 | 60K | Carol (Chase→UA) |
| CDG→FCO (All 3) | Cash | $540 | - | Each pays own |
| Alice FCO→JFK | UA Miles | $50 | 60K | Bob (UA direct) |
| Bob FCO→JFK | UA Miles | $50 | 60K | Carol (Chase→UA) |
| Carol FCO→ORD | UA Miles | $55 | 65K | Bob (Amex→UA) |
| Paris Hotel | HH Points | $40 | 160K | Carol (HH direct) |
| Rome Hotel | HH Points | $30 | 120K | Carol (HH direct) + Bob (Amex→HH) |

### Step 4: Transfer Instructions

```
══════════════════════════════════════════════════════════════════════════════
                    TRANSFER INSTRUCTIONS BY MEMBER
══════════════════════════════════════════════════════════════════════════════

ALICE'S TRANSFERS:
────────────────────────────────────────────────────────────────────────────
① CHASE → AIR FRANCE FLYING BLUE
   Transfer: 110,000 points (for Alice + Bob JFK→CDG)
   Time: Instant
   
   1. Go to ultimaterewardspoints.chase.com
   2. Click "Transfer Points" → "Travel Partners"
   3. Select "Air France Flying Blue"
   4. Transfer 110,000 points
   5. Book both flights at airfrance.com


BOB'S TRANSFERS:
────────────────────────────────────────────────────────────────────────────
② AMEX → UNITED (for Carol FCO→ORD)
   Transfer: 65,000 points
   Time: 1-2 business days
   
③ AMEX → HILTON (for Rome Hotel partial)
   Transfer: 30,000 points → 60,000 Hilton (1:2 bonus!)
   Time: 1-2 business days


CAROL'S TRANSFERS:
────────────────────────────────────────────────────────────────────────────
④ CHASE → UNITED (for Carol ORD→CDG + Bob FCO→JFK)
   Transfer: 120,000 points
   Time: Instant
```

### Step 5: Cost Summary

```
══════════════════════════════════════════════════════════════════════════════
                         GROUP COST SUMMARY
══════════════════════════════════════════════════════════════════════════════

TOTAL GROUP OUT-OF-POCKET: $1,095
vs. ALL CASH:              $8,780
GROUP SAVINGS:             $7,685 (87.5%)

══════════════════════════════════════════════════════════════════════════════
                         PER-MEMBER BREAKDOWN
══════════════════════════════════════════════════════════════════════════════

┌──────────┬──────────┬──────────────┬─────────────┬────────────┐
│ Member   │ Cash     │ Points       │ Contribution│ Settlement │
│          │ Paid     │ Used         │ Value       │            │
├──────────┼──────────┼──────────────┼─────────────┼────────────┤
│ Alice    │ $300     │ 110K Chase   │ $1,650      │ -$825      │
│          │          │ (→110K AF)   │             │ (receives) │
├──────────┼──────────┼──────────────┼─────────────┼────────────┤
│ Bob      │ $325     │ 50K UA       │ $975        │ +$200      │
│          │          │ 95K Amex     │             │ (owes)     │
├──────────┼──────────┼──────────────┼─────────────┼────────────┤
│ Carol    │ $470     │ 80K Chase    │ $1,200      │ +$625      │
│          │          │ + 280K HH    │ + $1,400    │ (owes)     │
└──────────┴──────────┴──────────────┴─────────────┴────────────┘

══════════════════════════════════════════════════════════════════════════════
                         SETTLEMENTS REQUIRED
══════════════════════════════════════════════════════════════════════════════

1. Bob → Alice: $200.00
   (For Alice's points used on Bob's JFK→CDG)

2. Carol → Alice: $625.00  
   (For Alice's points used on shared bookings)

Settlement Methods:
• Venmo: @alice-username
• PayPal: alice@email.com
• Zelle: (555) 123-4567
```

### Step 6: Final Booking Order

```
══════════════════════════════════════════════════════════════════════════════
                    STEP-BY-STEP BOOKING ORDER
══════════════════════════════════════════════════════════════════════════════

DAY 1: Point Transfers (Do FIRST - allow 2 days for Amex)
──────────────────────────────────────────────────────────
✓ [Alice] Transfer 110K Chase → Air France (instant)
✓ [Carol] Transfer 120K Chase → United (instant)
□ [Bob] Transfer 65K Amex → United (wait 1-2 days)
□ [Bob] Transfer 30K Amex → Hilton (wait 1-2 days)

DAY 3: Flight Bookings
──────────────────────────────────────────────────────────
□ [Alice] Book Alice+Bob JFK→CDG at airfrance.com
         110K Flying Blue + $240 taxes
         
□ [Carol] Book Carol ORD→CDG at united.com
         60K MileagePlus + $90 taxes
         
□ [Any]   Book All CDG→FCO at ita-airways.com
         Cash: $540 total

□ [Bob]   Book Alice FCO→JFK at united.com
         60K MileagePlus (Bob's) + $50 taxes
         
□ [Carol] Book Bob FCO→JFK at united.com
         60K MileagePlus + $50 taxes
         
□ [Bob]   Book Carol FCO→ORD at united.com
         65K MileagePlus + $55 taxes

DAY 4: Hotel Bookings
──────────────────────────────────────────────────────────
□ [Carol] Book Paris Hotel at hilton.com
         160K Hilton Honors + $40 fees
         
□ [Carol] Book Rome Hotel at hilton.com
         120K Hilton Honors + $30 fees

DAY 5: Settlement
──────────────────────────────────────────────────────────
□ [Bob] Pay Alice $200 via Venmo
□ [Carol] Pay Alice $625 via Venmo
```

---

## Appendix A: Complete Transfer Graph

### Bank → Airline Transfers (Relevant for Group)

| Bank | UA | AA | DL | AF | BA | HH | HYATT |
|------|----|----|----|----|----|----|-------|
| Chase | ✓ 1:1 | - | - | ✓ 1:1 | ✓ 1:1 | - | ✓ 1:1 |
| Amex | - | - | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:2 | - |
| Citi | - | ✓ 1:1 | - | ✓ 1:1 | - | - | - |
| Bilt | ✓ 1:1 | ✓ 1:1 | - | ✓ 1:1 | ✓ 1:1 | - | ✓ 1:1 |

---

## Appendix B: Settlement Calculation Algorithm

```python
def calculate_net_settlements(allocations: List[GroupPaymentAllocation]) -> Dict:
    """
    Calculate net settlements from payment allocations.
    
    For each allocation where owner != beneficiary:
    - Beneficiary owes owner the fair value of points used
    
    Net out mutual debts:
    - If Alice owes Bob $100 and Bob owes Alice $60
    - Result: Alice owes Bob $40
    """
    # Build gross debts matrix
    debts = {}  # (from, to) -> amount
    
    for alloc in allocations:
        if alloc.payment_type != "points":
            continue
        if alloc.points_owner == alloc.beneficiary_member:
            continue  # No debt for using own points
        
        key = (alloc.beneficiary_member, alloc.points_owner)
        debts[key] = debts.get(key, 0) + (alloc.points_value_usd or 0)
    
    # Net out mutual debts
    net = {}
    processed = set()
    
    for (from_m, to_m), amount in debts.items():
        if (from_m, to_m) in processed or (to_m, from_m) in processed:
            continue
        
        reverse_amount = debts.get((to_m, from_m), 0)
        net_amount = amount - reverse_amount
        
        if net_amount > 0:
            net[(from_m, to_m)] = net_amount
        elif net_amount < 0:
            net[(to_m, from_m)] = -net_amount
        
        processed.add((from_m, to_m))
        processed.add((to_m, from_m))
    
    return net
```

---

*Document Version: 1.0*
*Created: January 2026*
*Based on Tripy Backend Architecture, AwardTool API, and OOP Optimization Framework*
