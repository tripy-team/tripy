#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Points Transfer Strategy Test Script

This standalone script demonstrates the points transfer strategy generation
without requiring the full backend. It simulates trip bookings and generates
optimal transfer instructions.

Usage:
    python test_transfer_strategy.py

Requirements:
    pip install pulp

Example output:
    Transfer 20k points from Amex to Delta for flight DL234
    Transfer 40k points from Chase to Hyatt for hotel in Seoul
"""

import json
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field, asdict

try:
    import pulp as pl
except ImportError:
    print("Error: pulp package required. Install with: pip install pulp")
    exit(1)


# =============================================================================
# TRANSFER GRAPH (Banks -> Airlines + Hotels)
# =============================================================================

EXTENDED_TRANSFER_GRAPH = {
    "amex": {
        # Airlines (Membership Rewards)
        "DL": {"ratio": 1.0, "type": "airline", "name": "Delta SkyMiles"},
        "B6": {"ratio": 1.0, "type": "airline", "name": "JetBlue TrueBlue"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France / KLM Flying Blue"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "CX": {"ratio": 1.0, "type": "airline", "name": "Cathay Pacific Asia Miles"},
        "NH": {"ratio": 1.0, "type": "airline", "name": "ANA Mileage Club"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "EY": {"ratio": 1.0, "type": "airline", "name": "Etihad Guest"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "QF": {"ratio": 1.0, "type": "airline", "name": "Qantas Frequent Flyer"},
        "AV": {"ratio": 1.0, "type": "airline", "name": "Avianca LifeMiles"},
        "IB": {"ratio": 1.0, "type": "airline", "name": "Iberia Plus"},
        "AS": {"ratio": 1.0, "type": "airline", "name": "Alaska Mileage Plan"},
        # Hotels
        "HH": {"ratio": 2.0, "type": "hotel", "name": "Hilton Honors"},  # 1 MR = 2 Hilton
        "MAR": {"ratio": 1.0, "type": "hotel", "name": "Marriott Bonvoy"},
    },
    "chase": {
        # Airlines (Ultimate Rewards)
        "UA": {"ratio": 1.0, "type": "airline", "name": "United MileagePlus"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France / KLM Flying Blue"},
        "IB": {"ratio": 1.0, "type": "airline", "name": "Iberia Plus"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "EI": {"ratio": 1.0, "type": "airline", "name": "Aer Lingus AerClub"},
        "WN": {"ratio": 1.0, "type": "airline", "name": "Southwest Rapid Rewards"},
        "AS": {"ratio": 1.0, "type": "airline", "name": "Alaska Mileage Plan"},
        # Hotels
        "HYATT": {"ratio": 1.0, "type": "hotel", "name": "World of Hyatt"},
        "MAR": {"ratio": 1.0, "type": "hotel", "name": "Marriott Bonvoy"},
        "IHG": {"ratio": 1.0, "type": "hotel", "name": "IHG One Rewards"},
    },
    "citi": {
        # Airlines (ThankYou Points)
        "AA": {"ratio": 1.0, "type": "airline", "name": "American AAdvantage"},
        "B6": {"ratio": 1.0, "type": "airline", "name": "JetBlue TrueBlue"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "CX": {"ratio": 1.0, "type": "airline", "name": "Cathay Pacific Asia Miles"},
        "QR": {"ratio": 1.0, "type": "airline", "name": "Qatar Airways Privilege Club"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "EY": {"ratio": 1.0, "type": "airline", "name": "Etihad Guest"},
        "TK": {"ratio": 1.0, "type": "airline", "name": "Turkish Miles&Smiles"},
        "AV": {"ratio": 1.0, "type": "airline", "name": "Avianca LifeMiles"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "QF": {"ratio": 1.0, "type": "airline", "name": "Qantas Frequent Flyer"},
        "AC": {"ratio": 1.0, "type": "airline", "name": "Air Canada Aeroplan"},
        # Hotels
        "ACC": {"ratio": 2.0, "type": "hotel", "name": "Accor Live Limitless"},
        "WYNDHAM": {"ratio": 1.0, "type": "hotel", "name": "Wyndham Rewards"},
    },
    "capitalone": {
        # Airlines
        "AC": {"ratio": 1.0, "type": "airline", "name": "Air Canada Aeroplan"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France / KLM Flying Blue"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "EY": {"ratio": 1.0, "type": "airline", "name": "Etihad Guest"},
        "AY": {"ratio": 1.0, "type": "airline", "name": "Finnair Plus"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "TK": {"ratio": 1.0, "type": "airline", "name": "Turkish Miles&Smiles"},
        "AV": {"ratio": 1.0, "type": "airline", "name": "Avianca LifeMiles"},
        # Hotels
        "ACC": {"ratio": 1.0, "type": "hotel", "name": "Accor Live Limitless"},
        "WYNDHAM": {"ratio": 1.0, "type": "hotel", "name": "Wyndham Rewards"},
    },
    "bilt": {
        # Airlines
        "UA": {"ratio": 1.0, "type": "airline", "name": "United MileagePlus"},
        "AA": {"ratio": 1.0, "type": "airline", "name": "American AAdvantage"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France / KLM Flying Blue"},
        "TK": {"ratio": 1.0, "type": "airline", "name": "Turkish Miles&Smiles"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "EI": {"ratio": 1.0, "type": "airline", "name": "Aer Lingus AerClub"},
        "AC": {"ratio": 1.0, "type": "airline", "name": "Air Canada Aeroplan"},
        # Hotels
        "HYATT": {"ratio": 1.0, "type": "hotel", "name": "World of Hyatt"},
        "IHG": {"ratio": 1.0, "type": "hotel", "name": "IHG One Rewards"},
        "MAR": {"ratio": 1.0, "type": "hotel", "name": "Marriott Bonvoy"},
    },
}

BANK_METADATA = {
    "amex": {
        "name": "American Express Membership Rewards",
        "portal_url": "https://global.americanexpress.com/rewards",
        "default_transfer_time": "1-2 business days",
    },
    "chase": {
        "name": "Chase Ultimate Rewards",
        "portal_url": "https://ultimaterewardspoints.chase.com",
        "default_transfer_time": "instant",
    },
    "citi": {
        "name": "Citi ThankYou Points",
        "portal_url": "https://thankyou.citi.com",
        "default_transfer_time": "instant to 24 hours",
    },
    "capitalone": {
        "name": "Capital One Miles",
        "portal_url": "https://www.capitalone.com/credit-cards/benefits/travel/",
        "default_transfer_time": "instant to 2 days",
    },
    "bilt": {
        "name": "Bilt Rewards",
        "portal_url": "https://www.biltrewards.com",
        "default_transfer_time": "instant",
    },
}

PROGRAM_METADATA = {
    # Airlines
    "UA": {"name": "United MileagePlus", "type": "airline", "booking_url": "https://www.united.com"},
    "AA": {"name": "American AAdvantage", "type": "airline", "booking_url": "https://www.aa.com"},
    "DL": {"name": "Delta SkyMiles", "type": "airline", "booking_url": "https://www.delta.com"},
    "WN": {"name": "Southwest Rapid Rewards", "type": "airline", "booking_url": "https://www.southwest.com"},
    "B6": {"name": "JetBlue TrueBlue", "type": "airline", "booking_url": "https://www.jetblue.com"},
    "AS": {"name": "Alaska Mileage Plan", "type": "airline", "booking_url": "https://www.alaskaair.com"},
    "AF": {"name": "Air France / KLM Flying Blue", "type": "airline", "booking_url": "https://www.airfrance.com"},
    "BA": {"name": "British Airways Avios", "type": "airline", "booking_url": "https://www.britishairways.com"},
    "SQ": {"name": "Singapore KrisFlyer", "type": "airline", "booking_url": "https://www.singaporeair.com"},
    "CX": {"name": "Cathay Pacific Asia Miles", "type": "airline", "booking_url": "https://www.cathaypacific.com"},
    "NH": {"name": "ANA Mileage Club", "type": "airline", "booking_url": "https://www.ana.co.jp"},
    "JL": {"name": "JAL Mileage Bank", "type": "airline", "booking_url": "https://www.jal.co.jp"},
    "EK": {"name": "Emirates Skywards", "type": "airline", "booking_url": "https://www.emirates.com"},
    "QR": {"name": "Qatar Airways Privilege Club", "type": "airline", "booking_url": "https://www.qatarairways.com"},
    "EY": {"name": "Etihad Guest", "type": "airline", "booking_url": "https://www.etihad.com"},
    "TK": {"name": "Turkish Miles&Smiles", "type": "airline", "booking_url": "https://www.turkishairlines.com"},
    "AV": {"name": "Avianca LifeMiles", "type": "airline", "booking_url": "https://www.lifemiles.com"},
    "IB": {"name": "Iberia Plus", "type": "airline", "booking_url": "https://www.iberia.com"},
    "QF": {"name": "Qantas Frequent Flyer", "type": "airline", "booking_url": "https://www.qantas.com"},
    "VS": {"name": "Virgin Atlantic Flying Club", "type": "airline", "booking_url": "https://www.virginatlantic.com"},
    "AC": {"name": "Air Canada Aeroplan", "type": "airline", "booking_url": "https://www.aircanada.com"},
    # Hotels
    "HH": {"name": "Hilton Honors", "type": "hotel", "booking_url": "https://www.hilton.com"},
    "MAR": {"name": "Marriott Bonvoy", "type": "hotel", "booking_url": "https://www.marriott.com"},
    "HYATT": {"name": "World of Hyatt", "type": "hotel", "booking_url": "https://www.hyatt.com"},
    "IHG": {"name": "IHG One Rewards", "type": "hotel", "booking_url": "https://www.ihg.com"},
    "ACC": {"name": "Accor Live Limitless", "type": "hotel", "booking_url": "https://all.accor.com"},
    "WYNDHAM": {"name": "Wyndham Rewards", "type": "hotel", "booking_url": "https://www.wyndhamhotels.com"},
}


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class PointsOption:
    """A way to pay for an item using points."""
    program_code: str
    program_type: str  # "airline" or "hotel"
    points_required: int
    surcharge: float


@dataclass
class TripCostItem:
    """Represents a single bookable item (flight segment or hotel stay)."""
    item_id: str
    item_type: str  # "flight" or "hotel"
    description: str
    cash_cost: float
    points_options: List[PointsOption] = field(default_factory=list)
    
    # Optional metadata
    flight_number: Optional[str] = None
    airline: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    date: Optional[str] = None
    hotel_name: Optional[str] = None
    location: Optional[str] = None
    nights: Optional[int] = None


@dataclass
class TransferInstruction:
    """Instructions for transferring points from bank to program."""
    from_bank: str
    from_bank_name: str
    to_program: str
    to_program_name: str
    points_to_transfer: int
    transfer_ratio: str
    resulting_points: int
    transfer_time: str
    portal_url: str
    booking_url: str
    for_items: List[str] = field(default_factory=list)
    steps: List[str] = field(default_factory=list)


@dataclass
class PaymentInstruction:
    """How to pay for a specific item."""
    item_id: str
    item_type: str
    description: str
    payment_type: str  # "cash" or "points"
    cash_paid: float
    points_used: Optional[int] = None
    program_used: Optional[str] = None
    program_name: Optional[str] = None


@dataclass
class OptimizationResult:
    """Complete solution for minimizing out-of-pocket costs."""
    status: str
    payment_plan: List[PaymentInstruction] = field(default_factory=list)
    transfer_plan: List[TransferInstruction] = field(default_factory=list)
    total_out_of_pocket: float = 0.0
    total_points_used: int = 0
    points_breakdown: Dict[str, int] = field(default_factory=dict)
    all_cash_cost: float = 0.0
    savings: float = 0.0
    savings_percentage: float = 0.0
    points_remaining: Dict[str, int] = field(default_factory=dict)


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_program_name(code):
    """Get display name for a program."""
    return PROGRAM_METADATA.get(code.upper(), {}).get("name", code)


def get_bank_name(bank):
    """Get display name for a bank."""
    return BANK_METADATA.get(bank.lower(), {}).get("name", bank.upper())


# =============================================================================
# ILP OPTIMIZER
# =============================================================================

def minimize_out_of_pocket(items, available_points):
    """
    Solve ILP to minimize total out-of-pocket cost.
    
    Args:
        items: All bookable items (flights + hotels)
        available_points: User's point balances by program code
        
    Returns:
        OptimizationResult with optimal payment and transfer plan
    """
    if not items:
        return OptimizationResult(status="Optimal", all_cash_cost=0.0)
    
    transfer_graph = EXTENDED_TRANSFER_GRAPH
    
    # Normalize available_points keys
    points = {}
    for k, v in available_points.items():
        if v and v > 0:
            key = k.lower() if k.lower() in transfer_graph else k.upper()
            points[key] = int(v)
    
    # Calculate all-cash cost
    all_cash_cost = sum(item.cash_cost for item in items)
    
    # Identify banks
    banks = [k for k in points.keys() if k.lower() in transfer_graph]
    
    # Collect all programs needed
    programs_needed = set()
    for item in items:
        for opt in item.points_options:
            programs_needed.add(opt.program_code.upper())
    
    # Build optimization model
    m = pl.LpProblem("MinimizeOutOfPocket", pl.LpMinimize)
    
    # Decision Variables
    pay_cash = {
        item.item_id: pl.LpVariable(f"cash_{item.item_id}", cat="Binary")
        for item in items
    }
    
    use_points = {}
    for item in items:
        for opt in item.points_options:
            key = (item.item_id, opt.program_code.upper())
            use_points[key] = pl.LpVariable(f"pts_{item.item_id}_{opt.program_code}", cat="Binary")
    
    transfer = {}
    for bank in banks:
        bank_lower = bank.lower()
        if bank_lower not in transfer_graph:
            continue
        for prog in programs_needed:
            if prog in transfer_graph[bank_lower]:
                transfer[(bank, prog)] = pl.LpVariable(
                    f"xfer_{bank}_{prog}", 
                    lowBound=0, 
                    cat="Integer"
                )
    
    # Objective: Minimize OOP
    EPSILON = 0.0001  # Tiny preference for points
    
    cash_component = pl.lpSum(
        pay_cash[item.item_id] * item.cash_cost
        for item in items
    )
    
    surcharge_component = pl.lpSum(
        use_points[(item.item_id, opt.program_code.upper())] * opt.surcharge
        for item in items
        for opt in item.points_options
        if (item.item_id, opt.program_code.upper()) in use_points
    )
    
    points_bonus = pl.lpSum(
        use_points[(item.item_id, opt.program_code.upper())] * EPSILON
        for item in items
        for opt in item.points_options
        if (item.item_id, opt.program_code.upper()) in use_points
    )
    
    m += cash_component + surcharge_component - points_bonus
    
    # Constraints
    
    # 1. Each item must be paid exactly once
    for item in items:
        item_options = [pay_cash[item.item_id]]
        for opt in item.points_options:
            key = (item.item_id, opt.program_code.upper())
            if key in use_points:
                item_options.append(use_points[key])
        m += pl.lpSum(item_options) == 1, f"pay_once_{item.item_id}"
    
    # 2. Points balance constraints
    for prog in programs_needed:
        points_used = pl.lpSum(
            use_points[(item.item_id, prog)] * opt.points_required
            for item in items
            for opt in item.points_options
            if opt.program_code.upper() == prog and (item.item_id, prog) in use_points
        )
        
        direct_balance = points.get(prog, 0) + points.get(prog.lower(), 0)
        
        transferred_in = pl.lpSum(
            transfer[(bank, prog)] * transfer_graph[bank.lower()][prog].get("ratio", 1.0)
            for bank in banks
            if bank.lower() in transfer_graph and prog in transfer_graph[bank.lower()]
            and (bank, prog) in transfer
        )
        
        m += points_used <= direct_balance + transferred_in, f"balance_{prog}"
    
    # 3. Transfer constraints: can't transfer more than bank balance
    for bank in banks:
        bank_lower = bank.lower()
        if bank_lower not in transfer_graph:
            continue
        
        total_transferred = pl.lpSum(
            transfer[(bank, prog)]
            for prog in programs_needed
            if (bank, prog) in transfer
        )
        
        m += total_transferred <= points.get(bank, 0), f"bank_limit_{bank}"
    
    # Solve
    solver = pl.PULP_CBC_CMD(msg=False, timeLimit=30)
    m.solve(solver)
    
    status = pl.LpStatus[m.status]
    
    if status != "Optimal":
        # Return fallback solution (all cash)
        return OptimizationResult(
            status=status,
            payment_plan=[
                PaymentInstruction(
                    item_id=item.item_id,
                    item_type=item.item_type,
                    description=item.description,
                    payment_type="cash",
                    cash_paid=item.cash_cost,
                )
                for item in items
            ],
            total_out_of_pocket=all_cash_cost,
            all_cash_cost=all_cash_cost,
            savings=0.0,
            points_remaining=dict(points),
        )
    
    # Extract Solution
    return _extract_solution(
        items=items,
        available_points=points,
        transfer_graph=transfer_graph,
        pay_cash=pay_cash,
        use_points=use_points,
        transfer=transfer,
        all_cash_cost=all_cash_cost,
    )


def _extract_solution(items, available_points, transfer_graph, pay_cash, use_points, transfer, all_cash_cost):
    """Extract solution from solved ILP model."""
    
    payment_plan = []
    transfer_totals = {}
    program_points_used = {}
    total_oop = 0.0
    total_points = 0
    
    # Extract payments
    for item in items:
        if pl.value(pay_cash[item.item_id]) > 0.5:
            payment_plan.append(PaymentInstruction(
                item_id=item.item_id,
                item_type=item.item_type,
                description=item.description,
                payment_type="cash",
                cash_paid=item.cash_cost,
            ))
            total_oop += item.cash_cost
            continue
        
        for opt in item.points_options:
            key = (item.item_id, opt.program_code.upper())
            if key in use_points and pl.value(use_points[key]) > 0.5:
                prog = opt.program_code.upper()
                
                payment_plan.append(PaymentInstruction(
                    item_id=item.item_id,
                    item_type=item.item_type,
                    description=item.description,
                    payment_type="points",
                    cash_paid=opt.surcharge,
                    points_used=opt.points_required,
                    program_used=prog,
                    program_name=get_program_name(prog),
                ))
                
                total_oop += opt.surcharge
                total_points += opt.points_required
                program_points_used[prog] = program_points_used.get(prog, 0) + opt.points_required
                break
    
    # Extract transfers
    transfer_plan = []
    for (bank, prog), var in transfer.items():
        xfer_amount = int(round(pl.value(var) or 0))
        if xfer_amount > 0:
            transfer_totals[(bank, prog)] = xfer_amount
            
            bank_meta = BANK_METADATA.get(bank.lower(), {})
            prog_info = transfer_graph.get(bank.lower(), {}).get(prog, {})
            prog_meta = PROGRAM_METADATA.get(prog, {})
            
            ratio = prog_info.get("ratio", 1.0)
            ratio_str = "1:{}".format(int(ratio)) if ratio >= 1.0 else "{}:1".format(int(1/ratio))
            resulting = int(xfer_amount * ratio)
            
            # Find items this transfer is for
            for_items = [
                p.description for p in payment_plan
                if p.program_used == prog
            ]
            
            transfer_plan.append(TransferInstruction(
                from_bank=bank.lower(),
                from_bank_name=bank_meta.get("name", bank),
                to_program=prog,
                to_program_name=prog_info.get("name", prog_meta.get("name", prog)),
                points_to_transfer=xfer_amount,
                transfer_ratio=ratio_str,
                resulting_points=resulting,
                transfer_time=bank_meta.get("default_transfer_time", "varies"),
                portal_url=bank_meta.get("portal_url", ""),
                booking_url=prog_meta.get("booking_url", ""),
                for_items=for_items,
                steps=_build_transfer_steps(bank, prog, xfer_amount, transfer_graph),
            ))
    
    # Calculate remaining points
    points_remaining = dict(available_points)
    for (bank, prog), amount in transfer_totals.items():
        if bank in points_remaining:
            points_remaining[bank] = max(0, points_remaining[bank] - amount)
    
    savings = all_cash_cost - total_oop
    savings_pct = (savings / all_cash_cost * 100) if all_cash_cost > 0 else 0.0
    
    return OptimizationResult(
        status="Optimal",
        payment_plan=payment_plan,
        transfer_plan=transfer_plan,
        total_out_of_pocket=round(total_oop, 2),
        total_points_used=total_points,
        points_breakdown=program_points_used,
        all_cash_cost=round(all_cash_cost, 2),
        savings=round(savings, 2),
        savings_percentage=round(savings_pct, 1),
        points_remaining=points_remaining,
    )


def _build_transfer_steps(bank, program, points, transfer_graph):
    """Build human-readable transfer steps."""
    bank_meta = BANK_METADATA.get(bank.lower(), {})
    prog_info = transfer_graph.get(bank.lower(), {}).get(program, {})
    prog_meta = PROGRAM_METADATA.get(program, {})
    
    bank_name = bank_meta.get("name", bank)
    prog_name = prog_info.get("name", prog_meta.get("name", program))
    portal_url = bank_meta.get("portal_url", "your rewards portal")
    booking_url = prog_meta.get("booking_url", "the program website")
    
    ratio = prog_info.get("ratio", 1.0)
    ratio_str = "1:{}".format(int(ratio)) if ratio >= 1.0 else "{}:1".format(int(1/ratio))
    resulting = int(points * ratio)
    transfer_time = bank_meta.get("default_transfer_time", "varies")
    
    return [
        "1. Log in to {}".format(bank_name),
        "2. Go to {}".format(portal_url),
        "3. Select 'Transfer Points' -> {}".format(prog_name),
        "4. Enter your {} member number".format(prog_name),
        "5. Transfer {:,} points ({}, {})".format(points, ratio_str, transfer_time),
        "6. Receive {:,} {} points".format(resulting, prog_name),
        "7. Book at {}".format(booking_url),
    ]


# =============================================================================
# PRETTY PRINT OUTPUT
# =============================================================================

def print_divider(char="=", width=75):
    print(char * width)


def print_header(title, width=75):
    print_divider()
    padding = (width - len(title) - 2) // 2
    print("{}  {}  {}".format(" " * padding, title, " " * padding))
    print_divider()


def print_result(result):
    """Print the optimization result in a beautiful format."""
    
    print("\n")
    print_header("YOUR OPTIMIZED TRIP PAYMENT STRATEGY")
    
    # Summary
    print("""
TOTAL OUT-OF-POCKET: ${:,.2f}
vs. All Cash:        ${:,.2f}
YOU SAVE:            ${:,.2f} ({:.1f}%)
Total Points Used:   {:,}
""".format(
        result.total_out_of_pocket,
        result.all_cash_cost,
        result.savings,
        result.savings_percentage,
        result.total_points_used
    ))
    
    # Transfer Instructions
    if result.transfer_plan:
        print_divider("-")
        print("          STEP 1: TRANSFER YOUR POINTS")
        print_divider("-")
        print()
        
        for i, transfer in enumerate(result.transfer_plan, 1):
            print("  {}. {}".format(i, transfer.from_bank_name))
            print("     -> {}".format(transfer.to_program_name))
            print("     Transfer: {:,} points ({})".format(transfer.points_to_transfer, transfer.transfer_ratio))
            print("     Receive:  {:,} {} points".format(transfer.resulting_points, transfer.to_program_name))
            print("     Time:     {}".format(transfer.transfer_time))
            print("     For:      {}".format(", ".join(transfer.for_items) if transfer.for_items else "Trip bookings"))
            print()
            
            print("     Instructions:")
            for step in transfer.steps:
                print("       {}".format(step))
            print()
    
    # Booking Instructions
    print_divider("-")
    print("          STEP 2: BOOK YOUR TRIP")
    print_divider("-")
    print()
    
    for payment in result.payment_plan:
        if payment.item_type == "flight":
            emoji = "[FLIGHT]"
        else:
            emoji = "[HOTEL]"
        
        if payment.payment_type == "points":
            print("  {} {}".format(emoji, payment.description))
            print("     Pay: {:,} {} points + ${:.2f} taxes".format(
                payment.points_used, payment.program_name, payment.cash_paid))
            booking_url = PROGRAM_METADATA.get(payment.program_used, {}).get("booking_url", "")
            if booking_url:
                print("     Book at: {}".format(booking_url))
        else:
            print("  [CASH] {}".format(payment.description))
            print("     Pay: ${:.2f} cash".format(payment.cash_paid))
        print()
    
    # Points Remaining
    print_divider("-")
    print("          REMAINING POINTS")
    print_divider("-")
    print()
    
    for prog, balance in result.points_remaining.items():
        if balance > 0:
            name = get_bank_name(prog) if prog.lower() in BANK_METADATA else get_program_name(prog)
            print("  * {}: {:,} points".format(name, balance))
    
    print()
    print_divider()


# =============================================================================
# SAMPLE TRIPS
# =============================================================================

def create_sample_trip_1():
    """Sample Trip: NYC -> Seoul -> NYC with hotels"""
    print("\n[TRIP] SAMPLE TRIP 1: NYC -> Seoul Round Trip with Hotels")
    print("   Dates: March 15-25, 2026")
    print("   Duration: 10 days")
    
    items = [
        TripCostItem(
            item_id="flight_jfk_icn_outbound",
            item_type="flight",
            description="JFK -> ICN on Korean Air KE86 (Business)",
            flight_number="KE86",
            airline="KE",
            origin="JFK",
            destination="ICN",
            date="2026-03-15",
            cash_cost=4500.00,
            points_options=[
                PointsOption(program_code="DL", program_type="airline", points_required=120000, surcharge=80.00),
            ],
        ),
        TripCostItem(
            item_id="flight_icn_jfk_return",
            item_type="flight",
            description="ICN -> JFK on Delta DL158 (Business)",
            flight_number="DL158",
            airline="DL",
            origin="ICN",
            destination="JFK",
            date="2026-03-25",
            cash_cost=4200.00,
            points_options=[
                PointsOption(program_code="DL", program_type="airline", points_required=110000, surcharge=75.00),
                PointsOption(program_code="VS", program_type="airline", points_required=90000, surcharge=180.00),
            ],
        ),
        TripCostItem(
            item_id="hotel_seoul_grand_hyatt",
            item_type="hotel",
            description="Grand Hyatt Seoul - 9 nights",
            hotel_name="Grand Hyatt Seoul",
            location="Seoul, South Korea",
            nights=9,
            cash_cost=2700.00,
            points_options=[
                PointsOption(program_code="HYATT", program_type="hotel", points_required=180000, surcharge=45.00),
            ],
        ),
    ]
    
    available_points = {
        "chase": 150000,
        "amex": 200000,
        "DL": 50000,  # Existing Delta miles
    }
    
    return items, available_points


def create_sample_trip_2():
    """Sample Trip: Multi-city Europe"""
    print("\n[TRIP] SAMPLE TRIP 2: European Adventure (Paris -> Rome -> Barcelona)")
    print("   Dates: June 1-15, 2026")
    print("   Duration: 14 days")
    
    items = [
        TripCostItem(
            item_id="flight_jfk_cdg",
            item_type="flight",
            description="JFK -> CDG on Air France AF007",
            flight_number="AF007",
            airline="AF",
            origin="JFK",
            destination="CDG",
            date="2026-06-01",
            cash_cost=850.00,
            points_options=[
                PointsOption(program_code="AF", program_type="airline", points_required=55000, surcharge=120.00),
                PointsOption(program_code="DL", program_type="airline", points_required=80000, surcharge=45.00),
            ],
        ),
        TripCostItem(
            item_id="hotel_paris_hilton",
            item_type="hotel",
            description="Hilton Paris Opera - 4 nights",
            hotel_name="Hilton Paris Opera",
            location="Paris, France",
            nights=4,
            cash_cost=1200.00,
            points_options=[
                PointsOption(program_code="HH", program_type="hotel", points_required=320000, surcharge=40.00),
            ],
        ),
        TripCostItem(
            item_id="flight_cdg_fco",
            item_type="flight",
            description="CDG -> FCO on ITA Airways AZ339",
            flight_number="AZ339",
            airline="AZ",
            origin="CDG",
            destination="FCO",
            date="2026-06-05",
            cash_cost=180.00,
            points_options=[
                # No good points option - pay cash
            ],
        ),
        TripCostItem(
            item_id="hotel_rome_westin",
            item_type="hotel",
            description="The Westin Excelsior Rome - 4 nights",
            hotel_name="The Westin Excelsior Rome",
            location="Rome, Italy",
            nights=4,
            cash_cost=1400.00,
            points_options=[
                PointsOption(program_code="MAR", program_type="hotel", points_required=200000, surcharge=35.00),
            ],
        ),
        TripCostItem(
            item_id="flight_fco_bcn",
            item_type="flight",
            description="FCO -> BCN on Iberia IB3260",
            flight_number="IB3260",
            airline="IB",
            origin="FCO",
            destination="BCN",
            date="2026-06-09",
            cash_cost=120.00,
            points_options=[
                PointsOption(program_code="IB", program_type="airline", points_required=10000, surcharge=25.00),
            ],
        ),
        TripCostItem(
            item_id="hotel_barcelona_hyatt",
            item_type="hotel",
            description="Hyatt Regency Barcelona Tower - 5 nights",
            hotel_name="Hyatt Regency Barcelona Tower",
            location="Barcelona, Spain",
            nights=5,
            cash_cost=900.00,
            points_options=[
                PointsOption(program_code="HYATT", program_type="hotel", points_required=100000, surcharge=30.00),
            ],
        ),
        TripCostItem(
            item_id="flight_bcn_jfk",
            item_type="flight",
            description="BCN -> JFK on United UA63",
            flight_number="UA63",
            airline="UA",
            origin="BCN",
            destination="JFK",
            date="2026-06-14",
            cash_cost=780.00,
            points_options=[
                PointsOption(program_code="UA", program_type="airline", points_required=60000, surcharge=45.00),
            ],
        ),
    ]
    
    available_points = {
        "chase": 200000,
        "amex": 180000,
        "bilt": 50000,
    }
    
    return items, available_points


def create_sample_trip_3():
    """Sample Trip: Simple domestic round trip"""
    print("\n[TRIP] SAMPLE TRIP 3: Quick LA Getaway")
    print("   Dates: Feb 14-17, 2026")
    print("   Duration: 3 days")
    
    items = [
        TripCostItem(
            item_id="flight_sfo_lax",
            item_type="flight",
            description="SFO -> LAX on United UA234",
            flight_number="UA234",
            airline="UA",
            origin="SFO",
            destination="LAX",
            date="2026-02-14",
            cash_cost=180.00,
            points_options=[
                PointsOption(program_code="UA", program_type="airline", points_required=12500, surcharge=5.60),
            ],
        ),
        TripCostItem(
            item_id="hotel_la_ihg",
            item_type="hotel",
            description="InterContinental Los Angeles Downtown - 3 nights",
            hotel_name="InterContinental Los Angeles Downtown",
            location="Los Angeles, CA",
            nights=3,
            cash_cost=750.00,
            points_options=[
                PointsOption(program_code="IHG", program_type="hotel", points_required=120000, surcharge=25.00),
            ],
        ),
        TripCostItem(
            item_id="flight_lax_sfo",
            item_type="flight",
            description="LAX -> SFO on JetBlue B6789",
            flight_number="B6789",
            airline="B6",
            origin="LAX",
            destination="SFO",
            date="2026-02-17",
            cash_cost=150.00,
            points_options=[
                PointsOption(program_code="B6", program_type="airline", points_required=10000, surcharge=5.60),
            ],
        ),
    ]
    
    available_points = {
        "chase": 50000,
        "amex": 30000,
    }
    
    return items, available_points


# =============================================================================
# MAIN
# =============================================================================

def run_test(items, available_points):
    """Run optimization test and print results."""
    
    print("\n[POINTS] Available Points:")
    for prog, balance in available_points.items():
        name = get_bank_name(prog) if prog.lower() in BANK_METADATA else get_program_name(prog)
        print("   * {}: {:,}".format(name, balance))
    
    print("\n[OPTIMIZE] Running optimization...")
    result = minimize_out_of_pocket(items, available_points)
    
    print_result(result)
    
    return result


def main():
    print("=" * 75)
    print("     TRIPY POINTS TRANSFER STRATEGY TEST SCRIPT")
    print("     Generates optimal point transfer strategies without backend")
    print("=" * 75)
    
    # Run all sample trips
    print("\n" + "=" * 75)
    print("     TEST 1: Seoul Trip")
    print("=" * 75)
    items, points = create_sample_trip_1()
    run_test(items, points)
    
    print("\n" + "=" * 75)
    print("     TEST 2: European Adventure")
    print("=" * 75)
    items, points = create_sample_trip_2()
    run_test(items, points)
    
    print("\n" + "=" * 75)
    print("     TEST 3: Quick LA Getaway")
    print("=" * 75)
    items, points = create_sample_trip_3()
    run_test(items, points)
    
    # Summary
    print("\n" + "=" * 75)
    print("     ALL TESTS COMPLETE")
    print("=" * 75)
    print("""
Tips for using this script:

1. Edit create_sample_trip_X() functions to test your own scenarios
2. Add new TripCostItem entries for flights and hotels
3. Set points_options to available award redemptions
4. Run: python test_transfer_strategy.py

The optimizer will:
- Find the minimum out-of-pocket cost
- Determine which points to transfer from which bank
- Generate step-by-step transfer instructions
- Show booking instructions for each segment
""")


if __name__ == "__main__":
    main()
