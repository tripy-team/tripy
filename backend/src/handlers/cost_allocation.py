"""
Cost Allocation & Settlement Module

Handles fair cost allocation across group members and settlement calculations.
Ensures transparent, equitable distribution of costs based on:
- Who benefits from each booking
- Who contributes points
- Fair market valuation of points
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum
import logging

from .fair_market_values import get_fair_market_value, get_cpp, calculate_actual_cpp
from .group_oop_optimizer import (
    GroupMember,
    GroupOOPSolution,
    GroupPaymentAllocation,
    SettlementEntry,
    PaymentType,
)

logger = logging.getLogger(__name__)


# =============================================================================
# ENUMS & CONFIGURATION
# =============================================================================

class ValuationMethod(str, Enum):
    """Methods for valuing points in settlement calculations."""
    FAIR_MARKET = "fair_market"       # Industry-standard CPP values
    ACTUAL_REDEMPTION = "actual"      # Actual CPP achieved in this booking
    FIXED_RATE = "fixed"              # Fixed CPP for all programs


@dataclass
class CostAllocationConfig:
    """Configuration for cost allocation."""
    valuation_method: ValuationMethod = ValuationMethod.FAIR_MARKET
    fixed_cpp: float = 1.5            # Used if method is FIXED_RATE
    include_surcharges_in_split: bool = False  # Whether to split surcharges equally
    round_to_nearest: float = 0.01    # Rounding precision
    min_settlement_amount: float = 1.0  # Don't create settlements below this


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class MemberCostBreakdown:
    """Detailed cost breakdown for a single member."""
    member_id: str
    member_name: str
    
    # Direct cash payments (surcharges on their bookings + cash bookings)
    cash_paid: float = 0.0
    
    # Points consumption (what was used FOR this member)
    points_used_for_them: int = 0
    points_value_received: float = 0.0  # Value of points others used for them
    
    # Points contribution (what this member PROVIDED)
    points_contributed: int = 0
    points_value_contributed: float = 0.0
    
    # Cross-member flows
    value_received_from_others: float = 0.0  # Points value others gave for my bookings
    value_given_to_others: float = 0.0       # Points value I gave for others' bookings
    
    # Settlement
    net_settlement: float = 0.0       # Positive = owes, Negative = receives
    settlement_direction: str = "even"  # "owes", "receives", or "even"
    
    # Final cost
    total_effective_cost: float = 0.0  # cash_paid + net_settlement
    
    # Comparison
    would_cost_solo: float = 0.0      # What this member would pay traveling alone
    savings_vs_solo: float = 0.0      # Savings from group optimization


@dataclass
class GroupCostAllocation:
    """Complete cost allocation for a group."""
    member_breakdowns: Dict[str, MemberCostBreakdown] = field(default_factory=dict)
    settlements: List[SettlementEntry] = field(default_factory=list)
    
    # Summary
    total_group_cost: float = 0.0
    all_cash_would_cost: float = 0.0
    total_savings: float = 0.0
    savings_percentage: float = 0.0
    
    # Verification (should sum to zero)
    settlement_balance: float = 0.0
    
    # Config used
    valuation_method: str = "fair_market"


# =============================================================================
# MAIN ALLOCATION FUNCTION
# =============================================================================

def allocate_costs(
    solution: GroupOOPSolution,
    members: List[GroupMember],
    config: Optional[CostAllocationConfig] = None,
) -> GroupCostAllocation:
    """
    Allocate costs to each member with full transparency.
    
    The algorithm:
    1. For each member, calculate CONSUMPTION (bookings FOR them)
    2. For each member, calculate CONTRIBUTION (points they PROVIDED)
    3. Calculate NET position: received - given
    4. Generate settlements to balance
    
    Args:
        solution: Optimization solution with allocations
        members: Group members
        config: Configuration for valuation method
        
    Returns:
        GroupCostAllocation with detailed breakdowns and settlements
    """
    if config is None:
        config = CostAllocationConfig()
    
    member_lookup = {m.user_id: m for m in members}
    breakdowns: Dict[str, MemberCostBreakdown] = {}
    
    # Initialize breakdowns for all members
    for member in members:
        breakdowns[member.user_id] = MemberCostBreakdown(
            member_id=member.user_id,
            member_name=member.name,
        )
    
    # Process each allocation
    for alloc in solution.allocations:
        beneficiary = alloc.beneficiary_member
        
        if beneficiary not in breakdowns:
            # Handle unknown beneficiary
            continue
        
        breakdown = breakdowns[beneficiary]
        
        # Cash paid goes to beneficiary
        breakdown.cash_paid += alloc.cash_paid
        
        if alloc.payment_type == PaymentType.POINTS:
            # Calculate points value based on config
            points_value = _calculate_points_value(
                program=alloc.program_used,
                points=alloc.points_used,
                cash_price=None,  # We don't track original cash price per item
                surcharge=alloc.cash_paid,
                config=config,
            )
            
            breakdown.points_used_for_them += alloc.points_used or 0
            
            owner = alloc.points_owner
            if owner and owner != beneficiary:
                # Someone else's points were used for this member
                breakdown.value_received_from_others += points_value
                
                # Track contributor side
                if owner in breakdowns:
                    breakdowns[owner].value_given_to_others += points_value
                    breakdowns[owner].points_contributed += alloc.points_used or 0
                    breakdowns[owner].points_value_contributed += points_value
            else:
                # Member used their own points
                breakdown.points_contributed += alloc.points_used or 0
                breakdown.points_value_contributed += points_value
    
    # Calculate net settlements and totals
    total_group_cost = 0.0
    
    for member_id, breakdown in breakdowns.items():
        # Net settlement: positive = owes, negative = receives
        breakdown.net_settlement = round(
            breakdown.value_received_from_others - breakdown.value_given_to_others,
            2
        )
        
        if breakdown.net_settlement > config.min_settlement_amount:
            breakdown.settlement_direction = "owes"
        elif breakdown.net_settlement < -config.min_settlement_amount:
            breakdown.settlement_direction = "receives"
        else:
            breakdown.settlement_direction = "even"
            breakdown.net_settlement = 0.0
        
        # Total effective cost = cash paid + net settlement
        breakdown.total_effective_cost = round(
            breakdown.cash_paid + breakdown.net_settlement,
            2
        )
        
        total_group_cost += breakdown.cash_paid
    
    # Generate settlements
    settlements = _generate_settlements(breakdowns, member_lookup, config)
    
    # Verify balance (should sum to zero)
    settlement_balance = sum(s.amount_usd for s in settlements if s.from_member) - \
                        sum(s.amount_usd for s in settlements if s.to_member)
    
    return GroupCostAllocation(
        member_breakdowns=breakdowns,
        settlements=settlements,
        total_group_cost=round(total_group_cost, 2),
        all_cash_would_cost=round(solution.all_cash_cost, 2),
        total_savings=round(solution.total_savings, 2),
        savings_percentage=round(solution.savings_percentage, 1),
        settlement_balance=round(settlement_balance, 2),
        valuation_method=config.valuation_method.value,
    )


def _calculate_points_value(
    program: str,
    points: int,
    cash_price: Optional[float],
    surcharge: float,
    config: CostAllocationConfig,
) -> float:
    """Calculate points value based on configuration."""
    if points is None or points <= 0:
        return 0.0
    
    if config.valuation_method == ValuationMethod.FAIR_MARKET:
        return get_fair_market_value(program, points)
    
    elif config.valuation_method == ValuationMethod.ACTUAL_REDEMPTION:
        if cash_price and cash_price > 0:
            # Use actual CPP achieved
            actual_cpp = calculate_actual_cpp(cash_price, points, surcharge)
            return (points * actual_cpp) / 100
        else:
            # Fall back to fair market
            return get_fair_market_value(program, points)
    
    elif config.valuation_method == ValuationMethod.FIXED_RATE:
        return (points * config.fixed_cpp) / 100
    
    else:
        return get_fair_market_value(program, points)


def _generate_settlements(
    breakdowns: Dict[str, MemberCostBreakdown],
    member_lookup: Dict[str, GroupMember],
    config: CostAllocationConfig,
) -> List[SettlementEntry]:
    """Generate settlement entries from breakdowns."""
    # Collect creditors (those who receive) and debtors (those who owe)
    creditors: List[Tuple[str, float]] = []
    debtors: List[Tuple[str, float]] = []
    
    for member_id, breakdown in breakdowns.items():
        if breakdown.settlement_direction == "receives":
            creditors.append((member_id, -breakdown.net_settlement))
        elif breakdown.settlement_direction == "owes":
            debtors.append((member_id, breakdown.net_settlement))
    
    # Sort by amount (largest first for efficiency)
    creditors.sort(key=lambda x: -x[1])
    debtors.sort(key=lambda x: -x[1])
    
    # Generate minimal settlements
    settlements = []
    i, j = 0, 0
    
    while i < len(debtors) and j < len(creditors):
        debtor_id, debt = debtors[i]
        creditor_id, credit = creditors[j]
        
        amount = min(debt, credit)
        
        if amount >= config.min_settlement_amount:
            debtor = member_lookup.get(debtor_id)
            creditor = member_lookup.get(creditor_id)
            
            settlements.append(SettlementEntry(
                from_member=debtor_id,
                from_member_name=debtor.name if debtor else debtor_id,
                to_member=creditor_id,
                to_member_name=creditor.name if creditor else creditor_id,
                amount_usd=round(amount, 2),
                reason=f"Settlement for points used by {debtor.name if debtor else debtor_id}",
                breakdown=[],
            ))
        
        # Update remaining amounts
        debtors[i] = (debtor_id, debt - amount)
        creditors[j] = (creditor_id, credit - amount)
        
        if debtors[i][1] < config.min_settlement_amount:
            i += 1
        if creditors[j][1] < config.min_settlement_amount:
            j += 1
    
    return settlements


# =============================================================================
# SETTLEMENT INSTRUCTIONS
# =============================================================================

def generate_settlement_instructions(
    settlements: List[SettlementEntry],
    members: Dict[str, GroupMember],
) -> List[Dict[str, Any]]:
    """
    Generate human-readable settlement instructions with payment links.
    
    Args:
        settlements: List of settlement entries
        members: Dict mapping member_id to GroupMember
        
    Returns:
        List of settlement instruction dicts for frontend display
    """
    instructions = []
    
    for i, s in enumerate(settlements):
        from_member = members.get(s.from_member)
        to_member = members.get(s.to_member)
        
        from_name = from_member.name if from_member else s.from_member_name
        to_name = to_member.name if to_member else s.to_member_name
        
        # Generate payment deep links
        amount_str = f"{s.amount_usd:.2f}"
        venmo_user = to_name.replace(" ", "").lower()
        
        instructions.append({
            "step": i + 1,
            "settlement_id": f"settle_{s.from_member}_{s.to_member}_{i}",
            
            # Parties
            "from_member_id": s.from_member,
            "from_member_name": from_name,
            "to_member_id": s.to_member,
            "to_member_name": to_name,
            
            # Amount
            "amount": s.amount_usd,
            "amount_display": f"${amount_str}",
            
            # Context
            "reason": s.reason,
            "instruction_text": f"{from_name} pays {to_name} ${amount_str}",
            
            # Payment methods
            "payment_methods": [
                {
                    "name": "Venmo",
                    "icon": "venmo",
                    "url": f"venmo://paycharge?txn=pay&recipients={venmo_user}&amount={amount_str}&note=Tripy%20trip%20settlement",
                    "instructions": f"Open Venmo and pay @{venmo_user} ${amount_str}",
                },
                {
                    "name": "PayPal",
                    "icon": "paypal",
                    "url": f"https://www.paypal.me/{venmo_user}/{amount_str}",
                    "instructions": f"Send ${amount_str} via PayPal",
                },
                {
                    "name": "Zelle",
                    "icon": "zelle",
                    "url": None,
                    "instructions": f"Send ${amount_str} to {to_name}'s email/phone via Zelle",
                },
                {
                    "name": "Cash",
                    "icon": "cash",
                    "url": None,
                    "instructions": f"Pay ${amount_str} in cash",
                },
            ],
            
            # Tracking
            "status": "pending",
            "breakdown": s.breakdown,
        })
    
    return instructions


# =============================================================================
# DETAILED BREAKDOWN GENERATION
# =============================================================================

def generate_detailed_breakdown(
    allocation: GroupCostAllocation,
    solution: GroupOOPSolution,
    members: List[GroupMember],
) -> Dict[str, Any]:
    """
    Generate a detailed breakdown suitable for UI display.
    
    Args:
        allocation: Cost allocation result
        solution: Optimization solution
        members: Group members
        
    Returns:
        Detailed breakdown dict for frontend
    """
    member_lookup = {m.user_id: m for m in members}
    
    detailed = {
        "summary": {
            "total_group_oop": allocation.total_group_cost,
            "all_cash_would_cost": allocation.all_cash_would_cost,
            "total_savings": allocation.total_savings,
            "savings_percentage": allocation.savings_percentage,
            "valuation_method": allocation.valuation_method,
            "num_settlements": len(allocation.settlements),
        },
        "members": {},
        "settlements": [],
        "settlement_instructions": generate_settlement_instructions(
            allocation.settlements, member_lookup
        ),
    }
    
    # Per-member details
    for member_id, breakdown in allocation.member_breakdowns.items():
        member = member_lookup.get(member_id)
        
        # Find allocations for this member
        member_allocations = [
            a for a in solution.allocations 
            if a.beneficiary_member == member_id
        ]
        
        # Find contributions from this member
        member_contributions = [
            a for a in solution.allocations 
            if a.points_owner == member_id and a.beneficiary_member != member_id
        ]
        
        detailed["members"][member_id] = {
            "member_name": breakdown.member_name,
            
            # Consumption
            "bookings": [
                {
                    "item_id": a.item_id,
                    "payment_type": a.payment_type.value,
                    "cash_paid": a.cash_paid,
                    "points_used": a.points_used,
                    "program": a.program_used,
                    "points_owner": a.points_owner,
                    "points_value": a.points_value_usd,
                    "from_self": a.points_owner == member_id,
                }
                for a in member_allocations
            ],
            
            # Contribution to others
            "contributions_to_others": [
                {
                    "beneficiary": a.beneficiary_member,
                    "beneficiary_name": member_lookup.get(a.beneficiary_member, GroupMember(user_id=a.beneficiary_member, name=a.beneficiary_member)).name,
                    "points_used": a.points_used,
                    "program": a.program_used,
                    "value": a.points_value_usd,
                }
                for a in member_contributions
            ],
            
            # Summary
            "cash_paid": breakdown.cash_paid,
            "points_used_for_them": breakdown.points_used_for_them,
            "points_contributed": breakdown.points_contributed,
            "contribution_value": breakdown.points_value_contributed,
            
            # Settlement
            "value_received_from_others": breakdown.value_received_from_others,
            "value_given_to_others": breakdown.value_given_to_others,
            "net_settlement": breakdown.net_settlement,
            "settlement_direction": breakdown.settlement_direction,
            
            # Final
            "total_effective_cost": breakdown.total_effective_cost,
        }
    
    # Settlement details
    for s in allocation.settlements:
        detailed["settlements"].append({
            "from": s.from_member_name,
            "from_id": s.from_member,
            "to": s.to_member_name,
            "to_id": s.to_member,
            "amount": s.amount_usd,
            "reason": s.reason,
        })
    
    return detailed


# =============================================================================
# SETTLEMENT STATUS TRACKING
# =============================================================================

@dataclass
class SettlementStatus:
    """Status of a settlement."""
    settlement_id: str
    from_member: str
    to_member: str
    amount: float
    status: str = "pending"  # pending, paid, confirmed, disputed
    paid_at: Optional[str] = None
    confirmed_at: Optional[str] = None
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None


def get_settlement_status_summary(
    settlements: List[SettlementStatus],
) -> Dict[str, Any]:
    """
    Get overall settlement status for a trip.
    
    Args:
        settlements: List of settlement statuses
        
    Returns:
        Summary dict
    """
    status_counts = {"pending": 0, "paid": 0, "confirmed": 0, "disputed": 0}
    total_amount = 0.0
    settled_amount = 0.0
    
    for s in settlements:
        status_counts[s.status] = status_counts.get(s.status, 0) + 1
        total_amount += s.amount
        if s.status in ("paid", "confirmed"):
            settled_amount += s.amount
    
    return {
        "all_settled": status_counts["pending"] == 0 and status_counts["disputed"] == 0,
        "total_amount": round(total_amount, 2),
        "settled_amount": round(settled_amount, 2),
        "settlement_count": len(settlements),
        "status_summary": status_counts,
        "settlements": [asdict(s) for s in settlements],
    }


# =============================================================================
# HELPER EXPORTS
# =============================================================================

def allocation_to_dict(allocation: GroupCostAllocation) -> Dict[str, Any]:
    """Convert GroupCostAllocation to JSON-serializable dict."""
    return {
        "member_breakdowns": {
            k: asdict(v) for k, v in allocation.member_breakdowns.items()
        },
        "settlements": [asdict(s) for s in allocation.settlements],
        "summary": {
            "total_group_cost": allocation.total_group_cost,
            "all_cash_would_cost": allocation.all_cash_would_cost,
            "total_savings": allocation.total_savings,
            "savings_percentage": allocation.savings_percentage,
            "settlement_balance": allocation.settlement_balance,
            "valuation_method": allocation.valuation_method,
        },
    }
