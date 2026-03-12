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

def calculate_settlement(
    group_trip_id: str,
    assignments: List[Dict[str, Any]],
    ledger: List[Dict[str, Any]],
    travelers: List[Dict[str, Any]],
    split_method: str = "points_value_weighted",
) -> List[Dict[str, Any]]:
    """
    Compute per-traveler settlement with explanation lines.

    Returns list of settlement summaries ready for storage.
    """
    gross_shares = compute_gross_shares(assignments, travelers)
    contributions = compute_contribution_totals(ledger)

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
        net = contributed - gross

        explanation_lines = _build_explanation(tid, gross, contributed, net, assignments, ledger, name)

        summary = {
            "settlementId": str(uuid.uuid4()),
            "groupTripId": group_trip_id,
            "travelerProfileId": tid,
            "grossShareUsd": round(gross, 2),
            "contributedValueUsd": round(contributed, 2),
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
