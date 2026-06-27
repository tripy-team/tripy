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
        
        CODESHARE AWARENESS: If all segments share the same marketing carrier,
        or are unified under a validating carrier, it's a codeshare — NOT a
        carrier change. Different operating carriers on the same marketing
        carrier = one reservation.
        """
        warnings = []
        
        if len(self.segments) <= 1:
            return warnings
        
        # Check if validating_carrier unifies all segments (codeshare scenario)
        # E.g., DL as validating carrier with AS-operated + BF-operated segments
        validating = (self.validating_carrier or "").strip().upper()[:2]
        
        # Collect all unique marketing carriers
        marketing_carriers = set()
        for seg in self.segments:
            mkt = (seg.marketing_carrier or "").strip().upper()[:2]
            if mkt:
                marketing_carriers.add(mkt)
        
        # Determine if there's a common marketing carrier
        # Case 1: All segments have same marketing carrier → codeshare, no change
        # Case 2: validating_carrier unifies different marketing carriers → codeshare
        # Case 3: Marketing carriers genuinely differ → real carrier change
        is_codeshare_unified = (
            len(marketing_carriers) <= 1 or
            (validating and validating not in marketing_carriers)
            # ^ If validating carrier differs from ALL segment carriers,
            #   segments are codeshare under validating carrier
        )
        
        for i in range(len(self.segments) - 1):
            s1, s2 = self.segments[i], self.segments[i + 1]
            
            if s1.marketing_carrier != s2.marketing_carrier:
                if is_codeshare_unified:
                    # Different operating/marketing codes but unified under one ticket
                    warnings.append(
                        f"Codeshare at {s1.destination}: "
                        f"{s1.marketing_carrier} → {s2.marketing_carrier} "
                        f"(unified under {validating or list(marketing_carriers)[0] if marketing_carriers else '?'})"
                    )
                else:
                    # Genuine carrier change — different airlines, separate booking risk
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

    # Chained transfer (bank -> hotel -> airline). When set, `ratio` is the
    # COMPOUND base ratio across both hops and `via` names the intermediate
    # hotel. The bank balance is the spend; the hotel hop is transient.
    via: Optional[str] = None        # e.g., "MAR" (hotel code) or None for direct
    via_name: Optional[str] = None   # e.g., "Marriott Bonvoy"
    
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
    """
    Two-pass slack configuration.
    
    IMPORTANT: The slack determines the "comfort budget" - how much extra
    cash the solver is allowed to spend to improve convenience in Pass 2.
    
    FLIGHTS-ONLY defaults (recommended):
      - Domestic: $125 (allows reasonable trade-offs)
      - International: $250 (long-haul needs more flexibility)
      - Relative: 5% of Pass 1 objective
    
    Pass 2 tie-breaks within this budget to minimize miles used,
    then time, then stops.
    """
    rel_eps: float = 0.05  # 5% relative slack
    abs_eps_domestic: float = 125.0  # $125 for domestic flights
    abs_eps_international: float = 250.0  # $250 for international flights
    
    # Legacy field for compatibility
    @property
    def abs_eps(self) -> float:
        """Default to domestic. Use get_abs_eps() for route-aware value."""
        return self.abs_eps_domestic
    
    def get_abs_eps(self, is_international: bool = False) -> float:
        """Get absolute epsilon based on route type."""
        return self.abs_eps_international if is_international else self.abs_eps_domestic


@dataclass
class ComfortConfig:
    """
    Comfort constraints and generalized cost configuration.
    
    This enables two key improvements:
    1. Hard constraints that filter out unacceptable itineraries
    2. Generalized cost that prices inconvenience in dollars
    
    The generalized cost model converts convenience into dollars:
        total_cost = cash + surcharge + stop_cost*stops + time_cost*excess_hours 
                   + layover_cost*excess_layover_hours + redeye_cost + carrier_change_cost
    """
    
    # ═══════════════════════════════════════════════════════════════════════
    # HARD CONSTRAINTS (filter out garbage)
    # ═══════════════════════════════════════════════════════════════════════
    
    max_stops_domestic: int = 1  # At most 1 stop for domestic
    max_stops_international: int = 2  # At most 2 stops for long-haul
    max_duration_ratio: float = 1.5  # No more than 50% longer than fastest option
    max_layover_hours: float = 4.0  # No layover longer than 4 hours
    require_single_ticket: bool = True  # No self-transfer (separate tickets)
    
    # ═══════════════════════════════════════════════════════════════════════
    # GENERALIZED COST (price inconvenience in dollars)
    # ═══════════════════════════════════════════════════════════════════════
    
    # Stop penalties - these are the "value of not having a stop"
    stop_cost_domestic: float = 100.0  # $100 per stop for domestic
    stop_cost_international: float = 175.0  # $175 per stop for long-haul
    
    # Time penalties
    time_cost_per_hour: float = 20.0  # $20 per hour over baseline
    baseline_hours_domestic: float = 4.0  # No penalty up to 4 hours domestic
    baseline_hours_international: float = 12.0  # No penalty up to 12 hours international
    
    # Layover penalties (after baseline connection time)
    layover_cost_per_hour: float = 25.0  # $25 per hour after 90 min
    baseline_layover_minutes: float = 90.0  # No penalty for connections up to 90 min
    
    # Quality penalties
    redeye_cost: float = 100.0  # $100 penalty for redeye flights
    carrier_change_cost: float = 75.0  # $75 penalty for carrier change mid-journey
    short_connection_cost: float = 50.0  # $50 penalty for < 60 min connection
    
    # ═══════════════════════════════════════════════════════════════════════
    # POINTS OPPORTUNITY COST (MODE-SPECIFIC)
    # ═══════════════════════════════════════════════════════════════════════
    #
    # The opportunity cost is now MODE-SPECIFIC to align with each mode's intent:
    #
    # OOP MODE: "Minimize cash out-of-pocket"
    #   - Users want to SPEND POINTS to SAVE CASH
    #   - Opportunity cost should be TINY (just a tiebreaker)
    #   - If two options cost the same cash, prefer using fewer points
    #
    # BALANCED MODE: "Good value without wasting points"
    #   - Users want savings but don't want terrible redemptions
    #   - Moderate opportunity cost (~0.8¢) discourages bad CPP
    #
    # CPP MODE: "Maximize points value"
    #   - Opportunity cost is IRRELEVANT (CPP objective already handles value)
    #   - Set to 0
    #
    # Additionally, a CPP_FLOOR prevents truly terrible redemptions in all modes.
    
    # ═══════════════════════════════════════════════════════════════════════
    # POINTS OPPORTUNITY COST (MODE-SPECIFIC)
    # ═══════════════════════════════════════════════════════════════════════
    #
    # FLIGHTS-ONLY DESIGN: OOP should minimize *cash leaving the bank*, not
    # "economic cost". Points opportunity cost should be OFF or tiny in OOP.
    #
    # OOP MODE: "Save cash using points"
    #   - Opportunity cost = OFF (0) or tiny tiebreaker (0.003 = 0.3¢)
    #   - Points will naturally win when they reduce cash
    #
    # BALANCED MODE: "Don't waste points"
    #   - Moderate opportunity cost (0.8-1.2¢)
    #
    # CPP MODE: "Maximize redemption value"
    #   - Opportunity cost irrelevant (CPP objective handles it)
    #
    points_opportunity_cost_oop: float = 0.0     # OFF in OOP - let points win!
    points_opportunity_cost_balanced: float = 0.010  # 1.0¢ - moderate guard
    points_opportunity_cost_cpp: float = 0.0     # 0¢ - not used in CPP mode
    
    # ═══════════════════════════════════════════════════════════════════════
    # CPP FLOOR (Flight-Specific Guardrail A)
    # ═══════════════════════════════════════════════════════════════════════
    #
    # If an award option's CPP is below this threshold, treat as INFEASIBLE.
    # This kills bad redemptions like "90k pts + $80 to replace $700 fare".
    #
    # FLIGHTS-ONLY defaults:
    #   - Transfer partners / major programs: 1.1-1.3¢
    #   - "Use points more aggressively": 1.0¢
    #
    # We ship 1.1¢ as the sweet spot - allows good redemptions, blocks junk.
    #
    cpp_floor: float = 1.1  # 1.1¢ minimum for flights - strong but fair
    cpp_floor_hotels: float = 0.7  # Hotels have different norms (lower CPP typical)
    enable_cpp_floor: bool = True
    
    # ═══════════════════════════════════════════════════════════════════════
    # MAX MILES PER DOLLAR SAVED (Most intuitive guardrail!)
    # ═══════════════════════════════════════════════════════════════════════
    #
    # This is the most user-intuitive rule:
    #   "Don't spend more than K miles to save $1"
    #
    # Formula:
    #   miles_per_dollar_saved = miles / max(1, cash_equivalent - surcharge)
    #
    # The constraint enforces:
    #   miles_per_dollar_saved <= max_miles_per_dollar
    #
    # Interpretation:
    #   - If you value points at 1.2¢, "fair" is ~83 miles per $ (1/0.012 = 83.33)
    #   - For "points-forward but not stupid": K = 120-160
    #   - This directly kills: "60k points to save $120" = 500 miles per $ ❌
    #
    # FLIGHTS-ONLY default: 140 miles per $
    # Aligns with ~0.7¢/pt floor (slightly more permissive than CPP floor)
    #
    # Example:
    #   Cash: $500, Award: 50k pts + $80 surcharge
    #   Savings = $500 - $80 = $420
    #   Miles per $ = 50,000 / 420 = 119 ← OK (under 150)
    #
    #   Cash: $500, Award: 60k pts + $380 surcharge
    #   Savings = $500 - $380 = $120  
    #   Miles per $ = 60,000 / 120 = 500 ← REJECT (way over 150!)
    #
    max_miles_per_dollar_saved: float = 140.0  # Max 140 miles per $1 saved (~0.7¢ effective floor)
    enable_miles_per_dollar_guard: bool = True
    
    # ═══════════════════════════════════════════════════════════════════════
    # ADAPTIVE BUDGET-BASED GUARDRAILS
    # ═══════════════════════════════════════════════════════════════════════
    #
    # PRINCIPLE: Budget compliance > redemption quality (CPP).
    #
    # When a budget is set, staying within budget is ALWAYS the priority.
    # CPP guardrails are relaxed proactively to ensure the solver has enough
    # award options to find a within-budget solution. We'd rather use points
    # at lower CPP than go over budget.
    #
    # Budget tightness ratio: r = budget / best_cash_price
    #
    # TIERS (flights-only):
    #   - Normal (r ≥ 1.0): Budget covers cash — CPP guards at full strength
    #   - Tight (0.60 ≤ r < 1.0): Budget requires points — relax CPP
    #   - Very tight (0.30 ≤ r < 0.60): Heavy points needed — relax more
    #   - CRITICAL (r < 0.30 or budget < $100): No CPP restrictions at all
    #
    # KEY DESIGN DECISION: "Tight" starts at r < 1.0 (not r < 0.60).
    # This means ANY budget that requires points usage will relax CPP guards.
    # Rationale: if the user set a budget, meeting it matters more than
    # getting perfect CPP on every redemption.
    #
    # When budget is very tight, Pass 2 also changes priority:
    #   - Normal: minimize miles → time → stops
    #   - Very tight: minimize time → stops → miles (user cares about "I can go")
    #
    enable_adaptive_budget_guardrails: bool = True
    
    # Tier thresholds — budget takes priority over CPP
    budget_tier_tight_ratio: float = 1.0      # Below cash price = "tight" (budget needs points)
    budget_tier_very_tight_ratio: float = 0.60  # Below 60% = "very tight"
    budget_tier_very_tight_absolute: float = 100.0  # Below $100 = always "very tight"
    
    # Tight budget settings
    cpp_floor_tight: float = 0.95         # 0.95¢ for tight budgets
    max_miles_per_dollar_tight: float = 180.0
    
    # Very tight budget settings
    cpp_floor_very_tight: float = 0.80    # 0.80¢ for very tight budgets
    max_miles_per_dollar_very_tight: float = 250.0
    
    # CRITICAL budget settings - NO restrictions (budget absolutely requires points)
    # Used when budget < 30% of cash price or when very_tight still infeasible
    budget_tier_critical_ratio: float = 0.30  # Below this = "critical" budget
    cpp_floor_critical: float = 0.0           # NO CPP restriction
    max_miles_per_dollar_critical: float = float('inf')  # NO miles/$ restriction
    
    def get_budget_tier(self, budget: Optional[float], best_cash_price: float) -> str:
        """
        Determine budget tier based on tightness ratio.
        
        PRINCIPLE: Budget > CPP. When a budget is set and requires points,
        we proactively relax CPP guards so the solver can find a within-budget
        solution. Better to redeem at lower CPP than to exceed the budget.
        
        Returns: "normal", "tight", "very_tight", or "critical"
        
        Tier escalation (r = budget / best_cash_price):
          - r >= 1.0: "normal" — budget covers cash, CPP guards at full strength
          - 0.60 <= r < 1.0: "tight" — must use some points, relax CPP
          - 0.30 <= r < 0.60: "very_tight" — heavy points usage, relax further
          - r < 0.30 (or budget < $100): "critical" — no CPP restrictions
        """
        if not self.enable_adaptive_budget_guardrails:
            return "normal"
        
        if budget is None or budget <= 0:
            return "normal"  # No budget constraint
        
        # Compute ratio
        if best_cash_price <= 0:
            return "normal"
        
        ratio = budget / best_cash_price
        
        # Critical: budget is < 30% of cash price or below absolute threshold
        # Must use points aggressively — no CPP restrictions at all
        if ratio < self.budget_tier_critical_ratio:
            return "critical"
        
        # Very tight if budget is below absolute threshold OR ratio < 60%
        if budget < self.budget_tier_very_tight_absolute or ratio < self.budget_tier_very_tight_ratio:
            return "very_tight"
        elif ratio < self.budget_tier_tight_ratio:
            return "tight"
        else:
            return "normal"
    
    def get_adaptive_cpp_floor(self, tier: str) -> float:
        """Get CPP floor for the given budget tier."""
        if tier == "critical":
            return self.cpp_floor_critical  # NO restriction
        elif tier == "very_tight":
            return self.cpp_floor_very_tight
        elif tier == "tight":
            return self.cpp_floor_tight
        else:
            return self.cpp_floor
    
    def get_adaptive_miles_per_dollar(self, tier: str) -> float:
        """Get miles-per-dollar cap for the given budget tier."""
        if tier == "critical":
            return self.max_miles_per_dollar_critical  # NO restriction
        elif tier == "very_tight":
            return self.max_miles_per_dollar_very_tight
        elif tier == "tight":
            return self.max_miles_per_dollar_tight
        else:
            return self.max_miles_per_dollar_saved
    
    # Legacy field for backward compatibility (now computed per-mode)
    enable_points_opportunity_cost: bool = True
    
    # Stage 2 delta override: when set, use this fixed value instead of computing
    # Useful for money-saver mode where delta=0 means pure minimum cash, no quality slack
    stage2_delta_override: Optional[float] = None
    
    def get_stop_cost(self, is_international: bool = False) -> float:
        """Get stop cost based on route type."""
        return self.stop_cost_international if is_international else self.stop_cost_domestic
    
    def get_baseline_hours(self, is_international: bool = False) -> float:
        """Get baseline hours based on route type."""
        return self.baseline_hours_international if is_international else self.baseline_hours_domestic
    
    def get_max_stops(self, is_international: bool = False) -> int:
        """Get max stops based on route type."""
        return self.max_stops_international if is_international else self.max_stops_domestic


@dataclass
class BalancedModeConfig:
    """
    Balanced mode configuration.
    
    SIMPLIFIED: No baseline_cash. Use cash_penalty directly.
    """
    
    # Category importance (user-tunable)
    flight_importance: float = 1.0
    
    # Cash penalty (so balanced doesn't ignore cash entirely)
    # Objective = value_utility - cash_penalty_weight * total_cash
    cash_penalty_weight: float = 0.001  # Small penalty per dollar
    
    # Quality penalties for flights
    time_penalty_per_hour: float = 0.02  # 2% penalty per hour over baseline
    baseline_hours: float = 8.0  # No penalty up to this
    connection_penalty: float = 0.20  # 20% penalty per stop
    carrier_change_penalty: float = 0.10  # 10% penalty for carrier change
    redeye_penalty: float = 0.15  # 15% penalty for redeye
    
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
    
    # Award programs per edge (no practical limit — evaluate all user currencies)
    max_award_programs_per_edge: int = 50
    
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
    
    # Payment
    flight_payments: Dict[str, PaymentChoice] = field(default_factory=dict)  # edge_id -> payment
    
    # Transfers
    transfers_used: Dict[Tuple[str, str, str], int] = field(default_factory=dict)  # (payer, bank, program) -> blocks
    
    # Totals
    total_cash: float = 0.0
    total_points_by_program: Dict[str, int] = field(default_factory=dict)
    total_value: float = 0.0  # Value captured from awards
    
    # Budget exceeded info (set when fallback solve is used)
    budget_exceeded: bool = False
    budget_excess_amount: float = 0.0
    original_budget: Optional[float] = None
    
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
    
    # Budget exceeded info (set when original budget was infeasible)
    budget_exceeded: bool = False
    budget_excess_amount: float = 0.0
