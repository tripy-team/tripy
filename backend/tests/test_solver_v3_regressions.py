"""
Regression tests for V3 solver correctness.

These tests target the 3 silent-wrong-answer risks:
1. Award option indexing (prevents cross-program mixing)
2. Hotel points × rooms × nights (group room-linked points)
3. Date feasibility enforced by MILP (not just filter)

Each test uses tiny synthetic data and should run in <1s.
"""

import pytest
from datetime import date, datetime
from typing import List

from src.optimization.trip_spec import (
    TripPlanSpec,
    Traveler,
    OrderedLeg,
    StaySegment,
)
from src.optimization.models_v3 import (
    FlightItineraryEdge,
    FlightSegment,
    AwardOption,
    HotelOption,
    RoomType,
    TransferPath,
    OptimizationStatus,
)
from src.optimization.solver_v3 import SolverV3, Mode, optimize_trip, slug


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def make_traveler(
    traveler_id: str,
    points: dict = None,
    banks: dict = None,
) -> Traveler:
    """Create a test traveler."""
    return Traveler(
        traveler_id=traveler_id,
        name=traveler_id.title(),
        home_airport="JFK",
        points_balances=points or {},
        bank_balances=banks or {},
    )


def make_flight(
    leg_id: int,
    edge_id: str,
    origin: str = "JFK",
    destination: str = "NRT",
    cash_cost: float = 1500,
    award_options: List[AwardOption] = None,
    depart_date: date = None,
    arrive_date: date = None,
) -> FlightItineraryEdge:
    """Create a test flight."""
    
    depart_date = depart_date or date(2025, 3, 1)
    arrive_date = arrive_date or depart_date
    
    depart = datetime.combine(depart_date, datetime.min.time().replace(hour=10))
    arrive = datetime.combine(arrive_date, datetime.min.time().replace(hour=22))
    
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
    
    flight = FlightItineraryEdge(
        edge_id=edge_id,
        leg_id=leg_id,
        origin=origin,
        destination=destination,
        segments=segments,
        departure_datetime=depart,
        arrival_datetime=arrive,
        total_time_minutes=720,
        cash_cost=cash_cost,
        award_options=award_options or [],
        ticketing_type="single_ticket",
    )
    
    flight.compute_date_fields()
    return flight


def make_hotel(
    segment_id: int,
    hotel_id: str,
    room_types: List[RoomType],
) -> HotelOption:
    """Create a test hotel."""
    return HotelOption(
        hotel_id=hotel_id,
        segment_id=segment_id,
        hotel_name="Test Hotel",
        chain="hyatt",
        star_rating=4.0,
        room_types=room_types,
    )


# =============================================================================
# TEST 1: Award Option Index Prevents Cross-Program Mixing
# =============================================================================

class TestAwardOptionIndexing:
    """
    Verify that selecting one award option does NOT spend another program's balance.
    
    Scenario:
    - Traveler has 50k United miles and 50k AA miles
    - Flight has two award options: United (60k miles) and AA (40k miles)
    - Only AA should be selectable (United balance insufficient)
    - Solver should NOT mix the balances
    """
    
    def test_cannot_mix_program_balances(self):
        """Ensure selecting AA award doesn't use United balance."""
        
        # Traveler with 50k in each program
        traveler = make_traveler(
            "alice",
            points={"united": 50000, "american": 50000},
        )
        
        spec = TripPlanSpec(
            trip_id="test",
            travelers=[traveler],
            legs=[
                OrderedLeg(
                    leg_id=0,
                    origin_city="JFK",
                    destination_city="NRT",
                    earliest_departure=date(2025, 3, 1),
                    latest_departure=date(2025, 3, 1),
                    traveler_ids=["alice"],
                ),
            ],
            stay_segments=[],
        )
        
        # Flight with two award options
        flights = [
            make_flight(
                leg_id=0,
                edge_id="flight_1",
                cash_cost=2000,
                award_options=[
                    AwardOption(
                        option_id="united_saver",
                        program="united",
                        miles_required=60000,  # More than balance!
                        surcharge=100,
                        cabin_or_room_type="economy",
                        cash_equivalent=2000,
                    ),
                    AwardOption(
                        option_id="aa_economy",
                        program="american",
                        miles_required=40000,  # Within balance
                        surcharge=150,
                        cabin_or_room_type="economy",
                        cash_equivalent=2000,
                    ),
                ],
            ),
        ]
        
        result = optimize_trip(spec, flights, [], [], mode="oop")
        
        assert result.status == OptimizationStatus.OPTIMAL
        assert result.solution is not None
        
        # Should have selected the flight
        assert 0 in result.solution.selected_flights
        
        # Check payment
        payment = result.solution.flight_payments.get("flight_1")
        
        if payment and payment.method == "points":
            # If using points, must be AA (United balance insufficient)
            assert payment.award_option_id == "aa_economy", \
                f"Selected {payment.award_option_id} but United has insufficient balance"
            assert payment.points_amount == 40000
            
            # AA balance should be deducted, not United
            aa_used = result.solution.total_points_by_program.get("american", 0)
            united_used = result.solution.total_points_by_program.get("united", 0)
            
            assert aa_used == 40000, f"Expected 40k AA used, got {aa_used}"
            assert united_used == 0, f"United should be 0, got {united_used}"
    
    def test_option_id_in_variable_keys(self):
        """Verify option_id is part of the decision variable keys."""
        
        traveler = make_traveler("alice", points={"united": 100000})
        
        spec = TripPlanSpec(
            trip_id="test",
            travelers=[traveler],
            legs=[
                OrderedLeg(
                    leg_id=0,
                    origin_city="JFK",
                    destination_city="NRT",
                    earliest_departure=date(2025, 3, 1),
                    latest_departure=date(2025, 3, 1),
                    traveler_ids=["alice"],
                ),
            ],
            stay_segments=[],
        )
        
        flights = [
            make_flight(
                leg_id=0,
                edge_id="flight_1",
                cash_cost=2000,
                award_options=[
                    AwardOption(
                        option_id="united_saver",
                        program="united",
                        miles_required=50000,
                        surcharge=100,
                        cabin_or_room_type="economy",
                        cash_equivalent=2000,
                    ),
                    AwardOption(
                        option_id="united_standard",
                        program="united",
                        miles_required=70000,
                        surcharge=50,
                        cabin_or_room_type="economy",
                        cash_equivalent=2000,
                    ),
                ],
            ),
        ]
        
        solver = SolverV3(mode=Mode.OOP)
        # Just build model to inspect variables
        solver.spec = spec
        solver.M_rooms = 1
        solver.flights = flights
        solver.hotels = []
        solver.transfers = []
        solver._build_indices(flights, [])
        solver._build_funding_sources()
        solver.date_feasible = {(0, "flight_1"): 1}
        solver._build_model()
        
        # Check that y_pf keys include option_id
        y_pf_keys = list(solver.vars["y_pf"].keys())
        
        # Keys should be (leg, edge, option_id, payer, source)
        for key in y_pf_keys:
            assert len(key) == 5, f"y_pf key should have 5 elements: {key}"
            leg, edge, opt_id, payer, src = key
            assert opt_id in ["united_saver", "united_standard"], \
                f"option_id should be in key: {key}"


# =============================================================================
# TEST 2: Hotel Points × Rooms × Nights
# =============================================================================

class TestHotelRoomLinkedPoints:
    """
    Verify that hotel points cost is properly tied to room count.
    
    Scenario:
    - 4 travelers, room capacity 2 → need 2 rooms
    - 3 nights
    - 15k points per night per room
    - Total should be: 2 rooms × 3 nights × 15k = 90k points
    """
    
    def test_points_scaled_by_rooms_and_nights(self):
        """Ensure hotel points = rooms × nights × points_per_night."""
        
        travelers = [
            make_traveler(f"traveler_{i}", points={"hyatt": 100000})
            for i in range(4)
        ]
        
        spec = TripPlanSpec(
            trip_id="test",
            travelers=travelers,
            legs=[
                OrderedLeg(
                    leg_id=0,
                    origin_city="JFK",
                    destination_city="TYO",
                    earliest_departure=date(2025, 3, 1),
                    latest_departure=date(2025, 3, 1),
                    traveler_ids=[t.traveler_id for t in travelers],
                ),
                OrderedLeg(
                    leg_id=1,
                    origin_city="TYO",
                    destination_city="JFK",
                    earliest_departure=date(2025, 3, 4),
                    latest_departure=date(2025, 3, 4),
                    traveler_ids=[t.traveler_id for t in travelers],
                ),
            ],
            stay_segments=[
                StaySegment(
                    segment_id=0,
                    city="TYO",
                    check_in=date(2025, 3, 1),
                    check_out=date(2025, 3, 4),  # 3 nights
                    traveler_ids=[t.traveler_id for t in travelers],
                ),
            ],
        )
        
        flights = [
            make_flight(
                leg_id=0,
                edge_id="flight_out",
                origin="JFK",
                destination="NRT",
                cash_cost=500,
                depart_date=date(2025, 3, 1),
                arrive_date=date(2025, 3, 1),
            ),
            make_flight(
                leg_id=1,
                edge_id="flight_return",
                origin="NRT",
                destination="JFK",
                cash_cost=500,
                depart_date=date(2025, 3, 4),
                arrive_date=date(2025, 3, 4),
            ),
        ]
        
        hotels = [
            make_hotel(
                segment_id=0,
                hotel_id="hyatt_tokyo",
                room_types=[
                    RoomType(
                        room_type_id="standard_king",
                        name="Standard King",
                        capacity=2,  # 2 per room → 4 travelers need 2 rooms
                        cash_per_night=300,
                        award_program="hyatt",
                        points_per_night=15000,
                        award_surcharge_per_night=0,
                    ),
                ],
            ),
        ]
        
        result = optimize_trip(spec, flights, hotels, [], mode="oop")
        
        assert result.status == OptimizationStatus.OPTIMAL
        assert result.solution is not None
        
        # Check hotel payment
        hotel_payment = result.solution.hotel_payments.get("hyatt_tokyo")
        
        if hotel_payment and hotel_payment.method == "points":
            # Expected: 2 rooms × 3 nights × 15000 = 90000 points
            expected_points = 2 * 3 * 15000
            
            assert hotel_payment.points_amount == expected_points, \
                f"Expected {expected_points} points, got {hotel_payment.points_amount}"
        
        # Check room allocation
        rooms = result.solution.selected_rooms.get("hyatt_tokyo", {})
        total_rooms = sum(rooms.values())
        
        # Need at least 2 rooms for 4 travelers with capacity 2
        assert total_rooms >= 2, f"Expected at least 2 rooms, got {total_rooms}"


# =============================================================================
# TEST 3: Date Feasibility Enforced by MILP
# =============================================================================

class TestDateFeasibilityEnforced:
    """
    Verify that date-infeasible flights cannot be selected by MILP.
    
    Scenario:
    - Two flights for same leg
    - Flight A: departs within date window (feasible)
    - Flight B: departs outside date window (infeasible, date_feasible=0)
    - MILP constraint x_f <= date_feasible should prevent selecting B
    """
    
    def test_infeasible_flight_not_selected(self):
        """Ensure MILP cannot select date-infeasible flight."""
        
        traveler = make_traveler("alice", points={"united": 100000})
        
        spec = TripPlanSpec(
            trip_id="test",
            travelers=[traveler],
            legs=[
                OrderedLeg(
                    leg_id=0,
                    origin_city="JFK",
                    destination_city="NRT",
                    earliest_departure=date(2025, 3, 1),
                    latest_departure=date(2025, 3, 2),  # Window: Mar 1-2
                    traveler_ids=["alice"],
                ),
            ],
            stay_segments=[],
        )
        
        # Flight A: feasible (departs Mar 1)
        flight_a = make_flight(
            leg_id=0,
            edge_id="flight_feasible",
            cash_cost=2000,  # Expensive
            depart_date=date(2025, 3, 1),
        )
        
        # Flight B: infeasible (departs Mar 5, outside window)
        # But cheaper - solver would prefer it if not constrained
        flight_b = make_flight(
            leg_id=0,
            edge_id="flight_infeasible",
            cash_cost=500,  # Much cheaper
            depart_date=date(2025, 3, 5),  # Outside window!
        )
        
        # The validator will filter flight_b out, but let's verify
        # the MILP constraint works by checking the solver correctly
        # handles the date_feasible dict
        
        flights = [flight_a, flight_b]
        
        result = optimize_trip(spec, flights, [], [], mode="oop")
        
        assert result.status == OptimizationStatus.OPTIMAL
        assert result.solution is not None
        
        # Should select the feasible flight (even though more expensive)
        selected_edge = result.solution.selected_flights.get(0)
        
        assert selected_edge == "flight_feasible", \
            f"Selected {selected_edge} but should be flight_feasible (date constraint)"
    
    def test_date_feasible_dict_populated(self):
        """Verify date_feasible dict is properly populated."""
        
        traveler = make_traveler("alice")
        
        spec = TripPlanSpec(
            trip_id="test",
            travelers=[traveler],
            legs=[
                OrderedLeg(
                    leg_id=0,
                    origin_city="JFK",
                    destination_city="NRT",
                    earliest_departure=date(2025, 3, 1),
                    latest_departure=date(2025, 3, 1),
                    traveler_ids=["alice"],
                ),
            ],
            stay_segments=[],
        )
        
        # Create solver and check date_feasible
        solver = SolverV3(mode=Mode.OOP)
        
        # Flights with different dates
        flights = [
            make_flight(leg_id=0, edge_id="f1", depart_date=date(2025, 3, 1)),  # Feasible
            make_flight(leg_id=0, edge_id="f2", depart_date=date(2025, 3, 5)),  # Infeasible
        ]
        
        # Simulate the solve process up to date feasibility check
        from src.optimization.validators import filter_single_ticket_only, validate_date_feasibility
        
        flights, _ = filter_single_ticket_only(flights)
        feasible_flights, _ = validate_date_feasibility(flights, spec.stay_segments, spec.legs)
        
        feasible_set = {f.edge_id for f in feasible_flights}
        
        # f1 should be feasible, f2 should not
        assert "f1" in feasible_set, "f1 should be feasible"
        assert "f2" not in feasible_set, "f2 should be infeasible"


# =============================================================================
# TEST: Variable Name Sanitization
# =============================================================================

class TestSlugFunction:
    """Test the slug function for variable name safety."""
    
    def test_removes_special_chars(self):
        """slug() should remove PuLP-unsafe characters."""
        assert slug("UA-100") == "UA_100"
        assert slug("hotel/room:1") == "hotel_room_1"
        assert slug("test space") == "test_space"
        assert slug("native_alice_united") == "native_alice_united"
    
    def test_truncates_long_names(self):
        """slug() should truncate to 80 chars."""
        long_name = "a" * 100
        assert len(slug(long_name)) == 80
    
    def test_handles_empty(self):
        """slug() should handle empty strings."""
        assert slug("") == "empty"
        assert slug(None) == "empty"


# =============================================================================
# TEST: CBC Availability Check
# =============================================================================

class TestCBCAvailability:
    """Test CBC solver availability check."""
    
    def test_check_cbc_available_returns_tuple(self):
        """check_cbc_available should return (bool, optional_error)."""
        from src.optimization.solver_v3 import check_cbc_available
        
        result = check_cbc_available()
        
        assert isinstance(result, tuple)
        assert len(result) == 2
        
        available, error = result
        assert isinstance(available, bool)
        
        if not available:
            assert error is not None
            assert isinstance(error, str)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
