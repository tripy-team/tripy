"""
Settlement Engine - Pure Function Implementation

TASK 18: Implements a deterministic, side-effect-free settlement engine
for flight-only group trips.

Inputs:
- Tickets + SeatAllocations
- Cash paid per member
- Points used per member (currency + amount)
- Chosen settlement_policy
- Points valuation config

Outputs:
- obligation_by_passenger (USD)
- contribution_by_member (USD-equivalent)
- net_balance_by_member (positive = owes money, negative = should receive)
- reimbursement_transfers[]: (from_member, to_member, amount_usd)

Rules:
- Convert points to USD-equivalent using valuation mode
- Support different obligations per passenger or household
- Allow people to pay different amounts up front
- Same inputs → same settlement (deterministic)
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Tuple
from enum import Enum
import logging

logger = logging.getLogger(__name__)


# =============================================================================
# MARKET VALUATIONS (cents per point)
# =============================================================================

# Default market-implied valuations (cents per point)
# Based on typical redemption values
DEFAULT_MARKET_CPP = {
    # Bank programs
    "chase": 1.8,
    "amex": 1.8,
    "citi": 1.5,
    "capitalone": 1.5,
    "bilt": 1.8,
    
    # Airlines
    "UA": 1.3,   # United MileagePlus
    "AA": 1.4,   # American AAdvantage
    "DL": 1.2,   # Delta SkyMiles
    "AS": 1.8,   # Alaska Mileage Plan
    "BA": 1.5,   # British Airways Avios
    "SQ": 1.7,   # Singapore KrisFlyer
    "NH": 1.5,   # ANA Mileage Club
    "CX": 1.5,   # Cathay Pacific Asia Miles
    "EK": 0.8,   # Emirates Skywards
    "AF": 1.2,   # Air France/KLM Flying Blue
    
    # Hotels (for reference, even though flight-only)
    "HYATT": 1.7,
    "MARRIOTT": 0.7,
    "HILTON": 0.5,
    "IHG": 0.5,
    
    # Default fallback
    "default": 1.0,
}


def get_market_cpp(program: str) -> float:
    """Get market cents-per-point value for a program."""
    return DEFAULT_MARKET_CPP.get(
        program.upper(),
        DEFAULT_MARKET_CPP.get(program.lower(), DEFAULT_MARKET_CPP["default"])
    )


# =============================================================================
# DATA STRUCTURES
# =============================================================================

class SettlementPolicy(str, Enum):
    PAY_YOUR_OWN = "pay_your_own"
    EQUAL_PER_PASSENGER = "equal_per_passenger"
    EQUAL_PER_HOUSEHOLD = "equal_per_household"
    SPONSOR_PAYS_ALL = "sponsor_pays_all"
    CUSTOM = "custom"


class ValuationMode(str, Enum):
    MARKET_IMPLIED = "market_implied"
    FIXED_BY_CURRENCY = "fixed_by_currency"
    USER_DEFINED = "user_defined"


@dataclass
class PointsContribution:
    """Points contributed by a member."""
    program: str
    points: int
    usd_value: float = 0.0  # Computed based on valuation


@dataclass
class MemberContribution:
    """What a member actually paid/contributed."""
    user_id: str
    cash_paid: float = 0.0
    points_contributions: List[PointsContribution] = field(default_factory=list)
    total_usd_equivalent: float = 0.0  # cash + points value


@dataclass
class PassengerObligation:
    """What a passenger should owe (before considering who paid)."""
    passenger_id: str
    guardian_user_id: str
    household_id: Optional[str] = None
    obligation_usd: float = 0.0
    description: str = ""


@dataclass
class MemberBalance:
    """Net balance for a member."""
    user_id: str
    name: str = ""
    obligation_usd: float = 0.0      # What they should pay
    contribution_usd: float = 0.0    # What they actually paid
    net_balance: float = 0.0         # positive = owes, negative = owed
    
    # Breakdown
    passengers: List[str] = field(default_factory=list)
    cash_paid: float = 0.0
    points_value: float = 0.0


@dataclass
class ReimbursementTransfer:
    """A single reimbursement transfer between members."""
    from_user_id: str
    from_name: str
    to_user_id: str
    to_name: str
    amount_usd: float
    reason: str = ""


@dataclass
class SettlementResult:
    """Complete settlement calculation result."""
    # Summary
    total_trip_cost: float
    total_cash_paid: float
    total_points_value: float
    
    # Per-passenger obligations
    obligation_by_passenger: Dict[str, float]
    
    # Per-member contributions
    contribution_by_member: Dict[str, float]
    
    # Net balances
    net_balance_by_member: Dict[str, MemberBalance]
    
    # Reimbursement transfers
    reimbursement_transfers: List[ReimbursementTransfer]
    
    # Metadata
    policy_used: str
    valuation_mode: str
    
    # For debugging
    details: Dict[str, Any] = field(default_factory=dict)


# =============================================================================
# VALUATION FUNCTIONS
# =============================================================================

def value_points(
    program: str,
    points: int,
    mode: ValuationMode,
    fixed_rates: Dict[str, float],
    min_cpp: float = 0.5,
    max_cpp: float = 5.0,
) -> float:
    """
    Convert points to USD-equivalent value.
    
    Args:
        program: Program code (e.g., "chase", "UA")
        points: Number of points
        mode: Valuation mode
        fixed_rates: Fixed rates by program (cpp)
        min_cpp: Minimum cents per point
        max_cpp: Maximum cents per point
        
    Returns:
        USD value of the points
    """
    if points <= 0:
        return 0.0
    
    # Determine cpp based on mode
    if mode == ValuationMode.MARKET_IMPLIED:
        cpp = get_market_cpp(program)
    elif mode == ValuationMode.FIXED_BY_CURRENCY:
        cpp = fixed_rates.get(program, fixed_rates.get("default", 1.0))
    elif mode == ValuationMode.USER_DEFINED:
        cpp = fixed_rates.get(program, get_market_cpp(program))
    else:
        cpp = 1.0
    
    # Apply caps
    cpp = max(min_cpp, min(max_cpp, cpp))
    
    # Convert to dollars (cpp is cents per point)
    return (points * cpp) / 100.0


# =============================================================================
# OBLIGATION CALCULATION
# =============================================================================

def calculate_obligations(
    tickets: List[Dict[str, Any]],
    passengers: List[Dict[str, Any]],
    members: List[Dict[str, Any]],
    policy: SettlementPolicy,
    custom_obligations: Dict[str, float] = None,
    include_taxes_in_split: bool = True,
) -> Dict[str, PassengerObligation]:
    """
    Calculate what each passenger should owe based on policy.
    
    Args:
        tickets: List of ticket dicts with costs
        passengers: List of passenger dicts
        members: List of member dicts (with household_id)
        policy: Settlement policy to use
        custom_obligations: Custom per-passenger amounts (for CUSTOM policy)
        include_taxes_in_split: Whether to include taxes in the split
        
    Returns:
        Dict mapping passenger_id to PassengerObligation
    """
    # Build lookups
    passenger_lookup = {p.get("passenger_id"): p for p in passengers}
    member_lookup = {m.get("user_id") or m.get("userId"): m for m in members}
    
    # Calculate total trip cost
    total_cost = 0.0
    cost_by_passenger: Dict[str, float] = {}
    
    for ticket in tickets:
        pax_id = ticket.get("passenger_id")
        base_fare = ticket.get("base_fare_cash", 0) or 0
        taxes = ticket.get("taxes_fees_cash", 0) or 0
        
        cost = base_fare
        if include_taxes_in_split:
            cost += taxes
        
        cost_by_passenger[pax_id] = cost_by_passenger.get(pax_id, 0) + cost
        total_cost += cost
    
    # Calculate obligations based on policy
    obligations: Dict[str, PassengerObligation] = {}
    
    if policy == SettlementPolicy.PAY_YOUR_OWN:
        # Each passenger's obligation = their ticket cost
        for pax_id, cost in cost_by_passenger.items():
            pax = passenger_lookup.get(pax_id, {})
            guardian = pax.get("guardian_user_id", "unknown")
            guardian_info = member_lookup.get(guardian, {})
            
            obligations[pax_id] = PassengerObligation(
                passenger_id=pax_id,
                guardian_user_id=guardian,
                household_id=guardian_info.get("household_id"),
                obligation_usd=cost,
                description=f"Ticket cost for {pax.get('full_name', pax_id)}"
            )
    
    elif policy == SettlementPolicy.EQUAL_PER_PASSENGER:
        # Split equally among all passengers
        num_passengers = len(passengers) if passengers else 1
        per_passenger = total_cost / num_passengers
        
        for pax in passengers:
            pax_id = pax.get("passenger_id")
            guardian = pax.get("guardian_user_id", "unknown")
            guardian_info = member_lookup.get(guardian, {})
            
            obligations[pax_id] = PassengerObligation(
                passenger_id=pax_id,
                guardian_user_id=guardian,
                household_id=guardian_info.get("household_id"),
                obligation_usd=per_passenger,
                description=f"Equal share (${per_passenger:.2f}/passenger)"
            )
    
    elif policy == SettlementPolicy.EQUAL_PER_HOUSEHOLD:
        # Group passengers by household
        households: Dict[str, List[str]] = {}  # household_id -> [passenger_ids]
        
        for pax in passengers:
            pax_id = pax.get("passenger_id")
            guardian = pax.get("guardian_user_id", "unknown")
            guardian_info = member_lookup.get(guardian, {})
            hh_id = guardian_info.get("household_id") or guardian
            
            if hh_id not in households:
                households[hh_id] = []
            households[hh_id].append(pax_id)
        
        # Split equally among households
        num_households = len(households) if households else 1
        per_household = total_cost / num_households
        
        for hh_id, pax_ids in households.items():
            # Split household share among its passengers
            per_pax_in_hh = per_household / len(pax_ids)
            
            for pax_id in pax_ids:
                pax = passenger_lookup.get(pax_id, {})
                guardian = pax.get("guardian_user_id", "unknown")
                
                obligations[pax_id] = PassengerObligation(
                    passenger_id=pax_id,
                    guardian_user_id=guardian,
                    household_id=hh_id,
                    obligation_usd=per_pax_in_hh,
                    description=f"Household share: ${per_household:.2f} / {len(pax_ids)} passengers"
                )
    
    elif policy == SettlementPolicy.SPONSOR_PAYS_ALL:
        # No obligations for non-sponsors
        for pax in passengers:
            pax_id = pax.get("passenger_id")
            guardian = pax.get("guardian_user_id", "unknown")
            guardian_info = member_lookup.get(guardian, {})
            
            obligations[pax_id] = PassengerObligation(
                passenger_id=pax_id,
                guardian_user_id=guardian,
                household_id=guardian_info.get("household_id"),
                obligation_usd=0.0,
                description="Sponsor covers all costs"
            )
    
    elif policy == SettlementPolicy.CUSTOM:
        # Use custom obligations if provided
        custom = custom_obligations or {}
        
        for pax in passengers:
            pax_id = pax.get("passenger_id")
            guardian = pax.get("guardian_user_id", "unknown")
            guardian_info = member_lookup.get(guardian, {})
            
            obligations[pax_id] = PassengerObligation(
                passenger_id=pax_id,
                guardian_user_id=guardian,
                household_id=guardian_info.get("household_id"),
                obligation_usd=custom.get(pax_id, cost_by_passenger.get(pax_id, 0)),
                description="Custom amount"
            )
    
    return obligations


# =============================================================================
# CONTRIBUTION CALCULATION
# =============================================================================

def calculate_contributions(
    allocations: List[Dict[str, Any]],
    members: List[Dict[str, Any]],
    valuation_mode: ValuationMode,
    fixed_rates: Dict[str, float],
    min_cpp: float = 0.5,
    max_cpp: float = 5.0,
    reimburse_points_value: bool = True,
) -> Dict[str, MemberContribution]:
    """
    Calculate what each member actually contributed (paid).
    
    Args:
        allocations: List of seat allocation dicts
        members: List of member dicts
        valuation_mode: How to value points
        fixed_rates: Fixed rates by program
        min_cpp/max_cpp: Valuation caps
        reimburse_points_value: Whether to count points as contribution
        
    Returns:
        Dict mapping user_id to MemberContribution
    """
    contributions: Dict[str, MemberContribution] = {}
    
    # Initialize contributions for all members
    for member in members:
        user_id = member.get("user_id") or member.get("userId")
        contributions[user_id] = MemberContribution(user_id=user_id)
    
    # Process allocations
    for alloc in allocations:
        payer_id = alloc.get("payer_user_id")
        payment_type = alloc.get("payment_type", "cash")
        
        if payer_id not in contributions:
            contributions[payer_id] = MemberContribution(user_id=payer_id)
        
        contrib = contributions[payer_id]
        
        if payment_type == "cash":
            # Cash payment
            cash = alloc.get("cash_amount", 0) or alloc.get("total_out_of_pocket", 0) or 0
            contrib.cash_paid += cash
        
        elif payment_type == "points":
            # Points payment
            program = alloc.get("points_program", "unknown")
            points = alloc.get("points_used", 0) or 0
            
            # Value the points
            if reimburse_points_value:
                points_value = value_points(
                    program, points, valuation_mode,
                    fixed_rates, min_cpp, max_cpp
                )
            else:
                points_value = 0.0
            
            contrib.points_contributions.append(PointsContribution(
                program=program,
                points=points,
                usd_value=points_value,
            ))
            
            # Also add any cash surcharge (taxes/fees)
            surcharge = alloc.get("surcharge", 0) or alloc.get("taxes_fees_cash", 0) or 0
            contrib.cash_paid += surcharge
    
    # Calculate totals
    for contrib in contributions.values():
        points_total = sum(pc.usd_value for pc in contrib.points_contributions)
        contrib.total_usd_equivalent = contrib.cash_paid + points_total
    
    return contributions


# =============================================================================
# MAIN SETTLEMENT FUNCTION
# =============================================================================

def compute_settlement(
    tickets: List[Dict[str, Any]],
    allocations: List[Dict[str, Any]],
    passengers: List[Dict[str, Any]],
    members: List[Dict[str, Any]],
    policy: str,
    valuation_config: Dict[str, Any],
    custom_obligations: Dict[str, float] = None,
) -> SettlementResult:
    """
    Compute complete settlement for a trip.
    
    This is a PURE FUNCTION - same inputs always produce same outputs.
    No side effects, no database access.
    
    Args:
        tickets: List of ticket dicts with costs
        allocations: List of seat allocation dicts
        passengers: List of passenger dicts
        members: List of member dicts
        policy: Settlement policy string
        valuation_config: Dict with mode, fixed_rates, min_cpp, max_cpp, reimburse_points_value
        custom_obligations: Custom per-passenger amounts
        
    Returns:
        SettlementResult with all calculations
    """
    # Parse config
    settlement_policy = SettlementPolicy(policy)
    valuation_mode = ValuationMode(valuation_config.get("mode", "market_implied"))
    fixed_rates = valuation_config.get("fixed_rates_cpp", {})
    min_cpp = valuation_config.get("min_cpp", 0.5)
    max_cpp = valuation_config.get("max_cpp", 5.0)
    reimburse_points = valuation_config.get("reimburse_points_value", True)
    include_taxes = valuation_config.get("include_taxes_in_split", True)
    
    # Build member lookup
    member_lookup = {m.get("user_id") or m.get("userId"): m for m in members}
    passenger_lookup = {p.get("passenger_id"): p for p in passengers}
    
    # Step 1: Calculate obligations
    obligations = calculate_obligations(
        tickets=tickets,
        passengers=passengers,
        members=members,
        policy=settlement_policy,
        custom_obligations=custom_obligations,
        include_taxes_in_split=include_taxes,
    )
    
    # Step 2: Calculate contributions
    contributions = calculate_contributions(
        allocations=allocations,
        members=members,
        valuation_mode=valuation_mode,
        fixed_rates=fixed_rates,
        min_cpp=min_cpp,
        max_cpp=max_cpp,
        reimburse_points_value=reimburse_points,
    )
    
    # Step 3: Aggregate obligations by member (guardian)
    obligation_by_member: Dict[str, float] = {}
    passengers_by_member: Dict[str, List[str]] = {}
    
    for pax_id, obl in obligations.items():
        guardian = obl.guardian_user_id
        obligation_by_member[guardian] = obligation_by_member.get(guardian, 0) + obl.obligation_usd
        
        if guardian not in passengers_by_member:
            passengers_by_member[guardian] = []
        passengers_by_member[guardian].append(pax_id)
    
    # Step 4: Calculate net balances
    net_balances: Dict[str, MemberBalance] = {}
    
    for member in members:
        user_id = member.get("user_id") or member.get("userId")
        name = member.get("name", user_id)
        
        obligation = obligation_by_member.get(user_id, 0)
        contrib = contributions.get(user_id, MemberContribution(user_id=user_id))
        contribution = contrib.total_usd_equivalent
        
        net = obligation - contribution  # positive = owes, negative = owed
        
        net_balances[user_id] = MemberBalance(
            user_id=user_id,
            name=name,
            obligation_usd=round(obligation, 2),
            contribution_usd=round(contribution, 2),
            net_balance=round(net, 2),
            passengers=passengers_by_member.get(user_id, []),
            cash_paid=round(contrib.cash_paid, 2),
            points_value=round(sum(pc.usd_value for pc in contrib.points_contributions), 2),
        )
    
    # Step 5: Calculate reimbursement transfers
    transfers = calculate_reimbursement_transfers(net_balances, member_lookup)
    
    # Calculate totals
    total_cash = sum(c.cash_paid for c in contributions.values())
    total_points_value = sum(
        sum(pc.usd_value for pc in c.points_contributions)
        for c in contributions.values()
    )
    total_cost = total_cash + total_points_value
    
    return SettlementResult(
        total_trip_cost=round(total_cost, 2),
        total_cash_paid=round(total_cash, 2),
        total_points_value=round(total_points_value, 2),
        obligation_by_passenger={k: round(v.obligation_usd, 2) for k, v in obligations.items()},
        contribution_by_member={k: round(v.total_usd_equivalent, 2) for k, v in contributions.items()},
        net_balance_by_member=net_balances,
        reimbursement_transfers=transfers,
        policy_used=policy,
        valuation_mode=valuation_mode.value,
        details={
            "obligations": {k: v.__dict__ for k, v in obligations.items()},
            "fixed_rates_used": fixed_rates,
        },
    )


def calculate_reimbursement_transfers(
    net_balances: Dict[str, MemberBalance],
    member_lookup: Dict[str, Dict[str, Any]],
) -> List[ReimbursementTransfer]:
    """
    Calculate who should pay whom to settle up.
    
    Uses a greedy algorithm to minimize the number of transfers.
    """
    # Separate debtors (positive net) and creditors (negative net)
    debtors = [(uid, bal) for uid, bal in net_balances.items() if bal.net_balance > 0.01]
    creditors = [(uid, bal) for uid, bal in net_balances.items() if bal.net_balance < -0.01]
    
    # Sort by amount (largest first)
    debtors.sort(key=lambda x: x[1].net_balance, reverse=True)
    creditors.sort(key=lambda x: x[1].net_balance)  # Most negative first
    
    transfers = []
    
    debtor_idx = 0
    creditor_idx = 0
    
    while debtor_idx < len(debtors) and creditor_idx < len(creditors):
        debtor_id, debtor_bal = debtors[debtor_idx]
        creditor_id, creditor_bal = creditors[creditor_idx]
        
        debtor_owes = debtor_bal.net_balance
        creditor_owed = -creditor_bal.net_balance
        
        # Transfer the minimum of what debtor owes and creditor is owed
        transfer_amount = min(debtor_owes, creditor_owed)
        
        if transfer_amount > 0.01:  # Skip tiny amounts
            debtor_info = member_lookup.get(debtor_id, {})
            creditor_info = member_lookup.get(creditor_id, {})
            
            transfers.append(ReimbursementTransfer(
                from_user_id=debtor_id,
                from_name=debtor_info.get("name", debtor_id),
                to_user_id=creditor_id,
                to_name=creditor_info.get("name", creditor_id),
                amount_usd=round(transfer_amount, 2),
                reason=f"Settlement for trip expenses",
            ))
            
            # Update balances
            debtor_bal.net_balance -= transfer_amount
            creditor_bal.net_balance += transfer_amount
        
        # Move to next debtor/creditor if settled
        if debtor_bal.net_balance < 0.01:
            debtor_idx += 1
        if creditor_bal.net_balance > -0.01:
            creditor_idx += 1
    
    return transfers


# =============================================================================
# SERIALIZATION
# =============================================================================

def settlement_result_to_dict(result: SettlementResult) -> Dict[str, Any]:
    """Convert SettlementResult to JSON-serializable dict."""
    return {
        "summary": {
            "total_trip_cost": result.total_trip_cost,
            "total_cash_paid": result.total_cash_paid,
            "total_points_value": result.total_points_value,
        },
        "policy_used": result.policy_used,
        "valuation_mode": result.valuation_mode,
        "obligation_by_passenger": result.obligation_by_passenger,
        "contribution_by_member": result.contribution_by_member,
        "net_balance_by_member": {
            uid: {
                "user_id": bal.user_id,
                "name": bal.name,
                "obligation_usd": bal.obligation_usd,
                "contribution_usd": bal.contribution_usd,
                "net_balance": bal.net_balance,
                "passengers": bal.passengers,
                "cash_paid": bal.cash_paid,
                "points_value": bal.points_value,
                "status": "owes" if bal.net_balance > 0.01 else ("owed" if bal.net_balance < -0.01 else "settled"),
            }
            for uid, bal in result.net_balance_by_member.items()
        },
        "reimbursement_transfers": [
            {
                "from_user_id": t.from_user_id,
                "from_name": t.from_name,
                "to_user_id": t.to_user_id,
                "to_name": t.to_name,
                "amount_usd": t.amount_usd,
                "reason": t.reason,
                "display": f"{t.from_name} owes {t.to_name} ${t.amount_usd:.2f}",
            }
            for t in result.reimbursement_transfers
        ],
    }
