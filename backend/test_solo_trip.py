"""
Tests for the Solo Trip Algorithm implementation.

Tests the new components:
- StrictTripInputValidator
- ConnectionValidator
- ComprehensiveFlightSearcher
- RouteGraphBuilder
- BookingInstructionGenerator
- SoloTripOrchestrator
"""

import pytest
from datetime import date, datetime, timedelta
from unittest.mock import Mock, patch, MagicMock

# Import solo trip components
from src.handlers.solo_trip import (
    # Models
    FlightLeg,
    Layover,
    ConnectingFlightOption,
    FlightSegment,
    Itinerary,
    TransferPlan,
    PointsTransfer,
    ConnectionValidation,
    TripInput,
    Destination,
    CabinClass,
    RouteEdge,
    RouteGraph,
    FlightSearchResult,
    # Errors
    SoloTripError,
    ValidationError,
    NoFlightsFoundError,
    InvalidConnectionError,
    NoValidRouteError,
    BudgetExceededError,
    OptimizationFailedError,
    MissingFlightDataError,
    # Components
    StrictTripInputValidator,
    ConnectionValidator,
    ComprehensiveFlightSearcher,
    RouteGraphBuilder,
    BookingInstructionGenerator,
)


class TestStrictTripInputValidator:
    """Tests for StrictTripInputValidator."""
    
    def setup_method(self):
        """Setup test fixtures."""
        # Create validator with known airports
        self.validator = StrictTripInputValidator(
            airports_db={"JFK", "LAX", "ORD", "CDG", "LHR", "NRT", "SFO"}
        )
    
    def test_valid_trip_input(self):
        """Test validation with valid input."""
        trip_data = {
            "trip_id": "test_trip_1",
            "start_destination": "JFK",
            "end_destination": "JFK",
            "destinations": [
                {"airport_code": "CDG", "name": "Paris", "must_include": True}
            ],
            "start_date": (date.today() + timedelta(days=30)).isoformat(),
            "end_date": (date.today() + timedelta(days=37)).isoformat(),
        }
        
        result = self.validator.validate(trip_data)
        
        assert result.valid is True
        assert result.can_proceed is True
        assert len(result.errors) == 0
    
    def test_missing_start_destination(self):
        """Test validation fails without start destination."""
        trip_data = {
            "trip_id": "test_trip_1",
            "end_destination": "JFK",
            "destinations": [
                {"airport_code": "CDG", "name": "Paris"}
            ],
            "start_date": (date.today() + timedelta(days=30)).isoformat(),
            "end_date": (date.today() + timedelta(days=37)).isoformat(),
        }
        
        result = self.validator.validate(trip_data)
        
        assert result.valid is False
        assert result.can_proceed is False
        assert any(e.code == "MISSING_START_DESTINATION" for e in result.errors)
    
    def test_invalid_airport_code(self):
        """Test validation fails with invalid airport code."""
        trip_data = {
            "trip_id": "test_trip_1",
            "start_destination": "XXX",  # Invalid
            "end_destination": "JFK",
            "destinations": [
                {"airport_code": "CDG", "name": "Paris"}
            ],
            "start_date": (date.today() + timedelta(days=30)).isoformat(),
            "end_date": (date.today() + timedelta(days=37)).isoformat(),
        }
        
        result = self.validator.validate(trip_data)
        
        assert result.valid is False
        assert any(e.code == "INVALID_START_AIRPORT" for e in result.errors)
    
    def test_past_date_validation(self):
        """Test validation fails with past start date."""
        trip_data = {
            "trip_id": "test_trip_1",
            "start_destination": "JFK",
            "end_destination": "JFK",
            "destinations": [
                {"airport_code": "CDG", "name": "Paris"}
            ],
            "start_date": (date.today() - timedelta(days=1)).isoformat(),
            "end_date": (date.today() + timedelta(days=7)).isoformat(),
        }
        
        result = self.validator.validate(trip_data)
        
        assert result.valid is False
        assert any(e.code == "PAST_START_DATE" for e in result.errors)
    
    def test_no_destinations(self):
        """Test validation fails without destinations."""
        trip_data = {
            "trip_id": "test_trip_1",
            "start_destination": "JFK",
            "end_destination": "JFK",
            "destinations": [],
            "start_date": (date.today() + timedelta(days=30)).isoformat(),
            "end_date": (date.today() + timedelta(days=37)).isoformat(),
        }
        
        result = self.validator.validate(trip_data)
        
        assert result.valid is False
        assert any(e.code == "NO_DESTINATIONS" for e in result.errors)
    
    def test_build_trip_input(self):
        """Test building TripInput from valid data."""
        trip_data = {
            "trip_id": "test_trip_1",
            "start_destination": "JFK",
            "end_destination": "LAX",
            "destinations": [
                {"airport_code": "ORD", "name": "Chicago", "must_include": True}
            ],
            "start_date": (date.today() + timedelta(days=30)).isoformat(),
            "end_date": (date.today() + timedelta(days=37)).isoformat(),
            "max_budget": 2000,
            "cabin_class": "economy",
        }
        
        result = self.validator.validate(trip_data)
        assert result.valid is True
        
        trip_input = self.validator.build_trip_input(trip_data)
        
        assert trip_input.trip_id == "test_trip_1"
        assert trip_input.start_destination == "JFK"
        assert trip_input.end_destination == "LAX"
        assert len(trip_input.destinations) == 1
        assert trip_input.destinations[0].airport_code == "ORD"
        assert trip_input.max_budget == 2000
        assert trip_input.cabin_class == CabinClass.ECONOMY


class TestConnectionValidator:
    """Tests for ConnectionValidator."""
    
    def setup_method(self):
        """Setup test fixtures."""
        self.validator = ConnectionValidator()
    
    def test_valid_domestic_connection(self):
        """Test valid domestic connection."""
        arriving = FlightLeg(
            leg_index=0,
            departure_airport="JFK",
            arrival_airport="ORD",
            arrival_time="14:00",
            airline_code="UA"
        )
        departing = FlightLeg(
            leg_index=1,
            departure_airport="ORD",
            arrival_airport="LAX",
            departure_time="16:00",
            airline_code="UA"
        )
        
        result = self.validator.validate_connection(arriving, departing)
        
        assert result.valid is True
        assert result.layover_minutes == 120  # 2 hours
    
    def test_invalid_connection_too_short(self):
        """Test connection fails when too short."""
        arriving = FlightLeg(
            leg_index=0,
            departure_airport="JFK",
            arrival_airport="ORD",
            arrival_time="14:00",
            airline_code="UA"
        )
        departing = FlightLeg(
            leg_index=1,
            departure_airport="ORD",
            arrival_airport="LAX",
            departure_time="14:30",  # Only 30 min
            airline_code="UA"
        )
        
        result = self.validator.validate_connection(arriving, departing)
        
        assert result.valid is False
        assert result.layover_minutes == 30
    
    def test_airport_mismatch(self):
        """Test connection fails when airports don't match."""
        arriving = FlightLeg(
            leg_index=0,
            departure_airport="JFK",
            arrival_airport="ORD",
            arrival_time="14:00",
            airline_code="UA"
        )
        departing = FlightLeg(
            leg_index=1,
            departure_airport="MDW",  # Different airport
            arrival_airport="LAX",
            departure_time="16:00",
            airline_code="UA"
        )
        
        result = self.validator.validate_connection(arriving, departing)
        
        assert result.valid is False
        assert "don't match" in result.error
    
    def test_validate_itinerary_connections(self):
        """Test validating complete itinerary."""
        legs = [
            FlightLeg(
                leg_index=0,
                departure_airport="JFK",
                arrival_airport="ORD",
                arrival_time="14:00",
                airline_code="UA"
            ),
            FlightLeg(
                leg_index=1,
                departure_airport="ORD",
                arrival_airport="DEN",
                departure_time="16:00",
                arrival_time="17:30",
                airline_code="UA"
            ),
            FlightLeg(
                leg_index=2,
                departure_airport="DEN",
                arrival_airport="LAX",
                departure_time="19:00",
                airline_code="UA"
            )
        ]
        
        all_valid, validations, layovers = self.validator.validate_itinerary_connections(legs)
        
        assert all_valid is True
        assert len(validations) == 2  # Two connections
        assert len(layovers) == 2


class TestRouteGraph:
    """Tests for RouteGraph."""
    
    def test_add_and_get_edges(self):
        """Test adding and retrieving edges."""
        graph = RouteGraph()
        
        graph.add_node("JFK", "origin")
        graph.add_node("CDG", "destination")
        
        edge = RouteEdge(
            edge_id="jfk_cdg_1",
            from_node="JFK",
            to_node="CDG",
            cash_cost=500,
            total_duration_minutes=420
        )
        graph.add_edge(edge)
        
        edges = graph.get_edges("JFK", "CDG")
        assert len(edges) == 1
        assert edges[0].cash_cost == 500
    
    def test_to_edges_dict(self):
        """Test converting graph to edges dict."""
        graph = RouteGraph()
        
        leg = FlightLeg(
            leg_index=0,
            departure_airport="JFK",
            arrival_airport="CDG",
            flight_number="AF123"
        )
        
        edge = RouteEdge(
            edge_id="jfk_cdg_1",
            from_node="JFK",
            to_node="CDG",
            cash_cost=500,
            points_cost=30000,
            points_program="AF",
            total_duration_minutes=420,
            legs=[leg]
        )
        graph.add_edge(edge)
        
        edges_dict = graph.to_edges_dict()
        
        assert ("JFK", "CDG", "AF123") in edges_dict
        assert edges_dict[("JFK", "CDG", "AF123")]["cash_cost"] == 500


class TestBookingInstructionGenerator:
    """Tests for BookingInstructionGenerator."""
    
    def setup_method(self):
        """Setup test fixtures."""
        self.generator = BookingInstructionGenerator()
    
    def test_generate_transfer_step(self):
        """Test generating transfer step."""
        transfer = PointsTransfer(
            from_bank="chase",
            to_airline="UA",
            bank_points=50000,
            airline_points=50000,
            ratio=1.0,
            is_instant=True
        )
        
        step = self.generator._create_transfer_step(transfer, 1)
        
        assert step.step_number == 1
        assert step.step_type == "transfer"
        assert "50,000" in step.title
        assert "Chase" in step.title
        assert "United" in step.title
    
    def test_generate_booking_instructions(self):
        """Test generating complete booking instructions."""
        leg = FlightLeg(
            leg_index=0,
            departure_airport="JFK",
            arrival_airport="CDG",
            departure_time="18:00",
            arrival_time="08:00",
            duration_minutes=420,
            airline_name="Air France",
            flight_number="AF007"
        )
        
        segment = FlightSegment(
            segment_id="seg_1",
            origin="JFK",
            destination="CDG",
            legs=[leg],
            is_direct=True,
            total_duration_minutes=420,
            payment_method="cash",
            cash_cost=500
        )
        
        itinerary = Itinerary(
            itinerary_id="itin_1",
            flight_segments=[segment],
            total_oop=500,
            total_cash=500,
            origin="JFK",
            destination="CDG"
        )
        
        instructions = self.generator.generate(itinerary)
        
        assert len(instructions.steps) == 1
        assert instructions.steps[0].step_type == "book_flight"
        assert instructions.summary.total_cost == 500


class TestErrorTypes:
    """Tests for error types."""
    
    def test_no_flights_found_error(self):
        """Test NoFlightsFoundError structure."""
        error = NoFlightsFoundError(
            message="No flights found",
            origin="JFK",
            destination="XYZ",
            date="2024-06-15",
            nearby_airports=["LAX", "SFO"]
        )
        
        assert error.code == "NO_FLIGHTS_FOUND"
        assert len(error.user_actions) >= 1
        assert error.details["origin"] == "JFK"
        
        error_dict = error.to_dict()
        assert "user_actions" in error_dict
    
    def test_budget_exceeded_error(self):
        """Test BudgetExceededError with itinerary."""
        error = BudgetExceededError(
            message="Budget exceeded",
            minimum_cost=3000,
            user_budget=2000
        )
        
        assert error.code == "BUDGET_EXCEEDED"
        assert error.details["exceeded_by"] == 1000
        assert any(a.action_type == "increase_budget" for a in error.user_actions)
    
    def test_validation_error(self):
        """Test ValidationError structure."""
        error = ValidationError(
            field="start_destination",
            message="Start destination is required",
            code="MISSING_START_DESTINATION",
            severity="blocking"
        )
        
        assert error.field == "start_destination"
        assert error.severity == "blocking"


class TestFlightSearchResult:
    """Tests for FlightSearchResult."""
    
    def test_successful_search(self):
        """Test successful search result."""
        option = ConnectingFlightOption(
            option_id="opt_1",
            option_type="cash",
            origin="JFK",
            destination="CDG",
            is_direct=True,
            num_stops=0,
            cash_price_usd=500
        )
        
        result = FlightSearchResult(
            success=True,
            options=[option],
            direct_options=[option],
            connecting_options=[],
            origin="JFK",
            destination="CDG"
        )
        
        assert result.success is True
        assert len(result.options) == 1
        assert len(result.direct_options) == 1
    
    def test_failed_search(self):
        """Test failed search result."""
        result = FlightSearchResult(
            success=False,
            options=[],
            failure_reason="No flights available",
            origin="JFK",
            destination="XYZ"
        )
        
        assert result.success is False
        assert result.failure_reason is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
