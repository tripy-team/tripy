"""
Group Out-of-Pocket Optimizer

ILP solver that minimizes total out-of-pocket cost for GROUP travel,
supporting cross-member point sharing and fair settlement calculation.

This extends the single-traveler min_oop_optimizer with:
- Multi-member decision variables
- Cross-member point sharing constraints
- Settlement calculation between members
- Per-member budget constraints
"""

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Set, Tuple, Any, Literal
from enum import Enum
import logging

try:
    import pulp as pl
except ModuleNotFoundError:
    pl = None

from .transfer_strategy import (
    EXTENDED_TRANSFER_GRAPH,
    BANK_METADATA,
    PROGRAM_METADATA,
    get_program_name,
    get_bank_name,
)
from .fair_market_values import get_fair_market_value, get_cpp

logger = logging.getLogger(__name__)


# =============================================================================
# ENUMS & CONSTANTS
# =============================================================================

class MemberRole(str, Enum):
    ORGANIZER = "organizer"
    MEMBER = "member"
    VIEWER = "viewer"


class PaymentType(str, Enum):
    CASH = "cash"
    POINTS = "points"


# Bank program codes (lowercase)
BANK_PROGRAMS = {"chase", "amex", "citi", "capitalone", "bilt"}


# =============================================================================
# DATA MODELS
# =============================================================================

@dataclass
class GroupMember:
    """A member of a group trip."""
    user_id: str
    name: str
    role: MemberRole = MemberRole.MEMBER
    
    # Travel preferences
    departure_airport: str = "JFK"
    arrival_airport: Optional[str] = None  # If different from departure
    travel_dates: Optional[Tuple[str, str]] = None
    cabin_preference: str = "Economy"
    
    # Points portfolio
    points_balances: Dict[str, int] = field(default_factory=dict)
    # e.g., {"chase": 150000, "amex": 0, "UA": 50000}
    
    # Budget constraints
    max_cash_budget: Optional[float] = None
    willing_to_share_points: bool = True
    
    # Party size (travelers under this member's booking)
    party_size: int = 1


@dataclass
class GroupPointsPool:
    """Aggregated points across all group members."""
    # Total balances by program
    total_by_program: Dict[str, int] = field(default_factory=dict)
    
    # Breakdown by member
    by_member: Dict[str, Dict[str, int]] = field(default_factory=dict)
    # e.g., {"alice_id": {"chase": 150000}, "bob_id": {"amex": 200000}}
    
    # Available for cross-member use (only from willing members)
    shareable_pool: Dict[str, int] = field(default_factory=dict)
    
    # Transfer potential (bank → airlines/hotels)
    transfer_potential: Dict[str, List[str]] = field(default_factory=dict)
    # e.g., {"chase": ["UA", "BA", "HYATT"]}
    
    # Total estimated value
    total_value: float = 0.0


@dataclass
class GroupPointsOption:
    """A points payment option with cross-member support."""
    program_code: str
    points_required: int
    surcharge: float  # Cash still required (taxes/fees)
    
    # Who can provide these points?
    available_from: List[str] = field(default_factory=list)
    # e.g., ["alice_id", "carol_id"] if both can provide
    
    # Transfer info (if points come from bank)
    transfer_from_bank: Optional[str] = None
    transfer_ratio: float = 1.0


@dataclass
class MemberBookingItem:
    """A bookable item for a specific member."""
    item_id: str
    member_id: str  # Who this booking is FOR
    item_type: Literal["flight", "hotel"]
    description: str
    
    # Pricing
    cash_cost: float
    points_options: List[GroupPointsOption] = field(default_factory=list)
    
    # Flight-specific
    origin: Optional[str] = None
    destination: Optional[str] = None
    date: Optional[str] = None
    airline: Optional[str] = None
    
    # Hotel-specific
    hotel_name: Optional[str] = None
    nights: Optional[int] = None
    
    # Shared hotel: how to split among members
    is_shared: bool = False
    shared_among: List[str] = field(default_factory=list)
    
    # Number of units (seats for flight, rooms for hotel)
    party_size: int = 1


@dataclass
class GroupPaymentAllocation:
    """How a specific item is paid for."""
    item_id: str
    beneficiary_member: str  # Who this booking is FOR
    
    payment_type: PaymentType
    cash_paid: float  # Surcharge or full cash cost
    
    # If points
    points_used: Optional[int] = None
    program_used: Optional[str] = None
    program_name: Optional[str] = None
    points_owner: Optional[str] = None  # Who PROVIDED the points
    
    # Value for settlement calculation
    points_value_usd: Optional[float] = None  # Fair market value


@dataclass
class SettlementEntry:
    """A single settlement between two members."""
    from_member: str       # Who owes (member ID)
    from_member_name: str  # Display name
    to_member: str         # Who receives (member ID)
    to_member_name: str    # Display name
    amount_usd: float
    reason: str            # e.g., "Points used for your JFK→CDG flight"
    
    # Breakdown of what this settlement covers
    breakdown: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class GroupTransferInstruction:
    """Transfer instruction with owner attribution."""
    transfer_id: str
    execution_order: int
    owner_member: str       # Who owns the points being transferred
    owner_member_name: str
    
    from_program: str
    from_program_name: str
    to_program: str
    to_program_name: str
    
    points_to_transfer: int
    transfer_ratio: str     # e.g., "1:1" or "1:2"
    resulting_points: int
    
    transfer_time: str
    transfer_time_hours: int
    portal_url: str
    booking_url: str
    
    # What this transfer covers
    for_members: List[str] = field(default_factory=list)
    for_items: List[str] = field(default_factory=list)
    
    steps: List[str] = field(default_factory=list)


@dataclass
class GroupOOPSolution:
    """Complete solution for group OOP optimization."""
    status: str  # "Optimal", "Feasible", "Infeasible", "Fallback"
    message: str = ""
    
    # Payment allocations for each booking
    allocations: List[GroupPaymentAllocation] = field(default_factory=list)
    
    # Transfer instructions (with owner info)
    transfer_plan: List[GroupTransferInstruction] = field(default_factory=list)
    
    # Settlement matrix
    settlements: List[SettlementEntry] = field(default_factory=list)
    
    # Summary totals
    total_group_oop: float = 0.0
    all_cash_cost: float = 0.0
    total_savings: float = 0.0
    savings_percentage: float = 0.0
    
    # Per-member breakdown
    oop_per_member: Dict[str, float] = field(default_factory=dict)
    points_used_per_member: Dict[str, int] = field(default_factory=dict)
    
    # Remaining balances after optimization
    points_remaining: Dict[str, Dict[str, int]] = field(default_factory=dict)


# =============================================================================
# MAIN OPTIMIZATION FUNCTION
# =============================================================================

def minimize_group_out_of_pocket(
    members: List[GroupMember],
    booking_items: List[MemberBookingItem],
    pool: GroupPointsPool,
    *,
    allow_cross_member_points: bool = True,
    max_subsidy_per_member: Optional[float] = None,
    transfer_graph: Optional[Dict] = None,
) -> GroupOOPSolution:
    """
    Solve ILP to minimize total group out-of-pocket cost.
    
    This extends the single-traveler optimizer with:
    - Cross-member point usage (Alice's points for Bob's booking)
    - Per-member budget constraints
    - Settlement calculations
    
    Args:
        members: List of GroupMember objects
        booking_items: All items to be booked (flights + hotels for all members)
        pool: Aggregated points pool from aggregate_group_points()
        allow_cross_member_points: Allow using one member's points for another
        max_subsidy_per_member: Max USD value one member can contribute for others
        transfer_graph: Transfer graph (defaults to EXTENDED_TRANSFER_GRAPH)
        
    Returns:
        GroupOOPSolution with allocations, transfers, and settlements
    """
    if pl is None:
        raise ImportError("pulp package required. Install: pip install pulp")
    
    if not booking_items:
        return GroupOOPSolution(status="Optimal", message="No items to optimize")
    
    if transfer_graph is None:
        transfer_graph = EXTENDED_TRANSFER_GRAPH
    
    # Create member lookup
    member_lookup = {m.user_id: m for m in members}
    
    # Calculate all-cash cost
    all_cash_cost = sum(item.cash_cost * item.party_size for item in booking_items)
    
    # Validate items have cash costs
    for item in booking_items:
        if item.cash_cost is None or item.cash_cost <= 0:
            if item.points_options:
                # Estimate from points
                best_opt = min(item.points_options, key=lambda x: x.points_required)
                item.cash_cost = best_opt.points_required * 0.015 + best_opt.surcharge
            else:
                item.cash_cost = 500.0  # Fallback
            logger.warning(f"Item {item.item_id} had no cash cost, estimated at ${item.cash_cost:.2f}")
    
    # Build the ILP model
    m = pl.LpProblem("GroupMinOOP", pl.LpMinimize)
    
    # =========================================================================
    # DECISION VARIABLES
    # =========================================================================
    
    # pay_cash[item_id] = 1 if item paid with cash
    pay_cash = {
        item.item_id: pl.LpVariable(f"cash_{item.item_id}", cat="Binary")
        for item in booking_items
    }
    
    # use_points[(item_id, program, owner_id)] = 1 if item paid using owner's program points
    use_points = {}
    for item in booking_items:
        for opt in item.points_options:
            for owner_id in pool.by_member.keys():
                # Check if this owner can provide these points
                if not _can_provide_points(owner_id, opt.program_code, pool, transfer_graph, member_lookup):
                    continue
                
                # Check cross-member constraints
                if not allow_cross_member_points and owner_id != item.member_id:
                    continue
                
                key = (item.item_id, opt.program_code, owner_id)
                use_points[key] = pl.LpVariable(
                    f"pts_{item.item_id}_{opt.program_code}_{owner_id}",
                    cat="Binary"
                )
    
    # transfer[(owner_id, bank, program)] = points transferred
    transfer = {}
    programs_needed = set()
    
    for item in booking_items:
        for opt in item.points_options:
            programs_needed.add(opt.program_code.upper())
    
    for owner_id, owner_points in pool.by_member.items():
        for bank in BANK_PROGRAMS:
            if bank not in owner_points or owner_points[bank] <= 0:
                continue
            
            if bank not in transfer_graph:
                continue
            
            for prog in programs_needed:
                if prog in transfer_graph[bank]:
                    transfer[(owner_id, bank, prog)] = pl.LpVariable(
                        f"xfer_{owner_id}_{bank}_{prog}",
                        lowBound=0,
                        cat="Integer"
                    )
    
    # =========================================================================
    # OBJECTIVE FUNCTION: Minimize total OOP
    # =========================================================================
    
    EPSILON = 0.0001  # Tiny preference for using points
    
    # Cash component
    cash_component = pl.lpSum(
        pay_cash[item.item_id] * item.cash_cost * item.party_size
        for item in booking_items
    )
    
    # Surcharge component (when using points)
    surcharge_component = pl.lpSum(
        use_points[key] * opt.surcharge * item.party_size
        for item in booking_items
        for opt in item.points_options
        for owner_id in pool.by_member.keys()
        if (key := (item.item_id, opt.program_code, owner_id)) in use_points
    )
    
    # Small bonus for using points (tiebreaker)
    points_bonus = pl.lpSum(
        use_points[key] * EPSILON
        for key in use_points
    )
    
    m += cash_component + surcharge_component - points_bonus
    
    # =========================================================================
    # CONSTRAINTS
    # =========================================================================
    
    # 1. Each item paid exactly once
    for item in booking_items:
        item_options = [pay_cash[item.item_id]]
        
        for opt in item.points_options:
            for owner_id in pool.by_member.keys():
                key = (item.item_id, opt.program_code, owner_id)
                if key in use_points:
                    item_options.append(use_points[key])
        
        m += pl.lpSum(item_options) == 1, f"pay_once_{item.item_id}"
    
    # 2. Points balance constraints (per owner, per program)
    for prog in programs_needed:
        for owner_id, owner_points in pool.by_member.items():
            # Points used from this program by this owner
            points_used_expr = pl.lpSum(
                use_points[(item.item_id, opt.program_code, owner_id)] 
                    * opt.points_required * item.party_size
                for item in booking_items
                for opt in item.points_options
                if opt.program_code.upper() == prog
                and (item.item_id, opt.program_code, owner_id) in use_points
            )
            
            # Direct balance
            direct_balance = owner_points.get(prog, 0) + owner_points.get(prog.lower(), 0)
            
            # Transferred in from banks
            transferred_in = pl.lpSum(
                transfer[(owner_id, bank, prog)] 
                    * transfer_graph.get(bank, {}).get(prog, {}).get("ratio", 1.0)
                for bank in BANK_PROGRAMS
                if (owner_id, bank, prog) in transfer
            )
            
            m += points_used_expr <= direct_balance + transferred_in, f"balance_{owner_id}_{prog}"
    
    # 3. Transfer limits (per owner, per bank)
    for owner_id, owner_points in pool.by_member.items():
        for bank in BANK_PROGRAMS:
            if bank not in owner_points:
                continue
            
            total_transferred = pl.lpSum(
                transfer[(owner_id, bank, prog)]
                for prog in programs_needed
                if (owner_id, bank, prog) in transfer
            )
            
            m += total_transferred <= owner_points[bank], f"bank_limit_{owner_id}_{bank}"
    
    # 4. Per-member budget constraints
    for member in members:
        if member.max_cash_budget is not None:
            member_cash = pl.lpSum(
                pay_cash[item.item_id] * item.cash_cost * item.party_size
                for item in booking_items
                if item.member_id == member.user_id
            )
            member_surcharges = pl.lpSum(
                use_points[(item.item_id, opt.program_code, owner_id)] 
                    * opt.surcharge * item.party_size
                for item in booking_items
                for opt in item.points_options
                for owner_id in pool.by_member.keys()
                if item.member_id == member.user_id
                and (item.item_id, opt.program_code, owner_id) in use_points
            )
            m += member_cash + member_surcharges <= member.max_cash_budget, \
                f"budget_{member.user_id}"
    
    # 5. Max subsidy constraint (optional)
    if max_subsidy_per_member is not None:
        for owner_id in pool.by_member.keys():
            # Points owner provides for OTHER members (not self)
            subsidy_points = pl.lpSum(
                use_points[(item.item_id, opt.program_code, owner_id)] 
                    * opt.points_required * item.party_size
                for item in booking_items
                for opt in item.points_options
                if item.member_id != owner_id  # For others
                and (item.item_id, opt.program_code, owner_id) in use_points
            )
            # Approximate value constraint (using 1.5 cpp)
            m += subsidy_points * 0.015 <= max_subsidy_per_member, \
                f"max_subsidy_{owner_id}"
    
    # =========================================================================
    # SOLVE
    # =========================================================================
    
    solver = pl.PULP_CBC_CMD(msg=False, timeLimit=60)
    m.solve(solver)
    
    status = pl.LpStatus[m.status]
    logger.info(f"Group MinOOP optimization status: {status}")
    
    if status != "Optimal":
        # Fallback to all-cash
        logger.warning(f"Group ILP status={status}, falling back to all-cash")
        return _build_fallback_solution(booking_items, members, all_cash_cost)
    
    # =========================================================================
    # EXTRACT SOLUTION
    # =========================================================================
    
    return _extract_group_solution(
        booking_items=booking_items,
        members=members,
        pool=pool,
        pay_cash=pay_cash,
        use_points=use_points,
        transfer=transfer,
        transfer_graph=transfer_graph,
        all_cash_cost=all_cash_cost,
    )


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def _can_provide_points(
    owner_id: str,
    program: str,
    pool: GroupPointsPool,
    transfer_graph: Dict,
    member_lookup: Dict[str, GroupMember],
) -> bool:
    """Check if an owner can provide points for a program (directly or via transfer)."""
    owner_points = pool.by_member.get(owner_id, {})
    member = member_lookup.get(owner_id)
    
    # Check willing to share
    if member and not member.willing_to_share_points:
        return False
    
    # Direct balance
    if owner_points.get(program, 0) > 0 or owner_points.get(program.upper(), 0) > 0:
        return True
    
    # Via transfer from bank
    for bank, balance in owner_points.items():
        if balance <= 0:
            continue
        bank_lower = bank.lower()
        if bank_lower in transfer_graph:
            prog_upper = program.upper()
            if prog_upper in transfer_graph[bank_lower]:
                return True
    
    return False


def _build_fallback_solution(
    items: List[MemberBookingItem],
    members: List[GroupMember],
    all_cash_cost: float,
) -> GroupOOPSolution:
    """Build all-cash fallback solution."""
    member_lookup = {m.user_id: m for m in members}
    
    allocations = [
        GroupPaymentAllocation(
            item_id=item.item_id,
            beneficiary_member=item.member_id,
            payment_type=PaymentType.CASH,
            cash_paid=item.cash_cost * item.party_size,
        )
        for item in items
    ]
    
    oop_per_member = {}
    for alloc in allocations:
        oop_per_member[alloc.beneficiary_member] = \
            oop_per_member.get(alloc.beneficiary_member, 0) + alloc.cash_paid
    
    return GroupOOPSolution(
        status="Fallback",
        message="Using all-cash payment (points optimization unavailable)",
        allocations=allocations,
        total_group_oop=all_cash_cost,
        all_cash_cost=all_cash_cost,
        total_savings=0.0,
        savings_percentage=0.0,
        oop_per_member=oop_per_member,
    )


def _extract_group_solution(
    booking_items: List[MemberBookingItem],
    members: List[GroupMember],
    pool: GroupPointsPool,
    pay_cash: Dict,
    use_points: Dict,
    transfer: Dict,
    transfer_graph: Dict,
    all_cash_cost: float,
) -> GroupOOPSolution:
    """Extract the complete group solution from solved ILP."""
    
    member_lookup = {m.user_id: m for m in members}
    
    allocations = []
    total_oop = 0.0
    oop_per_member = {m.user_id: 0.0 for m in members}
    points_used_per_member = {m.user_id: 0 for m in members}
    
    # Track points contributions for settlement
    points_contributed: Dict[str, Dict[str, float]] = {}  # owner -> {beneficiary -> value}
    
    for item in booking_items:
        beneficiary = item.member_id
        party_size = item.party_size
        
        # Check if paid with cash
        if pl.value(pay_cash[item.item_id]) > 0.5:
            cash_amount = item.cash_cost * party_size
            allocations.append(GroupPaymentAllocation(
                item_id=item.item_id,
                beneficiary_member=beneficiary,
                payment_type=PaymentType.CASH,
                cash_paid=cash_amount,
            ))
            total_oop += cash_amount
            oop_per_member[beneficiary] += cash_amount
            continue
        
        # Find which points option was used
        for opt in item.points_options:
            for owner_id in pool.by_member.keys():
                key = (item.item_id, opt.program_code, owner_id)
                if key not in use_points:
                    continue
                
                if pl.value(use_points[key]) > 0.5:
                    surcharge = opt.surcharge * party_size
                    points_used = opt.points_required * party_size
                    points_value = get_fair_market_value(opt.program_code, points_used)
                    
                    owner_name = member_lookup.get(owner_id, GroupMember(user_id=owner_id, name=owner_id)).name
                    
                    allocations.append(GroupPaymentAllocation(
                        item_id=item.item_id,
                        beneficiary_member=beneficiary,
                        payment_type=PaymentType.POINTS,
                        cash_paid=surcharge,
                        points_used=points_used,
                        program_used=opt.program_code,
                        program_name=get_program_name(opt.program_code),
                        points_owner=owner_id,
                        points_value_usd=round(points_value, 2),
                    ))
                    
                    total_oop += surcharge
                    oop_per_member[beneficiary] += surcharge
                    points_used_per_member[owner_id] += points_used
                    
                    # Track for settlement
                    if owner_id not in points_contributed:
                        points_contributed[owner_id] = {}
                    if beneficiary not in points_contributed[owner_id]:
                        points_contributed[owner_id][beneficiary] = 0.0
                    points_contributed[owner_id][beneficiary] += points_value
                    
                    break
            else:
                continue
            break
    
    # Build transfer plan
    transfer_plan = _build_group_transfer_plan(
        transfer, pool, allocations, transfer_graph, member_lookup
    )
    
    # Build settlements
    settlements = _calculate_settlements(points_contributed, member_lookup, allocations)
    
    # Calculate remaining points
    points_remaining = _calculate_remaining_points(pool, allocations, transfer, transfer_graph)
    
    savings = all_cash_cost - total_oop
    savings_pct = (savings / all_cash_cost * 100) if all_cash_cost > 0 else 0.0
    
    return GroupOOPSolution(
        status="Optimal",
        message=f"Found optimal solution with {savings_pct:.1f}% savings",
        allocations=allocations,
        transfer_plan=transfer_plan,
        settlements=settlements,
        total_group_oop=round(total_oop, 2),
        all_cash_cost=round(all_cash_cost, 2),
        total_savings=round(savings, 2),
        savings_percentage=round(savings_pct, 1),
        oop_per_member={k: round(v, 2) for k, v in oop_per_member.items()},
        points_used_per_member=points_used_per_member,
        points_remaining=points_remaining,
    )


def _build_group_transfer_plan(
    transfer: Dict,
    pool: GroupPointsPool,
    allocations: List[GroupPaymentAllocation],
    transfer_graph: Dict,
    member_lookup: Dict[str, GroupMember],
) -> List[GroupTransferInstruction]:
    """Build transfer instructions for the group."""
    
    transfer_plan = []
    order = 1
    
    for (owner_id, bank, prog), var in transfer.items():
        xfer_amount = int(round(pl.value(var) or 0))
        if xfer_amount <= 0:
            continue
        
        bank_meta = BANK_METADATA.get(bank, {})
        prog_info = transfer_graph.get(bank, {}).get(prog, {})
        prog_meta = PROGRAM_METADATA.get(prog, {})
        
        ratio = prog_info.get("ratio", 1.0)
        ratio_str = f"1:{int(ratio)}" if ratio >= 1.0 else f"{int(1/ratio)}:1"
        resulting = int(xfer_amount * ratio)
        
        owner_name = member_lookup.get(owner_id, GroupMember(user_id=owner_id, name=owner_id)).name
        
        # Find items this transfer covers
        for_items = []
        for_members = set()
        for alloc in allocations:
            if alloc.points_owner == owner_id and alloc.program_used == prog:
                for_items.append(alloc.item_id)
                for_members.add(alloc.beneficiary_member)
        
        # Build steps
        bank_name = bank_meta.get("name", bank)
        prog_name = prog_info.get("name", prog_meta.get("name", prog))
        portal_url = bank_meta.get("portal_url", "")
        booking_url = prog_meta.get("booking_url", "")
        transfer_time = bank_meta.get("default_transfer_time", "varies")
        
        # Estimate transfer time in hours
        time_hours = 0
        if "instant" in transfer_time.lower():
            time_hours = 0
        elif "1-2" in transfer_time:
            time_hours = 48
        elif "24" in transfer_time:
            time_hours = 24
        else:
            time_hours = 72
        
        steps = [
            f"1. Log in to {bank_name}",
            f"2. Go to {portal_url}",
            f"3. Select 'Transfer Points' → Travel Partners",
            f"4. Find and select '{prog_name}'",
            f"5. Enter your {prog_name} member number",
            f"6. Transfer {xfer_amount:,} points",
            f"7. Transfer completes: {transfer_time}",
            f"8. You will receive {resulting:,} {prog_name} points",
        ]
        if booking_url:
            steps.append(f"9. Book at {booking_url}")
        
        transfer_plan.append(GroupTransferInstruction(
            transfer_id=f"xfer_{order}_{owner_id}_{bank}_{prog}",
            execution_order=order,
            owner_member=owner_id,
            owner_member_name=owner_name,
            from_program=bank,
            from_program_name=bank_name,
            to_program=prog,
            to_program_name=prog_name,
            points_to_transfer=xfer_amount,
            transfer_ratio=ratio_str,
            resulting_points=resulting,
            transfer_time=transfer_time,
            transfer_time_hours=time_hours,
            portal_url=portal_url,
            booking_url=booking_url,
            for_members=list(for_members),
            for_items=for_items,
            steps=steps,
        ))
        order += 1
    
    return transfer_plan


def _calculate_settlements(
    points_contributed: Dict[str, Dict[str, float]],
    member_lookup: Dict[str, GroupMember],
    allocations: List[GroupPaymentAllocation],
) -> List[SettlementEntry]:
    """
    Calculate who owes whom based on points contributions.
    
    If Alice uses her points for Bob's flight, Bob owes Alice the fair value.
    """
    raw_settlements = []
    
    for owner_id, beneficiaries in points_contributed.items():
        for beneficiary_id, value in beneficiaries.items():
            if owner_id == beneficiary_id:
                continue  # Using own points, no settlement needed
            
            if value > 0.01:  # Ignore tiny amounts
                # Find what items this covers
                breakdown = []
                for alloc in allocations:
                    if alloc.points_owner == owner_id and alloc.beneficiary_member == beneficiary_id:
                        breakdown.append({
                            "item_id": alloc.item_id,
                            "points": alloc.points_used,
                            "value": alloc.points_value_usd,
                        })
                
                owner_name = member_lookup.get(owner_id, GroupMember(user_id=owner_id, name=owner_id)).name
                beneficiary_name = member_lookup.get(beneficiary_id, GroupMember(user_id=beneficiary_id, name=beneficiary_id)).name
                
                raw_settlements.append(SettlementEntry(
                    from_member=beneficiary_id,
                    from_member_name=beneficiary_name,
                    to_member=owner_id,
                    to_member_name=owner_name,
                    amount_usd=round(value, 2),
                    reason=f"Points used for your bookings (from {owner_name})",
                    breakdown=breakdown,
                ))
    
    # Consolidate settlements
    return _consolidate_settlements(raw_settlements)


def _consolidate_settlements(settlements: List[SettlementEntry]) -> List[SettlementEntry]:
    """Consolidate multiple settlements between same members into net amounts."""
    # Build net matrix
    net: Dict[Tuple[str, str], float] = {}
    meta: Dict[Tuple[str, str], Tuple[str, str, List]] = {}  # (from, to) -> (from_name, to_name, breakdown)
    
    for s in settlements:
        key = (s.from_member, s.to_member)
        reverse_key = (s.to_member, s.from_member)
        
        if reverse_key in net:
            net[reverse_key] -= s.amount_usd
        else:
            net[key] = net.get(key, 0) + s.amount_usd
            if key not in meta:
                meta[key] = (s.from_member_name, s.to_member_name, s.breakdown)
            else:
                # Merge breakdowns
                existing = meta[key]
                meta[key] = (existing[0], existing[1], existing[2] + s.breakdown)
    
    # Convert back to settlements
    consolidated = []
    for (from_m, to_m), amount in net.items():
        if abs(amount) < 0.01:
            continue
            
        if amount > 0:
            from_name, to_name, breakdown = meta.get((from_m, to_m), (from_m, to_m, []))
            consolidated.append(SettlementEntry(
                from_member=from_m,
                from_member_name=from_name,
                to_member=to_m,
                to_member_name=to_name,
                amount_usd=round(amount, 2),
                reason="Net settlement for points used",
                breakdown=breakdown,
            ))
        else:
            # Reverse direction
            from_name, to_name, breakdown = meta.get((from_m, to_m), (from_m, to_m, []))
            consolidated.append(SettlementEntry(
                from_member=to_m,
                from_member_name=to_name,
                to_member=from_m,
                to_member_name=from_name,
                amount_usd=round(-amount, 2),
                reason="Net settlement for points used",
                breakdown=breakdown,
            ))
    
    return consolidated


def _calculate_remaining_points(
    pool: GroupPointsPool,
    allocations: List[GroupPaymentAllocation],
    transfer: Dict,
    transfer_graph: Dict,
) -> Dict[str, Dict[str, int]]:
    """Calculate remaining points after optimization."""
    
    # Start with original balances
    remaining = {
        owner_id: dict(points) 
        for owner_id, points in pool.by_member.items()
    }
    
    # Subtract transfers
    for (owner_id, bank, prog), var in transfer.items():
        xfer_amount = int(round(pl.value(var) or 0))
        if xfer_amount > 0 and owner_id in remaining:
            if bank in remaining[owner_id]:
                remaining[owner_id][bank] = max(0, remaining[owner_id][bank] - xfer_amount)
    
    # Subtract direct program usage (non-transferred)
    for alloc in allocations:
        if alloc.payment_type == PaymentType.POINTS and alloc.points_owner and alloc.points_used:
            owner_id = alloc.points_owner
            prog = alloc.program_used
            
            if owner_id in remaining and prog in remaining[owner_id]:
                # Check if this was from a transfer
                was_transferred = any(
                    (owner_id, bank, prog) in transfer and pl.value(transfer[(owner_id, bank, prog)]) > 0
                    for bank in BANK_PROGRAMS
                )
                
                if not was_transferred:
                    remaining[owner_id][prog] = max(0, remaining[owner_id][prog] - alloc.points_used)
    
    return remaining


# =============================================================================
# SOLUTION SERIALIZATION
# =============================================================================

def group_solution_to_dict(solution: GroupOOPSolution) -> Dict[str, Any]:
    """Convert GroupOOPSolution to a JSON-serializable dict."""
    return {
        "status": solution.status,
        "message": solution.message,
        "summary": {
            "total_group_oop": solution.total_group_oop,
            "all_cash_cost": solution.all_cash_cost,
            "total_savings": solution.total_savings,
            "savings_percentage": solution.savings_percentage,
        },
        "per_member": {
            member_id: {
                "oop": solution.oop_per_member.get(member_id, 0),
                "points_used": solution.points_used_per_member.get(member_id, 0),
            }
            for member_id in solution.oop_per_member.keys()
        },
        "allocations": [asdict(a) for a in solution.allocations],
        "transfers": [asdict(t) for t in solution.transfer_plan],
        "settlements": [asdict(s) for s in solution.settlements],
        "points_remaining": solution.points_remaining,
    }
