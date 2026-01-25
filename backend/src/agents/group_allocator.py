"""
GroupBookingAllocator - Assigns booking responsibilities to group members.

CRITICAL: This allocator ensures each member only uses their OWN points.
Points are never pooled or combined across members.

Fixes Implemented:
- Input validation with detailed error messages
- Budget accumulation tracking (cumulative, not per-segment)
- Transfer source optimization (preserves better sources)
- Look-ahead greedy algorithm (avoids local optima)
- ILP v2 with proper transfer decision variables
- Trip structure analysis for direction split
- Flexible settlement splits (equal, proportional, custom)
"""

import logging
from typing import Optional
from dataclasses import dataclass
from itertools import product
import copy

from .group_models import (
    MemberBookingCapability,
    BookingAssignment,
    Settlement,
    MemberBookingSummary,
    BookingAllocationStrategy,
    GroupBookingPlan,
    SettlementSplitMethod,
    AllocationValidationResult,
    MemberState,
    TransferOption,
    TransferDetail,
    TransferSummary,
    TripStructure,
)
from .config import TRANSFER_GRAPH

logger = logging.getLogger(__name__)


# =============================================================================
# PROGRAM METADATA (for display names and URLs)
# =============================================================================

BANK_METADATA = {
    "Chase UR": {
        "name": "Chase Ultimate Rewards",
        "portal_url": "https://ultimaterewardspoints.chase.com",
        "default_transfer_time": "Instant",
    },
    "Amex MR": {
        "name": "American Express Membership Rewards",
        "portal_url": "https://global.americanexpress.com/rewards",
        "default_transfer_time": "1-2 business days",
    },
    "Citi TYP": {
        "name": "Citi ThankYou Points",
        "portal_url": "https://www.thankyou.com",
        "default_transfer_time": "Instant to 24 hours",
    },
    "Capital One": {
        "name": "Capital One Miles",
        "portal_url": "https://www.capitalone.com/credit-cards/rewards",
        "default_transfer_time": "Instant to 2 days",
    },
    "Bilt": {
        "name": "Bilt Rewards",
        "portal_url": "https://www.biltrewards.com",
        "default_transfer_time": "Instant",
    },
}

PROGRAM_METADATA = {
    # Airlines
    "UA": {"name": "United MileagePlus", "type": "airline", "booking_url": "https://www.united.com"},
    "AA": {"name": "American AAdvantage", "type": "airline", "booking_url": "https://www.aa.com"},
    "DL": {"name": "Delta SkyMiles", "type": "airline", "booking_url": "https://www.delta.com"},
    "BA": {"name": "British Airways Avios", "type": "airline", "booking_url": "https://www.britishairways.com"},
    "AF": {"name": "Air France Flying Blue", "type": "airline", "booking_url": "https://www.airfrance.com"},
    "VS": {"name": "Virgin Atlantic Flying Club", "type": "airline", "booking_url": "https://www.virginatlantic.com"},
    "SQ": {"name": "Singapore KrisFlyer", "type": "airline", "booking_url": "https://www.singaporeair.com"},
    "ANA": {"name": "ANA Mileage Club", "type": "airline", "booking_url": "https://www.ana.co.jp"},
    "NH": {"name": "ANA Mileage Club", "type": "airline", "booking_url": "https://www.ana.co.jp"},
    "JL": {"name": "JAL Mileage Bank", "type": "airline", "booking_url": "https://www.jal.co.jp"},
    "EK": {"name": "Emirates Skywards", "type": "airline", "booking_url": "https://www.emirates.com"},
    "QF": {"name": "Qantas Frequent Flyer", "type": "airline", "booking_url": "https://www.qantas.com"},
    "TK": {"name": "Turkish Miles&Smiles", "type": "airline", "booking_url": "https://www.turkishairlines.com"},
    "IB": {"name": "Iberia Plus", "type": "airline", "booking_url": "https://www.iberia.com"},
    "AV": {"name": "Avianca LifeMiles", "type": "airline", "booking_url": "https://www.lifemiles.com"},
    "TP": {"name": "TAP Miles&Go", "type": "airline", "booking_url": "https://www.flytap.com"},
    
    # Hotels
    "HH": {"name": "Hilton Honors", "type": "hotel", "booking_url": "https://www.hilton.com"},
    "MAR": {"name": "Marriott Bonvoy", "type": "hotel", "booking_url": "https://www.marriott.com"},
    "HYATT": {"name": "World of Hyatt", "type": "hotel", "booking_url": "https://www.hyatt.com"},
    "IHG": {"name": "IHG One Rewards", "type": "hotel", "booking_url": "https://www.ihg.com"},
}


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
    
    Features:
    - Input validation with detailed errors
    - Cumulative budget tracking
    - Transfer source optimization
    - Look-ahead greedy algorithm
    - ILP with transfer modeling
    - Trip structure analysis
    - Flexible settlement splits
    """
    
    def __init__(
        self,
        use_ilp: bool = True,
        time_limit_seconds: int = 30,
        lookahead_depth: int = 3,
    ):
        """
        Initialize allocator.
        
        Args:
            use_ilp: If True, try ILP solver first, fall back to greedy.
            time_limit_seconds: Max time for ILP solver.
            lookahead_depth: How many segments to look ahead in greedy.
        """
        self.use_ilp = use_ilp
        self.time_limit_seconds = time_limit_seconds
        self.lookahead_depth = lookahead_depth
    
    # =========================================================================
    # INPUT VALIDATION
    # =========================================================================
    
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
        if members:
            member_ids = [m.member_id for m in members]
            if len(member_ids) != len(set(member_ids)):
                errors.append("Duplicate member IDs found")
        
        # 6. Strategy-specific validation
        member_ids = [m.member_id for m in members] if members else []
        
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
    
    # =========================================================================
    # MAIN ALLOCATION METHOD
    # =========================================================================
    
    def allocate(
        self,
        trip_id: str,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
        split_method: SettlementSplitMethod = SettlementSplitMethod.EQUAL,
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
            split_method: How to split costs for settlement
        
        Returns:
            GroupBookingPlan with per-member assignments and settlements
            
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
        
        logger.info(f"[GroupBookingAllocator] Allocating {len(segments)} segments among {len(members)} members")
        logger.info(f"[GroupBookingAllocator] Strategy: {strategy.strategy_type}")
        
        # === ROUTE TO STRATEGY ===
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
        
        # === CONSOLIDATE TRANSFERS ===
        transfers_needed = self._consolidate_transfers(assignments, members)
        
        # === CALCULATE SETTLEMENTS ===
        settlements = self._calculate_settlements(assignments, members, split_method)
        
        # === BUILD MEMBER SUMMARIES ===
        member_summaries = self._build_member_summaries(
            assignments, members, settlements, split_method
        )
        
        # === BUILD FINAL PLAN ===
        total_oop = sum(a.cash_amount for a in assignments)
        total_points = sum(a.points_used or 0 for a in assignments)
        
        # Calculate transfer metrics
        total_transfers = len(transfers_needed)
        total_source_points = sum(t.total_source_points for t in transfers_needed)
        
        return GroupBookingPlan(
            trip_id=trip_id,
            strategy_used=strategy.strategy_type,
            split_method_used=split_method.value,
            assignments=assignments,
            transfers_needed=transfers_needed,  # NEW
            member_summaries=member_summaries,
            settlements=settlements,
            total_group_oop=total_oop,
            total_points_used=total_points,
            per_person_effective_cost=total_oop / len(members) if members else 0,
            total_transfers_needed=total_transfers,  # NEW
            total_source_points_transferred=total_source_points,  # NEW
            all_segments_assigned=len(assignments) == len(segments),
            all_members_within_budget=self._check_budgets(assignments, members),
            all_members_within_points=self._check_points(assignments, members),
            warnings=validation.warnings,
        )
    
    # =========================================================================
    # MEMBER STATE MANAGEMENT
    # =========================================================================
    
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
    
    def _copy_member_states(
        self,
        states: dict[str, MemberState],
    ) -> dict[str, MemberState]:
        """Create deep copy of member states for simulation."""
        return {
            member_id: state.copy()
            for member_id, state in states.items()
        }
    
    # =========================================================================
    # STRATEGY: OPTIMIZE (ILP-based or Greedy with lookahead)
    # =========================================================================
    
    def _allocate_optimized(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """
        Use ILP or greedy with lookahead to find optimal assignment.
        """
        # Try ILP first if enabled
        if self.use_ilp:
            try:
                return self._solve_with_ilp_v2(segments, members)
            except Exception as e:
                logger.warning(f"ILP failed, falling back to greedy: {e}")
        
        # Use greedy with lookahead
        return self._solve_greedy_with_lookahead(segments, members)
    
    def _solve_greedy_with_lookahead(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """
        Greedy with look-ahead to avoid local optima traps.
        
        For each segment, considers impact on next `lookahead_depth` segments.
        """
        # For very small segment counts, use exhaustive search
        if len(segments) <= 4 and len(members) <= 3:
            try:
                return self._solve_exhaustive(segments, members)
            except Exception as e:
                logger.warning(f"Exhaustive search failed: {e}")
        
        assignments = []
        member_states = self._initialize_member_states(members)
        
        for seg_idx, options in enumerate(segments):
            if not options:
                continue
            
            remaining_segments = segments[seg_idx + 1 : seg_idx + 1 + self.lookahead_depth]
            
            best_assignment = None
            best_total_oop = float('inf')
            
            # Try each possible assignment for current segment
            for member in members:
                for option in options:
                    # Create a copy of states to simulate this choice
                    simulated_states = self._copy_member_states(member_states)
                    
                    # Try to make this assignment
                    current_oop = self._try_assignment(
                        simulated_states[member.member_id],
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
                        # Check how member can afford this
                        afford_result = None
                        if option.award_available:
                            afford_result = self._how_can_afford_award(
                                member_states[member.member_id], option
                            )
                        uses_points = afford_result is not None
                        
                        best_assignment = {
                            "member": member,
                            "option": option,
                            "uses_points": uses_points,
                            "program": option.award_program if uses_points else None,
                            "points": option.award_points if uses_points else 0,
                            "cash": current_oop,
                            "transfer_detail": afford_result.get("transfer_detail") if afford_result else None,
                        }
            
            if best_assignment:
                # Apply the best assignment to actual states
                member = best_assignment["member"]
                state = member_states[member.member_id]
                
                state.spend_cash(best_assignment["cash"])
                if best_assignment["uses_points"]:
                    self._deduct_points_from_state(
                        state,
                        best_assignment["program"],
                        best_assignment["points"],
                    )
                
                # Get transfer details
                transfer = best_assignment.get("transfer_detail")
                
                assignments.append(BookingAssignment(
                    segment_id=best_assignment["option"].segment_id,
                    segment_type=best_assignment["option"].segment_type,
                    assigned_to=member.member_id,
                    assigned_to_name=member.member_name,
                    reason="Optimized: best option considering future segments",
                    uses_points=best_assignment["uses_points"],
                    points_program=best_assignment["program"],
                    points_program_name=PROGRAM_METADATA.get(best_assignment["program"], {}).get("name") if best_assignment["program"] else None,
                    points_used=best_assignment["points"],
                    cash_amount=best_assignment["cash"],
                    segment_summary=best_assignment["option"].summary,
                    # Transfer fields
                    requires_transfer=transfer is not None,
                    transfer_from=transfer.source_program if transfer else None,
                    transfer_from_name=transfer.source_program_name if transfer else None,
                    transfer_points_from_source=transfer.source_points if transfer else None,
                    transfer_ratio=transfer.ratio if transfer else None,
                    transfer_ratio_display=transfer.ratio_display if transfer else None,
                    transfer_time=transfer.transfer_time if transfer else None,
                    transfer_portal_url=transfer.portal_url if transfer else None,
                    booking_url=transfer.booking_url if transfer else None,
                ))
            else:
                # Fallback: assign to first member with first option
                logger.warning(f"No valid assignment found for segment {seg_idx}, using fallback")
                if options and members:
                    option = options[0]
                    member = members[0]
                    assignments.append(BookingAssignment(
                        segment_id=option.segment_id,
                        segment_type=option.segment_type,
                        assigned_to=member.member_id,
                        assigned_to_name=member.member_name,
                        reason="Fallback: no affordable option found",
                        uses_points=False,
                        points_program=None,
                        points_used=0,
                        cash_amount=option.cash_price,
                        segment_summary=option.summary,
                    ))
        
        return assignments
    
    def _solve_exhaustive(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """
        Exhaustively try all combinations for small segment counts.
        """
        best_assignments = None
        best_oop = float('inf')
        
        # Generate all possible (member, option) pairs for each segment
        choices_per_segment = []
        for options in segments:
            if not options:
                continue
            segment_choices = []
            for member in members:
                for option in options:
                    segment_choices.append((member, option))
            choices_per_segment.append(segment_choices)
        
        if not choices_per_segment:
            return []
        
        # Try all combinations
        for combination in product(*choices_per_segment):
            states = self._initialize_member_states(members)
            assignments = []
            total_oop = 0.0
            valid = True
            
            for member, option in combination:
                state = states[member.member_id]
                oop = self._try_assignment(state, option)
                
                if oop is None:
                    valid = False
                    break
                
                total_oop += oop
                uses_points = self._can_use_award(state, option)
                
                if uses_points:
                    self._deduct_points_from_state(state, option.award_program, option.award_points)
                state.spend_cash(oop)
                
                assignments.append({
                    "member": member,
                    "option": option,
                    "uses_points": uses_points,
                    "program": option.award_program if uses_points else None,
                    "points": option.award_points if uses_points else 0,
                    "cash": oop,
                })
            
            if valid and total_oop < best_oop:
                best_oop = total_oop
                best_assignments = assignments
        
        if best_assignments:
            return [
                BookingAssignment(
                    segment_id=a["option"].segment_id,
                    segment_type=a["option"].segment_type,
                    assigned_to=a["member"].member_id,
                    assigned_to_name=a["member"].member_name,
                    reason="Exhaustive search: globally optimal assignment",
                    uses_points=a["uses_points"],
                    points_program=a["program"],
                    points_used=a["points"],
                    cash_amount=a["cash"],
                    segment_summary=a["option"].summary,
                )
                for a in best_assignments
            ]
        
        # Fallback to regular greedy
        return self._solve_greedy_basic(segments, members)
    
    def _solve_greedy_basic(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """
        Basic greedy algorithm (no lookahead).
        """
        assignments = []
        member_states = self._initialize_member_states(members)
        
        for seg_idx, options in enumerate(segments):
            if not options:
                continue
            
            best_assignment = None
            best_oop = float('inf')
            
            for member in members:
                state = member_states[member.member_id]
                
                for option in options:
                    oop = self._try_assignment(state, option, dry_run=True)
                    
                    if oop is not None and oop < best_oop:
                        best_oop = oop
                        uses_points = self._can_use_award(state, option)
                        best_assignment = {
                            "member": member,
                            "option": option,
                            "uses_points": uses_points,
                            "program": option.award_program if uses_points else None,
                            "points": option.award_points if uses_points else 0,
                            "cash": oop,
                        }
            
            if best_assignment:
                member = best_assignment["member"]
                state = member_states[member.member_id]
                
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
                    assigned_to=member.member_id,
                    assigned_to_name=member.member_name,
                    reason="Greedy: lowest OOP option",
                    uses_points=best_assignment["uses_points"],
                    points_program=best_assignment["program"],
                    points_used=best_assignment["points"],
                    cash_amount=best_assignment["cash"],
                    segment_summary=best_assignment["option"].summary,
                ))
        
        return assignments
    
    def _try_assignment(
        self,
        state: MemberState,
        option: SegmentOption,
        dry_run: bool = False,
    ) -> Optional[float]:
        """
        Try to assign option to member. Returns OOP if possible, None if not.
        
        If dry_run=True, doesn't modify state.
        """
        # Check if can use award
        if option.award_available:
            can_afford_points = self._can_use_award_from_state(state, option)
            surcharge = option.award_surcharge
            
            if can_afford_points and state.can_afford_cash(surcharge):
                return surcharge
        
        # Check cash option
        if state.can_afford_cash(option.cash_price):
            return option.cash_price
        
        return None
    
    def _can_use_award(
        self,
        state: MemberState,
        option: SegmentOption,
    ) -> bool:
        """Check if member can use award option."""
        if not option.award_available:
            return False
        return self._can_use_award_from_state(state, option)
    
    def _can_use_award_from_state(
        self,
        state: MemberState,
        option: SegmentOption,
    ) -> bool:
        """Check if member state can afford award."""
        if not option.award_available:
            return False
        
        program = option.award_program
        points_needed = option.award_points
        
        # Direct balance
        if state.remaining_points.get(program, 0) >= points_needed:
            return True
        
        # Check transferable
        transferable = self._get_transferable_from_state(state, program)
        return transferable >= points_needed
    
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
            if not options:
                continue
            
            best_oop = float('inf')
            best_member = None
            best_uses_points = False
            best_option = None
            
            for member in members:
                state = states[member.member_id]
                
                for option in options:
                    oop = self._try_assignment(state, option, dry_run=True)
                    if oop is not None and oop < best_oop:
                        best_oop = oop
                        best_member = member
                        best_option = option
                        best_uses_points = self._can_use_award(state, option)
            
            if best_member and best_oop < float('inf'):
                total_oop += best_oop
                # Update state for simulation
                state = states[best_member.member_id]
                state.spend_cash(best_oop)
                if best_uses_points and best_option:
                    try:
                        self._deduct_points_from_state(
                            state,
                            best_option.award_program,
                            best_option.award_points,
                        )
                    except (ValueError, KeyError):
                        pass  # Ignore errors in simulation
            else:
                # Can't assign: assume worst case (highest cash price)
                if options:
                    total_oop += max(opt.cash_price for opt in options)
        
        return total_oop
    
    # =========================================================================
    # ILP SOLVER V2 (with proper transfer modeling)
    # =========================================================================
    
    def _solve_with_ilp_v2(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
    ) -> list[BookingAssignment]:
        """
        ILP solver with proper transfer modeling.
        """
        try:
            from pulp import LpProblem, LpMinimize, LpVariable, LpBinary, LpContinuous, lpSum, PULP_CBC_CMD, LpStatus, value
        except ImportError:
            logger.warning("PuLP not installed, using greedy solver")
            return self._solve_greedy_with_lookahead(segments, members)
        
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
                if member.points.get(source, 0) > 0:  # Only if member has this bank's points
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
            if options:
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
                
                if incoming:
                    prob += (
                        lpSum(points_used) <= direct_balance + lpSum(incoming),
                        f"PointsLimit_{mem_idx}_{program}"
                    )
                else:
                    prob += (
                        lpSum(points_used) <= direct_balance,
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
                
                if cash_terms:
                    prob += (
                        lpSum(cash_terms) <= member.max_cash_budget,
                        f"Budget_{mem_idx}"
                    )
        
        # === SOLVE ===
        
        solver = PULP_CBC_CMD(msg=0, timeLimit=self.time_limit_seconds)
        prob.solve(solver)
        
        # === EXTRACT SOLUTION ===
        
        if prob.status != 1:  # Not optimal
            logger.warning(f"ILP status: {LpStatus[prob.status]}, falling back to greedy")
            return self._solve_greedy_with_lookahead(segments, members)
        
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
        member_states = self._initialize_member_states(members)
        
        for options in segments:
            if not options:
                continue
            
            seg_type = options[0].segment_type
            member = flight_member if seg_type == "flight" else hotel_member
            state = member_states[member.member_id]
            
            # Find best option for this member
            best = self._find_best_option_for_state(options, state)
            
            # Update state
            if best["uses_points"]:
                self._deduct_points_from_state(state, best["program"], best["points"])
            state.spend_cash(best["cash"])
            
            # Build assignment with transfer details
            transfer = best.get("transfer_detail")
            
            assignments.append(BookingAssignment(
                segment_id=best["option"].segment_id,
                segment_type=seg_type,
                assigned_to=member.member_id,
                assigned_to_name=member.member_name,
                reason=f"Strategy: all {seg_type}s assigned to {member.member_name}",
                uses_points=best["uses_points"],
                points_program=best["program"],
                points_program_name=PROGRAM_METADATA.get(best["program"], {}).get("name") if best["program"] else None,
                points_used=best["points"],
                cash_amount=best["cash"],
                segment_summary=best["option"].summary,
                # Transfer fields
                requires_transfer=transfer is not None,
                transfer_from=transfer.source_program if transfer else None,
                transfer_from_name=transfer.source_program_name if transfer else None,
                transfer_points_from_source=transfer.source_points if transfer else None,
                transfer_ratio=transfer.ratio if transfer else None,
                transfer_ratio_display=transfer.ratio_display if transfer else None,
                transfer_time=transfer.transfer_time if transfer else None,
                transfer_portal_url=transfer.portal_url if transfer else None,
                booking_url=transfer.booking_url if transfer else None,
            ))
        
        return assignments
    
    # =========================================================================
    # STRATEGY: BY DIRECTION (with trip structure analysis)
    # =========================================================================
    
    def _allocate_by_direction(
        self,
        segments: list[list[SegmentOption]],
        members: list[MemberBookingCapability],
        strategy: BookingAllocationStrategy,
    ) -> list[BookingAssignment]:
        """
        Assign outbound segments to one member, return to another.
        Uses trip structure analysis for better detection.
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
            
            # Build assignment with transfer details
            transfer = best.get("transfer_detail")
            
            assignments.append(BookingAssignment(
                segment_id=seg_id,
                segment_type=seg_type,
                assigned_to=member.member_id,
                assigned_to_name=member.member_name,
                reason=f"{reason_prefix}: assigned to {member.member_name}",
                uses_points=best["uses_points"],
                points_program=best["program"],
                points_program_name=PROGRAM_METADATA.get(best["program"], {}).get("name") if best["program"] else None,
                points_used=best["points"],
                cash_amount=best["cash"],
                segment_summary=best["option"].summary if best["option"] else None,
                # Transfer fields
                requires_transfer=transfer is not None,
                transfer_from=transfer.source_program if transfer else None,
                transfer_from_name=transfer.source_program_name if transfer else None,
                transfer_points_from_source=transfer.source_points if transfer else None,
                transfer_ratio=transfer.ratio if transfer else None,
                transfer_ratio_display=transfer.ratio_display if transfer else None,
                transfer_time=transfer.transfer_time if transfer else None,
                transfer_portal_url=transfer.portal_url if transfer else None,
                booking_url=transfer.booking_url if transfer else None,
            ))
        
        return assignments
    
    def _analyze_trip_structure(
        self,
        segments: list[list[SegmentOption]],
    ) -> TripStructure:
        """
        Analyze segments to determine trip structure.
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
        routes = []
        for _, opt in flight_segments:
            if opt.summary and "→" in opt.summary:
                parts = opt.summary.split("→")
                if len(parts) >= 2:
                    origin = parts[0].strip().split()[-1]
                    dest = parts[1].strip().split()[0]
                    routes.append((origin, dest))
        
        if not routes:
            # Can't determine structure, fall back to midpoint
            mid = len(flight_segments) // 2
            # Ensure at least 1 segment in each direction for round trips
            if mid == 0 and len(flight_segments) > 1:
                mid = 1
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
        return_segs = []
        heading_home = False
        
        for i, (origin, dest) in enumerate(routes):
            seg_id = flight_segments[i][1].segment_id
            
            if dest == home_city:
                heading_home = True
            
            if heading_home:
                return_segs.append(seg_id)
            else:
                outbound.append(seg_id)
        
        # If no return found (one-way trip), split in half
        if not return_segs and len(outbound) > 1:
            mid = len(outbound) // 2
            if mid == 0:
                mid = 1
            return_segs = outbound[mid:]
            outbound = outbound[:mid]
        
        return TripStructure(
            origin=home_city,
            destination_count=len(set(d for _, d in routes if d != home_city)),
            outbound_segments=outbound,
            return_segments=return_segs,
            hotel_segments=hotel_segments,
        )
    
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
        """
        assignments = []
        member_states = self._initialize_member_states(members)
        
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
            
            state = member_states[member.member_id]
            best = self._find_best_option_for_state(options, state)
            
            if best["uses_points"]:
                self._deduct_points_from_state(state, best["program"], best["points"])
            state.spend_cash(best["cash"])
            
            # Build assignment with transfer details
            transfer = best.get("transfer_detail")
            
            assignments.append(BookingAssignment(
                segment_id=seg_id,
                segment_type=options[0].segment_type,
                assigned_to=member.member_id,
                assigned_to_name=member.member_name,
                reason=f"Manual assignment to {member.member_name}",
                uses_points=best["uses_points"],
                points_program=best["program"],
                points_program_name=PROGRAM_METADATA.get(best["program"], {}).get("name") if best["program"] else None,
                points_used=best["points"],
                cash_amount=best["cash"],
                segment_summary=best["option"].summary if best["option"] else None,
                # Transfer fields
                requires_transfer=transfer is not None,
                transfer_from=transfer.source_program if transfer else None,
                transfer_from_name=transfer.source_program_name if transfer else None,
                transfer_points_from_source=transfer.source_points if transfer else None,
                transfer_ratio=transfer.ratio if transfer else None,
                transfer_ratio_display=transfer.ratio_display if transfer else None,
                transfer_time=transfer.transfer_time if transfer else None,
                transfer_portal_url=transfer.portal_url if transfer else None,
                booking_url=transfer.booking_url if transfer else None,
            ))
        
        return assignments
    
    # =========================================================================
    # SETTLEMENT CALCULATION (Flexible splits)
    # =========================================================================
    
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
        
        if total_cash < 0.01:
            return []
        
        # Calculate what each member paid
        member_paid = {m.member_id: 0.0 for m in members}
        member_names = {m.member_id: m.member_name for m in members}
        
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
        return self._generate_settlements(balances, member_names)
    
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
            if total_travelers == 0:
                total_travelers = len(members)
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
            raw_shares = {}
            for m in members:
                points_ratio = member_points_used[m.member_id] / total_points
                # Invert: higher points = lower share (max 50% reduction)
                raw_shares[m.member_id] = 1.0 - (points_ratio * 0.5)
            
            # Normalize to sum to total_cash
            total_raw = sum(raw_shares.values())
            return {
                m_id: (raw / total_raw) * total_cash
                for m_id, raw in raw_shares.items()
            }
        
        elif split_method == SettlementSplitMethod.CUSTOM:
            total_percentage = sum(
                m.custom_split_percentage or 0 for m in members
            )
            
            if total_percentage < 0.01:
                # No custom percentages, fall back to equal
                share = total_cash / len(members)
                return {m.member_id: share for m in members}
            
            return {
                m.member_id: ((m.custom_split_percentage or 0) / total_percentage) * total_cash
                for m in members
            }
        
        else:
            # Default to equal
            share = total_cash / len(members)
            return {m.member_id: share for m in members}
    
    def _generate_settlements(
        self,
        balances: dict[str, float],
        member_names: dict[str, str],
    ) -> list[Settlement]:
        """Generate settlement transactions from balances."""
        settlements = []
        
        # Positive = paid more than fair share (owed money)
        # Negative = paid less than fair share (owes money)
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
    
    def _find_best_option_for_state(
        self,
        options: list[SegmentOption],
        state: MemberState,
    ) -> dict:
        """
        Find best option for a member given their state.
        Now also tracks transfer source if needed.
        
        Returns dict with:
            - option: SegmentOption
            - uses_points: bool
            - program: str or None
            - points: int
            - cash: float
            - transfer_detail: TransferDetail or None (NEW)
        """
        if not options:
            return {
                "option": None,
                "uses_points": False,
                "program": None,
                "points": 0,
                "cash": 0,
                "transfer_detail": None,
            }
        
        best = {
            "option": options[0],
            "uses_points": False,
            "program": None,
            "points": 0,
            "cash": options[0].cash_price,
            "transfer_detail": None,
        }
        
        for option in options:
            # Check award option
            if option.award_available:
                # Find how member can afford this
                afford_result = self._how_can_afford_award(state, option)
                
                if afford_result and state.can_afford_cash(option.award_surcharge):
                    if option.award_surcharge < best["cash"]:
                        best = {
                            "option": option,
                            "uses_points": True,
                            "program": option.award_program,
                            "points": option.award_points,
                            "cash": option.award_surcharge,
                            "transfer_detail": afford_result.get("transfer_detail"),
                        }
            
            # Check cash option
            if state.can_afford_cash(option.cash_price):
                if not best["uses_points"] and option.cash_price < best["cash"]:
                    best = {
                        "option": option,
                        "uses_points": False,
                        "program": None,
                        "points": 0,
                        "cash": option.cash_price,
                        "transfer_detail": None,
                    }
        
        return best
    
    def _get_transferable_from_state(
        self,
        state: MemberState,
        target_program: str,
    ) -> int:
        """Get max points member can have in target program via transfers."""
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
        """Deduct points from state, using transfers if needed."""
        direct_balance = state.remaining_points.get(program, 0)
        
        if direct_balance >= points:
            state.spend_points(program, points)
            return
        
        # Need to use transfer - find best source
        best_source = self._select_best_transfer_source(
            state.remaining_points, program, points
        )
        
        if best_source and best_source.source_program != program:
            points_to_deduct = int(points / best_source.ratio)
            state.spend_points(best_source.source_program, points_to_deduct)
        else:
            # Fallback: try any transfer source
            for bank, config in TRANSFER_GRAPH.items():
                programs = config.get("airlines", []) + config.get("hotels", [])
                if program in programs:
                    ratio = config.get("ratios", {}).get(program, 1.0)
                    bank_balance = state.remaining_points.get(bank, 0)
                    
                    if bank_balance * ratio >= points:
                        points_to_deduct = int(points / ratio)
                        state.spend_points(bank, points_to_deduct)
                        return
            
            # Can't find source - this shouldn't happen if we checked can_afford first
            logger.error(f"Cannot deduct {points} {program} from member {state.member_id}")
    
    def _select_best_transfer_source(
        self,
        member_points: dict[str, int],
        target_program: str,
        points_needed: int,
    ) -> Optional[TransferOption]:
        """Select best transfer source considering priority."""
        options = []
        
        # Direct balance
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
        
        # Transfer partners
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
        
        if not options:
            return None
        
        # Sort by priority (ascending = use lowest priority first to preserve better ones)
        options.sort(key=lambda x: x.priority_score)
        return options[0]
    
    def _pick_better_hotel_member_from_states(
        self,
        member_a: MemberBookingCapability,
        member_b: MemberBookingCapability,
        states: dict[str, MemberState],
    ) -> MemberBookingCapability:
        """Pick member with more remaining hotel points."""
        hotel_programs = ["Marriott Bonvoy", "Hilton Honors", "IHG", "Hyatt", "HH", "MAR", "HYATT"]
        
        state_a = states[member_a.member_id]
        state_b = states[member_b.member_id]
        
        a_points = sum(state_a.remaining_points.get(p, 0) for p in hotel_programs)
        b_points = sum(state_b.remaining_points.get(p, 0) for p in hotel_programs)
        
        return member_a if a_points >= b_points else member_b
    
    # =========================================================================
    # TRANSFER TRACKING METHODS
    # =========================================================================
    
    def _get_transfer_details(
        self,
        source_program: str,
        target_program: str,
        source_points: int,
    ) -> Optional[TransferDetail]:
        """
        Build complete transfer details for a bank → program transfer.
        
        Args:
            source_program: Bank program code (e.g., "Chase UR")
            target_program: Target program code (e.g., "UA")
            source_points: Number of bank points to transfer
        
        Returns:
            TransferDetail with all information, or None if not a transfer
        """
        # Check if source is actually a bank
        if source_program not in TRANSFER_GRAPH:
            return None  # Direct balance, no transfer needed
        
        config = TRANSFER_GRAPH[source_program]
        
        # Check if target is a valid transfer partner
        all_partners = config.get("airlines", []) + config.get("hotels", [])
        if target_program not in all_partners:
            return None
        
        # Get ratio and calculate target points
        ratio = config.get("ratios", {}).get(target_program, 1.0)
        target_points = int(source_points * ratio)
        
        # Determine program type
        if target_program in config.get("airlines", []):
            program_type = "airline"
        else:
            program_type = "hotel"
        
        # Get transfer time
        transfer_time = config.get("transfer_times", {}).get(
            target_program, 
            BANK_METADATA.get(source_program, {}).get("default_transfer_time", "1-2 business days")
        )
        
        # Build ratio display
        if ratio >= 1.0:
            ratio_display = f"1:{int(ratio)}"
        else:
            ratio_display = f"{int(1/ratio)}:1"
        
        # Get URLs
        portal_url = config.get("portal_url", BANK_METADATA.get(source_program, {}).get("portal_url", ""))
        booking_url = PROGRAM_METADATA.get(target_program, {}).get("booking_url", "")
        
        # Get display names
        source_name = BANK_METADATA.get(source_program, {}).get("name", source_program)
        target_name = PROGRAM_METADATA.get(target_program, {}).get("name", target_program)
        
        return TransferDetail(
            source_program=source_program,
            source_program_name=source_name,
            source_points=source_points,
            target_program=target_program,
            target_program_name=target_name,
            target_program_type=program_type,
            target_points=target_points,
            ratio=ratio,
            ratio_display=ratio_display,
            transfer_time=transfer_time,
            portal_url=portal_url,
            booking_url=booking_url,
        )
    
    def _how_can_afford_award(
        self,
        state: MemberState,
        option: SegmentOption,
    ) -> Optional[dict]:
        """
        Determine HOW a member can afford an award option.
        Returns dict with transfer_detail if transfer needed, or empty dict if direct.
        Returns None if cannot afford.
        """
        if not option.award_available:
            return None
        
        program = option.award_program
        points_needed = option.award_points
        
        # 1. Check direct balance first (no transfer needed)
        if state.remaining_points.get(program, 0) >= points_needed:
            return {"transfer_detail": None}  # Can afford directly
        
        # 2. Check each possible transfer source
        for bank, config in TRANSFER_GRAPH.items():
            all_partners = config.get("airlines", []) + config.get("hotels", [])
            if program not in all_partners:
                continue
            
            ratio = config.get("ratios", {}).get(program, 1.0)
            bank_balance = state.remaining_points.get(bank, 0)
            effective_points = int(bank_balance * ratio)
            
            if effective_points >= points_needed:
                # Can afford via this transfer
                source_points_needed = int(points_needed / ratio) if ratio > 0 else points_needed
                
                transfer_detail = self._get_transfer_details(
                    source_program=bank,
                    target_program=program,
                    source_points=source_points_needed,
                )
                
                return {"transfer_detail": transfer_detail}
        
        return None  # Cannot afford
    
    def _consolidate_transfers(
        self,
        assignments: list[BookingAssignment],
        members: list[MemberBookingCapability],
    ) -> list[TransferSummary]:
        """
        Consolidate transfers from assignments into grouped summaries.
        Groups by (member_id, from_program, to_program).
        """
        # Group transfers
        transfer_groups: dict[tuple, dict] = {}
        
        for assignment in assignments:
            if not assignment.requires_transfer:
                continue
            
            key = (
                assignment.assigned_to,
                assignment.transfer_from,
                assignment.points_program,
            )
            
            if key not in transfer_groups:
                transfer_groups[key] = {
                    "member_id": assignment.assigned_to,
                    "member_name": assignment.assigned_to_name,
                    "from_program": assignment.transfer_from,
                    "from_program_name": assignment.transfer_from_name,
                    "to_program": assignment.points_program,
                    "to_program_name": assignment.points_program_name,
                    "to_program_type": assignment.segment_type,  # Approximation
                    "total_source_points": 0,
                    "total_target_points": 0,
                    "ratio": assignment.transfer_ratio,
                    "ratio_display": assignment.transfer_ratio_display,
                    "transfer_time": assignment.transfer_time,
                    "portal_url": assignment.transfer_portal_url,
                    "booking_url": assignment.booking_url,
                    "covers_segments": [],
                }
            
            transfer_groups[key]["total_source_points"] += assignment.transfer_points_from_source or 0
            transfer_groups[key]["total_target_points"] += assignment.points_used or 0
            transfer_groups[key]["covers_segments"].append(assignment.segment_id)
        
        # Build TransferSummary objects with step-by-step instructions
        summaries = []
        for key, data in transfer_groups.items():
            steps = self._build_transfer_steps(
                from_program=data["from_program"],
                from_program_name=data["from_program_name"],
                to_program=data["to_program"],
                to_program_name=data["to_program_name"],
                points=data["total_source_points"],
                portal_url=data["portal_url"],
                booking_url=data["booking_url"],
            )
            
            summaries.append(TransferSummary(
                member_id=data["member_id"],
                member_name=data["member_name"],
                from_program=data["from_program"],
                from_program_name=data["from_program_name"],
                to_program=data["to_program"],
                to_program_name=data["to_program_name"],
                to_program_type=data["to_program_type"],
                total_source_points=data["total_source_points"],
                total_target_points=data["total_target_points"],
                ratio=data["ratio"] or 1.0,
                ratio_display=data["ratio_display"] or "1:1",
                transfer_time=data["transfer_time"] or "1-2 business days",
                portal_url=data["portal_url"] or "",
                booking_url=data["booking_url"] or "",
                steps=steps,
                covers_segments=data["covers_segments"],
            ))
        
        return summaries
    
    def _build_transfer_steps(
        self,
        from_program: str,
        from_program_name: str,
        to_program: str,
        to_program_name: str,
        points: int,
        portal_url: str,
        booking_url: str,
    ) -> list[str]:
        """Build step-by-step transfer instructions."""
        steps = [
            f"Log in to your {from_program_name} account",
            f"Navigate to the rewards portal: {portal_url}" if portal_url else "Navigate to the rewards portal",
            "Select 'Transfer Points' or 'Transfer to Partners'",
            f"Find and select {to_program_name}",
            f"Enter your {to_program_name} membership number",
            f"Transfer {points:,} points",
            "Wait for transfer to complete (check transfer time)",
        ]
        
        if booking_url:
            steps.append(f"Book at {booking_url} using your {to_program_name} points")
        
        return steps
    
    def _get_all_programs(self, segments: list[list[SegmentOption]]) -> set[str]:
        """Get all programs mentioned in segment options."""
        programs = set()
        for options in segments:
            for option in options:
                if option.award_program:
                    programs.add(option.award_program)
        return programs
    
    def _can_transfer(self, source: str, target: str) -> bool:
        """Check if source can transfer to target."""
        if source not in TRANSFER_GRAPH:
            return False
        config = TRANSFER_GRAPH[source]
        return target in config.get("airlines", []) + config.get("hotels", [])
    
    def _build_member_summaries(
        self,
        assignments: list[BookingAssignment],
        members: list[MemberBookingCapability],
        settlements: list[Settlement],
        split_method: SettlementSplitMethod,
    ) -> list[MemberBookingSummary]:
        """Build per-member summaries."""
        total_cash = sum(a.cash_amount for a in assignments)
        fair_shares = self._calculate_fair_shares(
            total_cash, members, assignments, split_method
        )
        
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
                fair_share=fair_shares[member.member_id],
                settlement_amount=settlement_amount,
                final_cost=fair_shares[member.member_id],
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
                if member_cash[member.member_id] > member.max_cash_budget + 0.01:
                    return False
        return True
    
    def _check_points(
        self,
        assignments: list[BookingAssignment],
        members: list[MemberBookingCapability],
    ) -> bool:
        """Check if all members stayed within their own points balances."""
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
                    available = self._get_max_transferable(member, program)
                if used > available:
                    return False
        
        return True
    
    def _get_max_transferable(
        self,
        member: MemberBookingCapability,
        program: str,
    ) -> int:
        """Get max points member could have in program (direct + transfers)."""
        total = member.points.get(program, 0)
        
        for bank, config in TRANSFER_GRAPH.items():
            if program in config.get("airlines", []) + config.get("hotels", []):
                ratio = config.get("ratios", {}).get(program, 1.0)
                total += int(member.points.get(bank, 0) * ratio)
        
        return total
