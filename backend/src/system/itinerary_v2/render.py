"""
Render utilities for the v2 itinerary pipeline.

Converts solved optimization results to itinerary items for storage
and frontend display.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Dict, List, Any, Optional

from .schemas import SolvedItinerary, SolvedPayment, TripConstraints
from .providers.http_logging import log_render

logger = logging.getLogger(__name__)

# Airline display name mapping
_HUMANIZE_AIRLINE: Dict[str, str] = {
    "UA": "United MileagePlus", "AA": "American AAdvantage", "DL": "Delta SkyMiles",
    "AS": "Alaska Mileage Plan", "B6": "JetBlue TrueBlue", "AC": "Aeroplan",
    "BA": "British Airways Avios", "AF": "Air France / KLM Flying Blue", "KL": "KLM Flying Blue",
    "LH": "Lufthansa Miles & More", "LX": "Swiss Miles & More",
    "SQ": "Singapore KrisFlyer", "CX": "Cathay Asia Miles", "NH": "ANA Mileage Club", "JL": "JAL Mileage Bank",
    "EK": "Emirates Skywards", "QR": "Qatar Privilege Club", "EY": "Etihad Guest", "TK": "Turkish Miles&Smiles",
    "AV": "Avianca LifeMiles", "IB": "Iberia Avios", "QF": "Qantas Frequent Flyer", "VS": "Virgin Atlantic Flying Club",
    "KE": "Korean Air", "OZ": "Asiana", "CI": "China Airlines", "BR": "EVA Air",
}

# Bank display name mapping
_HUMANIZE_BANK: Dict[str, str] = {
    "amex": "Amex Membership Rewards",
    "chase": "Chase Ultimate Rewards",
    "citi": "Citi ThankYou Points",
    "capitalone": "Capital One Miles",
    "capital_one": "Capital One Miles",
    "bilt": "Bilt Rewards",
    "bank_of_america": "Bank of America Points",
    "wells_fargo": "Wells Fargo Points",
    "discover": "Discover Miles",
    "us_bank": "US Bank Rewards",
}


def render_itinerary_items(
    trip_id: str,
    solution: SolvedItinerary,
    constraints: TripConstraints,
    run_id: str,
    max_budget: Optional[int] = None,
    relaxed_message: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Convert solved optimization to itinerary items for storage.
    
    Produces items matching the frontend expected shape:
    - type=path: one per traveler with route and city stays
    - type=payments: per traveler payment details
    - type=totals: aggregated totals with transfers
    
    Args:
        trip_id: Trip ID
        solution: Solved itinerary from optimizer
        constraints: Trip constraints for day allocation
        run_id: Correlation ID for logging
        max_budget: Original max budget (for withinBudget flag)
        relaxed_message: Optional relaxation message
        
    Returns:
        List of itinerary items for storage
    """
    items = []
    
    # Calculate total days for allocation
    total_days = constraints.duration_days or 7
    
    # Get city stays from constraints
    must_visit = list(constraints.must_visit_airports)
    
    # Render path items
    path_count = 0
    for traveler_id, path in solution.paths.items():
        if not path:
            continue
        
        path_count += 1
        path_item = _render_path_item(
            trip_id=trip_id,
            traveler_id=traveler_id,
            path=path,
            must_visit=must_visit,
            total_days=total_days,
            totals=solution.totals,
            max_budget=max_budget,
        )
        items.append(path_item)
    
    # Render payment items
    payment_count = 0
    for traveler_id, payments in solution.payments.items():
        if not payments:
            continue
        
        payment_count += len(payments)
        payment_item = _render_payment_item(
            trip_id=trip_id,
            traveler_id=traveler_id,
            payments=payments,
        )
        items.append(payment_item)
    
    # Render totals item
    totals_item = _render_totals_item(
        trip_id=trip_id,
        totals=solution.totals,
        transfers=solution.transfers,
        native_used=solution.native_used,
    )
    items.append(totals_item)
    
    # Add relaxation info if present
    if relaxed_message:
        relaxed_item = {
            "tripId": trip_id,
            "itemId": "itinerary_relaxed_info",
            "type": "itinerary_relaxed_info",
            "message": relaxed_message,
            "original_budget": max_budget,
            "suggested_cash": solution.totals.get("cash"),
        }
        items.append(relaxed_item)
    
    # Log the render
    log_render(
        run_id=run_id,
        item_count=len(items),
        path_count=path_count,
        payment_count=payment_count,
        totals={
            "cash": solution.totals.get("cash", 0),
            "airline_points": solution.totals.get("airline_points", 0),
        },
    )
    
    return items


def _render_path_item(
    trip_id: str,
    traveler_id: str,
    path: List[str],
    must_visit: List[str],
    total_days: int,
    totals: Dict[str, Any],
    max_budget: Optional[int],
) -> Dict[str, Any]:
    """Render a path item for a traveler."""
    # Determine stay cities (not origin, not pure transit)
    requested = set(c.upper() for c in must_visit)
    
    # End destination gets stays too if different from origin
    if len(path) >= 2 and path[-1].upper() != path[0].upper():
        requested.add(path[-1].upper())
    
    # Calculate stays
    stays = [c for c in path[1:] if c.upper() in requested]
    
    if stays:
        num = len(stays)
        base = max(1, total_days // num)
        remainder = total_days - base * num
        day_list = [base] * num
        if remainder > 0:
            day_list[-1] += remainder
        city_objs = [{"name": c, "days": day_list[i]} for i, c in enumerate(stays)]
    else:
        city_objs = []
    
    # Calculate score
    total_cash = int(totals.get("cash", 0))
    points_cost = int(totals.get("airline_points", 0))
    points_value = float(totals.get("points_value", 0))
    
    score = 90  # Base score for optimized itinerary
    if points_value > 0:
        score += 5  # Using points effectively
    if max_budget and total_cash <= max_budget:
        score += 3  # Within budget
    score = min(99, score)
    
    within_budget = max_budget is None or max_budget <= 0 or total_cash <= max_budget
    
    return {
        "tripId": trip_id,
        "itemId": f"path_{traveler_id}",
        "type": "path",
        "travelerId": traveler_id,
        "path": path,
        "route": path,
        "cities": city_objs,
        "totalCost": total_cash,
        "pointsCost": points_cost,
        "score": score,
        "withinBudget": within_budget,
        "withinPoints": True,
        "name": "Optimized route",
    }


def _render_payment_item(
    trip_id: str,
    traveler_id: str,
    payments: List[SolvedPayment],
) -> Dict[str, Any]:
    """Render a payments item for a traveler."""
    enriched = []
    
    for p in payments:
        rec = {
            "edge": list(p.edge),
            "type": p.payment_type,
            "payer": p.payer,
            "mode": p.mode,
        }
        
        if p.payment_type == "cash":
            rec["fare"] = p.fare
        else:
            # Points payment
            if p.via_source and p.via_airline:
                rec["via"] = {"source": p.via_source, "airline": p.via_airline}
            elif p.via_native:
                rec["via"] = {"native": p.via_native}
            
            rec["miles"] = p.miles
            rec["surcharge"] = p.surcharge
            if p.points_value:
                rec["points_value"] = p.points_value
            if p.cents_per_point:
                rec["cents_per_point"] = p.cents_per_point
        
        enriched.append(rec)
    
    return {
        "tripId": trip_id,
        "itemId": f"payments_{traveler_id}",
        "type": "payments",
        "travelerId": traveler_id,
        "payments": enriched,
    }


def _render_totals_item(
    trip_id: str,
    totals: Dict[str, Any],
    transfers: Dict[str, Dict[str, Dict[str, Any]]],
    native_used: Dict[str, Dict[str, float]],
) -> Dict[str, Any]:
    """Render the totals item."""
    # Enrich transfers with operating carrier info
    enriched_transfers = {}
    
    for payer, by_source in transfers.items():
        enriched_transfers[payer] = {}
        for source, by_airline in (by_source or {}).items():
            enriched_transfers[payer][source] = {}
            for airline, data in (by_airline or {}).items():
                enriched_data = dict(data) if isinstance(data, dict) else {"amount": data}
                enriched_transfers[payer][source][airline] = enriched_data
    
    totals_copy = dict(totals)
    totals_copy["transfers"] = enriched_transfers
    totals_copy["native_used"] = native_used
    
    return {
        "tripId": trip_id,
        "itemId": "totals",
        "type": "totals",
        "totals": totals_copy,
    }


def save_items_to_repo(items: List[Dict[str, Any]]) -> None:
    """Save rendered items to the itinerary repository."""
    from src.repos import itinerary_repo
    
    if items:
        itinerary_repo.batch_write_items(items)
        logger.info(f"Saved {len(items)} itinerary items")
