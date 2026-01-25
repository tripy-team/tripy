"""
Booking Instructions Generator

Generates detailed, actionable booking instructions for optimized itineraries.
Includes:
- Step-by-step transfer instructions with portal URLs
- Flight booking instructions with direct booking links
- Hotel booking instructions
- Important notes and timing advice
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field, asdict
import logging

from .transfer_strategy import (
    BANK_METADATA,
    PROGRAM_METADATA,
    EXTENDED_TRANSFER_GRAPH,
    get_program_name,
    get_bank_name,
    get_transfer_timing_advice,
)
from .min_oop_optimizer import MinOOPSolution, PaymentInstruction

logger = logging.getLogger(__name__)


# =============================================================================
# CONSTANTS
# =============================================================================

# Airline direct booking URLs
AIRLINE_BOOKING_URLS: Dict[str, str] = {
    "UA": "https://www.united.com/en/us/book-flight/united-award-travel",
    "AA": "https://www.aa.com/booking/find-flights",
    "DL": "https://www.delta.com/flight-search",
    "AS": "https://www.alaskaair.com/booking/flights",
    "B6": "https://www.jetblue.com/book-a-trip",
    "WN": "https://www.southwest.com/air/booking/select.html",
    "AC": "https://www.aircanada.com/ca/en/aco/home/book/find-flights.html",
    "BA": "https://www.britishairways.com/travel/book/public/en_us",
    "AF": "https://www.airfrance.us/US/en/common/home-page/home-page.htm",
    "KL": "https://www.klm.us/en/book",
    "LH": "https://www.lufthansa.com/us/en/book-a-flight",
    "SQ": "https://www.singaporeair.com/en_UK/plan-and-book/book-flights/",
    "CX": "https://www.cathaypacific.com/cx/en_US/book-a-trip/book-flights.html",
    "NH": "https://www.ana.co.jp/en/us/book-plan/fare-deals/",
    "JL": "https://www.jal.co.jp/en/",
    "EK": "https://www.emirates.com/us/english/book/",
    "QR": "https://www.qatarairways.com/en-us/book-flight.html",
    "EY": "https://www.etihad.com/en-us/book",
    "TK": "https://www.turkishairlines.com/en-us/",
    "VS": "https://www.virginatlantic.com/book",
}

# Hotel direct booking URLs
HOTEL_BOOKING_URLS: Dict[str, str] = {
    "HH": "https://www.hilton.com/en/hilton-honors/",
    "MAR": "https://www.marriott.com/default.mi",
    "HYATT": "https://www.hyatt.com/",
    "IHG": "https://www.ihg.com/rewardsclub/us/en/home",
    "ACC": "https://all.accor.com/",
    "WYNDHAM": "https://www.wyndhamhotels.com/wyndham-rewards",
}

# Google Flights fallback for cash bookings
GOOGLE_FLIGHTS_URL = "https://www.google.com/travel/flights"


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class DetailedBookingStep:
    """A single step in the booking process."""
    step_number: int
    category: str  # "transfer", "flight", "hotel", "note"
    title: str
    description: str
    
    # Action details
    action_type: str  # "transfer", "book_with_points", "book_with_cash", "info"
    url: Optional[str] = None
    
    # Transfer-specific
    from_program: Optional[str] = None
    from_program_name: Optional[str] = None
    to_program: Optional[str] = None
    to_program_name: Optional[str] = None
    points_amount: Optional[int] = None
    resulting_points: Optional[int] = None
    transfer_time: Optional[str] = None
    
    # Payment details
    payment_type: Optional[str] = None  # "points", "cash"
    cash_amount: Optional[float] = None
    points_used: Optional[int] = None
    program_used: Optional[str] = None
    
    # Item details
    item_type: Optional[str] = None  # "flight", "hotel"
    item_description: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    date: Optional[str] = None
    
    # Sub-steps for detailed instructions
    sub_steps: List[str] = field(default_factory=list)
    
    # Warnings/notes
    warnings: List[str] = field(default_factory=list)
    tips: List[str] = field(default_factory=list)


@dataclass
class CompleteBookingPlan:
    """Complete booking plan with all steps and summary."""
    status: str
    
    # Summary
    total_out_of_pocket: float
    all_cash_cost: float
    savings: float
    savings_percentage: float
    total_points_used: int
    
    # Steps
    transfer_steps: List[DetailedBookingStep] = field(default_factory=list)
    booking_steps: List[DetailedBookingStep] = field(default_factory=list)
    all_steps: List[DetailedBookingStep] = field(default_factory=list)
    
    # Timing
    recommended_order: List[str] = field(default_factory=list)
    earliest_booking_date: Optional[str] = None
    transfer_wait_days: int = 0
    
    # Notes
    general_notes: List[str] = field(default_factory=list)
    important_warnings: List[str] = field(default_factory=list)


# =============================================================================
# INSTRUCTION GENERATORS
# =============================================================================

def generate_transfer_step(
    step_number: int,
    from_bank: str,
    to_program: str,
    points_to_transfer: int,
    for_items: List[str] = None,
    days_until_travel: int = 14,
) -> DetailedBookingStep:
    """Generate detailed transfer instruction step."""
    bank_meta = BANK_METADATA.get(from_bank.lower(), {})
    prog_meta = PROGRAM_METADATA.get(to_program.upper(), {})
    transfer_info = EXTENDED_TRANSFER_GRAPH.get(from_bank.lower(), {}).get(to_program.upper(), {})
    
    bank_name = bank_meta.get("name", from_bank.title())
    prog_name = transfer_info.get("name", prog_meta.get("name", to_program))
    ratio = transfer_info.get("ratio", 1.0)
    resulting_points = int(points_to_transfer * ratio)
    transfer_time = bank_meta.get("default_transfer_time", "varies")
    portal_url = bank_meta.get("portal_url", "")
    
    # Build sub-steps
    sub_steps = [
        f"Log in to your {bank_name} account",
        f"Navigate to the rewards portal: {portal_url}" if portal_url else "Navigate to the rewards portal",
        "Click 'Transfer Points' or 'Transfer to Travel Partners'",
        f"Find and select '{prog_name}'",
        f"Enter your {prog_name} membership/frequent flyer number",
        f"Transfer exactly {points_to_transfer:,} points",
        "Review and confirm the transfer",
    ]
    
    if ratio > 1.0:
        sub_steps.append(f"You'll receive {resulting_points:,} {prog_name} points (bonus ratio!)")
    elif ratio == 1.0:
        sub_steps.append(f"You'll receive {resulting_points:,} {prog_name} points (1:1 transfer)")
    else:
        sub_steps.append(f"You'll receive {resulting_points:,} {prog_name} points ({ratio}:1 ratio)")
    
    # Build tips and warnings
    tips = []
    warnings = []
    
    timing_advice = get_transfer_timing_advice(from_bank, days_until_travel)
    if not timing_advice.get("is_safe_to_transfer", True):
        warnings.append(timing_advice.get("warning", "Transfer may not complete before travel"))
    
    if "instant" in transfer_time.lower():
        tips.append("This transfer is instant! You can book immediately after.")
    elif "1-2" in transfer_time.lower() or "business day" in transfer_time.lower():
        tips.append(f"Allow {transfer_time} for points to appear. Consider transferring early.")
    
    if ratio > 1.0:
        tips.append(f"Great value! You're getting a {int((ratio-1)*100)}% bonus on this transfer.")
    
    item_desc = ""
    if for_items:
        item_desc = f" (for: {', '.join(for_items)})"
    
    return DetailedBookingStep(
        step_number=step_number,
        category="transfer",
        title=f"Transfer {points_to_transfer:,} points to {prog_name}",
        description=f"Transfer {points_to_transfer:,} {bank_name} points to {prog_name}{item_desc}",
        action_type="transfer",
        url=portal_url,
        from_program=from_bank.lower(),
        from_program_name=bank_name,
        to_program=to_program.upper(),
        to_program_name=prog_name,
        points_amount=points_to_transfer,
        resulting_points=resulting_points,
        transfer_time=transfer_time,
        sub_steps=sub_steps,
        tips=tips,
        warnings=warnings,
    )


def generate_flight_booking_step(
    step_number: int,
    payment: PaymentInstruction,
    flight_details: Optional[Dict[str, Any]] = None,
) -> DetailedBookingStep:
    """Generate detailed flight booking instruction step."""
    
    if payment.payment_type == "points":
        # Points booking
        program = payment.program_used or ""
        program_name = payment.program_name or get_program_name(program)
        booking_url = AIRLINE_BOOKING_URLS.get(program.upper(), "")
        
        if not booking_url:
            booking_url = PROGRAM_METADATA.get(program.upper(), {}).get("booking_url", "")
        
        sub_steps = [
            f"Log in to your {program_name} account (or create one if needed)",
            f"Navigate to award booking: {booking_url}" if booking_url else "Navigate to the award booking section",
            "Search for your flight",
            f"Select the award flight (you'll need {payment.points_used:,} points)",
            f"Complete the booking and pay ${payment.cash_paid:.2f} in taxes/fees",
            "Save your confirmation number",
        ]
        
        tips = [f"Book early for best award availability"]
        if payment.cash_paid > 100:
            tips.append(f"Consider paying taxes/fees with a card that earns bonus points on travel")
        
        return DetailedBookingStep(
            step_number=step_number,
            category="flight",
            title=f"Book flight with {payment.points_used:,} {program_name} points",
            description=f"Book {payment.description} using {payment.points_used:,} {program_name} points. Pay ${payment.cash_paid:.2f} in taxes/fees.",
            action_type="book_with_points",
            url=booking_url,
            payment_type="points",
            cash_amount=payment.cash_paid,
            points_used=payment.points_used,
            program_used=program,
            item_type="flight",
            item_description=payment.description,
            sub_steps=sub_steps,
            tips=tips,
        )
    else:
        # Cash booking
        sub_steps = [
            f"Go to Google Flights ({GOOGLE_FLIGHTS_URL}) or your preferred booking site",
            f"Search for: {payment.description}",
            "Compare prices across airlines and booking sites",
            f"Book the best option for ${payment.cash_paid:.2f}",
            "Save your confirmation number",
        ]
        
        tips = [
            "Compare prices on Google Flights, Kayak, and directly on airline websites",
            "Consider using a travel credit card for extra points/miles",
        ]
        
        return DetailedBookingStep(
            step_number=step_number,
            category="flight",
            title=f"Book flight with cash",
            description=f"Book {payment.description}. Pay ${payment.cash_paid:.2f} cash.",
            action_type="book_with_cash",
            url=GOOGLE_FLIGHTS_URL,
            payment_type="cash",
            cash_amount=payment.cash_paid,
            item_type="flight",
            item_description=payment.description,
            sub_steps=sub_steps,
            tips=tips,
        )


def generate_hotel_booking_step(
    step_number: int,
    payment: PaymentInstruction,
    hotel_details: Optional[Dict[str, Any]] = None,
) -> DetailedBookingStep:
    """Generate detailed hotel booking instruction step."""
    
    if payment.payment_type == "points":
        # Points booking
        program = payment.program_used or ""
        program_name = payment.program_name or get_program_name(program)
        booking_url = HOTEL_BOOKING_URLS.get(program.upper(), "")
        
        if not booking_url:
            booking_url = PROGRAM_METADATA.get(program.upper(), {}).get("booking_url", "")
        
        sub_steps = [
            f"Log in to your {program_name} account",
            f"Navigate to: {booking_url}" if booking_url else "Navigate to the loyalty booking section",
            "Search for your hotel and dates",
            f"Select the points rate ({payment.points_used:,} points)",
            f"Complete the booking and pay ${payment.cash_paid:.2f} in resort fees/taxes if applicable",
            "Save your confirmation number",
        ]
        
        tips = ["Book directly with the hotel brand for elite benefits and easier modifications"]
        
        return DetailedBookingStep(
            step_number=step_number,
            category="hotel",
            title=f"Book hotel with {payment.points_used:,} {program_name} points",
            description=f"Book {payment.description} using {payment.points_used:,} {program_name} points. Pay ${payment.cash_paid:.2f} in fees.",
            action_type="book_with_points",
            url=booking_url,
            payment_type="points",
            cash_amount=payment.cash_paid,
            points_used=payment.points_used,
            program_used=program,
            item_type="hotel",
            item_description=payment.description,
            sub_steps=sub_steps,
            tips=tips,
        )
    else:
        # Cash booking
        sub_steps = [
            "Compare prices on Hotels.com, Booking.com, and direct hotel websites",
            f"Search for: {payment.description}",
            "Check if booking direct gives you elite benefits or bonus points",
            f"Book the best option for ${payment.cash_paid:.2f}",
            "Save your confirmation number",
        ]
        
        tips = [
            "Booking direct often gives you more flexibility for changes/cancellations",
            "Use a hotel-branded credit card for bonus points on stays",
        ]
        
        return DetailedBookingStep(
            step_number=step_number,
            category="hotel",
            title=f"Book hotel with cash",
            description=f"Book {payment.description}. Pay ${payment.cash_paid:.2f} cash.",
            action_type="book_with_cash",
            url="https://www.google.com/travel/hotels",
            payment_type="cash",
            cash_amount=payment.cash_paid,
            item_type="hotel",
            item_description=payment.description,
            sub_steps=sub_steps,
            tips=tips,
        )


# =============================================================================
# MAIN FUNCTION
# =============================================================================

def generate_complete_booking_plan(
    solution: MinOOPSolution,
    days_until_travel: int = 14,
    include_tips: bool = True,
) -> CompleteBookingPlan:
    """
    Generate a complete booking plan from an optimization solution.
    
    Args:
        solution: The MinOOPSolution from the optimizer
        days_until_travel: Days until first flight (affects transfer timing advice)
        include_tips: Whether to include helpful tips
        
    Returns:
        CompleteBookingPlan with all steps and instructions
    """
    plan = CompleteBookingPlan(
        status=solution.status,
        total_out_of_pocket=solution.total_out_of_pocket,
        all_cash_cost=solution.all_cash_cost,
        savings=solution.savings,
        savings_percentage=solution.savings_percentage,
        total_points_used=solution.total_points_used,
    )
    
    step_number = 1
    max_transfer_wait = 0
    
    # Step 1: Generate transfer steps
    for transfer in solution.transfer_plan:
        # Determine items this transfer is for
        for_items = transfer.for_items if hasattr(transfer, 'for_items') else []
        
        step = generate_transfer_step(
            step_number=step_number,
            from_bank=transfer.from_program,
            to_program=transfer.to_program,
            points_to_transfer=transfer.points_to_transfer,
            for_items=for_items,
            days_until_travel=days_until_travel,
        )
        
        plan.transfer_steps.append(step)
        plan.all_steps.append(step)
        step_number += 1
        
        # Track transfer wait time
        if "instant" not in step.transfer_time.lower():
            if "1-2" in step.transfer_time.lower():
                max_transfer_wait = max(max_transfer_wait, 2)
            elif "2" in step.transfer_time.lower():
                max_transfer_wait = max(max_transfer_wait, 3)
            else:
                max_transfer_wait = max(max_transfer_wait, 1)
    
    plan.transfer_wait_days = max_transfer_wait
    
    # Step 2: Generate booking steps
    for payment in solution.payment_plan:
        if payment.item_type == "flight":
            step = generate_flight_booking_step(
                step_number=step_number,
                payment=payment,
            )
        elif payment.item_type == "hotel":
            step = generate_hotel_booking_step(
                step_number=step_number,
                payment=payment,
            )
        else:
            # Generic booking step
            step = DetailedBookingStep(
                step_number=step_number,
                category="other",
                title=f"Book {payment.description}",
                description=f"Book {payment.description}. Pay ${payment.cash_paid:.2f}.",
                action_type="book_with_cash" if payment.payment_type == "cash" else "book_with_points",
                payment_type=payment.payment_type,
                cash_amount=payment.cash_paid,
                item_type=payment.item_type,
                item_description=payment.description,
            )
        
        plan.booking_steps.append(step)
        plan.all_steps.append(step)
        step_number += 1
    
    # Generate general notes
    if include_tips:
        if solution.savings > 0:
            plan.general_notes.append(
                f"By following this plan, you'll save ${solution.savings:,.2f} "
                f"({solution.savings_percentage:.1f}%) compared to paying all cash!"
            )
        
        if plan.transfer_steps:
            instant_count = sum(1 for s in plan.transfer_steps if "instant" in s.transfer_time.lower())
            if instant_count == len(plan.transfer_steps):
                plan.general_notes.append(
                    "All your transfers are instant. You can proceed to booking immediately."
                )
            elif instant_count > 0:
                plan.general_notes.append(
                    f"{instant_count} of {len(plan.transfer_steps)} transfers are instant. "
                    "Wait for non-instant transfers before booking with those points."
                )
            else:
                plan.general_notes.append(
                    f"Allow up to {plan.transfer_wait_days} business days for transfers to complete "
                    "before booking with transferred points."
                )
    
    # Generate recommended order
    plan.recommended_order = [
        "1. Complete all point transfers (do these first!)",
        "2. Wait for non-instant transfers to complete",
        "3. Book flights (best availability if booked early)",
        "4. Book hotels (more flexible, can wait until flights are confirmed)",
    ]
    
    # Add important warnings
    if max_transfer_wait > 0 and days_until_travel < max_transfer_wait + 3:
        plan.important_warnings.append(
            f"⚠️ Some transfers may take up to {max_transfer_wait} business days. "
            f"With {days_until_travel} days until travel, consider booking soon or "
            "using instant-transfer options."
        )
    
    if solution.status == "Fallback":
        plan.important_warnings.append(
            "Note: Points optimization was not available for this search. "
            "Showing cash prices. You may still be able to use points by "
            "checking directly with airlines/hotels."
        )
    
    return plan


def booking_plan_to_dict(plan: CompleteBookingPlan) -> Dict[str, Any]:
    """Convert CompleteBookingPlan to JSON-serializable dict."""
    return {
        "status": plan.status,
        "summary": {
            "total_out_of_pocket": plan.total_out_of_pocket,
            "all_cash_cost": plan.all_cash_cost,
            "savings": plan.savings,
            "savings_percentage": plan.savings_percentage,
            "total_points_used": plan.total_points_used,
        },
        "transfer_steps": [asdict(s) for s in plan.transfer_steps],
        "booking_steps": [asdict(s) for s in plan.booking_steps],
        "all_steps": [asdict(s) for s in plan.all_steps],
        "transfer_wait_days": plan.transfer_wait_days,
        "recommended_order": plan.recommended_order,
        "general_notes": plan.general_notes,
        "important_warnings": plan.important_warnings,
    }
