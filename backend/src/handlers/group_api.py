"""
Group Travel API Handlers

API endpoint handlers for group OOP optimization, points pooling,
and settlement management.
"""

from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
import logging

from .group_oop_optimizer import (
    GroupMember,
    GroupPointsPool,
    MemberBookingItem,
    GroupPointsOption,
    GroupOOPSolution,
    MemberRole,
    minimize_group_out_of_pocket,
    group_solution_to_dict,
)
from .group_points_pooling import (
    aggregate_group_points,
    get_pool_summary,
    analyze_pool_coverage,
    find_points_sources,
)
from .cost_allocation import (
    allocate_costs,
    generate_settlement_instructions,
    generate_detailed_breakdown,
    CostAllocationConfig,
    ValuationMethod,
    allocation_to_dict,
)
from .fair_market_values import get_fair_market_value, get_cpp

logger = logging.getLogger(__name__)


# =============================================================================
# REQUEST MODELS
# =============================================================================

class OptimizeOOPOptions(BaseModel):
    """Options for group OOP optimization."""
    allow_cross_member_points: bool = Field(
        default=True,
        description="Allow one member's points to pay for another's booking"
    )
    max_subsidy_per_member: Optional[float] = Field(
        default=None,
        description="Max USD value one member can contribute for others"
    )
    valuation_method: str = Field(
        default="fair_market",
        description="Points valuation method: fair_market, actual, or fixed"
    )
    fixed_cpp: float = Field(
        default=1.5,
        description="Fixed CPP if using fixed valuation method"
    )
    include_hotels: bool = Field(
        default=True,
        description="Include hotels in optimization"
    )
    cabins: List[str] = Field(
        default=["Economy"],
        description="Cabin class preferences"
    )


class OptimizeOOPRequest(BaseModel):
    """Request body for group OOP optimization."""
    options: Optional[OptimizeOOPOptions] = None
    member_overrides: Optional[Dict[str, Dict[str, Any]]] = None


class SimulateAllocationRequest(BaseModel):
    """Request body for allocation simulation."""
    strategy: str = Field(default="minimize_group_oop")
    valuation_method: str = Field(default="fair_market")
    constraints: Optional[Dict[str, Any]] = None


class MarkSettlementPaidRequest(BaseModel):
    """Request body for marking a settlement as paid."""
    payment_method: str = Field(..., description="Payment method used (venmo, paypal, zelle, cash)")
    payment_reference: Optional[str] = Field(None, description="Transaction ID or reference")
    notes: Optional[str] = None


class ConfirmSettlementRequest(BaseModel):
    """Request body for confirming settlement receipt."""
    confirmed: bool
    notes: Optional[str] = None


# =============================================================================
# RESPONSE MODELS
# =============================================================================

class PointsPoolResponse(BaseModel):
    """Response for points pool endpoint."""
    total_by_program: Dict[str, int]
    by_member: Dict[str, Any]
    transfer_potential: Dict[str, List[str]]
    totals: Dict[str, Any]


class OptimizeOOPResponse(BaseModel):
    """Response for group OOP optimization."""
    status: str
    message: str
    summary: Dict[str, Any]
    per_member: Dict[str, Any]
    allocations: List[Dict[str, Any]]
    transfers: List[Dict[str, Any]]
    settlements: List[Dict[str, Any]]
    booking_order: List[Dict[str, Any]]
    points_remaining: Dict[str, Dict[str, int]]
    metadata: Dict[str, Any]


# =============================================================================
# HANDLER FUNCTIONS
# =============================================================================

async def handle_get_points_pool(
    trip_id: str,
    members_data: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Get aggregated points pool for a group.
    
    Args:
        trip_id: Trip ID
        members_data: List of member data dicts (from DB)
        
    Returns:
        Points pool summary
    """
    # Convert to GroupMember objects
    members = _convert_to_group_members(members_data)
    
    # Aggregate points
    pool = aggregate_group_points(members)
    
    # Get summary
    summary = get_pool_summary(pool, members)
    
    return summary


async def handle_optimize_oop(
    trip_id: str,
    members_data: List[Dict[str, Any]],
    booking_items_data: List[Dict[str, Any]],
    options: Optional[OptimizeOOPOptions] = None,
) -> Dict[str, Any]:
    """
    Run group OOP optimization.
    
    This uses ALL members' points from the aggregated pool to minimize
    total out-of-pocket cost. Member budgets can be additive (combined).
    
    Args:
        trip_id: Trip ID
        members_data: List of member data dicts
        booking_items_data: List of booking item dicts (flights + hotels)
        options: Optimization options
        
    Returns:
        Complete optimization solution
    """
    if options is None:
        options = OptimizeOOPOptions()
    
    # Convert to GroupMember objects
    members = _convert_to_group_members(members_data)
    
    # Log members and their points for debugging
    logger.info(f"Group OOP optimization for trip {trip_id}")
    logger.info(f"  Members: {len(members)}")
    for m in members:
        pts_summary = {k: v for k, v in m.points_balances.items() if v > 0}
        logger.info(f"    {m.user_id} ({m.name}): points={pts_summary}, "
                   f"budget={m.max_cash_budget}, willing_to_share={m.willing_to_share_points}")
    
    # Aggregate points from ALL members
    pool = aggregate_group_points(members)
    
    logger.info(f"  Aggregated pool: {pool.total_by_program}")
    logger.info(f"  Shareable pool: {pool.shareable_pool}")
    logger.info(f"  Total value: ${pool.total_value:,.2f}")
    
    # Convert booking items
    booking_items = _convert_to_booking_items(booking_items_data, pool)
    
    logger.info(f"  Booking items: {len(booking_items)} items")
    for item in booking_items:
        logger.info(f"    {item.item_id}: for={item.member_id}, "
                   f"cash=${item.cash_cost:.2f}, party_size={item.party_size}, "
                   f"points_options={len(item.points_options)}")
    
    # Calculate combined group budget (sum of all member budgets)
    # This allows group members to pool their budgets together
    combined_budget = None
    individual_budgets = [m.max_cash_budget for m in members if m.max_cash_budget]
    if individual_budgets:
        combined_budget = sum(individual_budgets)
        logger.info(f"  Combined group budget: ${combined_budget:,.2f} "
                   f"(from {len(individual_budgets)} members)")
    
    # Run optimization with ALL members' points and combined budget
    solution = minimize_group_out_of_pocket(
        members=members,
        booking_items=booking_items,
        pool=pool,
        allow_cross_member_points=options.allow_cross_member_points,
        max_subsidy_per_member=options.max_subsidy_per_member,
        max_group_budget=combined_budget,  # Pass combined budget
    )
    
    # Calculate detailed cost allocation
    config = CostAllocationConfig(
        valuation_method=ValuationMethod(options.valuation_method),
        fixed_cpp=options.fixed_cpp,
    )
    allocation = allocate_costs(solution, members, config)
    
    # Generate detailed breakdown
    detailed = generate_detailed_breakdown(allocation, solution, members)
    
    # Build response
    member_lookup = {m.user_id: m for m in members}
    
    return _build_optimization_response(
        solution=solution,
        allocation=allocation,
        detailed=detailed,
        members=members,
        pool=pool,
    )


async def handle_simulate_allocation(
    trip_id: str,
    members_data: List[Dict[str, Any]],
    request: SimulateAllocationRequest,
) -> Dict[str, Any]:
    """
    Simulate cost allocation without full optimization.
    
    This provides a quick preview of expected settlements.
    
    Args:
        trip_id: Trip ID
        members_data: List of member data dicts
        request: Simulation request
        
    Returns:
        Projected allocation preview
    """
    members = _convert_to_group_members(members_data)
    pool = aggregate_group_points(members)
    
    # Estimate based on points contribution
    total_value = pool.total_value
    member_count = len(members)
    
    # Simple projection: assume equal benefit, actual contribution
    projected = {
        "simulation_id": f"sim_{trip_id}",
        "projected_outcome": {
            "total_group_oop": 0,  # Would need actual booking data
            "estimated_total_value": total_value,
        },
        "projected_per_member": {},
        "warnings": [],
        "recommendations": [],
    }
    
    for member in members:
        member_points = pool.by_member.get(member.user_id, {})
        member_value = sum(
            get_fair_market_value(prog, bal) 
            for prog, bal in member_points.items()
        )
        
        # Assume equal consumption
        expected_consumption = total_value / member_count if member_count > 0 else 0
        projected_settlement = expected_consumption - member_value
        
        projected["projected_per_member"][member.user_id] = {
            "name": member.name,
            "contribution_value": round(member_value, 2),
            "expected_consumption": round(expected_consumption, 2),
            "projected_settlement": round(projected_settlement, 2),
            "direction": "owes" if projected_settlement > 0 else "receives",
        }
        
        # Generate warnings
        if abs(projected_settlement) > 500:
            projected["warnings"].append({
                "type": "large_settlement",
                "severity": "info",
                "message": f"{member.name} will {'owe' if projected_settlement > 0 else 'receive'} ~${abs(projected_settlement):.0f}",
                "member": member.user_id,
            })
    
    # Recommendations
    if request.strategy == "minimize_group_oop":
        projected["recommendations"].append({
            "strategy": "minimize_group_oop",
            "description": "Minimize total cash paid by maximizing points usage",
            "is_current": True,
        })
    
    projected["recommendations"].append({
        "strategy": "equal_split",
        "description": "Split all costs equally - requires some cash payments",
        "is_current": request.strategy == "equal_split",
    })
    
    return projected


async def handle_get_settlements(
    trip_id: str,
    settlements_data: List[Dict[str, Any]],
    members_data: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Get settlements for a trip.
    
    Args:
        trip_id: Trip ID
        settlements_data: List of settlement dicts from DB
        members_data: List of member data dicts
        
    Returns:
        Settlements with payment instructions
    """
    from .group_oop_optimizer import SettlementEntry
    
    members = _convert_to_group_members(members_data)
    member_lookup = {m.user_id: m for m in members}
    
    # Convert to SettlementEntry objects
    settlements = []
    for s in settlements_data:
        settlements.append(SettlementEntry(
            from_member=s.get("from_member_id"),
            from_member_name=s.get("from_member_name", s.get("from_member_id")),
            to_member=s.get("to_member_id"),
            to_member_name=s.get("to_member_name", s.get("to_member_id")),
            amount_usd=s.get("amount", 0),
            reason=s.get("reason", "Settlement"),
            breakdown=s.get("breakdown", []),
        ))
    
    # Generate instructions
    instructions = generate_settlement_instructions(settlements, member_lookup)
    
    return {
        "trip_id": trip_id,
        "settlements": instructions,
        "total_amount": sum(s.amount_usd for s in settlements),
        "settlement_count": len(settlements),
    }


async def handle_mark_settlement_paid(
    trip_id: str,
    settlement_id: str,
    request: MarkSettlementPaidRequest,
    user_id: str,
) -> Dict[str, Any]:
    """
    Mark a settlement as paid.
    
    Args:
        trip_id: Trip ID
        settlement_id: Settlement ID
        request: Payment details
        user_id: User making the request
        
    Returns:
        Updated settlement status
    """
    from datetime import datetime
    
    return {
        "settlement_id": settlement_id,
        "status": "paid",
        "paid_at": datetime.utcnow().isoformat() + "Z",
        "payment_method": request.payment_method,
        "payment_reference": request.payment_reference,
        "message": "Settlement marked as paid. Waiting for confirmation from recipient.",
    }


async def handle_confirm_settlement(
    trip_id: str,
    settlement_id: str,
    request: ConfirmSettlementRequest,
    user_id: str,
) -> Dict[str, Any]:
    """
    Confirm settlement receipt.
    
    Args:
        trip_id: Trip ID
        settlement_id: Settlement ID
        request: Confirmation details
        user_id: User making the request
        
    Returns:
        Updated settlement status
    """
    from datetime import datetime
    
    if request.confirmed:
        return {
            "settlement_id": settlement_id,
            "status": "confirmed",
            "confirmed_at": datetime.utcnow().isoformat() + "Z",
            "message": "Settlement confirmed! All parties are settled.",
        }
    else:
        return {
            "settlement_id": settlement_id,
            "status": "disputed",
            "message": "Settlement marked as disputed. Please contact the other party.",
        }


async def handle_get_settlements_status(
    trip_id: str,
    settlements_data: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Get overall settlement status for a trip.
    
    Args:
        trip_id: Trip ID
        settlements_data: List of settlement dicts from DB
        
    Returns:
        Status summary
    """
    status_counts = {"pending": 0, "paid": 0, "confirmed": 0, "disputed": 0}
    total_amount = 0.0
    settled_amount = 0.0
    
    for s in settlements_data:
        status = s.get("status", "pending")
        amount = s.get("amount", 0)
        
        status_counts[status] = status_counts.get(status, 0) + 1
        total_amount += amount
        
        if status in ("paid", "confirmed"):
            settled_amount += amount
    
    return {
        "trip_id": trip_id,
        "all_settled": status_counts["pending"] == 0 and status_counts["disputed"] == 0,
        "total_amount": round(total_amount, 2),
        "settled_amount": round(settled_amount, 2),
        "settlement_count": len(settlements_data),
        "status_summary": status_counts,
    }


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def _convert_to_group_members(members_data: List[Dict[str, Any]]) -> List[GroupMember]:
    """Convert member data dicts to GroupMember objects."""
    members = []
    
    for m in members_data:
        # Extract points balances
        points = {}
        if "points" in m:
            points = m["points"]
        elif "points_balances" in m:
            points = m["points_balances"]
        
        # Normalize points dict
        normalized_points = {}
        for prog, bal in points.items():
            if bal and int(bal) > 0:
                normalized_points[prog] = int(bal)
        
        # points_usage: "do_not_use" -> do not use for group; "freely" / "ask_before" -> allow use
        points_usage = m.get("points_usage") or "freely"
        willing = m.get("willing_to_share_points")
        if willing is None:
            willing = points_usage != "do_not_use"
        member = GroupMember(
            user_id=m.get("user_id") or m.get("userId") or m.get("member_id") or m.get("id"),
            name=m.get("name") or m.get("display_name") or m.get("user_id", "Unknown"),
            role=MemberRole(m.get("role", "member")),
            departure_airport=m.get("departure_airport") or m.get("origin_airport") or "JFK",
            arrival_airport=m.get("arrival_airport"),
            cabin_preference=m.get("cabin_preference") or m.get("cabin") or "Economy",
            points_balances=normalized_points,
            max_cash_budget=m.get("max_cash_budget") or m.get("max_budget"),
            willing_to_share_points=willing,
            party_size=m.get("party_size", 1),
        )
        members.append(member)
    
    return members


def _convert_to_booking_items(
    items_data: List[Dict[str, Any]],
    pool: GroupPointsPool,
) -> List[MemberBookingItem]:
    """
    Convert booking item data dicts to MemberBookingItem objects.
    
    Important: This determines which members can provide points for each booking.
    The ILP solver uses this to decide how to optimally allocate points across
    all group members.
    """
    from .transfer_strategy import EXTENDED_TRANSFER_GRAPH
    
    items = []
    
    for item in items_data:
        item_type = item.get("type") or item.get("item_type") or "flight"
        
        # Extract points options
        points_options = []
        raw_options = item.get("points_options") or item.get("award_options") or []
        
        for opt in raw_options:
            prog = opt.get("program_code") or opt.get("program") or ""
            points_req = opt.get("points_required") or opt.get("points") or 0
            surcharge = opt.get("surcharge") or opt.get("taxes") or opt.get("tax") or 0
            
            if prog and points_req > 0:
                prog_upper = prog.upper()
                
                # Find ALL members who can provide these points (direct or via transfer)
                available_from = set()
                
                for member_id, member_points in pool.by_member.items():
                    # Check direct balance (case-insensitive)
                    direct_balance = (
                        member_points.get(prog, 0) + 
                        member_points.get(prog_upper, 0) + 
                        member_points.get(prog.lower(), 0)
                    )
                    if direct_balance >= points_req:
                        available_from.add(member_id)
                        continue
                    
                    # Check via bank transfer
                    # Banks: chase, amex, citi, capitalone, bilt
                    for bank in ["chase", "amex", "citi", "capitalone", "bilt"]:
                        bank_balance = member_points.get(bank, 0)
                        if bank_balance <= 0:
                            continue
                        
                        # Check if this bank can transfer to the target program
                        if bank in EXTENDED_TRANSFER_GRAPH:
                            if prog_upper in EXTENDED_TRANSFER_GRAPH[bank]:
                                ratio = EXTENDED_TRANSFER_GRAPH[bank][prog_upper].get("ratio", 1.0)
                                # How many bank points needed?
                                bank_points_needed = int(points_req / ratio) if ratio > 0 else points_req
                                if bank_balance >= bank_points_needed:
                                    available_from.add(member_id)
                                    break
                
                points_options.append(GroupPointsOption(
                    program_code=prog_upper,
                    points_required=int(points_req),
                    surcharge=float(surcharge),
                    available_from=list(available_from),
                ))
                
                if available_from:
                    logger.debug(f"  Points option {prog_upper}: {points_req} pts, "
                               f"available from {len(available_from)} members: {list(available_from)}")
        
        booking_item = MemberBookingItem(
            item_id=item.get("item_id") or item.get("id") or f"item_{len(items)}",
            member_id=item.get("member_id") or item.get("for_member") or item.get("beneficiary"),
            item_type=item_type,
            description=item.get("description") or f"{item_type.title()} booking",
            cash_cost=float(item.get("cash_cost") or item.get("cash_price") or 0),
            points_options=points_options,
            origin=item.get("origin"),
            destination=item.get("destination"),
            date=item.get("date") or item.get("departure_date"),
            airline=item.get("airline"),
            hotel_name=item.get("hotel_name") or item.get("hotel"),
            nights=item.get("nights"),
            party_size=item.get("party_size", 1),
        )
        items.append(booking_item)
    
    return items


def _build_optimization_response(
    solution: GroupOOPSolution,
    allocation: Any,
    detailed: Dict[str, Any],
    members: List[GroupMember],
    pool: GroupPointsPool,
) -> Dict[str, Any]:
    """Build the full optimization response."""
    from datetime import datetime
    from dataclasses import asdict
    
    member_lookup = {m.user_id: m for m in members}
    
    # Build per-member response
    per_member = {}
    for member_id, breakdown in allocation.member_breakdowns.items():
        member = member_lookup.get(member_id)
        per_member[member_id] = {
            "member_name": breakdown.member_name,
            "cash_paid": breakdown.cash_paid,
            "points_used_for_them": breakdown.points_used_for_them,
            "points_contributed": breakdown.points_contributed,
            "contribution_value_usd": breakdown.points_value_contributed,
            "value_received_from_others": breakdown.value_received_from_others,
            "value_given_to_others": breakdown.value_given_to_others,
            "net_settlement": breakdown.net_settlement,
            "settlement_direction": breakdown.settlement_direction,
            "total_effective_cost": breakdown.total_effective_cost,
        }
    
    # Build booking order
    booking_order = []
    step = 1
    
    # Add transfers first
    for xfer in solution.transfer_plan:
        booking_order.append({
            "step": step,
            "type": "transfer",
            "actor_member_id": xfer.owner_member,
            "actor_member_name": xfer.owner_member_name,
            "action": f"Transfer {xfer.points_to_transfer:,} {xfer.from_program_name} → {xfer.to_program_name}",
            "action_url": xfer.portal_url,
            "depends_on_steps": [],
        })
        step += 1
    
    # Add wait step if needed
    max_wait = max([x.transfer_time_hours for x in solution.transfer_plan], default=0)
    if max_wait > 0:
        booking_order.append({
            "step": step,
            "type": "wait",
            "action": f"Wait for transfers to complete (up to {max_wait} hours)",
            "wait_hours": max_wait,
            "depends_on_steps": list(range(1, step)),
        })
        step += 1
    
    # Add bookings
    for alloc in solution.allocations:
        member_name = member_lookup.get(alloc.beneficiary_member, GroupMember(user_id="", name="")).name
        action = f"Book for {member_name}"
        if alloc.payment_type.value == "points":
            action += f" using {alloc.points_used:,} {alloc.program_name}"
        else:
            action += f" with cash (${alloc.cash_paid:.2f})"
        
        booking_order.append({
            "step": step,
            "type": "booking",
            "actor_member_id": alloc.points_owner or alloc.beneficiary_member,
            "actor_member_name": member_lookup.get(alloc.points_owner or alloc.beneficiary_member, GroupMember(user_id="", name="")).name,
            "action": action,
            "depends_on_steps": list(range(1, step)),
        })
        step += 1
    
    # Add settlements
    for settlement in solution.settlements:
        booking_order.append({
            "step": step,
            "type": "settlement",
            "actor_member_id": settlement.from_member,
            "actor_member_name": settlement.from_member_name,
            "action": f"{settlement.from_member_name} pays {settlement.to_member_name} ${settlement.amount_usd:.2f}",
            "depends_on_steps": list(range(1, step)),
        })
        step += 1
    
    return {
        "status": solution.status,
        "message": solution.message,
        "summary": {
            "total_group_oop": solution.total_group_oop,
            "all_cash_would_cost": solution.all_cash_cost,
            "total_savings": solution.total_savings,
            "savings_percentage": solution.savings_percentage,
            "total_points_used": sum(solution.points_used_per_member.values()),
            "num_members": len(members),
            "num_bookings": len(solution.allocations),
            "num_transfers": len(solution.transfer_plan),
            "num_settlements": len(solution.settlements),
        },
        "per_member": per_member,
        "allocations": [asdict(a) for a in solution.allocations],
        "transfers": [asdict(t) for t in solution.transfer_plan],
        "settlements": [asdict(s) for s in solution.settlements],
        "booking_order": booking_order,
        "points_remaining": solution.points_remaining,
        "metadata": {
            "created_at": datetime.utcnow().isoformat() + "Z",
            "valuation_method": allocation.valuation_method,
        },
    }
