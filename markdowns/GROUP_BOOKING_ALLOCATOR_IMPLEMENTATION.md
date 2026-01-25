# GroupBookingAllocator Implementation Guide

A detailed implementation approach for the GroupBookingAllocator component that assigns booking responsibilities across group members without pooling points.

---

## Table of Contents

1. [Core Principle](#1-core-principle)
2. [Architecture Overview](#2-architecture-overview)
3. [Step-by-Step Implementation](#3-step-by-step-implementation)
4. [Data Models](#4-data-models)
5. [Algorithm Implementation](#5-algorithm-implementation)
6. [API Integration](#6-api-integration)
7. [Frontend Integration](#7-frontend-integration)
8. [Testing Strategy](#8-testing-strategy)
9. [Migration Path](#9-migration-path)

---

## 1. Core Principle

### The Non-Pooling Constraint

**Points cannot be combined across members.** Each booking must be made by ONE person using THEIR OWN points account.

```
┌─────────────────────────────────────────────────────────────────┐
│                    WRONG vs CORRECT                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ❌ WRONG (Current Implementation)                              │
│     Alice: 100k Chase UR  ─┐                                    │
│                            ├──► "Pool": 200k ──► Book anything  │
│     Bob:   100k Chase UR  ─┘                                    │
│                                                                  │
│  ✅ CORRECT (GroupBookingAllocator)                             │
│     Alice: 100k Chase UR ──► Alice books Segment A (80k)        │
│     Bob:   100k Chase UR ──► Bob books Segment B (70k)          │
│                                                                  │
│     Each person uses their OWN account for segments they book   │
└─────────────────────────────────────────────────────────────────┘
```

### What This Means for Implementation

1. **Decision Variable**: `x[segment, option, member]` - which member books which segment
2. **Constraint**: Each member's total points usage ≤ their individual balance
3. **Output**: Assignment map of segment → member + settlement calculations

---

## 2. Architecture Overview

### Component Hierarchy

```
┌──────────────────────────────────────────────────────────────────┐
│                        API Layer                                  │
│  POST /api/optimize/group/allocate                               │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    OrchestratorAgent                              │
│  - Fetches trip data                                             │
│  - Coordinates flight/hotel search                               │
│  - Calls GroupBookingAllocator                                   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                  GroupBookingAllocator                           │
│  - Receives: segments[], members[], strategy                     │
│  - Runs: ILP optimization OR strategy-based allocation           │
│  - Returns: GroupBookingPlan with assignments + settlements      │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    SettlementCalculator                          │
│  - Calculates fair share per member                              │
│  - Determines who owes whom                                      │
│  - Minimizes number of settlement transactions                   │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Input:
├── Trip segments (flights, hotels) with pricing options
├── Members with their individual points balances
└── Allocation strategy (optimize, by_type, by_direction, manual)

Processing:
├── For each segment, determine which member should book it
├── Ensure no member exceeds their own points balance
└── Calculate optimal assignment to minimize total group OOP

Output:
├── BookingAssignment[] - who books each segment
├── MemberSummary[] - what each person books and pays
└── Settlement[] - money transfers between members
```

---

## 3. Step-by-Step Implementation

### Phase 1: Create Data Models

**File: `backend/src/agents/group_models.py`**

```python
"""
Data models for group booking allocation.
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field


class MemberBookingCapability(BaseModel):
    """
    A group member's ability to make bookings.
    
    IMPORTANT: points dict represents THIS MEMBER's balances only.
    Points cannot be shared or transferred between members.
    """
    member_id: str
    member_name: str
    
    # This member's points balances (not pooled with others)
    points: dict[str, int] = Field(
        default_factory=dict,
        description="Program name -> balance. E.g., {'Chase UR': 100000, 'United': 50000}"
    )
    
    # Optional budget constraint for this member
    max_cash_budget: Optional[float] = Field(
        default=None,
        description="Maximum cash this member is willing to pay upfront"
    )
    
    # Credit cards this member has (for earning recommendations)
    credit_cards: list[str] = Field(
        default_factory=list,
        description="Card names for booking recommendations"
    )


class BookingAssignment(BaseModel):
    """
    Assignment of ONE segment to ONE member.
    
    The assigned member will:
    1. Make the actual booking (login to their account)
    2. Use their own points (if uses_points=True)
    3. Pay the cash amount from their card
    """
    segment_id: str
    segment_type: Literal["flight", "hotel"]
    
    # Who books this segment
    assigned_to: str  # member_id
    assigned_to_name: str
    
    # Why this assignment was made
    reason: str
    
    # Payment details (from this member's resources)
    uses_points: bool
    points_program: Optional[str] = None  # Which program (from their account)
    points_used: Optional[int] = None     # How many points (from their balance)
    cash_amount: float                     # Cash they pay (surcharge or full price)
    
    # Segment details for display
    segment_summary: Optional[str] = None  # "JFK → CDG, United 123"


class Settlement(BaseModel):
    """
    A money transfer between two members to balance costs.
    
    After all bookings, each member should pay their fair share.
    If Alice paid $300 and Bob paid $100 for a 2-person trip,
    Bob owes Alice $100 (so each effectively paid $200).
    """
    from_member: str  # member_id who owes money
    from_name: str
    to_member: str    # member_id who is owed money
    to_name: str
    amount: float     # Amount to transfer
    reason: str = "Settlement for group trip bookings"


class MemberBookingSummary(BaseModel):
    """Summary of what one member books and pays."""
    member_id: str
    member_name: str
    
    # Segments this member books
    segments_to_book: list[str]  # segment_ids
    segment_count: int
    
    # What they pay upfront (before settlement)
    total_cash_upfront: float
    total_points_used: int
    programs_used: list[str]
    
    # After settlement
    fair_share: float        # What they should pay
    settlement_amount: float  # Positive = they owe, Negative = they're owed
    final_cost: float        # fair_share (what they effectively pay)


class BookingAllocationStrategy(BaseModel):
    """Strategy for allocating bookings."""
    strategy_type: Literal[
        "optimize",        # ILP finds optimal assignment
        "by_segment_type", # One person books flights, another hotels
        "by_direction",    # One books outbound, another return
        "manual",          # User specifies each assignment
    ]
    
    # For by_segment_type strategy
    flight_booker: Optional[str] = None  # member_id
    hotel_booker: Optional[str] = None   # member_id
    
    # For by_direction strategy
    outbound_booker: Optional[str] = None
    return_booker: Optional[str] = None
    
    # For manual strategy
    manual_assignments: dict[str, str] = Field(
        default_factory=dict,
        description="segment_id -> member_id"
    )


class GroupBookingPlan(BaseModel):
    """
    Complete booking plan for a group trip.
    
    This is the main output of GroupBookingAllocator.
    """
    trip_id: str
    strategy_used: str
    
    # All segment assignments
    assignments: list[BookingAssignment]
    
    # Per-member summaries
    member_summaries: list[MemberBookingSummary]
    
    # Money transfers needed
    settlements: list[Settlement]
    
    # Overall metrics
    total_group_oop: float           # Total cash paid by group
    total_points_used: int           # Total points used across all members
    per_person_effective_cost: float # After settlement, each pays this
    
    # Validation
    all_segments_assigned: bool
    all_members_within_budget: bool
    all_members_within_points: bool
```

### Phase 2: Implement the Allocator

**File: `backend/src/agents/group_allocator.py`**

```python
"""
GroupBookingAllocator - Assigns booking responsibilities to group members.

CRITICAL: This allocator ensures each member only uses their OWN points.
Points are never pooled or combined across members.
"""

import logging
from typing import Optional
from dataclasses import dataclass

from .group_models import (
    MemberBookingCapability,
    BookingAssignment,
    Settlement,
    MemberBookingSummary,
    BookingAllocationStrategy,
    GroupBookingPlan,
)
from .config import TRANSFER_GRAPH

logger = logging.getLogger(__name__)


@dataclass
class SegmentOption:
    """A booking option for a segment."""
    segment_id: str
    segment_type: str  # "flight" or "hotel"
    option_id: str
    
    # Cash option
    cash_price: float
    
    # Award option (if available)
    award_available: bool = False
    award_program: Optional[str] = None
    award_points: Optional[int] = None
    award_surcharge: float = 0.0
    
    # Display info
    summary: str = ""


class GroupBookingAllocator:
    """
    Allocates booking responsibilities across group members.
    
    Usage:
        allocator = GroupBookingAllocator()
        plan = allocator.allocate(
            trip_id="trip_123",
            segments=segment_options,
            members=member_capabilities,
            strategy=allocation_strategy,
        )
    """
    
    def __init__(self, use_ilp: bool = True, time_limit_seconds: int = 30):
        """
        Initialize allocator.
        
        Args:
            use_ilp: If True, use ILP solver for optimize strategy.
                     If False, use greedy heuristic.
            time_limit_seconds: Max time for ILP solver.
        """
        self.use_ilp = use_ilp
        self.time_limit_seconds = time_limit_seconds
    
    def allocate(
        self,
        trip_id: str,
        segments: list[list[SegmentOption]],  # segments[i] = options for segment i
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
    ) -> GroupBookingPlan:
        """
        Create optimal booking allocation.
        
        Args:
            trip_id: Trip identifier
            segments: For each segment, list of booking options
            members: Group members with their points
            strategy: How to allocate (optimize, by_type, etc.)
        
        Returns:
            GroupBookingPlan with assignments and settlements
        """
        logger.info(f"Allocating {len(segments)} segments among {len(members)} members")
        logger.info(f"Strategy: {strategy.strategy_type}")
        
        # Route to appropriate strategy
        if strategy.strategy_type == "optimize":
            assignments = self._allocate_optimized(segments, members)
        elif strategy.strategy_type == "by_segment_type":
            assignments = self._allocate_by_type(segments, members, strategy)
        elif strategy.strategy_type == "by_direction":
            assignments = self._allocate_by_direction(segments, members, strategy)
        elif strategy.strategy_type == "manual":
            assignments = self._allocate_manual(segments, members, strategy)
        else:
            raise ValueError(f"Unknown strategy: {strategy.strategy_type}")
        
        # Calculate settlements
        settlements = self._calculate_settlements(assignments, members)
        
        # Build member summaries
        member_summaries = self._build_member_summaries(
            assignments, members, settlements
        )
        
        # Build final plan
        total_oop = sum(a.cash_amount for a in assignments)
        total_points = sum(a.points_used or 0 for a in assignments)
        
        return GroupBookingPlan(
            trip_id=trip_id,
            strategy_used=strategy.strategy_type,
            assignments=assignments,
            member_summaries=member_summaries,
            settlements=settlements,
            total_group_oop=total_oop,
            total_points_used=total_points,
            per_person_effective_cost=total_oop / len(members) if members else 0,
            all_segments_assigned=len(assignments) == len(segments),
            all_members_within_budget=self._check_budgets(assignments, members),
            all_members_within_points=self._check_points(assignments, members),
        )
    
    # =========================================================================
    # STRATEGY: OPTIMIZE (ILP-based)
    # =========================================================================
    
    def _allocate_optimized(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """
        Use ILP to find optimal member-segment assignment.
        
        Objective: Minimize total group OOP
        
        Constraints:
        - Each segment assigned to exactly one member with one option
        - Each member's points usage <= their own balance (NOT pooled!)
        - Each member's cash <= their budget (if specified)
        """
        if self.use_ilp:
            try:
                return self._solve_with_ilp(segments, members)
            except Exception as e:
                logger.warning(f"ILP failed, falling back to greedy: {e}")
        
        return self._solve_greedy(segments, members)
    
    def _solve_with_ilp(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """ILP solver implementation."""
        from pulp import LpProblem, LpMinimize, LpVariable, LpBinary, lpSum, PULP_CBC_CMD
        
        prob = LpProblem("Group_Booking_Allocation", LpMinimize)
        
        # Decision variables: x[seg_idx, opt_idx, mem_idx] = 1 if member books segment
        x = {}
        for seg_idx, options in enumerate(segments):
            for opt_idx, option in enumerate(options):
                for mem_idx, member in enumerate(members):
                    x[seg_idx, opt_idx, mem_idx] = LpVariable(
                        f"x_{seg_idx}_{opt_idx}_{mem_idx}",
                        cat=LpBinary
                    )
        
        # Objective: Minimize total OOP
        oop_terms = []
        for seg_idx, options in enumerate(segments):
            for opt_idx, option in enumerate(options):
                for mem_idx in range(len(members)):
                    if option.award_available:
                        oop = option.award_surcharge
                    else:
                        oop = option.cash_price
                    oop_terms.append(oop * x[seg_idx, opt_idx, mem_idx])
        
        prob += lpSum(oop_terms), "Total_Group_OOP"
        
        # Constraint 1: Exactly one (member, option) per segment
        for seg_idx, options in enumerate(segments):
            prob += (
                lpSum(
                    x[seg_idx, opt_idx, mem_idx]
                    for opt_idx in range(len(options))
                    for mem_idx in range(len(members))
                ) == 1,
                f"OneBooker_Seg{seg_idx}"
            )
        
        # Constraint 2: Each member's points <= their own balance (PER MEMBER!)
        for mem_idx, member in enumerate(members):
            # Group by program
            for program in self._get_all_programs(segments):
                points_terms = []
                for seg_idx, options in enumerate(segments):
                    for opt_idx, option in enumerate(options):
                        if option.award_available and option.award_program == program:
                            points_terms.append(
                                option.award_points * x[seg_idx, opt_idx, mem_idx]
                            )
                
                if points_terms:
                    member_balance = member.points.get(program, 0)
                    # Also check if member can transfer to this program
                    member_balance = max(
                        member_balance,
                        self._get_transferable_balance(member, program)
                    )
                    
                    prob += (
                        lpSum(points_terms) <= member_balance,
                        f"Points_{member.member_id}_{program}"
                    )
        
        # Constraint 3: Each member's cash <= their budget (if specified)
        for mem_idx, member in enumerate(members):
            if member.max_cash_budget is not None:
                cash_terms = []
                for seg_idx, options in enumerate(segments):
                    for opt_idx, option in enumerate(options):
                        if option.award_available:
                            cash = option.award_surcharge
                        else:
                            cash = option.cash_price
                        cash_terms.append(cash * x[seg_idx, opt_idx, mem_idx])
                
                prob += (
                    lpSum(cash_terms) <= member.max_cash_budget,
                    f"Budget_{member.member_id}"
                )
        
        # Constraint 4: Member can only use award if they have the points
        for seg_idx, options in enumerate(segments):
            for opt_idx, option in enumerate(options):
                if option.award_available:
                    for mem_idx, member in enumerate(members):
                        if not self._member_can_afford(member, option):
                            # Force x = 0 if member can't afford
                            prob += (
                                x[seg_idx, opt_idx, mem_idx] == 0,
                                f"CantAfford_{seg_idx}_{opt_idx}_{mem_idx}"
                            )
        
        # Solve
        solver = PULP_CBC_CMD(msg=0, timeLimit=self.time_limit_seconds)
        prob.solve(solver)
        
        # Extract solution
        return self._extract_ilp_solution(prob, x, segments, members)
    
    def _solve_greedy(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """
        Greedy fallback when ILP is not available or fails.
        
        For each segment, assign to member who can book it cheapest
        using their own points.
        """
        assignments = []
        
        # Track remaining points per member
        remaining_points = {
            m.member_id: dict(m.points) for m in members
        }
        
        for seg_idx, options in enumerate(segments):
            best_assignment = None
            best_oop = float('inf')
            
            for member in members:
                for option in options:
                    # Check if member can afford this option
                    if option.award_available:
                        program = option.award_program
                        points_needed = option.award_points
                        available = remaining_points[member.member_id].get(program, 0)
                        
                        if available >= points_needed:
                            oop = option.award_surcharge
                            if oop < best_oop:
                                best_oop = oop
                                best_assignment = {
                                    "member": member,
                                    "option": option,
                                    "uses_points": True,
                                    "program": program,
                                    "points": points_needed,
                                    "cash": oop,
                                }
                    
                    # Also consider cash option
                    if option.cash_price < best_oop:
                        best_oop = option.cash_price
                        best_assignment = {
                            "member": member,
                            "option": option,
                            "uses_points": False,
                            "program": None,
                            "points": 0,
                            "cash": option.cash_price,
                        }
            
            if best_assignment:
                # Deduct points if used
                if best_assignment["uses_points"]:
                    program = best_assignment["program"]
                    points = best_assignment["points"]
                    member_id = best_assignment["member"].member_id
                    remaining_points[member_id][program] -= points
                
                assignments.append(BookingAssignment(
                    segment_id=best_assignment["option"].segment_id,
                    segment_type=best_assignment["option"].segment_type,
                    assigned_to=best_assignment["member"].member_id,
                    assigned_to_name=best_assignment["member"].member_name,
                    reason="Greedy: lowest OOP option available to member",
                    uses_points=best_assignment["uses_points"],
                    points_program=best_assignment["program"],
                    points_used=best_assignment["points"],
                    cash_amount=best_assignment["cash"],
                    segment_summary=best_assignment["option"].summary,
                ))
        
        return assignments
    
    # =========================================================================
    # STRATEGY: BY SEGMENT TYPE
    # =========================================================================
    
    def _allocate_by_type(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
    ) -> list[BookingAssignment]:
        """
        Assign all flights to one member, all hotels to another.
        """
        flight_member = self._find_member(members, strategy.flight_booker)
        hotel_member = self._find_member(members, strategy.hotel_booker)
        
        if not flight_member or not hotel_member:
            raise ValueError("flight_booker and hotel_booker must be specified")
        
        assignments = []
        
        # Track remaining points
        remaining_points = {
            m.member_id: dict(m.points) for m in members
        }
        
        for options in segments:
            if not options:
                continue
            
            seg_type = options[0].segment_type
            member = flight_member if seg_type == "flight" else hotel_member
            
            # Find best option for this member
            best = self._find_best_option_for_member(
                options, member, remaining_points[member.member_id]
            )
            
            # Update remaining points
            if best["uses_points"]:
                remaining_points[member.member_id][best["program"]] -= best["points"]
            
            assignments.append(BookingAssignment(
                segment_id=best["option"].segment_id,
                segment_type=seg_type,
                assigned_to=member.member_id,
                assigned_to_name=member.member_name,
                reason=f"Strategy: all {seg_type}s assigned to {member.member_name}",
                uses_points=best["uses_points"],
                points_program=best["program"],
                points_used=best["points"],
                cash_amount=best["cash"],
                segment_summary=best["option"].summary,
            ))
        
        return assignments
    
    # =========================================================================
    # STRATEGY: BY DIRECTION
    # =========================================================================
    
    def _allocate_by_direction(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
    ) -> list[BookingAssignment]:
        """
        Assign outbound segments to one member, return to another.
        Hotels go to whoever has better hotel points.
        """
        outbound_member = self._find_member(members, strategy.outbound_booker)
        return_member = self._find_member(members, strategy.return_booker)
        
        if not outbound_member or not return_member:
            raise ValueError("outbound_booker and return_booker must be specified")
        
        assignments = []
        remaining_points = {m.member_id: dict(m.points) for m in members}
        
        # Count flights to find midpoint
        flights = [opts for opts in segments if opts and opts[0].segment_type == "flight"]
        midpoint = len(flights) // 2
        flight_idx = 0
        
        for options in segments:
            if not options:
                continue
            
            seg_type = options[0].segment_type
            
            if seg_type == "flight":
                # Outbound = first half, Return = second half
                member = outbound_member if flight_idx < midpoint else return_member
                flight_idx += 1
                direction = "outbound" if flight_idx <= midpoint else "return"
            else:
                # Hotels: assign to whoever has better hotel points
                member = self._pick_better_hotel_member(
                    outbound_member, return_member, remaining_points
                )
                direction = "hotel"
            
            best = self._find_best_option_for_member(
                options, member, remaining_points[member.member_id]
            )
            
            if best["uses_points"]:
                remaining_points[member.member_id][best["program"]] -= best["points"]
            
            assignments.append(BookingAssignment(
                segment_id=best["option"].segment_id,
                segment_type=seg_type,
                assigned_to=member.member_id,
                assigned_to_name=member.member_name,
                reason=f"Strategy: {direction} assigned to {member.member_name}",
                uses_points=best["uses_points"],
                points_program=best["program"],
                points_used=best["points"],
                cash_amount=best["cash"],
                segment_summary=best["option"].summary,
            ))
        
        return assignments
    
    # =========================================================================
    # STRATEGY: MANUAL
    # =========================================================================
    
    def _allocate_manual(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
    ) -> list[BookingAssignment]:
        """Use user-specified assignments."""
        assignments = []
        remaining_points = {m.member_id: dict(m.points) for m in members}
        
        for options in segments:
            if not options:
                continue
            
            seg_id = options[0].segment_id
            member_id = strategy.manual_assignments.get(seg_id)
            
            if not member_id:
                raise ValueError(f"No manual assignment for segment {seg_id}")
            
            member = self._find_member(members, member_id)
            if not member:
                raise ValueError(f"Member {member_id} not found")
            
            best = self._find_best_option_for_member(
                options, member, remaining_points[member.member_id]
            )
            
            if best["uses_points"]:
                remaining_points[member.member_id][best["program"]] -= best["points"]
            
            assignments.append(BookingAssignment(
                segment_id=seg_id,
                segment_type=options[0].segment_type,
                assigned_to=member.member_id,
                assigned_to_name=member.member_name,
                reason=f"Manual assignment to {member.member_name}",
                uses_points=best["uses_points"],
                points_program=best["program"],
                points_used=best["points"],
                cash_amount=best["cash"],
                segment_summary=best["option"].summary,
            ))
        
        return assignments
    
    # =========================================================================
    # SETTLEMENT CALCULATION
    # =========================================================================
    
    def _calculate_settlements(
        self,
        assignments: list[BookingAssignment],
        members: list[MemberBookingCapability],
    ) -> list[Settlement]:
        """
        Calculate who owes whom after all bookings.
        
        Fair share = total_cash / num_members
        Settlement minimizes number of transactions.
        """
        if not members:
            return []
        
        # Calculate total and what each member paid
        total_cash = sum(a.cash_amount for a in assignments)
        fair_share = total_cash / len(members)
        
        member_paid = {m.member_id: 0.0 for m in members}
        member_names = {m.member_id: m.member_name for m in members}
        
        for assignment in assignments:
            member_paid[assignment.assigned_to] += assignment.cash_amount
        
        # Calculate balances
        # Positive = owed money (paid more than fair share)
        # Negative = owes money (paid less than fair share)
        balances = {
            m_id: paid - fair_share
            for m_id, paid in member_paid.items()
        }
        
        # Generate settlements (greedy, minimizes transactions)
        settlements = []
        
        debtors = [(m_id, -bal) for m_id, bal in balances.items() if bal < -0.01]
        creditors = [(m_id, bal) for m_id, bal in balances.items() if bal > 0.01]
        
        debtors.sort(key=lambda x: x[1], reverse=True)
        creditors.sort(key=lambda x: x[1], reverse=True)
        
        i, j = 0, 0
        while i < len(debtors) and j < len(creditors):
            debtor_id, debt = debtors[i]
            creditor_id, credit = creditors[j]
            
            amount = min(debt, credit)
            
            if amount > 0.01:
                settlements.append(Settlement(
                    from_member=debtor_id,
                    from_name=member_names[debtor_id],
                    to_member=creditor_id,
                    to_name=member_names[creditor_id],
                    amount=round(amount, 2),
                ))
            
            debtors[i] = (debtor_id, debt - amount)
            creditors[j] = (creditor_id, credit - amount)
            
            if debtors[i][1] < 0.01:
                i += 1
            if creditors[j][1] < 0.01:
                j += 1
        
        return settlements
    
    # =========================================================================
    # HELPER METHODS
    # =========================================================================
    
    def _find_member(
        self,
        members: list[MemberBookingCapability],
        member_id: str,
    ) -> Optional[MemberBookingCapability]:
        """Find member by ID."""
        for m in members:
            if m.member_id == member_id:
                return m
        return None
    
    def _find_best_option_for_member(
        self,
        options: list[SegmentOption],
        member: MemberBookingCapability,
        remaining_points: dict[str, int],
    ) -> dict:
        """Find best option for a member given their remaining points."""
        best = {"option": options[0], "uses_points": False, "program": None, "points": 0, "cash": options[0].cash_price}
        
        for option in options:
            # Check award option
            if option.award_available:
                program = option.award_program
                points_needed = option.award_points
                available = remaining_points.get(program, 0)
                
                if available >= points_needed:
                    if option.award_surcharge < best["cash"]:
                        best = {
                            "option": option,
                            "uses_points": True,
                            "program": program,
                            "points": points_needed,
                            "cash": option.award_surcharge,
                        }
            
            # Check cash option
            if not best["uses_points"] and option.cash_price < best["cash"]:
                best = {
                    "option": option,
                    "uses_points": False,
                    "program": None,
                    "points": 0,
                    "cash": option.cash_price,
                }
        
        return best
    
    def _member_can_afford(
        self,
        member: MemberBookingCapability,
        option: SegmentOption,
    ) -> bool:
        """Check if member can afford an award option."""
        if not option.award_available:
            return True
        
        program = option.award_program
        points_needed = option.award_points
        
        # Direct balance
        if member.points.get(program, 0) >= points_needed:
            return True
        
        # Check transfer partners
        return self._get_transferable_balance(member, program) >= points_needed
    
    def _get_transferable_balance(
        self,
        member: MemberBookingCapability,
        target_program: str,
    ) -> int:
        """Get max points member can have in target program via transfers."""
        max_balance = member.points.get(target_program, 0)
        
        for bank, config in TRANSFER_GRAPH.items():
            programs = config.get("airlines", []) + config.get("hotels", [])
            if target_program in programs:
                ratio = config.get("ratios", {}).get(target_program, 1.0)
                bank_balance = member.points.get(bank, 0)
                transferable = int(bank_balance * ratio)
                max_balance = max(max_balance, transferable)
        
        return max_balance
    
    def _get_all_programs(self, segments: list[list[SegmentOption]]) -> set[str]:
        """Get all programs mentioned in segment options."""
        programs = set()
        for options in segments:
            for option in options:
                if option.award_program:
                    programs.add(option.award_program)
        return programs
    
    def _pick_better_hotel_member(
        self,
        member_a: MemberBookingCapability,
        member_b: MemberBookingCapability,
        remaining_points: dict[str, dict[str, int]],
    ) -> MemberBookingCapability:
        """Pick member with more hotel points."""
        hotel_programs = ["Marriott Bonvoy", "Hilton Honors", "IHG", "Hyatt", "HH", "MB"]
        
        a_points = sum(
            remaining_points[member_a.member_id].get(p, 0)
            for p in hotel_programs
        )
        b_points = sum(
            remaining_points[member_b.member_id].get(p, 0)
            for p in hotel_programs
        )
        
        return member_a if a_points >= b_points else member_b
    
    def _build_member_summaries(
        self,
        assignments: list[BookingAssignment],
        members: list[MemberBookingCapability],
        settlements: list[Settlement],
    ) -> list[MemberBookingSummary]:
        """Build per-member summaries."""
        total_cash = sum(a.cash_amount for a in assignments)
        fair_share = total_cash / len(members) if members else 0
        
        summaries = []
        for member in members:
            member_assignments = [
                a for a in assignments if a.assigned_to == member.member_id
            ]
            
            cash_upfront = sum(a.cash_amount for a in member_assignments)
            points_used = sum(a.points_used or 0 for a in member_assignments)
            programs = list(set(
                a.points_program for a in member_assignments
                if a.points_program
            ))
            
            # Calculate settlement amount
            settlement_amount = 0.0
            for s in settlements:
                if s.from_member == member.member_id:
                    settlement_amount += s.amount  # They owe
                elif s.to_member == member.member_id:
                    settlement_amount -= s.amount  # They're owed
            
            summaries.append(MemberBookingSummary(
                member_id=member.member_id,
                member_name=member.member_name,
                segments_to_book=[a.segment_id for a in member_assignments],
                segment_count=len(member_assignments),
                total_cash_upfront=cash_upfront,
                total_points_used=points_used,
                programs_used=programs,
                fair_share=fair_share,
                settlement_amount=settlement_amount,
                final_cost=fair_share,
            ))
        
        return summaries
    
    def _check_budgets(
        self,
        assignments: list[BookingAssignment],
        members: list[MemberBookingCapability],
    ) -> bool:
        """Check if all members are within their budgets."""
        member_cash = {m.member_id: 0.0 for m in members}
        for a in assignments:
            member_cash[a.assigned_to] += a.cash_amount
        
        for member in members:
            if member.max_cash_budget is not None:
                if member_cash[member.member_id] > member.max_cash_budget:
                    return False
        return True
    
    def _check_points(
        self,
        assignments: list[BookingAssignment],
        members: list[MemberBookingCapability],
    ) -> bool:
        """Check if all members stayed within their points balances."""
        # Group points by member and program
        member_points_used = {m.member_id: {} for m in members}
        for a in assignments:
            if a.uses_points and a.points_program:
                m_id = a.assigned_to
                prog = a.points_program
                member_points_used[m_id][prog] = (
                    member_points_used[m_id].get(prog, 0) + a.points_used
                )
        
        for member in members:
            for program, used in member_points_used[member.member_id].items():
                available = member.points.get(program, 0)
                if used > available:
                    return False
        
        return True
    
    def _extract_ilp_solution(
        self,
        prob,
        x: dict,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """Extract assignments from solved ILP."""
        from pulp import LpStatus, value
        
        if prob.status != 1:  # Not optimal
            logger.warning(f"ILP status: {LpStatus[prob.status]}")
            return self._solve_greedy(segments, members)
        
        assignments = []
        for seg_idx, options in enumerate(segments):
            for opt_idx, option in enumerate(options):
                for mem_idx, member in enumerate(members):
                    if value(x[seg_idx, opt_idx, mem_idx]) > 0.5:
                        if option.award_available:
                            uses_points = True
                            program = option.award_program
                            points = option.award_points
                            cash = option.award_surcharge
                        else:
                            uses_points = False
                            program = None
                            points = 0
                            cash = option.cash_price
                        
                        assignments.append(BookingAssignment(
                            segment_id=option.segment_id,
                            segment_type=option.segment_type,
                            assigned_to=member.member_id,
                            assigned_to_name=member.member_name,
                            reason="ILP: optimal assignment minimizing group OOP",
                            uses_points=uses_points,
                            points_program=program,
                            points_used=points,
                            cash_amount=cash,
                            segment_summary=option.summary,
                        ))
        
        return assignments
```

### Phase 3: Integrate with Orchestrator

**Update: `backend/src/agents/orchestrator.py`**

```python
from .group_allocator import GroupBookingAllocator, SegmentOption
from .group_models import (
    MemberBookingCapability,
    BookingAllocationStrategy,
    GroupBookingPlan,
)


class OrchestratorAgent:
    
    def __init__(self, config: Optional[AgentConfig] = None):
        # ... existing init ...
        self.group_allocator = GroupBookingAllocator()
    
    async def optimize_group_with_allocation(
        self,
        request: OptimizeGroupRequest,
        strategy: BookingAllocationStrategy,
    ) -> GroupBookingPlan:
        """
        Optimize group trip with proper booking allocation.
        
        This is the CORRECT approach - it assigns each segment to a
        specific member who will use their OWN points.
        """
        # 1. Get trip data
        trip_data = await self._get_trip_data(request.trip_id)
        if not trip_data:
            raise ValueError(f"Trip {request.trip_id} not found")
        
        # 2. Build segments with all destinations
        segments = self._build_trip_segments(trip_data)
        
        # 3. Search for flight/hotel options
        segment_options = await self._search_all_segment_options(
            segments=segments,
            cabin_classes=request.cabin_classes or ["Economy", "Business"],
            hotel_stars=request.hotel_stars or [4, 5],
        )
        
        # 4. Build member capabilities from request
        members = [
            MemberBookingCapability(
                member_id=member_id,
                member_name=member_id,  # Would get name from user service
                points=points,
                max_cash_budget=request.member_budgets.get(member_id),
            )
            for member_id, points in request.member_points.items()
        ]
        
        # 5. Run allocation (this properly handles per-member points!)
        plan = self.group_allocator.allocate(
            trip_id=request.trip_id,
            segments=segment_options,
            members=members,
            strategy=strategy,
        )
        
        return plan
```

---

## 6. API Integration

**File: `backend/src/routes/optimize.py`**

```python
from ..agents.group_models import (
    BookingAllocationStrategy,
    MemberBookingCapability,
)


class GroupAllocationRequest(BaseModel):
    """Request for group booking with allocation."""
    trip_id: str
    members: list[MemberBookingCapability]
    strategy: BookingAllocationStrategy
    cabin_classes: Optional[list[str]] = None
    hotel_stars: Optional[list[int]] = None


@router.post("/group/allocate")
async def allocate_group_bookings(
    request: GroupAllocationRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Allocate booking responsibilities across group members.
    
    IMPORTANT: Points are per-member, NOT pooled.
    Each member uses their own points for segments they book.
    
    Strategies:
    - optimize: System finds best assignment
    - by_segment_type: One person flights, another hotels
    - by_direction: One outbound, another return
    - manual: User specifies each assignment
    
    Returns:
    - assignments: Who books each segment
    - settlements: Who owes whom
    - member_summaries: Per-person breakdown
    """
    orchestrator = OrchestratorAgent()
    
    # Build request for orchestrator
    member_points = {m.member_id: m.points for m in request.members}
    member_budgets = {
        m.member_id: m.max_cash_budget
        for m in request.members
        if m.max_cash_budget is not None
    }
    
    group_request = OptimizeGroupRequest(
        trip_id=request.trip_id,
        member_points=member_points,
        member_budgets=member_budgets,
        cabin_classes=request.cabin_classes,
        hotel_stars=request.hotel_stars,
    )
    
    plan = await orchestrator.optimize_group_with_allocation(
        request=group_request,
        strategy=request.strategy,
    )
    
    # Serialize response
    return {
        "tripId": plan.trip_id,
        "strategyUsed": plan.strategy_used,
        "assignments": [
            {
                "segmentId": a.segment_id,
                "segmentType": a.segment_type,
                "assignedTo": a.assigned_to,
                "assignedToName": a.assigned_to_name,
                "reason": a.reason,
                "usesPoints": a.uses_points,
                "pointsProgram": a.points_program,
                "pointsUsed": a.points_used,
                "cashAmount": a.cash_amount,
                "segmentSummary": a.segment_summary,
            }
            for a in plan.assignments
        ],
        "memberSummaries": [
            {
                "memberId": s.member_id,
                "memberName": s.member_name,
                "segmentsToBook": s.segments_to_book,
                "segmentCount": s.segment_count,
                "totalCashUpfront": s.total_cash_upfront,
                "totalPointsUsed": s.total_points_used,
                "programsUsed": s.programs_used,
                "fairShare": s.fair_share,
                "settlementAmount": s.settlement_amount,
                "finalCost": s.final_cost,
            }
            for s in plan.member_summaries
        ],
        "settlements": [
            {
                "fromMember": s.from_member,
                "fromName": s.from_name,
                "toMember": s.to_member,
                "toName": s.to_name,
                "amount": s.amount,
            }
            for s in plan.settlements
        ],
        "metrics": {
            "totalGroupOOP": plan.total_group_oop,
            "totalPointsUsed": plan.total_points_used,
            "perPersonEffectiveCost": plan.per_person_effective_cost,
        },
        "validation": {
            "allSegmentsAssigned": plan.all_segments_assigned,
            "allMembersWithinBudget": plan.all_members_within_budget,
            "allMembersWithinPoints": plan.all_members_within_points,
        },
    }
```

---

## 7. Frontend Integration

### Hook: `useGroupAllocation.ts`

```typescript
import { useState, useCallback } from 'react';

interface Member {
  memberId: string;
  memberName: string;
  points: Record<string, number>;
  maxCashBudget?: number;
}

interface AllocationStrategy {
  strategyType: 'optimize' | 'by_segment_type' | 'by_direction' | 'manual';
  flightBooker?: string;
  hotelBooker?: string;
  outboundBooker?: string;
  returnBooker?: string;
  manualAssignments?: Record<string, string>;
}

interface BookingAssignment {
  segmentId: string;
  segmentType: 'flight' | 'hotel';
  assignedTo: string;
  assignedToName: string;
  reason: string;
  usesPoints: boolean;
  pointsProgram?: string;
  pointsUsed?: number;
  cashAmount: number;
}

interface Settlement {
  fromMember: string;
  fromName: string;
  toMember: string;
  toName: string;
  amount: number;
}

interface GroupBookingPlan {
  tripId: string;
  assignments: BookingAssignment[];
  settlements: Settlement[];
  metrics: {
    totalGroupOOP: number;
    perPersonEffectiveCost: number;
  };
}

export function useGroupAllocation(tripId: string) {
  const [plan, setPlan] = useState<GroupBookingPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allocate = useCallback(async (
    members: Member[],
    strategy: AllocationStrategy,
  ) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/optimize/group/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId,
          members,
          strategy,
        }),
      });

      if (!response.ok) {
        throw new Error('Allocation failed');
      }

      const data = await response.json();
      setPlan(data);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      throw e;
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  return { plan, loading, error, allocate };
}
```

### Component: `BookingPlanDisplay.tsx`

```tsx
interface Props {
  plan: GroupBookingPlan;
}

export function BookingPlanDisplay({ plan }: Props) {
  return (
    <div className="space-y-8">
      {/* Per-Member Cards */}
      <section>
        <h2 className="text-xl font-bold mb-4">Who Books What</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {plan.memberSummaries.map(member => (
            <div key={member.memberId} className="p-4 border rounded-lg">
              <h3 className="font-semibold">{member.memberName}</h3>
              
              <div className="mt-2 text-sm">
                <p>Books {member.segmentCount} segments</p>
                <p>Pays upfront: ${member.totalCashUpfront.toFixed(2)}</p>
                {member.totalPointsUsed > 0 && (
                  <p>Uses {member.totalPointsUsed.toLocaleString()} points</p>
                )}
              </div>
              
              <div className="mt-3 pt-3 border-t">
                <p className="text-sm text-gray-600">
                  After settlement: ${member.finalCost.toFixed(2)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Settlements */}
      {plan.settlements.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4">Settlements</h2>
          <div className="space-y-2">
            {plan.settlements.map((s, i) => (
              <div key={i} className="p-3 bg-gray-50 rounded flex items-center gap-2">
                <span className="font-medium">{s.fromName}</span>
                <span>→</span>
                <span className="font-medium">{s.toName}</span>
                <span className="ml-auto text-green-600 font-semibold">
                  ${s.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Total */}
      <section className="p-4 bg-blue-50 rounded-lg">
        <p className="text-lg">
          Total group cost: <strong>${plan.metrics.totalGroupOOP.toFixed(2)}</strong>
        </p>
        <p className="text-sm text-gray-600">
          ${plan.metrics.perPersonEffectiveCost.toFixed(2)} per person after settlement
        </p>
      </section>
    </div>
  );
}
```

---

## 8. Testing Strategy

### Unit Tests: `test_group_allocator.py`

```python
import pytest
from backend.src.agents.group_allocator import GroupBookingAllocator, SegmentOption
from backend.src.agents.group_models import (
    MemberBookingCapability,
    BookingAllocationStrategy,
)


class TestNonPoolingConstraint:
    """Tests to verify points are NOT pooled."""
    
    def test_cannot_combine_points(self):
        """
        Scenario: Flight costs 150k, Alice has 100k, Bob has 100k.
        With pooling: Would work (200k total)
        Without pooling: Should NOT work with points
        """
        allocator = GroupBookingAllocator(use_ilp=False)
        
        segments = [[
            SegmentOption(
                segment_id="flight_1",
                segment_type="flight",
                option_id="opt_1",
                cash_price=500.0,
                award_available=True,
                award_program="United",
                award_points=150000,  # Neither member has enough alone!
                award_surcharge=50.0,
            )
        ]]
        
        members = [
            MemberBookingCapability(
                member_id="alice",
                member_name="Alice",
                points={"United": 100000},  # Not enough
            ),
            MemberBookingCapability(
                member_id="bob",
                member_name="Bob",
                points={"United": 100000},  # Not enough
            ),
        ]
        
        strategy = BookingAllocationStrategy(strategy_type="optimize")
        
        plan = allocator.allocate("trip_1", segments, members, strategy)
        
        # Should book with CASH since neither member has 150k
        assert len(plan.assignments) == 1
        assert plan.assignments[0].uses_points == False
        assert plan.assignments[0].cash_amount == 500.0
    
    def test_each_member_uses_own_points(self):
        """
        Scenario: Two 60k flights, Alice has 80k United, Bob has 80k United.
        Each should book one flight with their own points.
        """
        allocator = GroupBookingAllocator(use_ilp=False)
        
        segments = [
            [SegmentOption(
                segment_id="flight_1",
                segment_type="flight",
                option_id="opt_1",
                cash_price=400.0,
                award_available=True,
                award_program="United",
                award_points=60000,
                award_surcharge=25.0,
            )],
            [SegmentOption(
                segment_id="flight_2",
                segment_type="flight",
                option_id="opt_2",
                cash_price=400.0,
                award_available=True,
                award_program="United",
                award_points=60000,
                award_surcharge=25.0,
            )],
        ]
        
        members = [
            MemberBookingCapability(
                member_id="alice",
                member_name="Alice",
                points={"United": 80000},
            ),
            MemberBookingCapability(
                member_id="bob",
                member_name="Bob",
                points={"United": 80000},
            ),
        ]
        
        strategy = BookingAllocationStrategy(strategy_type="optimize")
        
        plan = allocator.allocate("trip_1", segments, members, strategy)
        
        # Both flights should use points
        assert all(a.uses_points for a in plan.assignments)
        
        # Different members should book each flight
        bookers = {a.assigned_to for a in plan.assignments}
        assert len(bookers) == 2  # Alice and Bob each book one
    
    def test_member_cannot_exceed_balance(self):
        """Member should never use more points than they have."""
        allocator = GroupBookingAllocator(use_ilp=False)
        
        segments = [
            [SegmentOption(
                segment_id=f"flight_{i}",
                segment_type="flight",
                option_id=f"opt_{i}",
                cash_price=300.0,
                award_available=True,
                award_program="United",
                award_points=40000,
                award_surcharge=20.0,
            )]
            for i in range(3)  # 3 flights × 40k = 120k needed
        ]
        
        members = [
            MemberBookingCapability(
                member_id="alice",
                member_name="Alice",
                points={"United": 100000},  # Can only afford 2 flights
            ),
        ]
        
        strategy = BookingAllocationStrategy(strategy_type="optimize")
        
        plan = allocator.allocate("trip_1", segments, members, strategy)
        
        # Should use points for 2 flights, cash for 1
        points_flights = [a for a in plan.assignments if a.uses_points]
        cash_flights = [a for a in plan.assignments if not a.uses_points]
        
        assert len(points_flights) == 2
        assert len(cash_flights) == 1
        
        total_points = sum(a.points_used for a in points_flights)
        assert total_points <= 100000


class TestSettlements:
    """Tests for settlement calculations."""
    
    def test_equal_payment_no_settlement(self):
        """If members pay equally, no settlement needed."""
        # ... test implementation
    
    def test_settlement_balances_costs(self):
        """Settlement should make everyone pay fair share."""
        # ... test implementation
```

---

## 9. Migration Path

### Step 1: Create Files (Day 1)

```bash
# Create new files
touch backend/src/agents/group_models.py
touch backend/src/agents/group_allocator.py
touch backend/tests/test_group_allocator.py
```

### Step 2: Implement Models (Day 1)

Copy models from Section 4 into `group_models.py`.

### Step 3: Implement Allocator (Days 2-3)

Copy allocator from Section 5 into `group_allocator.py`.

### Step 4: Add Tests (Day 3)

Run tests to verify non-pooling constraint:

```bash
cd backend
pytest tests/test_group_allocator.py -v
```

### Step 5: Integrate with Orchestrator (Day 4)

Update `orchestrator.py` to use `GroupBookingAllocator` for group trips.

### Step 6: Add API Endpoint (Day 4)

Add `/group/allocate` endpoint to `routes/optimize.py`.

### Step 7: Frontend (Day 5)

Create React components and hooks for allocation UI.

### Step 8: Deprecate Old Method (Day 5)

Update old `optimize_group` to show deprecation warning:

```python
async def optimize_group(self, request):
    """
    DEPRECATED: Use optimize_group_with_allocation instead.
    This method incorrectly pools points.
    """
    logger.warning("optimize_group is DEPRECATED - points are incorrectly pooled")
    # ... existing implementation with warning ...
```

---

## Summary

| Component | Purpose | Key Constraint |
|-----------|---------|----------------|
| `MemberBookingCapability` | Member's points/budget | Points are per-member |
| `BookingAssignment` | Who books what | One member per segment |
| `GroupBookingAllocator` | Assigns bookings | Each member ≤ own balance |
| `Settlement` | Balance costs | Fair share calculation |

**Key Principle**: The allocator NEVER pools points. It assigns segments to members such that each member only uses their own points for segments they book.

---

*Document created: January 25, 2026*
*Related: `REMAINING_IMPLEMENTATION_PLAN.md`*
