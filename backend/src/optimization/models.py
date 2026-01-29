"""
Data models for the optimization system.

This module defines strongly-typed data classes for flight edges,
optimization configuration, and solver solutions.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple, Literal
from enum import Enum


# Type aliases for clarity
EdgeKey = Tuple[str, str, str]  # (origin, destination, flight_number)
TravelerId = str
AirlineCode = str
BankCode = str


class OptimizationMode(str, Enum):
    """Optimization mode for the ILP solver."""
    CPP = "cpp"  # Cents Per Point - maximize point value
    OOP = "oop"  # Out Of Pocket - minimize cash paid


class PaymentMethod(str, Enum):
    """Payment method for a flight segment."""
    CASH = "cash"
    POINTS_TRANSFER = "points_transfer"  # Bank points transferred to airline
    POINTS_NATIVE = "points_native"      # Direct airline miles


@dataclass
class FlightEdge:
    """
    Represents a flight edge in the optimization graph.
    
    Contains all pricing information for both cash and award bookings.
    """
    origin: str
    destination: str
    flight_number: str
    
    # Cash booking
    cash_cost: float  # USD
    
    # Award booking (optional - not all flights have award availability)
    points_cost: Optional[int] = None
    points_program: Optional[str] = None  # Airline code (e.g., "UA", "AA")
    points_surcharge: float = 0.0  # Taxes/fees for award booking
    
    # Transfer partners that can access this award
    transfer_partners: List[str] = field(default_factory=list)
    
    # Time and schedule
    time_cost: float = 0.0  # Total travel time in minutes
    departure_time: Optional[str] = None  # ISO format
    arrival_time: Optional[str] = None    # ISO format
    
    # Operating carrier
    operating_airline: Optional[str] = None
    
    @property
    def key(self) -> EdgeKey:
        """Return the edge key tuple."""
        return (self.origin, self.destination, self.flight_number)
    
    @property
    def has_award(self) -> bool:
        """Check if this edge has award availability."""
        return self.points_cost is not None and self.points_cost > 0
    
    def cpp_value(self) -> float:
        """
        Calculate cents-per-point value for this award.
        
        Returns 0.0 if no award available or surcharge exceeds cash price.
        """
        if not self.has_award or self.points_cost <= 0:
            return 0.0
        cash_saved = self.cash_cost - self.points_surcharge
        if cash_saved <= 0:
            return 0.0
        return (cash_saved * 100.0) / self.points_cost
    
    def to_dict(self) -> Dict:
        """Convert to dictionary format for edge_dict."""
        return {
            "cash_cost": self.cash_cost,
            "points_cost": self.points_cost,
            "points_program": self.points_program,
            "points_surcharge": self.points_surcharge,
            "transfer_partners": self.transfer_partners,
            "time_cost": self.time_cost,
            "departure_time": self.departure_time,
            "arrival_time": self.arrival_time,
            "operating_airline": self.operating_airline,
        }
    
    @classmethod
    def from_dict(cls, key: EdgeKey, data: Dict) -> "FlightEdge":
        """Create FlightEdge from dictionary."""
        return cls(
            origin=key[0],
            destination=key[1],
            flight_number=key[2],
            cash_cost=float(data.get("cash_cost", 0)),
            points_cost=data.get("points_cost"),
            points_program=data.get("points_program"),
            points_surcharge=float(data.get("points_surcharge", 0)),
            transfer_partners=data.get("transfer_partners", []),
            time_cost=float(data.get("time_cost", 0)),
            departure_time=data.get("departure_time"),
            arrival_time=data.get("arrival_time"),
            operating_airline=data.get("operating_airline"),
        )


@dataclass
class TransferInstruction:
    """Instructions for transferring points from a bank to an airline."""
    from_bank: BankCode
    from_bank_name: str
    to_airline: AirlineCode
    to_airline_name: str
    points_to_transfer: int
    miles_received: int
    transfer_ratio: str  # e.g., "1:1" or "1:0.75"
    transfer_time: str   # e.g., "instant", "1-2 days"
    portal_url: Optional[str] = None


@dataclass
class SegmentPayment:
    """Payment details for a single flight segment."""
    edge: EdgeKey
    payment_method: PaymentMethod
    payer_id: TravelerId
    traveler_id: TravelerId
    
    # Cash payment
    cash_paid: float = 0.0
    
    # Points payment
    points_used: int = 0
    airline_program: Optional[AirlineCode] = None
    source_bank: Optional[BankCode] = None  # If transferred
    surcharge_paid: float = 0.0


@dataclass
class TravelerPath:
    """Complete path and payment details for one traveler."""
    traveler_id: TravelerId
    path: List[str]  # List of city codes
    edges: List[EdgeKey]
    payments: List[SegmentPayment]
    
    @property
    def total_cash(self) -> float:
        """Total cash paid including surcharges."""
        return sum(p.cash_paid + p.surcharge_paid for p in self.payments)
    
    @property
    def total_points(self) -> int:
        """Total points used."""
        return sum(p.points_used for p in self.payments)


@dataclass
class ILPSolution:
    """
    Complete solution from the ILP optimizer.
    
    Contains paths, payments, and transfer instructions for all travelers.
    """
    status: str  # "Optimal", "Infeasible", etc.
    mode: OptimizationMode
    
    # Per-traveler results
    traveler_paths: Dict[TravelerId, TravelerPath] = field(default_factory=dict)
    
    # Transfer instructions (aggregated)
    transfers: List[TransferInstruction] = field(default_factory=list)
    
    # Totals
    total_cash: float = 0.0
    total_points: int = 0
    total_time: float = 0.0
    total_points_value: float = 0.0  # CPP value achieved
    
    # Raw solver output (for debugging)
    raw_edges: Dict[TravelerId, List[EdgeKey]] = field(default_factory=dict)
    raw_path: Dict[TravelerId, List[str]] = field(default_factory=dict)
    
    @property
    def is_optimal(self) -> bool:
        """Check if solver found optimal solution."""
        return self.status == "Optimal"
    
    def to_legacy_format(self) -> Dict:
        """
        Convert to legacy format for backward compatibility.
        
        Returns the format expected by existing code.
        """
        return {
            "status": self.status,
            "edges": {t: [list(e) for e in p.edges] for t, p in self.traveler_paths.items()},
            "path": {t: p.path for t, p in self.traveler_paths.items()},
            "total_points": self.total_points,
            "total_cash": self.total_cash,
            "total_time": self.total_time,
            "total_points_value": self.total_points_value,
            "payment": {
                "cash_bookings": {},  # Populated by caller
                "points_bookings": {},
                "transfers_used": {},
                "native_used": {},
            },
        }


@dataclass
class OptimizationConfig:
    """
    Configuration for the ILP optimizer.
    
    Contains all tunable parameters and thresholds.
    """
    # Mode
    mode: OptimizationMode = OptimizationMode.OOP
    
    # CPP thresholds
    min_cpp_threshold: float = 0.5  # Minimum CPP to use points (OOP mode)
    default_cpp_threshold: float = 1.2  # Default for unknown programs
    
    # Surcharge limits
    max_surcharge_ratio: float = 0.50  # Max surcharge as % of cash price
    max_surcharge_absolute: float = 300.0  # Max surcharge per segment ($)
    
    # Objective weights (CPP mode)
    w_points_value: float = 1e6
    w_cash_cost: float = 1e3
    w_time_cost: float = 1.0
    
    # Objective weights (OOP mode)
    w_oop_savings: float = 1e7
    w_oop_cash: float = 1e6
    w_oop_surcharge: float = 1e3
    w_oop_time: float = 1.0
    
    # Penalty weights
    w_extra_city: float = 1e8  # Penalty for routing through unwanted cities
    w_card_benefit: float = 1e4  # Bonus for card perks
    
    # Transfer settings
    transfer_block_size: int = 1000
    
    # Budget defaults
    default_cash_budget: float = 1e9
    
    def get_cpp_threshold(self, airline: str) -> float:
        """Get CPP threshold for a specific airline program."""
        from .constants import CPP_THRESHOLDS
        return CPP_THRESHOLDS.get(airline.upper(), self.default_cpp_threshold)
    
    def should_reject_award(self, cash_cost: float, surcharge: float) -> bool:
        """Check if award should be rejected due to excessive surcharge."""
        if surcharge > self.max_surcharge_absolute:
            return True
        if cash_cost > 0 and surcharge > cash_cost * self.max_surcharge_ratio:
            return True
        return False


@dataclass
class ILPInputs:
    """
    Structured inputs for the ILP solver.
    
    This replaces the large dictionary of parameters with a typed structure.
    """
    # Travelers and routing
    travelers: List[TravelerId]
    start_city: Dict[TravelerId, str]
    end_city: Dict[TravelerId, str]
    cities: List[str]
    edges: List[EdgeKey]
    must_visit_cities: List[str] = field(default_factory=list)
    meetup_cities: List[str] = field(default_factory=list)
    
    # Edge costs
    time_cost: Dict[EdgeKey, float] = field(default_factory=dict)
    cash_cost: Dict[EdgeKey, float] = field(default_factory=dict)
    departure_time: Dict[EdgeKey, str] = field(default_factory=dict)
    arrival_time: Dict[EdgeKey, str] = field(default_factory=dict)
    
    # Airlines and award pricing
    airlines: List[AirlineCode] = field(default_factory=list)
    award_points: Dict[AirlineCode, Dict[EdgeKey, float]] = field(default_factory=dict)
    cash_surcharge: Dict[AirlineCode, Dict[EdgeKey, float]] = field(default_factory=dict)
    allowed_award_edge: Dict[AirlineCode, Dict[EdgeKey, int]] = field(default_factory=dict)
    
    # Points balances
    sources_by_trav: Dict[TravelerId, List[BankCode]] = field(default_factory=dict)
    source_balances: Dict[Tuple[TravelerId, BankCode], float] = field(default_factory=dict)
    miles_balance: Dict[Tuple[TravelerId, AirlineCode], float] = field(default_factory=dict)
    
    # Transfer rules
    allowed_transfers: Set[Tuple[BankCode, AirlineCode]] = field(default_factory=set)
    transfer_ratio: Dict[Tuple[BankCode, AirlineCode], float] = field(default_factory=dict)
    transfer_bonus: Dict[Tuple[BankCode, AirlineCode], float] = field(default_factory=dict)
    transfer_block_size: Dict[Tuple[BankCode, AirlineCode], int] = field(default_factory=dict)
    
    # Eligibility
    link_ok: Dict[Tuple[TravelerId, AirlineCode], int] = field(default_factory=dict)
    can_pay_for: Dict[Tuple[TravelerId, TravelerId], int] = field(default_factory=dict)
    budget_cash: Dict[TravelerId, float] = field(default_factory=dict)
    
    # Seat capacity
    total_cash_seats: Dict[EdgeKey, int] = field(default_factory=dict)
    award_seats: Dict[AirlineCode, Dict[EdgeKey, int]] = field(default_factory=dict)
    
    # Card benefits
    benefit_airlines: Dict[TravelerId, Set[AirlineCode]] = field(default_factory=dict)
    edge_to_airline: Dict[EdgeKey, AirlineCode] = field(default_factory=dict)
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for legacy function calls."""
        return {
            "travelers": self.travelers,
            "start_city": self.start_city,
            "end_city": self.end_city,
            "cities": self.cities,
            "edges": self.edges,
            "must_visit_cities": self.must_visit_cities,
            "meetup_cities": self.meetup_cities,
            "time_cost": self.time_cost,
            "cash_cost": self.cash_cost,
            "departure_time": self.departure_time,
            "arrival_time": self.arrival_time,
            "airlines": self.airlines,
            "award_points": self.award_points,
            "cash_surcharge": self.cash_surcharge,
            "allowed_award_edge": self.allowed_award_edge,
            "sources_by_trav": self.sources_by_trav,
            "source_balances": self.source_balances,
            "miles_balance": self.miles_balance,
            "allowed_sa": self.allowed_transfers,
            "ratio": self.transfer_ratio,
            "bonus": self.transfer_bonus,
            "inc_source": self.transfer_block_size,
            "link_ok": self.link_ok,
            "can_pay_for": self.can_pay_for,
            "budget_cash": self.budget_cash,
            "total_cash_seats": self.total_cash_seats,
            "award_seats": self.award_seats,
            "benefit_airlines": self.benefit_airlines,
            "edge_to_airline": self.edge_to_airline,
        }
