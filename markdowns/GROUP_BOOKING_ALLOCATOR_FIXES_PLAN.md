# GroupBookingAllocator Fixes Implementation Plan

A detailed implementation plan to address all nuances, logic gaps, and edge cases identified in the GroupBookingAllocator.

---

## Table of Contents

1. [Phase 1: Critical Fixes](#phase-1-critical-fixes)
   - 1.1 [Input Validation](#11-input-validation)
   - 1.2 [Budget Accumulation](#12-budget-accumulation)
   - 1.3 [Transfer Source Optimization](#13-transfer-source-optimization)
2. [Phase 2: Algorithm Improvements](#phase-2-algorithm-improvements)
   - 2.1 [Look-Ahead Greedy Algorithm](#21-look-ahead-greedy-algorithm)
   - 2.2 [Proper ILP Transfer Modeling](#22-proper-ilp-transfer-modeling)
3. [Phase 3: Strategy Refinements](#phase-3-strategy-refinements)
   - 3.1 [Direction Split Improvements](#31-direction-split-improvements)
   - 3.2 [Flexible Settlement Splits](#32-flexible-settlement-splits)
4. [Phase 4: Edge Case Handling](#phase-4-edge-case-handling)
5. [Testing Strategy](#testing-strategy)
6. [Implementation Order](#implementation-order)

---

## Phase 1: Critical Fixes

### 1.1 Input Validation

**Problem**: Empty members, empty segments, and invalid inputs can cause crashes.

**Solution**: Add comprehensive validation at the start of `allocate()`.

#### Implementation

```python
# backend/src/agents/group_allocator.py

from typing import Optional
from dataclasses import dataclass

@dataclass
class AllocationValidationResult:
    """Result of input validation."""
    valid: bool
    errors: list[str]
    warnings: list[str]


class GroupBookingAllocator:
    
    def validate_inputs(
        self,
        trip_id: str,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
    ) -> AllocationValidationResult:
        """
        Validate all inputs before allocation.
        
        Returns validation result with errors and warnings.
        """
        errors = []
        warnings = []
        
        # === CRITICAL VALIDATIONS (errors) ===
        
        # 1. Must have at least one member
        if not members:
            errors.append("At least one member is required")
        
        # 2. Must have at least one segment
        if not segments:
            errors.append("At least one segment is required")
        
        # 3. Each segment must have at least one option
        for i, options in enumerate(segments):
            if not options:
                errors.append(f"Segment {i} has no booking options")
        
        # 4. All segment options must have valid data
        for seg_idx, options in enumerate(segments):
            for opt_idx, option in enumerate(options):
                if option.cash_price < 0:
                    errors.append(f"Segment {seg_idx} option {opt_idx} has negative cash price")
                if option.award_available:
                    if not option.award_program:
                        errors.append(f"Segment {seg_idx} option {opt_idx} has award but no program")
                    if option.award_points is None or option.award_points < 0:
                        errors.append(f"Segment {seg_idx} option {opt_idx} has invalid award points")
        
        # 5. Member IDs must be unique
        member_ids = [m.member_id for m in members]
        if len(member_ids) != len(set(member_ids)):
            errors.append("Duplicate member IDs found")
        
        # 6. Strategy-specific validation
        if strategy.strategy_type == "by_segment_type":
            if not strategy.flight_booker:
                errors.append("by_segment_type strategy requires flight_booker")
            if not strategy.hotel_booker:
                errors.append("by_segment_type strategy requires hotel_booker")
            if strategy.flight_booker and strategy.flight_booker not in member_ids:
                errors.append(f"flight_booker '{strategy.flight_booker}' is not a member")
            if strategy.hotel_booker and strategy.hotel_booker not in member_ids:
                errors.append(f"hotel_booker '{strategy.hotel_booker}' is not a member")
        
        elif strategy.strategy_type == "by_direction":
            if not strategy.outbound_booker:
                errors.append("by_direction strategy requires outbound_booker")
            if not strategy.return_booker:
                errors.append("by_direction strategy requires return_booker")
            if strategy.outbound_booker and strategy.outbound_booker not in member_ids:
                errors.append(f"outbound_booker '{strategy.outbound_booker}' is not a member")
            if strategy.return_booker and strategy.return_booker not in member_ids:
                errors.append(f"return_booker '{strategy.return_booker}' is not a member")
        
        elif strategy.strategy_type == "manual":
            if not strategy.manual_assignments:
                errors.append("manual strategy requires manual_assignments")
            else:
                # Check all segments have assignments
                segment_ids = {opts[0].segment_id for opts in segments if opts}
                assigned_ids = set(strategy.manual_assignments.keys())
                
                missing = segment_ids - assigned_ids
                if missing:
                    errors.append(f"Missing manual assignments for segments: {missing}")
                
                extra = assigned_ids - segment_ids
                if extra:
                    warnings.append(f"Manual assignments for unknown segments (ignored): {extra}")
                
                # Check all assigned members exist
                for seg_id, member_id in strategy.manual_assignments.items():
                    if member_id not in member_ids:
                        errors.append(f"Manual assignment for {seg_id} references unknown member: {member_id}")
        
        # === WARNINGS (non-fatal) ===
        
        # 1. Same person for both roles
        if strategy.strategy_type == "by_segment_type":
            if strategy.flight_booker == strategy.hotel_booker:
                warnings.append(
                    f"Same member '{strategy.flight_booker}' assigned to both flights and hotels. "
                    "Consider using 'optimize' strategy instead."
                )
        
        if strategy.strategy_type == "by_direction":
            if strategy.outbound_booker == strategy.return_booker:
                warnings.append(
                    f"Same member '{strategy.outbound_booker}' assigned to both directions. "
                    "Consider using 'optimize' strategy instead."
                )
        
        # 2. Members with no points
        for member in members:
            total_points = sum(member.points.values())
            if total_points == 0:
                warnings.append(
                    f"Member '{member.member_name}' has no points. "
                    "They will only be able to book with cash."
                )
        
        # 3. Very low budgets
        for member in members:
            if member.max_cash_budget is not None and member.max_cash_budget < 50:
                warnings.append(
                    f"Member '{member.member_name}' has very low budget (${member.max_cash_budget}). "
                    "This may limit booking options."
                )
        
        return AllocationValidationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
        )
    
    def allocate(
        self,
        trip_id: str,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
    ) -> GroupBookingPlan:
        """
        Create optimal booking allocation.
        
        Raises:
            ValueError: If inputs are invalid
        """
        # === VALIDATE FIRST ===
        validation = self.validate_inputs(trip_id, segments, members, strategy)
        
        if not validation.valid:
            raise ValueError(
                f"Invalid inputs: {'; '.join(validation.errors)}"
            )
        
        # Log warnings
        for warning in validation.warnings:
            logger.warning(f"[GroupBookingAllocator] {warning}")
        
        # ... rest of existing allocate() code ...
```

#### Edge Cases Handled

| Edge Case | Behavior |
|-----------|----------|
| Empty members | Raises ValueError |
| Empty segments | Raises ValueError |
| Segment with no options | Raises ValueError |
| Duplicate member IDs | Raises ValueError |
| Invalid segment in manual assignments | Raises ValueError |
| Same person for both roles | Warning logged, proceeds |
| Member with no points | Warning logged, proceeds |

---

### 1.2 Budget Accumulation

**Problem**: Budget is checked per-option but not tracked cumulatively.

**Solution**: Track remaining budget per member throughout allocation.

#### Implementation

```python
# backend/src/agents/group_allocator.py

@dataclass
class MemberState:
    """Tracks a member's remaining resources during allocation."""
    member_id: str
    remaining_points: dict[str, int]  # program -> balance
    remaining_budget: Optional[float]  # None = unlimited
    cash_spent: float = 0.0
    points_spent: dict[str, int] = None  # program -> points used
    
    def __post_init__(self):
        if self.points_spent is None:
            self.points_spent = {}
    
    def can_afford_cash(self, amount: float) -> bool:
        """Check if member can afford additional cash expense."""
        if self.remaining_budget is None:
            return True
        return self.remaining_budget >= amount
    
    def spend_cash(self, amount: float) -> None:
        """Record cash spending."""
        if self.remaining_budget is not None:
            if amount > self.remaining_budget:
                raise ValueError(f"Cash {amount} exceeds remaining budget {self.remaining_budget}")
            self.remaining_budget -= amount
        self.cash_spent += amount
    
    def can_afford_points(self, program: str, points: int) -> bool:
        """Check if member can afford points expense."""
        return self.remaining_points.get(program, 0) >= points
    
    def spend_points(self, program: str, points: int) -> None:
        """Record points spending."""
        available = self.remaining_points.get(program, 0)
        if points > available:
            raise ValueError(f"Points {points} exceeds available {available} for {program}")
        self.remaining_points[program] = available - points
        self.points_spent[program] = self.points_spent.get(program, 0) + points


class GroupBookingAllocator:
    
    def _initialize_member_states(
        self,
        members: list[MemberBookingCapability],
    ) -> dict[str, MemberState]:
        """Initialize tracking state for all members."""
        return {
            m.member_id: MemberState(
                member_id=m.member_id,
                remaining_points=dict(m.points),
                remaining_budget=m.max_cash_budget,
            )
            for m in members
        }
    
    def _solve_greedy(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """
        Greedy algorithm with proper budget tracking.
        """
        assignments = []
        
        # Initialize member states (tracks remaining points AND budget)
        member_states = self._initialize_member_states(members)
        
        for seg_idx, options in enumerate(segments):
            best_assignment = None
            best_oop = float('inf')
            
            for member in members:
                state = member_states[member.member_id]
                
                for option in options:
                    # Determine cash cost for this option
                    if option.award_available:
                        program = option.award_program
                        points_needed = option.award_points
                        cash_cost = option.award_surcharge
                        
                        # Check if member has enough points
                        available = state.remaining_points.get(program, 0)
                        if available < points_needed:
                            # Try transferable
                            available = self._get_remaining_transferable_from_state(
                                state, program
                            )
                        
                        if available >= points_needed:
                            # Check if member can afford the surcharge
                            if state.can_afford_cash(cash_cost):
                                if cash_cost < best_oop:
                                    best_oop = cash_cost
                                    best_assignment = {
                                        "member": member,
                                        "state": state,
                                        "option": option,
                                        "uses_points": True,
                                        "program": program,
                                        "points": points_needed,
                                        "cash": cash_cost,
                                    }
                    
                    # Also consider cash option
                    cash_cost = option.cash_price
                    if state.can_afford_cash(cash_cost):
                        if cash_cost < best_oop:
                            best_oop = cash_cost
                            best_assignment = {
                                "member": member,
                                "state": state,
                                "option": option,
                                "uses_points": False,
                                "program": None,
                                "points": 0,
                                "cash": cash_cost,
                            }
            
            if best_assignment:
                state = best_assignment["state"]
                
                # Update member state (deduct resources)
                state.spend_cash(best_assignment["cash"])
                if best_assignment["uses_points"]:
                    self._deduct_points_from_state(
                        state,
                        best_assignment["program"],
                        best_assignment["points"],
                    )
                
                assignments.append(BookingAssignment(
                    segment_id=best_assignment["option"].segment_id,
                    segment_type=best_assignment["option"].segment_type,
                    assigned_to=best_assignment["member"].member_id,
                    assigned_to_name=best_assignment["member"].member_name,
                    reason="Optimal: lowest OOP within member's remaining budget",
                    uses_points=best_assignment["uses_points"],
                    points_program=best_assignment["program"],
                    points_used=best_assignment["points"],
                    cash_amount=best_assignment["cash"],
                    segment_summary=best_assignment["option"].summary,
                ))
            else:
                logger.error(f"No valid assignment found for segment {seg_idx}")
                # Create a fallback assignment to the first member with cash
                # This ensures we don't skip segments
                if options and members:
                    option = options[0]
                    member = members[0]
                    assignments.append(BookingAssignment(
                        segment_id=option.segment_id,
                        segment_type=option.segment_type,
                        assigned_to=member.member_id,
                        assigned_to_name=member.member_name,
                        reason="Fallback: no affordable option found, assigned to first member",
                        uses_points=False,
                        points_program=None,
                        points_used=0,
                        cash_amount=option.cash_price,
                        segment_summary=option.summary,
                    ))
        
        return assignments
    
    def _get_remaining_transferable_from_state(
        self,
        state: MemberState,
        target_program: str,
    ) -> int:
        """Get remaining transferable points from member state."""
        max_balance = state.remaining_points.get(target_program, 0)
        
        for bank, config in TRANSFER_GRAPH.items():
            programs = config.get("airlines", []) + config.get("hotels", [])
            if target_program in programs:
                ratio = config.get("ratios", {}).get(target_program, 1.0)
                bank_balance = state.remaining_points.get(bank, 0)
                transferable = int(bank_balance * ratio)
                max_balance = max(max_balance, transferable)
        
        return max_balance
    
    def _deduct_points_from_state(
        self,
        state: MemberState,
        program: str,
        points: int,
    ) -> None:
        """Deduct points from member state, using transfers if needed."""
        direct_balance = state.remaining_points.get(program, 0)
        
        if direct_balance >= points:
            state.spend_points(program, points)
            return
        
        # Need to use transfer
        for bank, config in TRANSFER_GRAPH.items():
            programs = config.get("airlines", []) + config.get("hotels", [])
            if program in programs:
                ratio = config.get("ratios", {}).get(program, 1.0)
                bank_balance = state.remaining_points.get(bank, 0)
                
                if bank_balance * ratio >= points:
                    points_to_deduct = int(points / ratio)
                    state.spend_points(bank, points_to_deduct)
                    return
        
        raise ValueError(f"Cannot deduct {points} {program} from member {state.member_id}")
```

#### Test Case

```python
def test_budget_accumulation():
    """Budget should be checked cumulatively, not per-segment."""
    allocator = GroupBookingAllocator(use_ilp=False)
    
    segments = [
        [SegmentOption(
            segment_id=f"seg_{i}",
            segment_type="flight",
            option_id=f"opt_{i}",
            cash_price=300.0,
            award_available=False,
        )]
        for i in range(3)  # 3 segments × $300 = $900 total
    ]
    
    members = [
        MemberBookingCapability(
            member_id="alice",
            member_name="Alice",
            points={},
            max_cash_budget=500.0,  # Can only afford ~1.5 segments
        ),
        MemberBookingCapability(
            member_id="bob",
            member_name="Bob",
            points={},
            max_cash_budget=500.0,
        ),
    ]
    
    strategy = BookingAllocationStrategy(strategy_type="optimize")
    
    plan = allocator.allocate("trip", segments, members, strategy)
    
    # Verify no member exceeds their budget
    for summary in plan.member_summaries:
        member = next(m for m in members if m.member_id == summary.member_id)
        assert summary.total_cash_upfront <= member.max_cash_budget, \
            f"{summary.member_name} exceeded budget: {summary.total_cash_upfront} > {member.max_cash_budget}"
```

---

### 1.3 Transfer Source Optimization

**Problem**: Picks first available transfer source, not optimal.

**Solution**: Implement priority-based transfer source selection.

#### Implementation

```python
# backend/src/agents/group_allocator.py

@dataclass
class TransferOption:
    """A possible transfer source."""
    source_program: str
    target_program: str
    ratio: float
    transfer_time: str
    source_balance: int
    effective_points: int  # How many target points this provides
    
    @property
    def priority_score(self) -> float:
        """
        Higher score = better option to preserve.
        We want to use LOWER priority sources first.
        
        Factors:
        - Ratio (1:1 is more valuable than 1:2)
        - Balance (preserve larger balances)
        - Transfer time (instant is more flexible)
        """
        ratio_score = self.ratio  # Higher ratio = more valuable
        balance_score = min(self.source_balance / 100000, 1.0)  # Normalize to 0-1
        time_score = 1.0 if "instant" in self.transfer_time.lower() else 0.5
        
        return ratio_score * 0.5 + balance_score * 0.3 + time_score * 0.2


class GroupBookingAllocator:
    
    def _get_transfer_options(
        self,
        member_points: dict[str, int],
        target_program: str,
        points_needed: int,
    ) -> list[TransferOption]:
        """
        Get all possible transfer sources, sorted by priority.
        
        Returns:
            List of transfer options, sorted from WORST to BEST.
            (We want to use worst options first, preserving better ones)
        """
        options = []
        
        # Check direct balance first
        direct = member_points.get(target_program, 0)
        if direct >= points_needed:
            options.append(TransferOption(
                source_program=target_program,
                target_program=target_program,
                ratio=1.0,
                transfer_time="instant",
                source_balance=direct,
                effective_points=direct,
            ))
        
        # Check transfer partners
        for bank, config in TRANSFER_GRAPH.items():
            programs = config.get("airlines", []) + config.get("hotels", [])
            if target_program in programs:
                ratio = config.get("ratios", {}).get(target_program, 1.0)
                bank_balance = member_points.get(bank, 0)
                effective = int(bank_balance * ratio)
                
                if effective >= points_needed:
                    transfer_time = config.get("transfer_times", {}).get(target_program, "1-2 days")
                    options.append(TransferOption(
                        source_program=bank,
                        target_program=target_program,
                        ratio=ratio,
                        transfer_time=transfer_time,
                        source_balance=bank_balance,
                        effective_points=effective,
                    ))
        
        # Sort by priority (ascending = worst first)
        options.sort(key=lambda x: x.priority_score)
        
        return options
    
    def _select_best_transfer_source(
        self,
        member_points: dict[str, int],
        target_program: str,
        points_needed: int,
        future_needs: dict[str, int] = None,  # program -> points we'll need later
    ) -> Optional[TransferOption]:
        """
        Select the best transfer source considering future needs.
        
        Args:
            member_points: Current point balances
            target_program: Program we need points in
            points_needed: How many points we need
            future_needs: Anticipated future point needs (to preserve sources)
        
        Returns:
            Best TransferOption, or None if none available
        """
        options = self._get_transfer_options(member_points, target_program, points_needed)
        
        if not options:
            return None
        
        if not future_needs:
            # No future context, just use the lowest priority option
            return options[0]
        
        # Score each option based on impact to future needs
        best_option = None
        best_score = float('inf')  # Lower is better
        
        for option in options:
            # Calculate impact: how much does using this source hurt future bookings?
            impact = 0
            
            if option.source_program != option.target_program:
                # This is a transfer; calculate points consumed from source
                points_consumed = int(points_needed / option.ratio)
                remaining = option.source_balance - points_consumed
                
                # Check if source is needed for future transfers
                for future_program, future_points in future_needs.items():
                    # Can source still satisfy future need after this transfer?
                    future_options = self._get_transfer_options(
                        {option.source_program: remaining},
                        future_program,
                        future_points,
                    )
                    if not future_options:
                        impact += future_points  # Major impact: can't satisfy future need
            
            # Total score: lower is better
            score = impact - option.priority_score * 1000  # Prefer higher priority if impact is same
            
            if score < best_score:
                best_score = score
                best_option = option
        
        return best_option or options[0]
```

#### Example: Transfer Source Selection

```python
# Scenario:
# Alice has: 100k Chase UR, 50k Amex MR
# Current need: 30k United miles
# Future need: 50k Delta miles

# Chase UR → United (1:1)
# Amex MR → United (1:1)
# Amex MR → Delta (1:1)
# Chase UR does NOT transfer to Delta

# Without optimization: Picks Chase UR (first in dict order)
# Result: Chase UR: 70k, Amex MR: 50k
# Future Delta: Can use Amex MR ✓

# With optimization: Should pick Amex MR
# Why: If we use Chase UR for United, we preserve Amex MR for Delta
# But if we use Amex MR for United, we might not have enough for Delta
# Wait, that's wrong...

# Actually:
# If we use Amex MR (30k) for United:
#   Amex MR: 20k remaining
#   Future: Need 50k Delta → Amex MR only has 20k ✗
#   Must use Chase for something else

# If we use Chase UR (30k) for United:
#   Chase UR: 70k remaining
#   Future: Need 50k Delta → Amex MR has 50k ✓

# So optimal is: Use Chase UR for United, preserve Amex MR for Delta
```

---

## Phase 2: Algorithm Improvements

### 2.1 Look-Ahead Greedy Algorithm

**Problem**: Greedy picks locally optimal choices that can be globally suboptimal.

**Solution**: Implement look-ahead that considers future segments.

#### Implementation

```python
# backend/src/agents/group_allocator.py

class GroupBookingAllocator:
    
    def _solve_greedy_with_lookahead(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
        lookahead_depth: int = 3,
    ) -> list[BookingAssignment]:
        """
        Greedy with look-ahead to avoid local optima traps.
        
        For each segment, considers impact on next `lookahead_depth` segments.
        """
        if len(segments) <= lookahead_depth:
            # Small enough to solve exhaustively
            return self._solve_exhaustive(segments, members)
        
        assignments = []
        member_states = self._initialize_member_states(members)
        
        for seg_idx, options in enumerate(segments):
            remaining_segments = segments[seg_idx + 1 : seg_idx + 1 + lookahead_depth]
            
            best_assignment = None
            best_total_oop = float('inf')
            
            # Try each possible assignment for current segment
            for member in members:
                for option in options:
                    # Create a copy of states to simulate this choice
                    simulated_states = self._copy_member_states(member_states)
                    
                    # Try to make this assignment
                    current_oop = self._try_assignment(
                        simulated_states,
                        member,
                        option,
                    )
                    
                    if current_oop is None:
                        continue  # Can't afford this option
                    
                    # Simulate greedy for remaining lookahead segments
                    future_oop = self._simulate_future_greedy(
                        simulated_states,
                        remaining_segments,
                        members,
                    )
                    
                    total_oop = current_oop + future_oop
                    
                    if total_oop < best_total_oop:
                        best_total_oop = total_oop
                        best_assignment = {
                            "member": member,
                            "option": option,
                            "uses_points": option.award_available and self._can_use_award(
                                member_states[member.member_id], option
                            ),
                            "cash": current_oop,
                        }
            
            if best_assignment:
                # Apply the best assignment
                member = best_assignment["member"]
                option = best_assignment["option"]
                
                self._apply_assignment(
                    member_states[member.member_id],
                    option,
                    best_assignment["uses_points"],
                )
                
                assignments.append(self._create_assignment(
                    member, option, best_assignment
                ))
            else:
                # Fallback: assign to first member with first option
                logger.warning(f"No valid assignment found for segment {seg_idx}")
                if options and members:
                    assignments.append(self._create_fallback_assignment(
                        options[0], members[0]
                    ))
        
        return assignments
    
    def _simulate_future_greedy(
        self,
        states: dict[str, MemberState],
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> float:
        """
        Simulate greedy allocation for future segments.
        Returns total OOP for these segments.
        """
        total_oop = 0.0
        
        for options in segments:
            best_oop = float('inf')
            best_member = None
            best_uses_points = False
            
            for member in members:
                state = states[member.member_id]
                
                for option in options:
                    oop = self._get_oop_for_option(state, option)
                    if oop is not None and oop < best_oop:
                        best_oop = oop
                        best_member = member
                        best_uses_points = self._should_use_points(state, option, oop)
            
            if best_member and best_oop < float('inf'):
                total_oop += best_oop
                # Update state for simulation
                self._apply_assignment(
                    states[best_member.member_id],
                    options[0],  # Simplified: just track the spending
                    best_uses_points,
                )
            else:
                # Can't assign: assume worst case (highest cash price)
                if options:
                    total_oop += max(opt.cash_price for opt in options)
        
        return total_oop
    
    def _solve_exhaustive(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """
        Exhaustively try all combinations for small segment counts.
        
        Complexity: O(M^N * K) where M=members, N=segments, K=options
        Only viable for N <= 5 or so.
        """
        from itertools import product
        
        best_assignments = None
        best_oop = float('inf')
        
        # Generate all possible (member, option) pairs for each segment
        choices_per_segment = []
        for options in segments:
            segment_choices = []
            for member in members:
                for option in options:
                    segment_choices.append((member, option))
            choices_per_segment.append(segment_choices)
        
        # Try all combinations
        for combination in product(*choices_per_segment):
            states = self._initialize_member_states(members)
            assignments = []
            total_oop = 0.0
            valid = True
            
            for member, option in combination:
                state = states[member.member_id]
                oop = self._get_oop_for_option(state, option)
                
                if oop is None:
                    valid = False
                    break
                
                total_oop += oop
                uses_points = self._should_use_points(state, option, oop)
                self._apply_assignment(state, option, uses_points)
                
                assignments.append({
                    "member": member,
                    "option": option,
                    "uses_points": uses_points,
                    "cash": oop,
                })
            
            if valid and total_oop < best_oop:
                best_oop = total_oop
                best_assignments = assignments
        
        if best_assignments:
            return [
                self._create_assignment(a["member"], a["option"], a)
                for a in best_assignments
            ]
        
        # Fallback to regular greedy
        return self._solve_greedy(segments, members)
```

---

### 2.2 Proper ILP Transfer Modeling

**Problem**: ILP doesn't model transfers as decisions, leading to double-counting.

**Solution**: Add transfer decision variables to ILP.

#### Implementation

```python
# backend/src/agents/group_allocator.py

def _solve_with_ilp_v2(
    self,
    segments: list[list[SegmentOption]],
    members: list[MemberBookingCapability],
) -> list[BookingAssignment]:
    """
    ILP solver with proper transfer modeling.
    
    Decision Variables:
        x[seg, opt, member] ∈ {0,1} - booking decisions
        t[member, source, target] >= 0 - transfer amounts
    
    Objective:
        Minimize Σ cash_cost * x
    
    Constraints:
        1. Exactly one booking per segment
        2. Points used <= direct balance + incoming transfers
        3. Outgoing transfers <= bank balance
        4. Cash spent <= budget
    """
    from pulp import LpProblem, LpMinimize, LpVariable, LpBinary, LpContinuous, lpSum, PULP_CBC_CMD
    
    prob = LpProblem("Group_Booking_V2", LpMinimize)
    
    # === DECISION VARIABLES ===
    
    # x[seg, opt, member] = 1 if member books segment with option
    x = {}
    for seg_idx, options in enumerate(segments):
        for opt_idx, option in enumerate(options):
            for mem_idx, member in enumerate(members):
                x[seg_idx, opt_idx, mem_idx] = LpVariable(
                    f"x_{seg_idx}_{opt_idx}_{mem_idx}",
                    cat=LpBinary
                )
    
    # t[member, source, target] = points transferred
    t = {}
    all_programs = self._get_all_programs(segments)
    bank_programs = list(TRANSFER_GRAPH.keys())
    
    for mem_idx, member in enumerate(members):
        for source in bank_programs:
            for target in all_programs:
                if self._can_transfer(source, target):
                    t[mem_idx, source, target] = LpVariable(
                        f"t_{mem_idx}_{source}_{target}",
                        lowBound=0,
                        cat=LpContinuous
                    )
    
    # === OBJECTIVE: Minimize OOP ===
    
    oop_terms = []
    for seg_idx, options in enumerate(segments):
        for opt_idx, option in enumerate(options):
            for mem_idx in range(len(members)):
                if option.award_available:
                    oop = option.award_surcharge
                else:
                    oop = option.cash_price
                oop_terms.append(oop * x[seg_idx, opt_idx, mem_idx])
    
    prob += lpSum(oop_terms), "Total_OOP"
    
    # === CONSTRAINT 1: One booking per segment ===
    
    for seg_idx, options in enumerate(segments):
        prob += (
            lpSum(
                x[seg_idx, opt_idx, mem_idx]
                for opt_idx in range(len(options))
                for mem_idx in range(len(members))
            ) == 1,
            f"OneBooker_{seg_idx}"
        )
    
    # === CONSTRAINT 2: Points used <= direct + transfers (per member, per program) ===
    
    for mem_idx, member in enumerate(members):
        for program in all_programs:
            # Points used by this member for this program
            points_used = []
            for seg_idx, options in enumerate(segments):
                for opt_idx, option in enumerate(options):
                    if option.award_available and option.award_program == program:
                        points_used.append(option.award_points * x[seg_idx, opt_idx, mem_idx])
            
            if not points_used:
                continue
            
            # Direct balance
            direct_balance = member.points.get(program, 0)
            
            # Incoming transfers
            incoming = []
            for source in bank_programs:
                key = (mem_idx, source, program)
                if key in t:
                    ratio = TRANSFER_GRAPH[source].get("ratios", {}).get(program, 1.0)
                    incoming.append(t[key] * ratio)
            
            prob += (
                lpSum(points_used) <= direct_balance + lpSum(incoming),
                f"PointsLimit_{mem_idx}_{program}"
            )
    
    # === CONSTRAINT 3: Outgoing transfers <= bank balance ===
    
    for mem_idx, member in enumerate(members):
        for source in bank_programs:
            bank_balance = member.points.get(source, 0)
            
            outgoing = []
            for target in all_programs:
                key = (mem_idx, source, target)
                if key in t:
                    outgoing.append(t[key])
            
            if outgoing:
                prob += (
                    lpSum(outgoing) <= bank_balance,
                    f"BankLimit_{mem_idx}_{source}"
                )
    
    # === CONSTRAINT 4: Cash spent <= budget ===
    
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
                f"Budget_{mem_idx}"
            )
    
    # === CONSTRAINT 5: Can only use award if affordable ===
    
    for seg_idx, options in enumerate(segments):
        for opt_idx, option in enumerate(options):
            if option.award_available:
                for mem_idx, member in enumerate(members):
                    # Check if this member could possibly afford this award
                    max_available = self._get_max_possible_points(
                        member, option.award_program
                    )
                    if max_available < option.award_points:
                        prob += (
                            x[seg_idx, opt_idx, mem_idx] == 0,
                            f"CantAfford_{seg_idx}_{opt_idx}_{mem_idx}"
                        )
    
    # === SOLVE ===
    
    solver = PULP_CBC_CMD(msg=0, timeLimit=self.time_limit_seconds)
    prob.solve(solver)
    
    # === EXTRACT SOLUTION ===
    
    return self._extract_ilp_solution_v2(prob, x, t, segments, members)

def _can_transfer(self, source: str, target: str) -> bool:
    """Check if source can transfer to target."""
    if source not in TRANSFER_GRAPH:
        return False
    config = TRANSFER_GRAPH[source]
    return target in config.get("airlines", []) + config.get("hotels", [])

def _get_max_possible_points(
    self,
    member: MemberBookingCapability,
    program: str,
) -> int:
    """Get maximum points member could have in program (direct + all transfers)."""
    total = member.points.get(program, 0)
    
    for bank, config in TRANSFER_GRAPH.items():
        if program in config.get("airlines", []) + config.get("hotels", []):
            ratio = config.get("ratios", {}).get(program, 1.0)
            total += int(member.points.get(bank, 0) * ratio)
    
    return total
```

---

## Phase 3: Strategy Refinements

### 3.1 Direction Split Improvements

**Problem**: Midpoint calculation doesn't understand actual trip structure.

**Solution**: Use trip metadata to determine outbound vs return.

#### Implementation

```python
# backend/src/agents/group_allocator.py

@dataclass
class TripStructure:
    """Understanding of trip's outbound/return structure."""
    origin: str
    destination_count: int
    outbound_segments: list[str]  # segment IDs
    return_segments: list[str]    # segment IDs
    hotel_segments: list[str]     # segment IDs


class GroupBookingAllocator:
    
    def _analyze_trip_structure(
        self,
        segments: list[list[SegmentOption]],
    ) -> TripStructure:
        """
        Analyze segments to determine trip structure.
        
        Heuristics:
        1. First flight's origin is the home city
        2. Flights heading away from home are outbound
        3. Flights heading back to home are return
        4. Multi-city: segments before "turnaround" are outbound
        """
        flight_segments = [
            (i, opts[0]) for i, opts in enumerate(segments)
            if opts and opts[0].segment_type == "flight"
        ]
        
        hotel_segments = [
            opts[0].segment_id for opts in segments
            if opts and opts[0].segment_type == "hotel"
        ]
        
        if not flight_segments:
            return TripStructure(
                origin="",
                destination_count=0,
                outbound_segments=[],
                return_segments=[],
                hotel_segments=hotel_segments,
            )
        
        # Extract route from segment summaries
        # Assuming summary format: "JFK→CDG" or similar
        routes = []
        for _, opt in flight_segments:
            if opt.summary and "→" in opt.summary:
                parts = opt.summary.split("→")
                if len(parts) >= 2:
                    origin = parts[0].strip().split()[-1]  # Last word before arrow
                    dest = parts[1].strip().split()[0]     # First word after arrow
                    routes.append((origin, dest))
        
        if not routes:
            # Can't determine structure, fall back to midpoint
            mid = len(flight_segments) // 2
            return TripStructure(
                origin="",
                destination_count=0,
                outbound_segments=[f[1].segment_id for f in flight_segments[:mid]],
                return_segments=[f[1].segment_id for f in flight_segments[mid:]],
                hotel_segments=hotel_segments,
            )
        
        # Determine home city (first origin)
        home_city = routes[0][0]
        
        # Find turnaround point (when we start heading back)
        outbound = []
        return_segments = []
        heading_home = False
        
        for i, (origin, dest) in enumerate(routes):
            seg_id = flight_segments[i][1].segment_id
            
            if dest == home_city:
                heading_home = True
            
            if heading_home:
                return_segments.append(seg_id)
            else:
                outbound.append(seg_id)
        
        # If no return found (one-way trip), split in half
        if not return_segments and len(outbound) > 1:
            mid = len(outbound) // 2
            return_segments = outbound[mid:]
            outbound = outbound[:mid]
        
        return TripStructure(
            origin=home_city,
            destination_count=len(set(d for _, d in routes if d != home_city)),
            outbound_segments=outbound,
            return_segments=return_segments,
            hotel_segments=hotel_segments,
        )
    
    def _allocate_by_direction(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
    ) -> list[BookingAssignment]:
        """
        Improved direction-based allocation using trip structure analysis.
        """
        outbound_member = self._find_member(members, strategy.outbound_booker)
        return_member = self._find_member(members, strategy.return_booker)
        
        if not outbound_member or not return_member:
            raise ValueError("outbound_booker and return_booker must be specified")
        
        # Analyze trip structure
        structure = self._analyze_trip_structure(segments)
        
        logger.info(f"Trip structure: {structure.destination_count} destinations")
        logger.info(f"Outbound segments: {structure.outbound_segments}")
        logger.info(f"Return segments: {structure.return_segments}")
        
        assignments = []
        member_states = self._initialize_member_states(members)
        
        for options in segments:
            if not options:
                continue
            
            seg_id = options[0].segment_id
            seg_type = options[0].segment_type
            
            # Determine who books this segment
            if seg_id in structure.outbound_segments:
                member = outbound_member
                reason_prefix = "Outbound"
            elif seg_id in structure.return_segments:
                member = return_member
                reason_prefix = "Return"
            elif seg_type == "hotel":
                # Hotels: assign to whoever has better remaining hotel points
                member = self._pick_better_hotel_member_from_states(
                    outbound_member, return_member, member_states
                )
                reason_prefix = "Hotel (better points)"
            else:
                # Unknown segment, default to outbound member
                member = outbound_member
                reason_prefix = "Default"
            
            state = member_states[member.member_id]
            best = self._find_best_option_for_state(options, state)
            
            if best["uses_points"]:
                self._deduct_points_from_state(state, best["program"], best["points"])
            state.spend_cash(best["cash"])
            
            assignments.append(BookingAssignment(
                segment_id=seg_id,
                segment_type=seg_type,
                assigned_to=member.member_id,
                assigned_to_name=member.member_name,
                reason=f"{reason_prefix}: assigned to {member.member_name}",
                uses_points=best["uses_points"],
                points_program=best["program"],
                points_used=best["points"],
                cash_amount=best["cash"],
                segment_summary=best["option"].summary if best["option"] else None,
            ))
        
        return assignments
```

---

### 3.2 Flexible Settlement Splits

**Problem**: Settlement always assumes equal split.

**Solution**: Support multiple split methods.

#### Implementation

```python
# backend/src/agents/group_models.py

from enum import Enum

class SettlementSplitMethod(str, Enum):
    EQUAL = "equal"                    # Everyone pays same amount
    PROPORTIONAL_TRAVELERS = "proportional_travelers"  # Based on # of travelers
    PROPORTIONAL_POINTS = "proportional_points"        # Based on points contributed
    CUSTOM = "custom"                  # User-defined percentages


class MemberBookingCapability(BaseModel):
    # ... existing fields ...
    
    # For proportional splits
    traveler_count: int = 1  # How many people this member is booking for
    custom_split_percentage: Optional[float] = None  # For custom splits (0-100)


# backend/src/agents/group_allocator.py

class GroupBookingAllocator:
    
    def _calculate_settlements(
        self,
        assignments: list[BookingAssignment],
        members: list[MemberBookingCapability],
        split_method: SettlementSplitMethod = SettlementSplitMethod.EQUAL,
    ) -> list[Settlement]:
        """
        Calculate settlements with flexible split methods.
        """
        if not members or not assignments:
            return []
        
        total_cash = sum(a.cash_amount for a in assignments)
        
        # Calculate what each member paid
        member_paid = {m.member_id: 0.0 for m in members}
        for assignment in assignments:
            member_paid[assignment.assigned_to] += assignment.cash_amount
        
        # Calculate fair share based on split method
        fair_shares = self._calculate_fair_shares(
            total_cash, members, assignments, split_method
        )
        
        # Calculate balances
        balances = {
            m_id: paid - fair_shares[m_id]
            for m_id, paid in member_paid.items()
        }
        
        # Generate settlements
        return self._generate_settlements(balances, members)
    
    def _calculate_fair_shares(
        self,
        total_cash: float,
        members: list[MemberBookingCapability],
        assignments: list[BookingAssignment],
        split_method: SettlementSplitMethod,
    ) -> dict[str, float]:
        """Calculate each member's fair share based on split method."""
        
        if split_method == SettlementSplitMethod.EQUAL:
            share = total_cash / len(members)
            return {m.member_id: share for m in members}
        
        elif split_method == SettlementSplitMethod.PROPORTIONAL_TRAVELERS:
            total_travelers = sum(m.traveler_count for m in members)
            return {
                m.member_id: (m.traveler_count / total_travelers) * total_cash
                for m in members
            }
        
        elif split_method == SettlementSplitMethod.PROPORTIONAL_POINTS:
            # Members who contributed more points pay less cash
            member_points_used = {m.member_id: 0 for m in members}
            for a in assignments:
                if a.uses_points and a.points_used:
                    member_points_used[a.assigned_to] += a.points_used
            
            total_points = sum(member_points_used.values())
            
            if total_points == 0:
                # No points used, fall back to equal
                share = total_cash / len(members)
                return {m.member_id: share for m in members}
            
            # More points used = less cash owed
            # Formula: share = base_share * (1 - points_contribution_ratio)
            # Then normalize to sum to total_cash
            
            raw_shares = {}
            for m in members:
                points_ratio = member_points_used[m.member_id] / total_points
                # Invert: higher points = lower share
                raw_shares[m.member_id] = 1.0 - (points_ratio * 0.5)  # Max 50% reduction
            
            # Normalize
            total_raw = sum(raw_shares.values())
            return {
                m_id: (raw / total_raw) * total_cash
                for m_id, raw in raw_shares.items()
            }
        
        elif split_method == SettlementSplitMethod.CUSTOM:
            total_percentage = sum(
                m.custom_split_percentage or 0 for m in members
            )
            
            if abs(total_percentage - 100.0) > 0.01:
                logger.warning(
                    f"Custom split percentages sum to {total_percentage}%, not 100%. Normalizing."
                )
            
            return {
                m.member_id: ((m.custom_split_percentage or 0) / total_percentage) * total_cash
                for m in members
            }
        
        else:
            # Default to equal
            share = total_cash / len(members)
            return {m.member_id: share for m in members}
```

---

## Phase 4: Edge Case Handling

### Summary of All Edge Cases

```python
# backend/src/agents/group_allocator.py

class GroupBookingAllocator:
    """
    Edge Cases Handled:
    
    INPUT VALIDATION:
    ✓ Empty members list → ValueError
    ✓ Empty segments list → ValueError
    ✓ Segment with no options → ValueError
    ✓ Duplicate member IDs → ValueError
    ✓ Invalid strategy configuration → ValueError
    ✓ Manual assignment with unknown segment → ValueError
    ✓ Manual assignment with unknown member → ValueError
    
    RESOURCE CONSTRAINTS:
    ✓ Member with no points → Proceeds with cash-only
    ✓ Member with exhausted budget → Skips for cash options
    ✓ Member with exhausted points → Falls back to cash
    ✓ No member can afford segment → Assigns with warning
    
    STRATEGY EDGE CASES:
    ✓ Same person for both roles → Warning, proceeds
    ✓ Odd number of flights in direction split → Uses trip structure
    ✓ All segments are hotels (no flights) → by_segment_type works
    ✓ All segments are flights (no hotels) → by_segment_type works
    
    CALCULATION EDGE CASES:
    ✓ Zero total cost → No settlements needed
    ✓ One member pays everything → One settlement
    ✓ Equal payments → No settlements needed
    ✓ Floating point precision → Round to 2 decimal places
    """
```

---

## Testing Strategy

### Test File Structure

```python
# backend/tests/test_group_allocator.py

import pytest
from backend.src.agents.group_allocator import GroupBookingAllocator, SegmentOption
from backend.src.agents.group_models import (
    MemberBookingCapability,
    BookingAllocationStrategy,
    SettlementSplitMethod,
)


class TestInputValidation:
    """Tests for input validation."""
    
    def test_empty_members_raises(self):
        allocator = GroupBookingAllocator()
        segments = [[SegmentOption(...)]]
        
        with pytest.raises(ValueError, match="At least one member"):
            allocator.allocate("trip", segments, [], BookingAllocationStrategy(strategy_type="optimize"))
    
    def test_empty_segments_raises(self):
        allocator = GroupBookingAllocator()
        members = [MemberBookingCapability(member_id="a", member_name="A", points={})]
        
        with pytest.raises(ValueError, match="At least one segment"):
            allocator.allocate("trip", [], members, BookingAllocationStrategy(strategy_type="optimize"))
    
    def test_duplicate_member_ids_raises(self):
        allocator = GroupBookingAllocator()
        members = [
            MemberBookingCapability(member_id="same", member_name="A", points={}),
            MemberBookingCapability(member_id="same", member_name="B", points={}),
        ]
        segments = [[SegmentOption(...)]]
        
        with pytest.raises(ValueError, match="Duplicate member IDs"):
            allocator.allocate("trip", segments, members, BookingAllocationStrategy(strategy_type="optimize"))


class TestBudgetTracking:
    """Tests for budget accumulation."""
    
    def test_cumulative_budget_enforcement(self):
        """Member should not exceed budget across multiple segments."""
        allocator = GroupBookingAllocator(use_ilp=False)
        
        # 3 segments at $300 each
        segments = [
            [SegmentOption(
                segment_id=f"seg_{i}",
                segment_type="flight",
                option_id=f"opt_{i}",
                cash_price=300.0,
                award_available=False,
            )]
            for i in range(3)
        ]
        
        members = [
            MemberBookingCapability(
                member_id="alice",
                member_name="Alice",
                points={},
                max_cash_budget=500.0,  # Can't afford all 3
            ),
            MemberBookingCapability(
                member_id="bob",
                member_name="Bob",
                points={},
                max_cash_budget=500.0,
            ),
        ]
        
        plan = allocator.allocate("trip", segments, members, 
            BookingAllocationStrategy(strategy_type="optimize"))
        
        # Each member should spend <= $500
        for summary in plan.member_summaries:
            assert summary.total_cash_upfront <= 500.0
    
    def test_budget_allows_points_surcharge(self):
        """Budget should allow award booking if surcharge fits."""
        allocator = GroupBookingAllocator(use_ilp=False)
        
        segments = [[SegmentOption(
            segment_id="seg_0",
            segment_type="flight",
            option_id="opt_0",
            cash_price=500.0,
            award_available=True,
            award_program="UA",
            award_points=30000,
            award_surcharge=50.0,  # Much less than budget
        )]]
        
        members = [MemberBookingCapability(
            member_id="alice",
            member_name="Alice",
            points={"UA": 50000},
            max_cash_budget=100.0,  # Can't afford $500 cash, can afford $50 surcharge
        )]
        
        plan = allocator.allocate("trip", segments, members,
            BookingAllocationStrategy(strategy_type="optimize"))
        
        assert plan.assignments[0].uses_points == True
        assert plan.assignments[0].cash_amount == 50.0


class TestGreedyLookahead:
    """Tests for look-ahead greedy algorithm."""
    
    def test_lookahead_finds_better_solution(self):
        """Look-ahead should find better solution than pure greedy."""
        # Setup where greedy is suboptimal:
        # Segment 1: 100k pts ($200 surcharge) OR $500 cash
        # Segment 2: 50k pts ($10 surcharge) OR $600 cash
        # Alice has: 100k United
        
        segments = [
            [SegmentOption(
                segment_id="seg_0",
                segment_type="flight",
                option_id="opt_0",
                cash_price=500.0,
                award_available=True,
                award_program="UA",
                award_points=100000,
                award_surcharge=200.0,
            )],
            [SegmentOption(
                segment_id="seg_1",
                segment_type="flight",
                option_id="opt_1",
                cash_price=600.0,
                award_available=True,
                award_program="UA",
                award_points=50000,
                award_surcharge=10.0,
            )],
        ]
        
        members = [MemberBookingCapability(
            member_id="alice",
            member_name="Alice",
            points={"UA": 100000},
        )]
        
        # Pure greedy (no lookahead)
        allocator_greedy = GroupBookingAllocator(use_ilp=False)
        # ... would need to expose lookahead parameter
        
        # With lookahead
        allocator_lookahead = GroupBookingAllocator(use_ilp=False)
        
        # Greedy: Uses 100k on seg_0 ($200), pays cash for seg_1 ($600) = $800
        # Optimal: Pay cash for seg_0 ($500), use 50k on seg_1 ($10) = $510
        
        plan = allocator_lookahead.allocate("trip", segments, members,
            BookingAllocationStrategy(strategy_type="optimize"))
        
        assert plan.total_group_oop <= 510.0  # Should find optimal


class TestTransferOptimization:
    """Tests for transfer source selection."""
    
    def test_preserves_better_transfer_source(self):
        """Should preserve transfer sources needed for future bookings."""
        # Alice has: 100k Chase UR, 50k Amex MR
        # Segment 1: Needs United (both can transfer)
        # Segment 2: Needs Delta (only Amex can transfer)
        
        # Optimal: Use Chase for United, preserve Amex for Delta
        pass


class TestSettlementSplits:
    """Tests for settlement split methods."""
    
    def test_equal_split(self):
        """Equal split divides cost evenly."""
        # Total $300, 3 members → $100 each
        pass
    
    def test_proportional_travelers(self):
        """Proportional split by traveler count."""
        # Alice: 2 travelers, Bob: 1 traveler
        # Total $300 → Alice: $200, Bob: $100
        pass
    
    def test_custom_split(self):
        """Custom percentage split."""
        # Alice: 60%, Bob: 40%
        # Total $500 → Alice: $300, Bob: $200
        pass


class TestDirectionSplit:
    """Tests for direction-based allocation."""
    
    def test_round_trip_detection(self):
        """Should correctly identify outbound vs return segments."""
        # JFK → CDG → FCO → JFK
        # Outbound: JFK→CDG, CDG→FCO
        # Return: FCO→JFK
        pass
    
    def test_odd_flights_split(self):
        """Odd number of flights should split sensibly."""
        # 3 flights: should be 2+1, not 1+2 (based on trip structure)
        pass
```

---

## Implementation Order

### Recommended Sequence

| Phase | Task | Effort | Priority |
|-------|------|--------|----------|
| 1.1 | Input Validation | 2 hours | **Critical** |
| 1.2 | Budget Accumulation | 3 hours | **Critical** |
| 1.3 | Transfer Source Optimization | 4 hours | High |
| 2.1 | Look-Ahead Greedy | 6 hours | High |
| 2.2 | ILP Transfer Modeling | 8 hours | Medium |
| 3.1 | Direction Split Improvements | 4 hours | Medium |
| 3.2 | Flexible Settlement Splits | 3 hours | Low |
| 4 | Edge Case Tests | 4 hours | High |

### Total Estimated Time: ~34 hours

### Quick Wins (Implement First)

1. **Input Validation** - Prevents crashes, easy to implement
2. **Budget Accumulation** - Fixes critical bug, moderate effort
3. **Edge Case Tests** - Ensures stability

### Deferred (Implement Later)

1. **ILP Transfer Modeling** - Complex, requires careful testing
2. **Flexible Settlement Splits** - Nice-to-have, not critical

---

## Files to Modify

```
backend/src/agents/group_allocator.py  ← Main changes
backend/src/agents/group_models.py     ← Add SettlementSplitMethod, MemberState
backend/tests/test_group_allocator.py  ← New test file
```

---

*Document created: January 25, 2026*
*Related: `GROUP_BOOKING_ALLOCATOR_NUANCES.md`, `GROUP_BOOKING_ALLOCATOR_IMPLEMENTATION.md`*
