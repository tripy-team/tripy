"""
Policy filtering ONLY. No contract/schema validation here.

Determines if a contract-valid candidate meets business rules.
Policy filtering checks:
- Airport allowlist
- Ticketing type requirements
- Connection rules (no airport changes)
- Duration/stops limits

IMPORTANT: Only call these functions on candidates that PASSED contract validation.
"""

from typing import TYPE_CHECKING

from .types import Rejection, PolicyFilterOutcome
from .config_mvp import get_config
from .reason_codes import (
    FLIGHT_AIRPORT_NOT_ALLOWED,
    FLIGHT_AIRPORT_CHANGE_CONNECTION,
    FLIGHT_TICKETING_NOT_SINGLE,
    FLIGHT_TICKETING_UNKNOWN_CONNECTING,
    FLIGHT_MAX_STOPS_EXCEEDED,
    FLIGHT_MAX_DURATION_EXCEEDED,
    FLIGHT_SURCHARGE_CAP_EXCEEDED,
)

if TYPE_CHECKING:
    from .trip_spec import OrderedLeg


def apply_policy_filters_to_candidate(
    candidate: dict,
    scope_id: str,
    allowed_origin_airports: list[str] | None,
    allowed_destination_airports: list[str] | None,
) -> PolicyFilterOutcome:
    """
    Apply all policy filters to a single candidate.
    
    PRECONDITION: candidate has passed contract validation.
    This is enforced with assertions - if these fail, there's a bug
    in the pipeline (policy called before contract validation).
    
    Args:
        candidate: Contract-valid candidate dict
        scope_id: Context for logging (e.g., "leg_0")
        allowed_origin_airports: Allowlist for origin (None = any)
        allowed_destination_airports: Allowlist for destination (None = any)
    
    Returns:
        PolicyFilterOutcome with is_allowed=False if rejected by policy
    """
    # =========================================================================
    # PRECONDITION CHECKS
    # These assertions catch bugs where policy is called on malformed candidates
    # =========================================================================
    
    assert "segments" in candidate, \
        "Policy filtering requires contract-valid candidate (missing segments)"
    assert isinstance(candidate["segments"], list), \
        "Policy filtering requires contract-valid candidate (segments not list)"
    assert len(candidate["segments"]) > 0, \
        "Policy filtering requires contract-valid candidate (empty segments)"
    
    rejections: list[Rejection] = []
    candidate_id = candidate.get("id", "unknown")
    segments = candidate["segments"]
    config = get_config()
    
    # =========================================================================
    # POLICY 1: Airport allowlist
    # =========================================================================
    
    first_segment = segments[0]
    last_segment = segments[-1]
    
    if allowed_origin_airports:
        origin = first_segment.get("origin")
        if origin and origin not in allowed_origin_airports:
            rejections.append(Rejection(
                reason_code=FLIGHT_AIRPORT_NOT_ALLOWED,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={
                    "airport": origin,
                    "allowed": allowed_origin_airports,
                    "position": "origin",
                },
            ))
    
    if allowed_destination_airports:
        destination = last_segment.get("destination")
        if destination and destination not in allowed_destination_airports:
            rejections.append(Rejection(
                reason_code=FLIGHT_AIRPORT_NOT_ALLOWED,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={
                    "airport": destination,
                    "allowed": allowed_destination_airports,
                    "position": "destination",
                },
            ))
    
    # =========================================================================
    # POLICY 2: Airport-change connections (same airport required for connection)
    # =========================================================================
    
    for i in range(len(segments) - 1):
        arriving_at = segments[i].get("destination")
        departing_from = segments[i + 1].get("origin")
        
        if arriving_at and departing_from and arriving_at != departing_from:
            rejections.append(Rejection(
                reason_code=FLIGHT_AIRPORT_CHANGE_CONNECTION,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={
                    "segment_index": i,
                    "arriving_at": arriving_at,
                    "departing_from": departing_from,
                },
            ))
    
    # =========================================================================
    # POLICY 3: Ticketing (single-ticket required for connections)
    # =========================================================================
    
    num_stops = len(segments) - 1
    ticketing = candidate.get("ticketing", {})
    ticketing_type = ticketing.get("type", "UNKNOWN") if isinstance(ticketing, dict) else "UNKNOWN"
    
    if num_stops == 0:
        # Nonstop: configurable whether UNKNOWN is allowed
        if ticketing_type == "UNKNOWN" and not config.ALLOW_UNKNOWN_TICKETING_NONSTOP:
            rejections.append(Rejection(
                reason_code=FLIGHT_TICKETING_UNKNOWN_CONNECTING,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={
                    "num_stops": num_stops,
                    "ticketing_type": ticketing_type,
                    "reason": "unknown_ticketing_nonstop_not_allowed",
                },
            ))
    else:
        # Connecting: SINGLE_TICKET required
        if ticketing_type != "SINGLE_TICKET":
            code = (
                FLIGHT_TICKETING_UNKNOWN_CONNECTING
                if ticketing_type == "UNKNOWN"
                else FLIGHT_TICKETING_NOT_SINGLE
            )
            rejections.append(Rejection(
                reason_code=code,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={
                    "num_stops": num_stops,
                    "ticketing_type": ticketing_type,
                },
            ))
    
    # =========================================================================
    # POLICY 4: Maximum stops
    # =========================================================================
    
    if num_stops > config.MAX_STOPS:
        rejections.append(Rejection(
            reason_code=FLIGHT_MAX_STOPS_EXCEEDED,
            candidate_id=candidate_id,
            scope_id=scope_id,
            details={
                "num_stops": num_stops,
                "max_stops": config.MAX_STOPS,
            },
        ))
    
    # =========================================================================
    # POLICY 5: Maximum duration (if available)
    # =========================================================================
    
    total_duration_minutes = candidate.get("total_duration_minutes")
    if total_duration_minutes is not None:
        max_duration_minutes = config.MAX_DURATION_HOURS * 60
        if total_duration_minutes > max_duration_minutes:
            rejections.append(Rejection(
                reason_code=FLIGHT_MAX_DURATION_EXCEEDED,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={
                    "total_duration_minutes": total_duration_minutes,
                    "max_duration_minutes": max_duration_minutes,
                },
            ))
    
    # =========================================================================
    # POLICY 6: Surcharge cap for award bookings
    # =========================================================================
    
    award_quotes = candidate.get("award_quotes", [])
    if award_quotes:
        for i, quote in enumerate(award_quotes):
            if isinstance(quote, dict):
                surcharge = quote.get("surcharge", 0)
                if surcharge and surcharge > config.MAX_SURCHARGE_USD:
                    rejections.append(Rejection(
                        reason_code=FLIGHT_SURCHARGE_CAP_EXCEEDED,
                        candidate_id=candidate_id,
                        scope_id=scope_id,
                        details={
                            "surcharge": surcharge,
                            "max_surcharge": config.MAX_SURCHARGE_USD,
                            "program": quote.get("program"),
                            "quote_index": i,
                        },
                    ))
    
    return PolicyFilterOutcome(
        is_allowed=len(rejections) == 0,
        rejections=rejections,
        candidate_id=candidate_id,
    )


def apply_policy_filters(
    candidates: list[dict],
    leg: "OrderedLeg",
) -> tuple[list[dict], list[Rejection]]:
    """
    Apply policy filters to all candidates for a leg.
    
    Args:
        candidates: Contract-valid candidates (must have passed contract validation)
        leg: The OrderedLeg with airport constraints
    
    Returns:
        (allowed_candidates, policy_rejections)
    """
    scope_id = f"leg_{leg.leg_id}"
    allowed: list[dict] = []
    all_rejections: list[Rejection] = []
    
    # Get allowed airports from leg (may need to resolve metro -> airports)
    # For now, use origin_city/destination_city directly if they look like airport codes
    allowed_origins = getattr(leg, "allowed_origin_airports", None)
    allowed_destinations = getattr(leg, "allowed_destination_airports", None)
    
    for candidate in candidates:
        outcome = apply_policy_filters_to_candidate(
            candidate,
            scope_id,
            allowed_origins,
            allowed_destinations,
        )
        
        if outcome.is_allowed:
            allowed.append(candidate)
        else:
            all_rejections.extend(outcome.rejections)
    
    return allowed, all_rejections


def apply_policy_filters_with_airports(
    candidates: list[dict],
    leg_id: str,
    allowed_origin_airports: list[str] | None,
    allowed_destination_airports: list[str] | None,
) -> tuple[list[dict], list[Rejection]]:
    """
    Apply policy filters with explicit airport lists.
    
    Use this when you don't have an OrderedLeg object or need custom airport lists.
    
    Args:
        candidates: Contract-valid candidates
        leg_id: Leg identifier for logging
        allowed_origin_airports: Allowlist for origins
        allowed_destination_airports: Allowlist for destinations
    
    Returns:
        (allowed_candidates, policy_rejections)
    """
    scope_id = f"leg_{leg_id}"
    allowed: list[dict] = []
    all_rejections: list[Rejection] = []
    
    for candidate in candidates:
        outcome = apply_policy_filters_to_candidate(
            candidate,
            scope_id,
            allowed_origin_airports,
            allowed_destination_airports,
        )
        
        if outcome.is_allowed:
            allowed.append(candidate)
        else:
            all_rejections.extend(outcome.rejections)
    
    return allowed, all_rejections
