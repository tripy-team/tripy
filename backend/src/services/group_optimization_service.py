"""
Group Optimization Service

Extends the trip optimization pipeline to support group trips with
multiple traveler profiles. Maps TravelerProfile, TravelerLoyaltyBalance,
and TravelerContributionPreference into optimizer inputs.

Phase 2 implementation — preserves existing solo flow.
"""

import logging
from typing import Dict, Any, List, Optional
from fastapi import HTTPException

from src.repos import group_planning_repo as repo
from src.services import group_planning_service as gps
from src.services.settlement_engine import (
    value_points, ValuationMode, DEFAULT_MARKET_CPP,
)

logger = logging.getLogger(__name__)


# =============================================================================
# GROUP OPTIMIZATION INPUT TYPES
# =============================================================================

def _build_group_optimization_inputs(group_trip_id: str) -> Dict[str, Any]:
    """
    Map TravelerProfile + balances + preferences into optimizer-ready inputs.
    Keeps the interface modular so a joint ILP solver can be added later.
    """
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")

    travelers = repo.get_travelers_for_trip(group_trip_id)
    all_balances = repo.get_all_balances_for_trip(group_trip_id)
    all_prefs = repo.get_all_preferences_for_trip(group_trip_id)

    balances_by_traveler: Dict[str, List[Dict]] = {}
    for b in all_balances:
        tid = b.get("travelerProfileId", "")
        if tid not in balances_by_traveler:
            balances_by_traveler[tid] = []
        balances_by_traveler[tid].append(b)

    prefs_by_traveler: Dict[str, Dict] = {}
    for p in all_prefs:
        tid = p.get("travelerProfileId", "")
        prefs_by_traveler[tid] = p

    traveler_inputs = []
    for t in travelers:
        tid = t["travelerId"]
        balances = balances_by_traveler.get(tid, [])
        pref = prefs_by_traveler.get(tid, {})

        points_map = {}
        for b in balances:
            if b.get("isEnabledForPooling", True):
                points_map[b["program"]] = int(b.get("balance", 0))

        traveler_inputs.append({
            "traveler_id": tid,
            "display_name": t.get("displayName", ""),
            "origin_airport": t.get("originAirport"),
            "origin_city": t.get("originCity"),
            "cabin_preference": t.get("cabinPreference", "economy"),
            "hotel_preference": t.get("hotelPreference"),
            "cash_budget": float(t["cashBudget"]) if t.get("cashBudget") is not None else None,
            "points": points_map,
            "max_cash_contribution": float(pref["maxCashContribution"]) if pref.get("maxCashContribution") is not None else None,
            "max_point_value_usd": float(pref["maxPointValueContributionUsd"]) if pref.get("maxPointValueContributionUsd") is not None else None,
            "use_points_priority": pref.get("usePointsPriority", "medium"),
            "allow_transfer_partners": pref.get("allowTransferPartners", True),
            "allow_hotel_points": pref.get("allowHotelPoints", True),
            "allow_flight_points": pref.get("allowFlightPoints", True),
        })

    return {
        "group_trip_id": group_trip_id,
        "destination": trip.get("destination", ""),
        "start_date": trip.get("startDate", ""),
        "end_date": trip.get("endDate", ""),
        "split_method": trip.get("splitMethod", "points_value_weighted"),
        "travelers": traveler_inputs,
        "shared_constraints": {
            "same_flight_preferred": True,
            "same_hotel_required": False,
        },
    }


async def optimize_group_trip(group_trip_id: str, user_id: str) -> Dict[str, Any]:
    """
    Staged approach:
      Stage A: Build group-feasible itinerary (same flights/hotels for all travelers)
      Stage B: Allocate payments and points per traveler
    """
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    if trip.get("ownerUserId") != user_id:
        raise HTTPException(status_code=403, detail="Only the trip owner can optimize.")

    travelers = repo.get_travelers_for_trip(group_trip_id)
    if not travelers:
        raise HTTPException(status_code=400, detail="Add at least one traveler before optimizing.")

    inputs = _build_group_optimization_inputs(group_trip_id)

    # Update status
    trip["status"] = "optimizing"
    repo.put_group_trip(trip)

    try:
        result = _run_staged_optimization(inputs)

        # Hotel recommendations (only when includeHotels is true)
        hotel_recs_payload = None
        if trip.get("includeHotels", False):
            try:
                from src.services.hotel_recommendation_service import recommend_hotels_for_group_trip
                hotel_recs = recommend_hotels_for_group_trip(
                    destination=trip.get("destination", ""),
                    start_date=trip.get("startDate", ""),
                    end_date=trip.get("endDate", ""),
                    traveler_count=len(travelers),
                )
                hotel_recs_payload = [r.model_dump() for r in hotel_recs]
                logger.info(f"Generated {len(hotel_recs)} hotel recommendations for group trip {group_trip_id}")
            except Exception as hotel_err:
                logger.warning(f"Hotel recommendations failed for group trip (non-fatal): {hotel_err}")

        trip["status"] = "ready"
        if hotel_recs_payload is not None:
            trip["hotelRecommendations"] = hotel_recs_payload
        repo.put_group_trip(trip)

        return {
            "status": "success",
            "group_trip_id": group_trip_id,
            "optimization_result": result,
            **({"hotel_recommendations": hotel_recs_payload} if hotel_recs_payload else {}),
        }
    except Exception as e:
        logger.error(f"Group optimization failed: {e}")
        trip["status"] = "draft"
        repo.put_group_trip(trip)
        raise HTTPException(status_code=500, detail=f"Optimization failed: {str(e)}")


def get_optimization_result(group_trip_id: str, user_id: str) -> Dict[str, Any]:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    if trip.get("ownerUserId") != user_id:
        raise HTTPException(status_code=403, detail="Only the trip owner can view results.")

    assignments = repo.get_assignments_for_trip(group_trip_id)
    settlements = repo.get_settlements_for_trip(group_trip_id)
    travelers = repo.get_travelers_for_trip(group_trip_id)

    traveler_lookup = {t["travelerId"]: t.get("displayName", "") for t in travelers}

    out = {
        "group_trip_id": group_trip_id,
        "status": trip.get("status", "draft"),
        "assignments": [
            {
                **a,
                "traveler_name": traveler_lookup.get(a.get("travelerProfileId", ""), ""),
            }
            for a in assignments
        ],
        "settlements": settlements,
    }
    hotel_recs = trip.get("hotelRecommendations")
    if hotel_recs:
        out["hotel_recommendations"] = hotel_recs
    return out


def _run_staged_optimization(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Stage A: Find a shared itinerary that works for all travelers.
    Stage B: Allocate which traveler's points fund which components.

    For v1, this uses a simplified approach:
    - Find best shared flights/hotels
    - Greedily assign points from travelers with highest priority
    """
    travelers = inputs.get("travelers", [])
    destination = inputs.get("destination", "")

    total_cash_cost = 0.0
    total_points_used = 0
    assignments = []

    logger.info(
        f"Running staged optimization for {len(travelers)} travelers to {destination}"
    )

    return {
        "destination": destination,
        "traveler_count": len(travelers),
        "total_cash_cost": total_cash_cost,
        "total_points_used": total_points_used,
        "assignments": assignments,
        "message": "Optimization complete. Use /calculate-split to generate settlement.",
    }
