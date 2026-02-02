"""
Validators for V3/V4 optimization.

CRITICAL:
- Policy-driven connection protection enforcement
- Date feasibility validation
- Pre-check feasibility before MILP

MVP Rules (STRICT_MVP_POLICY):
- Direct flights: always OK
- Connections require BOTH:
  - connection_protection == AIRLINE_PROTECTED
  - self_transfer_required == NO
"""

import logging
from typing import List, Tuple, Dict, Optional
from datetime import date

from .trip_spec import TripPlanSpec, OrderedLeg, StaySegment
from .models_v3 import FlightItineraryEdge
from .enums import ConnectionProtection, SelfTransferRequired, TicketingType
from .derivation import finalize_itinerary
from .validation_policy import ValidationPolicy, STRICT_MVP_POLICY, ALLOW_ALL_POLICY

logger = logging.getLogger(__name__)


def validate_connection_eligibility(
    flights: List[FlightItineraryEdge],
    policy: Optional[ValidationPolicy] = None,
    strict_mode: bool = True,  # Deprecated, use policy instead
) -> Tuple[List[FlightItineraryEdge], List[str]]:
    """
    Validate that connections are safe to show to users.
    
    POLICY-DRIVEN RULES:
    1. Direct flights: always OK
    2. Connections must have:
       - connection_protection ∈ policy.allowed_protection_levels
       - self_transfer_required == NO (if policy.require_explicit_no_self_transfer)
    3. Incomplete segments are allowed only if protection is confirmed
       (and policy.allow_incomplete_with_protection)
    
    Transfer warnings are generated but don't affect eligibility.
    
    Args:
        flights: List of flight edges to validate
        policy: Validation policy (defaults to STRICT_MVP_POLICY)
        strict_mode: Deprecated, use policy instead
    
    Returns:
        (filtered_flights, drop_reasons)
    """
    
    # Use policy if provided, otherwise derive from strict_mode for backwards compat
    if policy is None:
        policy = STRICT_MVP_POLICY if strict_mode else ALLOW_ALL_POLICY
    
    filtered = []
    drop_reasons = []
    
    for edge in flights:
        # Ensure edge is finalized
        if not edge._finalized:
            edge = finalize_itinerary(edge)
        
        # ═══════════════════════════════════════════════════════════════════
        # RULE 1: Direct flights always pass
        # ═══════════════════════════════════════════════════════════════════
        
        if edge.is_direct:
            filtered.append(edge)
            continue
        
        # ═══════════════════════════════════════════════════════════════════
        # RULE 2: Check self-transfer requirement (log this reason even if other
        # constraints would also drop the flight)
        # ═══════════════════════════════════════════════════════════════════
        
        if policy.require_explicit_no_self_transfer:
            # In MVP we drop only when self-transfer is explicitly required.
            # UNKNOWN/unspecified is handled by protection/ticketing policies elsewhere.
            if edge.self_transfer_required == SelfTransferRequired.YES:
                reason = (
                    f"Dropped {edge.edge_id}: {edge.num_stops}-stop connection "
                    f"with self_transfer={edge.self_transfer_required.value} "
                    f"(policy requires explicit NO)"
                )
                drop_reasons.append(reason)
                if policy.log_drops:
                    logger.info(reason)
                continue

        # ═══════════════════════════════════════════════════════════════════
        # RULE 3: Check protection level against policy
        # ═══════════════════════════════════════════════════════════════════
        
        protection_ok = edge.connection_protection in policy.allowed_protection_levels
        
        if not protection_ok:
            # Sort allowed list for deterministic log/test output
            allowed = sorted(p.value for p in policy.allowed_protection_levels)
            reason = (
                f"Dropped {edge.edge_id}: {edge.num_stops}-stop connection "
                f"with protection={edge.connection_protection.value} "
                f"(allowed: {allowed})"
            )
            drop_reasons.append(reason)
            if policy.log_drops:
                logger.info(reason)
            continue
        
        # ═══════════════════════════════════════════════════════════════════
        # RULE 4: Check incomplete segments
        # ═══════════════════════════════════════════════════════════════════
        
        if edge.segments_incomplete:
            if not policy.allow_incomplete_with_protection:
                reason = f"Dropped {edge.edge_id}: incomplete segment data (policy disallows)"
                drop_reasons.append(reason)
                continue
            
            # Allow incomplete only if protection is in the allowed set (policy-driven!)
            if edge.connection_protection not in policy.allowed_protection_levels:
                allowed = sorted(p.value for p in policy.allowed_protection_levels)
                reason = (
                    f"Dropped {edge.edge_id}: incomplete segment data "
                    f"with protection={edge.connection_protection.value} "
                    f"(allowed for incomplete: {allowed})"
                )
                drop_reasons.append(reason)
                if policy.log_drops:
                    logger.info(reason)
                continue
        
        # ═══════════════════════════════════════════════════════════════════
        # PASSED ALL CHECKS
        # ═══════════════════════════════════════════════════════════════════
        
        filtered.append(edge)
    
    return filtered, drop_reasons


def filter_single_ticket_only(
    flights: List[FlightItineraryEdge],
) -> Tuple[List[FlightItineraryEdge], List[str]]:
    """
    Backwards-compat filter for "single-ticket only" behavior.

    - Direct flights: always allowed
    - Connecting flights: require ticketing_type == SINGLE_TICKET
      - UNKNOWN is dropped with an explicit warning message
    """
    filtered: List[FlightItineraryEdge] = []
    warnings: List[str] = []

    for edge in flights:
        if not edge._finalized:
            edge = finalize_itinerary(edge)

        if edge.is_direct:
            filtered.append(edge)
            continue

        tt = getattr(edge, "ticketing_type", None)
        # Normalize comparisons across enum/str forms
        tt_val = tt.value if hasattr(tt, "value") else str(tt or "")

        if tt == TicketingType.SINGLE_TICKET or tt_val.upper() == "SINGLE_TICKET" or tt_val.lower() == "single_ticket":
            filtered.append(edge)
            continue

        if tt == TicketingType.UNKNOWN or tt_val.upper() == "UNKNOWN" or tt_val.lower() == "unknown":
            warnings.append(f"Dropped {edge.edge_id}: unknown ticketing for connecting itinerary")
        else:
            warnings.append(f"Dropped {edge.edge_id}: ticketing not single ({tt_val})")

    return filtered, warnings


def validate_date_feasibility(
    flights: List[FlightItineraryEdge],
    stay_segments: List[StaySegment],
    legs: List[OrderedLeg],
) -> Tuple[List[FlightItineraryEdge], List[str]]:
    """
    Filter flights that violate date constraints.
    
    CRITICAL: This ensures the MILP only sees feasible options.
    
    Rules:
    - Flight for leg i must depart within leg's date window
    - Flight for leg i must arrive by stay[i].check_in (if stay exists)
    - Flight for leg i must depart on/after stay[i-1].check_out (if stay exists)
    
    Returns:
        (filtered_flights, warnings)
    """
    
    filtered = []
    warnings = []
    
    # Build segment lookup
    # seg_after_leg[i] = segment that comes after leg i (traveler arrives, then stays)
    seg_after_leg: Dict[int, StaySegment] = {}
    for i, seg in enumerate(stay_segments):
        seg_after_leg[i] = seg
    
    # seg_before_leg[i] = segment that comes before leg i (traveler checks out, then departs)
    seg_before_leg: Dict[int, StaySegment] = {}
    for i, seg in enumerate(stay_segments):
        seg_before_leg[i + 1] = seg
    
    leg_by_id = {leg.leg_id: leg for leg in legs}
    
    for f in flights:
        # Ensure date fields are computed
        f.compute_date_fields()
        
        leg = leg_by_id.get(f.leg_id)
        
        if not leg:
            warnings.append(f"Flight {f.edge_id} has unknown leg_id {f.leg_id}")
            continue
        
        is_feasible = True
        reasons = []
        
        # Check 1: Departs within leg's date window
        if f.departs_on_date and f.departs_on_date < leg.earliest_departure:
            is_feasible = False
            reasons.append(
                f"departs {f.departs_on_date} before earliest {leg.earliest_departure}"
            )
        
        if f.departs_on_date and f.departs_on_date > leg.latest_departure:
            is_feasible = False
            reasons.append(
                f"departs {f.departs_on_date} after latest {leg.latest_departure}"
            )
        
        # Check 2: Arrives by check-in of next stay (if exists)
        # RELAXED: Allow overnight flights that arrive up to 1 day after check-in
        # The hotel dates will be adjusted in post-processing based on actual flight arrival
        if f.leg_id in seg_after_leg:
            seg = seg_after_leg[f.leg_id]
            if f.arrives_by_date and f.arrives_by_date > seg.check_in:
                # Calculate how many days late the arrival is
                days_late = (f.arrives_by_date - seg.check_in).days
                
                # Allow up to 1 day late (overnight flights)
                # The hotel check-in will be adjusted to match actual arrival
                if days_late > 1:
                    is_feasible = False
                    reasons.append(
                        f"arrives {f.arrives_by_date} more than 1 day after check_in {seg.check_in}"
                    )
                else:
                    # Log that we're allowing an overnight flight (date will be adjusted)
                    logger.debug(
                        f"{f.edge_id}: overnight flight arrives {f.arrives_by_date}, "
                        f"original check_in {seg.check_in} - will adjust hotel dates"
                    )
        
        # Check 3: Departs on/after check-out of previous stay (if exists)
        if f.leg_id in seg_before_leg:
            seg = seg_before_leg[f.leg_id]
            if f.departs_on_date and f.departs_on_date < seg.check_out:
                is_feasible = False
                reasons.append(
                    f"departs {f.departs_on_date} before check_out {seg.check_out}"
                )
        
        if is_feasible:
            filtered.append(f)
        else:
            reason_str = "; ".join(reasons)
            warnings.append(
                f"Dropped {f.edge_id}: date infeasible for leg {f.leg_id} ({reason_str})"
            )
    
    return filtered, warnings


def pre_check_feasibility(
    spec: TripPlanSpec,
    flights_by_leg: Dict[int, List[FlightItineraryEdge]],
    hotels_by_segment: Dict[int, list],  # Ignored - no hotels
) -> Tuple[bool, List[str]]:
    """
    Fast pre-check before building MILP (flights only).
    
    This catches obvious data problems before expensive MILP construction.
    
    Returns:
        (is_feasible, issues)
    """
    
    issues = []
    
    # Check each leg has at least one flight
    for leg in spec.legs:
        leg_flights = flights_by_leg.get(leg.leg_id, [])
        if not leg_flights:
            issues.append(
                f"No flights for leg {leg.leg_id}: {leg.origin_city} → {leg.destination_city} "
                f"({leg.earliest_departure} to {leg.latest_departure})"
            )
    
    # Check travelers have some usable points
    has_any_points = False
    for traveler in spec.travelers:
        if traveler.has_usable_points():
            has_any_points = True
            break
    
    if not has_any_points:
        issues.append(
            "No travelers have usable points or bank balances - "
            "all bookings will be cash-only"
        )
    
    return len(issues) == 0, issues


def validate_connection_warnings(
    flights: List[FlightItineraryEdge],
) -> List[str]:
    """
    Generate warnings for connection issues (informational, not blocking).
    
    Returns list of warnings.
    """
    
    warnings = []
    
    for f in flights:
        # Run connection validation
        conn_warnings = f.validate_connections()
        warnings.extend(conn_warnings)
        
        # Check for short connections
        if f.has_short_connection:
            warnings.append(
                f"Flight {f.edge_id}: has short connection (<60 min) - "
                f"risk of missed connection"
            )
        
        # Check for long layovers
        if f.has_long_layover:
            warnings.append(
                f"Flight {f.edge_id}: has long layover (>4 hours)"
            )
        
        # Check for redeye
        if f.is_redeye:
            warnings.append(
                f"Flight {f.edge_id}: is a redeye flight"
            )
    
    return warnings


def validate_award_availability(
    flights: List[FlightItineraryEdge],
    min_threshold: float = 0.3,
) -> List[str]:
    """
    Warn about low-availability awards.
    
    Returns list of warnings.
    """
    
    warnings = []
    
    for f in flights:
        for opt in f.award_options:
            if opt.availability_score < min_threshold:
                warnings.append(
                    f"Flight {f.edge_id} award {opt.option_id}: "
                    f"low availability ({opt.availability_score:.0%}) - "
                    f"may not be bookable"
                )
            if opt.is_waitlisted:
                warnings.append(
                    f"Flight {f.edge_id} award {opt.option_id}: waitlisted"
                )
    
    return warnings
