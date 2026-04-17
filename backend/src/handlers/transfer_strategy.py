"""
Transfer Strategy Module

Extended transfer graph supporting airline programs ONLY.
Provides utilities for computing optimal point transfers to minimize out-of-pocket costs.
"""

from typing import Dict, List, Optional, Set, Tuple, Any
from dataclasses import dataclass, field

# Centralized program config (single source of truth)
from src.config.programs import (
    EXTENDED_TRANSFER_GRAPH,
    DEFAULT_TRANSFER_GRAPH,
    BANK_METADATA,
    PROGRAM_METADATA,
    CREDIT_CARD_DETAILS,
    PROGRAM_DISPLAY_NAMES,
)


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class TransferOption:
    """Represents a possible transfer from a bank to an airline program."""
    from_bank: str
    from_bank_name: str
    to_program: str
    to_program_name: str
    program_type: str  # Always "airline"
    ratio: float  # Points received per bank point
    transfer_time: str
    portal_url: str
    booking_url: str


@dataclass
class TransferInstruction:
    """Step-by-step instructions for a point transfer."""
    from_program: str
    from_program_name: str
    to_program: str
    to_program_name: str
    points_to_transfer: int
    transfer_ratio: str  # e.g., "1:1"
    resulting_points: int
    transfer_time: str
    portal_url: str
    booking_url: str
    steps: List[str] = field(default_factory=list)


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def is_bank_program(program: str) -> bool:
    """Check if a program code represents a bank (transferable points)."""
    return program.lower() in EXTENDED_TRANSFER_GRAPH


def get_bank_name(bank: str) -> str:
    """Get the display name for a bank."""
    return BANK_METADATA.get(bank.lower(), {}).get("name", bank.upper())


def get_program_name(program: str) -> str:
    """Get the display name for a program (airline)."""
    return PROGRAM_METADATA.get(program.upper(), {}).get("name", program)


def get_program_type(program: str) -> Optional[str]:
    """Get the type of a program (always 'airline')."""
    return PROGRAM_METADATA.get(program.upper(), {}).get("type")


def can_transfer(bank: str, program: str) -> bool:
    """Check if a bank can transfer to a specific airline program."""
    bank_lower = bank.lower()
    prog_upper = program.upper()
    return prog_upper in EXTENDED_TRANSFER_GRAPH.get(bank_lower, {})


def get_transfer_ratio(bank: str, program: str) -> float:
    """Get the transfer ratio from bank to program (points received per bank point)."""
    bank_lower = bank.lower()
    prog_upper = program.upper()
    info = EXTENDED_TRANSFER_GRAPH.get(bank_lower, {}).get(prog_upper, {})
    return info.get("ratio", 0.0)


def get_transfer_partners(bank: str) -> List[str]:
    """Get all airline programs a bank can transfer to."""
    bank_lower = bank.lower()
    programs = EXTENDED_TRANSFER_GRAPH.get(bank_lower, {})
    return list(programs.keys())


def get_all_transfer_options(available_points: Dict[str, int]) -> List[TransferOption]:
    """
    Get all possible transfer options given a user's point balances.
    
    Args:
        available_points: Dict mapping program codes to balances
        
    Returns:
        List of TransferOption objects
    """
    options = []
    
    for prog, balance in available_points.items():
        if balance <= 0:
            continue
            
        prog_lower = prog.lower()
        if prog_lower not in EXTENDED_TRANSFER_GRAPH:
            continue  # Not a bank with transfers
            
        bank_meta = BANK_METADATA.get(prog_lower, {})
        
        for target_prog, info in EXTENDED_TRANSFER_GRAPH[prog_lower].items():
            prog_meta = PROGRAM_METADATA.get(target_prog, {})
            
            options.append(TransferOption(
                from_bank=prog_lower,
                from_bank_name=bank_meta.get("name", prog),
                to_program=target_prog,
                to_program_name=info.get("name", target_prog),
                program_type="airline",
                ratio=info.get("ratio", 1.0),
                transfer_time=bank_meta.get("default_transfer_time", "varies"),
                portal_url=bank_meta.get("portal_url", ""),
                booking_url=prog_meta.get("booking_url", ""),
            ))
    
    return options


def build_transfer_instruction(
    bank: str,
    program: str,
    points_to_transfer: int,
    for_item: Optional[str] = None,
) -> TransferInstruction:
    """
    Build detailed transfer instructions.
    
    Args:
        bank: Source bank code
        program: Target airline program code
        points_to_transfer: Number of bank points to transfer
        for_item: Optional description of what this transfer is for
        
    Returns:
        TransferInstruction with step-by-step guide
    """
    bank_lower = bank.lower()
    prog_upper = program.upper()
    
    bank_meta = BANK_METADATA.get(bank_lower, {})
    prog_info = EXTENDED_TRANSFER_GRAPH.get(bank_lower, {}).get(prog_upper, {})
    prog_meta = PROGRAM_METADATA.get(prog_upper, {})
    
    ratio = prog_info.get("ratio", 1.0)
    resulting_points = int(points_to_transfer * ratio)
    
    ratio_str = f"1:{int(ratio)}" if ratio >= 1.0 else f"{int(1/ratio)}:1"
    
    bank_name = bank_meta.get("name", bank)
    prog_name = prog_info.get("name", prog_meta.get("name", program))
    portal_url = bank_meta.get("portal_url", "")
    booking_url = prog_meta.get("booking_url", "")
    transfer_time = bank_meta.get("default_transfer_time", "varies")
    
    # Build step-by-step instructions
    steps = [
        f"1. Log in to your {bank_name} account",
        f"2. Navigate to the rewards portal: {portal_url}",
        f"3. Select 'Transfer Points' or 'Transfer to Partners'",
        f"4. Find and select {prog_name}",
        f"5. Enter your {prog_name} membership number",
        f"6. Transfer {points_to_transfer:,} points ({ratio_str} ratio, {transfer_time})",
        f"7. You will receive {resulting_points:,} {prog_name} points",
    ]
    
    if booking_url:
        steps.append(f"8. Book your flight at {booking_url} using your {prog_name} points")
    
    if for_item:
        steps.append(f"9. Use points for: {for_item}")
    
    return TransferInstruction(
        from_program=bank_lower,
        from_program_name=bank_name,
        to_program=prog_upper,
        to_program_name=prog_name,
        points_to_transfer=points_to_transfer,
        transfer_ratio=ratio_str,
        resulting_points=resulting_points,
        transfer_time=transfer_time,
        portal_url=portal_url,
        booking_url=booking_url,
        steps=steps,
    )


def compute_effective_balance(
    available_points: Dict[str, int],
    target_program: str,
) -> Tuple[int, List[Tuple[str, int, float]]]:
    """
    Compute the effective points balance for a target airline program,
    including transferable bank points.
    
    Args:
        available_points: User's point balances
        target_program: Target airline program code
        
    Returns:
        Tuple of (total_effective_points, [(source, points, ratio), ...])
    """
    prog_upper = target_program.upper()
    sources = []
    total = 0
    
    # Direct balance in the program
    direct = available_points.get(prog_upper, 0) + available_points.get(prog_upper.lower(), 0)
    if direct > 0:
        sources.append((prog_upper, direct, 1.0))
        total += direct
    
    # Transferable from banks
    for bank, balance in available_points.items():
        if balance <= 0:
            continue
        bank_lower = bank.lower()
        if bank_lower not in EXTENDED_TRANSFER_GRAPH:
            continue
        
        if prog_upper in EXTENDED_TRANSFER_GRAPH[bank_lower]:
            ratio = EXTENDED_TRANSFER_GRAPH[bank_lower][prog_upper].get("ratio", 1.0)
            effective = int(balance * ratio)
            sources.append((bank_lower, balance, ratio))
            total += effective
    
    return total, sources


def get_best_transfer_source(
    available_points: Dict[str, int],
    target_program: str,
    points_needed: int,
) -> Optional[Tuple[str, int, float]]:
    """
    Find the best source to transfer points from for a target airline program.
    Prioritizes: 1) Direct balance, 2) Best ratio, 3) Sufficient balance
    
    Args:
        available_points: User's point balances
        target_program: Target airline program code
        points_needed: Points required in target program
        
    Returns:
        Tuple of (source_program, points_to_transfer, ratio) or None
    """
    prog_upper = target_program.upper()
    
    # Check direct balance first
    direct = available_points.get(prog_upper, 0) + available_points.get(prog_upper.lower(), 0)
    if direct >= points_needed:
        return (prog_upper, points_needed, 1.0)
    
    # Find best bank transfer option
    best_option = None
    best_ratio = 0.0
    
    for bank, balance in available_points.items():
        if balance <= 0:
            continue
        bank_lower = bank.lower()
        if bank_lower not in EXTENDED_TRANSFER_GRAPH:
            continue
        
        if prog_upper in EXTENDED_TRANSFER_GRAPH[bank_lower]:
            ratio = EXTENDED_TRANSFER_GRAPH[bank_lower][prog_upper].get("ratio", 1.0)
            points_from_bank = int(balance * ratio)
            
            if points_from_bank >= points_needed and ratio > best_ratio:
                # Calculate how many bank points we need to transfer
                bank_points_needed = int(points_needed / ratio) if ratio > 0 else points_needed
                if bank_points_needed <= balance:
                    best_option = (bank_lower, bank_points_needed, ratio)
                    best_ratio = ratio
    
    return best_option


# =============================================================================
# CREDIT CARD RECOMMENDATIONS (FLIGHTS ONLY)
# =============================================================================

# CREDIT_CARD_DETAILS is now imported from src.config.programs


def get_credit_card_recommendations(
    available_points: Dict[str, int],
    target_programs: List[str],
) -> List[Dict[str, Any]]:
    """
    Get credit card recommendations based on user's points and travel goals.
    
    Args:
        available_points: User's current point balances
        target_programs: Airline programs user wants to use
        
    Returns:
        List of card recommendations with reasons
    """
    recommendations = []
    
    for bank, balance in available_points.items():
        if balance <= 0:
            continue
        bank_lower = bank.lower()
        
        if bank_lower in CREDIT_CARD_DETAILS:
            details = CREDIT_CARD_DETAILS[bank_lower]
            
            # Check if any target programs are good transfers
            matching_transfers = [
                prog for prog in target_programs 
                if prog in details.get("best_transfers", [])
            ]
            
            if matching_transfers:
                recommendations.append({
                    "bank": bank_lower,
                    "balance": balance,
                    "cards": details["cards"],
                    "relevant_transfers": matching_transfers,
                    "sweet_spots": details["sweet_spots"],
                    "reason": f"You have {balance:,} points that transfer well to {', '.join(matching_transfers)}",
                })
    
    return recommendations


def get_transfer_timing_advice(
    bank: str,
    days_until_travel: int,
) -> Dict[str, Any]:
    """
    Get advice on transfer timing based on bank and travel date.
    
    Args:
        bank: Bank code
        days_until_travel: Days until departure
        
    Returns:
        Dict with timing advice and warnings
    """
    TRANSFER_TIMES = {
        "chase": {"typical_hours": 0, "display": "Instant", "safe_days": 0},
        "amex": {"typical_hours": 48, "display": "1-2 business days", "safe_days": 3},
        "citi": {"typical_hours": 24, "display": "Instant to 24 hours", "safe_days": 1},
        "capitalone": {"typical_hours": 48, "display": "Instant to 2 days", "safe_days": 3},
        "bilt": {"typical_hours": 0, "display": "Instant", "safe_days": 0},
    }
    
    bank_lower = bank.lower()
    timing = TRANSFER_TIMES.get(bank_lower, {"typical_hours": 72, "display": "Varies", "safe_days": 4})
    
    is_safe = days_until_travel >= timing["safe_days"]
    
    advice = {
        "transfer_time": timing["display"],
        "safe_days_needed": timing["safe_days"],
        "is_safe_to_transfer": is_safe,
        "recommendation": "",
        "warning": None,
    }
    
    if is_safe:
        advice["recommendation"] = f"Safe to transfer! {timing['display']} is sufficient for your {days_until_travel}-day timeline."
    else:
        advice["warning"] = (
            f"⚠️ Transfer may not complete in time! "
            f"{bank_lower.title()} transfers take {timing['display']}, "
            f"but you only have {days_until_travel} day(s) until travel."
        )
        advice["recommendation"] = (
            "Consider: (1) Booking with cash and transferring points later for refund, "
            "(2) Using a different bank with faster transfers, or "
            "(3) Waiting to book until transfers complete."
        )
    
    return advice


def generate_complete_transfer_plan(
    flight_awards: List[Dict[str, Any]],
    available_points: Dict[str, int],
    days_until_travel: int = 14,
) -> Dict[str, Any]:
    """
    Generate a complete transfer plan with step-by-step instructions for FLIGHTS ONLY.
    
    Args:
        flight_awards: List of flights to book with points
        available_points: User's point balances
        days_until_travel: Days until first flight
        
    Returns:
        Complete transfer plan with instructions, timing, and warnings
    """
    transfer_instructions = []
    booking_steps = []
    warnings = []
    total_out_of_pocket = 0.0
    
    # Consolidate transfer needs by (bank, program)
    transfer_needs: Dict[Tuple[str, str], int] = {}
    
    for award in flight_awards:
        program = award.get("program", "").upper()
        points_needed = award.get("points", 0)
        surcharge = award.get("surcharge", 0)
        
        total_out_of_pocket += surcharge
        
        # Find best transfer source
        source = get_best_transfer_source(available_points, program, points_needed)
        
        if source:
            src_program, src_points, ratio = source
            
            if src_program.lower() in EXTENDED_TRANSFER_GRAPH:
                # It's a bank transfer
                key = (src_program.lower(), program)
                transfer_needs[key] = transfer_needs.get(key, 0) + int(src_points)
    
    # Build transfer instructions
    step_num = 1
    for (bank, program), total_points in transfer_needs.items():
        instruction = build_transfer_instruction(bank, program, total_points)
        
        # Add timing advice
        timing = get_transfer_timing_advice(bank, days_until_travel)
        if timing.get("warning"):
            warnings.append(timing["warning"])
        
        transfer_instructions.append({
            "step": step_num,
            "instruction": instruction,
            "timing_advice": timing,
        })
        step_num += 1
    
    # Build booking steps
    for i, award in enumerate(flight_awards):
        booking_steps.append({
            "step": step_num + i,
            "type": "flight",
            "description": award.get("description", "Flight"),
            "points": award.get("points", 0),
            "surcharge": award.get("surcharge", 0),
            "program": award.get("program", ""),
            "booking_url": PROGRAM_METADATA.get(award.get("program", "").upper(), {}).get("booking_url", ""),
        })
    
    return {
        "transfer_instructions": transfer_instructions,
        "booking_steps": booking_steps,
        "total_out_of_pocket": total_out_of_pocket,
        "warnings": warnings,
        "credit_card_tips": get_credit_card_recommendations(
            available_points,
            list(set([a.get("program", "").upper() for a in flight_awards]))
        ),
    }


# =============================================================================
# POINTS STRATEGY COMPUTATION
# =============================================================================

def _get_display_name(program_key: str) -> str:
    """Get display name for a program key, handling various formats."""
    # Try exact match first
    if program_key in PROGRAM_DISPLAY_NAMES:
        return PROGRAM_DISPLAY_NAMES[program_key]
    # Try uppercase (airline codes)
    if program_key.upper() in PROGRAM_DISPLAY_NAMES:
        return PROGRAM_DISPLAY_NAMES[program_key.upper()]
    # Try lowercase (bank codes)
    if program_key.lower() in PROGRAM_DISPLAY_NAMES:
        return PROGRAM_DISPLAY_NAMES[program_key.lower()]
    # Check PROGRAM_METADATA
    meta = PROGRAM_METADATA.get(program_key.upper(), {})
    if meta.get("name"):
        return meta["name"]
    # Check BANK_METADATA
    bmeta = BANK_METADATA.get(program_key.lower(), {})
    if bmeta.get("name"):
        return bmeta["name"]
    return program_key


def compute_points_strategy(
    segments: List[Any],
    transfers: List[Any],
    available_points: Dict[str, int],
) -> Dict[str, Any]:
    """
    Compute a consolidated points strategy for an itinerary.

    Shows for each airline program used:
    - Existing direct balance the user has
    - Transfer amounts from each bank (additive)
    - Total effective balance
    - Which flights it covers

    Args:
        segments: List of flight segments (from RankedItinerary.segments)
        transfers: List of TransferInstruction objects (from RankedItinerary.transfers)
        available_points: User's original point balances {program: balance}

    Returns:
        Dict matching the PointsStrategy model structure.
    """
    from src.agents.models import PointsStrategy, AirlineProgramStrategy, PointsSource

    # 1. Collect points needs per airline program from segments
    # airline_program -> { points_needed, flights, surcharges }
    program_needs: Dict[str, Dict[str, Any]] = {}

    for seg in segments:
        payment = seg.payment if hasattr(seg, 'payment') else seg.get("payment", {})
        method = payment.method if hasattr(payment, 'method') else payment.get("method", "cash")

        if method != "points":
            continue

        program = (payment.program if hasattr(payment, 'program')
                   else payment.get("program", ""))
        points_used = (payment.points_used if hasattr(payment, 'points_used')
                       else payment.get("pointsUsed", 0))
        surcharge = (payment.surcharge if hasattr(payment, 'surcharge')
                     else payment.get("surcharge", 0))

        # Build flight description
        if hasattr(seg, 'origin'):
            origin = seg.origin
            dest = seg.destination
            airline = getattr(seg, 'airline', '')
        else:
            origin = seg.get("origin", "?")
            dest = seg.get("destination", "?")
            airline = seg.get("airline", "")

        flight_desc = f"{origin} → {dest}"
        if airline:
            flight_desc += f" ({airline})"

        prog_key = program.upper() if program else ""
        if not prog_key:
            continue

        if prog_key not in program_needs:
            program_needs[prog_key] = {
                "points_needed": 0,
                "flights": [],
                "surcharges": 0.0,
            }
        program_needs[prog_key]["points_needed"] += points_used
        program_needs[prog_key]["flights"].append(flight_desc)
        program_needs[prog_key]["surcharges"] += surcharge

    if not program_needs:
        return PointsStrategy().model_dump()

    # 2. Build sources for each airline program
    # First, index transfers by target program
    # transfer.to_program -> [(from_program, points_to_transfer, ratio, ...)]
    transfers_by_target: Dict[str, List[Any]] = {}
    for t in transfers:
        to_prog = (t.to_program if hasattr(t, 'to_program')
                   else t.get("toProgram", t.get("to_program", "")))
        is_direct = (t.is_direct if hasattr(t, 'is_direct')
                     else t.get("isDirect", t.get("is_direct", False)))
        if is_direct:
            continue  # Direct use is handled separately below
        to_key = to_prog.upper() if to_prog else ""
        if to_key not in transfers_by_target:
            transfers_by_target[to_key] = []
        transfers_by_target[to_key].append(t)

    programs: List[AirlineProgramStrategy] = []
    total_transfers_needed = 0
    total_points_transferred = 0
    total_airline_points_used = 0
    total_surcharges = 0.0
    action_steps: List[str] = []

    for prog_key, needs in program_needs.items():
        points_needed = needs["points_needed"]
        flights = needs["flights"]
        surcharges = needs["surcharges"]
        total_airline_points_used += points_needed
        total_surcharges += surcharges

        prog_display = _get_display_name(prog_key)
        booking_url = PROGRAM_METADATA.get(prog_key, {}).get("booking_url", "")

        sources: List[PointsSource] = []

        # a) Check for direct balance in this airline program
        direct_balance = 0
        for key, bal in available_points.items():
            if key.upper() == prog_key or key.lower() == prog_key.lower():
                direct_balance = bal
                break

        # b) Collect transfer sources from the itinerary's transfers
        transfer_entries = transfers_by_target.get(prog_key, [])
        total_transferred_in = 0

        for t in transfer_entries:
            from_prog = (t.from_program if hasattr(t, 'from_program')
                         else t.get("fromProgram", t.get("from_program", "")))
            pts = (t.points_to_transfer if hasattr(t, 'points_to_transfer')
                   else t.get("pointsToTransfer", t.get("points_to_transfer", 0)))
            ratio = (t.ratio if hasattr(t, 'ratio') else t.get("ratio", 1.0))
            time_str = (t.transfer_time if hasattr(t, 'transfer_time')
                        else t.get("transferTime", t.get("transfer_time", "")))
            portal = (t.portal_url if hasattr(t, 'portal_url')
                      else t.get("portalUrl", t.get("portal_url", "")))

            resulting = int(pts * ratio)
            total_transferred_in += resulting
            total_transfers_needed += 1
            total_points_transferred += pts

            from_display = _get_display_name(from_prog)

            sources.append(PointsSource(
                source_program=from_prog,
                source_program_display=from_display,
                points_from_source=pts,
                transfer_ratio=ratio,
                resulting_points=resulting,
                is_transfer=True,
                transfer_time=time_str,
                portal_url=portal,
            ))

            action_steps.append(
                f"Transfer {pts:,} {from_display} points to {prog_display} "
                f"(ratio {ratio}:1 → {resulting:,} {prog_display} points, {time_str})"
            )

        # c) If there's a direct balance and it's being used, add it as a source
        # The direct balance used = points_needed - total_transferred_in
        direct_used = max(0, points_needed - total_transferred_in)
        if direct_used > 0 and direct_balance > 0:
            actual_direct_used = min(direct_used, direct_balance)
            sources.insert(0, PointsSource(
                source_program=prog_key,
                source_program_display=prog_display,
                points_from_source=actual_direct_used,
                transfer_ratio=1.0,
                resulting_points=actual_direct_used,
                is_transfer=False,
            ))

        total_available = sum(s.resulting_points for s in sources)
        surplus = total_available - points_needed

        programs.append(AirlineProgramStrategy(
            airline_program=prog_key,
            airline_program_display=prog_display,
            points_needed=points_needed,
            sources=sources,
            total_points_available=total_available,
            surplus_points=surplus,
            covers_flights=flights,
            booking_url=booking_url,
        ))

        # Build booking action step
        flight_list = ", ".join(flights)
        action_steps.append(
            f"Book {flight_list} using {points_needed:,} {prog_display} points"
            + (f" + ${surcharges:,.0f} in taxes/fees" if surcharges > 0 else "")
        )

    strategy = PointsStrategy(
        programs=programs,
        total_transfers_needed=total_transfers_needed,
        total_points_transferred=total_points_transferred,
        total_airline_points_used=total_airline_points_used,
        total_surcharges=total_surcharges,
        action_summary=action_steps,
    )

    return strategy.model_dump()
