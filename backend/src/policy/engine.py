"""
Policy Engine - Main entry point for policy evaluation.

Evaluates itineraries and options against all policy rules,
filters/disables based on mode, and attaches evaluation results.

Usage:
    from policy.engine import evaluate_itinerary, apply_policy_to_results
    
    # Single itinerary
    evaluation = evaluate_itinerary(itinerary, mode="balanced")
    
    # Batch processing
    filtered, summary = apply_policy_to_results(results, mode="safe")
"""

import logging
from typing import Any, Optional
from dataclasses import dataclass

from .types import PolicyEvaluation, PolicySummary, PolicyAcknowledgment
from .modes import BookingRiskMode, get_mode_policy, parse_risk_mode
from .config import get_policy_config
from .flight_policy import evaluate_flight_itinerary
from .penalties import compute_total_penalty

logger = logging.getLogger(__name__)


# =============================================================================
# MAIN EVALUATION FUNCTIONS
# =============================================================================

def evaluate_itinerary(
    itinerary: dict[str, Any],
    mode: BookingRiskMode | str = BookingRiskMode.BALANCED,
    context: Optional[dict[str, Any]] = None,
) -> PolicyEvaluation:
    """
    Evaluate a complete itinerary (flights + hotels) against all policies.
    
    Args:
        itinerary: Itinerary dict with segments, hotels, etc.
        mode: User's risk tolerance mode
        context: Additional context (user preferences, loyalty programs, etc.)
    
    Returns:
        PolicyEvaluation with all applicable messages
    """
    mode = parse_risk_mode(mode) if isinstance(mode, str) else mode
    evaluation = PolicyEvaluation()
    context = context or {}
    
    # Evaluate flight components
    flight_segments = itinerary.get("flight_segments", []) or itinerary.get("flights", [])
    if flight_segments:
        # Build a pseudo-itinerary for flight evaluation
        flight_itin = {
            "segments": flight_segments,
            "ticketing_type": itinerary.get("ticketing_type", "unknown"),
            "connection_type": itinerary.get("connection_type", "unknown"),
            "fare_brand": itinerary.get("fare_brand"),
            "booking_type": itinerary.get("booking_type"),
        }
        flight_eval = evaluate_flight_itinerary(flight_itin, mode, context)
        evaluation.merge(flight_eval)
    
    # Note: Hotel evaluation removed - flights only mode
    
    # Evaluate transfer components (if points transfers are involved)
    transfers = itinerary.get("transfers", []) or itinerary.get("point_transfers", [])
    if transfers:
        transfer_eval = _evaluate_transfers(transfers, mode, context)
        evaluation.merge(transfer_eval)
    
    # Recalculate risk score with all components
    config = get_policy_config()
    mode_policy = get_mode_policy(mode)
    evaluation.risk_score = 0
    for msg in evaluation.blocks + evaluation.warnings:
        evaluation.risk_score += config.get_risk_penalty(msg.code)
    evaluation.risk_score = int(evaluation.risk_score * mode_policy.risk_penalty_multiplier)
    
    return evaluation


def evaluate_flight_option(
    flight: dict[str, Any],
    mode: BookingRiskMode | str = BookingRiskMode.BALANCED,
    context: Optional[dict[str, Any]] = None,
) -> PolicyEvaluation:
    """
    Evaluate a single flight option against flight policies.
    
    Convenience wrapper for evaluate_flight_itinerary.
    """
    return evaluate_flight_itinerary(flight, mode, context)


def evaluate_hotel(
    hotel: dict[str, Any],
    mode: BookingRiskMode | str = BookingRiskMode.BALANCED,
    context: Optional[dict[str, Any]] = None,
) -> PolicyEvaluation:
    """
    Evaluate a single hotel option against hotel policies.
    
    Note: Hotel evaluation disabled - flights only mode.
    Returns empty evaluation.
    """
    return PolicyEvaluation()


# =============================================================================
# BATCH PROCESSING
# =============================================================================

def apply_policy_to_results(
    results: list[dict[str, Any]],
    mode: BookingRiskMode | str = BookingRiskMode.BALANCED,
    context: Optional[dict[str, Any]] = None,
    item_type: str = "auto",
) -> tuple[list[dict[str, Any]], PolicySummary]:
    """
    Apply policy evaluation to a list of results.
    
    Args:
        results: List of flight/hotel/itinerary dicts
        mode: User's risk tolerance mode
        context: Additional context
        item_type: "flight", "hotel", "itinerary", or "auto" (detect)
    
    Returns:
        (processed_results, summary)
        - In SAFE mode, blocked items are removed
        - In BALANCED/AGGRESSIVE, items are kept with evaluations attached
    """
    mode = parse_risk_mode(mode) if isinstance(mode, str) else mode
    mode_policy = get_mode_policy(mode)
    context = context or {}
    
    processed = []
    summary = PolicySummary(risk_mode=str(mode.value if isinstance(mode, BookingRiskMode) else mode))
    
    for item in results:
        # Detect item type if auto
        if item_type == "auto":
            detected_type = _detect_item_type(item)
        else:
            detected_type = item_type
        
        # Evaluate based on type
        if detected_type == "flight":
            evaluation = evaluate_flight_option(item, mode, context)
        elif detected_type == "hotel":
            evaluation = evaluate_hotel(item, mode, context)
        else:
            evaluation = evaluate_itinerary(item, mode, context)
        
        # Attach evaluation to item
        item["policy_evaluation"] = evaluation.to_dict()
        item["policy_risk_score"] = evaluation.risk_score
        
        # Determine if item should be included
        if evaluation.is_blocked and mode_policy.hide_blocked_options:
            # Skip blocked items in SAFE mode
            summary.blocked_count += 1
            continue
        
        # Mark as disabled if blocked (for UI)
        if evaluation.is_blocked:
            item["disabled"] = True
            item["disable_reason"] = evaluation.blocks[0].title if evaluation.blocks else "Blocked by policy"
        
        processed.append(item)
        summary.add_evaluation(evaluation)
    
    summary.total_options = len(results)
    
    return processed, summary


def filter_blocked(
    results: list[dict[str, Any]],
    mode: BookingRiskMode | str = BookingRiskMode.BALANCED,
) -> list[dict[str, Any]]:
    """
    Filter out blocked results based on mode.
    
    Simpler version of apply_policy_to_results that just filters.
    """
    mode_policy = get_mode_policy(mode)
    
    if not mode_policy.hide_blocked_options:
        return results
    
    return [
        r for r in results
        if not r.get("policy_evaluation", {}).get("is_blocked", False)
    ]


# =============================================================================
# ACKNOWLEDGMENT HANDLING
# =============================================================================

def validate_acknowledgments(
    evaluation: PolicyEvaluation,
    acknowledgment: PolicyAcknowledgment,
) -> tuple[bool, list[str]]:
    """
    Validate that all required codes have been acknowledged.
    
    Args:
        evaluation: PolicyEvaluation with requires_ack list
        acknowledgment: User's acknowledgments
    
    Returns:
        (is_valid, missing_codes)
    """
    missing = []
    for code in evaluation.requires_ack:
        if not acknowledgment.has_acknowledged(code):
            missing.append(code)
    
    return len(missing) == 0, missing


def can_proceed_with_selection(
    item: dict[str, Any],
    acknowledgment: Optional[PolicyAcknowledgment] = None,
    mode: BookingRiskMode | str = BookingRiskMode.BALANCED,
) -> tuple[bool, list[str]]:
    """
    Check if user can proceed with selecting this item.
    
    Args:
        item: Item dict with policy_evaluation attached
        acknowledgment: User's acknowledgments
        mode: Risk mode
    
    Returns:
        (can_proceed, missing_acknowledgments)
    """
    mode_policy = get_mode_policy(mode)
    evaluation = item.get("policy_evaluation", {})
    
    # No acknowledgment required in aggressive mode
    if not mode_policy.require_ack_for_warnings:
        return True, []
    
    # Get required acknowledgments
    requires_ack = evaluation.get("requires_ack", [])
    
    if not requires_ack:
        return True, []
    
    if acknowledgment is None:
        return False, requires_ack
    
    # Check each required code
    missing = [
        code for code in requires_ack
        if not acknowledgment.has_acknowledged(code)
    ]
    
    return len(missing) == 0, missing


# =============================================================================
# INTERNAL HELPERS
# =============================================================================

def _detect_item_type(item: dict) -> str:
    """Detect whether an item is a flight, hotel, or full itinerary."""
    if "segments" in item or "flight_number" in item or "airline" in item:
        return "flight"
    if "hotel_name" in item or "room_type" in item or "check_in" in item:
        return "hotel"
    if "flight_segments" in item or "hotel_segments" in item:
        return "itinerary"
    return "itinerary"  # Default


def _evaluate_transfers(
    transfers: list[dict],
    mode: BookingRiskMode | str,
    context: dict,
) -> PolicyEvaluation:
    """Evaluate point transfer risks."""
    from .reason_codes import (
        POINTS_TRANSFER_IRREVERSIBLE,
        requires_ack,
    )
    
    evaluation = PolicyEvaluation()
    config = get_policy_config()
    
    if not transfers:
        return evaluation
    
    # Calculate total transfer amount
    total_points = sum(t.get("points", 0) for t in transfers)
    
    if total_points >= config.MIN_TRANSFER_AMOUNT_FOR_WARNING:
        from .types import PolicyMessage
        evaluation.add_message(
            PolicyMessage(
                code=POINTS_TRANSFER_IRREVERSIBLE,
                severity="warn",
                title="Point transfers are permanent",
                detail=(
                    f"You are transferring {total_points:,} points. "
                    "Once transferred to an airline/hotel program, points cannot be "
                    "transferred back to your bank. Make sure award availability is "
                    "confirmed before transferring."
                ),
                context={
                    "total_points": total_points,
                    "transfers": [
                        {"from": t.get("from"), "to": t.get("to"), "points": t.get("points")}
                        for t in transfers
                    ],
                },
                requires_ack=requires_ack(POINTS_TRANSFER_IRREVERSIBLE),
                ack_text="I understand point transfers are permanent",
            )
        )
    
    return evaluation


# =============================================================================
# LOGGING
# =============================================================================

def log_policy_decision(
    item_id: str,
    evaluation: PolicyEvaluation,
    mode: BookingRiskMode | str,
    request_id: Optional[str] = None,
    item_type: str = "itinerary",
):
    """
    Log a policy decision for debugging/observability.
    
    Logs reason codes, mode, and outcome without PII.
    Uses structured logging format for easy filtering in log aggregators.
    """
    block_codes = [m.code for m in evaluation.blocks]
    warning_codes = [m.code for m in evaluation.warnings]
    info_codes = [m.code for m in evaluation.info]
    
    # Build structured log message
    log_data = {
        "event": "policy_decision",
        "request_id": request_id,
        "item_id": item_id,
        "item_type": item_type,
        "mode": str(mode.value if isinstance(mode, BookingRiskMode) else mode),
        "is_blocked": evaluation.is_blocked,
        "risk_score": evaluation.risk_score,
        "block_count": len(block_codes),
        "warning_count": len(warning_codes),
        "info_count": len(info_codes),
        "block_codes": block_codes,
        "warning_codes": warning_codes,
        "requires_ack": evaluation.requires_ack,
    }
    
    # Log at appropriate level based on outcome
    if evaluation.is_blocked:
        logger.warning(
            f"[Policy] BLOCKED {item_type} {item_id}: {block_codes}",
            extra=log_data
        )
    elif evaluation.warnings:
        logger.info(
            f"[Policy] WARNING {item_type} {item_id}: {warning_codes}",
            extra=log_data
        )
    else:
        logger.debug(
            f"[Policy] OK {item_type} {item_id}",
            extra=log_data
        )


def log_policy_summary(
    total: int,
    blocked: int,
    with_warnings: int,
    mode: str,
    request_id: Optional[str] = None,
):
    """
    Log summary of policy evaluation across multiple items.
    """
    logger.info(
        f"[Policy] Summary: {blocked}/{total} blocked, {with_warnings}/{total} with warnings (mode={mode})",
        extra={
            "event": "policy_summary",
            "request_id": request_id,
            "total_items": total,
            "blocked_count": blocked,
            "warning_count": with_warnings,
            "mode": mode,
        }
    )
