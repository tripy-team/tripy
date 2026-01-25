"""
GroupBookingAllocator - Assigns booking responsibilities to group members.

CRITICAL: This allocator ensures each member only uses their OWN points.
Points are never pooled or combined across members.

Example:
    - Alice has 100k Chase UR
    - Bob has 100k Chase UR
    - Flight costs 150k Chase UR
    
    ❌ WRONG: "Combined 200k, book with shared points"
    ✅ CORRECT: Neither can book with points alone → use cash OR find different flights
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
    
    CRITICAL: Points are per-member, NOT pooled.
    Each member can only use their OWN points for segments they book.
    
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
        
        IMPORTANT: Each member only uses their OWN points.
        Points are never combined across members.
        
        Args:
            trip_id: Trip identifier
            segments: For each segment, list of booking options
            members: Group members with their individual points
            strategy: How to allocate (optimize, by_type, etc.)
        
        Returns:
            GroupBookingPlan with assignments and settlements
        """
        logger.info(f"Allocating {len(segments)} segments among {len(members)} members")
        logger.info(f"Strategy: {strategy.strategy_type}")
        
        # Log member points (for debugging non-pooling)
        for member in members:
            logger.debug(f"  {member.member_name}: {member.points}")
        
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
    # STRATEGY: OPTIMIZE (ILP-based or Greedy fallback)
    # =========================================================================
    
    def _allocate_optimized(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """
        Use ILP to find optimal member-segment assignment.
        
        Objective: Minimize total group OOP
        
        Constraints (CRITICAL - enforces non-pooling):
        - Each segment assigned to exactly one member with one option
        - Each member's points usage <= THEIR OWN balance (NOT pooled!)
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
        """
        ILP solver implementation.
        
        Decision Variables:
            x[seg_idx, opt_idx, mem_idx] ∈ {0,1}
            = 1 if member mem_idx books segment seg_idx using option opt_idx
        
        Objective:
            Minimize Σ (cash_cost * x) for all assignments
        
        Constraints:
            1. Σ x[i,j,m] = 1 for each segment i (exactly one booking)
            2. Σ points[i,j] * x[i,j,m] <= member[m].points[program] 
               for each member m and program (PER-MEMBER points limit!)
            3. Σ cash * x[i,j,m] <= member[m].budget for each member m
        """
        try:
            from pulp import LpProblem, LpMinimize, LpVariable, LpBinary, lpSum, PULP_CBC_CMD
        except ImportError:
            logger.warning("PuLP not installed, using greedy solver")
            return self._solve_greedy(segments, members)
        
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
        # This is the CRITICAL constraint that prevents pooling
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
                    # Member's balance for this program (including transfers)
                    member_balance = member.points.get(program, 0)
                    transferable = self._get_transferable_balance(member, program)
                    effective_balance = max(member_balance, transferable)
                    
                    prob += (
                        lpSum(points_terms) <= effective_balance,
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
        using their OWN points.
        """
        assignments = []
        
        # Track remaining points per member (per-member, NOT pooled!)
        remaining_points = {
            m.member_id: dict(m.points) for m in members
        }
        
        for seg_idx, options in enumerate(segments):
            best_assignment = None
            best_oop = float('inf')
            
            for member in members:
                for option in options:
                    # Check if member can afford this option WITH THEIR OWN POINTS
                    if option.award_available:
                        program = option.award_program
                        points_needed = option.award_points
                        available = remaining_points[member.member_id].get(program, 0)
                        
                        # Also check transferable points
                        if available < points_needed:
                            available = self._get_remaining_transferable(
                                member, program, remaining_points[member.member_id]
                            )
                        
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
                        # Check member's budget if specified
                        if member.max_cash_budget is None or option.cash_price <= member.max_cash_budget:
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
                # Deduct points if used (from THIS member only)
                if best_assignment["uses_points"]:
                    program = best_assignment["program"]
                    points = best_assignment["points"]
                    member_id = best_assignment["member"].member_id
                    
                    # Deduct from direct balance or transferable
                    if remaining_points[member_id].get(program, 0) >= points:
                        remaining_points[member_id][program] -= points
                    else:
                        # Deduct from transfer source
                        self._deduct_transferable(
                            remaining_points[member_id], program, points
                        )
                
                assignments.append(BookingAssignment(
                    segment_id=best_assignment["option"].segment_id,
                    segment_type=best_assignment["option"].segment_type,
                    assigned_to=best_assignment["member"].member_id,
                    assigned_to_name=best_assignment["member"].member_name,
                    reason="Optimal: lowest OOP option using member's own points",
                    uses_points=best_assignment["uses_points"],
                    points_program=best_assignment["program"],
                    points_used=best_assignment["points"],
                    cash_amount=best_assignment["cash"],
                    segment_summary=best_assignment["option"].summary,
                ))
            else:
                logger.warning(f"No valid assignment found for segment {seg_idx}")
        
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
        Each member uses their OWN points for their assigned segments.
        """
        flight_member = self._find_member(members, strategy.flight_booker)
        hotel_member = self._find_member(members, strategy.hotel_booker)
        
        if not flight_member or not hotel_member:
            raise ValueError("flight_booker and hotel_booker must be specified")
        
        assignments = []
        
        # Track remaining points per member
        remaining_points = {
            m.member_id: dict(m.points) for m in members
        }
        
        for options in segments:
            if not options:
                continue
            
            seg_type = options[0].segment_type
            member = flight_member if seg_type == "flight" else hotel_member
            
            # Find best option for this member using THEIR points
            best = self._find_best_option_for_member(
                options, member, remaining_points[member.member_id]
            )
            
            # Update remaining points for this member
            if best["uses_points"]:
                self._deduct_points(remaining_points[member.member_id], best["program"], best["points"])
            
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
        Hotels go to whoever has better hotel points (in THEIR account).
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
                # Hotels: assign to whoever has better hotel points in THEIR account
                member = self._pick_better_hotel_member(
                    outbound_member, return_member, remaining_points
                )
                direction = "hotel"
            
            best = self._find_best_option_for_member(
                options, member, remaining_points[member.member_id]
            )
            
            if best["uses_points"]:
                self._deduct_points(remaining_points[member.member_id], best["program"], best["points"])
            
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
        """
        Use user-specified assignments.
        Each member still only uses their OWN points.
        """
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
                self._deduct_points(remaining_points[member.member_id], best["program"], best["points"])
            
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
        if not options:
            return {"option": None, "uses_points": False, "program": None, "points": 0, "cash": 0}
        
        best = {
            "option": options[0],
            "uses_points": False,
            "program": None,
            "points": 0,
            "cash": options[0].cash_price
        }
        
        for option in options:
            # Check award option (using THIS member's points only)
            if option.award_available:
                program = option.award_program
                points_needed = option.award_points
                available = remaining_points.get(program, 0)
                
                # Also check transferable
                if available < points_needed:
                    available = self._get_remaining_transferable(
                        member, program, remaining_points
                    )
                
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
        """Check if member can afford an award option with THEIR OWN points."""
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
    
    def _get_remaining_transferable(
        self,
        member: MemberBookingCapability,
        target_program: str,
        remaining_points: dict[str, int],
    ) -> int:
        """Get remaining transferable points for a member."""
        max_balance = remaining_points.get(target_program, 0)
        
        for bank, config in TRANSFER_GRAPH.items():
            programs = config.get("airlines", []) + config.get("hotels", [])
            if target_program in programs:
                ratio = config.get("ratios", {}).get(target_program, 1.0)
                bank_balance = remaining_points.get(bank, 0)
                transferable = int(bank_balance * ratio)
                max_balance = max(max_balance, transferable)
        
        return max_balance
    
    def _deduct_transferable(
        self,
        remaining_points: dict[str, int],
        target_program: str,
        points_needed: int,
    ) -> None:
        """Deduct points from transfer source."""
        for bank, config in TRANSFER_GRAPH.items():
            programs = config.get("airlines", []) + config.get("hotels", [])
            if target_program in programs:
                ratio = config.get("ratios", {}).get(target_program, 1.0)
                bank_balance = remaining_points.get(bank, 0)
                
                if bank_balance * ratio >= points_needed:
                    points_to_deduct = int(points_needed / ratio)
                    remaining_points[bank] = bank_balance - points_to_deduct
                    return
    
    def _deduct_points(
        self,
        remaining_points: dict[str, int],
        program: str,
        points: int,
    ) -> None:
        """Deduct points from remaining balance."""
        if remaining_points.get(program, 0) >= points:
            remaining_points[program] -= points
        else:
            # Try to deduct from transferable
            self._deduct_transferable(remaining_points, program, points)
    
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
        """Pick member with more hotel points in THEIR account."""
        hotel_programs = ["Marriott Bonvoy", "Hilton Honors", "IHG", "Hyatt", "HH", "MAR", "HYATT"]
        
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
        """Check if all members stayed within their own points balances."""
        # Group points by member and program
        member_points_used = {m.member_id: {} for m in members}
        for a in assignments:
            if a.uses_points and a.points_program:
                m_id = a.assigned_to
                prog = a.points_program
                member_points_used[m_id][prog] = (
                    member_points_used[m_id].get(prog, 0) + (a.points_used or 0)
                )
        
        for member in members:
            for program, used in member_points_used[member.member_id].items():
                # Check direct balance
                available = member.points.get(program, 0)
                # Also check transferable
                if available < used:
                    available = self._get_transferable_balance(member, program)
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
        try:
            from pulp import LpStatus, value
        except ImportError:
            return self._solve_greedy(segments, members)
        
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
