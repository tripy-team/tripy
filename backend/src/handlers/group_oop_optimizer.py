"""
Group Out-of-Pocket Optimizer

ILP solver that minimizes total out-of-pocket cost for GROUP travel,
supporting cross-member point sharing and fair settlement calculation.

This extends the single-traveler min_oop_optimizer with:
- Multi-member decision variables
- Cross-member point sharing constraints
- Settlement calculation between members
- Per-member budget constraints
- TWO-PHASE SOLVE: strict → relaxed fallback for over-budget scenarios
"""

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Set, Tuple, Any, Literal
from enum import Enum
import logging
import time

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
from ..contracts.group_optimization_contracts import (
    OptimizationStatus,
    BudgetOverrun,
    SolveMeta,
    GroupOptimizationResult,
    BudgetOverrunData,
    SolveMetaData,
)
from ..config.optimizer_config import (
    GROUP_SOLVE_TIME_LIMIT_S,
    RELAX_BIG_M_GROUP,
    RELAX_BIG_M_MEMBER,
    RELAX_BIG_M_MAX_MEMBER,
    RELAX_EPS_OOP,
    RELAX_EPS_POINTS,
    RELAX_ENABLE_MINIMAX,
    get_relaxation_config,
)

logger = logging.getLogger(__name__)


# =============================================================================
# PROGRAM CODE NORMALIZATION & SETTLEMENT HELPERS
# =============================================================================

def normalize_program_code(code: str) -> str:
    """
    Normalize program codes to uppercase to prevent silent mismatches.
    
    Use this anywhere you:
    - Read member balances keys
    - Build pool.by_member / pool.by_program
    - Read/write opt.program_code, available_from, transfer_from_bank
    """
    if code is None:
        return ""
    return code.strip().upper()


# PRUNING uses per-pax values (opt.surcharge vs item.cash_cost)
# ILP CONSTRAINTS use totals (multiply by party_size)

def settlement_value_usd(
    program: str,
    points_used: int,
    cash_cost: float,
    surcharge: float,
) -> float:
    """
    Compute settlement value with FMV capping.
    
    MUST be used in BOTH:
    1. ILP settlement constraint
    2. Settlement extraction
    
    This ensures ILP constraint and settlement report agree.
    
    Args:
        program: Points program code
        points_used: Total points used (points_required * party_size)
        cash_cost: Total cash cost (cash_cost * party_size)
        surcharge: Total surcharge (surcharge * party_size)
        
    Returns:
        min(uncapped_fmv, cash_avoided) where cash_avoided = max(0, cash_cost - surcharge)
    """
    uncapped_fmv = get_fair_market_value(normalize_program_code(program), points_used)
    cash_avoided = max(0.0, cash_cost - surcharge)
    return min(uncapped_fmv, cash_avoided)


# =============================================================================
# DOMINANCE PRUNING
# =============================================================================

# Pruning thresholds
HARD_PRUNE_THRESHOLD = 1.0   # surcharge >= 100% of cash: always prune
SOFT_PRUNE_THRESHOLD = 0.95  # surcharge >= 95% of cash: prune by default


def prune_dominated_options(
    item: 'MemberBookingItem',
    soft_threshold_pct: float = SOFT_PRUNE_THRESHOLD,
    enable_soft_prune: bool = True,
) -> 'MemberBookingItem':
    """
    Remove points options that are dominated or economically worse than cash.
    
    TWO-TIER PRUNING:
    - Hard prune: surcharge >= cash_cost (ALWAYS remove, never makes sense)
    - Soft prune: surcharge >= soft_threshold_pct * cash_cost (configurable)
    
    PARETO DOMINANCE (within same program):
    - Sort options by points_required ascending
    - Keep option only if its surcharge is STRICTLY LOWER than all 
      previously kept options (at lower or equal points)
    
    Example (program UA, cash_cost=$300):
    
        Option 1: 20,000 pts, $40 surcharge → KEEP (first, best surcharge so far = $40)
        Option 2: 25,000 pts, $35 surcharge → KEEP (surcharge $35 < $40)
        Option 3: 25,000 pts, $45 surcharge → DROP (surcharge $45 >= $35)
        Option 4: 30,000 pts, $30 surcharge → KEEP (surcharge $30 < $35)
        Option 5: 35,000 pts, $50 surcharge → DROP (surcharge $50 >= $30)
    
    Args:
        item: Booking item with points_options (per-pax costs)
        soft_threshold_pct: Soft prune if surcharge >= this % of cash cost
        enable_soft_prune: If False, only hard prune (surcharge >= cash)
        
    Returns:
        Item with pruned options list (mutates in place)
    """
    if not item.points_options:
        return item
    
    original_count = len(item.points_options)
    cash_cost = item.cash_cost  # Per-pax
    soft_pruned = 0  # Initialize before use
    
    # Tier 1: HARD PRUNE (surcharge >= cash_cost)
    # These NEVER make sense - you'd pay more in taxes than the cash fare
    viable = [
        opt for opt in item.points_options 
        if opt.surcharge < cash_cost * HARD_PRUNE_THRESHOLD
    ]
    
    hard_pruned = original_count - len(viable)
    if hard_pruned > 0:
        logger.info(f"[Prune] {item.item_id}: Hard-pruned {hard_pruned} options "
                   f"(surcharge >= cash ${cash_cost:.2f})")
    
    # Tier 2: SOFT PRUNE (surcharge >= threshold)
    if enable_soft_prune:
        soft_threshold = cash_cost * soft_threshold_pct
        before_soft = len(viable)
        viable = [opt for opt in viable if opt.surcharge < soft_threshold]
        
        soft_pruned = before_soft - len(viable)
        if soft_pruned > 0:
            logger.info(f"[Prune] {item.item_id}: Soft-pruned {soft_pruned} options "
                       f"(surcharge >= {soft_threshold_pct*100:.0f}% of cash)")
    
    if not viable:
        logger.info(f"[Prune] {item.item_id}: All {original_count} points options "
                   f"dominated by cash")
        item.points_options = []
        return item
    
    # Tier 3: PARETO DOMINANCE within each program
    by_program: Dict[str, List['GroupPointsOption']] = {}
    for opt in viable:
        prog = normalize_program_code(opt.program_code)
        if prog not in by_program:
            by_program[prog] = []
        by_program[prog].append(opt)
    
    pareto_optimal = []
    pareto_pruned_total = 0
    
    for prog, opts in by_program.items():
        # Sort by points_required ascending, then surcharge ascending (tiebreaker)
        opts.sort(key=lambda x: (x.points_required, x.surcharge))
        
        kept = []
        best_surcharge_so_far = float('inf')
        
        for opt in opts:
            if opt.surcharge < best_surcharge_so_far:
                # This option has LOWER surcharge than any kept option
                # with FEWER or EQUAL points → not dominated
                kept.append(opt)
                best_surcharge_so_far = opt.surcharge
            # else: This option has MORE points than some kept option
            # with LOWER or EQUAL surcharge → DOMINATED, skip
        
        pareto_optimal.extend(kept)
        
        pareto_pruned = len(opts) - len(kept)
        pareto_pruned_total += pareto_pruned
        if pareto_pruned > 0:
            logger.debug(f"[Prune] {item.item_id} {prog}: Pareto-pruned {pareto_pruned}, "
                        f"kept {len(kept)}/{len(opts)}")
    
    # Summary logging with min surcharge retained (helps debugging)
    final_count = len(pareto_optimal)
    if final_count > 0:
        min_surcharge_retained = min(opt.surcharge for opt in pareto_optimal)
    else:
        min_surcharge_retained = None
    
    if final_count < original_count:
        logger.info(
            f"[Prune] {item.item_id}: {original_count} → {final_count} options "
            f"(hard={hard_pruned}, soft={soft_pruned}, pareto={pareto_pruned_total})"
            f"{f', min_surcharge=${min_surcharge_retained:.2f}' if min_surcharge_retained else ''}"
        )
    
    item.points_options = pareto_optimal
    return item


def prune_all_items(
    items: List['MemberBookingItem'],
    soft_threshold_pct: float = SOFT_PRUNE_THRESHOLD,
    enable_soft_prune: bool = True,
) -> List['MemberBookingItem']:
    """
    Apply dominance pruning to all booking items.
    
    Returns:
        Items with pruned options (mutates in place)
    """
    total_before = sum(len(item.points_options) for item in items)
    
    for item in items:
        prune_dominated_options(item, soft_threshold_pct, enable_soft_prune)
    
    total_after = sum(len(item.points_options) for item in items)
    if total_before != total_after:
        logger.info(f"[Prune] Total options: {total_before} → {total_after} "
                   f"({total_before - total_after} removed across {len(items)} items)")
    
    return items


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


class SolveMode(str, Enum):
    """Mode for ILP solving."""
    STRICT = "strict"    # Hard budget constraints, fail if infeasible
    RELAXED = "relaxed"  # Soft budget constraints with slack variables


# Bank program codes (lowercase) — from centralized config
from src.config.programs import BANK_PROGRAMS


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
    
    # Settlement constraints (Issue 2: Settlement-aware budgets)
    max_settlement_owed: Optional[float] = None  # Max USD willing to owe others
    include_settlement_in_budget: bool = False   # If True, cash + settlement <= budget

    # Points-usage preferences (enforced by the ILP).
    #  - allow_flight_points=False: this member's points fund NO flight (neither
    #    their own nor anyone else's); points stay available for hotels.
    #  - allow_transfer_partners=False: only direct airline/hotel balances are
    #    usable; no bank→partner transfers.
    #  - max_point_value_contribution_usd: cap on the USD value of points this
    #    member contributes toward OTHER members' bookings.
    allow_flight_points: bool = True
    allow_transfer_partners: bool = True
    max_point_value_contribution_usd: Optional[float] = None


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
    # Connection profile of the chosen itinerary (num_stops, layovers, airlines,
    # has_self_transfer, and — once derived — protection/ticketing + warnings).
    # Inert to the solver; carried through for persistence and the UI.
    connection: Optional[Dict[str, Any]] = None
    # Human-readable schedule for the chosen itinerary (origin, destination, date,
    # departure_time, duration_minutes, airline, flight_id). Inert to the solver;
    # carried through so the results UI can render each traveler's flight plan even
    # when arrival coordination didn't run (e.g. single-traveler trips).
    flight_details: Optional[Dict[str, Any]] = None

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
    status: str  # "Optimal", "Feasible", "Infeasible", "Fallback", "Relaxed"
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
    
    # Budget overrun info (for relaxed mode)
    is_relaxed: bool = False
    budget_overrun: Optional[BudgetOverrunData] = None
    solve_meta: Optional[SolveMetaData] = None


# =============================================================================
# MAIN OPTIMIZATION FUNCTION (REFACTORED WITH MODE SUPPORT)
# =============================================================================

def solve_group_ilp(
    members: List[GroupMember],
    booking_items: List[MemberBookingItem],
    pool: GroupPointsPool,
    *,
    mode: SolveMode = SolveMode.STRICT,
    allow_cross_member_points: bool = True,
    max_subsidy_per_member: Optional[float] = None,
    transfer_graph: Optional[Dict] = None,
    max_group_budget: Optional[float] = None,
    time_limit_s: int = GROUP_SOLVE_TIME_LIMIT_S,
    balance_points_usage: bool = True,
) -> Tuple[GroupOOPSolution, str]:
    """
    Core ILP solver supporting both strict and relaxed modes.
    
    Args:
        members: List of GroupMember objects
        booking_items: All items to be booked
        pool: Aggregated points pool
        mode: SolveMode.STRICT (hard constraints) or SolveMode.RELAXED (slack variables)
        allow_cross_member_points: Allow using one member's points for another
        max_subsidy_per_member: Max USD value one member can contribute for others
        transfer_graph: Transfer graph (defaults to EXTENDED_TRANSFER_GRAPH)
        max_group_budget: Combined group budget limit
        time_limit_s: Solver time limit in seconds
        balance_points_usage: If True, distribute points usage evenly across members (default True)
        
    Returns:
        Tuple of (GroupOOPSolution, solver_status_string)
    """
    if pl is None:
        raise ImportError("pulp package required. Install: pip install pulp")
    
    start_time = time.time()
    
    if not booking_items:
        return GroupOOPSolution(status="Optimal", message="No items to optimize"), "Optimal"
    
    if transfer_graph is None:
        transfer_graph = EXTENDED_TRANSFER_GRAPH
    
    # Create member lookup
    member_lookup = {m.user_id: m for m in members}
    member_budgets = {m.user_id: m.max_cash_budget for m in members if m.max_cash_budget is not None}
    
    # Calculate all-cash cost
    all_cash_cost = sum(item.cash_cost * item.party_size for item in booking_items)
    
    # Validate items have cash costs
    for item in booking_items:
        if item.cash_cost is None or item.cash_cost <= 0:
            if item.points_options:
                best_opt = min(item.points_options, key=lambda x: x.points_required)
                item.cash_cost = best_opt.points_required * 0.015 + best_opt.surcharge
            else:
                item.cash_cost = 500.0
            logger.warning(f"Item {item.item_id} had no cash cost, estimated at ${item.cash_cost:.2f}")
    
    # =========================================================================
    # DOMINANCE PRUNING (Issue 0: Remove dominated points options)
    # =========================================================================
    # This reduces ILP size and prevents obviously bad redemptions.
    # Prune BEFORE decision variables to minimize ILP complexity.
    prune_all_items(booking_items, soft_threshold_pct=SOFT_PRUNE_THRESHOLD, enable_soft_prune=True)
    
    # Build the ILP model
    problem_name = f"GroupMinOOP_{mode.value}"
    m = pl.LpProblem(problem_name, pl.LpMinimize)
    
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
                owner = member_lookup.get(owner_id)
                # Member opted out of award flights → their points fund no flight
                # (their own or anyone else's), per allow_flight_points.
                if item.item_type == "flight" and owner and not owner.allow_flight_points:
                    continue
                if item.item_type == "hotel" and owner and not getattr(owner, "allow_hotel_points", True):
                    continue
                if not _can_provide_points(owner_id, opt.program_code, pool, transfer_graph, member_lookup):
                    continue
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
        owner = member_lookup.get(owner_id)
        # Member disabled transfer partners → only their direct airline/hotel
        # balances are usable; never create bank→partner transfer variables.
        if owner and not owner.allow_transfer_partners:
            continue
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
    # SLACK VARIABLES (RELAXED MODE ONLY)
    # =========================================================================
    
    slack_member = {}  # Per-member budget slack
    slack_group = None  # Group budget slack
    slack_max_member = None  # For minimax
    
    if mode == SolveMode.RELAXED:
        # Per-member slack variables (continuous, >= 0, in USD)
        for member in members:
            if member.max_cash_budget is not None:
                slack_member[member.user_id] = pl.LpVariable(
                    f"slack_member_{member.user_id}",
                    lowBound=0,
                    cat="Continuous"
                )
        
        # Group budget slack
        if max_group_budget is not None:
            slack_group = pl.LpVariable("slack_group", lowBound=0, cat="Continuous")
        
        # Minimax slack (minimize the maximum member overrun)
        if RELAX_ENABLE_MINIMAX and slack_member:
            slack_max_member = pl.LpVariable("slack_max_member", lowBound=0, cat="Continuous")
    
    # =========================================================================
    # OBJECTIVE FUNCTION
    # =========================================================================
    
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
    
    # Total OOP (used in both modes)
    total_oop_expr = cash_component + surcharge_component
    
    # Points usage (for tie-breaking)
    total_points_expr = pl.lpSum(
        use_points[(item.item_id, opt.program_code, owner_id)] * opt.points_required * item.party_size
        for item in booking_items
        for opt in item.points_options
        for owner_id in pool.by_member.keys()
        if (item.item_id, opt.program_code, owner_id) in use_points
    )
    
    if mode == SolveMode.STRICT:
        # STRICT MODE: Minimize OOP with tiny points preference
        EPSILON = 0.0001
        points_bonus = pl.lpSum(use_points[key] * EPSILON for key in use_points)
        m += total_oop_expr - points_bonus
    else:
        # RELAXED MODE: Weighted objective with slack penalties
        # Minimize: 
        #   BIG_M_MAX_MEMBER * slack_max_member (if enabled)
        # + BIG_M_MEMBER * sum(slack_member)
        # + BIG_M_GROUP * slack_group
        # + EPS_OOP * total_cost
        # + EPS_POINTS * total_points_used
        
        objective = pl.lpSum([])
        
        # 1. Minimax penalty (highest priority)
        if slack_max_member is not None:
            objective += RELAX_BIG_M_MAX_MEMBER * slack_max_member
        
        # 2. Sum of member slack penalties
        if slack_member:
            objective += RELAX_BIG_M_MEMBER * pl.lpSum(slack_member.values())
        
        # 3. Group slack penalty
        if slack_group is not None:
            objective += RELAX_BIG_M_GROUP * slack_group
        
        # 4. Secondary: minimize OOP
        objective += RELAX_EPS_OOP * total_oop_expr
        
        # 5. Tertiary: minimize points (small tie-breaker)
        objective += RELAX_EPS_POINTS * total_points_expr
        
        m += objective
        
        logger.info(f"[GroupILP] Relaxed mode objective weights: "
                   f"max_member={RELAX_BIG_M_MAX_MEMBER}, member={RELAX_BIG_M_MEMBER}, "
                   f"group={RELAX_BIG_M_GROUP}, oop={RELAX_EPS_OOP}, points={RELAX_EPS_POINTS}")
    
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
            points_used_expr = pl.lpSum(
                use_points[(item.item_id, opt.program_code, owner_id)] 
                    * opt.points_required * item.party_size
                for item in booking_items
                for opt in item.points_options
                if opt.program_code.upper() == prog
                and (item.item_id, opt.program_code, owner_id) in use_points
            )
            
            direct_balance = owner_points.get(prog, 0) + owner_points.get(prog.lower(), 0)
            
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
    
    # 4. Per-member budget constraints (with slack in relaxed mode)
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
            
            member_total = member_cash + member_surcharges
            
            if mode == SolveMode.RELAXED and member.user_id in slack_member:
                # RELAXED: cost <= budget + slack
                m += member_total <= member.max_cash_budget + slack_member[member.user_id], \
                    f"budget_{member.user_id}"
            else:
                # STRICT: cost <= budget
                m += member_total <= member.max_cash_budget, f"budget_{member.user_id}"
    
    # 4b. Per-member SETTLEMENT constraints (Issue 2: Settlement-aware budgets)
    # settlement_value_usd() returns a constant, so multiplying by binary var is linear
    for member in members:
        if member.max_settlement_owed is not None:
            # Calculate settlement this member would owe
            # (points used for their items, provided by others)
            # Using capped settlement_value_usd() to match extraction
            member_settlement_owed = pl.lpSum(
                use_points[(item.item_id, opt.program_code, owner_id)]
                * settlement_value_usd(
                    program=opt.program_code,
                    points_used=opt.points_required * item.party_size,
                    cash_cost=item.cash_cost * item.party_size,
                    surcharge=opt.surcharge * item.party_size,
                )
                for item in booking_items
                if item.member_id == member.user_id
                for opt in item.points_options
                for owner_id in pool.by_member.keys()
                if owner_id != member.user_id  # Only cross-member (self-settlement = 0)
                and (item.item_id, opt.program_code, owner_id) in use_points
            )
            
            m += member_settlement_owed <= member.max_settlement_owed, \
                f"max_settlement_{member.user_id}"
            
            logger.info(f"[GroupILP] Settlement constraint for {member.user_id}: "
                       f"<= ${member.max_settlement_owed}")
    
    # 4c. Combined effective budget constraint (optional, if member opts in)
    for member in members:
        if member.include_settlement_in_budget and member.max_cash_budget is not None:
            # member_cash and member_surcharges should be computed already above
            # Need to recompute for this member
            member_cash_for_effective = pl.lpSum(
                pay_cash[item.item_id] * item.cash_cost * item.party_size
                for item in booking_items
                if item.member_id == member.user_id
            )
            member_surcharges_for_effective = pl.lpSum(
                use_points[(item.item_id, opt.program_code, owner_id)] 
                    * opt.surcharge * item.party_size
                for item in booking_items
                for opt in item.points_options
                for owner_id in pool.by_member.keys()
                if item.member_id == member.user_id
                and (item.item_id, opt.program_code, owner_id) in use_points
            )
            member_settlement_for_effective = pl.lpSum(
                use_points[(item.item_id, opt.program_code, owner_id)]
                * settlement_value_usd(
                    program=opt.program_code,
                    points_used=opt.points_required * item.party_size,
                    cash_cost=item.cash_cost * item.party_size,
                    surcharge=opt.surcharge * item.party_size,
                )
                for item in booking_items
                if item.member_id == member.user_id
                for opt in item.points_options
                for owner_id in pool.by_member.keys()
                if owner_id != member.user_id
                and (item.item_id, opt.program_code, owner_id) in use_points
            )
            
            effective_oop = (member_cash_for_effective + member_surcharges_for_effective 
                           + member_settlement_for_effective)
            m += effective_oop <= member.max_cash_budget, f"effective_budget_{member.user_id}"
            
            logger.info(f"[GroupILP] Effective budget constraint for {member.user_id}: "
                       f"cash + surcharges + settlement <= ${member.max_cash_budget}")
    
    # 5. Max subsidy constraint (optional, global override)
    if max_subsidy_per_member is not None:
        for owner_id in pool.by_member.keys():
            subsidy_points = pl.lpSum(
                use_points[(item.item_id, opt.program_code, owner_id)]
                    * opt.points_required * item.party_size
                for item in booking_items
                for opt in item.points_options
                if item.member_id != owner_id
                and (item.item_id, opt.program_code, owner_id) in use_points
            )
            m += subsidy_points * 0.015 <= max_subsidy_per_member, f"max_subsidy_{owner_id}"

    # 5b. Per-member cross-member contribution cap (maxPointValueContributionUsd).
    # Limits the USD value of points a member spends on OTHER members' bookings.
    # Valued at a flat 1.5¢/pt to match the global subsidy constraint above.
    for owner_id in pool.by_member.keys():
        owner = member_lookup.get(owner_id)
        cap = getattr(owner, "max_point_value_contribution_usd", None) if owner else None
        if cap is None:
            continue
        contrib_points = pl.lpSum(
            use_points[(item.item_id, opt.program_code, owner_id)]
                * opt.points_required * item.party_size
            for item in booking_items
            for opt in item.points_options
            if item.member_id != owner_id
            and (item.item_id, opt.program_code, owner_id) in use_points
        )
        m += contrib_points * 0.015 <= cap, f"max_contrib_{owner_id}"
    
    # 6. Combined group budget constraint (with slack in relaxed mode)
    if max_group_budget is not None:
        total_cash_paid = pl.lpSum(
            pay_cash[item.item_id] * item.cash_cost * item.party_size
            for item in booking_items
        )
        total_surcharges = pl.lpSum(
            use_points[(item.item_id, opt.program_code, owner_id)] 
                * opt.surcharge * item.party_size
            for item in booking_items
            for opt in item.points_options
            for owner_id in pool.by_member.keys()
            if (item.item_id, opt.program_code, owner_id) in use_points
        )
        
        group_total = total_cash_paid + total_surcharges
        
        if mode == SolveMode.RELAXED and slack_group is not None:
            m += group_total <= max_group_budget + slack_group, "group_budget"
        else:
            m += group_total <= max_group_budget, "group_budget"
    
    # 7. Minimax constraint (relaxed mode only)
    if mode == SolveMode.RELAXED and slack_max_member is not None:
        for member_id, slack_var in slack_member.items():
            m += slack_var <= slack_max_member, f"minimax_{member_id}"
    
    # 8. BALANCED POINTS USAGE CONSTRAINT
    # When enabled, limit per-member points usage to promote even distribution
    if balance_points_usage and len(members) > 1:
        # Calculate total points available across all members
        total_available_points = sum(
            sum(owner_points.values())
            for owner_points in pool.by_member.values()
        )
        
        # Calculate max points per member (with 50% buffer for flexibility)
        # This prevents one member from using all the points
        max_points_per_member = int((total_available_points / len(members)) * 1.5)
        
        if max_points_per_member > 0:
            for owner_id in pool.by_member.keys():
                # Sum up all points this owner uses across all items
                owner_points_used = pl.lpSum(
                    use_points[(item.item_id, opt.program_code, owner_id)] 
                        * opt.points_required * item.party_size
                    for item in booking_items
                    for opt in item.points_options
                    if (item.item_id, opt.program_code, owner_id) in use_points
                )
                
                m += owner_points_used <= max_points_per_member, f"balance_{owner_id}"
            
            logger.info(f"[GroupILP] Balance constraint: max {max_points_per_member:,} pts/member "
                       f"(total pool: {total_available_points:,})")
    
    # Log optimization context
    logger.info(f"[GroupILP] Mode={mode.value}, {len(members)} members, {len(booking_items)} items, "
               f"{len(use_points)} point vars, {len(transfer)} transfer vars, "
               f"{len(slack_member)} member slack vars")
    for owner_id, owner_points in pool.by_member.items():
        total_pts = sum(owner_points.values())
        budget = member_budgets.get(owner_id, "unlimited")
        logger.info(f"  Pool[{owner_id}]: {total_pts:,} pts, budget=${budget}")
    
    # =========================================================================
    # SOLVE
    # =========================================================================
    
    solver = pl.PULP_CBC_CMD(msg=False, timeLimit=time_limit_s)
    m.solve(solver)
    
    solve_time_ms = int((time.time() - start_time) * 1000)
    status = pl.LpStatus[m.status]
    objective_value = pl.value(m.objective) if m.status == pl.LpStatusOptimal else None
    
    logger.info(f"[GroupILP] Solve complete: status={status}, time={solve_time_ms}ms, "
               f"objective={objective_value}")
    
    if status != "Optimal":
        logger.warning(f"[GroupILP] Mode={mode.value} status={status}, no solution found")
        return _build_fallback_solution(booking_items, members, all_cash_cost), status
    
    # =========================================================================
    # EXTRACT SOLUTION
    # =========================================================================
    
    solution = _extract_group_solution(
        booking_items=booking_items,
        members=members,
        pool=pool,
        pay_cash=pay_cash,
        use_points=use_points,
        transfer=transfer,
        transfer_graph=transfer_graph,
        all_cash_cost=all_cash_cost,
    )
    
    # Add mode-specific metadata
    solution.is_relaxed = (mode == SolveMode.RELAXED)
    
    if mode == SolveMode.RELAXED:
        # Compute budget overruns from slack values
        member_overrun_usd = {}
        for member_id, slack_var in slack_member.items():
            slack_value = pl.value(slack_var) or 0.0
            if slack_value > 0.01:
                member_overrun_usd[member_id] = round(slack_value, 2)
        
        group_overrun = round(pl.value(slack_group) or 0.0, 2) if slack_group else 0.0
        max_member_overrun = round(pl.value(slack_max_member) or 0.0, 2) if slack_max_member else 0.0
        if not max_member_overrun and member_overrun_usd:
            max_member_overrun = max(member_overrun_usd.values())
        
        total_overrun = sum(member_overrun_usd.values()) + group_overrun
        
        solution.budget_overrun = BudgetOverrunData(
            group_overrun_usd=group_overrun,
            member_overrun_usd=member_overrun_usd,
            max_member_overrun_usd=max_member_overrun,
            total_overrun_usd=round(total_overrun, 2),
        )
        
        solution.solve_meta = SolveMetaData(
            status=OptimizationStatus.OPTIMAL_RELAXED,
            is_relaxed=True,
            solver="CBC",
            time_limit_s=time_limit_s,
            solve_time_ms=solve_time_ms,
            objective_value=objective_value,
            relaxation_summary=get_relaxation_config(),
        )
        
        solution.status = "Relaxed"
        solution.message = f"Closest solution found (exceeds budget by ${total_overrun:.2f})"
        
        logger.info(f"[GroupILP] Relaxed solution: overrun=${total_overrun:.2f}, "
                   f"member_overruns={member_overrun_usd}")
    else:
        solution.solve_meta = SolveMetaData(
            status=OptimizationStatus.OPTIMAL_STRICT,
            is_relaxed=False,
            solver="CBC",
            time_limit_s=time_limit_s,
            solve_time_ms=solve_time_ms,
            objective_value=objective_value,
        )
    
    return solution, status


def minimize_group_out_of_pocket(
    members: List[GroupMember],
    booking_items: List[MemberBookingItem],
    pool: GroupPointsPool,
    *,
    allow_cross_member_points: bool = True,
    max_subsidy_per_member: Optional[float] = None,
    transfer_graph: Optional[Dict] = None,
    max_group_budget: Optional[float] = None,
    balance_points_usage: bool = True,
) -> GroupOOPSolution:
    """
    Solve ILP to minimize total group out-of-pocket cost.
    
    BACKWARD COMPATIBLE WRAPPER: Calls solve_group_ilp with STRICT mode.
    For two-phase solve (strict → relaxed), use minimize_group_out_of_pocket_two_phase().
    
    Args:
        members: List of GroupMember objects
        booking_items: All items to be booked (flights + hotels for all members)
        pool: Aggregated points pool from aggregate_group_points()
        allow_cross_member_points: Allow using one member's points for another
        max_subsidy_per_member: Max USD value one member can contribute for others
        transfer_graph: Transfer graph (defaults to EXTENDED_TRANSFER_GRAPH)
        max_group_budget: Combined group budget limit (sum of all member budgets)
        balance_points_usage: If True, distribute points usage evenly across members (default True)
        
    Returns:
        GroupOOPSolution with allocations, transfers, and settlements
    """
    solution, _ = solve_group_ilp(
        members=members,
        booking_items=booking_items,
        pool=pool,
        mode=SolveMode.STRICT,
        allow_cross_member_points=allow_cross_member_points,
        max_subsidy_per_member=max_subsidy_per_member,
        transfer_graph=transfer_graph,
        max_group_budget=max_group_budget,
        balance_points_usage=balance_points_usage,
    )
    return solution


def minimize_group_out_of_pocket_two_phase(
    members: List[GroupMember],
    booking_items: List[MemberBookingItem],
    pool: GroupPointsPool,
    *,
    allow_cross_member_points: bool = True,
    max_subsidy_per_member: Optional[float] = None,
    transfer_graph: Optional[Dict] = None,
    max_group_budget: Optional[float] = None,
    balance_points_usage: bool = True,
) -> Tuple[GroupOOPSolution, SolveMetaData]:
    """
    Two-phase solve: STRICT → RELAXED fallback.
    
    Phase 1: Try strict solve (hard budget constraints)
    Phase 2: If strict infeasible, try relaxed solve (soft budgets with slack)
    
    This ensures we always return the "closest" solution when within-budget
    is not possible.
    
    Args:
        members: List of GroupMember objects
        booking_items: All items to be booked
        pool: Aggregated points pool
        allow_cross_member_points: Allow cross-member point usage
        max_subsidy_per_member: Max subsidy per member
        transfer_graph: Transfer graph
        max_group_budget: Combined group budget
        balance_points_usage: If True, distribute points usage evenly across members (default True)
        
    Returns:
        Tuple of (GroupOOPSolution, SolveMetaData)
    """
    start_time = time.time()
    
    if not booking_items:
        meta = SolveMetaData(
            status=OptimizationStatus.OPTIMAL_STRICT,
            solve_time_ms=0,
        )
        return GroupOOPSolution(status="Optimal", message="No items to optimize"), meta
    
    # Calculate all-cash cost for fallback reference
    all_cash_cost = sum(
        (item.cash_cost or 500.0) * item.party_size 
        for item in booking_items
    )
    
    # Time allocation across 3 phases: 40%, 40%, 20%
    # Unconstrained solve is simpler (fewer constraints) so needs less time
    phase1_time_limit = max(5, GROUP_SOLVE_TIME_LIMIT_S * 2 // 5)  # 40% = 24s
    phase2_time_limit = max(5, GROUP_SOLVE_TIME_LIMIT_S * 2 // 5)  # 40% = 24s  
    phase3_time_limit = max(5, GROUP_SOLVE_TIME_LIMIT_S // 5)      # 20% = 12s
    
    # =========================================================================
    # PHASE 1: STRICT SOLVE
    # =========================================================================
    logger.info("[TwoPhase] Phase 1: Attempting STRICT solve...")
    
    strict_solution, strict_status = solve_group_ilp(
        members=members,
        booking_items=booking_items,
        pool=pool,
        mode=SolveMode.STRICT,
        allow_cross_member_points=allow_cross_member_points,
        max_subsidy_per_member=max_subsidy_per_member,
        transfer_graph=transfer_graph,
        max_group_budget=max_group_budget,
        time_limit_s=phase1_time_limit,
        balance_points_usage=balance_points_usage,
    )
    
    phase1_time = int((time.time() - start_time) * 1000)
    
    if strict_status == "Optimal":
        logger.info(f"[TwoPhase] STRICT solve succeeded in {phase1_time}ms")
        
        meta = SolveMetaData(
            status=OptimizationStatus.OPTIMAL_STRICT,
            is_relaxed=False,
            solver="CBC",
            solve_time_ms=phase1_time,
            objective_value=strict_solution.total_group_oop,
        )
        strict_solution.solve_meta = meta
        return strict_solution, meta
    
    strict_infeasible_reason = f"Strict solve status: {strict_status}"
    logger.warning(f"[TwoPhase] STRICT solve failed: {strict_infeasible_reason}")
    
    # =========================================================================
    # PHASE 2: RELAXED SOLVE
    # =========================================================================
    logger.info("[TwoPhase] Phase 2: Attempting RELAXED solve...")
    
    relaxed_solution, relaxed_status = solve_group_ilp(
        members=members,
        booking_items=booking_items,
        pool=pool,
        mode=SolveMode.RELAXED,
        allow_cross_member_points=allow_cross_member_points,
        max_subsidy_per_member=max_subsidy_per_member,
        transfer_graph=transfer_graph,
        max_group_budget=max_group_budget,
        time_limit_s=phase2_time_limit,
        balance_points_usage=balance_points_usage,
    )
    
    total_time = int((time.time() - start_time) * 1000)
    
    if relaxed_status == "Optimal":
        logger.info(f"[TwoPhase] RELAXED solve succeeded in {total_time}ms")
        
        # Update metadata with phase info
        if relaxed_solution.solve_meta:
            relaxed_solution.solve_meta.strict_infeasible_reason = strict_infeasible_reason
            relaxed_solution.solve_meta.solve_time_ms = total_time
        else:
            relaxed_solution.solve_meta = SolveMetaData(
                status=OptimizationStatus.OPTIMAL_RELAXED,
                is_relaxed=True,
                solver="CBC",
                solve_time_ms=total_time,
                objective_value=relaxed_solution.total_group_oop,
                strict_infeasible_reason=strict_infeasible_reason,
                relaxation_summary=get_relaxation_config(),
            )
        
        return relaxed_solution, relaxed_solution.solve_meta
    
    # =========================================================================
    # PHASE 3: UNCONSTRAINED SOLVE (remove all budget constraints)
    # Like solo trips, try to find the "closest" itinerary even if over budget
    # =========================================================================
    
    # Skip Phase 3 if both previous phases timed out - it would likely timeout too
    # Only attempt unconstrained if previous phases returned quickly (infeasible/unbounded)
    elapsed_so_far = time.time() - start_time
    both_timed_out = (
        strict_status not in ("Optimal", "Infeasible", "Unbounded") and
        relaxed_status not in ("Optimal", "Infeasible", "Unbounded")
    )
    
    if both_timed_out and elapsed_so_far > GROUP_SOLVE_TIME_LIMIT_S * 0.8:
        logger.warning(f"[TwoPhase] Skipping Phase 3 - previous phases timed out "
                      f"(elapsed: {elapsed_so_far:.1f}s)")
        total_time = int((time.time() - start_time) * 1000)
        
        meta = SolveMetaData(
            status=OptimizationStatus.INFEASIBLE_NO_OPTIONS,
            is_relaxed=False,
            solver="CBC",
            solve_time_ms=total_time,
            strict_infeasible_reason=(
                f"Solver timeout. Strict: {strict_status}, Relaxed: {relaxed_status}"
            ),
        )
        
        fallback = GroupOOPSolution(
            status="Infeasible",
            message="Optimization timed out. Try reducing the number of travelers or destinations.",
            all_cash_cost=all_cash_cost,
            solve_meta=meta,
        )
        return fallback, meta
    
    logger.info("[TwoPhase] Phase 3: Attempting UNCONSTRAINED solve (no budget constraints)...")
    
    # Create members with no budget constraints
    unconstrained_members = []
    for m in members:
        unconstrained_member = GroupMember(
            user_id=m.user_id,
            name=m.name,
            role=m.role,
            departure_airport=m.departure_airport,
            arrival_airport=m.arrival_airport,
            travel_dates=m.travel_dates,
            cabin_preference=m.cabin_preference,
            points_balances=m.points_balances.copy(),
            max_cash_budget=None,  # Remove budget constraint
            willing_to_share_points=m.willing_to_share_points,
            party_size=m.party_size,
            max_settlement_owed=None,  # Remove settlement constraint
            include_settlement_in_budget=False,
        )
        unconstrained_members.append(unconstrained_member)
    
    unconstrained_solution, unconstrained_status = solve_group_ilp(
        members=unconstrained_members,
        booking_items=booking_items,
        pool=pool,
        mode=SolveMode.STRICT,  # Use STRICT mode but without budget constraints
        allow_cross_member_points=allow_cross_member_points,
        max_subsidy_per_member=None,  # Remove subsidy constraint too
        transfer_graph=transfer_graph,
        max_group_budget=None,  # No group budget constraint
        time_limit_s=phase3_time_limit,  # Less time needed - simpler problem
        balance_points_usage=balance_points_usage,
    )
    
    total_time = int((time.time() - start_time) * 1000)
    
    if unconstrained_status == "Optimal":
        logger.info(f"[TwoPhase] UNCONSTRAINED solve succeeded in {total_time}ms")
        
        # Calculate budget overruns for each member
        member_overrun_usd = {}
        for m in members:
            if m.max_cash_budget is not None:
                member_oop = unconstrained_solution.oop_per_member.get(m.user_id, 0)
                overrun = max(0, member_oop - m.max_cash_budget)
                if overrun > 0.01:
                    member_overrun_usd[m.user_id] = round(overrun, 2)
        
        # Calculate group budget overrun
        group_overrun = 0.0
        if max_group_budget is not None:
            group_overrun = max(0, unconstrained_solution.total_group_oop - max_group_budget)
        
        max_member_overrun = max(member_overrun_usd.values()) if member_overrun_usd else 0.0
        total_overrun = sum(member_overrun_usd.values()) + group_overrun
        
        unconstrained_solution.is_relaxed = True
        unconstrained_solution.status = "Closest"
        unconstrained_solution.message = (
            f"Closest possible itinerary found (exceeds budget by ${total_overrun:.2f}). "
            f"No options exist within budget constraints."
        )
        
        unconstrained_solution.budget_overrun = BudgetOverrunData(
            group_overrun_usd=round(group_overrun, 2),
            member_overrun_usd=member_overrun_usd,
            max_member_overrun_usd=round(max_member_overrun, 2),
            total_overrun_usd=round(total_overrun, 2),
        )
        
        unconstrained_solution.solve_meta = SolveMetaData(
            status=OptimizationStatus.OPTIMAL_RELAXED,  # Use RELAXED status for over-budget
            is_relaxed=True,
            solver="CBC",
            solve_time_ms=total_time,
            objective_value=unconstrained_solution.total_group_oop,
            strict_infeasible_reason=(
                f"Unconstrained solve used (budgets removed). "
                f"Original: Strict={strict_status}, Relaxed={relaxed_status}"
            ),
            relaxation_summary={
                "type": "unconstrained",
                "reason": "Both strict and relaxed solves failed, budget constraints removed",
            },
        )
        
        logger.info(f"[TwoPhase] Unconstrained solution: OOP=${unconstrained_solution.total_group_oop:.2f}, "
                   f"overrun=${total_overrun:.2f}, member_overruns={member_overrun_usd}")
        
        return unconstrained_solution, unconstrained_solution.solve_meta
    
    # =========================================================================
    # INFEASIBLE: No solution found even without constraints
    # =========================================================================
    logger.error(f"[TwoPhase] All three phases failed. "
                f"Status: strict={strict_status}, relaxed={relaxed_status}, unconstrained={unconstrained_status}")
    
    meta = SolveMetaData(
        status=OptimizationStatus.INFEASIBLE_NO_OPTIONS,
        is_relaxed=False,
        solver="CBC",
        solve_time_ms=total_time,
        strict_infeasible_reason=(
            f"No feasible booking combination found. "
            f"Strict: {strict_status}, Relaxed: {relaxed_status}, Unconstrained: {unconstrained_status}"
        ),
    )
    
    # Return empty solution with metadata
    fallback = GroupOOPSolution(
        status="Infeasible",
        message="No feasible booking combination found with current constraints",
        all_cash_cost=all_cash_cost,
        solve_meta=meta,
    )
    
    return fallback, meta


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
    """
    Check if an owner can provide points for a program (directly or via transfer).
    
    This is critical for group optimization - it determines which members can
    contribute points for each booking option.
    
    Args:
        owner_id: Member ID
        program: Target program code (e.g., "UA", "HH")
        pool: Group points pool
        transfer_graph: Transfer paths between programs
        member_lookup: Member ID to GroupMember mapping
        
    Returns:
        True if member can provide points for this program
    """
    owner_points = pool.by_member.get(owner_id, {})
    member = member_lookup.get(owner_id)
    
    # Check willing to share (default to True if not specified)
    if member and not member.willing_to_share_points:
        logger.debug(f"  Member {owner_id} not willing to share points")
        return False
    
    # Check if owner has any points at all
    if not owner_points:
        logger.debug(f"  Member {owner_id} has no points in pool")
        return False
    
    # Direct balance - check both cases (upper and lower)
    program_upper = program.upper()
    program_lower = program.lower()
    direct_balance = (
        owner_points.get(program, 0) + 
        owner_points.get(program_upper, 0) + 
        owner_points.get(program_lower, 0)
    )
    
    if direct_balance > 0:
        logger.debug(f"  Member {owner_id} has {direct_balance} direct {program} points")
        return True
    
    # Via transfer from bank programs
    for bank, balance in owner_points.items():
        if balance <= 0:
            continue
        
        # Check if this is a transferable bank program
        bank_lower = bank.lower()
        if bank_lower in BANK_PROGRAMS and bank_lower in transfer_graph:
            # Check if this bank can transfer to the target program
            if program_upper in transfer_graph[bank_lower]:
                logger.debug(f"  Member {owner_id} can transfer {bank} -> {program}")
                return True
    
    logger.debug(f"  Member {owner_id} cannot provide {program} points")
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
                    total_cash = item.cash_cost * party_size
                    
                    # Issue 4: Use capped settlement_value_usd() instead of raw FMV
                    # This ensures extraction matches ILP constraint
                    points_value = settlement_value_usd(
                        program=opt.program_code,
                        points_used=points_used,
                        cash_cost=total_cash,
                        surcharge=surcharge,
                    )
                    
                    # Warn if cash_avoided is zero or negative (redemption worse than cash)
                    cash_avoided = total_cash - surcharge
                    if cash_avoided <= 0:
                        logger.warning(
                            f"[Settlement] Zero/negative cash avoided for {item.item_id}: "
                            f"cash=${total_cash:.2f}, surcharge=${surcharge:.2f}, "
                            f"settlement_value=$0.00 (points burned for no reimbursement)"
                        )
                    
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
                    
                    # Track for settlement (using capped value)
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
