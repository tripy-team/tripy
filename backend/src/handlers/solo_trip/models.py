"""
Solo Trip Data Models

All data structures for the solo trip algorithm.
These models represent REAL data only - never estimates or placeholders.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Literal, Any, Tuple
from datetime import date, datetime
from enum import Enum


class CabinClass(Enum):
    """Flight cabin class."""
    BASIC_ECONOMY = "basic_economy"
    ECONOMY = "economy"
    PREMIUM_ECONOMY = "premium_economy"
    BUSINESS = "business"
    FIRST = "first"
    
    @classmethod
    def from_string(cls, value: str) -> "CabinClass":
        """Convert string to CabinClass."""
        if not value:
            return cls.ECONOMY
        v = value.lower().strip().replace(" ", "_")
        mapping = {
            "basic_economy": cls.BASIC_ECONOMY,
            "economy": cls.ECONOMY,
            "coach": cls.ECONOMY,
            "main": cls.ECONOMY,
            "premium_economy": cls.PREMIUM_ECONOMY,
            "premium": cls.PREMIUM_ECONOMY,
            "business": cls.BUSINESS,
            "first": cls.FIRST,
        }
        return mapping.get(v, cls.ECONOMY)


@dataclass
class Destination:
    """A destination city in the trip."""
    city_name: str
    airport_code: str
    days: Optional[int] = None
    must_include: bool = True
    excluded: bool = False
    is_start: bool = False
    is_end: bool = False


@dataclass
class TripInput:
    """User input for trip generation - all validated fields."""
    trip_id: str
    start_destination: str  # IATA code
    end_destination: str    # IATA code
    destinations: List[Destination]
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    flexible_dates: bool = False
    duration_days: Optional[int] = None
    max_budget: Optional[float] = None  # Total budget for entire party
    points_balances: Dict[str, int] = field(default_factory=dict)
    cabin_class: CabinClass = CabinClass.ECONOMY
    include_hotels: bool = False
    hotel_class: Optional[str] = None
    num_bags: int = 0
    one_way: bool = False
    
    # Party size fields
    num_adults: int = 1
    num_children: int = 0
    
    @property
    def party_size(self) -> int:
        """Total number of travelers in the party."""
        return self.num_adults + self.num_children
    
    @property
    def pax(self) -> int:
        """Alias for party_size, used in flight API calls."""
        return self.party_size


@dataclass
class FlightLeg:
    """Single flight leg - one takeoff and landing."""
    leg_index: int
    
    # Airports
    departure_airport: str
    arrival_airport: str
    departure_terminal: Optional[str] = None
    arrival_terminal: Optional[str] = None
    
    # Times - EXACT, not estimated
    departure_datetime: Optional[datetime] = None
    arrival_datetime: Optional[datetime] = None
    departure_time: Optional[str] = None  # HH:MM format
    arrival_time: Optional[str] = None    # HH:MM format
    departure_date: Optional[str] = None  # YYYY-MM-DD
    arrival_date: Optional[str] = None    # YYYY-MM-DD
    duration_minutes: int = 0
    
    # Flight info
    airline_name: str = ""
    airline_code: str = ""
    flight_number: str = ""
    operating_carrier: Optional[str] = None
    
    # Aircraft
    aircraft_type: Optional[str] = None
    cabin: Optional[str] = None
    
    # Flags
    overnight: bool = False
    often_delayed: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "leg_index": self.leg_index,
            "departure_airport": self.departure_airport,
            "arrival_airport": self.arrival_airport,
            "departure_terminal": self.departure_terminal,
            "arrival_terminal": self.arrival_terminal,
            "departure_datetime": self.departure_datetime.isoformat() if self.departure_datetime else None,
            "arrival_datetime": self.arrival_datetime.isoformat() if self.arrival_datetime else None,
            "departure_time": self.departure_time,
            "arrival_time": self.arrival_time,
            "departure_date": self.departure_date,
            "arrival_date": self.arrival_date,
            "duration_minutes": self.duration_minutes,
            "airline_name": self.airline_name,
            "airline_code": self.airline_code,
            "flight_number": self.flight_number,
            "operating_carrier": self.operating_carrier,
            "aircraft_type": self.aircraft_type,
            "cabin": self.cabin,
            "overnight": self.overnight,
        }


@dataclass
class Layover:
    """Layover between two legs."""
    layover_index: int
    airport: str
    duration_minutes: int
    
    arrival_time: Optional[datetime] = None
    departure_time: Optional[datetime] = None
    
    arrival_terminal: Optional[str] = None
    departure_terminal: Optional[str] = None
    
    terminal_change: bool = False
    airline_change: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "layover_index": self.layover_index,
            "airport": self.airport,
            "duration_minutes": self.duration_minutes,
            "arrival_time": self.arrival_time.isoformat() if self.arrival_time else None,
            "departure_time": self.departure_time.isoformat() if self.departure_time else None,
            "arrival_terminal": self.arrival_terminal,
            "departure_terminal": self.departure_terminal,
            "terminal_change": self.terminal_change,
            "airline_change": self.airline_change,
        }


@dataclass
class TransferPartner:
    """Bank transfer partner information."""
    bank_program: str
    transfer_ratio: float = 1.0
    is_instant: bool = False
    minimum_transfer: int = 1000
    transfer_time_hours: int = 48
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "bank_program": self.bank_program,
            "transfer_ratio": self.transfer_ratio,
            "is_instant": self.is_instant,
            "minimum_transfer": self.minimum_transfer,
            "transfer_time_hours": self.transfer_time_hours,
        }


@dataclass
class ConnectionWarning:
    """Warning about a connection."""
    warning_type: str
    message: str
    
    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.warning_type, "message": self.message}


@dataclass
class ConnectionValidation:
    """Validation result for a single connection."""
    valid: bool
    layover_minutes: Optional[int] = None
    minimum_required_minutes: Optional[int] = None
    buffer_minutes: Optional[int] = None
    warnings: List[ConnectionWarning] = field(default_factory=list)
    error: Optional[str] = None
    
    arriving_leg: Optional[FlightLeg] = None
    departing_leg: Optional[FlightLeg] = None
    connection_airport: Optional[str] = None
    terminal_change: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "valid": self.valid,
            "layover_minutes": self.layover_minutes,
            "minimum_required_minutes": self.minimum_required_minutes,
            "buffer_minutes": self.buffer_minutes,
            "warnings": [w.to_dict() for w in self.warnings],
            "error": self.error,
            "connection_airport": self.connection_airport,
            "terminal_change": self.terminal_change,
        }


@dataclass
class ConnectingFlightOption:
    """Complete flight option with all legs and connections."""
    option_id: str
    option_type: Literal["cash", "award"]
    
    # Route
    origin: str
    destination: str
    
    # Structure
    is_direct: bool
    num_stops: int
    legs: List[FlightLeg] = field(default_factory=list)
    layovers: List[Layover] = field(default_factory=list)
    
    # Connection validation
    connections_valid: bool = True
    connection_validations: List[ConnectionValidation] = field(default_factory=list)
    
    # Timing
    total_duration_minutes: int = 0
    flight_time_minutes: int = 0
    layover_time_minutes: int = 0
    departure_datetime: Optional[datetime] = None
    arrival_datetime: Optional[datetime] = None
    
    # Pricing (REAL DATA ONLY)
    cash_price_usd: Optional[float] = None
    points_cost: Optional[int] = None
    points_program: Optional[str] = None
    surcharge_usd: Optional[float] = None
    
    # Booking
    booking_link: Optional[str] = None
    booking_token: Optional[str] = None
    requires_separate_bookings: bool = False
    
    # Airlines
    airlines: List[str] = field(default_factory=list)
    marketing_carriers: List[str] = field(default_factory=list)
    operating_carriers: List[str] = field(default_factory=list)
    
    # Transfer info
    transfer_partners: List[TransferPartner] = field(default_factory=list)
    
    # Availability
    seats_available: Optional[int] = None
    
    # Metadata
    data_source: str = ""
    fetched_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    
    @property
    def is_valid(self) -> bool:
        """Option is valid only if all connections are valid."""
        return self.connections_valid
    
    @property
    def connection_airports(self) -> List[str]:
        """List of airports where connections occur."""
        return [l.airport for l in self.layovers]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "option_id": self.option_id,
            "option_type": self.option_type,
            "origin": self.origin,
            "destination": self.destination,
            "is_direct": self.is_direct,
            "num_stops": self.num_stops,
            "legs": [l.to_dict() for l in self.legs],
            "layovers": [l.to_dict() for l in self.layovers],
            "connections_valid": self.connections_valid,
            "total_duration_minutes": self.total_duration_minutes,
            "flight_time_minutes": self.flight_time_minutes,
            "layover_time_minutes": self.layover_time_minutes,
            "cash_price_usd": self.cash_price_usd,
            "points_cost": self.points_cost,
            "points_program": self.points_program,
            "surcharge_usd": self.surcharge_usd,
            "booking_link": self.booking_link,
            "requires_separate_bookings": self.requires_separate_bookings,
            "airlines": self.airlines,
            "seats_available": self.seats_available,
            "data_source": self.data_source,
        }


@dataclass
class RouteEdge:
    """An edge in the route graph representing a flight option."""
    edge_id: str
    
    # Endpoints
    from_node: str  # Origin airport
    to_node: str    # Destination airport
    
    # Flight option
    flight_option: Optional[ConnectingFlightOption] = None
    option_type: Literal["cash", "award"] = "cash"
    
    # Pricing (REAL DATA ONLY)
    cash_cost: Optional[float] = None
    points_cost: Optional[int] = None
    points_program: Optional[str] = None
    surcharge: Optional[float] = None
    
    # Timing
    total_duration_minutes: int = 0
    departure_datetime: Optional[datetime] = None
    arrival_datetime: Optional[datetime] = None
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    
    # Structure
    is_direct: bool = True
    num_stops: int = 0
    connection_airports: List[str] = field(default_factory=list)
    
    # Legs for detailed booking
    legs: List[FlightLeg] = field(default_factory=list)
    layovers: List[Layover] = field(default_factory=list)
    
    # Booking
    booking_link: Optional[str] = None
    requires_separate_bookings: bool = False
    
    # Transfer info
    transfer_partners: List[TransferPartner] = field(default_factory=list)
    
    # Availability
    seats_available: Optional[int] = None
    
    # Operating airline
    operating_airline: Optional[str] = None
    
    # Data quality
    data_source: str = ""
    data_fetched_at: Optional[datetime] = None
    data_expires_at: Optional[datetime] = None
    
    def to_edge_tuple(self) -> Tuple[str, str, str]:
        """Convert to edge tuple (origin, destination, flight_number)."""
        fn = self.legs[0].flight_number if self.legs else self.edge_id
        return (self.from_node, self.to_node, fn)
    
    def to_edges_dict_entry(self) -> Dict[str, Any]:
        """Convert to edges dict entry format for ILP."""
        return {
            "cash_cost": self.cash_cost,
            "time_cost": self.total_duration_minutes,
            "points_cost": self.points_cost,
            "points_program": self.points_program,
            "points_surcharge": self.surcharge,
            "transfer_partners": [tp.bank_program for tp in self.transfer_partners],
            "departure_time": self.departure_time,
            "arrival_time": self.arrival_time,
            "operating_airline": self.operating_airline,
        }


@dataclass
class RouteGraph:
    """Graph of all flight options for a trip."""
    nodes: List[str] = field(default_factory=list)  # Airport codes
    edges: List[RouteEdge] = field(default_factory=list)
    
    # Node metadata
    node_types: Dict[str, str] = field(default_factory=dict)  # airport -> "origin"|"destination"|"end"
    node_days: Dict[str, int] = field(default_factory=dict)   # airport -> days to stay
    
    def add_node(self, code: str, node_type: str = "destination", days: int = 0):
        """Add a node to the graph."""
        if code not in self.nodes:
            self.nodes.append(code)
        self.node_types[code] = node_type
        self.node_days[code] = days
    
    def add_edge(self, edge: RouteEdge):
        """Add an edge to the graph."""
        self.edges.append(edge)
        # Ensure nodes exist
        if edge.from_node not in self.nodes:
            self.nodes.append(edge.from_node)
        if edge.to_node not in self.nodes:
            self.nodes.append(edge.to_node)
    
    def get_edges(self, from_node: str, to_node: str) -> List[RouteEdge]:
        """Get all edges between two nodes."""
        return [e for e in self.edges if e.from_node == from_node and e.to_node == to_node]
    
    def get_edges_from(self, node: str) -> List[RouteEdge]:
        """Get all edges departing from a node."""
        return [e for e in self.edges if e.from_node == node]
    
    def get_edges_to(self, node: str) -> List[RouteEdge]:
        """Get all edges arriving at a node."""
        return [e for e in self.edges if e.to_node == node]
    
    def get_edge_by_id(self, edge_id: str) -> Optional[RouteEdge]:
        """Get edge by ID."""
        for e in self.edges:
            if e.edge_id == edge_id:
                return e
        return None
    
    def to_edges_dict(self) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
        """Convert to edges dict format for ILP."""
        result = {}
        for edge in self.edges:
            key = edge.to_edge_tuple()
            result[key] = edge.to_edges_dict_entry()
        return result
    
    @property
    def all_edges(self) -> List[RouteEdge]:
        """Get all edges."""
        return self.edges


@dataclass
class FlightSearchResult:
    """Result of a flight search."""
    success: bool
    options: List[ConnectingFlightOption] = field(default_factory=list)
    search_errors: List[Dict[str, Any]] = field(default_factory=list)
    direct_options: List[ConnectingFlightOption] = field(default_factory=list)
    connecting_options: List[ConnectingFlightOption] = field(default_factory=list)
    failure_reason: Optional[str] = None
    
    # Metadata
    origin: str = ""
    destination: str = ""
    search_date: Optional[date] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "success": self.success,
            "num_options": len(self.options),
            "num_direct": len(self.direct_options),
            "num_connecting": len(self.connecting_options),
            "failure_reason": self.failure_reason,
            "origin": self.origin,
            "destination": self.destination,
        }


@dataclass
class PointsTransfer:
    """Single points transfer."""
    from_bank: str
    to_airline: str
    bank_points: int
    airline_points: int
    ratio: float = 1.0
    is_instant: bool = False
    transfer_time_hours: int = 48
    transfer_link: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "from_bank": self.from_bank,
            "to_airline": self.to_airline,
            "bank_points": self.bank_points,
            "airline_points": self.airline_points,
            "ratio": self.ratio,
            "is_instant": self.is_instant,
            "transfer_time_hours": self.transfer_time_hours,
            "transfer_link": self.transfer_link,
        }


@dataclass
class TransferPlan:
    """Plan for transferring points."""
    transfers: List[PointsTransfer] = field(default_factory=list)
    total_bank_points_used: Dict[str, int] = field(default_factory=dict)
    total_airline_points_received: Dict[str, int] = field(default_factory=dict)
    has_delayed_transfers: bool = False
    estimated_transfer_time_hours: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "transfers": [t.to_dict() for t in self.transfers],
            "total_bank_points_used": self.total_bank_points_used,
            "total_airline_points_received": self.total_airline_points_received,
            "has_delayed_transfers": self.has_delayed_transfers,
            "estimated_transfer_time_hours": self.estimated_transfer_time_hours,
        }


@dataclass
class FlightSegment:
    """A segment of the itinerary (origin to destination)."""
    segment_id: str
    origin: str
    destination: str
    
    # Full structure
    legs: List[FlightLeg] = field(default_factory=list)
    layovers: List[Layover] = field(default_factory=list)
    is_direct: bool = True
    num_stops: int = 0
    connection_airports: List[str] = field(default_factory=list)
    
    # Timing
    departure_datetime: Optional[datetime] = None
    arrival_datetime: Optional[datetime] = None
    total_duration_minutes: int = 0
    
    # Payment
    payment_method: Literal["cash", "points"] = "cash"
    cash_cost: Optional[float] = None
    points_cost: Optional[int] = None
    points_program: Optional[str] = None
    surcharge: Optional[float] = None
    
    # Booking
    booking_link: Optional[str] = None
    requires_separate_bookings: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "segment_id": self.segment_id,
            "origin": self.origin,
            "destination": self.destination,
            "legs": [l.to_dict() for l in self.legs],
            "layovers": [l.to_dict() for l in self.layovers],
            "is_direct": self.is_direct,
            "num_stops": self.num_stops,
            "connection_airports": self.connection_airports,
            "departure_datetime": self.departure_datetime.isoformat() if self.departure_datetime else None,
            "arrival_datetime": self.arrival_datetime.isoformat() if self.arrival_datetime else None,
            "total_duration_minutes": self.total_duration_minutes,
            "payment_method": self.payment_method,
            "cash_cost": self.cash_cost,
            "points_cost": self.points_cost,
            "points_program": self.points_program,
            "surcharge": self.surcharge,
            "booking_link": self.booking_link,
            "requires_separate_bookings": self.requires_separate_bookings,
        }


@dataclass
class Itinerary:
    """Complete optimized itinerary."""
    itinerary_id: str
    
    # Segments
    flight_segments: List[FlightSegment] = field(default_factory=list)
    transfer_plan: Optional[TransferPlan] = None
    
    # Totals (ALL REAL) - These are TOTAL for the party
    total_oop: float = 0.0
    total_cash: float = 0.0
    total_surcharges: float = 0.0
    points_used: Dict[str, int] = field(default_factory=dict)
    
    # Party size
    party_size: int = 1
    num_adults: int = 1
    num_children: int = 0
    
    # Route
    origin: str = ""
    destination: str = ""
    stops: List[str] = field(default_factory=list)
    path: List[str] = field(default_factory=list)
    
    # Timing
    departure_datetime: Optional[datetime] = None
    arrival_datetime: Optional[datetime] = None
    total_duration_minutes: int = 0
    
    # Budget status
    within_budget: bool = True
    user_budget: Optional[float] = None
    budget_exceeded_by: Optional[float] = None
    
    # Metadata
    generated_at: Optional[datetime] = None
    data_freshness: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    
    # For compatibility with existing code
    name: str = "Optimized Route"
    score: int = 100
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "itinerary_id": self.itinerary_id,
            "flight_segments": [s.to_dict() for s in self.flight_segments],
            "transfer_plan": self.transfer_plan.to_dict() if self.transfer_plan else None,
            "total_oop": self.total_oop,
            "total_cash": self.total_cash,
            "total_surcharges": self.total_surcharges,
            "points_used": self.points_used,
            "party_size": self.party_size,
            "num_adults": self.num_adults,
            "num_children": self.num_children,
            "origin": self.origin,
            "destination": self.destination,
            "stops": self.stops,
            "path": self.path,
            "departure_datetime": self.departure_datetime.isoformat() if self.departure_datetime else None,
            "arrival_datetime": self.arrival_datetime.isoformat() if self.arrival_datetime else None,
            "total_duration_minutes": self.total_duration_minutes,
            "within_budget": self.within_budget,
            "user_budget": self.user_budget,
            "budget_exceeded_by": self.budget_exceeded_by,
            "generated_at": self.generated_at.isoformat() if self.generated_at else None,
            "name": self.name,
            "score": self.score,
        }


@dataclass
class OptimizationResult:
    """Result of ILP optimization."""
    success: bool
    itinerary: Optional[Itinerary] = None
    total_oop: Optional[float] = None
    within_budget: bool = True
    user_budget: Optional[float] = None
    budget_exceeded_by: Optional[float] = None
    suggested_budget: Optional[int] = None  # Recommended budget (with 10% buffer)
    message: Optional[str] = None
    
    # ILP solution details
    solution: Optional[Dict[str, Any]] = None
    status: str = ""
    
    # Alternatives if budget exceeded
    alternatives: List[Dict[str, Any]] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "success": self.success,
            "itinerary": self.itinerary.to_dict() if self.itinerary else None,
            "total_oop": self.total_oop,
            "within_budget": self.within_budget,
            "user_budget": self.user_budget,
            "budget_exceeded_by": self.budget_exceeded_by,
            "suggested_budget": self.suggested_budget,
            "message": self.message,
            "status": self.status,
            "alternatives": self.alternatives,
        }
