"""
Hotel-specific policy rules.

Evaluates hotel bookings for reality issues:
- Nonrefundable rate warnings
- OTA loyalty loss warnings  
- Resort fee disclosure
- Prepayment requirements

Usage:
    from policy.hotel_policy import evaluate_hotel_option
    
    evaluation = evaluate_hotel_option(
        hotel=hotel_data,
        mode=BookingRiskMode.BALANCED,
        context={"user_has_elite_status": True, "loyalty_programs": ["hilton", "marriott"]}
    )
"""

import logging
from typing import Any, Optional
from datetime import datetime, timedelta

from .types import PolicyMessage, PolicyEvaluation
from .modes import BookingRiskMode, get_mode_policy
from .config import get_policy_config
from .reason_codes import (
    HOTEL_NONREFUNDABLE_RISK,
    HOTEL_OTA_LOYALTY_LOSS,
    HOTEL_RESORT_FEES_PRESENT,
    HOTEL_PREPAY_REQUIRED,
    HOTEL_CANCELLATION_DEADLINE_SOON,
    HOTEL_UNKNOWN_RATE_SOURCE,
    HOTEL_CITY_TAX_EXCLUDED,
    requires_ack,
)

logger = logging.getLogger(__name__)


# =============================================================================
# MAIN EVALUATION FUNCTION
# =============================================================================

def evaluate_hotel_option(
    hotel: dict[str, Any],
    mode: BookingRiskMode | str = BookingRiskMode.BALANCED,
    context: Optional[dict[str, Any]] = None,
) -> PolicyEvaluation:
    """
    Evaluate a hotel option against all hotel policies.
    
    Args:
        hotel: Hotel option dict with rate info, source, fees, etc.
        mode: User's risk tolerance mode
        context: Additional context (e.g., user loyalty programs, elite status)
    
    Returns:
        PolicyEvaluation with all applicable messages
    """
    evaluation = PolicyEvaluation()
    mode_policy = get_mode_policy(mode)
    config = get_policy_config()
    context = context or {}
    
    # Run each rule
    _evaluate_nonrefundable(hotel, mode_policy, config, evaluation, context)
    _evaluate_ota_loyalty_loss(hotel, mode_policy, evaluation, context)
    _evaluate_resort_fees(hotel, config, evaluation)
    _evaluate_prepayment(hotel, evaluation)
    _evaluate_cancellation_deadline(hotel, config, evaluation, context)
    _evaluate_city_taxes(hotel, evaluation)
    
    # Calculate risk score
    for msg in evaluation.blocks + evaluation.warnings:
        evaluation.risk_score += config.get_risk_penalty(msg.code)
    
    # Apply mode multiplier
    evaluation.risk_score = int(evaluation.risk_score * mode_policy.risk_penalty_multiplier)
    
    return evaluation


# =============================================================================
# INDIVIDUAL RULES
# =============================================================================

def _evaluate_nonrefundable(
    hotel: dict,
    mode_policy,
    config,
    evaluation: PolicyEvaluation,
    context: dict,
):
    """
    Rule: Nonrefundable rates require acknowledgment.
    
    Also compare to refundable alternatives if available.
    """
    is_refundable = hotel.get("refundable", True)
    
    if is_refundable:
        return
    
    # Get pricing for comparison
    nonrefundable_price = hotel.get("total_price", 0)
    refundable_alternative_price = hotel.get("refundable_alternative_price")
    
    # Calculate delta if we have both prices
    price_delta_percent = None
    if refundable_alternative_price and nonrefundable_price:
        price_delta_percent = (refundable_alternative_price - nonrefundable_price) / refundable_alternative_price
    
    # Determine severity
    is_block = mode_policy.blocks_nonrefundable_hotel
    
    # If savings are minimal, warn more strongly
    strong_warning = False
    if price_delta_percent is not None:
        if price_delta_percent < config.HOTEL_NONREFUNDABLE_PRICE_DELTA_THRESHOLD:
            strong_warning = True
    
    severity = "block" if is_block else ("warn" if strong_warning else "info")
    
    detail = "This rate is nonrefundable. If your plans change, you will not receive a refund."
    if refundable_alternative_price:
        savings = refundable_alternative_price - nonrefundable_price
        if strong_warning:
            detail += (
                f" The refundable option is only ${savings:.2f} more "
                f"({price_delta_percent*100:.0f}% higher). Consider the flexibility."
            )
        else:
            detail += f" You save ${savings:.2f} vs the refundable rate."
    
    message = PolicyMessage(
        code=HOTEL_NONREFUNDABLE_RISK,
        severity=severity,
        title="Nonrefundable rate",
        detail=detail,
        context={
            "refundable": False,
            "total_price": nonrefundable_price,
            "refundable_alternative_price": refundable_alternative_price,
            "price_delta_percent": price_delta_percent,
        },
        requires_ack=requires_ack(HOTEL_NONREFUNDABLE_RISK) and severity in ("warn", "block"),
        ack_text="I understand this rate is nonrefundable",
    )
    
    evaluation.add_message(message)
    evaluation.explanations.append("Nonrefundable rate selected")


def _evaluate_ota_loyalty_loss(
    hotel: dict,
    mode_policy,
    evaluation: PolicyEvaluation,
    context: dict,
):
    """
    Rule: OTA bookings may not earn loyalty points or receive elite benefits.
    
    Only warn if user has relevant loyalty programs.
    """
    rate_source = hotel.get("rate_source", "").lower()
    
    if rate_source not in ("ota", "third_party", "expedia", "booking.com", "hotels.com"):
        # Not an OTA or unknown source
        if not rate_source:
            # Unknown source - add info message
            message = PolicyMessage(
                code=HOTEL_UNKNOWN_RATE_SOURCE,
                severity="info",
                title="Rate source unknown",
                detail=(
                    "Cannot determine if this is a direct hotel booking or OTA. "
                    "Loyalty benefits may or may not apply."
                ),
                context={"rate_source": rate_source},
            )
            evaluation.add_message(message)
        return
    
    # Check if user cares about loyalty
    user_loyalty_programs = context.get("hotel_loyalty_programs", [])
    user_has_elite = context.get("has_hotel_elite_status", False)
    hotel_chain = hotel.get("chain", "").lower()
    
    # Only warn if user has loyalty with this chain or has elite status
    relevant_loyalty = any(
        program.lower() in hotel_chain or hotel_chain in program.lower()
        for program in user_loyalty_programs
    ) if user_loyalty_programs else False
    
    if not relevant_loyalty and not user_has_elite:
        # User doesn't have loyalty with this chain - still mention but lower priority
        severity = "info"
    else:
        severity = "warn" if mode_policy.require_ack_for_warnings else "info"
    
    detail = (
        f"This is an OTA ({rate_source}) booking. "
        "Points earning and elite benefits typically do not apply when booking through third parties."
    )
    
    if user_has_elite:
        detail += " Your elite status benefits (room upgrades, late checkout, etc.) may not be honored."
    
    message = PolicyMessage(
        code=HOTEL_OTA_LOYALTY_LOSS,
        severity=severity,
        title="OTA booking - loyalty benefits may not apply",
        detail=detail,
        context={
            "rate_source": rate_source,
            "hotel_chain": hotel_chain,
            "user_loyalty_programs": user_loyalty_programs,
            "user_has_elite": user_has_elite,
        },
    )
    
    evaluation.add_message(message)


def _evaluate_resort_fees(
    hotel: dict,
    config,
    evaluation: PolicyEvaluation,
):
    """
    Rule: Resort/destination fees must be disclosed prominently.
    
    These are mandatory fees not included in the quoted rate.
    """
    mandatory_fees = hotel.get("mandatory_fees", 0) or hotel.get("resort_fee", 0)
    
    if not mandatory_fees or mandatory_fees <= 0:
        return
    
    base_rate = hotel.get("base_rate", hotel.get("total_price", 0))
    nights = hotel.get("nights", 1)
    
    # Calculate total fees
    total_fees = mandatory_fees * nights if mandatory_fees < 100 else mandatory_fees  # Per night vs total
    
    # Calculate fee percentage of base rate
    fee_percent = (total_fees / base_rate) if base_rate else 0
    
    # Determine if this is a high fee
    high_fee = fee_percent > config.RESORT_FEE_WARNING_THRESHOLD_PERCENT
    
    severity = "warn" if high_fee else "info"
    
    message = PolicyMessage(
        code=HOTEL_RESORT_FEES_PRESENT,
        severity=severity,
        title=f"Resort fee: ${mandatory_fees:.2f}/night",
        detail=(
            f"This hotel charges a mandatory resort/destination fee of ${mandatory_fees:.2f} per night "
            f"(${total_fees:.2f} total for {nights} nights). "
            "This fee is not included in the quoted rate and will be charged at checkout."
        ),
        context={
            "mandatory_fees_per_night": mandatory_fees,
            "total_fees": total_fees,
            "nights": nights,
            "fee_percent": fee_percent,
            "base_rate": base_rate,
        },
    )
    
    evaluation.add_message(message)
    
    # Update true total cost
    true_total = hotel.get("total_price", 0) + total_fees
    evaluation.explanations.append(
        f"True total cost including fees: ${true_total:.2f}"
    )


def _evaluate_prepayment(
    hotel: dict,
    evaluation: PolicyEvaluation,
):
    """
    Rule: Inform user if prepayment is required.
    """
    prepay_required = hotel.get("prepay_required", False)
    
    if not prepay_required:
        return
    
    message = PolicyMessage(
        code=HOTEL_PREPAY_REQUIRED,
        severity="info",
        title="Prepayment required",
        detail=(
            "Full payment is required at time of booking, not at check-in. "
            "Your card will be charged immediately."
        ),
        context={
            "prepay_required": True,
        },
    )
    
    evaluation.add_message(message)


def _evaluate_cancellation_deadline(
    hotel: dict,
    config,
    evaluation: PolicyEvaluation,
    context: dict,
):
    """
    Rule: Warn if cancellation deadline is approaching.
    """
    cancel_deadline = hotel.get("cancel_deadline") or hotel.get("cancellation_deadline")
    
    if not cancel_deadline:
        return
    
    # Parse deadline
    try:
        if isinstance(cancel_deadline, str):
            deadline_dt = datetime.fromisoformat(cancel_deadline.replace("Z", "+00:00"))
        else:
            deadline_dt = cancel_deadline
        
        now = datetime.now(deadline_dt.tzinfo) if deadline_dt.tzinfo else datetime.now()
        days_until = (deadline_dt - now).days
        
        if days_until <= config.CANCELLATION_WARNING_DAYS:
            if days_until <= 0:
                title = "Cancellation deadline has passed"
                detail = "The free cancellation period has ended. Cancelling now may incur charges."
                severity = "warn"
            elif days_until <= 2:
                title = f"Cancellation deadline in {days_until} day{'s' if days_until != 1 else ''}"
                detail = f"Free cancellation ends on {deadline_dt.strftime('%B %d, %Y')}. Act soon if you need to cancel."
                severity = "warn"
            else:
                title = f"Cancellation deadline: {deadline_dt.strftime('%B %d, %Y')}"
                detail = f"You have {days_until} days to cancel for free."
                severity = "info"
            
            message = PolicyMessage(
                code=HOTEL_CANCELLATION_DEADLINE_SOON,
                severity=severity,
                title=title,
                detail=detail,
                context={
                    "cancel_deadline": str(cancel_deadline),
                    "days_until": days_until,
                },
            )
            
            evaluation.add_message(message)
    
    except (ValueError, TypeError):
        pass


def _evaluate_city_taxes(
    hotel: dict,
    evaluation: PolicyEvaluation,
):
    """
    Rule: Inform about city/tourist taxes not included.
    """
    city_tax = hotel.get("city_tax") or hotel.get("tourist_tax")
    taxes_included = hotel.get("taxes_included", True)
    
    if city_tax or not taxes_included:
        detail = "City/tourist tax may be collected at checkout and is not included in the quoted price."
        if city_tax:
            detail = f"City/tourist tax of ${city_tax:.2f} per night is collected at checkout."
        
        message = PolicyMessage(
            code=HOTEL_CITY_TAX_EXCLUDED,
            severity="info",
            title="City tax not included",
            detail=detail,
            context={
                "city_tax": city_tax,
                "taxes_included": taxes_included,
            },
        )
        
        evaluation.add_message(message)
