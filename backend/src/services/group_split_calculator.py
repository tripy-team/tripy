"""
Group Split Calculator

Splitwise-style settlement engine for group trips.
Normalizes points into USD value, computes each traveler's gross share,
contributed value, and net owed/credit.

Core formula per traveler:
  net_balance = contributed_value - gross_share
  If positive: they are owed money/credit
  If negative: they owe money
"""

import uuid
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import HTTPException

from src.repos import group_planning_repo as repo
from src.services.settlement_engine import (
    value_points, ValuationMode, DEFAULT_MARKET_CPP,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


# =============================================================================
# POINTS VALUATION
# =============================================================================

def get_imputed_value_usd(
    program: str,
    points: int,
    actual_redemption_value: Optional[float] = None,
    custom_cpp: Optional[float] = None,
) -> float:
    """
    Convert points to estimated USD value.
    Prefers actual realized redemption value, then custom cpp, then market default.
    """
    if actual_redemption_value is not None and actual_redemption_value > 0:
        return actual_redemption_value

    if custom_cpp is not None and custom_cpp > 0:
        return (points * custom_cpp) / 100.0

    return value_points(
        program=program,
        points=points,
        mode=ValuationMode.MARKET_IMPLIED,
        fixed_rates={},
        min_cpp=0.5,
        max_cpp=5.0,
    )


# =============================================================================
# GROSS SHARE COMPUTATION
# =============================================================================

def compute_gross_shares(
    assignments: List[Dict[str, Any]],
    travelers: List[Dict[str, Any]],
) -> Dict[str, float]:
    """
    Compute each traveler's fair share of trip consumption.

    Rules:
    - Flights assigned directly to a traveler: full cost to that traveler
    - Shared hotel rooms: split among room occupants
    - Shared transport/fees: split equally among all travelers
    """
    shares: Dict[str, float] = {t["travelerId"]: 0.0 for t in travelers}
    traveler_ids = set(shares.keys())

    for a in assignments:
        tid = a.get("travelerProfileId", "")
        item_type = a.get("itemType", "flight")
        cash_cost = float(a.get("cashCost", 0))
        points_value = float(a.get("imputedPointsValueUsd", 0))
        total_value = cash_cost + points_value
        shared_key = a.get("sharedGroupKey")

        if item_type == "flight" or not shared_key:
            if tid in shares:
                shares[tid] += total_value
        else:
            shared_members = [
                aa.get("travelerProfileId")
                for aa in assignments
                if aa.get("sharedGroupKey") == shared_key
            ]
            unique_members = list(set(m for m in shared_members if m in traveler_ids))
            if unique_members:
                per_person = total_value / len(unique_members)
                for m in unique_members:
                    shares[m] += per_person

    return shares


# =============================================================================
# CONTRIBUTION TOTALS
# =============================================================================

def compute_contribution_totals(
    ledger: List[Dict[str, Any]],
) -> Dict[str, float]:
    """Sum each traveler's total contributed value from the ledger."""
    totals: Dict[str, float] = {}
    for entry in ledger:
        tid = entry.get("travelerProfileId", "")
        amount = float(entry.get("amountUsd", 0))
        entry_type = entry.get("entryType", "")

        if entry_type in ("cash_paid", "points_used", "transfer_fee_paid", "tax_paid"):
            totals[tid] = totals.get(tid, 0) + amount
        elif entry_type == "credit":
            totals[tid] = totals.get(tid, 0) + amount
        elif entry_type == "adjustment":
            totals[tid] = totals.get(tid, 0) + amount

    return totals


# =============================================================================
# SETTLEMENT CALCULATION
# =============================================================================

# Points are a scarce personal asset, so contributing them is treated as a
# sacrifice worth a premium over their face cash value. The premium is shared
# equally by the group: whoever contributes more points value than the group
# average is reimbursed POINTS_SACRIFICE_PREMIUM × (their points − the average)
# in cash, funded by those who contributed fewer points. A MODERATE premium is
# deliberate — it rewards points usage WITHOUT overturning the consumption base
# (so a business-class flyer still bears more than a main-cabin flyer, even when
# the business flyer paid with points). Set to 0 for pure consumption splitting.
POINTS_SACRIFICE_PREMIUM = 0.25


def _points_value_by_traveler(ledger: List[Dict[str, Any]]) -> Dict[str, float]:
    """USD value of points each traveler personally redeemed (from the ledger)."""
    out: Dict[str, float] = {}
    for e in ledger:
        if e.get("entryType") == "points_used":
            tid = e.get("travelerProfileId", "")
            out[tid] = out.get(tid, 0.0) + float(e.get("amountUsd", 0))
    return out


def calculate_settlement(
    group_trip_id: str,
    assignments: List[Dict[str, Any]],
    ledger: List[Dict[str, Any]],
    travelers: List[Dict[str, Any]],
    split_method: str = "points_value_weighted",
) -> List[Dict[str, Any]]:
    """
    Compute per-traveler settlement with explanation lines.

    Base settlement is consumption-based (each traveler owes the value of the
    bookings assigned to them, so pricier cabins owe more). On top of that, the
    "points_value_weighted" method adds a points-sacrifice bonus that reimburses
    travelers who redeemed more of their own points than the group average — so a
    bigger points contributor is paid back more in cash. Returns summaries ready
    for storage.
    """
    gross_shares = compute_gross_shares(assignments, travelers)
    contributions = compute_contribution_totals(ledger)

    # Points-sacrifice bonus (zero-sum across the group). Only the weighted method
    # rewards points; any other method falls back to pure consumption splitting.
    points_value = _points_value_by_traveler(ledger)
    num_travelers = len(travelers) or 1
    avg_points_value = sum(points_value.values()) / num_travelers
    reward_points = split_method == "points_value_weighted"

    settlements = []
    now = _now_iso()
    existing = repo.get_settlements_for_trip(group_trip_id)
    max_version = max((int(s.get("calculationVersion", 0)) for s in existing), default=0)
    new_version = max_version + 1

    for t in travelers:
        tid = t["travelerId"]
        name = t.get("displayName", "Traveler")
        gross = gross_shares.get(tid, 0)
        contributed = contributions.get(tid, 0)
        # Base: covered your own consumption? Bonus: rewarded for points sacrifice.
        points_bonus = (
            POINTS_SACRIFICE_PREMIUM * (points_value.get(tid, 0.0) - avg_points_value)
            if reward_points else 0.0
        )
        net = (contributed - gross) + points_bonus

        explanation_lines = _build_explanation(tid, gross, contributed, net, assignments, ledger, name)
        if reward_points and abs(points_bonus) >= 0.005:
            if points_bonus > 0:
                explanation_lines.append(
                    f"Points-sacrifice bonus: +${points_bonus:,.2f} (you redeemed more points than the group average)"
                )
            else:
                explanation_lines.append(
                    f"Points-sacrifice share: -${abs(points_bonus):,.2f} (others redeemed more points than you)"
                )

        summary = {
            "settlementId": str(uuid.uuid4()),
            "groupTripId": group_trip_id,
            "travelerProfileId": tid,
            "grossShareUsd": round(gross, 2),
            "contributedValueUsd": round(contributed, 2),
            "pointsSacrificeBonusUsd": round(points_bonus, 2),
            "netOwedUsd": round(abs(net), 2) if net < 0 else 0,
            "netCreditUsd": round(net, 2) if net > 0 else 0,
            "explanationLines": explanation_lines,
            "calculationVersion": new_version,
            "createdAt": now,
        }
        settlements.append(summary)

    return settlements


def _build_explanation(
    traveler_id: str,
    gross: float,
    contributed: float,
    net: float,
    assignments: List[Dict[str, Any]],
    ledger: List[Dict[str, Any]],
    name: str,
) -> List[str]:
    """Generate human-readable explanation lines for a traveler's settlement."""
    lines = []

    flight_share = sum(
        float(a.get("cashCost", 0)) + float(a.get("imputedPointsValueUsd", 0))
        for a in assignments
        if a.get("travelerProfileId") == traveler_id and a.get("itemType") == "flight"
    )
    hotel_share = sum(
        float(a.get("cashCost", 0)) + float(a.get("imputedPointsValueUsd", 0))
        for a in assignments
        if a.get("travelerProfileId") == traveler_id and a.get("itemType") in ("hotel",)
    )

    if flight_share > 0:
        lines.append(f"Flight cost share: ${flight_share:,.2f}")
    if hotel_share > 0:
        lines.append(f"Hotel cost share: ${hotel_share:,.2f}")
    if gross > 0 and flight_share == 0 and hotel_share == 0:
        lines.append(f"Total cost share: ${gross:,.2f}")

    points_entries = [
        e for e in ledger
        if e.get("travelerProfileId") == traveler_id and e.get("entryType") == "points_used"
    ]
    for pe in points_entries:
        pts = pe.get("pointsAmount", 0)
        prog = pe.get("pointsProgram", "points")
        val = float(pe.get("amountUsd", 0))
        lines.append(f"Contributed {pts:,} {prog} worth ${val:,.2f}")

    cash_entries = [
        e for e in ledger
        if e.get("travelerProfileId") == traveler_id and e.get("entryType") == "cash_paid"
    ]
    total_cash = sum(float(e.get("amountUsd", 0)) for e in cash_entries)
    if total_cash > 0:
        lines.append(f"Paid ${total_cash:,.2f} in cash")

    tax_entries = [
        e for e in ledger
        if e.get("travelerProfileId") == traveler_id and e.get("entryType") == "tax_paid"
    ]
    total_tax = sum(float(e.get("amountUsd", 0)) for e in tax_entries)
    if total_tax > 0:
        lines.append(f"Paid ${total_tax:,.2f} in taxes/fees")

    if net >= 0:
        lines.append(f"Net credit: ${net:,.2f} (others owe you)")
    else:
        lines.append(f"Net owed: ${abs(net):,.2f}")

    return lines


# =============================================================================
# PUBLIC API
# =============================================================================

def calculate_split(group_trip_id: str, user_id: str) -> Dict[str, Any]:
    """Calculate and persist settlement for a group trip."""
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    if trip.get("ownerUserId") != user_id:
        raise HTTPException(status_code=403, detail="Only the trip owner can calculate split.")

    travelers = repo.get_travelers_for_trip(group_trip_id)
    if not travelers:
        raise HTTPException(status_code=400, detail="No travelers found.")

    assignments = repo.get_assignments_for_trip(group_trip_id)
    ledger = repo.get_ledger_for_trip(group_trip_id)
    split_method = trip.get("splitMethod", "points_value_weighted")

    settlements = calculate_settlement(
        group_trip_id, assignments, ledger, travelers, split_method
    )

    for s in settlements:
        repo.put_settlement_summary(group_trip_id, s)

    traveler_lookup = {t["travelerId"]: t.get("displayName", "") for t in travelers}

    return {
        "group_trip_id": group_trip_id,
        "split_method": split_method,
        "traveler_count": len(travelers),
        "settlements": [
            {
                **s,
                "traveler_name": traveler_lookup.get(s["travelerProfileId"], ""),
            }
            for s in settlements
        ],
    }


def compute_reimbursements(group_trip_id: str, user_id: str) -> Dict[str, Any]:
    """
    Compute who-owes-whom reimbursement transfers using the settlement engine.

    This bridges the persisted assignments/ledger into the pure-function
    settlement engine for a complete settlement with reimbursement transfers.
    """
    from src.services.settlement_engine import (
        compute_settlement,
        settlement_result_to_dict,
    )

    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    if trip.get("ownerUserId") != user_id:
        raise HTTPException(status_code=403, detail="Only the trip owner can compute reimbursements.")

    travelers = repo.get_travelers_for_trip(group_trip_id)
    if not travelers:
        raise HTTPException(status_code=400, detail="No travelers found.")

    assignments = repo.get_assignments_for_trip(group_trip_id)
    ledger = repo.get_ledger_for_trip(group_trip_id)

    # Build tickets from assignments
    tickets = []
    for a in assignments:
        tickets.append({
            "passenger_id": a.get("travelerProfileId", ""),
            "base_fare_cash": float(a.get("cashCost", 0)),
            "taxes_fees_cash": 0,
        })

    # Build allocations from ledger
    allocations = []
    for entry in ledger:
        entry_type = entry.get("entryType", "")
        if entry_type == "points_used":
            allocations.append({
                "payer_user_id": entry.get("travelerProfileId", ""),
                "payment_type": "points",
                "points_program": entry.get("pointsProgram", ""),
                "points_used": int(entry.get("pointsAmount") or 0),
                "surcharge": 0,
            })
        elif entry_type in ("cash_paid", "tax_paid"):
            allocations.append({
                "payer_user_id": entry.get("travelerProfileId", ""),
                "payment_type": "cash",
                "cash_amount": float(entry.get("amountUsd", 0)),
            })

    # Build passengers (one per traveler for group planning)
    passengers = [
        {
            "passenger_id": t["travelerId"],
            "guardian_user_id": t["travelerId"],
            "full_name": t.get("displayName", ""),
        }
        for t in travelers
    ]

    # Build members
    members = [
        {
            "user_id": t["travelerId"],
            "name": t.get("displayName", ""),
            "household_id": t.get("roomShareGroupId"),
        }
        for t in travelers
    ]

    # Settlement policy from trip config
    policy = trip.get("settlementPolicy", "pay_your_own")
    valuation_config = {
        "mode": trip.get("valuationMode", "market_implied"),
        "fixed_rates_cpp": trip.get("fixedRatesCpp", {}),
        "min_cpp": 0.5,
        "max_cpp": 5.0,
        "reimburse_points_value": True,
        "include_taxes_in_split": True,
    }

    result = compute_settlement(
        tickets=tickets,
        allocations=allocations,
        passengers=passengers,
        members=members,
        policy=policy,
        valuation_config=valuation_config,
    )

    return settlement_result_to_dict(result)


def add_manual_adjustment(
    group_trip_id: str, user_id: str, body: Any
) -> Dict[str, Any]:
    """Add a manual adjustment to the contribution ledger."""
    from src.models.group_planning import ManualAdjustmentCreate

    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    if trip.get("ownerUserId") != user_id:
        raise HTTPException(status_code=403, detail="Only the trip owner can add adjustments.")

    profile = repo.get_traveler_profile(group_trip_id, body.traveler_profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Traveler profile not found.")

    now = _now_iso()
    entry = {
        "entryId": str(uuid.uuid4()),
        "groupTripId": group_trip_id,
        "travelerProfileId": body.traveler_profile_id,
        "entryType": "adjustment",
        "referenceType": "manual_adjustment",
        "referenceId": None,
        "amountUsd": body.amount_usd,
        "pointsAmount": None,
        "pointsProgram": None,
        "description": body.description,
        "createdAt": now,
    }
    repo.put_ledger_entry(group_trip_id, entry)

    return {"status": "ok", "entry_id": entry["entryId"], "description": body.description}
