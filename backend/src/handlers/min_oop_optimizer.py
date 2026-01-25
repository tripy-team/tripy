"""
Minimum Out-of-Pocket Optimizer

ILP solver that minimizes total cash paid (out-of-pocket) for a trip,
rather than maximizing cents-per-point (CPP) value.

Key difference from points_maximizer.py:
- Objective: Minimize cash paid (including surcharges)
- No CPP threshold: Uses points whenever it reduces out-of-pocket
- Joint optimization: Flights + Hotels together
- Explicit transfer decisions: Tracks bank → program transfers
"""

from typing import Dict, List, Optional, Set, Tuple, Any, Literal
from dataclasses import dataclass, field, asdict
import logging

try:
    import pulp as pl
except ModuleNotFoundError:
    pl = None

from .transfer_strategy import (
    EXTENDED_TRANSFER_GRAPH,
    BANK_METADATA,
    PROGRAM_METADATA,
    build_transfer_instruction,
    is_bank_program,
    get_program_name,
    get_bank_name,
)

logger = logging.getLogger(__name__)


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class PointsOption:
    """A way to pay for an item using points."""
    program_code: str           # "UA", "HH", "HYATT", etc.
    program_type: str           # "airline" or "hotel"
    points_required: int
    surcharge: float            # Cash still required (taxes/fees)
    
    # Optional: Transfer info if points come from bank
    transfer_from: Optional[str] = None  # "amex", "chase", etc.
    transfer_ratio: float = 1.0


@dataclass
class TripCostItem:
    """Represents a single bookable item (flight segment or hotel stay)."""
    item_id: str
    item_type: str  # "flight" or "hotel"
    description: str  # Human-readable description
    
    # Cash payment option
    cash_cost: float
    
    # Points payment options (can have multiple programs)
    points_options: List[PointsOption] = field(default_factory=list)
    
    # Metadata
    origin: Optional[str] = None      # For flights
    destination: Optional[str] = None # For flights
    date: Optional[str] = None
    nights: Optional[int] = None      # For hotels
    hotel_name: Optional[str] = None  # For hotels


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
    transfer_from: Optional[str] = None
    transfer_from_name: Optional[str] = None


@dataclass
class TransferInstruction:
    """Instructions for transferring points from bank to program."""
    from_program: str
    from_program_name: str
    to_program: str
    to_program_name: str
    points_to_transfer: int
    transfer_ratio: str  # "1:1" or "1:2"
    resulting_points: int
    transfer_time: str
    portal_url: str
    booking_url: str
    for_items: List[str] = field(default_factory=list)  # What items this transfer covers
    steps: List[str] = field(default_factory=list)


@dataclass
class MinOOPSolution:
    """Complete solution for minimizing out-of-pocket costs."""
    status: str  # "Optimal", "Infeasible", etc.
    
    # Payment plan: how to pay for each item
    payment_plan: List[PaymentInstruction] = field(default_factory=list)
    
    # Transfer plan: which points to move where
    transfer_plan: List[TransferInstruction] = field(default_factory=list)
    
    # Summary
    total_out_of_pocket: float = 0.0
    total_points_used: int = 0
    points_breakdown: Dict[str, int] = field(default_factory=dict)  # program -> points used
    
    # Comparison to all-cash
    all_cash_cost: float = 0.0
    savings: float = 0.0
    savings_percentage: float = 0.0
    
    # Points remaining after optimization
    points_remaining: Dict[str, int] = field(default_factory=dict)


# =============================================================================
# MAIN OPTIMIZATION FUNCTION
# =============================================================================

def minimize_out_of_pocket(
    items: List[TripCostItem],
    available_points: Dict[str, int],
    transfer_graph: Optional[Dict[str, Dict[str, Any]]] = None,
    *,
    min_points_usage_pct: float = 0.0,  # 0 = use only if beneficial
    max_cash_budget: Optional[float] = None,
    prefer_points: bool = True,  # When OOP is equal, prefer using points
) -> MinOOPSolution:
    """
    Solve ILP to minimize total out-of-pocket cost.
    
    This optimizer prioritizes reducing cash paid over maximizing CPP.
    It will use points even at "low" CPP values if it reduces total cash spent.
    
    Args:
        items: All bookable items (flights + hotels)
        available_points: User's point balances by program code
        transfer_graph: Which banks can transfer to which programs (defaults to EXTENDED_TRANSFER_GRAPH)
        min_points_usage_pct: Force minimum point utilization (0-1)
        max_cash_budget: Optional hard budget constraint
        prefer_points: When cash vs points yields same OOP, prefer points (default True)
        
    Returns:
        MinOOPSolution with optimal payment and transfer plan
    """
    if pl is None:
        raise ImportError("pulp package is not installed. Install it with: pip install pulp")
    
    if not items:
        return MinOOPSolution(status="Optimal", all_cash_cost=0.0)
    
    if transfer_graph is None:
        transfer_graph = EXTENDED_TRANSFER_GRAPH
    
    # Normalize available_points keys
    points = {}
    for k, v in available_points.items():
        if v and v > 0:
            points[k.lower() if k.lower() in transfer_graph else k.upper()] = int(v)
    
    # Calculate all-cash cost
    all_cash_cost = sum(item.cash_cost for item in items)
    
    # Identify banks and programs
    banks = [k for k in points.keys() if k.lower() in transfer_graph]
    
    # Collect all programs that items can be paid with
    programs_needed: Set[str] = set()
    for item in items:
        for opt in item.points_options:
            programs_needed.add(opt.program_code.upper())
    
    # Build the optimization model
    m = pl.LpProblem("MinimizeOutOfPocket", pl.LpMinimize)
    
    # =========================
    # Decision Variables
    # =========================
    
    # pay_cash[i] = 1 if item i is paid with cash
    pay_cash = {
        item.item_id: pl.LpVariable(f"cash_{item.item_id}", cat="Binary")
        for item in items
    }
    
    # use_points[i, p] = 1 if item i is paid with program p's points
    use_points = {}
    for item in items:
        for opt in item.points_options:
            key = (item.item_id, opt.program_code.upper())
            use_points[key] = pl.LpVariable(f"pts_{item.item_id}_{opt.program_code}", cat="Binary")
    
    # transfer[b, p] = points transferred from bank b to program p
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
    
    # =========================
    # Objective Function
    # =========================
    # Minimize: cash paid when using cash + surcharges when using points
    # With small penalty for using points to break ties (when prefer_points=False)
    
    EPSILON = 0.0001 if prefer_points else -0.0001  # Tiny preference for points
    
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
    
    # Tiny bonus for using points (to prefer points when OOP is equal)
    points_bonus = pl.lpSum(
        use_points[(item.item_id, opt.program_code.upper())] * EPSILON
        for item in items
        for opt in item.points_options
        if (item.item_id, opt.program_code.upper()) in use_points
    )
    
    m += cash_component + surcharge_component - points_bonus
    
    # =========================
    # Constraints
    # =========================
    
    # 1. Each item must be paid exactly once (cash OR one points option)
    for item in items:
        item_options = [pay_cash[item.item_id]]
        for opt in item.points_options:
            key = (item.item_id, opt.program_code.upper())
            if key in use_points:
                item_options.append(use_points[key])
        m += pl.lpSum(item_options) == 1, f"pay_once_{item.item_id}"
    
    # 2. Points balance constraints
    # For each program, total points used <= available (direct + transferred)
    for prog in programs_needed:
        # Points used from this program
        points_used = pl.lpSum(
            use_points[(item.item_id, prog)] * opt.points_required
            for item in items
            for opt in item.points_options
            if opt.program_code.upper() == prog and (item.item_id, prog) in use_points
        )
        
        # Available: direct balance + transfers from banks
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
    
    # 4. Optional: Maximum cash budget
    if max_cash_budget is not None:
        total_cash = cash_component + surcharge_component
        m += total_cash <= max_cash_budget, "budget_limit"
    
    # 5. Optional: Minimum points usage
    if min_points_usage_pct > 0:
        total_points_available = sum(points.values())
        min_points = int(total_points_available * min_points_usage_pct)
        
        # Total points used (bank points spent)
        total_points_spent = pl.lpSum(
            transfer[(bank, prog)]
            for bank, prog in transfer.keys()
        ) + pl.lpSum(
            use_points[(item.item_id, prog)] * opt.points_required
            for item in items
            for opt in item.points_options
            for prog in [opt.program_code.upper()]
            if (item.item_id, prog) in use_points
            and prog in points  # Direct program balance
        )
        
        m += total_points_spent >= min_points, "min_points_usage"
    
    # =========================
    # Solve
    # =========================
    solver = pl.PULP_CBC_CMD(msg=False, timeLimit=30)
    m.solve(solver)
    
    status = pl.LpStatus[m.status]
    logger.info(f"MinOOP optimization status: {status}")
    
    if status != "Optimal":
        # Return fallback solution (all cash)
        return MinOOPSolution(
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
    
    # =========================
    # Extract Solution
    # =========================
    return _extract_solution(
        items=items,
        available_points=points,
        transfer_graph=transfer_graph,
        pay_cash=pay_cash,
        use_points=use_points,
        transfer=transfer,
        all_cash_cost=all_cash_cost,
    )


def _extract_solution(
    items: List[TripCostItem],
    available_points: Dict[str, int],
    transfer_graph: Dict[str, Dict[str, Any]],
    pay_cash: Dict[str, Any],
    use_points: Dict[Tuple[str, str], Any],
    transfer: Dict[Tuple[str, str], Any],
    all_cash_cost: float,
) -> MinOOPSolution:
    """Extract solution from solved ILP model."""
    
    payment_plan = []
    transfer_totals: Dict[Tuple[str, str], int] = {}  # (bank, prog) -> points
    program_points_used: Dict[str, int] = {}  # prog -> points
    total_oop = 0.0
    total_points = 0
    
    # Extract payments
    for item in items:
        # Check if paid with cash
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
        
        # Check which points option was used
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
            ratio_str = f"1:{int(ratio)}" if ratio >= 1.0 else f"{int(1/ratio)}:1"
            resulting = int(xfer_amount * ratio)
            
            # Find items this transfer is for
            for_items = [
                p.description for p in payment_plan
                if p.program_used == prog
            ]
            
            transfer_plan.append(TransferInstruction(
                from_program=bank.lower(),
                from_program_name=bank_meta.get("name", bank),
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
    for prog, used in program_points_used.items():
        if prog in points_remaining:
            # Direct program usage (non-transferred)
            transferred_to_prog = sum(
                int(amt * transfer_graph.get(b.lower(), {}).get(prog, {}).get("ratio", 1.0))
                for (b, p), amt in transfer_totals.items()
                if p == prog
            )
            direct_used = max(0, used - transferred_to_prog)
            points_remaining[prog] = max(0, points_remaining.get(prog, 0) - direct_used)
    
    savings = all_cash_cost - total_oop
    savings_pct = (savings / all_cash_cost * 100) if all_cash_cost > 0 else 0.0
    
    return MinOOPSolution(
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


def _build_transfer_steps(
    bank: str,
    program: str,
    points: int,
    transfer_graph: Dict[str, Dict[str, Any]],
) -> List[str]:
    """Build human-readable transfer steps."""
    bank_meta = BANK_METADATA.get(bank.lower(), {})
    prog_info = transfer_graph.get(bank.lower(), {}).get(program, {})
    prog_meta = PROGRAM_METADATA.get(program, {})
    
    bank_name = bank_meta.get("name", bank)
    prog_name = prog_info.get("name", prog_meta.get("name", program))
    portal_url = bank_meta.get("portal_url", "your rewards portal")
    booking_url = prog_meta.get("booking_url", "the program website")
    
    ratio = prog_info.get("ratio", 1.0)
    ratio_str = f"1:{int(ratio)}" if ratio >= 1.0 else f"{int(1/ratio)}:1"
    resulting = int(points * ratio)
    transfer_time = bank_meta.get("default_transfer_time", "varies")
    
    return [
        f"1. Log in to {bank_name}",
        f"2. Go to {portal_url}",
        f"3. Select 'Transfer Points' → {prog_name}",
        f"4. Enter your {prog_name} member number",
        f"5. Transfer {points:,} points ({ratio_str}, {transfer_time})",
        f"6. Receive {resulting:,} {prog_name} points",
        f"7. Book at {booking_url}",
    ]


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def create_flight_cost_item(
    item_id: str,
    origin: str,
    destination: str,
    cash_cost: float,
    points_options: List[Dict[str, Any]],
    date: Optional[str] = None,
    airline: Optional[str] = None,
    flight_number: Optional[str] = None,
) -> TripCostItem:
    """Create a TripCostItem for a flight segment."""
    desc = f"{origin} → {destination}"
    if airline:
        desc += f" ({airline})"
    if flight_number:
        desc += f" {flight_number}"
    
    return TripCostItem(
        item_id=item_id,
        item_type="flight",
        description=desc,
        cash_cost=cash_cost,
        points_options=[
            PointsOption(
                program_code=opt.get("program_code", opt.get("program", "")),
                program_type="airline",
                points_required=int(opt.get("points_required", opt.get("points", 0))),
                surcharge=float(opt.get("surcharge", opt.get("tax", 0))),
            )
            for opt in points_options
            if opt.get("points_required", opt.get("points", 0)) > 0
        ],
        origin=origin,
        destination=destination,
        date=date,
    )


def create_hotel_cost_item(
    item_id: str,
    hotel_name: str,
    location: str,
    cash_cost: float,
    points_options: List[Dict[str, Any]],
    check_in: Optional[str] = None,
    check_out: Optional[str] = None,
    nights: Optional[int] = None,
) -> TripCostItem:
    """Create a TripCostItem for a hotel stay."""
    desc = f"{hotel_name} ({location})"
    if nights:
        desc += f" - {nights} nights"
    
    return TripCostItem(
        item_id=item_id,
        item_type="hotel",
        description=desc,
        cash_cost=cash_cost,
        points_options=[
            PointsOption(
                program_code=opt.get("program_code", opt.get("brand", "")),
                program_type="hotel",
                points_required=int(opt.get("points_required", opt.get("points_cost", 0))),
                surcharge=float(opt.get("surcharge", 0)),
            )
            for opt in points_options
            if opt.get("points_required", opt.get("points_cost", 0)) > 0
        ],
        date=check_in,
        nights=nights,
        hotel_name=hotel_name,
    )


def solution_to_dict(solution: MinOOPSolution) -> Dict[str, Any]:
    """Convert MinOOPSolution to a JSON-serializable dict."""
    return {
        "status": solution.status,
        "total_out_of_pocket": solution.total_out_of_pocket,
        "total_points_used": solution.total_points_used,
        "all_cash_cost": solution.all_cash_cost,
        "savings": solution.savings,
        "savings_percentage": solution.savings_percentage,
        "points_breakdown": solution.points_breakdown,
        "points_remaining": solution.points_remaining,
        "payment_plan": [asdict(p) for p in solution.payment_plan],
        "transfer_plan": [asdict(t) for t in solution.transfer_plan],
    }
