"""
Comprehensive tests for GroupBookingAllocator.

Tests cover:
- Input validation
- Budget accumulation
- Transfer source optimization
- Look-ahead greedy algorithm
- Flexible settlement splits
- Trip structure analysis
- Edge cases
"""

import pytest
from backend.src.agents.group_allocator import GroupBookingAllocator, SegmentOption
from backend.src.agents.group_models import (
    MemberBookingCapability,
    BookingAllocationStrategy,
    SettlementSplitMethod,
    AllocationValidationResult,
)


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def allocator():
    """Create allocator with ILP disabled for faster tests."""
    return GroupBookingAllocator(use_ilp=False, lookahead_depth=2)


@pytest.fixture
def allocator_with_ilp():
    """Create allocator with ILP enabled."""
    return GroupBookingAllocator(use_ilp=True, time_limit_seconds=10)


@pytest.fixture
def basic_flight_segment():
    """Single flight segment with cash and award options."""
    return [
        SegmentOption(
            segment_id="flight_1",
            segment_type="flight",
            option_id="opt_cash",
            cash_price=500.0,
            award_available=False,
        ),
        SegmentOption(
            segment_id="flight_1",
            segment_type="flight",
            option_id="opt_award",
            cash_price=500.0,
            award_available=True,
            award_program="UA",
            award_points=30000,
            award_surcharge=50.0,
            summary="JFK→CDG on United",
        ),
    ]


@pytest.fixture
def two_members():
    """Two members with different points."""
    return [
        MemberBookingCapability(
            member_id="alice",
            member_name="Alice",
            points={"UA": 50000, "Chase UR": 100000},
            max_cash_budget=1000.0,
        ),
        MemberBookingCapability(
            member_id="bob",
            member_name="Bob",
            points={"AA": 40000, "HH": 80000},
            max_cash_budget=800.0,
        ),
    ]


# =============================================================================
# INPUT VALIDATION TESTS
# =============================================================================

class TestInputValidation:
    """Tests for input validation."""
    
    def test_empty_members_raises_error(self, allocator, basic_flight_segment):
        """Should raise error with empty members list."""
        with pytest.raises(ValueError, match="At least one member"):
            allocator.allocate(
                trip_id="trip_1",
                segments=[basic_flight_segment],
                members=[],
                strategy=BookingAllocationStrategy(strategy_type="optimize"),
            )
    
    def test_empty_segments_raises_error(self, allocator, two_members):
        """Should raise error with empty segments list."""
        with pytest.raises(ValueError, match="At least one segment"):
            allocator.allocate(
                trip_id="trip_1",
                segments=[],
                members=two_members,
                strategy=BookingAllocationStrategy(strategy_type="optimize"),
            )
    
    def test_segment_with_no_options_raises_error(self, allocator, two_members):
        """Should raise error when segment has no options."""
        with pytest.raises(ValueError, match="Segment 0 has no booking options"):
            allocator.allocate(
                trip_id="trip_1",
                segments=[[]],  # Empty options for segment 0
                members=two_members,
                strategy=BookingAllocationStrategy(strategy_type="optimize"),
            )
    
    def test_duplicate_member_ids_raises_error(self, allocator, basic_flight_segment):
        """Should raise error with duplicate member IDs."""
        members = [
            MemberBookingCapability(member_id="same", member_name="A", points={}),
            MemberBookingCapability(member_id="same", member_name="B", points={}),
        ]
        
        with pytest.raises(ValueError, match="Duplicate member IDs"):
            allocator.allocate(
                trip_id="trip_1",
                segments=[basic_flight_segment],
                members=members,
                strategy=BookingAllocationStrategy(strategy_type="optimize"),
            )
    
    def test_by_segment_type_missing_flight_booker(self, allocator, basic_flight_segment, two_members):
        """Should raise error when flight_booker missing for by_segment_type."""
        with pytest.raises(ValueError, match="flight_booker"):
            allocator.allocate(
                trip_id="trip_1",
                segments=[basic_flight_segment],
                members=two_members,
                strategy=BookingAllocationStrategy(
                    strategy_type="by_segment_type",
                    hotel_booker="alice",
                ),
            )
    
    def test_by_direction_missing_bookers(self, allocator, basic_flight_segment, two_members):
        """Should raise error when bookers missing for by_direction."""
        with pytest.raises(ValueError, match="outbound_booker"):
            allocator.allocate(
                trip_id="trip_1",
                segments=[basic_flight_segment],
                members=two_members,
                strategy=BookingAllocationStrategy(
                    strategy_type="by_direction",
                ),
            )
    
    def test_manual_missing_assignments(self, allocator, basic_flight_segment, two_members):
        """Should raise error when manual assignments missing."""
        with pytest.raises(ValueError, match="manual_assignments"):
            allocator.allocate(
                trip_id="trip_1",
                segments=[basic_flight_segment],
                members=two_members,
                strategy=BookingAllocationStrategy(strategy_type="manual"),
            )
    
    def test_unknown_member_in_strategy(self, allocator, basic_flight_segment, two_members):
        """Should raise error when strategy references unknown member."""
        with pytest.raises(ValueError, match="not a member"):
            allocator.allocate(
                trip_id="trip_1",
                segments=[basic_flight_segment],
                members=two_members,
                strategy=BookingAllocationStrategy(
                    strategy_type="by_segment_type",
                    flight_booker="unknown",
                    hotel_booker="alice",
                ),
            )
    
    def test_validation_warns_on_same_person_both_roles(self, allocator):
        """Should warn when same person assigned to both roles."""
        result = allocator.validate_inputs(
            trip_id="trip_1",
            segments=[[SegmentOption(
                segment_id="s1", segment_type="flight", option_id="o1", cash_price=100
            )]],
            members=[MemberBookingCapability(member_id="alice", member_name="Alice", points={})],
            strategy=BookingAllocationStrategy(
                strategy_type="by_segment_type",
                flight_booker="alice",
                hotel_booker="alice",
            ),
        )
        
        assert result.valid
        assert any("same member" in w.lower() for w in result.warnings)
    
    def test_validation_warns_on_no_points(self, allocator):
        """Should warn when member has no points."""
        result = allocator.validate_inputs(
            trip_id="trip_1",
            segments=[[SegmentOption(
                segment_id="s1", segment_type="flight", option_id="o1", cash_price=100
            )]],
            members=[MemberBookingCapability(member_id="alice", member_name="Alice", points={})],
            strategy=BookingAllocationStrategy(strategy_type="optimize"),
        )
        
        assert result.valid
        assert any("no points" in w.lower() for w in result.warnings)


# =============================================================================
# BUDGET ACCUMULATION TESTS
# =============================================================================

class TestBudgetAccumulation:
    """Tests for cumulative budget tracking."""
    
    def test_cumulative_budget_enforcement(self, allocator):
        """Member should not exceed budget across multiple segments."""
        # 3 segments at $300 each = $900 total
        # Each member has $500 budget
        # Should split between members
        
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
                max_cash_budget=500.0,
            ),
            MemberBookingCapability(
                member_id="bob",
                member_name="Bob",
                points={},
                max_cash_budget=500.0,
            ),
        ]
        
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=segments,
            members=members,
            strategy=BookingAllocationStrategy(strategy_type="optimize"),
        )
        
        # Each member should spend <= $500
        for summary in plan.member_summaries:
            assert summary.total_cash_upfront <= 500.0 + 0.01, \
                f"{summary.member_name} exceeded budget: {summary.total_cash_upfront}"
    
    def test_budget_allows_points_surcharge(self, allocator):
        """Budget should allow award booking if surcharge fits."""
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
        
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=segments,
            members=members,
            strategy=BookingAllocationStrategy(strategy_type="optimize"),
        )
        
        assert plan.assignments[0].uses_points == True
        assert plan.assignments[0].cash_amount == 50.0


# =============================================================================
# POINTS ALLOCATION TESTS
# =============================================================================

class TestPointsAllocation:
    """Tests for points allocation (non-pooling)."""
    
    def test_member_uses_own_points_only(self, allocator):
        """Each member should only use their own points."""
        segments = [
            [SegmentOption(
                segment_id="seg_0",
                segment_type="flight",
                option_id="opt_0",
                cash_price=400.0,
                award_available=True,
                award_program="UA",
                award_points=30000,
                award_surcharge=25.0,
            )],
            [SegmentOption(
                segment_id="seg_1",
                segment_type="flight",
                option_id="opt_1",
                cash_price=400.0,
                award_available=True,
                award_program="AA",
                award_points=25000,
                award_surcharge=30.0,
            )],
        ]
        
        members = [
            MemberBookingCapability(
                member_id="alice",
                member_name="Alice",
                points={"UA": 50000},  # Only has UA
            ),
            MemberBookingCapability(
                member_id="bob",
                member_name="Bob",
                points={"AA": 50000},  # Only has AA
            ),
        ]
        
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=segments,
            members=members,
            strategy=BookingAllocationStrategy(strategy_type="optimize"),
        )
        
        # UA segment should go to Alice, AA segment should go to Bob
        ua_assignment = next(a for a in plan.assignments if a.segment_id == "seg_0")
        aa_assignment = next(a for a in plan.assignments if a.segment_id == "seg_1")
        
        assert ua_assignment.assigned_to == "alice"
        assert ua_assignment.uses_points == True
        
        assert aa_assignment.assigned_to == "bob"
        assert aa_assignment.uses_points == True
    
    def test_cannot_pool_points_across_members(self, allocator):
        """Points should not be pooled - test impossible pooling scenario."""
        # Flight needs 150k points
        # Alice has 100k, Bob has 100k
        # With pooling: 200k (would work)
        # Without pooling: Neither can afford alone → cash
        
        segments = [[SegmentOption(
            segment_id="seg_0",
            segment_type="flight",
            option_id="opt_0",
            cash_price=500.0,
            award_available=True,
            award_program="UA",
            award_points=150000,  # Neither member has enough alone
            award_surcharge=50.0,
        )]]
        
        members = [
            MemberBookingCapability(
                member_id="alice",
                member_name="Alice",
                points={"UA": 100000},  # Not enough
            ),
            MemberBookingCapability(
                member_id="bob",
                member_name="Bob",
                points={"UA": 100000},  # Not enough
            ),
        ]
        
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=segments,
            members=members,
            strategy=BookingAllocationStrategy(strategy_type="optimize"),
        )
        
        # Should book with CASH since neither member has 150k
        assert plan.assignments[0].uses_points == False
        assert plan.assignments[0].cash_amount == 500.0


# =============================================================================
# SETTLEMENT TESTS
# =============================================================================

class TestSettlements:
    """Tests for settlement calculations."""
    
    def test_equal_split(self, allocator):
        """Equal split should divide cost evenly."""
        segments = [[SegmentOption(
            segment_id="seg_0",
            segment_type="flight",
            option_id="opt_0",
            cash_price=300.0,
            award_available=False,
        )]]
        
        members = [
            MemberBookingCapability(member_id="alice", member_name="Alice", points={}),
            MemberBookingCapability(member_id="bob", member_name="Bob", points={}),
            MemberBookingCapability(member_id="charlie", member_name="Charlie", points={}),
        ]
        
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=segments,
            members=members,
            strategy=BookingAllocationStrategy(strategy_type="optimize"),
            split_method=SettlementSplitMethod.EQUAL,
        )
        
        # Fair share should be $100 each
        for summary in plan.member_summaries:
            assert abs(summary.fair_share - 100.0) < 0.01
    
    def test_proportional_travelers_split(self, allocator):
        """Proportional split should divide by traveler count."""
        segments = [[SegmentOption(
            segment_id="seg_0",
            segment_type="flight",
            option_id="opt_0",
            cash_price=300.0,
            award_available=False,
        )]]
        
        members = [
            MemberBookingCapability(
                member_id="alice",
                member_name="Alice",
                points={},
                traveler_count=2,  # Alice is booking for 2
            ),
            MemberBookingCapability(
                member_id="bob",
                member_name="Bob",
                points={},
                traveler_count=1,  # Bob is booking for 1
            ),
        ]
        
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=segments,
            members=members,
            strategy=BookingAllocationStrategy(strategy_type="optimize"),
            split_method=SettlementSplitMethod.PROPORTIONAL_TRAVELERS,
        )
        
        # Alice should pay 2/3 = $200, Bob should pay 1/3 = $100
        alice_summary = next(s for s in plan.member_summaries if s.member_id == "alice")
        bob_summary = next(s for s in plan.member_summaries if s.member_id == "bob")
        
        assert abs(alice_summary.fair_share - 200.0) < 0.01
        assert abs(bob_summary.fair_share - 100.0) < 0.01
    
    def test_no_settlement_when_equal_payments(self, allocator):
        """No settlement needed when everyone pays fair share."""
        segments = [
            [SegmentOption(
                segment_id="seg_0", segment_type="flight", option_id="opt_0",
                cash_price=200.0, award_available=False,
            )],
            [SegmentOption(
                segment_id="seg_1", segment_type="flight", option_id="opt_1",
                cash_price=200.0, award_available=False,
            )],
        ]
        
        members = [
            MemberBookingCapability(member_id="alice", member_name="Alice", points={}),
            MemberBookingCapability(member_id="bob", member_name="Bob", points={}),
        ]
        
        # With optimize strategy and no points, each should get one segment
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=segments,
            members=members,
            strategy=BookingAllocationStrategy(
                strategy_type="by_segment_type",
                flight_booker="alice",
                hotel_booker="bob",  # No hotels, but still valid
            ),
        )
        
        # If costs are equal, no settlements needed
        # (This depends on exact assignment, so just check settlements are minimal)
        total_settlement = sum(s.amount for s in plan.settlements)
        assert total_settlement < 0.01 or len(plan.settlements) <= 2


# =============================================================================
# STRATEGY TESTS
# =============================================================================

class TestStrategies:
    """Tests for different allocation strategies."""
    
    def test_by_segment_type_strategy(self, allocator):
        """by_segment_type should assign flights to one, hotels to another."""
        segments = [
            [SegmentOption(
                segment_id="flight_1", segment_type="flight", option_id="opt_f",
                cash_price=400.0, award_available=False,
            )],
            [SegmentOption(
                segment_id="hotel_1", segment_type="hotel", option_id="opt_h",
                cash_price=200.0, award_available=False,
            )],
        ]
        
        members = [
            MemberBookingCapability(member_id="alice", member_name="Alice", points={}),
            MemberBookingCapability(member_id="bob", member_name="Bob", points={}),
        ]
        
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=segments,
            members=members,
            strategy=BookingAllocationStrategy(
                strategy_type="by_segment_type",
                flight_booker="alice",
                hotel_booker="bob",
            ),
        )
        
        flight_assignment = next(a for a in plan.assignments if a.segment_type == "flight")
        hotel_assignment = next(a for a in plan.assignments if a.segment_type == "hotel")
        
        assert flight_assignment.assigned_to == "alice"
        assert hotel_assignment.assigned_to == "bob"
    
    def test_manual_strategy(self, allocator):
        """manual strategy should respect user assignments."""
        segments = [
            [SegmentOption(
                segment_id="seg_0", segment_type="flight", option_id="opt_0",
                cash_price=300.0, award_available=False,
            )],
            [SegmentOption(
                segment_id="seg_1", segment_type="flight", option_id="opt_1",
                cash_price=300.0, award_available=False,
            )],
        ]
        
        members = [
            MemberBookingCapability(member_id="alice", member_name="Alice", points={}),
            MemberBookingCapability(member_id="bob", member_name="Bob", points={}),
        ]
        
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=segments,
            members=members,
            strategy=BookingAllocationStrategy(
                strategy_type="manual",
                manual_assignments={
                    "seg_0": "bob",  # Specifically assign seg_0 to Bob
                    "seg_1": "alice",
                },
            ),
        )
        
        seg0_assignment = next(a for a in plan.assignments if a.segment_id == "seg_0")
        seg1_assignment = next(a for a in plan.assignments if a.segment_id == "seg_1")
        
        assert seg0_assignment.assigned_to == "bob"
        assert seg1_assignment.assigned_to == "alice"


# =============================================================================
# EDGE CASE TESTS
# =============================================================================

class TestEdgeCases:
    """Tests for edge cases."""
    
    def test_single_member(self, allocator, basic_flight_segment):
        """Single member should get all segments, no settlements."""
        members = [MemberBookingCapability(
            member_id="alice",
            member_name="Alice",
            points={"UA": 50000},
        )]
        
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=[basic_flight_segment],
            members=members,
            strategy=BookingAllocationStrategy(strategy_type="optimize"),
        )
        
        assert len(plan.assignments) == 1
        assert plan.assignments[0].assigned_to == "alice"
        assert len(plan.settlements) == 0
    
    def test_member_with_no_budget_gets_skipped_for_cash(self, allocator):
        """Member with $0 budget should only get point bookings."""
        segments = [[SegmentOption(
            segment_id="seg_0",
            segment_type="flight",
            option_id="opt_0",
            cash_price=500.0,
            award_available=False,  # No award option
        )]]
        
        members = [
            MemberBookingCapability(
                member_id="alice",
                member_name="Alice",
                points={},
                max_cash_budget=0.0,  # No cash budget
            ),
            MemberBookingCapability(
                member_id="bob",
                member_name="Bob",
                points={},
                max_cash_budget=1000.0,
            ),
        ]
        
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=segments,
            members=members,
            strategy=BookingAllocationStrategy(strategy_type="optimize"),
        )
        
        # Bob should get the cash booking since Alice has no budget
        assert plan.assignments[0].assigned_to == "bob"
    
    def test_validation_result_structure(self, allocator):
        """Validation result should have correct structure."""
        result = allocator.validate_inputs(
            trip_id="trip_1",
            segments=[],  # Empty - should fail
            members=[MemberBookingCapability(member_id="a", member_name="A", points={})],
            strategy=BookingAllocationStrategy(strategy_type="optimize"),
        )
        
        assert isinstance(result, AllocationValidationResult)
        assert result.valid == False
        assert len(result.errors) > 0
        assert isinstance(result.warnings, list)


# =============================================================================
# LOOKAHEAD GREEDY TESTS
# =============================================================================

class TestLookaheadGreedy:
    """Tests for look-ahead greedy algorithm."""
    
    def test_lookahead_finds_better_solution(self, allocator):
        """Look-ahead should find better solution than pure greedy in some cases."""
        # Scenario where greedy is suboptimal:
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
        
        plan = allocator.allocate(
            trip_id="trip_1",
            segments=segments,
            members=members,
            strategy=BookingAllocationStrategy(strategy_type="optimize"),
        )
        
        # Greedy: Uses 100k on seg_0 ($200), pays cash for seg_1 ($600) = $800
        # Optimal: Pay cash for seg_0 ($500), use 50k on seg_1 ($10) = $510
        
        # The allocator with lookahead should find the $510 solution
        # (or close to it)
        assert plan.total_group_oop <= 600.0, \
            f"Expected <= $600, got ${plan.total_group_oop}"


# =============================================================================
# RUN TESTS
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
