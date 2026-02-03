"""
Ledger Service

TASK 13: Implement ledger computation and grouping views.

The ledger tracks all financial movements for a trip:
- Points contributions
- Cash payments
- Taxes and fees
- Settlements between members

Provides grouping views by:
- Traveler: What each passenger cost
- Household: Aggregated by household
- Payer/Sponsor: Who paid for what
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime
import uuid
import logging

logger = logging.getLogger(__name__)


class LedgerEntryType(str, Enum):
    """Type of ledger entry."""
    POINTS_CONTRIBUTION = "points_contribution"
    CASH_PAYMENT = "cash_payment"
    TAXES_FEES = "taxes_fees"
    SETTLEMENT = "settlement"
    REIMBURSEMENT = "reimbursement"


class LedgerGrouping(str, Enum):
    """How to group ledger entries."""
    BY_TRAVELER = "by_traveler"
    BY_HOUSEHOLD = "by_household"
    BY_PAYER = "by_payer"
    BY_PROGRAM = "by_program"


@dataclass
class LedgerEntry:
    """A single financial movement."""
    entry_id: str
    trip_id: str
    
    # Type of entry
    entry_type: LedgerEntryType
    
    # Description
    description: str
    
    # Who pays
    payer_user_id: str
    payer_name: str
    
    # For whom (if applicable)
    beneficiary_user_id: Optional[str] = None
    beneficiary_name: Optional[str] = None
    beneficiary_passenger_id: Optional[str] = None
    
    # Amounts
    cash_amount: float = 0.0
    points_amount: int = 0
    points_program: Optional[str] = None
    points_program_name: Optional[str] = None
    points_value_usd: float = 0.0  # Fair market value
    
    # Reference
    ticket_id: Optional[str] = None
    allocation_id: Optional[str] = None
    booking_reference: Optional[str] = None
    
    # Household context
    payer_household_id: Optional[str] = None
    beneficiary_household_id: Optional[str] = None
    
    # Status
    status: str = "pending"  # pending, confirmed
    
    # Timestamps
    created_at: str = ""


@dataclass
class LedgerGroup:
    """A group of ledger entries with summary."""
    group_id: str
    group_name: str
    
    entries: List[LedgerEntry]
    
    # Summary totals
    total_cash: float = 0.0
    total_points_used: Dict[str, int] = field(default_factory=dict)  # program -> points
    total_points_value: float = 0.0
    total_taxes_fees: float = 0.0
    
    # Net position (positive = owes, negative = owed)
    net_cash_position: float = 0.0


@dataclass
class TripLedger:
    """Complete ledger for a trip."""
    trip_id: str
    
    # All entries
    entries: List[LedgerEntry]
    
    # Grouped views
    by_traveler: Dict[str, LedgerGroup] = field(default_factory=dict)
    by_household: Dict[str, LedgerGroup] = field(default_factory=dict)
    by_payer: Dict[str, LedgerGroup] = field(default_factory=dict)
    by_program: Dict[str, LedgerGroup] = field(default_factory=dict)
    
    # Totals
    total_trip_cost: float = 0.0
    total_points_used: Dict[str, int] = field(default_factory=dict)
    total_cash_out_of_pocket: float = 0.0
    total_taxes_fees: float = 0.0
    
    # Settlement summary
    settlements: List[Dict[str, Any]] = field(default_factory=list)


# In-memory ledger storage
_ledgers: Dict[str, TripLedger] = {}


def create_ledger_entry(
    trip_id: str,
    entry_type: LedgerEntryType,
    description: str,
    payer_user_id: str,
    payer_name: str,
    cash_amount: float = 0.0,
    points_amount: int = 0,
    points_program: Optional[str] = None,
    points_program_name: Optional[str] = None,
    points_value_usd: float = 0.0,
    beneficiary_user_id: Optional[str] = None,
    beneficiary_name: Optional[str] = None,
    beneficiary_passenger_id: Optional[str] = None,
    ticket_id: Optional[str] = None,
    allocation_id: Optional[str] = None,
    booking_reference: Optional[str] = None,
    payer_household_id: Optional[str] = None,
    beneficiary_household_id: Optional[str] = None,
) -> LedgerEntry:
    """Create a new ledger entry."""
    entry = LedgerEntry(
        entry_id=str(uuid.uuid4()),
        trip_id=trip_id,
        entry_type=entry_type,
        description=description,
        payer_user_id=payer_user_id,
        payer_name=payer_name,
        cash_amount=cash_amount,
        points_amount=points_amount,
        points_program=points_program,
        points_program_name=points_program_name,
        points_value_usd=points_value_usd,
        beneficiary_user_id=beneficiary_user_id,
        beneficiary_name=beneficiary_name,
        beneficiary_passenger_id=beneficiary_passenger_id,
        ticket_id=ticket_id,
        allocation_id=allocation_id,
        booking_reference=booking_reference,
        payer_household_id=payer_household_id,
        beneficiary_household_id=beneficiary_household_id,
        created_at=datetime.utcnow().isoformat(),
    )
    
    # Add to ledger
    if trip_id not in _ledgers:
        _ledgers[trip_id] = TripLedger(trip_id=trip_id, entries=[])
    
    _ledgers[trip_id].entries.append(entry)
    
    return entry


def generate_ledger_from_allocations(
    trip_id: str,
    allocations: List[Dict[str, Any]],
    members: List[Dict[str, Any]],
    passengers: List[Dict[str, Any]],
    transfer_plan: List[Dict[str, Any]],
) -> TripLedger:
    """
    Generate complete ledger from booking allocations.
    
    Args:
        trip_id: The trip
        allocations: Seat allocations from the plan
        members: Trip members
        passengers: Trip passengers
        transfer_plan: Transfer instructions
        
    Returns:
        Complete TripLedger
    """
    # Create fresh ledger
    ledger = TripLedger(trip_id=trip_id, entries=[])
    _ledgers[trip_id] = ledger
    
    # Build lookups
    member_lookup = {m.get("user_id") or m.get("userId"): m for m in members}
    passenger_lookup = {p.get("passenger_id"): p for p in passengers}
    
    # Process allocations
    for alloc in allocations:
        payer_id = alloc.get("payer_user_id")
        payer = member_lookup.get(payer_id, {})
        passenger_id = alloc.get("passenger_id")
        passenger = passenger_lookup.get(passenger_id, {})
        guardian_id = passenger.get("guardian_user_id", payer_id)
        guardian = member_lookup.get(guardian_id, {})
        
        payment_type = alloc.get("payment_type", "cash")
        
        # Main fare entry
        if payment_type == "points":
            # Points contribution
            entry = create_ledger_entry(
                trip_id=trip_id,
                entry_type=LedgerEntryType.POINTS_CONTRIBUTION,
                description=f"Flight for {passenger.get('full_name', 'passenger')}",
                payer_user_id=payer_id,
                payer_name=payer.get("name", payer_id),
                points_amount=alloc.get("points_used", 0),
                points_program=alloc.get("points_program"),
                points_program_name=alloc.get("points_program"),
                points_value_usd=alloc.get("points_used", 0) * 0.015,  # Approximate
                beneficiary_user_id=guardian_id,
                beneficiary_name=guardian.get("name", guardian_id),
                beneficiary_passenger_id=passenger_id,
                allocation_id=alloc.get("allocation_id"),
                payer_household_id=payer.get("household_id"),
                beneficiary_household_id=guardian.get("household_id"),
            )
            ledger.entries.append(entry)
        else:
            # Cash payment
            cash = alloc.get("cash_amount", 0)
            base_fare = cash * 0.85  # Approximate base fare
            taxes = cash * 0.15  # Approximate taxes/fees
            
            entry = create_ledger_entry(
                trip_id=trip_id,
                entry_type=LedgerEntryType.CASH_PAYMENT,
                description=f"Flight fare for {passenger.get('full_name', 'passenger')}",
                payer_user_id=payer_id,
                payer_name=payer.get("name", payer_id),
                cash_amount=base_fare,
                beneficiary_user_id=guardian_id,
                beneficiary_name=guardian.get("name", guardian_id),
                beneficiary_passenger_id=passenger_id,
                allocation_id=alloc.get("allocation_id"),
                payer_household_id=payer.get("household_id"),
                beneficiary_household_id=guardian.get("household_id"),
            )
            ledger.entries.append(entry)
            
            # Taxes/fees entry
            tax_entry = create_ledger_entry(
                trip_id=trip_id,
                entry_type=LedgerEntryType.TAXES_FEES,
                description=f"Taxes/fees for {passenger.get('full_name', 'passenger')}",
                payer_user_id=payer_id,
                payer_name=payer.get("name", payer_id),
                cash_amount=taxes,
                beneficiary_user_id=guardian_id,
                beneficiary_name=guardian.get("name", guardian_id),
                beneficiary_passenger_id=passenger_id,
                allocation_id=alloc.get("allocation_id"),
                payer_household_id=payer.get("household_id"),
                beneficiary_household_id=guardian.get("household_id"),
            )
            ledger.entries.append(tax_entry)
    
    # Build grouped views
    _build_grouped_views(ledger, members, passengers)
    
    # Calculate settlements
    _calculate_settlements(ledger, members)
    
    return ledger


def _build_grouped_views(
    ledger: TripLedger,
    members: List[Dict[str, Any]],
    passengers: List[Dict[str, Any]],
):
    """Build grouped views for the ledger."""
    passenger_lookup = {p.get("passenger_id"): p for p in passengers}
    member_lookup = {m.get("user_id") or m.get("userId"): m for m in members}
    
    # Group by traveler (passenger)
    by_traveler: Dict[str, List[LedgerEntry]] = {}
    for entry in ledger.entries:
        pax_id = entry.beneficiary_passenger_id or "unknown"
        if pax_id not in by_traveler:
            by_traveler[pax_id] = []
        by_traveler[pax_id].append(entry)
    
    for pax_id, entries in by_traveler.items():
        pax = passenger_lookup.get(pax_id, {})
        ledger.by_traveler[pax_id] = _create_group(
            group_id=pax_id,
            group_name=pax.get("full_name", pax_id),
            entries=entries,
        )
    
    # Group by household
    by_household: Dict[str, List[LedgerEntry]] = {}
    for entry in ledger.entries:
        hh_id = entry.beneficiary_household_id or entry.payer_household_id or "no_household"
        if hh_id not in by_household:
            by_household[hh_id] = []
        by_household[hh_id].append(entry)
    
    for hh_id, entries in by_household.items():
        ledger.by_household[hh_id] = _create_group(
            group_id=hh_id,
            group_name=f"Household {hh_id[:8]}" if hh_id != "no_household" else "Individual Members",
            entries=entries,
        )
    
    # Group by payer
    by_payer: Dict[str, List[LedgerEntry]] = {}
    for entry in ledger.entries:
        payer_id = entry.payer_user_id or "unknown"
        if payer_id not in by_payer:
            by_payer[payer_id] = []
        by_payer[payer_id].append(entry)
    
    for payer_id, entries in by_payer.items():
        member = member_lookup.get(payer_id, {})
        ledger.by_payer[payer_id] = _create_group(
            group_id=payer_id,
            group_name=member.get("name", payer_id),
            entries=entries,
        )
    
    # Group by program
    by_program: Dict[str, List[LedgerEntry]] = {}
    for entry in ledger.entries:
        if entry.points_program:
            prog = entry.points_program
            if prog not in by_program:
                by_program[prog] = []
            by_program[prog].append(entry)
    
    for prog, entries in by_program.items():
        ledger.by_program[prog] = _create_group(
            group_id=prog,
            group_name=prog,
            entries=entries,
        )
    
    # Calculate totals
    ledger.total_cash_out_of_pocket = sum(e.cash_amount for e in ledger.entries)
    ledger.total_taxes_fees = sum(
        e.cash_amount for e in ledger.entries
        if e.entry_type == LedgerEntryType.TAXES_FEES
    )
    ledger.total_trip_cost = ledger.total_cash_out_of_pocket + sum(
        e.points_value_usd for e in ledger.entries
    )
    
    for entry in ledger.entries:
        if entry.points_program and entry.points_amount:
            if entry.points_program not in ledger.total_points_used:
                ledger.total_points_used[entry.points_program] = 0
            ledger.total_points_used[entry.points_program] += entry.points_amount


def _create_group(
    group_id: str,
    group_name: str,
    entries: List[LedgerEntry],
) -> LedgerGroup:
    """Create a ledger group from entries."""
    group = LedgerGroup(
        group_id=group_id,
        group_name=group_name,
        entries=entries,
    )
    
    group.total_cash = sum(e.cash_amount for e in entries)
    group.total_taxes_fees = sum(
        e.cash_amount for e in entries
        if e.entry_type == LedgerEntryType.TAXES_FEES
    )
    group.total_points_value = sum(e.points_value_usd for e in entries)
    
    for e in entries:
        if e.points_program and e.points_amount:
            if e.points_program not in group.total_points_used:
                group.total_points_used[e.points_program] = 0
            group.total_points_used[e.points_program] += e.points_amount
    
    return group


def _calculate_settlements(ledger: TripLedger, members: List[Dict[str, Any]]):
    """Calculate settlement payments between members."""
    member_lookup = {m.get("user_id") or m.get("userId"): m for m in members}
    
    # Track what each person paid vs what they owe
    paid: Dict[str, float] = {}
    owes: Dict[str, float] = {}
    
    for entry in ledger.entries:
        payer = entry.payer_user_id
        beneficiary = entry.beneficiary_user_id
        
        # Record payment
        if payer not in paid:
            paid[payer] = 0.0
        paid[payer] += entry.cash_amount + entry.points_value_usd
        
        # Record what beneficiary owes
        if beneficiary and beneficiary != payer:
            if beneficiary not in owes:
                owes[beneficiary] = {}
            if payer not in owes[beneficiary]:
                owes[beneficiary][payer] = 0.0
            owes[beneficiary][payer] += entry.cash_amount + entry.points_value_usd
    
    # Build settlement list
    settlements = []
    for debtor_id, creditors in owes.items():
        debtor = member_lookup.get(debtor_id, {})
        for creditor_id, amount in creditors.items():
            if amount < 1.0:  # Skip tiny amounts
                continue
            creditor = member_lookup.get(creditor_id, {})
            settlements.append({
                "from_user_id": debtor_id,
                "from_name": debtor.get("name", debtor_id),
                "to_user_id": creditor_id,
                "to_name": creditor.get("name", creditor_id),
                "amount_usd": round(amount, 2),
                "reason": f"Trip expenses covered by {creditor.get('name', creditor_id)}",
            })
    
    ledger.settlements = settlements


def get_ledger(trip_id: str) -> Optional[TripLedger]:
    """Get the ledger for a trip."""
    return _ledgers.get(trip_id)


def get_ledger_view(
    trip_id: str,
    grouping: LedgerGrouping = LedgerGrouping.BY_TRAVELER,
) -> Dict[str, LedgerGroup]:
    """Get a specific grouped view of the ledger."""
    ledger = _ledgers.get(trip_id)
    if not ledger:
        return {}
    
    if grouping == LedgerGrouping.BY_TRAVELER:
        return ledger.by_traveler
    elif grouping == LedgerGrouping.BY_HOUSEHOLD:
        return ledger.by_household
    elif grouping == LedgerGrouping.BY_PAYER:
        return ledger.by_payer
    elif grouping == LedgerGrouping.BY_PROGRAM:
        return ledger.by_program
    
    return ledger.by_traveler


def ledger_to_dict(ledger: TripLedger) -> Dict[str, Any]:
    """Convert TripLedger to JSON-serializable dict."""
    def entry_to_dict(e: LedgerEntry) -> Dict[str, Any]:
        return {
            "entry_id": e.entry_id,
            "entry_type": e.entry_type.value,
            "description": e.description,
            "payer_user_id": e.payer_user_id,
            "payer_name": e.payer_name,
            "beneficiary_user_id": e.beneficiary_user_id,
            "beneficiary_name": e.beneficiary_name,
            "beneficiary_passenger_id": e.beneficiary_passenger_id,
            "cash_amount": e.cash_amount,
            "points_amount": e.points_amount,
            "points_program": e.points_program,
            "points_value_usd": e.points_value_usd,
            "ticket_id": e.ticket_id,
            "allocation_id": e.allocation_id,
            "booking_reference": e.booking_reference,
            "status": e.status,
            "created_at": e.created_at,
        }
    
    def group_to_dict(g: LedgerGroup) -> Dict[str, Any]:
        return {
            "group_id": g.group_id,
            "group_name": g.group_name,
            "total_cash": round(g.total_cash, 2),
            "total_points_used": g.total_points_used,
            "total_points_value": round(g.total_points_value, 2),
            "total_taxes_fees": round(g.total_taxes_fees, 2),
            "entry_count": len(g.entries),
            "entries": [entry_to_dict(e) for e in g.entries],
        }
    
    return {
        "trip_id": ledger.trip_id,
        "totals": {
            "total_trip_cost": round(ledger.total_trip_cost, 2),
            "total_cash_out_of_pocket": round(ledger.total_cash_out_of_pocket, 2),
            "total_taxes_fees": round(ledger.total_taxes_fees, 2),
            "total_points_used": ledger.total_points_used,
        },
        "by_traveler": {k: group_to_dict(v) for k, v in ledger.by_traveler.items()},
        "by_household": {k: group_to_dict(v) for k, v in ledger.by_household.items()},
        "by_payer": {k: group_to_dict(v) for k, v in ledger.by_payer.items()},
        "by_program": {k: group_to_dict(v) for k, v in ledger.by_program.items()},
        "settlements": ledger.settlements,
    }
