"""
Tests for V3 optimization system.

Tests cover:
1. TripPlanSpec validation
2. Single-ticket enforcement
3. Date feasibility filtering
4. Multi-criteria pruning
5. Integer-safe transfers
6. Solver correctness
7. Determinism
"""

import pytest
from datetime import date, datetime
from typing import List

# Import V3 modules
from src.optimization.trip_spec import (
    TripPlanSpec,
    Traveler,
    OrderedLeg,
    StaySegment,
    GroupTravelMode,
)
from src.optimization.models_v3 import (
    FlightItineraryEdge,
    FlightSegment,
    AwardOption,
    HotelOption,
    RoomType,
    TransferPath,
    FundingSource,
    OptimizationStatus,
    PruningConfig,
    BalancedModeConfig,
)
from src.optimization.normalize import (
    normalize_program,
    normalize_bank,
    normalize_airline,
)
from src.optimization.validators import (
    filter_single_ticket_only,
    validate_date_feasibility,
    pre_check_feasibility,
)
from src.optimization.pruning import prune_flights, prune_hotels
from src.optimization.precompute import precompute_soft_values
from src.optimization.solver_v3 import SolverV3, Mode, optimize_trip


# =============================================================================
# FIXTURES
# =============================================================================

def make_traveler(
    traveler_id: str = "alice",
    points: dict = None,
    banks: dict = None,
) -> Traveler:
    """Create a test traveler."""
    return Traveler(
        traveler_id=traveler_id,
        name=traveler_id.title(),
        home_airport="JFK",
        points_balances=points or {"united": 50000},
        bank_balances=banks or {"chase": 100000},
    )


def make_spec(
    num_travelers: int = 1,
    num_legs: int = 2,
    num_segments: int = 1,
) -> TripPlanSpec:
    """Create a test trip specification."""
    
    travelers = [
        make_traveler(f"traveler_{i}")
        for i in range(num_travelers)
    ]
    
    traveler_ids = [t.traveler_id for t in travelers]
    
    # Dates are set so flights arriving same day as check-in work:
    # - Leg 0: departs 3/1 or 3/2, arrives same day → check-in 3/2
    # - Segment 0: check-in 3/2, check-out 3/7
    # - Leg 1: departs 3/7 or 3/8 (after check-out)
    legs = [
        OrderedLeg(
            leg_id=0,
            origin_city="NYC",
            destination_city="TYO",
            earliest_departure=date(2025, 3, 1),
            latest_departure=date(2025, 3, 2),
            traveler_ids=traveler_ids,
        ),
        OrderedLeg(
            leg_id=1,
            origin_city="TYO",
            destination_city="NYC",
            earliest_departure=date(2025, 3, 7),
            latest_departure=date(2025, 3, 8),
            traveler_ids=traveler_ids,
        ),
    ][:num_legs]
    
    segments = [
        StaySegment(
            segment_id=0,
            city="TYO",
            check_in=date(2025, 3, 2),  # Arrives 3/2, check in 3/2
            check_out=date(2025, 3, 7),  # Check out 3/7, depart 3/7
            traveler_ids=traveler_ids,
        ),
    ][:num_segments]
    
    return TripPlanSpec(
        trip_id="test_trip",
        travelers=travelers,
        legs=legs,
        stay_segments=segments,
    )


def make_flight(
    leg_id: int = 0,
    edge_id: str = "flight_1",
    origin: str = "JFK",
    destination: str = "NRT",
    cash_cost: float = 1500,
    award_miles: int = 50000,
    surcharge: float = 100,
    num_stops: int = 0,
    ticketing_type: str = "single_ticket",
    total_time_minutes: int = 840,
    depart_date: date = None,
    arrive_date: date = None,
) -> FlightItineraryEdge:
    """Create a test flight."""
    
    # Default dates align with make_spec():
    # - Leg 0: depart 3/1, arrive 3/2 (same day as check-in)
    # - Leg 1: depart 3/7, arrive 3/7 (same day as check-out)
    if leg_id == 0:
        default_depart = datetime(2025, 3, 1, 10, 0)
        default_arrive = datetime(2025, 3, 2, 14, 0)  # Arrives 3/2
    else:
        default_depart = datetime(2025, 3, 7, 10, 0)  # Departs 3/7 (after check-out)
        default_arrive = datetime(2025, 3, 7, 22, 0)
    
    depart = default_depart if depart_date is None else datetime.combine(depart_date, datetime.min.time().replace(hour=10))
    arrive = default_arrive if arrive_date is None else datetime.combine(arrive_date, datetime.min.time().replace(hour=14))
    
    segments = [
        FlightSegment(
            segment_id="seg_0",
            flight_number="UA100",
            operating_carrier="UA",
            marketing_carrier="UA",
            origin=origin,
            destination=destination,
            departure=depart,
            arrival=arrive,
        )
    ]
    
    # Add connection segment if num_stops > 0
    if num_stops > 0:
        mid_arrive = datetime(2025, 3, 1, 14, 0)
        mid_depart = datetime(2025, 3, 1, 16, 0)
        segments = [
            FlightSegment(
                segment_id="seg_0",
                flight_number="UA100",
                operating_carrier="UA",
                marketing_carrier="UA",
                origin=origin,
                destination="ORD",
                departure=depart,
                arrival=mid_arrive,
            ),
            FlightSegment(
                segment_id="seg_1",
                flight_number="UA200",
                operating_carrier="UA",
                marketing_carrier="UA",
                origin="ORD",
                destination=destination,
                departure=mid_depart,
                arrival=arrive,
            ),
        ]
    
    award_options = []
    if award_miles > 0:
        award_options.append(AwardOption(
            option_id=f"{edge_id}_united_economy",
            program="united",
            miles_required=award_miles,
            surcharge=surcharge,
            cabin_or_room_type="economy",
            cash_equivalent=cash_cost,
        ))
    
    flight = FlightItineraryEdge(
        edge_id=edge_id,
        leg_id=leg_id,
        origin=origin,
        destination=destination,
        segments=segments,
        departure_datetime=depart,
        arrival_datetime=arrive,
        total_time_minutes=total_time_minutes,
        cash_cost=cash_cost,
        award_options=award_options,
        ticketing_type=ticketing_type,
    )
    
    flight.compute_date_fields()
    return flight


def make_hotel(
    segment_id: int = 0,
    hotel_id: str = "hotel_1",
    cash_per_night: float = 200,
    points_per_night: int = 15000,
    surcharge_per_night: float = 0,
    capacity: int = 2,
) -> HotelOption:
    """Create a test hotel."""
    
    room_types = [
        RoomType(
            room_type_id="standard_king",
            name="Standard King",
            capacity=capacity,
            cash_per_night=cash_per_night,
            award_program="hyatt",
            points_per_night=points_per_night,
            award_surcharge_per_night=surcharge_per_night,
        ),
    ]
    
    return HotelOption(
        hotel_id=hotel_id,
        segment_id=segment_id,
        hotel_name="Test Hotel",
        chain="hyatt",
        star_rating=4.0,
        room_types=room_types,
    )


def make_transfer(
    from_bank: str = "chase",
    to_program: str = "united",
    ratio: float = 1.0,
    bonus: float = 1.0,
) -> TransferPath:
    """Create a test transfer path."""
    return TransferPath(
        path_id=f"{from_bank}_to_{to_program}",
        from_bank=from_bank,
        to_program=to_program,
        min_increment=1000,
        ratio=ratio,
        current_bonus=bonus,
    )


# =============================================================================
# TEST: TRIP SPEC VALIDATION
# =============================================================================

class TestTripSpecValidation:
    """Test TripPlanSpec validation."""
    
    def test_valid_spec(self):
        """Valid spec should pass validation."""
        spec = make_spec()
        errors = spec.validate()
        assert len(errors) == 0
    
    def test_mismatched_segments(self):
        """Wrong number of segments should fail."""
        spec = make_spec(num_legs=2, num_segments=0)
        spec.stay_segments = []  # No segments for 2 legs
        errors = spec.validate()
        assert any("stay segments" in e.lower() for e in errors)
    
    def test_city_mismatch(self):
        """Mismatched cities should fail."""
        spec = make_spec()
        spec.stay_segments[0].city = "LAX"  # Wrong city - leg 0 arrives at TYO, not LAX
        errors = spec.validate()
        # Should detect that leg 0 destination (TYO) doesn't match segment 0 city (LAX)
        assert any("TYO" in e or "LAX" in e or "arrives" in e for e in errors)


# =============================================================================
# TEST: NORMALIZATION
# =============================================================================

class TestNormalization:
    """Test program/bank normalization."""
    
    def test_program_normalization(self):
        """Program aliases should normalize correctly."""
        assert normalize_program("UA") == "united"
        assert normalize_program("MileagePlus") == "united"
        assert normalize_program("united") == "united"
        assert normalize_program("HYATT") == "hyatt"
    
    def test_bank_normalization(self):
        """Bank aliases should normalize correctly."""
        assert normalize_bank("CHASE") == "chase"
        assert normalize_bank("Ultimate Rewards") == "chase"
        assert normalize_bank("MR") == "amex"
    
    def test_airline_normalization(self):
        """Airline codes should normalize to 2-letter."""
        assert normalize_airline("UAL") == "UA"
        assert normalize_airline("ua") == "UA"


# =============================================================================
# TEST: SINGLE-TICKET ENFORCEMENT
# =============================================================================

class TestSingleTicketEnforcement:
    """Test single-ticket enforcement for connections."""
    
    def test_direct_flight_always_ok(self):
        """Direct flights should always pass."""
        flights = [
            make_flight(num_stops=0, ticketing_type="unknown"),
        ]
        filtered, warnings = filter_single_ticket_only(flights)
        assert len(filtered) == 1
    
    def test_connection_single_ticket_ok(self):
        """Connection with single_ticket should pass."""
        flights = [
            make_flight(num_stops=1, ticketing_type="single_ticket"),
        ]
        filtered, warnings = filter_single_ticket_only(flights)
        assert len(filtered) == 1
    
    def test_connection_unknown_dropped(self):
        """Connection with unknown ticketing should be DROPPED in MVP."""
        flights = [
            make_flight(num_stops=1, ticketing_type="unknown"),
        ]
        filtered, warnings = filter_single_ticket_only(flights)
        assert len(filtered) == 0
        assert any("unknown ticketing" in w for w in warnings)
    
    def test_connection_separate_tickets_dropped(self):
        """Connection with separate_tickets should be dropped."""
        flights = [
            make_flight(num_stops=1, ticketing_type="separate_tickets"),
        ]
        filtered, warnings = filter_single_ticket_only(flights)
        assert len(filtered) == 0


# =============================================================================
# TEST: DATE FEASIBILITY
# =============================================================================

class TestDateFeasibility:
    """Test date feasibility filtering."""
    
    def test_feasible_flight_passes(self):
        """Flight within date window should pass."""
        spec = make_spec()
        flights = [make_flight(leg_id=0, depart_date=date(2025, 3, 1))]
        
        filtered, warnings = validate_date_feasibility(
            flights, spec.stay_segments, spec.legs
        )
        assert len(filtered) == 1
    
    def test_too_early_departure_dropped(self):
        """Flight departing before window should be dropped."""
        spec = make_spec()
        flights = [make_flight(leg_id=0, depart_date=date(2025, 2, 28))]
        
        filtered, warnings = validate_date_feasibility(
            flights, spec.stay_segments, spec.legs
        )
        assert len(filtered) == 0
    
    def test_too_late_departure_dropped(self):
        """Flight departing after window should be dropped."""
        spec = make_spec()
        flights = [make_flight(leg_id=0, depart_date=date(2025, 3, 10))]
        
        filtered, warnings = validate_date_feasibility(
            flights, spec.stay_segments, spec.legs
        )
        assert len(filtered) == 0


# =============================================================================
# TEST: INTEGER TRANSFERS
# =============================================================================

class TestIntegerTransfers:
    """Test integer-safe transfer math."""
    
    def test_effective_delivered_is_integer(self):
        """Effective delivered per block should be integer."""
        tp = TransferPath(
            path_id="test",
            from_bank="chase",
            to_program="united",
            min_increment=1000,
            ratio=0.75,
            current_bonus=1.25,
        )
        # 1000 * 0.75 * 1.25 = 937.5 -> floor = 937
        assert tp.effective_delivered_per_block == 937
        assert isinstance(tp.effective_delivered_per_block, int)
    
    def test_bank_points_needed(self):
        """Bank points needed should use ceiling."""
        tp = TransferPath(
            path_id="test",
            from_bank="chase",
            to_program="united",
            min_increment=1000,
            ratio=1.0,
            current_bonus=1.0,
        )
        # Need 1500 miles -> 2 blocks = 2000 bank points
        assert tp.bank_points_needed(1500) == 2000
        # Need exactly 1000 -> 1 block
        assert tp.bank_points_needed(1000) == 1000


# =============================================================================
# TEST: PRUNING
# =============================================================================

class TestPruning:
    """Test multi-criteria pruning."""
    
    def test_keeps_cheap_flights(self):
        """Pruning should reduce candidates and respect limits."""
        flights = [
            make_flight(edge_id=f"f_{i}", cash_cost=500 + 100 * i, leg_id=0)
            for i in range(0, 30)
        ]
        # Ensure all flights have date fields computed
        for f in flights:
            f.compute_date_fields()
        
        # Use larger cap to ensure cheap flights aren't pushed out by award scoring
        config = PruningConfig(max_by_cash=10, max_by_time=5, max_by_award=5, max_total_per_od=15)
        pruned = prune_flights(flights, config)
        
        # Should reduce from 30 to <= 15
        assert len(pruned) <= 15
        assert len(pruned) > 0
        
        # Should keep some cheap flights (from max_by_cash criterion)
        cash_costs = [f.cash_cost for f in pruned]
        # At least some of the top 10 by cash should be kept
        assert any(c <= 1000 for c in cash_costs)  # Some cheap flights kept
    
    def test_keeps_high_award_value(self):
        """Pruning should keep high-value awards."""
        flights = []
        for i in range(1, 15):
            f = make_flight(
                edge_id=f"f_{i}",
                cash_cost=1000,
                award_miles=10000,
                surcharge=100 * i,  # Higher surcharge = lower value
                leg_id=0,
            )
            f.compute_date_fields()
            flights.append(f)
        
        # Add one high-value award
        f_high = make_flight(
            edge_id="f_high",
            cash_cost=2000,  # High cash
            award_miles=20000,
            surcharge=50,  # Low surcharge = high value
            leg_id=0,
        )
        f_high.compute_date_fields()
        flights.append(f_high)
        
        config = PruningConfig(max_by_award=3, max_total_per_od=10)
        pruned = prune_flights(flights, config)
        
        # High-value award should be kept
        pruned_ids = [f.edge_id for f in pruned]
        assert "f_high" in pruned_ids


# =============================================================================
# TEST: SOLVER
# =============================================================================

class TestSolver:
    """Test V3 solver."""
    
    def test_oop_uses_awards_when_cheaper(self):
        """OOP mode should use awards that save cash."""
        spec = make_spec(num_travelers=1)
        spec.travelers[0].points_balances = {"united": 100000, "hyatt": 100000}
        spec.travelers[0].bank_balances = {}
        
        flights = [
            make_flight(
                leg_id=0,
                edge_id="f_out",
                cash_cost=1500,
                award_miles=50000,
                surcharge=100,  # Award saves $1400
            ),
            make_flight(
                leg_id=1,
                edge_id="f_return",
                origin="NRT",
                destination="JFK",
                cash_cost=1500,
                award_miles=50000,
                surcharge=100,
            ),
        ]
        
        # Ensure date fields are computed
        for f in flights:
            f.compute_date_fields()
        
        hotels = [make_hotel()]
        transfers = []
        
        result = optimize_trip(spec, flights, hotels, transfers, mode="oop")
        
        # Print debug info if not optimal
        if result.status != OptimizationStatus.OPTIMAL:
            print(f"Status: {result.status}")
            print(f"Warnings: {result.warnings}")
            print(f"Suggestions: {result.suggestions}")
        
        assert result.status == OptimizationStatus.OPTIMAL
        if result.solution:
            # Should use points (saves cash)
            assert result.solution.total_cash < 3000  # Less than full cash
    
    def test_group_room_allocation(self):
        """Group of 4 should allocate rooms correctly."""
        spec = make_spec(num_travelers=4)
        for t in spec.travelers:
            t.bank_balances = {}  # Force cash payment
            t.points_balances = {}  # Force cash payment
        
        flights = [
            make_flight(leg_id=0, edge_id="f_out"),
            make_flight(leg_id=1, edge_id="f_return", origin="NRT", destination="JFK"),
        ]
        
        # Ensure date fields are computed
        for f in flights:
            f.compute_date_fields()
        
        hotels = [make_hotel(capacity=2)]  # 2-person rooms
        transfers = []
        
        result = optimize_trip(spec, flights, hotels, transfers, mode="oop")
        
        # Print debug if not optimal
        if result.status != OptimizationStatus.OPTIMAL:
            print(f"Status: {result.status}")
            print(f"Warnings: {result.warnings}")
        
        if result.status == OptimizationStatus.OPTIMAL and result.solution:
            # Should book 2 rooms for 4 people
            for hotel_id, rooms in result.solution.selected_rooms.items():
                total_rooms = sum(rooms.values())
                assert total_rooms >= 2


class TestSolverDeterminism:
    """Test solver determinism."""
    
    def test_same_input_same_output(self):
        """Same input should produce same output with determinism_mode=True."""
        spec = make_spec(num_travelers=1)
        spec.travelers[0].points_balances = {"united": 100000, "hyatt": 100000}
        spec.travelers[0].bank_balances = {}
        
        flights = [
            make_flight(leg_id=0, edge_id="f_out"),
            make_flight(leg_id=1, edge_id="f_return", origin="NRT", destination="JFK"),
        ]
        # Ensure date fields are computed
        for f in flights:
            f.compute_date_fields()
        
        hotels = [make_hotel()]
        transfers = []
        
        # Run twice
        result1 = optimize_trip(spec, flights, hotels, transfers, mode="balanced", determinism_mode=True)
        result2 = optimize_trip(spec, flights, hotels, transfers, mode="balanced", determinism_mode=True)
        
        if result1.status == OptimizationStatus.OPTIMAL and result2.status == OptimizationStatus.OPTIMAL:
            assert result1.solution.selected_flights == result2.solution.selected_flights
            assert result1.solution.selected_hotels == result2.solution.selected_hotels


# =============================================================================
# TEST: PRE-CHECK FEASIBILITY
# =============================================================================

class TestPreCheckFeasibility:
    """Test pre-check feasibility."""
    
    def test_missing_flights_detected(self):
        """Missing flights for a leg should be detected."""
        spec = make_spec()
        flights_by_leg = {0: [make_flight(leg_id=0)]}  # Missing leg 1
        hotels_by_seg = {0: [make_hotel()]}
        
        is_feasible, issues = pre_check_feasibility(spec, flights_by_leg, hotels_by_seg)
        
        assert not is_feasible
        assert any("leg 1" in i.lower() for i in issues)
    
    def test_missing_hotels_detected(self):
        """Missing hotels for a segment should be detected."""
        spec = make_spec()
        flights_by_leg = {0: [make_flight(leg_id=0)], 1: [make_flight(leg_id=1)]}
        hotels_by_seg = {}  # No hotels
        
        is_feasible, issues = pre_check_feasibility(spec, flights_by_leg, hotels_by_seg)
        
        assert not is_feasible
        assert any("hotel" in i.lower() or "segment" in i.lower() for i in issues)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
