# Remaining Implementation Plan

This document provides detailed implementation plans for the remaining items identified in the agentic optimization system.

---

## Table of Contents

1. [Group Booking Allocation](#1-group-booking-allocation) ⭐ NEW
2. [ILP Solver Implementation](#2-ilp-solver-implementation)
3. [Pagination System](#3-pagination-system)
4. [React Error Boundaries](#4-react-error-boundaries)
5. [Implementation Timeline](#5-implementation-timeline)
6. [Testing Strategy](#6-testing-strategy)

---

## 1. Group Booking Allocation

### 1.1 Overview

Enable flexible booking responsibility assignment in group trips:
- **By segment type**: Person A books all flights, Person B books all hotels
- **By direction**: Person A books outbound flights, Person B books return flights
- **By optimization**: System assigns based on who has best points/cards for each segment
- **Manual override**: Users can manually assign any segment to any member

### 1.2 Critical Constraint: Points Are NOT Poolable

**Points cannot be combined across members.** Each member's points exist in their own separate account and can only be used for bookings made by that member.

```
❌ WRONG: "Alice has 100k + Bob has 50k = 150k pool"
✅ CORRECT: "Alice can use up to 100k for her bookings, Bob can use up to 50k for his"
```

This means:
- **Booking responsibility determines points usage** - whoever books a segment uses THEIR points
- **Pseudo-pool optimization** - system finds optimal assignment of segments to members to maximize total points utilization
- **No point transfers between members** - Alice cannot "give" her Chase UR to Bob

#### Example

```
Group: Alice (100k Chase UR), Bob (80k Chase UR)
Trip: 2 flights costing 60k each

❌ Pooling approach (WRONG):
   Combined pool = 180k, book both flights with "group points"
   
✅ Allocation approach (CORRECT):
   Alice books Flight 1 using her 60k → leaves her with 40k
   Bob books Flight 2 using his 60k → leaves him with 20k
   Each person uses their own account
```

#### Why This Matters

1. **Reality constraint**: Credit card companies don't allow combining points across accounts
2. **Booking logistics**: Each segment needs ONE person to actually make the booking
3. **Account verification**: Points must exist in the booker's account at booking time
4. **Settlement clarity**: Clear who paid for what with points vs cash

### 1.4 Use Cases

| Scenario | Description | Benefit |
|----------|-------------|---------|
| **Flight/Hotel Split** | Alice books flights, Bob books hotels | Different members may have better airline vs hotel cards |
| **Outbound/Return Split** | Alice books outbound, Bob books return | Split the booking work evenly |
| **Points Optimization** | System assigns to member with best points for each segment | Maximize total points utilization across individual accounts |
| **Card Benefits** | Assign to member with card offering best miles/cashback | Extra savings from card benefits |

### 1.5 Data Model Updates

#### New Models (`backend/src/agents/models.py`)

```python
from typing import Literal
from pydantic import BaseModel


class BookingAssignment(BaseModel):
    """Assignment of a segment to a specific member for booking."""
    segment_id: str
    segment_type: Literal["flight", "hotel"]
    assigned_to: str  # member_id
    assigned_to_name: str
    reason: str  # Why this assignment was made
    
    # Payment details
    uses_points: bool
    points_program: Optional[str] = None
    points_used: Optional[int] = None
    cash_amount: float
    
    # Card recommendation (if applicable)
    recommended_card: Optional[str] = None
    card_benefit: Optional[str] = None  # e.g., "3x miles on travel"


class BookingAllocationStrategy(BaseModel):
    """Strategy for allocating bookings across group members."""
    strategy_type: Literal[
        "optimize",           # System optimizes based on points/cards
        "by_segment_type",    # Split by flights vs hotels
        "by_direction",       # Split by outbound vs return
        "manual",             # User-specified assignments
        "equal",              # Try to balance cost equally
    ]
    
    # For by_segment_type
    flight_booker: Optional[str] = None  # member_id
    hotel_booker: Optional[str] = None
    
    # For by_direction
    outbound_booker: Optional[str] = None
    return_booker: Optional[str] = None
    
    # For manual
    manual_assignments: dict[str, str] = {}  # segment_id -> member_id


class MemberBookingCapability(BaseModel):
    """A member's capability to book segments."""
    member_id: str
    member_name: str
    
    # Points balances
    points: dict[str, int] = {}  # program -> balance
    
    # Credit cards with travel benefits
    credit_cards: list[dict] = []  # [{name, airline_miles, hotel_points, travel_category_bonus}]
    
    # Preferences
    max_cash_budget: Optional[float] = None
    preferred_programs: list[str] = []


class GroupBookingPlan(BaseModel):
    """Complete booking plan for a group trip."""
    trip_id: str
    strategy: BookingAllocationStrategy
    
    # All assignments
    assignments: list[BookingAssignment]
    
    # Per-member summaries
    member_summaries: list[MemberBookingSummary]
    
    # Overall metrics
    total_group_oop: float
    total_points_used: int
    
    # Settlements needed
    settlements: list[Settlement]


class MemberBookingSummary(BaseModel):
    """Summary of a member's booking responsibilities."""
    member_id: str
    member_name: str
    
    # What they book
    segments_to_book: list[str]  # segment_ids
    flight_count: int
    hotel_count: int
    
    # What they pay upfront
    cash_to_pay: float
    points_to_use: int
    programs_used: list[str]
    
    # What they owe/are owed after settlement
    fair_share: float
    owes: float  # Positive if they owe others
    owed: float  # Positive if others owe them
```

### 1.6 Allocation Algorithm

#### Group ILP Formulation (Per-Member Constraints)

```python
"""
Extended ILP for group booking allocation.
CRITICAL: Points are per-member, NOT pooled.

Decision Variables:
- x[i,j,m] ∈ {0,1}: Member m books segment i using option j
- t[m,p,q] ≥ 0: Member m transfers THEIR OWN points from bank p to program q

Objective: Minimize total group OOP
- Σ (cash[i,j] + surcharge[i,j]) * x[i,j,m] for all i,j,m

Constraints:
1. Exactly one member books each segment with one option
   Σ x[i,j,m] = 1  ∀ segment i
   
2. ⭐ EACH MEMBER's points usage ≤ THEIR OWN balance (NOT pooled!)
   Σ points[i,j] * x[i,j,m] ≤ member[m].points[program]  ∀ member m, program
   
3. Each member's cash spending ≤ their budget
   Σ cash[i,j] * x[i,j,m] ≤ member[m].budget  ∀ member m
   
4. Strategy constraints (e.g., "Alice books all flights")
   If strategy = by_segment_type:
     x[i,j,alice] = 0 for all hotel segments i
     x[i,j,bob] = 0 for all flight segments i

Note: Member A CANNOT use Member B's points. The only way to "share" 
is by assigning different segments to different members, each using 
their own points.
"""
```

### 1.7 Implementation (`backend/src/agents/group_allocator.py`)

```python
"""
Group Booking Allocator

Determines optimal assignment of booking responsibilities
across group members based on their points, cards, and preferences.
"""

import logging
from typing import Optional
from pulp import LpProblem, LpMinimize, LpVariable, LpBinary, lpSum

from .models import (
    BookingAllocationStrategy, BookingAssignment, GroupBookingPlan,
    MemberBookingCapability, MemberBookingSummary, Settlement
)
from .config import TRANSFER_GRAPH

logger = logging.getLogger(__name__)


class GroupBookingAllocator:
    """
    Allocates booking responsibilities across group members.
    
    Supports multiple strategies:
    - optimize: ILP finds who should book what
    - by_segment_type: One person books flights, another hotels
    - by_direction: Split outbound vs return
    - manual: User-specified assignments
    """
    
    def __init__(self):
        self.time_limit_seconds = 30
    
    def allocate(
        self,
        segments: list[dict],
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
    ) -> GroupBookingPlan:
        """
        Create optimal booking allocation based on strategy.
        """
        if strategy.strategy_type == "optimize":
            return self._allocate_optimized(segments, members)
        elif strategy.strategy_type == "by_segment_type":
            return self._allocate_by_type(segments, members, strategy)
        elif strategy.strategy_type == "by_direction":
            return self._allocate_by_direction(segments, members, strategy)
        elif strategy.strategy_type == "manual":
            return self._allocate_manual(segments, members, strategy)
        else:
            return self._allocate_equal(segments, members)
    
    def _allocate_optimized(
        self,
        segments: list[dict],
        members: list[MemberBookingCapability],
    ) -> GroupBookingPlan:
        """
        Use ILP to find optimal member-segment assignment.
        """
        prob = LpProblem("Group_Booking_Allocation", LpMinimize)
        
        # Decision variables: x[seg_idx, opt_idx, member_idx]
        x = {}
        for seg_idx, segment in enumerate(segments):
            for opt_idx, option in enumerate(segment.get("options", [])):
                for mem_idx, member in enumerate(members):
                    x[seg_idx, opt_idx, mem_idx] = LpVariable(
                        f"x_{seg_idx}_{opt_idx}_{mem_idx}",
                        cat=LpBinary
                    )
        
        # Objective: Minimize total group OOP
        oop_terms = []
        for seg_idx, segment in enumerate(segments):
            for opt_idx, option in enumerate(segment.get("options", [])):
                for mem_idx, member in enumerate(members):
                    if option.get("award_available"):
                        oop = option.get("award_surcharge", 0)
                    else:
                        oop = option.get("cash_price", 0) or 0
                    oop_terms.append(oop * x[seg_idx, opt_idx, mem_idx])
        
        prob += lpSum(oop_terms), "Total_Group_OOP"
        
        # Constraint: Exactly one member books each segment
        for seg_idx, segment in enumerate(segments):
            options = segment.get("options", [])
            if options:
                prob += (
                    lpSum(
                        x[seg_idx, opt_idx, mem_idx]
                        for opt_idx in range(len(options))
                        for mem_idx in range(len(members))
                    ) == 1,
                    f"OneBooker_Seg{seg_idx}"
                )
        
        # Constraint: Each member's points usage <= their balance
        for mem_idx, member in enumerate(members):
            for program, balance in member.points.items():
                points_terms = []
                for seg_idx, segment in enumerate(segments):
                    for opt_idx, option in enumerate(segment.get("options", [])):
                        if (option.get("award_available") and 
                            option.get("award_program") == program):
                            pts = option.get("award_points", 0)
                            points_terms.append(pts * x[seg_idx, opt_idx, mem_idx])
                
                if points_terms:
                    prob += (
                        lpSum(points_terms) <= balance,
                        f"PointsBalance_{member.member_id}_{program}"
                    )
        
        # Constraint: Each member's cash <= their budget
        for mem_idx, member in enumerate(members):
            if member.max_cash_budget:
                cash_terms = []
                for seg_idx, segment in enumerate(segments):
                    for opt_idx, option in enumerate(segment.get("options", [])):
                        if option.get("award_available"):
                            cash = option.get("award_surcharge", 0)
                        else:
                            cash = option.get("cash_price", 0) or 0
                        cash_terms.append(cash * x[seg_idx, opt_idx, mem_idx])
                
                prob += (
                    lpSum(cash_terms) <= member.max_cash_budget,
                    f"Budget_{member.member_id}"
                )
        
        # Solve
        from pulp import PULP_CBC_CMD
        solver = PULP_CBC_CMD(msg=0, timeLimit=self.time_limit_seconds)
        prob.solve(solver)
        
        # Extract solution
        return self._extract_solution(prob, x, segments, members)
    
    def _allocate_by_type(
        self,
        segments: list[dict],
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
    ) -> GroupBookingPlan:
        """
        Assign all flights to one member, all hotels to another.
        """
        flight_member = self._find_member(members, strategy.flight_booker)
        hotel_member = self._find_member(members, strategy.hotel_booker)
        
        assignments = []
        for segment in segments:
            seg_type = segment.get("type", "flight")
            if seg_type == "flight":
                member = flight_member
            else:
                member = hotel_member
            
            # Find best option for this member
            best_option = self._find_best_option_for_member(
                segment.get("options", []),
                member,
            )
            
            assignments.append(BookingAssignment(
                segment_id=segment.get("id", ""),
                segment_type=seg_type,
                assigned_to=member.member_id,
                assigned_to_name=member.member_name,
                reason=f"Strategy: {seg_type}s assigned to {member.member_name}",
                uses_points=best_option.get("use_points", False),
                points_program=best_option.get("program"),
                points_used=best_option.get("points"),
                cash_amount=best_option.get("cash", 0),
            ))
        
        return self._build_plan(assignments, members, strategy)
    
    def _allocate_by_direction(
        self,
        segments: list[dict],
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
    ) -> GroupBookingPlan:
        """
        Assign outbound segments to one member, return segments to another.
        """
        outbound_member = self._find_member(members, strategy.outbound_booker)
        return_member = self._find_member(members, strategy.return_booker)
        
        # Determine midpoint of trip to split outbound/return
        total_segments = len([s for s in segments if s.get("type") == "flight"])
        midpoint = total_segments // 2
        
        assignments = []
        flight_count = 0
        
        for segment in segments:
            if segment.get("type") == "flight":
                # Outbound = first half of flights, Return = second half
                if flight_count < midpoint:
                    member = outbound_member
                    direction = "outbound"
                else:
                    member = return_member
                    direction = "return"
                flight_count += 1
            else:
                # Hotels: assign to whoever has better hotel points
                if self._has_better_hotel_points(outbound_member, return_member):
                    member = outbound_member
                else:
                    member = return_member
                direction = "hotel"
            
            best_option = self._find_best_option_for_member(
                segment.get("options", []),
                member,
            )
            
            assignments.append(BookingAssignment(
                segment_id=segment.get("id", ""),
                segment_type=segment.get("type", "flight"),
                assigned_to=member.member_id,
                assigned_to_name=member.member_name,
                reason=f"Strategy: {direction} assigned to {member.member_name}",
                uses_points=best_option.get("use_points", False),
                points_program=best_option.get("program"),
                points_used=best_option.get("points"),
                cash_amount=best_option.get("cash", 0),
            ))
        
        return self._build_plan(assignments, members, strategy)
    
    def _calculate_settlements(
        self,
        assignments: list[BookingAssignment],
        members: list[MemberBookingCapability],
    ) -> list[Settlement]:
        """
        Calculate who owes who after all bookings are made.
        
        Fair share = total_cost / num_members
        If member paid > fair_share, they are owed money
        If member paid < fair_share, they owe money
        """
        # Calculate total cost and what each member paid
        total_cost = sum(a.cash_amount for a in assignments)
        fair_share = total_cost / len(members)
        
        member_paid = {m.member_id: 0.0 for m in members}
        for assignment in assignments:
            member_paid[assignment.assigned_to] += assignment.cash_amount
        
        # Calculate balances
        balances = {}
        for member in members:
            paid = member_paid[member.member_id]
            balances[member.member_id] = {
                "name": member.member_name,
                "paid": paid,
                "fair_share": fair_share,
                "balance": paid - fair_share,  # Positive = owed, Negative = owes
            }
        
        # Generate settlements (minimize number of transactions)
        settlements = []
        debtors = [(m_id, -b["balance"]) for m_id, b in balances.items() if b["balance"] < 0]
        creditors = [(m_id, b["balance"]) for m_id, b in balances.items() if b["balance"] > 0]
        
        debtors.sort(key=lambda x: x[1], reverse=True)
        creditors.sort(key=lambda x: x[1], reverse=True)
        
        i, j = 0, 0
        while i < len(debtors) and j < len(creditors):
            debtor_id, debt = debtors[i]
            creditor_id, credit = creditors[j]
            
            amount = min(debt, credit)
            
            if amount > 0.01:  # Only create settlement if > 1 cent
                settlements.append(Settlement(
                    from_member=debtor_id,
                    from_name=balances[debtor_id]["name"],
                    to_member=creditor_id,
                    to_name=balances[creditor_id]["name"],
                    amount=round(amount, 2),
                    reason=f"Settlement for group trip bookings",
                ))
            
            debtors[i] = (debtor_id, debt - amount)
            creditors[j] = (creditor_id, credit - amount)
            
            if debtors[i][1] < 0.01:
                i += 1
            if creditors[j][1] < 0.01:
                j += 1
        
        return settlements
    
    def _find_best_option_for_member(
        self,
        options: list[dict],
        member: MemberBookingCapability,
    ) -> dict:
        """Find best option for a member based on their points."""
        best = {"cash": float('inf'), "use_points": False}
        
        for option in options:
            if option.get("award_available"):
                program = option.get("award_program")
                points_needed = option.get("award_points", 0)
                surcharge = option.get("award_surcharge", 0)
                
                # Check if member has enough points (direct or via transfer)
                if self._can_member_afford(member, program, points_needed):
                    if surcharge < best["cash"]:
                        best = {
                            "cash": surcharge,
                            "use_points": True,
                            "program": program,
                            "points": points_needed,
                        }
            
            # Also consider cash option
            cash_price = option.get("cash_price", 0) or float('inf')
            if cash_price < best["cash"] and not best.get("use_points"):
                best = {"cash": cash_price, "use_points": False}
        
        return best
    
    def _can_member_afford(
        self,
        member: MemberBookingCapability,
        program: str,
        points_needed: int,
    ) -> bool:
        """Check if member can afford points (direct or via transfer)."""
        # Direct balance
        if member.points.get(program, 0) >= points_needed:
            return True
        
        # Check transfer partners
        for bank, config in TRANSFER_GRAPH.items():
            if program in config.get("airlines", []) + config.get("hotels", []):
                ratio = config.get("ratios", {}).get(program, 1.0)
                needed_from_bank = int(points_needed / ratio)
                if member.points.get(bank, 0) >= needed_from_bank:
                    return True
        
        return False
```

### 1.8 API Updates

#### New Endpoints (`backend/src/routes/optimize.py`)

```python
class GroupAllocationRequest(BaseModel):
    """Request for group booking allocation."""
    trip_id: str
    members: list[MemberBookingCapability]
    strategy: BookingAllocationStrategy
    cabin_classes: Optional[list[str]] = None
    hotel_stars: Optional[list[int]] = None


@router.post("/group/allocate", response_model=None)
async def allocate_group_bookings(
    request: GroupAllocationRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Allocate booking responsibilities across group members.
    
    Strategies:
    - optimize: System finds best assignment based on points/cards
    - by_segment_type: One person books flights, another hotels
    - by_direction: One books outbound, another return
    - manual: User specifies each assignment
    
    Returns a complete booking plan with:
    - Who books each segment
    - What points/cash they use
    - Settlements needed between members
    """
    # ... implementation
```

### 1.9 Frontend Updates

#### New Components

```tsx
// frontend/src/components/group/BookingAllocationSelector.tsx

interface BookingAllocationSelectorProps {
  members: GroupMember[];
  onStrategyChange: (strategy: BookingAllocationStrategy) => void;
}

export function BookingAllocationSelector({ members, onStrategyChange }: Props) {
  const [strategy, setStrategy] = useState<string>('optimize');
  const [flightBooker, setFlightBooker] = useState<string>('');
  const [hotelBooker, setHotelBooker] = useState<string>('');
  
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">How should we split booking responsibilities?</h3>
      
      <div className="grid grid-cols-2 gap-4">
        <StrategyCard
          title="Optimize Automatically"
          description="System assigns based on who has best points for each segment"
          icon={<Sparkles />}
          selected={strategy === 'optimize'}
          onClick={() => setStrategy('optimize')}
        />
        
        <StrategyCard
          title="Split by Type"
          description="One person books all flights, another all hotels"
          icon={<SplitIcon />}
          selected={strategy === 'by_segment_type'}
          onClick={() => setStrategy('by_segment_type')}
        />
        
        <StrategyCard
          title="Split by Direction"
          description="One books outbound, another books return"
          icon={<ArrowLeftRight />}
          selected={strategy === 'by_direction'}
          onClick={() => setStrategy('by_direction')}
        />
        
        <StrategyCard
          title="Manual Assignment"
          description="You decide who books each segment"
          icon={<UserCheck />}
          selected={strategy === 'manual'}
          onClick={() => setStrategy('manual')}
        />
      </div>
      
      {strategy === 'by_segment_type' && (
        <div className="grid grid-cols-2 gap-4 mt-4">
          <MemberSelector
            label="Who books flights?"
            members={members}
            value={flightBooker}
            onChange={setFlightBooker}
          />
          <MemberSelector
            label="Who books hotels?"
            members={members}
            value={hotelBooker}
            onChange={setHotelBooker}
          />
        </div>
      )}
      
      {/* Similar for by_direction */}
    </div>
  );
}
```

```tsx
// frontend/src/components/group/BookingPlanView.tsx

export function BookingPlanView({ plan }: { plan: GroupBookingPlan }) {
  return (
    <div className="space-y-8">
      {/* Member Summaries */}
      <section>
        <h3 className="text-xl font-semibold mb-4">Booking Assignments</h3>
        <div className="grid md:grid-cols-2 gap-6">
          {plan.member_summaries.map(summary => (
            <MemberBookingCard key={summary.member_id} summary={summary} />
          ))}
        </div>
      </section>
      
      {/* Segment Details */}
      <section>
        <h3 className="text-xl font-semibold mb-4">Segment Details</h3>
        {plan.assignments.map(assignment => (
          <AssignmentRow key={assignment.segment_id} assignment={assignment} />
        ))}
      </section>
      
      {/* Settlements */}
      {plan.settlements.length > 0 && (
        <section>
          <h3 className="text-xl font-semibold mb-4">Settlements</h3>
          <SettlementList settlements={plan.settlements} />
        </section>
      )}
    </div>
  );
}
```

### 1.10 Example Scenarios

#### Scenario 1: Why Pooling Doesn't Work

```
❌ WRONG APPROACH (Pooling)
Group: Alice (100k Chase UR), Bob (100k Chase UR)
Trip: Flight A costs 150k Chase UR

With pooling: "Combined 200k, book with shared points" 
Reality: IMPOSSIBLE - Alice can't use Bob's account!

✅ CORRECT APPROACH (Allocation)
Trip: Flight A costs 80k, Flight B costs 80k

Alice books Flight A with her 80k → 20k remaining in her account
Bob books Flight B with his 80k → 20k remaining in his account
Result: Both flights booked using individual accounts
```

#### Scenario 2: Flight/Hotel Split

```
Group: Alice (100k Chase UR), Bob (50k Hilton Honors)

Strategy: by_segment_type
- Alice books flights (her Chase UR transfers to United) - uses HER account
- Bob books hotels (his Hilton points) - uses HIS account

Result:
- Alice pays: $50 surcharge (uses 60k of HER United miles for flights)
- Bob pays: $0 (uses 40k of HIS Hilton points for hotel)
- Total: $50 OOP

Points accounting:
- Alice's account: 100k → transferred 60k to United → 40k remaining
- Bob's account: 50k → used 40k for hotel → 10k remaining

Settlement: Bob owes Alice $25 (half of $50 cash paid)
```

#### Scenario 3: Direction Split

```
Group: Alice (80k United), Bob (80k United), Charlie (50k Marriott)

Strategy: by_direction  
- Alice books outbound flights using HER United account
- Bob books return flights using HIS United account
- Charlie books hotels using HIS Marriott account

Result:
- Alice: Uses 60k of her United miles + $50 surcharge
- Bob: Uses 70k of his United miles + $80 surcharge  
- Charlie: Uses 40k of his Marriott points + $0
- Total: $130 OOP

Points accounting (each person's own account):
- Alice: 80k → 20k remaining
- Bob: 80k → 10k remaining
- Charlie: 50k → 10k remaining

Settlements:
- Fair share: $43.33 each
- Alice paid $50 → owed $6.67
- Bob paid $80 → owed $36.67
- Charlie paid $0 → owes $43.33
```

#### Scenario 4: Optimization Finds Best Assignment

```
Group: Alice (100k Delta), Bob (100k United)
Trip: Delta flight (60k) + United flight (70k)

❌ Random assignment:
   Alice books United flight → pays cash (wrong program!)
   Bob books Delta flight → pays cash (wrong program!)
   Total: $800 cash

✅ Optimized assignment:
   Alice books Delta flight → uses HER 60k Delta miles + $25 surcharge
   Bob books United flight → uses HIS 70k United miles + $40 surcharge
   Total: $65 cash

The optimizer assigns each segment to the member who has the RIGHT 
points program in their OWN account.
```

---

## 2. ILP Solver Implementation

### 2.1 Overview

Replace the current greedy algorithm with a true Integer Linear Programming (ILP) solver using PuLP with CBC backend. This will find globally optimal solutions for minimizing out-of-pocket expense.

### 2.2 Why ILP Over Greedy?

| Scenario | Greedy Result | ILP Result |
|----------|---------------|------------|
| Flight A: 30k pts + $100 surcharge | Picks A (lowest per-segment) | May skip A |
| Flight B: 45k pts + $20 surcharge | Skips B | Picks B |
| **Total OOP** | **$100** | **$20** |

The greedy algorithm optimizes each segment independently, while ILP considers all segments together to find the true minimum.

### 2.3 Mathematical Formulation

#### Decision Variables

```
x[i,j] ∈ {0, 1}  # 1 if option j is selected for segment i
t[p,q] ≥ 0       # Points transferred from program p to program q
```

#### Objective Function (Minimize OOP)

```
Minimize: Σ (cash_cost[i,j] * x[i,j]) + Σ (surcharge[i,j] * x[i,j])
          for all segments i, options j
```

#### Constraints

```
# Exactly one option per segment
Σ x[i,j] = 1  for all segments i

# Points balance constraint
points_used[p] ≤ balance[p] + Σ t[q,p] * ratio[q,p] - Σ t[p,q]
                              for all source programs q     for all dest programs q

# Budget constraint
Σ (cash_cost[i,j] + surcharge[i,j]) * x[i,j] ≤ max_budget

# Transfer only where paths exist
t[p,q] = 0  if no transfer path from p to q
```

### 2.4 File Structure

```
backend/src/agents/
├── ilp_solver.py          # NEW: Core ILP solver
├── ilp_models.py          # NEW: ILP-specific data models
├── ilp_constraints.py     # NEW: Constraint builders
└── orchestrator.py        # UPDATE: Use ILP solver
```

### 1.5 Implementation

#### Step 1: Install PuLP

```bash
# Add to requirements.txt
pulp>=2.7.0
```

#### Step 2: Create ILP Solver (`backend/src/agents/ilp_solver.py`)

```python
"""
ILP Solver for OOP Minimization

Uses PuLP with CBC backend to find globally optimal
payment decisions across all trip segments.
"""

import logging
from typing import Optional
from dataclasses import dataclass
from pulp import (
    LpProblem, LpMinimize, LpVariable, LpBinary, 
    LpContinuous, lpSum, PULP_CBC_CMD, LpStatus
)

from .config import OOP_CONFIG, TRANSFER_GRAPH
from .models import FlightOption, HotelOption, RankedItinerary

logger = logging.getLogger(__name__)


@dataclass
class ILPInput:
    """Input for ILP optimization."""
    segments: list[dict]  # Each has 'options' list
    user_points: dict[str, int]  # program -> balance
    budget: float
    min_cpp_threshold: float = 0.5


@dataclass
class ILPSolution:
    """Output from ILP optimization."""
    status: str  # "Optimal", "Infeasible", etc.
    selected_options: dict[int, int]  # segment_idx -> option_idx
    transfers: list[dict]  # Transfer instructions
    total_oop: float
    total_points_used: int
    solve_time_ms: int


class OOPILPSolver:
    """
    Integer Linear Programming solver for OOP minimization.
    
    Finds the globally optimal combination of payment methods
    across all segments while respecting points and budget constraints.
    """
    
    def __init__(self, config: dict = None):
        self.config = config or OOP_CONFIG
        self.time_limit_seconds = 30
    
    def solve(self, input_data: ILPInput) -> ILPSolution:
        """
        Solve the OOP minimization problem.
        
        Returns the optimal selection of options for each segment
        and required point transfers.
        """
        import time
        start_time = time.time()
        
        # Create problem
        prob = LpProblem("OOP_Minimization", LpMinimize)
        
        # Build decision variables
        x = {}  # x[seg_idx, opt_idx] = 1 if option selected
        for seg_idx, segment in enumerate(input_data.segments):
            for opt_idx, option in enumerate(segment.get("options", [])):
                x[seg_idx, opt_idx] = LpVariable(
                    f"x_{seg_idx}_{opt_idx}", 
                    cat=LpBinary
                )
        
        # Transfer variables: t[from_prog, to_prog]
        t = {}
        for source, targets in TRANSFER_GRAPH.items():
            for target in targets.get("airlines", []) + targets.get("hotels", []):
                t[source, target] = LpVariable(
                    f"t_{source}_{target}",
                    lowBound=0,
                    cat=LpContinuous
                )
        
        # === OBJECTIVE: Minimize OOP ===
        oop_terms = []
        for seg_idx, segment in enumerate(input_data.segments):
            for opt_idx, option in enumerate(segment.get("options", [])):
                # OOP = cash if paying cash, surcharge if paying points
                if option.get("award_available") and option.get("award_points"):
                    # Points payment: OOP is surcharge
                    oop = option.get("award_surcharge", 0)
                else:
                    # Cash payment: OOP is cash price
                    oop = option.get("cash_price", 0) or 0
                
                oop_terms.append(oop * x[seg_idx, opt_idx])
        
        prob += lpSum(oop_terms), "Total_OOP"
        
        # === CONSTRAINT 1: Exactly one option per segment ===
        for seg_idx, segment in enumerate(input_data.segments):
            options = segment.get("options", [])
            if options:
                prob += (
                    lpSum(x[seg_idx, opt_idx] for opt_idx in range(len(options))) == 1,
                    f"OneOption_Seg{seg_idx}"
                )
        
        # === CONSTRAINT 2: Points balance ===
        # For each program, points used <= balance + transfers in - transfers out
        programs_used = set()
        for seg_idx, segment in enumerate(input_data.segments):
            for opt_idx, option in enumerate(segment.get("options", [])):
                if option.get("award_available"):
                    prog = option.get("award_program")
                    if prog:
                        programs_used.add(prog)
        
        for program in programs_used:
            # Calculate points used from this program
            points_used_terms = []
            for seg_idx, segment in enumerate(input_data.segments):
                for opt_idx, option in enumerate(segment.get("options", [])):
                    if (option.get("award_available") and 
                        option.get("award_program") == program):
                        pts = option.get("award_points", 0)
                        points_used_terms.append(pts * x[seg_idx, opt_idx])
            
            if not points_used_terms:
                continue
            
            # Balance from direct holdings
            direct_balance = input_data.user_points.get(program, 0)
            
            # Transfers into this program
            transfers_in = []
            for source, targets in TRANSFER_GRAPH.items():
                if program in targets.get("airlines", []) + targets.get("hotels", []):
                    ratio = targets.get("ratios", {}).get(program, 1.0)
                    if (source, program) in t:
                        transfers_in.append(t[source, program] * ratio)
            
            # Transfers out of this program (if it's a bank program)
            transfers_out = []
            if program in TRANSFER_GRAPH:
                for target in (TRANSFER_GRAPH[program].get("airlines", []) + 
                              TRANSFER_GRAPH[program].get("hotels", [])):
                    if (program, target) in t:
                        transfers_out.append(t[program, target])
            
            # Constraint: used <= available
            prob += (
                lpSum(points_used_terms) <= 
                direct_balance + lpSum(transfers_in) - lpSum(transfers_out),
                f"PointsBalance_{program}"
            )
        
        # === CONSTRAINT 3: Can only transfer what you have ===
        for source in TRANSFER_GRAPH:
            balance = input_data.user_points.get(source, 0)
            if balance > 0:
                targets = TRANSFER_GRAPH[source]
                transfer_terms = []
                for target in targets.get("airlines", []) + targets.get("hotels", []):
                    if (source, target) in t:
                        transfer_terms.append(t[source, target])
                
                if transfer_terms:
                    prob += (
                        lpSum(transfer_terms) <= balance,
                        f"TransferLimit_{source}"
                    )
        
        # === CONSTRAINT 4: Budget constraint ===
        budget_terms = []
        for seg_idx, segment in enumerate(input_data.segments):
            for opt_idx, option in enumerate(segment.get("options", [])):
                if option.get("award_available") and option.get("award_points"):
                    cost = option.get("award_surcharge", 0)
                else:
                    cost = option.get("cash_price", 0) or 0
                budget_terms.append(cost * x[seg_idx, opt_idx])
        
        prob += lpSum(budget_terms) <= input_data.budget, "Budget"
        
        # === CONSTRAINT 5: CPP threshold ===
        # Only allow points payment if CPP >= threshold
        for seg_idx, segment in enumerate(input_data.segments):
            for opt_idx, option in enumerate(segment.get("options", [])):
                if option.get("award_available"):
                    cpp = option.get("cpp", 0)
                    if cpp and cpp < input_data.min_cpp_threshold:
                        # Force this option to not be selected for points
                        # (could still be selected as cash-only option)
                        pass  # Handled in option generation
        
        # === SOLVE ===
        solver = PULP_CBC_CMD(msg=0, timeLimit=self.time_limit_seconds)
        prob.solve(solver)
        
        solve_time = int((time.time() - start_time) * 1000)
        
        # === EXTRACT SOLUTION ===
        status = LpStatus[prob.status]
        
        if status != "Optimal":
            logger.warning(f"ILP solver status: {status}")
            return ILPSolution(
                status=status,
                selected_options={},
                transfers=[],
                total_oop=float('inf'),
                total_points_used=0,
                solve_time_ms=solve_time,
            )
        
        # Extract selected options
        selected = {}
        total_oop = 0.0
        total_points = 0
        
        for seg_idx, segment in enumerate(input_data.segments):
            for opt_idx, option in enumerate(segment.get("options", [])):
                if x[seg_idx, opt_idx].varValue and x[seg_idx, opt_idx].varValue > 0.5:
                    selected[seg_idx] = opt_idx
                    
                    if option.get("award_available") and option.get("award_points"):
                        total_oop += option.get("award_surcharge", 0)
                        total_points += option.get("award_points", 0)
                    else:
                        total_oop += option.get("cash_price", 0) or 0
        
        # Extract transfers
        transfers = []
        for (source, target), var in t.items():
            if var.varValue and var.varValue > 0:
                transfers.append({
                    "from_program": source,
                    "to_program": target,
                    "points": int(var.varValue),
                    "ratio": TRANSFER_GRAPH.get(source, {}).get("ratios", {}).get(target, 1.0),
                })
        
        logger.info(f"ILP solved in {solve_time}ms: OOP=${total_oop:.2f}, points={total_points}")
        
        return ILPSolution(
            status=status,
            selected_options=selected,
            transfers=transfers,
            total_oop=total_oop,
            total_points_used=total_points,
            solve_time_ms=solve_time,
        )
```

#### Step 3: Update Orchestrator (`backend/src/agents/orchestrator.py`)

```python
# Add to _run_oop_optimization method:

async def _run_oop_optimization(
    self,
    segments: list[dict],
    search_results: dict,
    user_points: dict,
    budget: float,
    trip_data: dict,
) -> list[RankedItinerary]:
    """
    Run OOP optimization using ILP solver.
    """
    from .ilp_solver import OOPILPSolver, ILPInput
    
    # Build ILP input
    ilp_segments = []
    for i, segment in enumerate(segments):
        if segment["type"] == "flight":
            key = f"flight_{i}"
            result = search_results.get(key)
            options = result.options if result else []
        else:
            key = f"hotel_{i}"
            result = search_results.get(key)
            options = result.options if result else []
        
        ilp_segments.append({
            "type": segment["type"],
            "segment_data": segment,
            "options": [opt.model_dump() for opt in options],
        })
    
    ilp_input = ILPInput(
        segments=ilp_segments,
        user_points=user_points,
        budget=budget,
        min_cpp_threshold=OOP_CONFIG["min_cpp_threshold"],
    )
    
    # Solve
    solver = OOPILPSolver()
    solution = solver.solve(ilp_input)
    
    if solution.status != "Optimal":
        # Fallback to greedy if ILP fails
        logger.warning("ILP failed, falling back to greedy")
        return await self._run_greedy_optimization(...)
    
    # Build itinerary from ILP solution
    return self._build_itinerary_from_ilp(solution, ilp_segments, trip_data)
```

### 2.6 Testing

```python
# backend/tests/test_ilp_solver.py

import pytest
from src.agents.ilp_solver import OOPILPSolver, ILPInput


def test_simple_two_segment():
    """Test ILP finds optimal when greedy would fail."""
    input_data = ILPInput(
        segments=[
            {
                "type": "flight",
                "options": [
                    {"cash_price": 500, "award_available": True, "award_points": 30000, "award_surcharge": 100, "award_program": "UA"},
                    {"cash_price": 600, "award_available": True, "award_points": 45000, "award_surcharge": 20, "award_program": "UA"},
                ]
            },
            {
                "type": "flight", 
                "options": [
                    {"cash_price": 500, "award_available": True, "award_points": 30000, "award_surcharge": 100, "award_program": "UA"},
                    {"cash_price": 400, "award_available": False},
                ]
            }
        ],
        user_points={"UA": 50000},  # Only enough for one award flight
        budget=1000,
    )
    
    solver = OOPILPSolver()
    solution = solver.solve(input_data)
    
    assert solution.status == "Optimal"
    # Should pick option 1 (lower surcharge) for first segment
    # and cash for second segment = $20 + $400 = $420
    # Greedy would pick option 0 for first = $100 + $400 = $500
    assert solution.total_oop < 500


def test_transfer_optimization():
    """Test ILP correctly handles point transfers."""
    input_data = ILPInput(
        segments=[
            {
                "type": "flight",
                "options": [
                    {"cash_price": 800, "award_available": True, "award_points": 50000, "award_surcharge": 50, "award_program": "UA"},
                ]
            }
        ],
        user_points={"Chase UR": 100000, "UA": 0},  # Need to transfer
        budget=1000,
    )
    
    solver = OOPILPSolver()
    solution = solver.solve(input_data)
    
    assert solution.status == "Optimal"
    assert len(solution.transfers) == 1
    assert solution.transfers[0]["from_program"] == "Chase UR"
    assert solution.transfers[0]["to_program"] == "UA"
```

---

## 3. Pagination System

### 3.1 Overview

Add pagination to optimization results to handle trips with many itinerary options efficiently.

### 3.2 Backend Changes

#### Update API Models (`backend/src/routes/optimize.py`)

```python
class PaginatedResponse(BaseModel):
    """Paginated response wrapper."""
    items: list[Any]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_prev: bool


class SoloOptimizeRequest(BaseModel):
    # ... existing fields ...
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=5, ge=1, le=20)


@router.post("/solo", response_model=None)
async def optimize_solo_trip(
    request: SoloOptimizeRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    # ... existing code ...
    
    # Paginate results
    total = len(result.itineraries)
    start_idx = (request.page - 1) * request.page_size
    end_idx = start_idx + request.page_size
    page_items = result.itineraries[start_idx:end_idx]
    
    total_pages = (total + request.page_size - 1) // request.page_size
    
    return {
        "tripId": result.trip_id,
        "itineraries": [_serialize_itinerary(it) for it in page_items],
        "bestOption": result.best_option,
        "warnings": result.warnings,
        "pagination": {
            "total": total,
            "page": request.page,
            "pageSize": request.page_size,
            "totalPages": total_pages,
            "hasNext": request.page < total_pages,
            "hasPrev": request.page > 1,
        },
    }
```

### 3.3 Frontend Changes

#### Update Types (`frontend/src/types/optimization.ts`)

```typescript
export interface Pagination {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface OptimizeSoloResponse {
  tripId: string;
  itineraries: RankedItinerary[];
  bestOption: {...};
  warnings: string[];
  pagination?: Pagination;
}
```

#### Update Hook (`frontend/src/lib/hooks/useOOPOptimization.ts`)

```typescript
interface UseOOPOptimizationOptions {
  // ... existing options ...
  page?: number;
  pageSize?: number;
}

interface UseOOPOptimizationReturn {
  // ... existing returns ...
  pagination: Pagination | null;
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
}

export function useOOPOptimization(options: UseOOPOptimizationOptions) {
  const [page, setPage] = useState(options.page || 1);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  
  const fetchResults = useCallback(async () => {
    // ... existing fetch logic ...
    
    if (options.tripType === 'solo') {
      response = await optimization.solo({
        // ... existing params ...
        page,
        pageSize: options.pageSize || 5,
      });
    }
    
    setPagination(response.pagination || null);
  }, [/* deps including page */]);
  
  const goToPage = useCallback((newPage: number) => {
    if (pagination && newPage >= 1 && newPage <= pagination.totalPages) {
      setPage(newPage);
    }
  }, [pagination]);
  
  const nextPage = useCallback(() => {
    if (pagination?.hasNext) {
      setPage(p => p + 1);
    }
  }, [pagination]);
  
  const prevPage = useCallback(() => {
    if (pagination?.hasPrev) {
      setPage(p => p - 1);
    }
  }, [pagination]);
  
  // Refetch when page changes
  useEffect(() => {
    fetchResults();
  }, [page]);
  
  return {
    // ... existing returns ...
    pagination,
    goToPage,
    nextPage,
    prevPage,
  };
}
```

#### Update UI (`frontend/src/components/OOPResults.tsx`)

```tsx
// Add pagination controls component
function PaginationControls({ 
  pagination, 
  onPageChange 
}: { 
  pagination: Pagination; 
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-4 mt-6">
      <button
        onClick={() => onPageChange(pagination.page - 1)}
        disabled={!pagination.hasPrev}
        className="px-4 py-2 bg-slate-100 rounded-lg disabled:opacity-50"
      >
        Previous
      </button>
      
      <span className="text-sm text-slate-600">
        Page {pagination.page} of {pagination.totalPages}
        <span className="text-slate-400 ml-2">
          ({pagination.total} total results)
        </span>
      </span>
      
      <button
        onClick={() => onPageChange(pagination.page + 1)}
        disabled={!pagination.hasNext}
        className="px-4 py-2 bg-slate-100 rounded-lg disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}

// In OOPResults component:
export function OOPResults({ ... }) {
  const {
    // ... existing ...
    pagination,
    goToPage,
  } = useOOPOptimization({ ... });
  
  return (
    <div>
      {/* ... existing UI ... */}
      
      {pagination && pagination.totalPages > 1 && (
        <PaginationControls 
          pagination={pagination} 
          onPageChange={goToPage} 
        />
      )}
    </div>
  );
}
```

---

## 4. React Error Boundaries

### 4.1 Overview

Add error boundaries to gracefully handle runtime errors in React components without crashing the entire app.

### 4.2 Implementation

#### Create Error Boundary Component (`frontend/src/components/ErrorBoundary.tsx`)

```tsx
'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKeys?: any[];
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    
    // Log to error reporting service
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    // Call optional error handler
    this.props.onError?.(error, errorInfo);
    
    // Could send to error tracking service here
    // e.g., Sentry.captureException(error, { extra: errorInfo });
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state if resetKeys change
    if (this.state.hasError && this.props.resetKeys) {
      const hasChanged = this.props.resetKeys.some(
        (key, idx) => key !== prevProps.resetKeys?.[idx]
      );
      if (hasChanged) {
        this.setState({ hasError: false, error: null, errorInfo: null });
      }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              Something went wrong
            </h2>
            
            <p className="text-slate-600 mb-6">
              We encountered an unexpected error. This has been logged and we'll look into it.
            </p>
            
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-6 text-left p-4 bg-slate-100 rounded-lg">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">
                  Error Details (Dev Only)
                </summary>
                <pre className="mt-2 text-xs text-red-600 overflow-auto">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
              
              <a
                href="/"
                className="flex items-center gap-2 px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
              >
                <Home className="w-4 h-4" />
                Go Home
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
```

#### Create Specialized Error Boundaries

```tsx
// frontend/src/components/OptimizationErrorBoundary.tsx

'use client';

import { ErrorBoundary } from './ErrorBoundary';
import { useRouter } from 'next/navigation';
import { AlertCircle, Settings, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  tripId?: string;
}

export function OptimizationErrorBoundary({ children, tripId }: Props) {
  const router = useRouter();
  
  return (
    <ErrorBoundary
      resetKeys={[tripId]}
      fallback={
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8 text-amber-500" />
            </div>
            
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              Optimization Error
            </h2>
            
            <p className="text-slate-600 mb-6">
              We couldn't display your optimization results. This might be due to 
              incompatible trip settings or a temporary issue.
            </p>
            
            <div className="flex flex-col gap-3">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Page
              </button>
              
              <button
                onClick={() => router.push('/solo/setup')}
                className="flex items-center justify-center gap-2 px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
              >
                <Settings className="w-4 h-4" />
                Adjust Trip Settings
              </button>
            </div>
          </div>
        </div>
      }
      onError={(error, errorInfo) => {
        // Log optimization-specific errors
        console.error('Optimization error:', {
          error: error.message,
          tripId,
          stack: errorInfo.componentStack,
        });
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
```

#### Wrap Pages with Error Boundaries

```tsx
// frontend/src/app/(app)/solo/results/page.tsx

import { OptimizationErrorBoundary } from '@/components/OptimizationErrorBoundary';
import { OOPResults } from '@/components/OOPResults';

export default function SoloResultsPage() {
  const searchParams = useSearchParams();
  const tripId = searchParams.get('trip_id') || '';
  
  return (
    <OptimizationErrorBoundary tripId={tripId}>
      <OOPResults tripId={tripId} />
    </OptimizationErrorBoundary>
  );
}
```

#### Create Global Error Boundary in Layout

```tsx
// frontend/src/app/(app)/layout.tsx

import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation />
      <ErrorBoundary>
        <main className="container mx-auto px-4 py-8">
          {children}
        </main>
      </ErrorBoundary>
      <Footer />
    </div>
  );
}
```

---

## 5. Implementation Timeline

### Phase 1: Group Booking Allocation (4-5 days) ⭐ PRIORITY

| Day | Tasks |
|-----|-------|
| 1 | Create data models (BookingAssignment, MemberBookingCapability, etc.) |
| 2 | Implement GroupBookingAllocator with optimize strategy |
| 3 | Implement by_segment_type and by_direction strategies |
| 4 | Create API endpoints, update group optimization flow |
| 5 | Frontend: BookingAllocationSelector, BookingPlanView components |

### Phase 2: ILP Solver (3-4 days)

| Day | Tasks |
|-----|-------|
| 1 | Install PuLP, create basic solver structure |
| 2 | Implement constraints and objective function |
| 3 | Integrate with orchestrator, add fallback |
| 4 | Testing and optimization |

### Phase 3: Pagination (1-2 days)

| Day | Tasks |
|-----|-------|
| 1 | Backend pagination logic, update API models |
| 2 | Frontend hook updates, pagination UI |

### Phase 4: Error Boundaries (1 day)

| Day | Tasks |
|-----|-------|
| 1 | Create error boundary components, wrap pages |

---

## 6. Testing Strategy

### 6.1 Group Booking Allocation Tests

```python
# Test cases for group booking allocation
def test_flight_hotel_split():
    """Alice books flights, Bob books hotels."""
    members = [
        MemberBookingCapability(member_id="alice", points={"Chase UR": 100000}),
        MemberBookingCapability(member_id="bob", points={"HH": 50000}),
    ]
    strategy = BookingAllocationStrategy(
        strategy_type="by_segment_type",
        flight_booker="alice",
        hotel_booker="bob",
    )
    
    allocator = GroupBookingAllocator()
    plan = allocator.allocate(segments, members, strategy)
    
    # Verify assignments
    flight_assignments = [a for a in plan.assignments if a.segment_type == "flight"]
    hotel_assignments = [a for a in plan.assignments if a.segment_type == "hotel"]
    
    assert all(a.assigned_to == "alice" for a in flight_assignments)
    assert all(a.assigned_to == "bob" for a in hotel_assignments)


def test_direction_split():
    """Alice books outbound, Bob books return."""
    # ... test outbound/return split


def test_settlement_calculation():
    """Verify settlements balance correctly."""
    # If Alice pays $300, Bob pays $100, with 2 people
    # Fair share = $200 each
    # Settlement: Bob owes Alice $100


def test_optimize_uses_best_points():
    """System should assign segment to member with best points."""
    members = [
        MemberBookingCapability(member_id="alice", points={"UA": 100000}),
        MemberBookingCapability(member_id="bob", points={"AA": 100000}),
    ]
    
    # United flight should be assigned to Alice
    # American flight should be assigned to Bob
```

### 6.2 ILP Solver Tests

```python
# Test cases for ILP solver
test_cases = [
    "simple_single_segment",
    "multi_segment_greedy_fails",
    "transfer_required",
    "budget_constraint_binding",
    "infeasible_no_solution",
    "large_scale_performance",
    "group_multi_member",  # NEW: Group ILP with booking allocation
]
```

### 6.3 Pagination Tests

```typescript
// Frontend pagination tests
describe('Pagination', () => {
  it('shows correct page count');
  it('disables prev on first page');
  it('disables next on last page');
  it('fetches new data on page change');
});
```

### 6.4 Error Boundary Tests

```typescript
// Error boundary tests
describe('ErrorBoundary', () => {
  it('renders children when no error');
  it('renders fallback when error thrown');
  it('resets when resetKeys change');
  it('calls onError callback');
});
```

### 6.5 Frontend Allocation UI Tests

```typescript
describe('BookingAllocationSelector', () => {
  it('shows all strategy options');
  it('shows member selectors for by_segment_type');
  it('shows member selectors for by_direction');
  it('calls onStrategyChange when selection changes');
});

describe('BookingPlanView', () => {
  it('displays member summaries correctly');
  it('shows who books each segment');
  it('displays settlements when needed');
  it('shows $0 settlement when costs are equal');
});
```

---

## 7. Files to Create/Modify

### New Files

```
# Group Booking Allocation
backend/src/agents/group_allocator.py          # GroupBookingAllocator class
backend/src/agents/group_models.py             # BookingAssignment, MemberBookingCapability, etc.
backend/tests/test_group_allocator.py          # Allocation tests
frontend/src/components/group/BookingAllocationSelector.tsx
frontend/src/components/group/BookingPlanView.tsx
frontend/src/components/group/MemberBookingCard.tsx
frontend/src/components/group/SettlementList.tsx
frontend/src/types/group-booking.ts            # Frontend types

# ILP Solver
backend/src/agents/ilp_solver.py
backend/src/agents/ilp_models.py
backend/tests/test_ilp_solver.py

# Error Boundaries
frontend/src/components/ErrorBoundary.tsx
frontend/src/components/OptimizationErrorBoundary.tsx
frontend/src/components/PaginationControls.tsx
```

### Modified Files

```
# Backend
backend/requirements.txt              # Add pulp
backend/src/agents/models.py          # Add group booking models
backend/src/agents/orchestrator.py    # Use ILP solver, integrate allocator
backend/src/routes/optimize.py        # Add /group/allocate endpoint, pagination

# Frontend
frontend/src/types/optimization.ts    # Add Pagination, group types
frontend/src/lib/api.ts               # Add allocateGroupBookings() method
frontend/src/lib/hooks/useOOPOptimization.ts  # Add pagination
frontend/src/lib/hooks/useGroupAllocation.ts  # NEW: Hook for allocation
frontend/src/components/OOPResults.tsx  # Add pagination UI
frontend/src/app/(app)/group/results/page.tsx  # Use BookingPlanView
frontend/src/app/(app)/layout.tsx     # Add global error boundary
```

---

## 8. Summary

| Feature | Priority | Duration | Complexity |
|---------|----------|----------|------------|
| **Group Booking Allocation** | ⭐ HIGH | 4-5 days | High |
| ILP Solver | Medium | 3-4 days | High |
| Pagination | Low | 1-2 days | Low |
| Error Boundaries | Low | 1 day | Low |
| **Total** | | **9-12 days** | |

### Key Benefits of Group Booking Allocation

1. **Flexibility**: Members can split responsibilities in ways that work for them
2. **Points Optimization**: Each segment uses the best available points
3. **Fair Settlements**: Clear calculation of who owes whom
4. **Card Benefits**: Leverage each member's credit card perks

---

*Document created: January 25, 2026*
*Updated: January 25, 2026 - Added Group Booking Allocation section*
*Related: `AGENTIC_IMPLEMENTATION_WEAKPOINTS.md`, `AGENTIC_ILP_IMPLEMENTATION_PLAN.md`*
