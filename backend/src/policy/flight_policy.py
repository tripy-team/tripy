"""
Flight-specific policy rules.

Evaluates flight itineraries for booking reality issues:
- Unprotected connections (separate tickets)
- Self-transfer requirements
- Minimum Connection Time violations
- Basic economy restrictions
- Round-trip flexibility warnings

Usage:
    from policy.flight_policy import evaluate_flight_itinerary
    
    evaluation = evaluate_flight_itinerary(
        itinerary=flight_data,
        mode=BookingRiskMode.BALANCED,
        context={"user_has_status": True}
    )
"""

import logging
from typing import Any, Optional
from datetime import datetime

from .types import PolicyMessage, PolicyEvaluation
from .modes import BookingRiskMode, get_mode_policy
from .config import get_policy_config
from .reason_codes import (
    FLIGHT_UNPROTECTED_CONNECTION,
    FLIGHT_SELF_TRANSFER_RISK,
    FLIGHT_BELOW_MCT,
    FLIGHT_BASIC_ECONOMY_RESTRICTED,
    FLIGHT_ROUNDTRIP_FLEX_RISK,
    FLIGHT_UNKNOWN_PROTECTION,
    FLIGHT_OVERNIGHT_CONNECTION,
    FLIGHT_REDEYE_DEPARTURE,
    FLIGHT_TIGHT_INTERNATIONAL_MCT,
    FLIGHT_INVALID_TIMING,
    requires_ack,
)
from .itinerary_math import (
    compute_layovers,
    is_international_connection,
    LayoverInfo,
)

logger = logging.getLogger(__name__)


# =============================================================================
# MAIN EVALUATION FUNCTION
# =============================================================================

def evaluate_flight_itinerary(
    itinerary: dict[str, Any],
    mode: BookingRiskMode | str = BookingRiskMode.BALANCED,
    context: Optional[dict[str, Any]] = None,
) -> PolicyEvaluation:
    """
    Evaluate a flight itinerary against all flight policies.
    
    Args:
        itinerary: Flight itinerary dict with segments, ticketing_type, etc.
        mode: User's risk tolerance mode
        context: Additional context (e.g., user preferences)
    
    Returns:
        PolicyEvaluation with all applicable messages
    """
    evaluation = PolicyEvaluation()
    mode_policy = get_mode_policy(mode)
    config = get_policy_config()
    context = context or {}
    
    # Run each rule
    _evaluate_invalid_timing(itinerary, evaluation)
    _evaluate_unprotected_connection(itinerary, mode_policy, evaluation)
    _evaluate_self_transfer(itinerary, mode_policy, evaluation)
    _evaluate_mct(itinerary, mode_policy, config, evaluation)
    _evaluate_basic_economy(itinerary, mode_policy, config, evaluation, context)
    _evaluate_roundtrip_flexibility(itinerary, mode_policy, config, evaluation, context)
    _evaluate_timing_warnings(itinerary, config, evaluation)
    
    # Calculate risk score
    for msg in evaluation.blocks + evaluation.warnings:
        evaluation.risk_score += config.get_risk_penalty(msg.code)
    
    # Apply mode multiplier
    evaluation.risk_score = int(evaluation.risk_score * mode_policy.risk_penalty_multiplier)
    
    return evaluation


# =============================================================================
# INDIVIDUAL RULES
# =============================================================================

def _evaluate_unprotected_connection(
    itinerary: dict,
    mode_policy,
    evaluation: PolicyEvaluation,
):
    """
    Rule: Multi-segment itineraries must be on a single ticket for protection.
    
    If segments are on separate tickets:
    - SAFE: Block
    - BALANCED/AGGRESSIVE: Warn + require acknowledgment
    """
    segments = itinerary.get("segments", [])
    segment_count = len(segments)
    
    if segment_count < 2:
        # Nonstop flight - no connection to protect
        return
    
    ticketing_type = itinerary.get("ticketing_type", "unknown")
    connection_type = itinerary.get("connection_type", "unknown")
    
    # Check for separate tickets
    if ticketing_type not in ("single_ticket", "SINGLE_TICKET"):
        is_block = mode_policy.blocks_unprotected_connection
        severity = "block" if is_block else "warn"
        
        message = PolicyMessage(
            code=FLIGHT_UNPROTECTED_CONNECTION,
            severity=severity,
            title="Connection is not on a single ticket",
            detail=(
                f"This {segment_count}-segment itinerary has separate tickets. "
                "If you miss a connection, you'll need to buy a new ticket at full price. "
                "Checked bags must be collected and rechecked between flights."
            ),
            context={
                "segment_count": segment_count,
                "ticketing_type": ticketing_type,
            },
            requires_ack=requires_ack(FLIGHT_UNPROTECTED_CONNECTION),
            ack_text="I understand this is on separate tickets and I may lose protection",
        )
        
        evaluation.add_message(message)
        evaluation.explanations.append(
            f"Multi-segment itinerary ({segment_count} flights) is not on a single ticket"
        )


def _evaluate_self_transfer(
    itinerary: dict,
    mode_policy,
    evaluation: PolicyEvaluation,
):
    """
    Rule: Self-transfer connections are high-risk.
    
    Self-transfer means:
    - Collect bags, exit security, check in again
    - No airline protection for missed connections
    """
    connection_type = itinerary.get("connection_type", "")
    
    if connection_type.lower() not in ("self_transfer", "self-transfer"):
        return
    
    is_block = mode_policy.blocks_self_transfer
    severity = "block" if is_block else "warn"
    
    # Find the connection airport(s)
    segments = itinerary.get("segments", [])
    connection_airports = []
    for i in range(len(segments) - 1):
        arr_airport = segments[i].get("destination", "")
        connection_airports.append(arr_airport)
    
    message = PolicyMessage(
        code=FLIGHT_SELF_TRANSFER_RISK,
        severity=severity,
        title="Self-transfer required",
        detail=(
            "You must collect your checked bags, exit the secure area, "
            "and check in again for your next flight. The airline will not "
            "protect you if you miss your connection due to delays."
        ),
        context={
            "connection_airports": connection_airports,
        },
        requires_ack=requires_ack(FLIGHT_SELF_TRANSFER_RISK),
        ack_text="I understand this is a self-transfer and I must allow extra time",
    )
    
    evaluation.add_message(message)
    evaluation.explanations.append(
        f"Self-transfer required at {', '.join(connection_airports) or 'connection point'}"
    )


def _evaluate_mct(
    itinerary: dict,
    mode_policy,
    config,
    evaluation: PolicyEvaluation,
):
    """
    Rule: Connection time must meet Minimum Connection Time (MCT).
    
    MCT varies by:
    - Airport (some airports need more time)
    - Connection type (international requires more time)
    """
    segments = itinerary.get("segments", [])
    if len(segments) < 2:
        return
    
    # Compute layovers
    layovers = compute_layovers(segments)
    
    for layover in layovers:
        if getattr(layover, "timing_invalid", False):
            message = PolicyMessage(
                code=FLIGHT_INVALID_TIMING,
                severity="block",
                title=f"Inconsistent timing data at {layover.airport}",
                detail=(
                    "We detected inconsistent segment timing (e.g., negative layover). "
                    "This is usually provider data corruption. Re-optimize or choose a different option."
                ),
                context={
                    "airport": layover.airport,
                    "arrival_time": str(layover.arrival_time) if layover.arrival_time else None,
                    "departure_time": str(layover.departure_time) if layover.departure_time else None,
                },
            )
            evaluation.add_message(message)
            evaluation.explanations.append(f"Inconsistent timing at {layover.airport}")
            continue

        airport = layover.airport
        minutes = layover.minutes
        is_intl = layover.is_international
        
        required_mct = config.mct_for_airport(airport, is_intl)
        
        if minutes < required_mct:
            is_block = mode_policy.blocks_below_mct
            severity = "block" if is_block else "warn"
            
            message = PolicyMessage(
                code=FLIGHT_BELOW_MCT,
                severity=severity,
                title=f"Connection time is below minimum ({minutes}min < {required_mct}min)",
                detail=(
                    f"The {minutes} minute connection at {airport} is below the "
                    f"{required_mct} minute minimum for "
                    f"{'international' if is_intl else 'domestic'} connections. "
                    "You risk missing your connection even if your first flight is on time."
                ),
                context={
                    "airport": airport,
                    "layover_minutes": minutes,
                    "required_mct": required_mct,
                    "connection_type": "international" if is_intl else "domestic",
                },
                requires_ack=requires_ack(FLIGHT_BELOW_MCT),
                ack_text=f"I understand the {minutes}min connection at {airport} is risky",
            )
            
            evaluation.add_message(message)
            evaluation.explanations.append(
                f"Connection at {airport} ({minutes}min) is below {required_mct}min MCT"
            )
        
        # Also check for tight international connections (warn even if above MCT)
        elif is_intl and minutes < required_mct + 30:
            message = PolicyMessage(
                code=FLIGHT_TIGHT_INTERNATIONAL_MCT,
                severity="info",
                title=f"Tight international connection ({minutes}min)",
                detail=(
                    f"While the {minutes} minute connection at {airport} meets minimum "
                    "requirements, international connections can have delays at immigration "
                    "and customs. Consider a longer connection if possible."
                ),
                context={
                    "airport": airport,
                    "layover_minutes": minutes,
                    "required_mct": required_mct,
                },
            )
            evaluation.add_message(message)


def _evaluate_basic_economy(
    itinerary: dict,
    mode_policy,
    config,
    evaluation: PolicyEvaluation,
    context: dict,
):
    """
    Rule: Basic economy fares have restrictions.
    
    - SAFE mode: Block unless user opts in
    - Other modes: Warn about restrictions
    """
    fare_brand = itinerary.get("fare_brand", "")
    
    if not config.is_basic_economy(fare_brand):
        return
    
    # Check if user explicitly included basic economy
    include_basic = context.get("include_basic_economy", False)
    
    if mode_policy.blocks_basic_economy and not include_basic:
        severity = "block"
    else:
        severity = "info"
    
    message = PolicyMessage(
        code=FLIGHT_BASIC_ECONOMY_RESTRICTED,
        severity=severity,
        title="Basic Economy fare",
        detail=(
            "This is a Basic Economy fare. Typical restrictions: "
            "no changes/cancellations allowed, no seat selection until check-in, "
            "checked bags may cost extra, board last."
        ),
        context={
            "fare_brand": fare_brand,
        },
    )
    
    evaluation.add_message(message)


def _evaluate_roundtrip_flexibility(
    itinerary: dict,
    mode_policy,
    config,
    evaluation: PolicyEvaluation,
    context: dict,
):
    """
    Rule: Round-trip tickets reduce flexibility.
    
    Recommend booking as two one-ways for flexibility-conscious users.
    """
    if not config.ROUNDTRIP_DISCOURAGE:
        return
    
    booking_type = itinerary.get("booking_type") or ""
    
    if not booking_type or booking_type.lower() != "round_trip":
        return
    
    # Check user's flexibility preference
    flexibility_priority = context.get("flexibility_priority", "medium")
    
    if flexibility_priority == "high":
        severity = "warn"
    else:
        severity = "info"
    
    message = PolicyMessage(
        code=FLIGHT_ROUNDTRIP_FLEX_RISK,
        severity=severity,
        title="Round-trip ticket reduces flexibility",
        detail=(
            "If your plans change, modifying one leg may affect the entire ticket. "
            "Consider booking as two one-way tickets for more flexibility."
        ),
        context={
            "booking_type": booking_type,
            "flexibility_priority": flexibility_priority,
        },
    )
    
    evaluation.add_message(message)


def _evaluate_timing_warnings(
    itinerary: dict,
    config,
    evaluation: PolicyEvaluation,
):
    """
    Info warnings about timing: redeyes, overnight connections.
    """
    segments = itinerary.get("segments", [])
    
    for i, segment in enumerate(segments):
        dep_time = segment.get("departure_time")
        if dep_time:
            try:
                if isinstance(dep_time, str):
                    # Parse ISO format or "HH:MM" format
                    if "T" in dep_time:
                        dt = datetime.fromisoformat(dep_time.replace("Z", "+00:00"))
                        hour = dt.hour
                    else:
                        hour = int(dep_time.split(":")[0])
                else:
                    hour = dep_time.hour if hasattr(dep_time, "hour") else 0
                
                if config.is_redeye(hour):
                    message = PolicyMessage(
                        code=FLIGHT_REDEYE_DEPARTURE,
                        severity="info",
                        title="Red-eye departure",
                        detail=(
                            f"Flight departs at {dep_time}. Consider impact on sleep "
                            "and whether hotel checkout timing works."
                        ),
                        context={
                            "segment_index": i,
                            "departure_time": str(dep_time),
                        },
                    )
                    evaluation.add_message(message)
            except (ValueError, AttributeError, IndexError):
                pass
    
    # Check for overnight connections
    layovers = compute_layovers(segments)
    for layover in layovers:
        if getattr(layover, "timing_invalid", False):
            continue
        if layover.minutes >= config.OVERNIGHT_CONNECTION_HOURS * 60:
            message = PolicyMessage(
                code=FLIGHT_OVERNIGHT_CONNECTION,
                severity="info",
                title=f"Overnight connection at {layover.airport}",
                detail=(
                    f"You have a {layover.minutes // 60}h {layover.minutes % 60}m layover "
                    f"at {layover.airport}. You may need to book a hotel or stay in the airport."
                ),
                context={
                    "airport": layover.airport,
                    "layover_hours": layover.minutes / 60,
                },
            )
            evaluation.add_message(message)


def _evaluate_invalid_timing(itinerary: dict, evaluation: PolicyEvaluation) -> None:
    """
    Reject obvious timing data corruption early (negative durations).
    """
    segments = itinerary.get("segments", [])
    for i, segment in enumerate(segments or []):
        dur = segment.get("duration_minutes")
        if dur is None:
            continue
        try:
            dur_val = int(dur)
        except Exception:
            continue
        if dur_val < 0:
            message = PolicyMessage(
                code=FLIGHT_INVALID_TIMING,
                severity="block",
                title="Inconsistent segment duration",
                detail="Segment duration is negative, indicating corrupted time data. Re-optimize.",
                context={"segment_index": i, "duration_minutes": dur_val},
            )
            evaluation.add_message(message)
            evaluation.explanations.append("Inconsistent segment duration")
            return
