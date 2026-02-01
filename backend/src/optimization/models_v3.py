"""
V3 data models for optimization.

Key design decisions:
- Every decision-relevant entity has a string ID for variable naming
- FundingSource separates "how to pay" from "what to pay for"
- AwardOption has option_id for precise decision variable indexing
- FlightItineraryEdge represents complete itinerary (not single segment)
- Integer-safe transfer modeling via effective_delivered_per_block
"""

from dataclasses import dataclass, field
from datetime import datetime, date
from typing import List, Optional, Dict, Tuple
from enum import Enum
import math

from .enums import (
    TicketingType, ConnectionProtection, SelfTransferRequired,
    TransferType, TransferConfidence,
)


# =============================================================================
# FUNDING SOURCE: How points are paid (native or transfer)
# =============================================================================

@dataclass
class FundingSource:
    """
    A way to fund an award booking.
    
    CRITICAL: Has a string `source_id` for reliable dict keys and var names.
    
    Two types:
    - native: Use points directly from a program balance
    - transfer: Transfer bank points to a program
    """
    
    source_id: str  # e.g., "native_alice_united" or "transfer_alice_chase_hyatt"
    source_type: str  # "native" or "transfer"
    owner_id: str  # Which traveler owns this source
    
    # For native
    program: Optional[str] = None
    
    # For transfer
    from_bank: Optional[str] = None
    to_program: Optional[str] = None
    transfer_path_id: Optional[str] = None
    
    @staticmethod
    def make_native(owner_id: str, program: str) -> "FundingSource":
        """Create a native funding source."""
        return FundingSource(
            source_id=f"native_{owner_id}_{program}",
            source_type="native",
            owner_id=owner_id,
            program=program,
        )
    
    @staticmethod
    def make_transfer(
        owner_id: str, 
        from_bank: str, 
        to_program: str, 
        path_id: str
    ) -> "FundingSource":
        """Create a transfer funding source."""
        return FundingSource(
            source_id=f"transfer_{owner_id}_{from_bank}_{to_program}",
            source_type="transfer",
            owner_id=owner_id,
            from_bank=from_bank,
            to_program=to_program,
            transfer_path_id=path_id,
        )
    
    @property
    def is_native(self) -> bool:
        return self.source_type == "native"
    
    @property
    def is_transfer(self) -> bool:
        return self.source_type == "transfer"
    
    @property
    def target_program(self) -> str:
        """Get the program this source funds."""
        return self.program if self.is_native else self.to_program


# =============================================================================
# AWARD OPTION: What the program charges (miles + surcharge)
# =============================================================================

@dataclass
class AwardOption:
    """
    A specific award booking option.
    
    CRITICAL: Has `option_id` for use in decision variable indexing.
    This allows the solver to track which specific award option is selected.
    """
    
    option_id: str  # Unique per booking, e.g., "united_economy_50k"
    program: str  # Normalized: "united", "hyatt", etc.
    
    miles_required: int
    surcharge: float  # Cash component (taxes/fees)
    
    cabin_or_room_type: str  # "economy", "business", "standard_king", etc.
    
    # Value metrics
    cash_equivalent: float  # What cash booking would cost
    
    @property
    def raw_value(self) -> float:
        """Value of using this award (cash saved)."""
        return self.cash_equivalent - self.surcharge
    
    @property
    def cpp(self) -> float:
        """Cents per point value."""
        if self.miles_required <= 0:
            return 0.0
        return (self.raw_value * 100) / self.miles_required
    
    # PRECOMPUTED soft values (filled by precompute step, not in MILP)
    soft_value_oop: float = 0.0
    soft_value_cpp: float = 0.0
    soft_value_balanced: float = 0.0
    
    # Availability / risk
    availability_score: float = 1.0  # 0-1, likelihood still bookable
    is_waitlisted: bool = False


# =============================================================================
# FLIGHT SEGMENT: Single flight within an itinerary
# =============================================================================

@dataclass
class FlightSegment:
    """One flight within an itinerary."""
    
    segment_id: str  # Unique within itinerary
    flight_number: str
    operating_carrier: str  # Who actually flies the plane
    marketing_carrier: str  # Who sells the ticket
    
    origin: str
    destination: str
    departure: datetime
    arrival: datetime
    
    cabin: Optional[str] = None  # "economy", "business", "first"
    aircraft: Optional[str] = None
    
    @property
    def duration_minutes(self) -> int:
        """Flight duration in minutes."""
        delta = self.arrival - self.departure
        return int(delta.total_seconds() / 60)


# =============================================================================
# FLIGHT ITINERARY EDGE: Complete itinerary as single decision unit
# =============================================================================

@dataclass
class FlightItineraryEdge:
    """
    A complete flight itinerary as a single edge.
    
    CRITICAL FIELDS:
    - edge_id: string for variable naming
    - ticketing_type: must be "single_ticket" for connections
    - award_options: list with option_id for precise indexing
    """
    
    edge_id: str  # Unique string ID for var names
    leg_id: int  # Which leg this serves
    
    origin: str  # First departure airport
    destination: str  # Final arrival airport
    segments: List[FlightSegment] = field(default_factory=list)
    
    departure_datetime: datetime = None
    arrival_datetime: datetime = None
    total_time_minutes: int = 0
    
    @property
    def num_stops(self) -> int:
        """
        Number of stops (connections) in the itinerary.
        
        IMPORTANT: Uses num_stops_hint if available, because missing segments
        can make a connection look like a direct flight.
        """
        if self.num_stops_hint is not None:
            return self.num_stops_hint
        return max(0, len(self.segments) - 1)
    
    @property
    def is_direct(self) -> bool:
        """
        True if this is a direct (non-stop) flight.
        
        IMPORTANT: Only returns True if we're CERTAIN it's direct.
        If num_stops_hint says there are stops, we trust that over segment count.
        """
        # If provider says there are stops, trust that
        if self.num_stops_hint is not None and self.num_stops_hint > 0:
            return False
        
        # If we have incomplete segments and no hint, we can't be sure
        if self.segments_incomplete:
            return False
        
        # Single segment = direct
        return len(self.segments) <= 1
    
    @property
    def has_priced_offer(self) -> bool:
        """True if we have some form of pricing artifact."""
        return bool(self.offer_id or self.pricing_id or self.fare_id or self.pnr)
    
    @property
    def is_airline_protected(self) -> bool:
        """True if connection is protected by AIRLINE (not OTA)."""
        return self.connection_protection == ConnectionProtection.AIRLINE_PROTECTED
    
    @property
    def has_some_protection(self) -> bool:
        """
        True if connection has some form of protection.
        
        NOTE: This includes OTA guarantees which are NOT equivalent to airline protection.
        Use is_airline_protected for strict checks.
        """
        return self.connection_protection in {
            ConnectionProtection.AIRLINE_PROTECTED,
            ConnectionProtection.OTA_GUARANTEE,
        }
    
    @property
    def is_safe_to_show(self) -> bool:
        """
        True if this itinerary is safe to show to users under STRICT policy.
        
        For policy-driven checks, use the validator instead.
        
        MVP criteria:
        - Direct flights: always safe
        - Connections: must be AIRLINE protected AND not self-transfer
        """
        if self.is_direct:
            return True
        
        return (
            self.is_airline_protected and
            self.self_transfer_required == SelfTransferRequired.NO
        )
    
    # Cash booking option
    # NOTE: When cash_cost_unknown=True, cash_cost contains a penalty value
    # for optimization purposes. The real cash price is unknown.
    cash_cost: float = 0.0
    cash_cost_unknown: bool = False  # True if original cash price was unknown (e.g., -1 sentinel)
    
    # Award options (multiple programs may offer this itinerary)
    award_options: List[AwardOption] = field(default_factory=list)
    
    # ═══════════════════════════════════════════════════════════════════════
    # TICKETING / CONNECTION SAFETY (V4)
    # ═══════════════════════════════════════════════════════════════════════
    
    # Ticketing type (derived by finalize_itinerary)
    ticketing_type: TicketingType = TicketingType.UNKNOWN
    
    # Connection protection (derived by finalize_itinerary)
    connection_protection: ConnectionProtection = ConnectionProtection.UNKNOWN
    
    # Self-transfer requirement (derived by finalize_itinerary)
    self_transfer_required: SelfTransferRequired = SelfTransferRequired.UNKNOWN
    
    # Transfer type (derived by finalize_itinerary)
    transfer_type: TransferType = TransferType.UNKNOWN
    transfer_confidence: TransferConfidence = TransferConfidence.LOW
    
    # Who provides the protection (e.g., "airline", "Kiwi Guarantee")
    protection_provider: Optional[str] = None
    
    # Reasons for landside transfer (if applicable)
    landside_reasons: List[str] = field(default_factory=list)
    
    # Raw data from provider
    validating_carrier: Optional[str] = None
    pricing_source: Optional[str] = None  # "amadeus", "duffel", "awardtool", etc.
    offer_id: Optional[str] = None
    pricing_id: Optional[str] = None
    fare_id: Optional[str] = None
    pnr: Optional[str] = None
    
    # Provider-reported stop count (prevents missing segments from looking direct)
    num_stops_hint: Optional[int] = None
    
    # Data completeness flags
    segments_incomplete: bool = False
    
    # True if we have a pricing artifact, regardless of whether we trust the source
    pricing_artifact_present: bool = False
    
    # Was this edge finalized (derived attributes computed)?
    # IMMUTABILITY RULE: After finalize_itinerary() is called, the edge should
    # be treated as immutable. Do not modify segments or raw fields after finalization.
    _finalized: bool = False
    
    # Chain breaks detected in _compute_completeness (internal use)
    _chain_breaks: List[dict] = field(default_factory=list)
    
    # Warnings (informational, not blocking)
    connection_warnings: List[str] = field(default_factory=list)
    has_carrier_change: bool = False
    
    # ═══════════════════════════════════════════════════════════════════════
    # DATE FEASIBILITY (precomputed for MILP constraints)
    # ═══════════════════════════════════════════════════════════════════════
    
    departs_on_date: Optional[date] = None
    arrives_by_date: Optional[date] = None
    
    # Quality flags
    is_redeye: bool = False
    has_long_layover: bool = False
    has_short_connection: bool = False  # < 60 min
    
    def compute_date_fields(self):
        """Compute arrival/departure dates for MILP constraints."""
        if self.departure_datetime:
            self.departs_on_date = self.departure_datetime.date()
        if self.arrival_datetime:
            self.arrives_by_date = self.arrival_datetime.date()
    
    def validate_connections(self) -> List[str]:
        """
        Check for carrier changes (warning only, not blocking).
        
        NOTE: This does NOT validate "protected connection" - 
        only ticketing_type determines that.
        """
        warnings = []
        
        if len(self.segments) <= 1:
            return warnings
        
        for i in range(len(self.segments) - 1):
            s1, s2 = self.segments[i], self.segments[i + 1]
            
            if s1.marketing_carrier != s2.marketing_carrier:
                self.has_carrier_change = True
                warnings.append(
                    f"Carrier change at {s1.destination}: "
                    f"{s1.marketing_carrier} → {s2.marketing_carrier}"
                )
            
            # Check connection time
            connection_minutes = (s2.departure - s1.arrival).total_seconds() / 60
            if connection_minutes < 60:
                self.has_short_connection = True
                warnings.append(
                    f"Short connection at {s1.destination}: {int(connection_minutes)} min"
                )
            elif connection_minutes > 240:  # 4 hours
                self.has_long_layover = True
                warnings.append(
                    f"Long layover at {s1.destination}: {int(connection_minutes / 60)} hours"
                )
        
        self.connection_warnings = warnings
        return warnings
    
    def best_award_value(self) -> float:
        """Best award value among all options."""
        if not self.award_options:
            return 0.0
        return max(opt.raw_value for opt in self.award_options)
    
    def best_cpp(self) -> float:
        """Best CPP among all options."""
        if not self.award_options:
            return 0.0
        return max(opt.cpp for opt in self.award_options)


# =============================================================================
# ROOM TYPE: Hotel room category
# =============================================================================

@dataclass
class RoomType:
    """A room type at a hotel."""
    
    room_type_id: str  # e.g., "standard_king"
    name: str  # "Standard King", "Suite", etc.
    capacity: int  # Max occupants
    
    cash_per_night: float
    
    # Award pricing (if available)
    award_program: Optional[str] = None  # Normalized: "hyatt", "marriott"
    points_per_night: Optional[int] = None
    award_surcharge_per_night: float = 0.0
    
    @property
    def has_award_pricing(self) -> bool:
        """Check if this room type has award pricing."""
        return self.award_program is not None and self.points_per_night is not None and self.points_per_night > 0
    
    def award_cpp(self) -> float:
        """Cents per point for award booking."""
        if not self.has_award_pricing or self.points_per_night <= 0:
            return 0.0
        value = self.cash_per_night - self.award_surcharge_per_night
        return (value * 100) / self.points_per_night


# =============================================================================
# HOTEL OPTION: Hotel for a stay segment
# =============================================================================

@dataclass
class HotelOption:
    """A hotel option for a stay segment."""
    
    hotel_id: str  # Unique string ID
    segment_id: int  # Which stay segment
    
    hotel_name: str
    chain: str  # "HYATT", "MARRIOTT", etc. (normalized)
    star_rating: float
    location_score: float = 0.0  # 0-1, proximity to attractions
    
    room_types: List[RoomType] = field(default_factory=list)
    
    # Quality metrics
    review_score: float = 0.0
    amenities: List[str] = field(default_factory=list)
    
    # For pruning heuristics
    def cheapest_cash_per_night(self) -> float:
        """Cheapest room per night (for pruning)."""
        if not self.room_types:
            return float('inf')
        return min(rt.cash_per_night for rt in self.room_types)
    
    def best_award_cpp(self) -> float:
        """Best CPP among award room types."""
        cpps = [rt.award_cpp() for rt in self.room_types if rt.has_award_pricing]
        return max(cpps) if cpps else 0.0
    
    def best_award_value_per_night(self) -> float:
        """Best award value per night."""
        values = []
        for rt in self.room_types:
            if rt.has_award_pricing:
                value = rt.cash_per_night - rt.award_surcharge_per_night
                values.append(value)
        return max(values) if values else 0.0
    
    def get_award_room_types(self) -> List[RoomType]:
        """Get room types with award pricing."""
        return [rt for rt in self.room_types if rt.has_award_pricing]
    
    def get_award_programs(self) -> List[str]:
        """Get unique award programs available."""
        programs = set()
        for rt in self.room_types:
            if rt.has_award_pricing and rt.award_program:
                programs.add(rt.award_program)
        return list(programs)


# =============================================================================
# TRANSFER PATH: Bank -> Program transfer with integer-safe delivery
# =============================================================================

@dataclass
class TransferPath:
    """
    Transfer path with integer-safe delivery.
    
    CRITICAL: effective_delivered_per_block is precomputed as floor()
    to ensure we never promise fractional points.
    """
    
    path_id: str  # e.g., "chase_to_united"
    from_bank: str  # Normalized: "chase", "amex"
    to_program: str  # Normalized: "united", "hyatt"
    
    min_increment: int  # e.g., 1000
    ratio: float  # e.g., 1.0 or 0.75
    current_bonus: float = 1.0  # e.g., 1.25 for 25% promo
    
    # PRECOMPUTED integer-safe delivery
    effective_delivered_per_block: int = 0  # floor(increment * ratio * bonus)
    
    # Timing
    is_instant: bool = True
    typical_hours: int = 0
    max_hours: int = 0
    
    # Promo info
    bonus_expiry_date: Optional[date] = None
    
    def __post_init__(self):
        """Precompute integer-safe delivered points per block."""
        raw = self.min_increment * self.ratio * self.current_bonus
        self.effective_delivered_per_block = int(math.floor(raw))
    
    def blocks_needed(self, target_miles: int) -> int:
        """Blocks needed to deliver at least target_miles."""
        if self.effective_delivered_per_block <= 0:
            return 999999
        return math.ceil(target_miles / self.effective_delivered_per_block)
    
    def bank_points_needed(self, target_miles: int) -> int:
        """Bank points needed for target miles."""
        return self.blocks_needed(target_miles) * self.min_increment
    
    def delivered_from_blocks(self, blocks: int) -> int:
        """Miles delivered from N blocks."""
        return blocks * self.effective_delivered_per_block


# =============================================================================
# CONFIGURATION DATACLASSES
# =============================================================================

@dataclass
class SlackConfig:
    """Two-pass slack configuration."""
    rel_eps: float = 0.01  # 1% relative slack
    abs_eps: float = 25.0  # $25 absolute slack


@dataclass
class BalancedModeConfig:
    """
    Balanced mode configuration.
    
    SIMPLIFIED: No baseline_cash. Use cash_penalty directly.
    """
    
    # Category importance (user-tunable)
    flight_importance: float = 1.0
    hotel_importance: float = 1.0
    
    # Cash penalty (so balanced doesn't ignore cash entirely)
    # Objective = value_utility - cash_penalty_weight * total_cash
    cash_penalty_weight: float = 0.001  # Small penalty per dollar
    
    # Quality penalties for flights
    time_penalty_per_hour: float = 0.02  # 2% penalty per hour over baseline
    baseline_hours: float = 8.0  # No penalty up to this
    connection_penalty: float = 0.20  # 20% penalty per stop
    carrier_change_penalty: float = 0.10  # 10% penalty for carrier change
    redeye_penalty: float = 0.15  # 15% penalty for redeye
    
    # Quality bonuses for hotels
    star_rating_bonus: Dict[float, float] = field(default_factory=lambda: {
        5.0: 1.2,
        4.5: 1.1,
        4.0: 1.0,
        3.5: 0.95,
        3.0: 0.9,
    })
    
    # Availability risk
    low_availability_penalty: float = 0.30  # 30% penalty for low availability
    min_availability_threshold: float = 0.3  # Hard filter below this
    
    # Normalization
    min_samples_for_median: int = 5
    default_K: float = 100.0  # Default normalization constant


@dataclass
class SolverConfig:
    """Solver configuration."""
    
    time_limit_seconds: float = 30.0
    mip_gap: float = 0.01  # 1% optimality gap acceptable
    
    # Thread settings
    threads_production: int = 4
    threads_determinism: int = 1  # For determinism tests
    
    # Fallback
    enable_heuristic_fallback: bool = True


@dataclass
class PruningConfig:
    """
    Mode-aware multi-criteria pruning configuration.
    
    Keep candidates by MULTIPLE criteria, then union.
    """
    
    # Per O-D limits for flights
    max_by_cash: int = 10  # Top 10 by lowest cash
    max_by_time: int = 5  # Top 5 by shortest time
    max_by_award: int = 10  # Top 10 by best award value
    max_total_per_od: int = 20  # Cap after union
    
    # Per segment limits for hotels
    max_hotels_by_cash: int = 8
    max_hotels_by_award: int = 8
    max_hotels_by_rating: int = 5
    max_hotels_total: int = 15
    
    # Award programs per edge
    max_award_programs_per_edge: int = 3
    
    # Hard limits
    max_stops: int = 2
    max_duration_hours: float = 36.0


# =============================================================================
# RESULT TYPES
# =============================================================================

class OptimizationStatus(Enum):
    """Status of optimization result."""
    OPTIMAL = "optimal"
    FEASIBLE_SUBOPTIMAL = "feasible_suboptimal"
    INFEASIBLE_DATA = "infeasible_data"
    INFEASIBLE_MODEL = "infeasible_model"
    INFEASIBLE_PREFERENCES = "infeasible_preferences"
    TIMEOUT = "timeout"
    ERROR = "error"


@dataclass
class PaymentChoice:
    """Payment choice for a booking."""
    payer_id: str
    method: str  # "cash" or "points"
    
    # For points payment
    award_option_id: Optional[str] = None
    funding_source_id: Optional[str] = None
    
    # Amounts
    cash_amount: float = 0.0
    points_amount: int = 0


@dataclass
class Solution:
    """Extracted solution from the solver."""
    
    # Selected items
    selected_flights: Dict[int, str] = field(default_factory=dict)  # leg_id -> edge_id
    selected_hotels: Dict[int, str] = field(default_factory=dict)  # segment_id -> hotel_id
    selected_rooms: Dict[str, Dict[str, int]] = field(default_factory=dict)  # hotel_id -> {room_type_id: count}
    
    # Payment
    flight_payments: Dict[str, PaymentChoice] = field(default_factory=dict)  # edge_id -> payment
    hotel_payments: Dict[str, PaymentChoice] = field(default_factory=dict)  # hotel_id -> payment
    
    # Transfers
    transfers_used: Dict[Tuple[str, str, str], int] = field(default_factory=dict)  # (payer, bank, program) -> blocks
    
    # Totals
    total_cash: float = 0.0
    total_points_by_program: Dict[str, int] = field(default_factory=dict)
    total_value: float = 0.0  # Value captured from awards
    
    @property
    def total_points(self) -> int:
        """Total points across all programs."""
        return sum(self.total_points_by_program.values())


@dataclass
class OptimizationResult:
    """Complete result from the optimizer."""
    
    status: OptimizationStatus
    solution: Optional[Solution]
    
    # Metrics
    solve_time_seconds: float = 0.0
    num_variables: int = 0
    num_constraints: int = 0
    
    # Pass 1/2 info
    pass1_objective: float = 0.0
    pass1_slack: float = 0.0
    pass2_objective: float = 0.0
    
    # User-facing
    warnings: List[str] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)
    
    # For infeasible cases
    infeasibility_reason: Optional[str] = None
    missing_data: List[str] = field(default_factory=list)
